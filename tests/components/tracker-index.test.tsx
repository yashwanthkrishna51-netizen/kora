// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { keys } from "@/lib/query/keys";
import { TrackerIndex } from "@/components/tracker-index";
import type { ClientTree } from "@/lib/db/queries/clients";

/**
 * Which clients a tracker index lists.
 *
 * THE REGRESSION THIS PINS: the Implementation and AMS indexes filtered on
 * `hasImplementation` / `hasAms`, which exist on `ClientSummary` and are ABSENT
 * from a tree — `toV1Shape` emits v1's field whitelist, which predates the
 * flags. Every client failed the test, and both screens said "No clients in
 * this tracker yet" above a rail listing twenty-two of them. Nothing threw and
 * nothing was logged.
 *
 * A tree says the same thing by KEY PRESENCE: `modules` present, even as `[]`,
 * means in the domain. So the fixtures below carry no flags at all — exactly
 * what the API returns — and a filter that reaches for one lists nothing.
 */

const tree = (over: Partial<ClientTree> & { id: string }): ClientTree =>
  ({
    name: over.id,
    _v: "1",
    integrations: [],
    ...over,
  }) as ClientTree;

const TREES: ClientTree[] = [
  // In Implementation with nothing in it yet — six production clients are in
  // this state, and a count-based filter would drop all six.
  tree({ id: "Empty impl", modules: [] }),
  tree({
    id: "Working impl",
    modules: [{ id: "m1", name: "Core HR", phases: [] }],
  }),
  // AMS only. It must not appear on the Implementation index.
  tree({ id: "Ams only", workLog: [] }),
];

function renderIndex(domain: "implementation" | "ams") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(keys.clients.tree(), TREES);
  return render(
    <QueryClientProvider client={qc}>
      <TrackerIndex domain={domain} />
    </QueryClientProvider>,
  );
}

describe("TrackerIndex domain membership", () => {
  it("lists a client in the domain even with no children", () => {
    renderIndex("implementation");
    expect(
      screen.getByText(
        "2 clients in this tracker. Choose one to see its detail.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Empty impl")).toBeInTheDocument();
    expect(screen.getByText("Working impl")).toBeInTheDocument();
    expect(screen.queryByText("Ams only")).not.toBeInTheDocument();
  });

  it("reads the other domain from its own sentinel key", () => {
    renderIndex("ams");
    expect(screen.getByText("Ams only")).toBeInTheDocument();
    expect(screen.queryByText("Empty impl")).not.toBeInTheDocument();
  });
});
