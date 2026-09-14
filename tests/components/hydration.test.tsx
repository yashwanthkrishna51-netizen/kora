// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  HydrationBoundary,
  dehydrate,
} from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import {
  useCachedClientNames,
  useCachedChildNames,
  useClientList,
} from "@/lib/query/hooks";
import { keys } from "@/lib/query/keys";
import { CommandPalette } from "@/components/command-palette";
import type { ClientSummary } from "@/lib/db/queries/clients";

/**
 * Server-rendered data must survive the app chrome.
 *
 * These are the regression tests for a bug that cost a whole round trip on
 * every navigation and was invisible from the outside: the screen rendered, the
 * data was correct, it was simply fetched again over HTTP having already
 * arrived in the HTML.
 *
 * The cause was ordering. `HydrationBoundary` hydrates queries it finds MISSING
 * during render and defers ones that already exist to an effect. The
 * breadcrumbs — which render above every route — used `useQuery({ enabled:
 * false })` to read cached names, and constructing a QueryObserver calls
 * `queryCache.build()`, so the entry existed, empty, before any boundary below
 * could hydrate it. Every consumer then mounted against an empty cache and
 * fetched.
 *
 * Nothing about that is visible in a screenshot, which is why it is pinned
 * here.
 */

const CLIENTS: ClientSummary[] = [
  {
    id: "c1",
    name: "Cactus & Life Sciences",
    description: null,
    currency: "INR",
    masterAssignee: null,
    manDayRate: null,
    totalAvailableHours: null,
    hasImplementation: true,
    hasAms: true,
    _v: "2026-01-01T00:00:00.000000Z",
    moduleCount: 2,
    phaseCount: 9,
    workLogCount: 0,
    integHealth: { total: 0, done: 0, risk: 0, stale: 0 },
    counts: { integrations: 0, implementation: 2, ams: 0 },
  } as unknown as ClientSummary,
];

function wrap(client: QueryClient, ui: React.ReactNode) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

afterEach(() => vi.restoreAllMocks());

describe("cache-only hooks", () => {
  it("does NOT create a cache entry for the client list", () => {
    const client = new QueryClient();
    function Breadcrumb() {
      useCachedClientNames();
      return <span>crumb</span>;
    }
    render(wrap(client, <Breadcrumb />));

    // The assertion the whole design rests on. `useQuery({ enabled: false })`
    // would leave an empty query here, and an empty query is what makes
    // HydrationBoundary defer.
    expect(client.getQueryCache().find({ queryKey: keys.clients.list() })).toBeUndefined();
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("does NOT create a cache entry for a client's tree", () => {
    const client = new QueryClient();
    function Breadcrumb() {
      useCachedChildNames("c1");
      return <span>crumb</span>;
    }
    render(wrap(client, <Breadcrumb />));

    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("still reads whatever another screen has already cached", () => {
    const client = new QueryClient();
    client.setQueryData(keys.clients.list(), CLIENTS);

    function Breadcrumb() {
      const names = useCachedClientNames();
      return <span>{names.get("c1") ?? "c1"}</span>;
    }
    render(wrap(client, <Breadcrumb />));

    expect(screen.getByText("Cactus & Life Sciences")).toBeInTheDocument();
  });

  it("falls back to nothing when the cache is empty, without fetching", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const client = new QueryClient();

    function Breadcrumb() {
      const names = useCachedClientNames();
      return <span>{names.get("c1") ?? "c1"}</span>;
    }
    render(wrap(client, <Breadcrumb />));

    expect(screen.getByText("c1")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the command palette", () => {
  it("creates no cache entries while it is closed", () => {
    const client = new QueryClient();
    render(wrap(client, <CommandPalette open={false} onOpenChange={() => {}} />));

    // It renders in the app chrome, above every route. `enabled: false` on its
    // three queries stopped the requests but still built the entries, which is
    // what made every screen below it hydrate late — see the note at the top.
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe("server-rendered data reaches the screen without a request", () => {
  it("hydrates during render even when the chrome above it read the cache", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // What the server produced.
    const server = new QueryClient();
    server.setQueryData(keys.clients.list(), CLIENTS);
    const state = dehydrate(server);

    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });

    function Chrome({ children }: { children: React.ReactNode }) {
      // The breadcrumb, rendering ABOVE the boundary — the exact ordering that
      // used to defeat hydration.
      useCachedClientNames();
      return <>{children}</>;
    }

    function Rail() {
      const q = useClientList();
      return <span>{q.data ? q.data[0].name : "loading"}</span>;
    }

    render(
      wrap(
        client,
        <Chrome>
          <HydrationBoundary state={state}>
            <Rail />
          </HydrationBoundary>
        </Chrome>,
      ),
    );

    // Present on the FIRST paint, not after an effect — that is the difference
    // between arriving with the document and arriving a round trip later.
    expect(screen.getByText("Cactus & Life Sciences")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not notify the chrome while another component is rendering", () => {
    // The shape that produces it in the app: the breadcrumbs are ALREADY
    // subscribed to a client's tree when you navigate to another client, and
    // the new page's HydrationBoundary hydrates during render. Cache events are
    // synchronous, so an unbatched subscriber calls setState on the breadcrumbs
    // mid-render — "Cannot update a component (RouteBreadcrumbs) while
    // rendering a different component (HydrationBoundary)", plus an extra
    // render pass every navigation. Mounting and hydrating in one pass does not
    // reproduce it, because nothing is subscribed yet; this mounts first.
    const errors: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });

    const server = new QueryClient();
    server.setQueryData(keys.clients.one("c1"), { id: "c1", integrations: [], modules: [] });
    const state = dehydrate(server);

    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: 30_000, retry: false } },
    });

    function Breadcrumbs() {
      useCachedChildNames("c1");
      return <span>crumb</span>;
    }
    function Body() {
      return <span>body</span>;
    }

    // 1. The chrome mounts and subscribes. Nothing is in the cache.
    const { rerender } = render(
      wrap(
        client,
        <>
          <Breadcrumbs />
          <Body />
        </>,
      ),
    );
    expect(client.getQueryCache().getAll()).toHaveLength(0);

    // 2. Navigation: a boundary appears below it and hydrates during render.
    rerender(
      wrap(
        client,
        <>
          <Breadcrumbs />
          <HydrationBoundary state={state}>
            <Body />
          </HydrationBoundary>
        </>,
      ),
    );

    expect(client.getQueryData(keys.clients.one("c1"))).toBeDefined();
    expect(errors.join("\n")).not.toContain("Cannot update a component");
  });
});
