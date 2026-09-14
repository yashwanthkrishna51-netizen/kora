import { eq, and, inArray, asc, desc, sql, getTableColumns } from "drizzle-orm";
import {
  clients,
  integrations,
  milestones,
  modules,
  phases,
  amsWorkLog,
} from "@/lib/db/schema";
import { toV1Shape } from "@/lib/db/inverse";
import { vToken } from "@/lib/db/occ";
import { qualify } from "@/lib/db/sql";
import type { AnyDb } from "@/lib/auth/db-types";
import type { Client } from "@/lib/domain/types";
import type { IntegHealth } from "@/lib/domain/integrations";
import { todayStr } from "@/lib/utils/dates";

/**
 * Client reads, from the v2 tables.
 *
 * This is the first code in the project to READ v2 — dual-write only ever
 * wrote there. Shaping back into the v1 camelCase structure goes through
 * lib/db/inverse.ts, the same function `migrate:verify` uses to prove the
 * migration was faithful. Sharing it means the API cannot disagree with the
 * thing that certified the data.
 *
 * Every query filters `archived = false`. Soft-deleted rows stay in the
 * database forever by design; the application must never see them.
 */

export interface ClientSummary {
  id: string;
  name: string;
  description: string;
  currency: string;
  masterAssignee: string | null;
  manDayRate: number | null;
  totalAvailableHours: number | null;
  hasImplementation: boolean;
  hasAms: boolean;
  /** Optimistic-concurrency token. */
  _v: string;
  counts: {
    integrations: number;
    modules: number;
    phases: number;
    /** Signed off, not merely Completed — see the subquery in `listClients`. */
    phasesSignedOff: number;
    workLog: number;
  };
  /**
   * Integration health for the rail's RAG dot and status bar (artboard 1c).
   *
   * Counts, not a RAG. The rail derives the letter with
   * `integRagFromHealth`, the same function the client screen reaches through
   * `integRagLabel` — so the dot next to a client's name and the pill on that
   * client's own page cannot disagree.
   */
  integHealth: IntegHealth;
}

const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * Client list with per-domain counts.
 *
 * The counts come from grouped subqueries rather than a query per client —
 * with 22 clients an N+1 would be 89 round trips through a pooled connection,
 * and the rail renders them all at once.
 */
export async function listClients(
  db: AnyDb,
  now: Date = new Date(),
): Promise<ClientSummary[]> {
  // The SAME "today" the JS health rules use. `todayStr` is UTC-derived — a
  // quirk ported deliberately from v1 (lib/utils/dates.ts) — while Postgres'
  // `current_date` follows the session TimeZone GUC. On an IST server the two
  // roll over five and a half hours apart, and the rail's RAG dot would
  // disagree with the pill on that client's own page every night. Binding the
  // date from JS also makes the query deterministic under a frozen clock,
  // which is the only way the test below can assert exact counts.
  const today = todayStr(now);

  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      description: clients.description,
      currency: clients.currency,
      masterAssignee: clients.masterAssignee,
      manDayRate: clients.manDayRate,
      totalAvailableHours: clients.totalAvailableHours,
      hasImplementation: clients.hasImplementation,
      hasAms: clients.hasAms,
      _v: vToken(clients.updatedAt),
      moduleCount: sql<number>`(
        select count(*)::int from ${modules} m
        where m.client_id = ${qualify(clients.id)} and m.archived = false)`,
      phaseCount: sql<number>`(
        select count(*)::int from ${phases} p
        where p.client_id = ${qualify(clients.id)} and p.archived = false)`,
      /**
       * Phases actually SIGNED OFF — the numerator behind the rail's progress
       * ring, and deliberately not `status = 'Completed'`.
       *
       * A sign-off phase needs a document attached to one of its updates before
       * it counts, which is what `canCompletePhase` enforces on every write and
       * what `phaseSignedOff` reports on the client's own screen. Counting
       * plain Completed here would give the rail a higher number than the
       * "N of M phases signed off" card on the screen it links to, and a rail
       * that disagrees with the page it opens is worse than no rail.
       *
       * Migrated v1 rows can be Completed with no document — v1 had no such
       * rule — so this is a real difference in the data, not a theoretical one.
       * `tests/api/read-paths.test.ts` diffs this count against the JS for
       * every client in the fixture, which is the same guard `integHealth` got
       * when it moved into SQL.
       *
       * `->> 'storagePath'` mirrors `u.attachment?.storagePath` exactly: an
       * attachment object with no path is not evidence, and `->>` yields the
       * empty string rather than NULL for `{"storagePath": ""}`, hence nullif.
       */
      phasesSignedOff: sql<number>`(
        select count(*)::int from ${phases} p
        where p.client_id = ${qualify(clients.id)}
          and p.archived = false
          and p.status = 'Completed'
          and (
            p.phase_name not in ('BPU Signoff', 'CRP Signoff', 'UAT Signoff')
            or exists (
              select 1
              from jsonb_array_elements(coalesce(p.activity_log, '[]'::jsonb)) e
              where nullif(e -> 'attachment' ->> 'storagePath', '') is not null
            )
          ))`,
      workLogCount: sql<number>`(
        select count(*)::int from ${amsWorkLog} w
        where w.client_id = ${qualify(clients.id)} and w.archived = false)`,
      /**
       * Integration health, in ONE pass rather than four.
       *
       * `counts.integrations` is fed from this same `total` rather than its own
       * subquery, so the number under a client's name and the width of its
       * status bar cannot drift apart.
       *
       * `risk` folds At Risk and overdue together deliberately: the RAG has
       * always treated them as one condition, and two separate counts would
       * double-count the integration that is both.
       *
       * Staleness reads `activity_log -> 0` because entries are prepended, so
       * element 0 is newest — the same assumption `lastUpdateDate()` makes,
       * not a new one. `<= today - 7` matches `isStale`'s `d >= days`.
       *
       * The two guards on that date are where a naive translation diverges
       * from the JS, in opposite directions:
       *   - `nullif(…, '')` — `->>` yields the empty string, not NULL, for
       *     `{"date": ""}`, and `''::date` raises 22007 mid-query. JS reads
       *     the same value as falsy and calls it stale. Without this, one bad
       *     row takes down the whole client list.
       *   - the shape test — a malformed date makes `daysDiff` return null and
       *     `isStale` return false; bare `::date` would throw instead.
       * Neither case exists in today's data. Both are one line to prevent.
       */
      integHealth: sql<IntegHealth>`(
        select json_build_object(
          'total', count(*)::int,
          'done', (count(*) filter (where i.status = 'Completed'))::int,
          'risk', (count(*) filter (
            where i.status = 'At Risk'
               or (i.status <> 'Completed'
                   and i.due_date is not null
                   and i.due_date < ${today}::date)))::int,
          'stale', (count(*) filter (
            where i.status <> 'Completed'
              and (
                nullif(i.activity_log -> 0 ->> 'date', '') is null
                or (
                  i.activity_log -> 0 ->> 'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                  and (i.activity_log -> 0 ->> 'date')::date <= ${today}::date - 7
                )
              )))::int)
        from ${integrations} i
        where i.client_id = ${qualify(clients.id)} and i.archived = false)`,
    })
    .from(clients)
    .where(eq(clients.archived, false))
    .orderBy(asc(clients.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    currency: r.currency,
    masterAssignee: r.masterAssignee,
    manDayRate: num(r.manDayRate),
    totalAvailableHours: num(r.totalAvailableHours),
    hasImplementation: r.hasImplementation,
    hasAms: r.hasAms,
    _v: r._v,
    counts: {
      // Same selected value as integHealth.total, by construction.
      integrations: r.integHealth.total,
      modules: r.moduleCount,
      phases: r.phaseCount,
      phasesSignedOff: r.phasesSignedOff,
      workLog: r.workLogCount,
    },
    integHealth: r.integHealth,
  }));
}

export interface ArchivedClient {
  id: string;
  name: string;
  archivedAt: string | null;
  archivedBy: string | null;
  /** Whether restoring would collide with a live client of the same name. */
  nameTaken: boolean;
}

/**
 * Archived clients, for the admin restore list.
 *
 * `POST /api/clients/[clientId]/restore` has existed since step 11 and has
 * been unreachable from a browser the whole time, because nothing could tell
 * you WHICH clients were archived — the only way to call it was to already
 * know an id. Soft delete without a way back is just delete with extra steps.
 *
 * `nameTaken` is computed here rather than discovered on failure: migration
 * 0004's unique index is on active rows only, so a name freed by archiving can
 * be reused, and then the restore is refused. Surfacing that in the list means
 * the button can be disabled with a reason instead of erroring on click.
 */
export async function listArchivedClients(db: AnyDb): Promise<ArchivedClient[]> {
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      archivedAt: clients.archivedAt,
      archivedBy: clients.archivedBy,
      nameTaken: sql<boolean>`exists (
        select 1 from ${clients} live
        where live.archived = false
          and lower(trim(live.name)) = lower(trim(${qualify(clients.name)})))`,
    })
    .from(clients)
    .where(eq(clients.archived, true))
    .orderBy(desc(clients.archivedAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    archivedAt: r.archivedAt,
    archivedBy: r.archivedBy,
    nameTaken: r.nameTaken,
  }));
}

/** A client DTO: the v1 shape the frontend expects, plus its OCC token. */
export type ClientTree = Client & { _v: string };

/**
 * Full nested tree for one or all clients.
 *
 * Six queries total regardless of how many clients are asked for — one per
 * table, assembled in memory — rather than walking the tree per client. At
 * 702 phases the difference is the whole response time.
 *
 * Attachment URLs are NOT signed here; the caller does that once for the whole
 * payload so the signing round trip is shared.
 */
export async function getClientTrees(
  db: AnyDb,
  clientIds?: string[],
): Promise<ClientTree[]> {
  const active = <T extends { archived: unknown; clientId?: unknown }>(
    table: T,
  ) =>
    clientIds
      ? and(
          eq(table.archived as never, false),
          inArray(table.clientId as never, clientIds),
        )
      : eq(table.archived as never, false);

  const clientWhere = clientIds
    ? and(eq(clients.archived, false), inArray(clients.id, clientIds))
    : eq(clients.archived, false);

  const [cRows, iRows, msRows, mRows, pRows, wRows] = await Promise.all([
    db
      .select({ ...getTableColumns(clients), _v: vToken(clients.updatedAt) })
      .from(clients)
      .where(clientWhere)
      .orderBy(asc(clients.name)),
    // Children carry their own `_v` too. Every child PATCH and DELETE runs
    // requireIfMatch before it does anything else, so a tree without these
    // tokens is a tree whose contents cannot be edited at all — the read path
    // and the write path were each self-consistent and did not agree.
    db
      .select({ ...getTableColumns(integrations), _v: vToken(integrations.updatedAt) })
      .from(integrations)
      .where(active(integrations)),
    db
      .select({ ...getTableColumns(milestones), _v: vToken(milestones.updatedAt) })
      .from(milestones)
      .where(active(milestones)),
    db
      .select({ ...getTableColumns(modules), _v: vToken(modules.updatedAt) })
      .from(modules)
      .where(active(modules)),
    db
      .select({ ...getTableColumns(phases), _v: vToken(phases.updatedAt) })
      .from(phases)
      .where(active(phases)),
    db
      .select({ ...getTableColumns(amsWorkLog), _v: vToken(amsWorkLog.updatedAt) })
      .from(amsWorkLog)
      .where(active(amsWorkLog)),
  ]);

  // id -> token, for re-attaching after shaping. `toV1Shape` builds its output
  // from an explicit field whitelist, so anything not named there is dropped —
  // and it must stay that way, because verify.ts compares its result against
  // the v1 jsonb, which has no `_v` to compare to. So the token rides alongside
  // rather than through.
  // KEYED BY KIND AND ID, not id alone. Every `id` column is a PER-TABLE
  // primary key, and the migration preserves v1 ids verbatim — where an id only
  // ever had to be unique inside one client's jsonb array. A milestone sharing
  // an id with a module would take the other's `updated_at`, and that row's
  // next PATCH would send a token that can never match: a permanent 409 loop,
  // presented to the user as "someone else saved this first", which is untrue
  // and never clears.
  const tokens = new Map<string, string>();
  const put = (kind: string, rows: unknown[]) => {
    for (const r of rows as { id: string; _v: string }[]) {
      tokens.set(`${kind}:${r.id}`, r._v);
    }
  };
  put("integration", iRows);
  put("milestone", msRows);
  put("module", mRows);
  put("phase", pRows);
  put("workLog", wRows);

  const withV =
    (kind: string) =>
    <T extends { id: string }>(node: T) => ({
      ...node,
      _v: tokens.get(`${kind}:${node.id}`),
    });

  // Bucket the children by client once, so assembly is linear rather than a
  // filter pass per client per table.
  const bucket = <T extends { clientId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.clientId);
      if (list) list.push(r);
      else m.set(r.clientId, [r]);
    }
    return m;
  };

  const byClient = {
    integrations: bucket(iRows),
    milestones: bucket(msRows),
    modules: bucket(mRows),
    phases: bucket(pRows),
    workLog: bucket(wRows),
  };

  return cRows.map((c) => {
    const shaped = toV1Shape({
      client: c as unknown as Record<string, unknown>,
      integrations: (byClient.integrations.get(c.id) ??
        []) as unknown as Record<string, unknown>[],
      milestones: (byClient.milestones.get(c.id) ??
        []) as unknown as Record<string, unknown>[],
      modules: (byClient.modules.get(c.id) ??
        []) as unknown as Record<string, unknown>[],
      phases: (byClient.phases.get(c.id) ??
        []) as unknown as Record<string, unknown>[],
      workLog: (byClient.workLog.get(c.id) ??
        []) as unknown as Record<string, unknown>[],
    });

    // `_v` is the row's updated_at and is what a later PATCH must echo back in
    // If-Match. It is deliberately not part of the v1 shape, so it is attached
    // here rather than inside the shared shaping function — for the client and
    // for every entity beneath it.
    return {
      ...shaped,
      _v: c._v,
      integrations: shaped.integrations?.map((i) => ({
        ...withV("integration")(i),
        milestones: i.milestones?.map(withV("milestone")),
      })),
      // `modules` and `workLog` are sentinel keys: present only when the client
      // is in that domain. Mapping a missing one would create it as `[]` and
      // quietly move the client into a domain it is not in — the exact
      // distinction migration 0003 exists to preserve.
      ...(shaped.modules
        ? {
            modules: shaped.modules.map((m) => ({
              ...withV("module")(m),
              phases: m.phases?.map(withV("phase")),
            })),
          }
        : {}),
      ...(shaped.workLog ? { workLog: shaped.workLog.map(withV("workLog")) } : {}),
    };
  });
}

export async function getClientTree(
  db: AnyDb,
  clientId: string,
): Promise<ClientTree | null> {
  const [tree] = await getClientTrees(db, [clientId]);
  return tree ?? null;
}
