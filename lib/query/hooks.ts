"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  hashKey,
  notifyManager,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "@/lib/api/fetcher";
import { keys } from "./keys";
import type { ClientSummary, ClientTree } from "@/lib/db/queries/clients";
import type { UserOption, UserAdminView } from "@/lib/db/queries/users";
import type { SnapshotRow as DbSnapshotRow } from "@/lib/db/queries/misc";
import type {
  SnapshotRow as DomainSnapshotRow,
  CapacityWeights,
} from "@/lib/domain/dashboard";
import { DEFAULT_CAPACITY_WEIGHTS } from "@/lib/domain/constants";

/**
 * The read hooks every screen is built on.
 *
 * These import their types straight from the query modules that produce them
 * (`lib/db/queries/*`), so the wire contract is checked by the compiler rather
 * than restated. A hand-written `lib/types/api.ts` mirroring those shapes was
 * the original plan; it would be a second definition of the same thing, free
 * to drift, and drift here is silent — the JSON still parses, the field is just
 * `undefined`. That exact failure already cost this project once, when
 * `toV1Shape` read snake_case keys against camelCase rows and returned clients
 * with no modules, no work log and no dates, all structurally valid.
 *
 * Importing a server module's TYPES into client code is free: `import type` is
 * erased at compile time, so no query builder or database driver reaches the
 * browser bundle.
 */

/* ------------------------------------------------------------------ clients */

/**
 * Every client, fully nested — the shape the dashboard and all four trackers
 * aggregate over.
 *
 * ONE query serves all of them, deliberately. The old app made a single `read`
 * call and computed every tile in the browser; keeping that shape means the
 * dashboard, the integrations rail and the AMS gauge share one cache entry and
 * one 60-second refetch instead of racing three overlapping requests. At 22
 * clients and 702 phases the payload is small enough that this is simply
 * cheaper than being clever.
 */
export function useClientTrees(): UseQueryResult<ClientTree[]> {
  return useQuery({
    queryKey: keys.clients.tree(),
    queryFn: () =>
      api<{ clients: ClientTree[]; signedAttachments: number }>(
        "/api/clients?view=tree",
      ).then((r) => r.clients),
    // THE HEAVIEST QUERY IN THE APP, and the only one that was still inheriting
    // the global 60s `refetchInterval` — `useSnapshots` and
    // `useCapacityWeights` both opted out. Measured at 95 kB, so every open tab
    // was pulling that once a minute forever, and each arrival re-ran every
    // dashboard aggregate over the whole portfolio because the array identity
    // changed. `refetchOnWindowFocus` still refreshes it when someone actually
    // comes back to the tab, which is when a stale number would matter.
    refetchInterval: false,
  });
}

/**
 * The list with per-domain counts, for the client rails.
 *
 * Separate from the tree because a rail needs 22 rows and four integers, and
 * making it wait on 702 phases would leave the most visible element on the
 * screen blank the longest.
 */
export function useClientList(): UseQueryResult<ClientSummary[]> {
  return useQuery({
    queryKey: keys.clients.list(),
    queryFn: () =>
      api<{ clients: ClientSummary[] }>("/api/clients").then((r) => r.clients),
  });
}

/**
 * One client's tree.
 *
 * `enabled` guards the undefined case rather than the caller branching around
 * the hook: hooks cannot be called conditionally, and every detail screen has a
 * moment before its route param resolves.
 */
export function useClient(
  clientId: string | undefined,
): UseQueryResult<ClientTree> {
  return useQuery({
    queryKey: keys.clients.one(clientId ?? ""),
    enabled: Boolean(clientId),
    // A full client tree, behind all five detail screens, and it was still
    // inheriting the global 60s interval — so every open tab re-pulled it every
    // minute and re-rendered the screen, which on a remote database is a round
    // trip per tab per minute for data that changes on human timescales.
    refetchInterval: false,
    queryFn: () =>
      api<{ client: ClientTree }>(
        `/api/clients/${encodeURIComponent(clientId!)}`,
      ).then((r) => r.client),
  });
}

/* -------------------------------------------------------------------- users */

/**
 * Users, for assignee labels and the admin table.
 *
 * The response is ROLE-SHAPED by the server: an admin receives lockout state
 * and email, everyone else receives four fields. The union type is therefore
 * the honest description of what arrives, and callers that want the admin
 * fields must narrow — which is the point. Typing this as `UserAdminView[]`
 * would let a viewer-facing screen reference `lockedUntil` and compile
 * cleanly, then render `undefined` in production.
 */
export function useUsers(): UseQueryResult<(UserOption | UserAdminView)[]> {
  return useQuery({
    queryKey: keys.users.list(),
    queryFn: () =>
      api<{ users: (UserOption | UserAdminView)[] }>("/api/users").then(
        (r) => r.users,
      ),
    // Names and roles change on the timescale of someone joining the company.
    staleTime: 5 * 60_000,
  });
}

/** A lookup from username to display name, which is what screens actually use. */
export function useUserNames(): Map<string, string> {
  const { data } = useUsers();
  return new Map((data ?? []).map((u) => [u.username, u.name]));
}

/* ------------------------------------------------ snapshots and settings */

/**
 * Portfolio snapshots, for the dashboard's trend arrows.
 *
 * MAPPED TO SNAKE_CASE ON THE WAY OUT, which looks wrong and is not. The
 * domain's `healthRows` reads `client_id` / `snapshot_date` / `overall_rag`,
 * because it is a verbatim port of the original, and the golden tests diff it
 * against that original over generated fixtures. Renaming its fields to match
 * this codebase's camelCase would mean editing the thing the golden test is
 * supposed to hold still.
 *
 * So the boundary converts, here, once. This is exactly the shape mismatch
 * that made `toV1Shape` return clients with no modules and no dates — snake
 * against camel, every lookup `undefined`, every result structurally valid and
 * empty. There it was silent because the reader took `any`. Here the two
 * interfaces genuinely differ, so leaving it unmapped is a type error rather
 * than a blank trend column.
 */
/** The oldest snapshot date the trend arrows can use: a fortnight back. */
function snapshotWindowStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().slice(0, 10);
}

export function useSnapshots(): UseQueryResult<DomainSnapshotRow[]> {
  return useQuery({
    queryKey: keys.snapshots.list(),
    queryFn: () =>
      // BOUNDED. The cron appends one row per client per night forever, and
      // this asked for all of history to draw one arrow per client. The trend
      // only ever compares the newest snapshot with the oldest in its window,
      // so a fortnight is all `healthRows` can use — and it keeps the payload
      // flat over time instead of growing without limit.
      api<{ rows: DbSnapshotRow[] }>(
        `/api/snapshots?from=${snapshotWindowStart()}`,
      ).then((r) =>
        r.rows.map((s) => ({
          client_id: s.clientId,
          snapshot_date: s.snapshotDate,
          overall_rag: s.overallRag,
        })),
      ),
    // Snapshots are written once a night. Re-fetching them every 60s asks the
    // database for yesterday's answer over and over.
    staleTime: 10 * 60_000,
    refetchInterval: false,
  });
}

/**
 * Capacity weights for the bandwidth tile.
 *
 * Falls back to the defaults rather than failing the tile: the setting is
 * optional, and a team-load chart that disappears because nobody configured a
 * weight is worse than one drawn with the documented defaults.
 */
export function useCapacityWeights(): CapacityWeights {
  const { data } = useQuery({
    queryKey: keys.settings.capacityWeights(),
    queryFn: () =>
      api<{ capacityWeights: Partial<CapacityWeights> }>(
        "/api/settings/capacity-weights",
      ).then((r) => r.capacityWeights),
    staleTime: 10 * 60_000,
    refetchInterval: false,
  });
  // MEMOIZED, and this one matters far more than it looks. The admin dashboard
  // lists `weights` in the dependency array of the memo that computes every
  // portfolio aggregate — healthRows, buildCriticalItems, teamBandwidth and
  // seven more, over the whole tree. Returning a fresh object here made that
  // dependency change on every render, so the memo never hit and all of it
  // re-ran on every keystroke, hover and poll.
  return useMemo(
    () => ({ ...DEFAULT_CAPACITY_WEIGHTS, ...(data ?? {}) }),
    [data],
  );
}

/* --------------------------------------------------------------- cache-only */

/**
 * Whatever is ALREADY cached, without creating the query — and THAT is the
 * distinction that matters, not merely without fetching it.
 *
 * These hooks used to be `useQuery({ enabled: false })`, which does not issue a
 * request but DOES build the cache entry: constructing a `QueryObserver` calls
 * `queryCache.build()`, so an empty query with `dataUpdatedAt: 0` appears the
 * moment the component renders. The breadcrumbs render in the app chrome, above
 * every route, so `["clients","list"]` and `["clients","one",id]` existed before
 * anything below had a chance to hydrate them.
 *
 * That quietly defeated server rendering. `HydrationBoundary` hydrates queries
 * it finds MISSING during render, but defers ones that already exist to an
 * effect — see its source: `newQueries` are hydrated inline, `existingQueries`
 * in a `useEffect`. So the order became: breadcrumb builds an empty query →
 * boundary sees it exists and defers → the rail mounts, finds no data, and
 * fetches → the hydrated data lands 80ms later, having been in the HTML all
 * along. Measured exactly that: `added` at t=3036 with no data, `fetch` at
 * t=3115, hydration `setState` at t=3120.
 *
 * Reading the cache through `useSyncExternalStore` creates nothing. The
 * subscription is filtered to one query hash so a breadcrumb does not re-render
 * on every event in the cache.
 *
 * THE NOTIFICATION IS BATCHED, and it has to be. Cache events fire
 * SYNCHRONOUSLY during another component's render — `HydrationBoundary`
 * hydrates in a `useMemo`, and building a query observer emits `added` while
 * the component that owns it is rendering. Calling `onStoreChange` straight
 * from there is a setState during someone else's render, which React reports as
 * "Cannot update a component (RouteBreadcrumbs) while rendering a different
 * component (HydrationBoundary)" and pays for with an extra render pass.
 * `notifyManager.batchCalls` is exactly what React Query's own `useBaseQuery`
 * wraps its subscriber in, for exactly this reason.
 */
function useCachedData<T>(queryKey: readonly unknown[]): T | undefined {
  const client = useQueryClient();
  const hash = hashKey(queryKey);

  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      client.getQueryCache().subscribe(
        notifyManager.batchCalls((event) => {
          if (event.query.queryHash === hash) onStoreChange();
        }),
      ),
    [client, hash],
  );

  return useSyncExternalStore(
    subscribe,
    // `getQueryData` returns `state.data` by reference, so this is stable
    // between changes, which is what useSyncExternalStore requires.
    () => client.getQueryData<T>(queryKey),
    // Server snapshot: nothing is cached during SSR, and the breadcrumb's
    // fallback is the id, which renders identically on both sides.
    () => undefined,
  );
}

/**
 * Client names from the cache, for the breadcrumbs.
 *
 * Returns an empty map until something else populates the cache, so callers
 * must have a fallback. On the tracker screens the layout has already
 * server-rendered the list and the name is there on first paint; on `/admin` it
 * stays empty and the breadcrumb keeps showing the id, which is correct — a
 * label is not worth a round trip.
 */
export function useCachedClientNames(): Map<string, string> {
  const data = useCachedData<ClientSummary[]>(keys.clients.list());
  return useMemo(
    () => new Map((data ?? []).map((c) => [c.id, c.name])),
    [data],
  );
}

/**
 * Names for the ids nested UNDER a client — integrations, modules — read from
 * that client's cached tree. Same contract: cache only, never a request.
 */
export function useCachedChildNames(
  clientId: string | undefined,
): Map<string, string> {
  const data = useCachedData<ClientTree>(keys.clients.one(clientId ?? ""));

  return useMemo(() => {
    const names = new Map<string, string>();
    for (const i of data?.integrations ?? []) names.set(i.id, i.name);
    for (const m of data?.modules ?? []) names.set(m.id, m.name);
    return names;
  }, [data]);
}
