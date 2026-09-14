"use client";

import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api/fetcher";
import { keys } from "./keys";
import type { ClientTree } from "@/lib/db/queries/clients";
import type { Client } from "@/lib/domain/types";

/**
 * Writes.
 *
 * v1 hand-rolled this 48 times, in five different styles — object spread, deep
 * JSON clone, array index + splice, a Map of old values, push/pop — and two of
 * those copies were broken. `bulk-mark-complete` had no rollback at all, so a
 * failed save left phases locally marked Completed forever; and every
 * `Object.assign(entity, prev)` rollback was silently inert on conflict,
 * because the save had already replaced that object in the array and the
 * handler was mutating an orphan.
 *
 * One factory, so those are one implementation to get right rather than 48.
 */

/* ------------------------------------------------------------------ shapes */

export type EntityKind =
  | "client"
  | "integration"
  | "milestone"
  | "module"
  | "phase"
  | "workLog";

/** A single field patch, as the API's `.strict()` schemas expect it. */
export type Patch = Record<string, unknown>;

/* ------------------------------------------------- snake_case normalisation */

/**
 * `current` on a 409 comes from `to_jsonb(<table>)`, so it carries the
 * DATABASE's column names — `man_day_rate`, `next_action`, `activity_log` —
 * while every success response comes from Drizzle in camelCase.
 *
 * Healing from it without converting re-creates the exact failure that made
 * `toV1Shape` return clients with no modules and no dates: every lookup returns
 * undefined, nothing throws, and the result is structurally valid and empty.
 *
 * SHALLOW, for the same reason the forward direction is: jsonb payloads
 * (activity_log entries, edit history) carry camelCase keys that are stored
 * data, and rewriting those would corrupt the values being recovered.
 */
export function camelKeys(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    // A LEADING underscore is left alone. `_v` is our own addition, not a
    // database column, and the naive rule turns it into `V` — which drops the
    // OCC token out of every conflict heal, silently, since the caller only
    // notices when the next save 428s for a missing precondition.
    out[
      k.startsWith("_")
        ? k
        : k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    ] = v;
  }
  return out;
}

/**
 * The fresh row a conflict wants us to heal from, or null.
 *
 * NOT every 409 carries one. The OCC conflicts do, but constraint violations
 * ("A client with that name already exists.", "That username is already
 * taken.") and the restore-name clash are also 409 and carry neither `code` nor
 * `current`. Reading `.current` off those blindly yields undefined and heals
 * the row into nothing.
 */
export function conflictRow(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof ApiError) || !error.isConflict) return null;
  const current = error.body.current;
  if (!current || typeof current !== "object") return null;
  return camelKeys(current as Record<string, unknown>);
}

/**
 * Is this failure "someone else got there first", whatever status it arrived as?
 *
 * The activity index-race is the reason this is a function rather than a
 * `status === 409` check: editing or deleting an entry whose position shifted
 * returns **400** with "That entry moved while you were editing it", because
 * the entry id no longer matches the index. It is a conflict in every sense
 * that matters to the person looking at the screen.
 */
export function isConflict(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.isConflict) return true;
  return error.status === 400 && /moved while you were/i.test(error.message);
}

/* --------------------------------------------------------- patch building */

/**
 * Only the fields that actually changed, and only from a whitelist.
 *
 * Two hazards this closes, both of which are 400s rather than anything subtle:
 *
 * EVERY SCHEMA IS `.strict()`. Round-tripping a fetched row back into a PATCH
 * fails on `id`, `_v`, `clientId`, `createdAt` — keys the read path adds and
 * the write path refuses. So fields are named explicitly rather than diffed
 * wholesale.
 *
 * AN EMPTY PATCH IS A 400, NOT A NO-OP (`lib/api/mutate.ts:71-76`). An inline
 * field that blurs without being edited must therefore send nothing at all.
 *
 * `undefined` means "not in this patch" and `null` means "clear this field",
 * so a field that is absent from `next` is skipped while one explicitly set to
 * null is sent.
 */
/**
 * The four columns Postgres stores as `numeric`.
 *
 * These are the ONLY fields that round-trip string↔number, and therefore the
 * only ones where a loose comparison is correct.
 *
 * The first version compared loosely on every field, which silently ate real
 * edits: renaming something from `"1"` to `"1.0"` (or `"01"`, or `"1e3"`, or
 * `false` to `0`) produced an empty patch, so nothing was sent, nothing was
 * shown, and the field closed as though it had saved. Cleverness in a
 * comparison is how an edit disappears without an error.
 */
const NUMERIC_FIELDS = new Set([
  "effortWeight",
  "hours",
  "manDayRate",
  "totalAvailableHours",
]);

export function buildPatch<T extends object>(
  before: T,
  // Keys are constrained to the entity; VALUES deliberately are not. A patch
  // sends `number` where the row holds a `string` (Postgres numeric), and
  // `null` to clear a field the row types as `string | undefined`. `Partial<T>`
  // would reject both — the two cases this function exists to handle.
  next: Partial<Record<keyof T, unknown>>,
  fields: readonly (keyof T)[],
): Patch {
  const patch: Patch = {};
  for (const f of fields) {
    if (!(f in next)) continue;
    const a = next[f];
    const b = before[f];
    if (a === b) continue;

    // An explicitly-undefined value is "not in this patch", the same as an
    // absent key. Emitting it makes `Object.keys` non-empty — so the caller's
    // empty-patch guard passes — while `JSON.stringify` drops it, producing a
    // request body of `{}` and the server's "Nothing to update".
    if (a === undefined) continue;

    if (
      NUMERIC_FIELDS.has(f as string) &&
      a != null &&
      b != null &&
      a !== "" &&
      b !== "" &&
      Number(a) === Number(b)
    ) {
      continue;
    }
    patch[f as string] = a;
  }
  return patch;
}

/* ------------------------------------------------- server row -> cache shape */

/**
 * The shape a PATCH response has to be put into before it can be merged.
 *
 * A mutation returns the RAW v2 row from Drizzle's `.returning()`. The cache
 * holds the v1 shape that `toV1Shape` produces. They differ in two ways that
 * both corrupt state silently on a SUCCESSFUL save:
 *
 * TYPES. `numeric` columns come back as strings while the tree holds numbers.
 * One status change on an integration was enough to flip cached `effortWeight`
 * from `0.5` to `"0.5"`; `teamBandwidth` then evaluates `total += "0.5"` twice
 * and gets `"00.50.5"` → `NaN`, so that person silently disappears from every
 * capacity bucket.
 *
 * NAMES. Three entities rename columns between the wire and the read shape:
 * a phase row carries `phaseName` where the tree reads `name`, and a work-log
 * row carries `entryType`/`editHistory` where the tree reads `type`/`edits`.
 * Merging raw leaves the key the UI actually reads at its old value — so the
 * screen shows the pre-save value after a save that worked.
 */
export function normaliseRow(
  kind: EntityKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...row };
  const num = (v: unknown) => (v === null || v === undefined ? v : Number(v));

  if (kind === "integration") out.effortWeight = num(out.effortWeight);
  if (kind === "client") {
    out.manDayRate = num(out.manDayRate);
    out.totalAvailableHours = num(out.totalAvailableHours);
  }
  if (kind === "phase" && "phaseName" in out) out.name = out.phaseName;
  if (kind === "workLog") {
    if ("entryType" in out) out.type = out.entryType;
    if ("editHistory" in out) out.edits = out.editHistory;
    out.hours = num(out.hours);
  }
  return out;
}

/* ---------------------------------------------------- optimistic tree edits */

type Mutator = (entity: Record<string, unknown>) => Record<string, unknown>;

/**
 * Apply `fn` to one entity wherever it appears in a client tree.
 *
 * Rebuilds along the path rather than mutating: React Query hands out the
 * cached object itself, and mutating it would change what other components
 * already rendered without telling React anything happened.
 */
function editTree(
  tree: ClientTree,
  kind: EntityKind,
  id: string,
  fn: Mutator,
): ClientTree {
  const as = (v: unknown) => v as Record<string, unknown>;
  const hit = (e: { id: string }) => e.id === id;

  if (kind === "client") {
    return tree.id === id ? (fn(as(tree)) as unknown as ClientTree) : tree;
  }

  // EVERY branch below checks the KIND before matching an id. Ids are only
  // unique within their own table — every `id` column is a per-table primary
  // key and the migration preserves v1 ids verbatim — so a milestone can share
  // an id with an integration. Matching on id alone would write an
  // integration's `{status: "In Progress"}` onto a milestone whose statuses are
  // Pending/Achieved/Missed.
  if (kind === "integration") {
    return {
      ...tree,
      integrations: tree.integrations?.map((i) =>
        hit(i) ? (fn(as(i)) as unknown as typeof i) : i,
      ),
    };
  }

  if (kind === "milestone") {
    return {
      ...tree,
      integrations: tree.integrations?.map((i) => ({
        ...i,
        milestones: i.milestones?.map((m) =>
          hit(m) ? (fn(as(m)) as unknown as typeof m) : m,
        ),
      })),
    };
  }

  // `modules` and `workLog` are sentinel keys — present only when the client is
  // in that domain. Mapping a missing one would create it as `[]` and move the
  // client into a domain it is not in.
  if (kind === "module") {
    if (!tree.modules) return tree;
    return {
      ...tree,
      modules: tree.modules.map((m) =>
        hit(m) ? (fn(as(m)) as unknown as typeof m) : m,
      ),
    };
  }

  if (kind === "phase") {
    if (!tree.modules) return tree;
    return {
      ...tree,
      modules: tree.modules.map((m) => ({
        ...m,
        phases: m.phases?.map((p) =>
          hit(p) ? (fn(as(p)) as unknown as typeof p) : p,
        ),
      })),
    };
  }

  if (kind === "workLog") {
    if (!tree.workLog) return tree;
    return {
      ...tree,
      workLog: tree.workLog.map((w) =>
        hit(w) ? (fn(as(w)) as unknown as typeof w) : w,
      ),
    };
  }

  // Exhaustive today. Written as a real branch rather than a fallthrough so a
  // seventh EntityKind is a compile error here instead of silently landing in
  // whichever branch happens to be last.
  const exhaustive: never = kind;
  void exhaustive;
  return tree;
}

/** Apply an edit to every cache entry holding this client. */
function editCaches(
  qc: QueryClient,
  clientId: string,
  kind: EntityKind,
  id: string,
  fn: Mutator,
) {
  qc.setQueryData<ClientTree[]>(keys.clients.tree(), (trees) =>
    trees?.map((t) => (t.id === clientId ? editTree(t, kind, id, fn) : t)),
  );
  qc.setQueryData<ClientTree>(keys.clients.one(clientId), (t) =>
    t ? editTree(t, kind, id, fn) : t,
  );

  // The rail reads a different query. Without this, renaming a client updates
  // the detail pane and leaves the old name in the list beside it until the
  // next refetch — the one place the name is most visible.
  if (kind === "client") {
    qc.setQueryData<Record<string, unknown>[]>(keys.clients.list(), (rows) =>
      rows?.map((r) => (r.id === id ? fn(r) : r)),
    );
  }
}

/* ------------------------------------------------------------ the factory */

interface UpdateArgs {
  /** The entity's current OCC token. Sent as If-Match. */
  version: string;
  patch: Patch;
}

/**
 * PATCH one entity, optimistically.
 *
 * `onFailure` REPORTS THE ERROR, and it lives on the hook rather than being
 * passed to each `mutate()` call. React Query skips per-call callbacks when the
 * observer has no listeners (`mutationObserver.js`: `this.#mutateOptions &&
 * this.hasListeners()`), and the optimistic update can itself unmount the row
 * that owns them — filter a table to one status, change a row out of that
 * filter, and the row is gone before the write settles. The first version put
 * the toast there, so the entire error path was unreachable on exactly the
 * flows most likely to fail: the row silently reappeared with its old value and
 * nothing was ever shown.
 */
export function useUpdateEntity(
  kind: EntityKind,
  clientId: string,
  id: string,
  opts: {
    path: string;
    screen?: string;
    /** Always runs, even if the component that started the write is gone. */
    onFailure?: (error: unknown) => void;
  },
) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ version, patch }: UpdateArgs) =>
      api<Record<string, unknown>>(opts.path, {
        method: "PATCH",
        body: patch,
        ifMatch: version,
        screen: opts.screen,
      }),

    async onMutate({ patch }) {
      // Stop in-flight refetches from landing on top of the optimistic edit
      // and reverting it a moment later.
      await qc.cancelQueries({ queryKey: keys.clients.all });

      // SNAPSHOT ONE ENTITY, not the cache. The first version stored every
      // query under ["clients"] and restored all of it on failure, so a failing
      // edit reverted a DIFFERENT row's already-committed change. Worse, when
      // two writes failed, the one settling last restored a snapshot containing
      // the other's optimistic value — leaving a value the server had rejected
      // on screen with nothing to explain it.
      let before: Record<string, unknown> | undefined;
      editCaches(qc, clientId, kind, id, (e) => {
        before ??= e;
        return { ...e, ...patch };
      });
      return { before };
    },

    onError(err, _vars, ctx) {
      if (ctx?.before) {
        const restore = ctx.before;
        editCaches(qc, clientId, kind, id, () => restore);
      }
      opts.onFailure?.(err);
    },

    onSuccess(row) {
      // Take the server's row, not the optimistic guess: `updated_at` has
      // advanced and a trigger may have touched something the client never
      // sent. Normalised first — the raw v2 row has different types and, for
      // three entities, different key names than the cached v1 shape.
      editCaches(qc, clientId, kind, id, (e) => ({
        ...e,
        ...normaliseRow(kind, row),
      }));
    },

    onSettled(_data, error) {
      // ONLY on failure. `onSuccess` has already written the authoritative row,
      // so invalidating there refetches the full tree — 702 phases — for
      // nothing, and a refetch landing over another edit still in flight makes
      // that field visibly flip new → old → new.
      //
      // On failure it is worth it: the local state is a guess about why the
      // write was rejected, and the server's answer settles it.
      if (error) void qc.invalidateQueries({ queryKey: keys.clients.all });
    },
  });
}

/** POST a child entity. No If-Match — a create has no prior version. */
export function useCreateEntity<TInput>(
  opts: { path: string; screen?: string },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) =>
      api<Record<string, unknown>>(opts.path, {
        method: "POST",
        body: input,
        screen: opts.screen,
      }),
    // Deliberately NOT optimistic: the server mints the id, and a create needs
    // a real row before anything can link to it.
    onSuccess() {
      void qc.invalidateQueries({ queryKey: keys.clients.all });
    },
  });
}

/** DELETE (soft — the server archives). If-Match required, like any write. */
export function useArchiveEntity(
  opts: { path: string; screen?: string },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) =>
      api<Record<string, unknown>>(opts.path, {
        method: "DELETE",
        ifMatch: version,
        screen: opts.screen,
      }),
    onSuccess() {
      void qc.invalidateQueries({ queryKey: keys.clients.all });
    },
  });
}

export type { Client };
