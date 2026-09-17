import { describe, it, expect } from "vitest";
import {
  pickLanding,
  sortIntegrations,
  sortIntegWorstFirst,
  effortLabel,
  inIntegrationsTracker,
} from "@/lib/domain/integrations";
import type { Integration } from "@/lib/domain/types";

/**
 * `pickLanding` decides what a tracker opens on when nothing was asked for.
 *
 * It is four lines and it is tested because the interesting case is the one
 * nobody hits in development: the remembered id points at something that has
 * since been archived. On a fresh seed the remembered id is always valid, so a
 * version that simply trusted it would look perfect locally and land a real
 * user on an empty screen weeks later.
 */
describe("pickLanding", () => {
  const ids = ["c3", "c1", "c2"];

  it("returns where you were when it is still there", () => {
    expect(pickLanding("c2", ids)).toBe("c2");
  });

  it("falls back to the first when the remembered row has gone", () => {
    // The archived-client case. NOT sorted — the caller decides the order, and
    // the integrations table is deliberately worst-first, not alphabetical.
    expect(pickLanding("c9", ids)).toBe("c3");
  });

  it("falls back to the first when nothing was remembered", () => {
    expect(pickLanding(undefined, ids)).toBe("c3");
  });

  it("returns undefined when there is nothing to select", () => {
    // A client with no integrations, or a tracker with no clients. The caller
    // must render an empty state rather than a panel.
    expect(pickLanding("c1", [])).toBeUndefined();
    expect(pickLanding(undefined, [])).toBeUndefined();
  });

  it("does not treat an empty string as a selection", () => {
    expect(pickLanding("", ids)).toBe("c3");
  });
});

/**
 * `sortIntegrations` — the list's order under the sort control.
 *
 * The cases worth writing down are the ones a naive implementation gets wrong:
 * undated rows in a date sort, and ties. Ties matter more than they look: a
 * sort that leaves equal rows to the engine is stable per run but not per
 * dataset, so re-filtering would reshuffle them under the reader's cursor.
 */
describe("sortIntegrations", () => {
  const integ = (over: Partial<Integration> & { name: string }): Integration =>
    ({ id: over.name, status: "Not Started", ...over }) as Integration;

  const rows: Integration[] = [
    integ({ name: "Zulu", status: "Completed", dueDate: "2026-01-01" }),
    integ({ name: "Alpha", status: "In Progress" }),
    integ({ name: "Mike", status: "In Progress", dueDate: "2026-03-01" }),
    integ({ name: "Bravo", status: "Not Started", dueDate: "2026-02-01" }),
  ];

  const names = (mode: Parameters<typeof sortIntegrations>[1]) =>
    sortIntegrations(rows, mode).map((i) => i.name);

  it("sorts by name", () => {
    expect(names("name")).toEqual(["Alpha", "Bravo", "Mike", "Zulu"]);
  });

  it("sorts by due date, soonest first, with undated rows LAST", () => {
    // Not first. An empty date sorting as the epoch would stack every undated
    // row at the top of a list whose whole job is "what needs attention".
    expect(names("due")).toEqual(["Zulu", "Bravo", "Mike", "Alpha"]);
  });

  it("sorts by status in STATUSES order, not alphabetically", () => {
    // Alphabetically "Completed" would come first; canonically it is last.
    expect(names("status")).toEqual(["Bravo", "Alpha", "Mike", "Zulu"]);
  });

  it("breaks every tie on name, so the order is total", () => {
    const tied = [
      integ({ name: "Beta", status: "In Progress" }),
      integ({ name: "Alpha", status: "In Progress" }),
    ];
    expect(sortIntegrations(tied, "status").map((i) => i.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(sortIntegrations(tied, "due").map((i) => i.name)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("delegates `worst` rather than reimplementing the ranking", () => {
    const now = new Date("2026-02-15T00:00:00Z");
    expect(sortIntegrations(rows, "worst", now)).toEqual(
      sortIntegWorstFirst(rows, now),
    );
  });

  it("does not mutate the array it is given", () => {
    const before = rows.map((i) => i.name);
    sortIntegrations(rows, "name");
    expect(rows.map((i) => i.name)).toEqual(before);
  });
});

/** The effort scale the panel offers. */
describe("effortLabel", () => {
  it("names the four steps", () => {
    expect(effortLabel(0.25)).toBe("Light — 0.25");
    expect(effortLabel(0.5)).toBe("Medium — 0.5");
    expect(effortLabel(1)).toBe("Heavy — 1");
    expect(effortLabel(2)).toBe("Very heavy — 2");
  });

  it("shows an unlisted weight as itself rather than snapping it", () => {
    // Nothing constrains the column, so rows outside the four exist. Rounding
    // one to the nearest step would silently move someone's capacity numbers.
    expect(effortLabel(0.75)).toBe("0.75");
  });

  it("renders an absent weight as a dash", () => {
    expect(effortLabel(undefined)).toBe("—");
  });
});

/**
 * `inIntegrationsTracker` — who the Integrations rail lists.
 *
 * The rule is trivial; the reason it is a named function is not. The rail, the
 * `/integrations` index and the landing redirect all apply it, and if they
 * disagree the app redirects you to a client the list refuses to show. The last
 * case below is that bug, written as a test.
 */
describe("inIntegrationsTracker", () => {
  it("lists a client once it has one", () => {
    expect(inIntegrationsTracker(1)).toBe(true);
    expect(inIntegrationsTracker(9)).toBe(true);
  });

  it("drops a client with none", () => {
    expect(inIntegrationsTracker(0)).toBe(false);
  });

  it("never sends the landing to a client the rail hides", () => {
    // The composition that matters. `counts.integrations` comes straight from
    // SQL and excludes archived rows, so "Anand" here is a client whose
    // integrations were all archived — exactly what the redirect used to pick,
    // because it is alphabetically first.
    const clients = [
      { id: "anand", count: 0 },
      { id: "aster", count: 0 },
      { id: "c0", count: 5 },
      { id: "c1", count: 4 },
    ];
    const listed = clients
      .filter((c) => inIntegrationsTracker(c.count))
      .map((c) => c.id);

    expect(pickLanding(undefined, listed)).toBe("c0");
    // A remembered client that has since emptied falls through rather than
    // opening a screen with nothing on it.
    expect(pickLanding("anand", listed)).toBe("c0");
    expect(pickLanding("c1", listed)).toBe("c1");
  });

  it("leaves nothing to select when no client has any", () => {
    const listed = [{ count: 0 }, { count: 0 }]
      .filter((c) => inIntegrationsTracker(c.count))
      .map(() => "x");
    expect(pickLanding(undefined, listed)).toBeUndefined();
  });
});
