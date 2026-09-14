import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { makeClients } from "./fixtures";
import {
  buildCriticalItems, healthRows, portfolioScore, upcomingDeadlines,
  hygieneScore, severityDistribution, blockers, teamBandwidth,
  updatesInWindow, workMixByType, allIntegrations, openAmsEntries,
} from "@/lib/domain/dashboard";
import { phaseFunnel } from "@/lib/domain/implementation";
import { PHASES, AMS_QUERY_LEVELS, DEFAULT_CAPACITY_WEIGHTS } from "@/lib/domain/constants";
import {
  isOverdue as refIsOverdue,
  isStale as refIsStale,
  daysOverdue as refDaysOverdue,
  lastUpdateDate as refLastUpdateDate,
} from "@/lib/domain/integrations";
import { entryDate, entryRaisedBy } from "@/lib/domain/ams";
import { daysDiff } from "@/lib/utils/dates";
import type { Client } from "@/lib/domain/types";

/**
 * Golden master for the dashboard aggregations.
 *
 * These could not be covered the usual way. `tests/golden/legacy.ts` proves a
 * port by extracting the ORIGINAL named function out of `js/*.js` and running
 * both over the same fixtures — but every tile's maths lives inline inside
 * `renderDashboard()`, interleaved with template strings. There is no function
 * to extract.
 *
 * So the reference implementations below are TRANSCRIBED from that inline code,
 * one block at a time, deliberately keeping its shape — `forEach` over `for`,
 * the same fallbacks, the same string comparisons — so the two read side by
 * side against the original. They are reviewed once and then fixed.
 *
 * This is weaker than extraction: a transcription error is invisible, whereas
 * an extraction cannot drift. It is the strongest thing available short of
 * refactoring the old app, and it is what would have caught `phaseFunnel`
 * being ported as "not Completed and not Not Started" when the original counts
 * only In Progress and At Risk — a difference of six statuses that went
 * unnoticed until the frontend was about to render it.
 *
 * Transcription sources are cited per function. If you change a port, change
 * nothing here: re-read the cited lines instead.
 */

const FROZEN = new Date("2026-08-31T12:00:00.000Z");

/* =================================================== reference impls === */

/**
 * The per-item PRIMITIVES are imported, not transcribed.
 *
 * `isOverdue`, `isStale`, `daysOverdue`, `lastUpdateDate` and `daysDiff` all
 * exist as named functions in the old source, so tests/golden/parity.test.ts
 * already diffs them against the original by extraction — which is a stronger
 * proof than a transcription. Re-transcribing them here would add a fresh
 * source of error to check the aggregation with, and it did: the first version
 * of this file hand-wrote `isStale` and disagreed with the real one on five
 * items out of 565.
 *
 * So only the AGGREGATION SHAPE below is transcribed — the part with no named
 * counterpart to extract.
 */

const todayS = () => new Date().toISOString().slice(0, 10);
const dDiff = (d: string | undefined | null) => daysDiff(d ?? undefined);

/** dashboard.js:7 */
const refAll = (clients: Client[]) =>
  clients.flatMap((c) =>
    (c.integrations || []).map((i) => ({ ...i, clientName: c.name, clientId: c.id })),
  );

/** dashboard.js:19-22 */
const refImplClients = (clients: Client[]) =>
  clients.filter((c) => c.modules !== undefined);
const refAmsClients = (clients: Client[]) =>
  clients.filter((c) => c.workLog !== undefined);
const refAllAms = (clients: Client[]) =>
  refAmsClients(clients).flatMap((c) =>
    (c.workLog || []).map((e) => ({ ...e, clientName: c.name, clientId: c.id })),
  );
const refOpenAms = (clients: Client[]) =>
  refAllAms(clients).filter((e) => e.entryStatus !== "Closed");
const refIsL3orL4 = (e: { queryLevel?: string }) => {
  const q = e.queryLevel || "";
  return q.includes("L3") || q.includes("L4");
};

/** dashboard.js:14-15 */
function refUpdates7d(clients: Client[]) {
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  return refAll(clients).reduce(
    (n, i) => n + (i.timeline || []).filter((t) => new Date(t.date) >= weekAgo).length,
    0,
  );
}

/** dashboard.js:149 — the one that drifted */
function refFunnel(clients: Client[]) {
  const funnelCounts: Record<string, number> = {};
  PHASES.forEach((p) => (funnelCounts[p] = 0));
  refImplClients(clients).forEach((c) =>
    (c.modules || []).forEach((m) =>
      (m.phases || []).forEach((ph) => {
        if (ph.status === "In Progress" || ph.status === "At Risk") {
          funnelCounts[ph.name] = (funnelCounts[ph.name] || 0) + 1;
        }
      }),
    ),
  );
  return funnelCounts;
}

/** dashboard.js:154-159 */
function refHygiene(clients: Client[]) {
  const all = refAll(clients);
  const hyg = all.length
    ? {
        assignee: all.filter((i) => i.assignee && i.assignee.trim()).length / all.length,
        due: all.filter((i) => i.dueDate).length / all.length,
        fresh: all.filter((i) => !refIsStale(i, 30)).length / all.length,
      }
    : { assignee: 1, due: 1, fresh: 1 };
  return Math.round(((hyg.assignee + hyg.due + hyg.fresh) / 3) * 100);
}

/** dashboard.js:124-131 */
function refUpcoming(clients: Client[]) {
  const from = todayS();
  const in14 = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const upcoming: { date: string; title: string; client: string; tag: string }[] = [];

  refAll(clients).forEach((i) =>
    (i.milestones || []).forEach((ms) => {
      if (ms.status === "Pending" && ms.dueDate && ms.dueDate >= from && ms.dueDate <= in14) {
        upcoming.push({ date: ms.dueDate, title: ms.name, client: i.clientName, tag: "Milestone" });
      }
    }),
  );
  refImplClients(clients).forEach((c) =>
    (c.modules || []).forEach((m) =>
      (m.phases || []).forEach((ph) => {
        if (ph.status !== "Completed" && ph.targetDate && ph.targetDate >= from && ph.targetDate <= in14) {
          upcoming.push({ date: ph.targetDate, title: `${ph.name} — ${m.name}`, client: c.name, tag: "Phase" });
        }
      }),
    ),
  );
  refOpenAms(clients).forEach((e) => {
    if (e.dueDate && e.dueDate >= from && e.dueDate <= in14) {
      upcoming.push({ date: e.dueDate, title: (e.description || "AMS item").slice(0, 50), client: e.clientName, tag: "AMS" });
    }
  });

  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return upcoming;
}

/** dashboard.js:140-145 */
function refSeverity(clients: Client[]) {
  const entries = refAllAms(clients);
  const severityDist: Record<string, number> = {};
  AMS_QUERY_LEVELS.forEach((l) => (severityDist[l] = 0));
  entries.forEach((e) => {
    const l = e.queryLevel || AMS_QUERY_LEVELS[0];
    severityDist[l] = (severityDist[l] || 0) + 1;
  });
  const oldest = refOpenAms(clients)
    .filter(refIsL3orL4)
    .map((e) => dDiff(entryDate(e)))
    .filter((d): d is number => d !== null)
    .sort((a, b) => b - a)[0];
  return { counts: severityDist, total: entries.length, oldest: oldest ?? null };
}

/**
 * dashboard.js:59-70 — the three streams that make up Critical Items.
 *
 * One thing is NOT reproduced. The original builds an intermediate `needsAttn`
 * sorted with `(a.reason === 'overdue' && b.reason !== 'overdue') ? -1 : 1` —
 * a comparator that never returns 0 and claims `a > b` even when both are
 * overdue. That is not a consistent ordering, so the relative order of the
 * overdue items among themselves is whatever the engine's sort happens to do
 * with contradictory answers. Reproducing that would be pinning an accident.
 *
 * The port pushes overdue, then stale, then sorts by severity (stable), which
 * gives a defined order. So the comparison below is on the SET of items and on
 * the severity ordering, not on the exact permutation within a severity.
 */
function refCriticalItems(clients: Client[]) {
  const all = refAll(clients);
  const overdue = all.filter((i) => refIsOverdue(i));
  const stale = all.filter((i) => refIsStale(i, 7) && !refIsOverdue(i));
  const items: Record<string, unknown>[] = [];

  overdue.forEach((i) => items.push({
    domain: "Integration", severity: 0, title: i.name, client: i.clientName,
    detail: `${refDaysOverdue(i)}d overdue`, owner: i.assignee || "Unassigned",
  }));
  stale.forEach((i) => {
    const last = refLastUpdateDate(i);
    items.push({
      domain: "Integration", severity: 1, title: i.name, client: i.clientName,
      detail: `${last ? dDiff(last) : 0}d stale`,
      owner: i.assignee || "Unassigned",
    });
  });
  refImplClients(clients).forEach((c) =>
    (c.modules || []).forEach((m) =>
      (m.phases || []).forEach((ph) => {
        if (ph.status !== "At Risk") return;
        items.push({
          domain: "Phase", severity: 0, title: `${ph.name} — At Risk`, client: c.name,
          detail: ph.targetDate ? `Target ${ph.targetDate}` : "No target date set",
          owner: ph.assignee || "Unassigned",
        });
      }),
    ),
  );
  refOpenAms(clients).forEach((e) => {
    if (!refIsL3orL4(e)) return;
    items.push({
      domain: `AMS · ${(e.queryLevel || "").split(" - ")[0]}`,
      severity: (e.queryLevel || "").includes("L4") ? 0 : 1,
      title: (e.description || "Untitled").slice(0, 60),
      client: e.clientName,
      detail: `${dDiff(entryDate(e))}d open`,
      owner: entryRaisedBy(e),
    });
  });

  return items;
}

/** dashboard.js:161 */
const refBlockers = (clients: Client[]) =>
  refOpenAms(clients)
    .filter((e) => e.dependencies && e.dependencies.trim())
    .map((e) => ({ client: e.clientName, text: (e.dependencies as string).trim() }));

/** dashboard.js:343-361 */
function refBandwidth(clients: Client[], cw = DEFAULT_CAPACITY_WEIGHTS) {
  const capacity: Record<string, { name: string; module: number; pmo: number; integ: number; ams: number; total: number }> = {};
  const capAdd = (name: string | undefined, type: "module" | "pmo" | "integ" | "ams", amount: number) => {
    const nm = (name || "").trim();
    if (!nm) return;
    if (!capacity[nm]) capacity[nm] = { name: nm, module: 0, pmo: 0, integ: 0, ams: 0, total: 0 };
    capacity[nm][type] += amount;
    capacity[nm].total += amount;
  };

  const seenModulePairs = new Set<string>();
  refImplClients(clients).forEach((c) =>
    (c.modules || []).forEach((m) =>
      (m.phases || []).forEach((ph) => {
        if (ph.status === "Completed" || ph.status === "Not Started" || !ph.assignee) return;
        const key = `${ph.assignee.trim()}::${m.id}`;
        if (seenModulePairs.has(key)) return;
        seenModulePairs.add(key);
        capAdd(ph.assignee, "module", cw.module);
      }),
    ),
  );
  refImplClients(clients).forEach((c) => {
    if (c.masterAssignee) capAdd(c.masterAssignee, "pmo", cw.pmo);
  });
  refAll(clients)
    .filter((i) => !["Completed", "Cancelled"].includes(i.status))
    .forEach((i) => {
      if (i.assignee) capAdd(i.assignee, "integ", i.effortWeight ?? 0.5);
    });
  refOpenAms(clients).forEach((e) => {
    const rb = entryRaisedBy(e);
    if (rb && rb !== "—") capAdd(rb, "ams", cw.ams);
  });

  return Object.values(capacity).sort((a, b) => b.total - a.total);
}

/* ============================================================ tests === */

describe("golden master: dashboard aggregations", () => {
  let clients: Client[];

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
    clients = [
      ...makeClients(11, 60, FROZEN),
      ...makeClients(29, 60, FROZEN),
      ...makeClients(53, 60, FROZEN),
    ];
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("the fixtures actually exercise every aggregation", () => {
    // Guards the whole file: if the generator stopped producing (say) AMS
    // entries, every comparison below would trivially agree on empty data.
    expect(clients.length).toBe(180);
    expect(allIntegrations(clients).length).toBeGreaterThan(50);
    expect(openAmsEntries(clients).length).toBeGreaterThan(10);
    expect(clients.filter((c) => c.modules !== undefined).length).toBeGreaterThan(10);
    expect(clients.filter((c) => c.modules === undefined).length).toBeGreaterThan(0);
  });

  it("phaseFunnel counts only In Progress and At Risk", () => {
    expect(phaseFunnel(clients)).toEqual(refFunnel(clients));
  });

  it("phaseFunnel keeps all nine phases, including the zeroes", () => {
    // The funnel renders a fixed row set; a missing key is not a zero count.
    expect(Object.keys(phaseFunnel([])).sort()).toEqual([...PHASES].sort());
  });

  it("phaseFunnel excludes the statuses the old port wrongly counted", () => {
    // The actual regression, pinned directly: six statuses that describe work
    // NOT progressing were being counted in a tile about work in flight.
    const withParked: Client = {
      id: "c1", name: "Parked", description: "", currency: "INR", integrations: [],
      modules: [{ id: "m1", name: "Core", phases: [
        { id: "p1", name: "BPU", status: "On Hold — Client", updates: [] },
        { id: "p2", name: "CRP", status: "Delayed", updates: [] },
        { id: "p3", name: "UAT", status: "Under Review", updates: [] },
        { id: "p4", name: "Go Live", status: "Pending Client", updates: [] },
        { id: "p5", name: "Hypercare", status: "Cancelled", updates: [] },
      ] }],
    } as unknown as Client;

    const funnel = phaseFunnel([withParked]);
    expect(Object.values(funnel).reduce((a, b) => a + b, 0)).toBe(0);
    expect(funnel).toEqual(refFunnel([withParked]));
  });

  it("hygiene score agrees", () => {
    expect(hygieneScore(clients).score).toBe(refHygiene(clients));
  });

  it("hygiene scores an empty portfolio as clean, not as zero", () => {
    // Dividing by zero would say the opposite; there is nothing unhygienic
    // about having no records.
    expect(hygieneScore([]).score).toBe(100);
  });

  it("upcoming deadlines agree, across all three domains", () => {
    expect(upcomingDeadlines(clients, 14)).toEqual(refUpcoming(clients));
  });

  it("severity distribution and oldest-critical age agree", () => {
    const mine = severityDistribution(clients);
    const theirs = refSeverity(clients);
    expect(mine.counts).toEqual(theirs.counts);
    expect(mine.total).toBe(theirs.total);
    expect(mine.oldestCriticalDays).toBe(theirs.oldest);
  });

  it("severity keeps all four levels, including the zeroes", () => {
    expect(Object.keys(severityDistribution([]).counts).sort())
      .toEqual([...AMS_QUERY_LEVELS].sort());
  });

  it("blockers agree", () => {
    expect(blockers(clients)).toEqual(refBlockers(clients));
  });

  it("7-day update count agrees", () => {
    expect(updatesInWindow(clients, 7)).toBe(refUpdates7d(clients));
  });

  it("team bandwidth agrees on every person's total", () => {
    const mine = teamBandwidth(clients).rows.map(({ name, module, pmo, integ, ams, total }) =>
      ({ name, module, pmo, integ, ams, total }));
    expect(mine).toEqual(refBandwidth(clients));
  });

  it("team bandwidth counts a module once per person, not once per phase", () => {
    // The subtlety worth pinning: owning four phases of one module is one
    // module's worth of work. Without the dedupe, anyone running a module end
    // to end looks catastrophically overloaded.
    const c: Client = {
      id: "c1", name: "One", description: "", currency: "INR", integrations: [],
      modules: [{ id: "m1", name: "Core", phases: PHASES.slice(0, 4).map((name, n) => ({
        id: `p${n}`, name, status: "In Progress", assignee: "Kavya", updates: [],
      })) }],
    } as unknown as Client;

    const rows = teamBandwidth([c]).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].module).toBe(DEFAULT_CAPACITY_WEIGHTS.module);
  });

  it("team bandwidth uses each integration's own effort weight", () => {
    const c: Client = {
      id: "c1", name: "One", description: "", currency: "INR",
      integrations: [
        { id: "i1", name: "Heavy", status: "In Progress", assignee: "Kavya",
          effortWeight: 1, milestones: [], timeline: [] },
        { id: "i2", name: "Light", status: "In Progress", assignee: "Kavya",
          effortWeight: 0.25, milestones: [], timeline: [] },
        { id: "i3", name: "Default", status: "In Progress", assignee: "Kavya",
          milestones: [], timeline: [] },
      ],
    } as unknown as Client;

    expect(teamBandwidth([c]).rows[0].integ).toBe(1.75); // 1 + 0.25 + 0.5
  });

  it("health rows and portfolio score are stable and worst-first", () => {
    const rows = healthRows(clients, []);
    // Red before Amber before Green, and no unscored client in the list.
    const rank = { Red: 0, Amber: 1, Green: 2 } as const;
    for (let i = 1; i < rows.length; i++) {
      expect(rank[rows[i].overall]).toBeGreaterThanOrEqual(rank[rows[i - 1].overall]);
    }
    expect(rows.every((r) => r.overall !== null)).toBe(true);

    const score = portfolioScore(rows);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("health trend compares oldest to newest, not the last two", () => {
    // "Where has this client got to over the fortnight", not "did it wobble
    // yesterday" — a client that went Red -> Green -> Amber is still better
    // than it started.
    const c = clients[0];
    const snaps = [
      { client_id: c.id, snapshot_date: "2026-08-01", overall_rag: "Red" },
      { client_id: c.id, snapshot_date: "2026-08-15", overall_rag: "Green" },
      { client_id: c.id, snapshot_date: "2026-08-30", overall_rag: "Amber" },
    ];
    const row = healthRows([c], snaps).find((r) => r.id === c.id);
    if (row) expect(row.trend).toBe("better");
  });

  it("health trend points the RIGHT way — a deliberate break from v1", () => {
    /**
     * The one place this port knowingly disagrees with the original.
     *
     * js/dashboard.js:53 computes rank(oldest) - rank(newest) and labels a
     * positive result "better". With Red=0, Amber=1, Green=2 that inverts
     * every arrow: a client sliding Green -> Red renders a green "↑ better",
     * and one recovering Red -> Green renders a red "↓ worse" (the rendering
     * is at dashboard.js:240). It is wrong on the single tile whose purpose is
     * to show which clients are getting worse.
     *
     * Pinned in both directions so the divergence is intentional and visible,
     * rather than looking like drift the next time someone diffs the two.
     */
    const c = clients[0];
    const at = (date: string, rag: string) =>
      ({ client_id: c.id, snapshot_date: date, overall_rag: rag });

    const trendOf = (from: string, to: string) =>
      healthRows([c], [at("2026-08-01", from), at("2026-08-30", to)])
        .find((r) => r.id === c.id)?.trend;

    // What v1 would have said, transcribed from dashboard.js:53.
    const v1TrendOf = (from: string, to: string) => {
      const rank = (v: string) => ({ Red: 0, Amber: 1, Green: 2 })[v] ?? 1;
      const d = rank(from) - rank(to);
      return d > 0 ? "better" : d < 0 ? "worse" : "same";
    };

    expect(trendOf("Green", "Red")).toBe("worse");
    expect(v1TrendOf("Green", "Red")).toBe("better"); // the bug

    expect(trendOf("Red", "Green")).toBe("better");
    expect(v1TrendOf("Red", "Green")).toBe("worse"); // the bug

    // Unchanged health still reads the same in both.
    expect(trendOf("Amber", "Amber")).toBe("same");
    expect(v1TrendOf("Amber", "Amber")).toBe("same");
  });

  it("health trend is 'new' with no history and 'same' with one snapshot", () => {
    const c = clients[0];
    expect(healthRows([c], []).find((r) => r.id === c.id)?.trend).toBe("new");
    expect(
      healthRows([c], [{ client_id: c.id, snapshot_date: "2026-08-01", overall_rag: "Red" }])
        .find((r) => r.id === c.id)?.trend,
    ).toBe("same");
  });

  it("work mix returns the four heaviest types", () => {
    const mix = workMixByType(clients);
    expect(mix.top.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < mix.top.length; i++) {
      expect(mix.top[i][1]).toBeLessThanOrEqual(mix.top[i - 1][1]);
    }
  });

  it("critical items agree with the original, item for item", () => {
    // Compared as a set — see refCriticalItems for why the exact permutation
    // within one severity is not pinned.
    const key = (i: Record<string, unknown>) =>
      `${i.domain}|${i.severity}|${i.title}|${i.client}|${i.detail}|${i.owner}`;

    const mine = buildCriticalItems(clients)
      .map((i) => key(i as unknown as Record<string, unknown>)).sort();
    const theirs = refCriticalItems(clients).map(key).sort();

    expect(mine).toEqual(theirs);
    expect(mine.length).toBeGreaterThan(10); // the fixtures really do produce these
  });

  it("critical items sort overdue and L4 ahead of stale and L3", () => {
    const items = buildCriticalItems(clients);
    for (let i = 1; i < items.length; i++) {
      expect(items[i].severity).toBeGreaterThanOrEqual(items[i - 1].severity);
    }
    expect(items.some((i) => i.domain === "Integration")).toBe(true);
    expect(items.some((i) => i.domain === "Phase")).toBe(true);
  });

  it("critical items never show a blank owner", () => {
    // The column is always rendered; an empty cell reads as "nobody looked"
    // rather than "nobody is assigned".
    expect(buildCriticalItems(clients).every((i) => i.owner.length > 0)).toBe(true);
  });
});
