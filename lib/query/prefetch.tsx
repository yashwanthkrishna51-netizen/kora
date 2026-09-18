import { cache } from "react";
import {
  QueryClient,
  HydrationBoundary,
  dehydrate,
  defaultShouldDehydrateQuery,
  hashKey,
  type FetchQueryOptions,
} from "@tanstack/react-query";
import { keys } from "./keys";
import {
  loadClientList,
  loadClientTree,
  loadClientTrees,
  loadUsers,
} from "@/lib/server/loaders";
import type { ClientSummary, ClientTree } from "@/lib/db/queries/clients";
import type { UserOption, UserAdminView } from "@/lib/db/queries/users";
import { TimingMeta } from "@/lib/server/timing";

/**
 * Server-rendering the data, instead of shipping an empty shell that then goes
 * and asks for it.
 *
 * SERVER ONLY — importing this from a `"use client"` file drags the database
 * driver into the browser bundle. There is no `server-only` package here to
 * enforce it, so this comment is the enforcement.
 *
 * ## What was wrong
 *
 * Nothing in this app was server-rendered with data: `HydrationBoundary`,
 * `dehydrate` and `prefetchQuery` appeared nowhere. Every `page.tsx` returned a
 * client component with a route param and no data, so one navigation was two
 * full browser round trips in series:
 *
 *   browser → Vercel        RSC/HTML          (+ session validated)
 *   browser ← Vercel        an empty shell
 *   browser: parse, hydrate, mount, effect
 *   browser → Vercel        /api/clients/[id] (+ session validated AGAIN)
 *           Vercel → Supabase
 *   browser ← Vercel        the data
 *
 * On localhost the database legs are 3ms and the whole thing hides. Against a
 * pooled remote Postgres they are not, and they are strictly serial: the
 * browser cannot start the second trip until the first has arrived, parsed and
 * hydrated.
 *
 * ## What this does
 *
 * The server already holds a database handle while it renders. `Hydrate` runs
 * the query there, dehydrates the result into the RSC payload, and the client
 * hook — UNCHANGED, still `useQuery` — finds it already in cache on its first
 * render. No skeleton, no fetch-after-hydrate, and the second round trip is not
 * made faster, it is not made at all.
 *
 * ## Why one component rather than a prefetch call plus a boundary
 *
 * Because the request-scoped `QueryClient` is shared by the layout and the page
 * below it, a bare `dehydrate(client)` in each would send the layout's queries
 * twice. `Hydrate` dehydrates exactly the queries IT was given, so a boundary
 * can never re-send data an ancestor already sent, and a soft navigation
 * between two clients ships one client tree rather than a tree plus a fresh
 * copy of the rail and the user list.
 */

/**
 * One `QueryClient` per request, and never one per module.
 *
 * `cache()` scopes it to the request, so the tracker layout and the page inside
 * it share a cache: the rail's client list is fetched once even though two
 * `Hydrate` boundaries ask for it. A module-level client would be shared across
 * every user of the server at once — one person's client tree served to the
 * next person who asked.
 */
const requestQueryClient = cache(
  () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          // Matches the browser's default in components/providers.tsx. It has
          // to: hydrated data carries its `dataUpdatedAt`, and if the browser
          // considered it stale on arrival it would immediately refetch over
          // HTTP — reintroducing the exact round trip this file removes.
          staleTime: 30_000,
        },
      },
    }),
);

/**
 * A query as `Hydrate` needs it: a key and a function, with the result type
 * erased so one array can hold several of them.
 *
 * `FetchQueryOptions<T>` is INVARIANT in `T` — `staleTime` may be a function
 * that takes the query — so an array of the precisely-typed builders below does
 * not typecheck as `FetchQueryOptions[]`. Erasing here rather than widening the
 * builders keeps the check where it is worth having: each builder still
 * declares what its loader must return, so a change to a wire shape fails at
 * the builder rather than silently at the screen.
 */
export type PrefetchQuery = Pick<
  FetchQueryOptions<unknown, Error, unknown, readonly unknown[]>,
  "queryKey" | "queryFn"
>;

/**
 * Prefetch on the server, hand the result to the client cache, render children.
 *
 * A failed prefetch is not an error: `prefetchQuery` never throws, the failure
 * is simply not dehydrated, and the browser falls back to fetching the query
 * itself and showing the real message. A database blip degrades this to the
 * behaviour of the day before it was written.
 */
export async function Hydrate({
  queries,
  children,
}: {
  queries: PrefetchQuery[];
  children: React.ReactNode;
}) {
  const client = requestQueryClient();
  await Promise.all(queries.map((q) => client.prefetchQuery(q)));

  const mine = new Set(queries.map((q) => hashKey(q.queryKey!)));
  const state = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      mine.has(query.queryHash) && defaultShouldDehydrateQuery(query),
  });

  return (
    <HydrationBoundary state={state}>
      <TimingMeta />
      {children}
    </HydrationBoundary>
  );
}

/**
 * A query whose value the page ALREADY HAS.
 *
 * For the case where a server page needs the data for itself — a count, a
 * redirect decision — and would otherwise run the identical query twice: once
 * for its own use and once for the prefetch. The key still comes from the
 * builder below, so there is no second place that knows it.
 */
export function resolved<T>(
  query: FetchQueryOptions<T, Error, T, readonly unknown[]>,
  data: T,
): PrefetchQuery {
  return { queryKey: query.queryKey, queryFn: async () => data };
}

/* ------------------------------------------------------------------ queries */
/**
 * The server twin of each hook in `lib/query/hooks.ts`.
 *
 * Key and selector are duplicated from the hook deliberately and minimally: the
 * key comes from the same `keys` module, and the selector is the same one-line
 * `.clients` / `.client` pick, against a loader that returns the route's exact
 * body. If the wire shape changes, the compiler fails here.
 */

/** Feeds `useClientList` — the client rails. */
export function clientListQuery(): FetchQueryOptions<ClientSummary[]> {
  return {
    queryKey: keys.clients.list(),
    queryFn: () => loadClientList().then((r) => r.clients),
  };
}

/** Feeds `useClientTrees` — the dashboard and the three tracker indexes. */
export function clientTreesQuery(): FetchQueryOptions<ClientTree[]> {
  return {
    queryKey: keys.clients.tree(),
    queryFn: () => loadClientTrees().then((r) => r.clients),
  };
}

/**
 * Feeds `useClient` — all five detail screens.
 *
 * An unknown id THROWS rather than caching a null. Nothing is dehydrated, the
 * browser asks the route, and the user gets the route's own 404 message
 * instead of a screen that renders empty and explains nothing.
 */
export function clientTreeQuery(clientId: string): FetchQueryOptions<ClientTree> {
  return {
    queryKey: keys.clients.one(clientId),
    queryFn: async () => {
      const { client } = await loadClientTree(clientId);
      if (!client) throw new Error("Client not found");
      return client;
    },
  };
}

/** Feeds `useUsers`, and through it every assignee dropdown in every table. */
export function usersQuery(
  role: string,
): FetchQueryOptions<(UserOption | UserAdminView)[]> {
  return {
    queryKey: keys.users.list(),
    queryFn: () => loadUsers(role).then((r) => r.users),
  };
}
