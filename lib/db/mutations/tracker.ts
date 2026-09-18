import { and, eq } from "drizzle-orm";
import {
  clients,
  integrations,
  milestones,
  modules,
  phases,
  amsWorkLog,
} from "@/lib/db/schema";
import { PHASES } from "@/lib/domain/constants";
import { canCompletePhase } from "@/lib/domain/implementation";
import { newId, derivePhaseId } from "@/lib/validation/ids";
import { vToken } from "@/lib/db/occ";
import { updateOrThrow, archiveOrThrow } from "./core";
import { badRequest, notFound } from "@/lib/api/errors";
import type { AnyDb } from "@/lib/auth/db-types";
import type { ActivityEntry, Phase } from "@/lib/domain/types";
import type { z } from "zod";
import type {
  integrationCreate,
  integrationUpdate,
  milestoneCreate,
  milestoneUpdate,
  moduleCreate,
  moduleUpdate,
  phaseUpdate,
  workLogCreate,
  workLogUpdate,
} from "@/lib/validation/entities";

const numStr = (v: number | null | undefined) =>
  v === null || v === undefined ? null : String(v);

/** Fails early with a usable message rather than a foreign-key violation. */
async function assertActiveClient(db: AnyDb, clientId: string): Promise<void> {
  const [row] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.archived, false)))
    .limit(1);
  if (!row) throw notFound("That client no longer exists");
}

/* ----------------------------------------------------------- integrations */

export async function createIntegration(
  db: AnyDb,
  clientId: string,
  input: z.infer<typeof integrationCreate>,
) {
  await assertActiveClient(db, clientId);
  const [row] = await db
    .insert(integrations)
    .values({
      id: newId("in"),
      clientId,
      name: input.name,
      status: input.status ?? "Not Started",
      assignee: input.assignee ?? null,
      dueDate: input.dueDate ?? null,
      description: input.description ?? "",
      nextAction: input.nextAction ?? "",
      effortWeight: numStr(input.effortWeight) ?? "0.5",
    })
    .returning();
  return withToken(db, integrations, row.id, row);
}

export async function updateIntegration(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof integrationUpdate>,
) {
  const values = pick(patch, {
    name: 1, status: 1, assignee: 1, dueDate: 1, description: 1, nextAction: 1,
  });
  if (patch.effortWeight !== undefined) {
    values.effortWeight = numStr(patch.effortWeight);
  }
  const row = await updateOrThrow(db, integrations, "integration", id, token, values);
  return withToken(db, integrations, id, row);
}

/**
 * Archives an integration and its milestones together.
 *
 * A milestone has no meaning without its integration, and the Integrations
 * table counts milestones across the client — leaving them active would keep
 * them in that count while they were unreachable from any screen.
 */
export async function archiveIntegration(
  db: AnyDb,
  id: string,
  token: string,
  actor?: string,
) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as AnyDb;
  // Cascaded rows get the same stamp as their parent, so a recovery can find
  // everything that went at once rather than guessing from timestamps.
  const stamp = { archived: true, archivedAt: new Date().toISOString(), archivedBy: actor ?? null };
    await updateOrThrow(t, integrations, "integration", id, token, stamp);
    const gone = await t
      .update(milestones)
      .set(stamp)
      .where(and(eq(milestones.integrationId, id), eq(milestones.archived, false)))
      .returning({ id: milestones.id });
    return { id, archivedMilestones: gone.length };
  });
}

/* ------------------------------------------------------------- milestones */

export async function createMilestone(
  db: AnyDb,
  clientId: string,
  input: z.infer<typeof milestoneCreate>,
) {
  // The integration is checked against the client rather than on its own, so
  // a milestone cannot be attached to another client's integration by id.
  const [parent] = await db
    .select({ id: integrations.id })
    .from(integrations)
    .where(
      and(
        eq(integrations.id, input.integrationId),
        eq(integrations.clientId, clientId),
        eq(integrations.archived, false),
      ),
    )
    .limit(1);
  if (!parent) throw notFound("That integration no longer exists");

  const [row] = await db
    .insert(milestones)
    .values({
      id: newId("ms"),
      integrationId: input.integrationId,
      clientId,
      name: input.name,
      status: input.status ?? "Pending",
      dueDate: input.dueDate ?? null,
      owner: input.owner ?? null,
      notes: input.notes ?? "",
    })
    .returning();
  return withToken(db, milestones, row.id, row);
}

export async function updateMilestone(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof milestoneUpdate>,
) {
  const values = pick(patch, {
    name: 1, status: 1, dueDate: 1, owner: 1, notes: 1,
  });
  const row = await updateOrThrow(db, milestones, "milestone", id, token, values);
  return withToken(db, milestones, id, row);
}

export const archiveMilestone = (
  db: AnyDb,
  id: string,
  token: string,
  actor?: string,
) => archiveOrThrow(db, milestones, "milestone", id, token, actor);

/* ------------------------------------------------- modules and their phases */

/**
 * Creates a module together with all nine phases, in one transaction.
 *
 * The Implementation matrix is a fixed nine-column grid and every aggregate
 * over it assumes a module has all nine rows. A module that committed with
 * seven of them — the shape a partial failure produces — renders as a broken
 * row and quietly skews the completion percentage for the whole client. So
 * either all ten rows land or none do.
 *
 * Phase ids are derived from (moduleId, phaseName), the same derivation the
 * migration used, so a phase's URL is stable and re-running the backfill
 * stays idempotent.
 */
export async function createModule(
  db: AnyDb,
  clientId: string,
  input: z.infer<typeof moduleCreate>,
) {
  await assertActiveClient(db, clientId);

  return db.transaction(async (tx) => {
    const t = tx as unknown as AnyDb;
    const moduleId = newId("md");

    const [row] = await t
      .insert(modules)
      .values({ id: moduleId, clientId, name: input.name })
      .returning();

    await t.insert(phases).values(
      PHASES.map((phaseName) => ({
        id: derivePhaseId(moduleId, phaseName),
        moduleId,
        clientId,
        phaseName,
        status: "Not Started",
      })),
    );

    return withToken(t, modules, moduleId, row);
  });
}

export async function updateModule(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof moduleUpdate>,
) {
  const row = await updateOrThrow(db, modules, "module", id, token,
    pick(patch, { name: 1 }));
  return withToken(db, modules, id, row);
}

/** Archives a module and its nine phases together, for the same reason. */
export async function archiveModule(
  db: AnyDb,
  id: string,
  token: string,
  actor?: string,
) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as AnyDb;
  // Cascaded rows get the same stamp as their parent, so a recovery can find
  // everything that went at once rather than guessing from timestamps.
  const stamp = { archived: true, archivedAt: new Date().toISOString(), archivedBy: actor ?? null };
    await updateOrThrow(t, modules, "module", id, token, stamp);
    const gone = await t
      .update(phases)
      .set(stamp)
      .where(and(eq(phases.moduleId, id), eq(phases.archived, false)))
      .returning({ id: phases.id });
    return { id, archivedPhases: gone.length };
  });
}

/**
 * Updates one phase.
 *
 * Carries the signoff gate, which until now lived only in the browser:
 * js/events.js checked it and returned before saving, so the rule was
 * advisory. Anything talking to the API directly — a stale bundle, a script,
 * a future mobile client — could mark BPU/CRP/UAT Signoff complete with no
 * document attached, and the whole point of those phases is the document.
 *
 * The check is on `storagePath`, not on `url`. The old client looked for
 * `attachment.url`, but URLs are now generated per read and never stored, so
 * checking for one would reject every genuinely signed-off phase.
 */
export async function updatePhase(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof phaseUpdate>,
) {
  const [existing] = await db
    .select({
      phaseName: phases.phaseName,
      activityLog: phases.activityLog,
    })
    .from(phases)
    .where(and(eq(phases.id, id), eq(phases.archived, false)))
    .limit(1);

  if (!existing) throw notFound("That phase no longer exists");

  if (patch.status === "Completed") {
    // The rule itself lives in lib/domain — one definition, golden-tested
    // against the original app. It was reimplemented inline here, which meant
    // the same business rule existed twice and was free to drift; the domain
    // copy is the one the frontend will also call before enabling the button.
    const gate = canCompletePhase({
      id,
      name: existing.phaseName,
      status: "Completed",
      updates: existing.activityLog ?? [],
    } as unknown as Phase);

    if (!gate.ok) {
      throw badRequest(gate.reason, {
        code: "signoff_document_required",
        phase: existing.phaseName,
      });
    }
  }

  const values = pick(patch, {
    status: 1, assignee: 1, startDate: 1, targetDate: 1,
    currentActivity: 1, nextAction: 1,
  });
  const row = await updateOrThrow(db, phases, "phase", id, token, values);
  return withToken(db, phases, id, row);
}

/* ---------------------------------------------------------------- work log */

export async function createWorkLogEntry(
  db: AnyDb,
  clientId: string,
  input: z.infer<typeof workLogCreate>,
) {
  await assertActiveClient(db, clientId);
  const [row] = await db
    .insert(amsWorkLog)
    .values({
      id: newId("wl"),
      clientId,
      dateRaised: input.dateRaised,
      dueDate: input.dueDate ?? null,
      raisedBy: input.raisedBy ?? null,
      module: input.module ?? null,
      project: input.project ?? null,
      description: input.description ?? "",
      entryType: input.type ?? null,
      queryLevel: input.queryLevel ?? null,
      entryStatus: input.entryStatus ?? "Open",
      ragStatus: input.ragStatus ?? null,
      modeOfSupport: input.modeOfSupport ?? null,
      dependencies: input.dependencies ?? "",
      solution: input.solution ?? "",
      hours: numStr(input.hours) ?? "0",
    })
    .returning();
  return withToken(db, amsWorkLog, row.id, row);
}

export async function updateWorkLogEntry(
  db: AnyDb,
  id: string,
  token: string,
  patch: z.infer<typeof workLogUpdate>,
) {
  const values = pick(patch, {
    dateRaised: 1, dueDate: 1, raisedBy: 1, module: 1, project: 1,
    description: 1, queryLevel: 1, entryStatus: 1, ragStatus: 1,
    modeOfSupport: 1, dependencies: 1, solution: 1,
  });
  // Two fields whose wire name differs from the column name.
  if (patch.type !== undefined) values.entryType = patch.type;
  if (patch.hours !== undefined) values.hours = numStr(patch.hours);

  const row = await updateOrThrow(db, amsWorkLog, "work log entry", id, token, values);
  return withToken(db, amsWorkLog, id, row);
}

export const archiveWorkLogEntry = (
  db: AnyDb,
  id: string,
  token: string,
  actor?: string,
) => archiveOrThrow(db, amsWorkLog, "work log entry", id, token, actor);

/* ------------------------------------------------------------------ shared */

/**
 * Copies only the keys the patch actually carried.
 *
 * `undefined` means "not in this patch"; `null` means "clear this field". The
 * two are different and collapsing them would make every partial update wipe
 * the fields it did not mention — which is the row-level version of exactly
 * the bug this whole rewrite exists to remove.
 */
function pick<T extends object>(
  patch: T,
  fields: Partial<Record<keyof T, 1>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    if (patch[key] !== undefined) out[key as string] = patch[key];
  }
  return out;
}

/** Attaches the freshly written OCC token so the client can save again. */
async function withToken(
  db: AnyDb,
  table: typeof integrations | typeof milestones | typeof modules
    | typeof phases | typeof amsWorkLog,
  id: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const [fresh] = await db
    .select({ _v: vToken(table.updatedAt) })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return { ...row, _v: fresh?._v ?? null };
}

export type { ActivityEntry };
