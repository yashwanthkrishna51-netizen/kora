import { and, eq, sql } from "drizzle-orm";
import { integrations, phases } from "@/lib/db/schema";
import { newId } from "@/lib/validation/ids";
import { vToken } from "@/lib/db/occ";
import { notFound, forbidden, badRequest } from "@/lib/api/errors";
import type { AnyDb } from "@/lib/auth/db-types";
import type { ActivityEntry } from "@/lib/domain/types";
import type { SessionUser } from "@/lib/auth/session";
import type { z } from "zod";
import type { activityCreate } from "@/lib/validation/entities";

/**
 * Activity feeds.
 *
 * Two feeds, one shape: an integration's `timeline` and a phase's `updates`
 * are both a jsonb array of ActivityEntry. They stayed jsonb through the
 * normalization because entries are append-only and self-contained — there is
 * nothing to join them to and nothing queries across them.
 *
 * POSTING AN ENTRY DOES NOT TAKE AN OCC TOKEN, and that is deliberate. Every
 * other write demands If-Match because two people editing the same field means
 * one of them loses text. Appending is not that: two people posting different
 * comments is not a conflict, it is a conversation. Under OCC the second
 * poster would get a 409 for having done nothing wrong, and in the old app —
 * which rewrote the whole array — their comment would have overwritten the
 * first one outright.
 *
 * So the insert happens in the database with jsonb `||`, which is atomic. Two
 * concurrent posts both land, with no lost write and no spurious conflict.
 */

type FeedTable = typeof integrations | typeof phases;

const FEEDS = {
  integration: integrations,
  phase: phases,
} as const;

export type FeedKind = keyof typeof FEEDS;

function feed(kind: FeedKind): FeedTable {
  return FEEDS[kind];
}

/**
 * Appends one entry, atomically.
 *
 * `addedBy` and the timestamps come from the session, never from the request.
 * The old client sent its own author field, so the attribution in a feed whose
 * entire purpose is attribution was whatever the browser claimed.
 */
export async function appendActivity(
  db: AnyDb,
  kind: FeedKind,
  parentId: string,
  user: SessionUser,
  input: z.infer<typeof activityCreate>,
  now = new Date(),
): Promise<{ entry: ActivityEntry; _v: string | null }> {
  const table = feed(kind);
  const iso = now.toISOString();

  const entry: ActivityEntry = {
    id: newId("t"),
    date: iso.slice(0, 10),
    update: input.update,
    addedBy: user.name || user.username,
    addedAt: iso,
    ...(input.attachment ? { attachment: input.attachment } : {}),
  };

  const rows = await db
    .update(table)
    // PREPEND, not append. The old client did `timeline.unshift(entry)`, so
    // every stored feed is newest-first and the UI renders it in array order.
    // Concatenating on the right would put new entries below years of older
    // ones — the feed would look empty at the top and unchanged at a glance.
    //
    // `||` on jsonb concatenates and is atomic. Read-modify-write in
    // JavaScript would drop whichever of two simultaneous posts committed
    // first, which is exactly what the old full-array save did.
    .set({
      activityLog: sql`${JSON.stringify([entry])}::jsonb || ${table.activityLog}`,
    })
    .where(and(eq(table.id, parentId), eq(table.archived, false)))
    .returning({ id: table.id });

  if (!rows.length) throw notFound(`That ${kind} no longer exists`);

  return { entry, _v: await tokenFor(db, table, parentId) };
}

/**
 * Edits one entry in place, keeping the previous text as history.
 *
 * THE ID RE-CHECK IN THE WHERE CLAUSE IS THE WHOLE SAFETY PROPERTY.
 *
 * `locate()` resolves the entry's array index, and the write then targets that
 * index — two statements, with a window between them. `appendActivity`
 * PREPENDS, so a post landing in that window shifts every index by one and the
 * edit lands on somebody else's comment, replacing its text and its history.
 * That is silent data loss, and it was reachable: an earlier version of this
 * function had no such check while `deleteActivity` did, and the comment here
 * asserted the race was impossible.
 *
 * Re-checking the id at that index inside the same statement turns the race
 * into "nothing happened" — the row count comes back zero and the caller is
 * told to reload, rather than someone else's words quietly disappearing.
 *
 * This is also why an entry edit takes no `If-Match`: the parent's OCC token
 * changes on every append, so requiring it would make editing your own comment
 * fail whenever a colleague happened to post. The id guard is concurrency
 * control at the right granularity — the entry, not the feed.
 *
 * Only the author or an admin may edit. The old app enforced this by hiding
 * the button, which is not enforcement.
 */
export async function editActivity(
  db: AnyDb,
  kind: FeedKind,
  parentId: string,
  entryId: string,
  user: SessionUser,
  input: z.infer<typeof activityCreate>,
  now = new Date(),
): Promise<{ entry: ActivityEntry; _v: string | null }> {
  const table = feed(kind);
  const { log, index } = await locate(db, table, parentId, entryId, kind);
  const existing = log[index];

  assertMayModify(existing, user);

  const iso = now.toISOString();
  const updated: ActivityEntry = {
    ...existing,
    update: input.update,
    editedAt: iso,
    // The previous text is kept rather than replaced: an activity feed is a
    // record of what was said and when, and a silent edit destroys that.
    history: [
      ...(existing.history ?? []),
      { at: iso, by: user.name || user.username, update: existing.update },
    ],
    ...(input.attachment === undefined
      ? {}
      : input.attachment === null
        ? { attachment: undefined }
        : { attachment: input.attachment }),
  };

  const hit = await writeAtIndex(db, table, parentId, index, entryId, {
    activityLog: sql`jsonb_set(${table.activityLog}, ${`{${index}}`}::text[], ${JSON.stringify(updated)}::jsonb, false)`,
  });

  if (!hit) {
    throw badRequest(
      "That entry moved while you were editing it. Reload and try again.",
    );
  }

  return { entry: updated, _v: await tokenFor(db, table, parentId) };
}

/**
 * Removes one entry.
 *
 * `- index` on a jsonb array deletes that element in a single statement. The
 * index is resolved from the entry id immediately before, which leaves a
 * narrow window in which a concurrent delete could shift it — so the id at
 * that index is re-checked inside the same statement and the delete is a no-op
 * if it moved. That turns the race into "nothing happened", never "the wrong
 * comment was deleted".
 */
export async function deleteActivity(
  db: AnyDb,
  kind: FeedKind,
  parentId: string,
  entryId: string,
  user: SessionUser,
): Promise<{ removed: string; _v: string | null }> {
  const table = feed(kind);
  const { log, index } = await locate(db, table, parentId, entryId, kind);

  assertMayModify(log[index], user);

  // ::int on both operands is load-bearing. `jsonb - integer` removes the
  // element at that index; `jsonb - text` removes a KEY, which on an array
  // matches nothing. A bound parameter arrives untyped, so without the cast
  // Postgres resolves the text overload and the statement silently does
  // nothing.
  const hit = await writeAtIndex(db, table, parentId, index, entryId, {
    activityLog: sql`${table.activityLog} - ${index}::int`,
  });

  if (!hit) {
    throw badRequest(
      "That entry moved while you were deleting it. Reload and try again.",
    );
  }

  return { removed: entryId, _v: await tokenFor(db, table, parentId) };
}

/* ------------------------------------------------------------------ shared */

/**
 * Writes to one entry, but only if that entry is STILL at the index we
 * resolved. Returns false if it moved.
 *
 * Both edit and delete go through here, and they must: the index comes from a
 * separate `locate()` read, and `appendActivity` PREPENDS, so any post landing
 * between the two statements shifts every index by one. Without the re-check
 * an edit rewrites a stranger's comment and a delete removes the wrong one —
 * silently, with no error and no trace.
 *
 * Exported so a test can drive it with a deliberately stale index. That is not
 * a convenience: PGlite runs on a single connection, so the interleaving
 * cannot be produced end-to-end through `editActivity`, and a test that
 * re-implements this SQL would prove the pattern works without proving
 * production uses it.
 */
export async function writeAtIndex(
  db: AnyDb,
  table: FeedTable,
  parentId: string,
  index: number,
  entryId: string,
  values: Record<string, unknown>,
): Promise<boolean> {
  const rows = await db
    .update(table)
    .set(values)
    .where(
      and(
        eq(table.id, parentId),
        eq(table.archived, false),
        sql`${table.activityLog} -> ${index}::int ->> 'id' = ${entryId}`,
      ),
    )
    .returning({ id: table.id });

  return rows.length > 0;
}

async function locate(
  db: AnyDb,
  table: FeedTable,
  parentId: string,
  entryId: string,
  kind: FeedKind,
): Promise<{ log: ActivityEntry[]; index: number }> {
  const [row] = await db
    .select({ activityLog: table.activityLog })
    .from(table)
    .where(and(eq(table.id, parentId), eq(table.archived, false)))
    .limit(1);

  if (!row) throw notFound(`That ${kind} no longer exists`);

  const log = (row.activityLog ?? []) as ActivityEntry[];
  const index = log.findIndex((e) => e?.id === entryId);
  if (index < 0) throw notFound("That entry no longer exists");

  return { log, index };
}

/**
 * Author or admin only.
 *
 * Matched on the stored `addedBy`, which is the display name written from the
 * session at post time. Two people sharing a display name would both pass, so
 * this is authorisation over a weak key — acceptable for editing a comment in
 * a 20-person internal tool, and noted rather than pretended away.
 */
function assertMayModify(entry: ActivityEntry, user: SessionUser): void {
  if (user.role === "admin") return;
  const author = entry.addedBy ?? "";
  if (author === user.name || author === user.username) return;
  throw forbidden("You can only change your own updates");
}

async function tokenFor(
  db: AnyDb,
  table: FeedTable,
  id: string,
): Promise<string | null> {
  const [row] = await db
    .select({ _v: vToken(table.updatedAt) })
    .from(table)
    .where(eq(table.id, id))
    .limit(1);
  return row?._v ?? null;
}
