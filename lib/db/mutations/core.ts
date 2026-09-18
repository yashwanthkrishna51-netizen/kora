import { and, eq, sql } from "drizzle-orm";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import type { AnyDb } from "@/lib/auth/db-types";
import { vToken } from "@/lib/db/occ";
import { notFound, conflict } from "@/lib/api/errors";

/**
 * The shared write primitives.
 *
 * The single most important property of this layer is what it does NOT offer:
 * there is no way to say "here is the array, make the table match it". That
 * was the old app's only write shape, and it is the mechanism behind the
 * documented data-loss incident — a browser posting a stale array simply
 * missing a row was indistinguishable from that row having been deleted, so
 * it was deleted. The old code eventually accumulated a `changedIds` scope
 * list, a fresh-ids re-read and a 20%-bulk-delete guard to contain that, all
 * of which are workarounds for the shape itself.
 *
 * Here every write names one row by id. A row that is not named cannot be
 * touched, so the failure mode has nowhere to live.
 */

/** Every v2 entity carries these. */
interface Archival {
  id: PgColumn;
  archived: PgColumn;
  updatedAt: PgColumn;
}

/**
 * Drizzle's builder types are written for concrete tables and do not survive
 * a generic parameter — `.from(table)` on a `PgTable & Archival` trips a
 * conditional type meant to catch a missing `returning`. The casts are
 * confined to this file; every exported signature stays fully typed, and the
 * behaviour is covered by the integration tests rather than by the compiler.
 */
type AnyTable = never;

/**
 * An OCC-guarded UPDATE.
 *
 * The precondition is part of the statement — `where id = ? and updated_at =
 * ?` — so the check and the write are one atomic operation. Reading the row
 * first and comparing in JavaScript would leave a window between the check and
 * the write, which is the bug this whole mechanism exists to close.
 *
 * Returns null when nothing matched. The caller decides whether that is a 404
 * or a 409, since only it can tell them apart.
 */
export async function updateGuarded<T extends PgTable & Archival>(
  db: AnyDb,
  table: T,
  id: string,
  token: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .update(table as AnyTable)
    .set(values)
    .where(
      and(
        eq(table.id, id),
        eq(table.archived, false),
        // Cast, not string comparison: the token is canonical UTC ISO text
        // and the column renders differently depending on the session
        // timezone. Comparing as text would fail for reasons unrelated to
        // concurrency.
        sql`${table.updatedAt} = ${token}::timestamptz`,
      ),
    )
    .returning();

  return (rows[0] as Record<string, unknown>) ?? null;
}

/** Current state of a row, for telling 404 apart from 409. */
export async function currentRow<T extends PgTable & Archival>(
  db: AnyDb,
  table: T,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({
      row: sql<Record<string, unknown>>`to_jsonb(${table})`,
      _v: vToken(table.updatedAt),
      archived: table.archived,
    })
    .from(table as AnyTable)
    .where(eq(table.id, id))
    .limit(1);

  const found = (rows as Array<{ row: Record<string, unknown>; _v: string; archived: boolean }>)[0];
  if (!found || found.archived) return null;
  return { ...found.row, _v: found._v };
}

/**
 * Runs an OCC update and turns a miss into the right error.
 *
 * Deliberately the only exported way to perform a guarded update: a call site
 * that forgot to check the result would report success on a write that never
 * happened, and the user's edit would vanish silently. Routing every update
 * through here means that mistake cannot be made one function at a time.
 */
export async function updateOrThrow<T extends PgTable & Archival>(
  db: AnyDb,
  table: T,
  entity: string,
  id: string,
  token: string,
  values: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const updated = await updateGuarded(db, table, id, token, values);
  if (updated) return updated;

  const current = await currentRow(db, table, id);
  if (!current) {
    throw notFound(
      `That ${entity} no longer exists — someone deleted it while you were editing.`,
    );
  }

  throw conflict("Someone else changed this while you were editing it.", {
    code: "conflict",
    entity,
    id,
    current,
  });
}

/**
 * Soft delete.
 *
 * Nothing is ever physically removed. The old app issued real DELETEs, which
 * is why the data-loss incident had no recovery path short of a backup
 * restore; `archived = true` means the same accident is a one-column fix.
 *
 * Guarded by the same OCC token as an edit, which the old delete path skipped
 * entirely — you could delete a row you had never seen the current version of.
 */
export async function archiveOrThrow<T extends PgTable & Archival>(
  db: AnyDb,
  table: T,
  entity: string,
  id: string,
  token: string,
  /** Who is archiving. Recorded so the row can be recovered knowingly. */
  actor?: string,
): Promise<Record<string, unknown>> {
  // WHEN AND BY WHOM, not just `archived = true`.
  //
  // Every table has carried `archived_at` and `archived_by` since the v2 schema
  // and nothing ever wrote them, so every soft-deleted row looked identical to
  // one archived two years ago. That matters because soft delete is the whole
  // recovery story here — the UI tells people an administrator can restore a
  // record from the database — and without a timestamp or an actor there is no
  // way to find the right row or know who to ask. The audit log cannot fill the
  // gap either: it records the entity as a TABLE NAME with no record id.
  return updateOrThrow(db, table, entity, id, token, {
    archived: true,
    archivedAt: new Date().toISOString(),
    archivedBy: actor ?? null,
  });
}
