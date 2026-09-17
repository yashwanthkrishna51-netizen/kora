import { daysDiff, todayStr } from "@/lib/utils/dates";
import {
  isOverdue,
  isStale,
  daysOverdue,
  lastUpdateDate,
  integRagLabel,
  overallRagLabel,
} from "./integrations";
import { implAutoRag } from "./implementation";
import { amsClientRag, entryDate, entryType, entryRaisedBy } from "./ams";
import { AMS_QUERY_LEVELS, DEFAULT_CAPACITY_WEIGHTS } from "./constants";
import type { Client, Integration, Rag, WorkLogEntry } from "./types";

/**
 * Portfolio-wide dashboard aggregations.
 *
 * These were the last thing in the app still living as inline code inside the
 * old `renderDashboard()`. That mattered more than it looks: `tests/golden/`
 * proves a port correct by extracting the ORIGINAL named function out of the
 * old source and diffing the two over generated fixtures — so logic that was
 * never a named function had no counterpart to diff against and was never
 * covered. `phaseFunnel` was ported early on that basis and silently drifted
 * (it counted six statuses the original excluded) and nobody noticed for the
 * length of the project.
 *
 * So these are functions now, and `tests/golden/dashboard.test.ts` diffs each
 * against a reference implementation transcribed from the original inline
 * code. The transcription is reviewed once; after that it is a fixed target.
 *
 * DOMAIN MEMBERSHIP IS STILL THE SENTINEL here. `c.modules !== undefined`
 * means "this client is in the Implementation domain" and `[]` means "in the
 * domain with nothing in it" — the distinction six clients depended on at
 * migration. The v2 tables carry explicit flags, but the shaping in
 * lib/db/inverse.ts reconstructs the sentinel, so this reads the same way the
 * old code did and stays diffable against it.
 */

/** An integration with its owning client stapled on, as the old code built it. */
export interface FlatIntegration extends Integration {
  clientName: string;
  clientId: string;
}

export interface FlatEntry extends WorkLogEntry {
  clientName: string;
  clientId: string;
}

export function allIntegrations(clients: Client[]): FlatIntegration[] {
  return clients.flatMap((c) =>
    (c.integrations ?? []).map((i) => ({
      ...i,
      clientName: c.name,
      clientId: c.id,
    })),
  );
}

export const implClients = (clients: Client[]) =>
  clients.filter((c) => c.modules !== undefined);

export const amsClients = (clients: Client[]) =>
  clients.filter((c) => c.workLog !== undefined);

export function allAmsEntries(clients: Client[]): FlatEntry[] {
  return amsClients(clients).flatMap((c) =>
    (c.workLog ?? []).map((e) => ({
      ...e,
      clientName: c.name,
      clientId: c.id,
    })),
  );
}

export const openAmsEntries = (clients: Client[]) =>
  allAmsEntries(clients).filter((e) => e.entryStatus !== "Closed");

const isL3orL4 = (e: { queryLevel?: string }) => {
  const q = e.queryLevel || "";
  return q.includes("L3") || q.includes("L4");
};

/* ------------------------------------------------------- critical items */

export interface CriticalItem {
  domain: string;
  /** 0 sorts first. Overdue and L4 are 0; stale and L3 are 1. */
  severity: number;
  title: string;
  client: string;
  detail: string;
  owner: string;
  clientId: string;
  integId?: string;
}

/**
 * The union of three independent "this needs attention" streams.
 *
 * Overdue integrations outrank stale ones, and L4 tickets outrank L3, but
 * within a severity the original preserves stream order — integrations, then
 * at-risk phases, then AMS. `Array.prototype.sort` is stable in every engine
 * we target, so a plain sort on severity reproduces that.
 */
export function buildCriticalItems(
  clients: Client[],
  now: Date = new Date(),
): CriticalItem[] {
  const all = allIntegrations(clients);
  const overdue = all.filter((i) => isOverdue(i, now));
  const stale = all.filter((i) => isStale(i, 7, now) && !isOverdue(i, now));

  const items: CriticalItem[] = [];

  for (const i of overdue) {
    items.push({
      domain: "Integration",
      severity: 0,
      title: i.name,
      client: i.clientName,
      detail: `${daysOverdue(i, now)}d overdue`,
      owner: i.assignee || "Unassigned",
      clientId: i.clientId,
      integId: i.id,
    });
  }

  for (const i of stale) {
    const last = lastUpdateDate(i);
    items.push({
      domain: "Integration",
      severity: 1,
      title: i.name,
      client: i.clientName,
      detail: `${last ? daysDiff(last, now) : 0}d stale`,
      owner: i.assignee || "Unassigned",
      clientId: i.clientId,
      integId: i.id,
    });
  }

  for (const c of implClients(clients)) {
    for (const m of c.modules ?? []) {
      for (const ph of m.phases ?? []) {
        if (ph.status !== "At Risk") continue;
        items.push({
          domain: "Phase",
          severity: 0,
          title: `${ph.name} — At Risk`,
          client: c.name,
          detail: ph.targetDate ? `Target ${ph.targetDate}` : "No target date set",
          owner: ph.assignee || "Unassigned",
          clientId: c.id,
        });
      }
    }
  }

  for (const e of openAmsEntries(clients)) {
    if (!isL3orL4(e)) continue;
    items.push({
      domain: `AMS · ${(e.queryLevel || "").split(" - ")[0]}`,
      severity: (e.queryLevel || "").includes("L4") ? 0 : 1,
      title: (e.description || "Untitled").slice(0, 60),
      client: e.clientName,
      detail: `${daysDiff(entryDate(e), now)}d open`,
      owner: entryRaisedBy(e),
      clientId: e.clientId,
    });
  }

  return items.sort((a, b) => a.severity - b.severity);
}

/* --------------------------------------------------- health scorecard */

export type Trend = "better" | "worse" | "same" | "new";

export interface HealthRow {
  id: string;
  name: string;
  integR: Rag | null;
  implR: Rag | null;
  amsR: Rag | null;
  overall: Rag;
  trend: Trend;
}

export interface SnapshotRow {
  client_id: string;
  snapshot_date: string;
  overall_rag: string | null;
}

/** Red sorts first; an unknown RAG ranks as Amber, matching the original. */
const rankRag = (v: string | null | undefined): number =>
  v == null ? 1 : ({ Red: 0, Amber: 1, Green: 2 }[v] ?? 1);

/**
 * One row per client, worst first, with a direction of travel.
 *
 * The trend compares the OLDEST and NEWEST snapshot in the window, not the
 * last two — so it reads "where has this client got to over the fortnight"
 * rather than "did it wobble yesterday". A client with one snapshot is
 * `same`; with none it is `new`.
 *
 * Clients whose overall RAG is null are dropped entirely: null means the
 * client is in no domain that can be scored, and a blank row helps nobody.
 */
export function healthRows(
  clients: Client[],
  snapshots: SnapshotRow[] = [],
  now: Date = new Date(),
): HealthRow[] {
  return clients
    .map((c) => {
      const integR = integRagLabel(c, now);
      const implR = c.modules !== undefined ? implAutoRag(c, now) : null;
      const amsR = c.workLog !== undefined ? amsClientRag(c, now) : null;
      const overall = overallRagLabel(integR, implR, amsR);

      const hist = snapshots
        .filter((s) => s.client_id === c.id)
        .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

      let trend: Trend = hist.length ? "same" : "new";
      if (hist.length >= 2) {
        // DELIBERATE DIVERGENCE FROM v1 — the original is inverted.
        //
        // js/dashboard.js:53 computes `rank(oldest) - rank(newest)` and calls
        // a positive result "better". With Red=0, Amber=1, Green=2, a client
        // that slid from Green to Red gives 2 - 0 = 2 and renders a green
        // "↑ better"; one that recovered Red to Green gives -2 and renders a
        // red "↓ worse". Every arrow on the Portfolio Health Scorecard points
        // the wrong way, on the one tile whose entire purpose is showing which
        // clients are deteriorating.
        //
        // Not carried over. Newest minus oldest: a higher rank is greener, so
        // a positive difference is a genuine improvement.
        const d =
          rankRag(hist[hist.length - 1].overall_rag) -
          rankRag(hist[0].overall_rag);
        trend = d > 0 ? "better" : d < 0 ? "worse" : "same";
      }

      return { id: c.id, name: c.name, integR, implR, amsR, overall, trend };
    })
    .filter((r): r is HealthRow => r.overall !== null)
    .sort((a, b) => rankRag(a.overall) - rankRag(b.overall));
}

/** Green counts 100, Amber 50, Red 0. Zero rows scores 0, not NaN. */
export function portfolioScore(rows: HealthRow[]): number {
  if (!rows.length) return 0;
  const green = rows.filter((r) => r.overall === "Green").length;
  const amber = rows.filter((r) => r.overall === "Amber").length;
  return Math.round((green * 100 + amber * 50) / rows.length);
}

/* ------------------------------------------------------ deadlines */

export interface Deadline {
  date: string;
  title: string;
  client: string;
  tag: "Milestone" | "Phase" | "AMS";
}

/**
 * Everything due in the next `days`, across all three domains.
 *
 * String comparison on `YYYY-MM-DD`, exactly as the original — it is
 * lexicographically ordered for this format and sidesteps timezone entirely,
 * which is the right call for a date with no time.
 */
export function upcomingDeadlines(
  clients: Client[],
  days = 14,
  now: Date = new Date(),
): Deadline[] {
  const from = todayStr(now);
  const to = new Date(now.getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);

  const out: Deadline[] = [];

  for (const i of allIntegrations(clients)) {
    for (const ms of i.milestones ?? []) {
      if (ms.status !== "Pending" || !ms.dueDate) continue;
      if (ms.dueDate >= from && ms.dueDate <= to) {
        out.push({ date: ms.dueDate, title: ms.name, client: i.clientName, tag: "Milestone" });
      }
    }
  }

  for (const c of implClients(clients)) {
    for (const m of c.modules ?? []) {
      for (const ph of m.phases ?? []) {
        if (ph.status === "Completed" || !ph.targetDate) continue;
        if (ph.targetDate >= from && ph.targetDate <= to) {
          out.push({
            date: ph.targetDate,
            title: `${ph.name} — ${m.name}`,
            client: c.name,
            tag: "Phase",
          });
        }
      }
    }
  }

  for (const e of openAmsEntries(clients)) {
    if (!e.dueDate) continue;
    if (e.dueDate >= from && e.dueDate <= to) {
      out.push({
        date: e.dueDate,
        title: (e.description || "AMS item").slice(0, 50),
        client: e.clientName,
        tag: "AMS",
      });
    }
  }

  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ------------------------------------------------------- hygiene */

/**
 * How complete the Integration records are, as one percentage.
 *
 * The mean of three ratios — has an assignee, has a due date, updated within
 * 30 days. An empty portfolio scores 100 rather than 0: there is nothing
 * unhygienic about having no records, and dividing by zero would say
 * otherwise.
 */
export function hygieneScore(
  clients: Client[],
  now: Date = new Date(),
): { score: number; assignee: number; due: number; fresh: number } {
  const all = allIntegrations(clients);
  if (!all.length) return { score: 100, assignee: 1, due: 1, fresh: 1 };

  const assignee = all.filter((i) => i.assignee && i.assignee.trim()).length / all.length;
  const due = all.filter((i) => i.dueDate).length / all.length;
  const fresh = all.filter((i) => !isStale(i, 30, now)).length / all.length;

  return {
    score: Math.round(((assignee + due + fresh) / 3) * 100),
    assignee,
    due,
    fresh,
  };
}

/* --------------------------------------------- severity and aging */

/**
 * L1–L4 spread across every AMS entry, plus the age of the oldest open
 * L3/L4 ticket.
 *
 * All four levels are always present, including zeroes, because the bar
 * renders a fixed set of segments. An entry with no level counts as L1, which
 * is the original's fallback.
 */
export function severityDistribution(
  clients: Client[],
  now: Date = new Date(),
): { counts: Record<string, number>; total: number; oldestCriticalDays: number | null } {
  const entries = allAmsEntries(clients);

  const counts: Record<string, number> = {};
  for (const l of AMS_QUERY_LEVELS) counts[l] = 0;
  for (const e of entries) {
    const l = e.queryLevel || AMS_QUERY_LEVELS[0];
    counts[l] = (counts[l] ?? 0) + 1;
  }

  const ages = openAmsEntries(clients)
    .filter(isL3orL4)
    .map((e) => daysDiff(entryDate(e), now))
    .filter((d): d is number => d !== null)
    .sort((a, b) => b - a);

  return {
    counts,
    total: entries.length,
    oldestCriticalDays: ages.length ? ages[0] : null,
  };
}

/* ------------------------------------------------------ blockers */

/** Self-reported dependencies on open AMS entries. Unverified by design. */
export function blockers(clients: Client[]): { client: string; text: string }[] {
  return openAmsEntries(clients)
    .filter((e) => e.dependencies && e.dependencies.trim())
    .map((e) => ({ client: e.clientName, text: (e.dependencies ?? "").trim() }));
}

/* ------------------------------------------------ team bandwidth */

export interface CapacityWeights {
  module: number;
  pmo: number;
  ams: number;
  cap: number;
}

export interface CapacityRow {
  name: string;
  module: number;
  pmo: number;
  integ: number;
  ams: number;
  total: number;
  details: { type: string; amount: number; detail: string }[];
}

/**
 * Weighted load per person, highest first.
 *
 * Four contributions, and one subtlety that is easy to lose: MODULES ARE
 * COUNTED ONCE PER PERSON, not once per phase. Owning four phases of one
 * module is one module's worth of work, so `seenModulePairs` dedupes on
 * (assignee, moduleId). Without it, anyone running a module end to end looks
 * catastrophically overloaded.
 *
 * Integrations contribute their own `effortWeight` rather than a flat rate —
 * that field exists precisely so a heavy integration counts more than a light
 * one — defaulting to 0.5 when unset.
 *
 * Names are matched by trimmed string, which is the same fragile key the
 * digest uses. It is what the data supports: assignee fields hold typed names,
 * not user ids.
 */
export function teamBandwidth(
  clients: Client[],
  weights: CapacityWeights = DEFAULT_CAPACITY_WEIGHTS,
): { rows: CapacityRow[]; available: CapacityRow[]; stretched: CapacityRow[]; overCap: CapacityRow[] } {
  const capacity = new Map<string, CapacityRow>();

  const capAdd = (
    name: string | undefined,
    type: "module" | "pmo" | "integ" | "ams",
    amount: number,
    detail: string,
  ) => {
    const nm = (name || "").trim();
    if (!nm) return;
    let row = capacity.get(nm);
    if (!row) {
      row = { name: nm, module: 0, pmo: 0, integ: 0, ams: 0, total: 0, details: [] };
      capacity.set(nm, row);
    }
    row[type] += amount;
    row.total += amount;
    if (detail) row.details.push({ type, amount, detail });
  };

  const seenModulePairs = new Set<string>();
  for (const c of implClients(clients)) {
    for (const m of c.modules ?? []) {
      for (const ph of m.phases ?? []) {
        if (ph.status === "Completed" || ph.status === "Not Started") continue;
        if (!ph.assignee) continue;
        const key = `${ph.assignee.trim()}::${m.id}`;
        if (seenModulePairs.has(key)) continue;
        seenModulePairs.add(key);
        capAdd(ph.assignee, "module", weights.module, `${m.name} · ${c.name}`);
      }
    }
  }

  for (const c of implClients(clients)) {
    if (c.masterAssignee) capAdd(c.masterAssignee, "pmo", weights.pmo, `PMO · ${c.name}`);
  }

  for (const i of allIntegrations(clients)) {
    if (i.status === "Completed" || i.status === "Cancelled") continue;
    if (!i.assignee) continue;
    capAdd(i.assignee, "integ", i.effortWeight ?? 0.5, `${i.name} · ${i.clientName}`);
  }

  for (const e of openAmsEntries(clients)) {
    const rb = entryRaisedBy(e);
    if (rb && rb !== "—") {
      capAdd(rb, "ams", weights.ams, `${e.description || "AMS ticket"} · ${e.clientName}`);
    }
  }

  const rows = [...capacity.values()].sort((a, b) => b.total - a.total);

  return {
    rows,
    available: rows.filter((r) => r.total < weights.cap * 0.6),
    stretched: rows.filter((r) => r.total >= weights.cap * 0.9),
    overCap: rows.filter((r) => r.total > weights.cap),
  };
}

/* ---------------------------------------------------- KPI strip */

/** Activity-log entries posted in the last `days`, across every integration. */
export function updatesInWindow(
  clients: Client[],
  days = 7,
  now: Date = new Date(),
): number {
  const since = new Date(now.getTime() - days * 86400000);
  return allIntegrations(clients).reduce(
    (n, i) =>
      n + (i.timeline ?? []).filter((t) => new Date(t.date) >= since).length,
    0,
  );
}

/** Portfolio-wide work-mix by AMS entry type, heaviest four first. */
export function workMixByType(
  clients: Client[],
): { total: number; top: [string, number][] } {
  const entries = allAmsEntries(clients);
  const byType: Record<string, number> = {};
  let total = 0;
  for (const e of entries) {
    const t = entryType(e);
    const h = Number(e.hours || 0);
    byType[t] = (byType[t] ?? 0) + h;
    total += h;
  }
  return {
    total,
    top: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 4),
  };
}
