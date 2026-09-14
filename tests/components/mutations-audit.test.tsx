// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  buildPatch,
  camelKeys,
  useUpdateEntity,
  normaliseRow,
} from "@/lib/query/mutations";
import { InlineText } from "@/components/ui/inline";
import { keys } from "@/lib/query/keys";
import type { ClientTree } from "@/lib/db/queries/clients";

/**
 * Regression tests for defects an adversarial audit found in the first cut of
 * the mutation layer.
 *
 * Every one of these failed before the corresponding fix. They exist because
 * the ORIGINAL tests passed while the bugs were live — several of them set up
 * exactly the condition that would have caught the defect and then asserted
 * something weaker. Where that happened it is named in the test.
 */

const TREE = {
  id: "c1",
  name: "Aster Retail",
  _v: "2026-09-01T10:00:00.000000Z",
  integrations: [
    {
      id: "i1",
      name: "Payroll sync",
      status: "In Progress",
      assignee: "Kavya",
      effortWeight: 0.5,
      _v: "2026-09-01T10:00:00.000000Z",
    },
    {
      id: "i2",
      name: "Leave sync",
      status: "Not Started",
      assignee: "Priya",
      effortWeight: 1,
      _v: "2026-09-01T10:00:00.000000Z",
    },
  ],
} as unknown as ClientTree;

function fresh() {
  return JSON.parse(JSON.stringify(TREE)) as ClientTree;
}

function makeClient() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(keys.clients.one("c1"), fresh());
  qc.setQueryData(keys.clients.tree(), [fresh()]);
  return qc;
}

const integOf = (qc: QueryClient, id: string) =>
  (qc.getQueryData(keys.clients.one("c1")) as ClientTree | undefined)
    ?.integrations?.find((i) => i.id === id) as
    | Record<string, unknown>
    | undefined;

beforeEach(() => void vi.spyOn(globalThis, "fetch"));
afterEach(() => vi.restoreAllMocks());

/* ------------------------------------------------------------------- A4 */

describe("A4 — buildPatch must not eat a real edit", () => {
  it("sends a text change that merely LOOKS numeric", () => {
    // The loose numeric compare was meant for the four `numeric` columns and
    // applied to every field. "1" -> "1.0" was skipped: no request, no toast,
    // no revert, and the user believed it saved.
    const before = { name: "1", hours: "2" };
    expect(buildPatch(before, { name: "1.0" }, ["name"])).toEqual({ name: "1.0" });
    expect(buildPatch(before, { name: "01" }, ["name"])).toEqual({ name: "01" });
    expect(buildPatch(before, { name: "1e3" }, ["name"])).toEqual({ name: "1e3" });
  });

  it("still skips a numeric FIELD that only changed type", () => {
    // The behaviour worth keeping: `numeric` columns round-trip string↔number,
    // and a strict compare would re-send every one of them on every save.
    const before = { effortWeight: "0.5", hours: "6.5", manDayRate: "8000" };
    expect(buildPatch(before, { effortWeight: 0.5 }, ["effortWeight"])).toEqual({});
    expect(buildPatch(before, { hours: 6.5 }, ["hours"])).toEqual({});
    expect(buildPatch(before, { manDayRate: 8000 }, ["manDayRate"])).toEqual({});
    // ...but a real numeric change is still sent.
    expect(buildPatch(before, { hours: 7 }, ["hours"])).toEqual({ hours: 7 });
  });

  it("never emits a key whose value is undefined", () => {
    // `{a: undefined}` has length 1, so the caller's empty-patch guard passes,
    // but JSON.stringify drops it -> `{}` -> the server's "Nothing to update".
    const patch = buildPatch({ assignee: "Kavya" }, { assignee: undefined }, [
      "assignee",
    ]);
    expect(Object.keys(patch)).toEqual([]);
    expect(JSON.stringify(patch)).toBe("{}");
  });
});

/* ------------------------------------------------------------------- A3 */

describe("A3 — the server row must be normalised before it enters the cache", () => {
  it("keeps effortWeight a number after a successful integration PATCH", () => {
    // `numeric` comes back from Drizzle as a string while the tree holds a
    // number. Merging raw made teamBandwidth do "0.5" + "0.5" = "00.50.5",
    // which is NaN — and that person vanished from every capacity bucket.
    const row = { id: "i1", status: "Completed", effortWeight: "0.5" };
    expect(normaliseRow("integration", row).effortWeight).toBe(0.5);
  });

  it("maps the renamed work-log keys back to what the UI reads", () => {
    // The wire sends `type`; the column is `entry_type`; Drizzle returns
    // `entryType`; the tree read calls it `type`. Merging raw leaves the
    // UI-read key stale after a SUCCESSFUL save.
    const row = { id: "w1", entryType: "Enhancement", hours: "6.5" };
    const out = normaliseRow("workLog", row);
    expect(out.type).toBe("Enhancement");
    expect(out.hours).toBe(6.5);
  });

  it("maps phaseName back to name", () => {
    expect(normaliseRow("phase", { id: "p1", phaseName: "BPU" }).name).toBe("BPU");
  });
});

/* ------------------------------------------------------------------- A1 */

describe("A1 — a failed write must not revert an unrelated successful one", () => {
  it("rolls back only the row it patched", async () => {
    const qc = makeClient();

    function Probe() {
      const a = useUpdateEntity("integration", "c1", "i1", {
        path: "/api/integrations/i1",
      });
      const b = useUpdateEntity("integration", "c1", "i2", {
        path: "/api/integrations/i2",
      });
      return (
        <>
          <button
            onClick={() =>
              a.mutate({ version: TREE._v!, patch: { status: "Completed" } })
            }
          >
            a
          </button>
          <button
            onClick={() =>
              b.mutate({ version: TREE._v!, patch: { status: "At Risk" } })
            }
          >
            b
          </button>
        </>
      );
    }

    // B succeeds; A fails. A's rollback must not touch i2.
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes("i2")) {
        return Promise.resolve(
          new Response(JSON.stringify({ id: "i2", status: "At Risk" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
      );
    });

    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByText("a"));
    fireEvent.click(screen.getByText("b"));

    await waitFor(() => expect(integOf(qc, "i1")?.status).toBe("In Progress"));
    // The whole-prefix snapshot restored i2 to its pre-edit value too.
    expect(integOf(qc, "i2")?.status).toBe("At Risk");
  });
});

/* ------------------------------------------------------------------- A2 */

describe("A2 — a failure must be reported even if the row unmounts", () => {
  it("reports from the hook, not from per-call options", async () => {
    // React Query skips per-call callbacks when the observer has no listeners
    // (query-core mutationObserver: `this.#mutateOptions && this.hasListeners()`).
    // The optimistic update itself can unmount the row — filter to one status,
    // change a row out of that filter — so the error path was unreachable on
    // exactly the flows most likely to fail.
    const onFailure = vi.fn();
    const qc = makeClient();

    function Probe({ show }: { show: boolean }) {
      const m = useUpdateEntity("integration", "c1", "i1", {
        path: "/api/integrations/i1",
        onFailure,
      });
      if (!show) return null;
      return (
        <button
          onClick={() =>
            m.mutate({ version: TREE._v!, patch: { status: "Completed" } })
          }
        >
          save
        </button>
      );
    }

    let release: (r: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((res) => {
        release = res;
      }),
    );

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <Probe show />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("save"));

    // The row goes away while the write is still in flight.
    rerender(
      <QueryClientProvider client={qc}>
        <Probe show={false} />
      </QueryClientProvider>,
    );

    release(
      new Response(JSON.stringify({ error: "Someone else changed this" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    await waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
  });
});

/* ------------------------------------------------------------------- A5 */

describe("A5 — a stale draft must not be committed against a fresh token", () => {
  it("sends the token captured when editing began, so a lost update becomes a 409", async () => {
    // The draft is deliberately not resynced, but `version` was a prop and
    // refreshed every render. Click in, let a refetch land someone else's
    // change plus a new _v, click out: the old value went up with THEIR token,
    // the server accepted it, and their edit was silently reverted with no 409
    // and no conflict card. That defeats the entire OCC mechanism.
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: "i1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const qc = makeClient();
    const OLD = "2026-09-01T10:00:00.000000Z";
    const NEW = "2026-09-02T10:00:00.000000Z";

    function Probe({ version, value }: { version: string; value: string }) {
      return (
        <InlineText
          target={{
            kind: "integration",
            clientId: "c1",
            id: "i1",
            path: "/api/integrations/i1",
          }}
          field="assignee"
          label="Assignee"
          value={value}
          version={version}
          before={{ assignee: value }}
        />
      );
    }

    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <Probe version={OLD} value="Kavya" />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Assignee/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Meera" } });

    // Someone else's change lands mid-edit, with a new token.
    rerender(
      <QueryClientProvider client={qc}>
        <Probe version={NEW} value="Priya" />
      </QueryClientProvider>,
    );

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)["if-match"]).toBe(OLD);
  });
});

/* ------------------------------------------------------------------ A10 */

describe("camelKeys — the rule its own comment is most emphatic about", () => {
  it("leaves a leading underscore alone", () => {
    // The naive rule turned `_v` into `V`, dropping the OCC token out of every
    // heal. Covered only incidentally before.
    expect(camelKeys({ _v: "t", man_day_rate: "1" })).toEqual({
      _v: "t",
      manDayRate: "1",
    });
  });
});
