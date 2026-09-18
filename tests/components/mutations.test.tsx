// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  camelKeys,
  conflictRow,
  isConflict,
  buildPatch,
  useUpdateEntity,
} from "@/lib/query/mutations";
import { ConflictCard } from "@/components/ui/conflict-card";
import { ApiError } from "@/lib/api/fetcher";
import { keys } from "@/lib/query/keys";
import type { ClientTree } from "@/lib/db/queries/clients";

/**
 * The write machinery.
 *
 * Each case here is a hazard that was found by reading the server contract, not
 * one imagined afterwards — the snake_case `current`, the 409 with nothing to
 * heal from, the conflict that arrives as a 400, and the empty patch that is an
 * error rather than a no-op.
 */

/* ------------------------------------------------------------ pure helpers */

describe("camelKeys", () => {
  it("converts the database's column names to the API's", () => {
    expect(
      camelKeys({ man_day_rate: "8000", has_ams: true, next_action: "call" }),
    ).toEqual({ manDayRate: "8000", hasAms: true, nextAction: "call" });
  });

  it("leaves jsonb payload keys alone, because they are stored data", () => {
    // activity_log entries carry camelCase keys that ARE the data. The forward
    // mapper is shallow for this reason and so is this one.
    const activity = [{ addedBy: "Meera", storagePath: "a.pdf" }];
    const out = camelKeys({ activity_log: activity });
    expect(out.activityLog).toBe(activity);
    expect((out.activityLog as typeof activity)[0].addedBy).toBe("Meera");
  });
});

describe("conflictRow", () => {
  it("returns the fresh row, normalised", () => {
    const err = new ApiError(409, "Someone else changed this", {
      code: "conflict",
      current: { id: "c1", man_day_rate: "9000", _v: "2026-09-02T10:00:00.000000Z" },
    });
    expect(conflictRow(err)).toEqual({
      id: "c1",
      manDayRate: "9000",
      _v: "2026-09-02T10:00:00.000000Z",
    });
  });

  it("returns null for a 409 that carries NOTHING to heal from", () => {
    // Constraint violations are 409 too and have no `current`. Reading
    // `.current` off one blindly would heal the row into undefined.
    const err = new ApiError(409, "A client with that name already exists.", {});
    expect(conflictRow(err)).toBeNull();
  });

  it("returns null for anything that is not a conflict", () => {
    expect(conflictRow(new ApiError(404, "Gone", {}))).toBeNull();
    expect(conflictRow(new Error("boom"))).toBeNull();
  });
});

describe("isConflict", () => {
  it("treats the activity index-race as a conflict even though it is a 400", () => {
    const err = new ApiError(
      400,
      "That entry moved while you were editing it. Reload and try again.",
      {},
    );
    expect(err.isConflict).toBe(false); // it really is a 400
    expect(isConflict(err)).toBe(true); // and it really is a conflict
  });

  it("does not treat ordinary 400s as conflicts", () => {
    expect(isConflict(new ApiError(400, "Name is required", {}))).toBe(false);
  });
});

describe("buildPatch", () => {
  const before = { name: "Aster", assignee: "Kavya", manDayRate: "8000" };

  it("sends only what changed", () => {
    expect(buildPatch(before, { name: "Aster Retail" }, ["name", "assignee"]))
      .toEqual({ name: "Aster Retail" });
  });

  it("returns an EMPTY patch when nothing changed, so the caller can skip", () => {
    // An empty PATCH body is a 400 from the server, not a no-op — an inline
    // field that blurs unedited must send nothing at all.
    expect(buildPatch(before, { name: "Aster" }, ["name"])).toEqual({});
  });

  it("does not re-send a number that only changed type", () => {
    // Numerics go out as `number` and come back as `string` (Postgres numeric).
    // A strict compare would make every save re-send every number.
    expect(buildPatch(before, { manDayRate: 8000 }, ["manDayRate"])).toEqual({});
  });

  it("keeps null distinct from absent", () => {
    // undefined = "not in this patch"; null = "clear this field".
    expect(buildPatch(before, { assignee: null }, ["assignee"]))
      .toEqual({ assignee: null });
    expect(buildPatch(before, {}, ["assignee"])).toEqual({});
  });

  it("iterates the whitelist, so an extra key is structurally unreachable", () => {
    // Named honestly. `buildPatch` loops over `fields`, so keys outside it are
    // never even looked at — this documents the design, it cannot fail. The
    // real protection is that every schema is `.strict()` server-side.
    const patch = buildPatch(
      before,
      { name: "New", id: "c1", _v: "x" } as never,
      ["name"],
    );
    expect(Object.keys(patch)).toEqual(["name"]);
  });
});

/* ------------------------------------------------- optimistic update + rollback */

const TREE = {
  id: "c1",
  name: "Aster Retail",
  _v: "2026-09-01T10:00:00.000000Z",
  integrations: [
    { id: "i1", name: "Payroll sync", status: "In Progress", _v: "2026-09-01T10:00:00.000000Z" },
  ],
} as unknown as ClientTree;

function harness() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  qc.setQueryData(keys.clients.one("c1"), TREE);
  qc.setQueryData(keys.clients.tree(), [TREE]);

  function Probe() {
    const m = useUpdateEntity("integration", "c1", "i1", {
      path: "/api/integrations/i1",
    });
    return (
      <button
        onClick={() =>
          m.mutate({ version: "2026-09-01T10:00:00.000000Z", patch: { status: "Completed" } })
        }
      >
        save
      </button>
    );
  }

  render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );

  const statusOf = () =>
    (qc.getQueryData(keys.clients.one("c1")) as ClientTree | undefined)
      ?.integrations?.[0]?.status;

  return { qc, statusOf, save: () => fireEvent.click(screen.getByText("save")) };
}

describe("useUpdateEntity", () => {
  beforeEach(() => {
    vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends If-Match, and takes the SERVER's row on success", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        // effortWeight comes back as a string; the optimistic guess said nothing
        // about it. Taking the server's row is what keeps the two in step.
        JSON.stringify({ id: "i1", status: "Completed", effortWeight: "0.5" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const { qc, statusOf, save } = harness();
    save();

    await waitFor(() => expect(statusOf()).toBe("Completed"));

    // THE ASSERTION THIS TEST WAS MISSING. The mock returns effortWeight as a
    // string on purpose — that is what Drizzle gives back for a `numeric`
    // column — and the original only checked `status`, which onMutate had
    // already written. Deleting onSuccess entirely left it green, and this is
    // the line that would have caught the raw-row merge corrupting the cache.
    const integ = (qc.getQueryData(keys.clients.one("c1")) as ClientTree)
      .integrations?.[0] as unknown as { effortWeight: unknown };
    expect(integ.effortWeight).toBe(0.5);
    expect(typeof integ.effortWeight).toBe("number");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init?.headers as Record<string, string>)["if-match"]).toBe(
      "2026-09-01T10:00:00.000000Z",
    );
    expect(init?.method).toBe("PATCH");
  });

  it("applies the edit optimistically, then ROLLS IT BACK when the write fails", async () => {
    let release: (r: Response) => void = () => {};
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((res) => {
        release = res;
      }),
    );

    const { qc, statusOf, save } = harness();
    expect(statusOf()).toBe("In Progress");

    save();
    // Optimistic: visible before the server has answered anything.
    await waitFor(() => expect(statusOf()).toBe("Completed"));

    release(
      new Response(JSON.stringify({ error: "Someone else changed this", code: "conflict" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    await waitFor(() => expect(statusOf()).toBe("In Progress"));

    // BOTH cache entries, not just `one()`. A rollback that restored the detail
    // pane and left the list stale would have passed the original assertion.
    const fromTree = (qc.getQueryData(keys.clients.tree()) as ClientTree[])[0]
      .integrations?.[0]?.status;
    expect(fromTree).toBe("In Progress");
  });
});

/* --------------------------------------------------------- the conflict card */

describe("ConflictCard", () => {
  const conflict = new ApiError(409, "Someone else changed this while you were editing it.", {
    code: "conflict",
    current: { id: "i1", status: "At Risk", _v: "2026-09-02T11:00:00.000000Z" },
  });

  it("renders nothing when the error is not a conflict", () => {
    const { container } = render(
      <ConflictCard error={new ApiError(404, "Gone", {})} onReload={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a reload, and diffs the draft against what was saved", () => {
    render(
      <ConflictCard
        error={conflict}
        onReload={() => {}}
        draft={{ status: "Completed" }}
      />,
    );

    expect(screen.getByText("Someone else saved this record first")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show what changed" }));
    expect(screen.getByText("Completed")).toBeInTheDocument(); // yours
    expect(screen.getByText("At Risk")).toBeInTheDocument(); // theirs
  });

  it("lists only the fields that actually differ", () => {
    // The draft carries two fields and only one of them changed. With a
    // single-key draft the filter is never exercised and could be deleted.
    render(
      <ConflictCard
        error={conflict}
        onReload={() => {}}
        draft={{ status: "Completed", id: "i1" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show what changed" }));
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.queryByText("Id")).toBeNull();
  });

  it("degrades to the message for a 409 with nothing to heal from", () => {
    // A duplicate-name violation is a 409 with no `current`. Offering "Reload
    // record" there would be a lie — there is no newer version to pick up.
    render(
      <ConflictCard
        error={new ApiError(409, "A client with that name already exists.", {})}
        onReload={() => {}}
      />,
    );
    expect(
      screen.getByText("A client with that name already exists."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload record" })).toBeNull();
  });
});
