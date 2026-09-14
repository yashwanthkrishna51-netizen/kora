/**
 * Query keys, in one place.
 *
 * Every key is a function returning a tuple, so an invalidation can be as
 * broad or as narrow as it needs to be: `keys.clients.all` matches the list
 * and every tree, `keys.clients.tree()` matches only the tree.
 *
 * This exists as its own module because step 15's mutations invalidate against
 * it. Keys written inline at each call site drift — one screen says
 * `["clients"]` and another `["clients", "list"]`, the mutation invalidates the
 * first, and the second silently serves stale data until the 60-second refetch
 * hides the bug. That failure is invisible in development, where everything is
 * fast and nothing is stale for long.
 */

export const keys = {
  clients: {
    /** Broad prefix — invalidating this refetches the list AND every tree. */
    all: ["clients"] as const,
    list: () => ["clients", "list"] as const,
    tree: () => ["clients", "tree"] as const,
    one: (clientId: string) => ["clients", "one", clientId] as const,
  },
  users: {
    all: ["users"] as const,
    list: () => ["users", "list"] as const,
  },
  snapshots: {
    all: ["snapshots"] as const,
    list: () => ["snapshots", "list"] as const,
  },
  audit: {
    all: ["audit"] as const,
    page: (params: Record<string, string | number | undefined>) =>
      ["audit", "page", params] as const,
  },
  settings: {
    all: ["settings"] as const,
    capacityWeights: () => ["settings", "capacity-weights"] as const,
    digestRecipients: () => ["settings", "digest-recipients"] as const,
  },
} as const;
