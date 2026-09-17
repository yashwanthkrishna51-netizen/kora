import { describe, it, expect } from "vitest";
import { inTracker, hasTrackerWork, trackerHref } from "@/lib/domain/tracker";
import { pickLanding } from "@/lib/domain/integrations";

/**
 * Who belongs in which tracker.
 *
 * The rail, the index and the landing redirect all answer this question, and
 * they must answer it identically: a landing that keeps a client the rail drops
 * sends you to a screen the list beside it refuses to show. That is why the
 * rule is a function rather than three inline checks, and why it is pinned here
 * rather than only through whichever component happens to be rendered.
 *
 * The case that matters is the empty one. Six production clients are in a
 * domain with nothing in it yet — `hasImplementation` with zero modules — and
 * every count-based shortcut drops all six.
 */

const client = (over: Partial<Parameters<typeof inTracker>[1]> = {}) => ({
  counts: { integrations: 0 },
  ...over,
});

describe("inTracker", () => {
  it("reads Implementation and AMS from their flags, never from counts", () => {
    const empty = client({ hasImplementation: true, hasAms: true });
    expect(inTracker("implementation", empty)).toBe(true);
    expect(inTracker("ams", empty)).toBe(true);
  });

  it("keeps a client out of a domain it was never added to", () => {
    // Children without the flag do not confer membership either: the flag is
    // the question, and rows are not an answer to it.
    const busy = client({ counts: { integrations: 4 } });
    expect(inTracker("implementation", busy)).toBe(false);
    expect(inTracker("ams", busy)).toBe(false);
  });

  it("reads Integrations from presence, because it has no flag", () => {
    expect(
      inTracker("integrations", client({ counts: { integrations: 1 } })),
    ).toBe(true);
    expect(inTracker("integrations", client())).toBe(false);
    // The flags next door say nothing about this tracker.
    expect(
      inTracker(
        "integrations",
        client({ hasImplementation: true, hasAms: true }),
      ),
    ).toBe(false);
  });
});

describe("hasTrackerWork", () => {
  const counts = (over = {}) => ({
    integrations: 0,
    modules: 0,
    workLog: 0,
    ...over,
  });

  it("is not membership — a client can be in a tracker with nothing in it", () => {
    const c = { hasImplementation: true, counts: counts() };
    expect(inTracker("implementation", c)).toBe(true);
    expect(hasTrackerWork("implementation", c.counts)).toBe(false);
  });

  it("counts the right children per domain", () => {
    expect(hasTrackerWork("implementation", counts({ modules: 2 }))).toBe(true);
    expect(hasTrackerWork("implementation", counts({ workLog: 9 }))).toBe(
      false,
    );
    expect(hasTrackerWork("ams", counts({ workLog: 1 }))).toBe(true);
    expect(hasTrackerWork("ams", counts({ modules: 9 }))).toBe(false);
    expect(hasTrackerWork("integrations", counts({ integrations: 1 }))).toBe(
      true,
    );
  });
});

describe("the landing's choice, composed", () => {
  /**
   * The whole point of `withWork`: alphabetically first in the Implementation
   * rail is a client with zero modules, and opening its blank matrix is the
   * "choose a client" screen again in a different costume.
   */
  const rows = [
    {
      id: "2x",
      hasImplementation: true,
      counts: { integrations: 0, modules: 0, workLog: 0 },
    },
    {
      id: "anand",
      hasImplementation: true,
      counts: { integrations: 0, modules: 3, workLog: 0 },
    },
    {
      id: "cactus",
      hasImplementation: true,
      counts: { integrations: 0, modules: 9, workLog: 0 },
    },
    {
      id: "ams_only",
      hasAms: true,
      counts: { integrations: 0, modules: 0, workLog: 4 },
    },
  ];

  const ids = rows
    .filter((c) => inTracker("implementation", c))
    .map((c) => c.id);
  const withWork = rows
    .filter(
      (c) =>
        inTracker("implementation", c) &&
        hasTrackerWork("implementation", c.counts),
    )
    .map((c) => c.id);

  it("skips the empty client when nothing is remembered", () => {
    expect(ids).toEqual(["2x", "anand", "cactus"]);
    expect(pickLanding(undefined, withWork.length ? withWork : ids)).toBe(
      "anand",
    );
  });

  it("still reopens an empty client you were last in", () => {
    // `2x` is in `ids` but not in `withWork`; a remembered id is honoured from
    // the full list, and only the FALLBACK prefers a client with work.
    expect(pickLanding("2x", withWork.length ? withWork : ids)).toBe("anand");
    expect(pickLanding("2x", ids)).toBe("2x");
  });

  it("falls back to an empty client rather than nothing when all are empty", () => {
    const allEmpty = ["2x"];
    expect(pickLanding(undefined, allEmpty.length ? allEmpty : [])).toBe("2x");
  });

  it("never offers another domain's client", () => {
    expect(ids).not.toContain("ams_only");
  });
});

describe("trackerHref", () => {
  it("spells the route once for the rail and the redirect", () => {
    expect(trackerHref("implementation", "c2")).toBe("/implementation/c2");
    expect(trackerHref("ams", "c2")).toBe("/ams/c2");
    expect(trackerHref("integrations", "edge all three")).toBe(
      "/integrations/edge%20all%20three",
    );
  });
});
