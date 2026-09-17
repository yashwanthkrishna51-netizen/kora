import { and, eq, sql } from "drizzle-orm";
import {
  clients,
  integrations,
  milestones,
  modules,
  phases,
  amsWorkLog,
} from "@/lib/db/schema";
import { vToken } from "@/lib/db/occ";
import { newId } from "@/lib/validation/ids";
import { updateOrThrow, currentRow } from "./core";
import { conflict, notFound } from "@/lib/api/errors";
import type { AnyDb } from "@/lib/auth/db-types";
import type { z } from "zod";
import type { clientCreate, clientUpdate } from "@/lib/validation/entities";

/** Numerics are stored as `numeric`, which the driver wants as a string. */
const numStr = (v: number | null | undefined) =>
  v === null || v === undefined ? null : String(v);

export async function createClient(
  db: AnyDb,
  input: z.infer<typeof clientCreate>,
): Promise<Record<string, unknown>> {
  const id = newId("c");

  const rows = await db
    .insert(clients)
    .values({
      id,
      name: input.name,
      description: input.description ?? "",
      currency: input.currency ?? "INR",
      masterAssignee: input.masterAssignee ?? null,
      manDayRate: numStr(input.manDayRate),
      totalAvailableHours: numStr(input.totalAvailableHours),
      hasImplementation: input.hasImplementation ?? false,
      hasAms: input.hasAms ?? false,
    })
    .returning();

  return { ...rows[0], _v: await tokenFor(db, id) };
}

export async function updateClient(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof clientUpdate>,
): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.currency !== undefined) values.currency = patch.currency;
  if (patch.masterAssignee !== undefined) {
    values.masterAssignee = patch.masterAssignee;
  }
  if (patch.manDayRate !== undefined) {
    values.manDayRate = numStr(patch.manDayRate);
  }
  if (patch.totalAvailableHours !== undefined) {
    values.totalAvailableHours = numStr(patch.totalAvailableHours);
  }
  if (patch.hasImplementation !== undefined) {
    values.hasImplementation = patch.hasImplementation;
  }
  if (patch.hasAms !== undefined) values.hasAms = patch.hasAms;

  const row = await updateOrThrow(db, clients, "client", id, token, values);
  return { ...row, _v: await tokenFor(db, id) };
}

/**
 * Archives a client and everything under it, in one transaction.
 *
 * Atomicity is the point. Archiving the client alone would leave its
 * integrations, modules, phases and work-log entries active, and every
 * portfolio aggregate walks those tables directly — the client would vanish
 * from the rail while its 40 phases kept contributing to the dashboard's
 * counts. A partial cascade is worse than either outcome, so it is all or
 * nothing.
 *
 * Nothing is deleted. `archived = true` is reversible; the old app's real
 * DELETE was not, which is why its data-loss incident needed a backup restore.
 */
export async function archiveClient(
  db: AnyDb,
  id: string,
  token: string,
  actor?: string,
): Promise<{ id: string; archived: Record<string, number> }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as AnyDb;
  // Cascaded rows get the same stamp as their parent, so a recovery can find
  // everything that went at once rather than guessing from timestamps.
  const stamp = { archived: true, archivedAt: new Date().toISOString(), archivedBy: actor ?? null };

    // The client goes first, under its OCC token. If someone else has edited
    // it since this tab loaded, this throws and the transaction rolls back
    // before a single child row is touched.
    await updateOrThrow(t, clients, "client", id, token, stamp);

    const counts: Record<string, number> = {};
    const cascade = [
      ["integrations", integrations],
      ["milestones", milestones],
      ["modules", modules],
      ["phases", phases],
      ["workLog", amsWorkLog],
    ] as const;

    for (const [label, table] of cascade) {
      // Children are archived without an OCC check on purpose. The user
      // authorised deleting the client, not each of its 40 phases, and
      // demanding a token per child would make the operation impossible to
      // complete on any client that is actively being edited.
      const rows = await t
        .update(table)
        .set(stamp)
        .where(and(eq(table.clientId, id), eq(table.archived, false)))
        .returning({ id: table.id });
      counts[label] = rows.length;
    }

    return { id, archived: counts };
  });
}

/**
 * Restores an archived client and its children.
 *
 * The counterpart to the cascade, and the reason soft delete earns its keep:
 * recovering from a mistaken delete is a single call rather than a restore
 * from last night's dump.
 *
 * Only children archived by the cascade come back. That is not distinguishable
 * from children archived individually beforehand, so this deliberately
 * restores everything under the client and says how many — an over-restore is
 * visible and fixable, whereas a silent under-restore leaves records that
 * exist but cannot be reached from anywhere.
 */
export async function restoreClient(
  db: AnyDb,
  id: string,
): Promise<{ id: string; restored: Record<string, number> }> {
  return db.transaction(async (tx) => {
    const t = tx as unknown as AnyDb;

    const [client] = await t
      .select({ id: clients.id, name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.archived, true)))
      .limit(1);

    if (!client) throw notFound("No archived client with that id");

    // The unique index on name covers active rows only, so a name freed by
    // archiving may have been taken since. Checked explicitly to give a
    // usable message instead of a raw constraint violation.
    const [clash] = await t
      .select({ id: clients.id })
      .from(clients)
      .where(
        and(
          sql`lower(trim(${clients.name})) = lower(trim(${client.name}))`,
          eq(clients.archived, false),
        ),
      )
      .limit(1);

    if (clash) {
      throw conflict(
        `Another active client is now called "${client.name}". Rename it before restoring this one.`,
      );
    }

    await t.update(clients).set({ archived: false }).where(eq(clients.id, id));

    const restored: Record<string, number> = {};
    const cascade = [
      ["integrations", integrations],
      ["milestones", milestones],
      ["modules", modules],
      ["phases", phases],
      ["workLog", amsWorkLog],
    ] as const;

    for (const [label, table] of cascade) {
      const rows = await t
        .update(table)
        .set({ archived: false })
        .where(and(eq(table.clientId, id), eq(table.archived, true)))
        .returning({ id: table.id });
      restored[label] = rows.length;
    }

    return { id, restored };
  });
}

/** The freshly written OCC token, so the client can save again immediately. */
async function tokenFor(db: AnyDb, id: string): Promise<string | null> {
  const [row] = await db
    .select({ _v: vToken(clients.updatedAt) })
    .from(clients)
    .where(eq(clients.id, id))
    .limit(1);
  return row?._v ?? null;
}

export { currentRow };
