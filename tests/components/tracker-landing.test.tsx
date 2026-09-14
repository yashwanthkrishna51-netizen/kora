// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { keys } from "@/lib/query/keys";
import { useUi } from "@/lib/store/ui";
import { TrackerLanding } from "@/components/tracker-landing";
import type { ClientSummary } from "@/lib/db/queries/clients";

/**
 * The redirect that decides whether anyone sees a tracker at all.
 *
 * UNTESTED UNTIL NOW, and it is the component in this app with the worst
 * history: three attempts, and a hydration race that left a first-time visitor
 * on a skeleton that never resolved. That bug was invisible to every other test
 * because it only appears on a browser with nothing stored — which is exactly
 * the state a test starts in, so it is exactly the state pinned here.
 *
 * `matchMedia` does not exist in jsdom and has to be supplied; the viewport is
 * the whole input to the decision.
 */

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
}));

function setViewport(hasRail: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: hasRail,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

const client = (
  id: string,
  // `counts` overridden field by field, so a fixture names only what it means.
  // An intersection with `Partial<ClientSummary>` would make `counts` both
  // partial and required; omitting it first is what keeps that honest.
  over: Omit<Partial<ClientSummary>, "counts"> & {
    counts?: Partial<ClientSummary["counts"]>;
  } = {},
): ClientSummary =>
  ({
    id,
    name: id,
    description: "",
    currency: "INR",
    masterAssignee: null,
    manDayRate: null,
    totalAvailableHours: null,
    hasImplementation: false,
    hasAms: false,
    _v: "1",
    integHealth: { total: 0, done: 0, wip: 0, risk: 0, stale: 0, overdue: 0 },
    ...over,
    counts: {
      integrations: 0,
      modules: 0,
      phases: 0,
      phasesSignedOff: 0,
      workLog: 0,
      ...over.counts,
    },
  }) as ClientSummary;

/** Alphabetically first is in the domain and empty — the real rail's shape. */
const CLIENTS: ClientSummary[] = [
  client("2x", { hasImplementation: true }),
  client("anand", { hasImplementation: true, counts: { modules: 3 } }),
  client("cactus", { hasImplementation: true, counts: { modules: 9 } }),
  client("ams_only", { hasAms: true, counts: { workLog: 4 } }),
  client("integ_only", { counts: { integrations: 2 } }),
];

function renderLanding(
  domain: "implementation" | "ams" | "integrations",
  rows: ClientSummary[] = CLIENTS,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.clients.list(), rows);
  return render(
    <QueryClientProvider client={qc}>
      <TrackerLanding domain={domain}>
        <p>the index</p>
      </TrackerLanding>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  useUi.setState({ lastClient: {} });
  setViewport(true);
});

describe("TrackerLanding", () => {
  it("opens the first client WITH WORK, not the first client", () => {
    // "2x" is in the domain and sorts first. Landing there is a blank matrix,
    // which is the chooser screen again in a different costume.
    renderLanding("implementation");
    expect(replace).toHaveBeenCalledWith("/implementation/anand");
  });

  it("reopens where you were", () => {
    useUi.setState({ lastClient: { implementation: "cactus" } });
    renderLanding("implementation");
    expect(replace).toHaveBeenCalledWith("/implementation/cactus");
  });

  it("reopens a remembered client even when it is empty", () => {
    useUi.setState({ lastClient: { implementation: "2x" } });
    renderLanding("implementation");
    expect(replace).toHaveBeenCalledWith("/implementation/2x");
  });

  it("falls back rather than redirecting to a client that is gone", () => {
    // A remembered id is a pointer into data that moves: the client can be
    // archived between visits, and localStorage may be weeks old.
    useUi.setState({ lastClient: { implementation: "archived_last_month" } });
    renderLanding("implementation");
    expect(replace).toHaveBeenCalledWith("/implementation/anand");
  });

  it("remembers each tracker separately", () => {
    useUi.setState({
      lastClient: { implementation: "cactus", ams: "ams_only" },
    });
    renderLanding("ams");
    expect(replace).toHaveBeenCalledWith("/ams/ams_only");
  });

  it("uses each domain's own membership rule", () => {
    renderLanding("integrations");
    // Not "2x": it has no integrations, and the Integrations rail hides it.
    expect(replace).toHaveBeenCalledWith("/integrations/integ_only");
  });

  it("shows the index below 768px, where the rail is hidden", () => {
    // The only client picker there is. A redirect would strand a phone on one
    // client, and the breadcrumb back would redirect again.
    setViewport(false);
    renderLanding("implementation");
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("the index")).toBeInTheDocument();
  });

  it("shows the index rather than hanging when the tracker is empty", () => {
    renderLanding("implementation", [client("nobody")]);
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByText("the index")).toBeInTheDocument();
  });

  it("renders a skeleton, not the index, while it is redirecting", () => {
    // The index must never flash: on a desktop it is a grid of every client,
    // one frame before it is replaced.
    renderLanding("implementation");
    expect(screen.queryByText("the index")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});
