import { daysDiff, todayStr } from "@/lib/utils/dates";
import type { Client, Integration, Milestone, Rag } from "./types";
import { STATUSES } from "./constants";

/**
 * Integration health, ported from js/core.js:237-270.
 * Behaviour is preserved exactly — see lib/utils/dates for why.
 */

/** Overdue = has a due date in the past and isn't Completed. */
export function isOverdue(i: Integration, now?: Date): boolean {
  if (i.status === "Completed" || !i.dueDate) return false;
  const d = daysDiff(i.dueDate, now);
  return d !== null && d > 0;
}

/** Days past the due date. Null when there's no due date. */
export function daysOverdue(i: Integration, now?: Date): number | null {
  return daysDiff(i.dueDate, now);
}

/** Most recent timeline entry's date. The old app relies on timeline[0] being newest. */
export function lastUpdateDate(i: Integration): string | null {
  return i.timeline?.[0]?.date ?? null;
}

/**
 * Stale = not Completed and either never updated, or last updated `days` ago.
 * Note "never updated" counts as stale — that is intentional in the original.
 */
export function isStale(i: Integration, days = 7, now?: Date): boolean {
  if (i.status === "Completed") return false;
  const lu = lastUpdateDate(i);
  if (!lu) return true;
  const d = daysDiff(lu, now);
  return d !== null && d >= days;
}

/**
 * A client's integration health, reduced to four numbers.
 *
 * THE POINT OF THIS SHAPE: the client rail (artboard 1c) needs a RAG dot and a
 * status bar for all 22 clients at once, and it only ever holds `ClientSummary`
 * — no `integrations[]` to count. Rather than let the rail invent a second,
 * subtly different rule, the rule is stated once against these four numbers,
 * and both callers produce them: the tree-shaped screens by counting rows,
 * `listClients` by counting in SQL.
 *
 * `risk` folds At Risk and overdue together because the RAG has always treated
 * them identically, and counting them separately would double-count the
 * integration that is both.
 */
export interface IntegHealth {
  /** Active integrations. Zero means "stream not tracked", not "all green". */
  total: number;
  /** Completed. */
  done: number;
  /** At Risk or overdue. Disjoint from `done` — a Completed row is never either. */
  risk: number;
  /** Not Completed and not updated in 7+ days. Never updated counts as stale. */
  stale: number;
}

/**
 * Per-client Integration RAG, from the counts.
 * Red if anything is At Risk or overdue; Amber if anything is stale; otherwise
 * Green. Null when the client has no integrations at all, which the scorecard
 * renders as "stream not tracked".
 *
 * The original rule read "stale but not overdue" for Amber. That qualifier is
 * dead by the time it is reached — `risk > 0` has already returned Red — so
 * dropping it preserves behaviour exactly.
 */
export function integRagFromHealth(h: IntegHealth): Rag | null {
  if (!h.total) return null;
  if (h.risk > 0) return "Red";
  if (h.stale > 0) return "Amber";
  return "Green";
}

/** The same four numbers, counted off a fully-loaded client tree. */
export function integHealthOf(c: Client, now?: Date): IntegHealth {
  const integs = c.integrations ?? [];
  return {
    total: integs.length,
    done: integs.filter((i) => i.status === "Completed").length,
    risk: integs.filter((i) => i.status === "At Risk" || isOverdue(i, now)).length,
    stale: integs.filter((i) => isStale(i, 7, now)).length,
  };
}

export function integRagLabel(c: Client, now?: Date): Rag | null {
  return integRagFromHealth(integHealthOf(c, now));
}

/** Combine per-domain RAGs into one. Worst wins; all-null stays null. */
export function overallRagLabel(...rags: (Rag | null | undefined)[]): Rag | null {
  const present = rags.filter(Boolean) as Rag[];
  if (!present.length) return null;
  if (present.includes("Red")) return "Red";
  if (present.includes("Amber")) return "Amber";
  return "Green";
}

/**
 * Urgency tint for a Pending milestone, by due-date proximity.
 * Achieved/Missed milestones don't call this — they keep fixed colours.
 */
export function milestoneUrgency(
  ms: Milestone,
  now?: Date,
): "rose" | "orange" | "amber" {
  if (!ms.dueDate) return "amber";
  const d = daysDiff(ms.dueDate, now);
  if (d === null) return "amber";
  if (d > 0) return "rose"; // already past due
  if (d >= -3) return "orange"; // due within three days
  return "amber";
}

/**
 * The three-segment status bar on client rail cards and the Status mix footer.
 *
 * `wip` is deliberately "everything else" rather than a status list: the bar
 * has to add up to the total, and the ten statuses do not partition neatly into
 * three buckets. Clamped at zero so a future overlap in `done`/`risk` degrades
 * to a short bar instead of a negative flex.
 */
export function integSegments(h: IntegHealth) {
  return {
    done: h.done,
    wip: Math.max(0, h.total - h.done - h.risk),
    risk: h.risk,
    total: h.total,
  };
}

/** The same, straight off a client tree. */
export function integStatusSegments(c: Client, now?: Date) {
  return integSegments(integHealthOf(c, now));
}

/** Sort worst-first: At Risk/overdue, then stale, then everything else. */
export function integSeverityRank(i: Integration, now?: Date): number {
  if (i.status === "At Risk" || isOverdue(i, now)) return 0;
  if (isStale(i, 7, now)) return 1;
  if (i.status === "Completed") return 3;
  return 2;
}

export function sortIntegWorstFirst(
  integs: Integration[],
  now?: Date,
): Integration[] {
  return [...integs].sort(
    (a, b) =>
      integSeverityRank(a, now) - integSeverityRank(b, now) ||
      a.name.localeCompare(b.name),
  );
}

/** Human-readable reason an integration is flagged, for critical-item rows. */
export function integRiskReason(i: Integration, now?: Date): string | null {
  if (i.status === "At Risk") return "Marked At Risk";
  if (isOverdue(i, now)) {
    const d = daysOverdue(i, now);
    return `${d}d overdue`;
  }
  if (isStale(i, 7, now)) {
    const lu = lastUpdateDate(i);
    const d = lu ? daysDiff(lu, now) : null;
    return d === null ? "No updates" : `${d}d stale`;
  }
  return null;
}

/** Achieved / total, for the milestone summary on the record page. */
export function integMilestoneCounts(i: Integration) {
  const ms = i.milestones ?? [];
  return {
    total: ms.length,
    achieved: ms.filter((m) => m.status === "Achieved").length,
    missed: ms.filter((m) => m.status === "Missed").length,
    pending: ms.filter((m) => m.status === "Pending").length,
  };
}

/** Milestones and phase targets falling inside the next `days` days. */
export function isDueWithin(
  dateStr: string | null | undefined,
  days: number,
  now?: Date,
): boolean {
  if (!dateStr) return false;
  const d = daysDiff(dateStr, now);
  if (d === null) return false;
  // d is negative for future dates; -days..0 is "within the window".
  return d <= 0 && d >= -days;
}

/* --------------------------------------------------------------- membership */

/**
 * Does this client belong in the Integrations tracker's list?
 *
 * PRESENCE IS THE RIGHT RULE HERE AND THE WRONG RULE NEXT DOOR, which is worth
 * saying because the rail warns about it twice. Implementation and AMS are
 * opt-in domains read from `hasImplementation` / `hasAms`: a client is in one
 * because somebody put it there, and filtering those on counts would drop a
 * client that is legitimately in a domain with nothing in it yet — the exact
 * bug migration 0003 exists to prevent. Integrations has no such flag, so
 * presence is the only signal there is, and a client with none of them has
 * nothing to show on a screen whose job is triage.
 *
 * The count is `ClientSummary.counts.integrations`, which is the same SQL value
 * as `integHealth.total` by construction and already excludes archived rows.
 *
 * A NAMED FUNCTION RATHER THAN THREE INLINE `> 0` CHECKS, because the rail, the
 * index and the landing redirect must agree: if the landing keeps a client the
 * rail drops, the app sends you to a screen the list refuses to show.
 */
export function inIntegrationsTracker(integrationCount: number): boolean {
  return integrationCount > 0;
}

/* ------------------------------------------------------------------ sorting */

export type IntegSort = "worst" | "name" | "due" | "status";

/** What the sort control offers, in the order it offers it. */
export const INTEG_SORTS: { value: IntegSort; label: string }[] = [
  { value: "worst", label: "Worst first" },
  { value: "name", label: "Name" },
  { value: "due", label: "Due date" },
  { value: "status", label: "Status" },
];

/**
 * Order the integration list.
 *
 * `worst` delegates to `sortIntegWorstFirst` rather than reimplementing it:
 * that ranking is what the RAG, the dashboard's critical items and this list
 * all agree on, and a second copy here would drift from the other two.
 *
 * EVERY MODE BREAKS ITS TIE ON NAME, so the order is total. Leaving ties to the
 * engine's sort is stable per-run but not per-dataset — re-filtering the list
 * would reshuffle equal rows under the reader's cursor for no visible reason.
 *
 * `due` puts the soonest first and undated rows LAST. An empty date sorting as
 * the epoch would stack every undated row at the top of a list whose whole job
 * is "what needs attention", which is the opposite of what it means.
 */
export function sortIntegrations(
  integs: Integration[],
  mode: IntegSort,
  now?: Date,
): Integration[] {
  if (mode === "worst") return sortIntegWorstFirst(integs, now);

  const byName = (a: Integration, b: Integration) =>
    a.name.localeCompare(b.name);

  if (mode === "name") return [...integs].sort(byName);

  if (mode === "due") {
    return [...integs].sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return byName(a, b);
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate) || byName(a, b);
    });
  }

  // STATUSES order, not alphabetical: it is the app's canonical progression and
  // the same order the filter chips above the list are drawn in.
  return [...integs].sort(
    (a, b) =>
      STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || byName(a, b),
  );
}

/* ------------------------------------------------------------- effort scale */

/**
 * The effort weights offered in the UI, with names.
 *
 * `effortWeight` is a free `z.number().positive().max(100)` in the schema and a
 * bare `numeric` in the column — nothing constrains it and nothing had ever
 * named it. These four are the only values in the data, the ones the golden
 * fixtures pick from, and they mean something concrete: `teamBandwidth` costs a
 * module at 1 against a per-person ceiling of 5, so 1 is "a module's worth".
 *
 * The list is OFFERED, not enforced. A row holding some other weight keeps it
 * and stays editable — `InlineSelect` re-inserts an unrecognised value rather
 * than snapping it to the nearest option behind the user's back.
 */
export const EFFORT_STEPS: { value: string; label: string }[] = [
  { value: "0.25", label: "Light — 0.25" },
  { value: "0.5", label: "Medium — 0.5" },
  { value: "1", label: "Heavy — 1" },
  { value: "2", label: "Very heavy — 2" },
];

/** The label for a weight, or the bare number when it is not one of the four. */
export function effortLabel(weight: number | undefined): string {
  if (weight == null) return "—";
  // Matched numerically, not by string: the column is `numeric`, so what comes
  // back is not guaranteed to be spelled "0.5".
  const step = EFFORT_STEPS.find((s) => Number(s.value) === weight);
  return step ? step.label : String(weight);
}

/**
 * Which row to open when a screen lands on nothing in particular.
 *
 * The rule is "where you were, if it is still there". A remembered id is a
 * pointer into data that moves: the client you had open can be archived, the
 * integration you last read can be deleted, and both are read out of
 * localStorage that may be weeks old. Trusting one blindly means landing on an
 * empty screen with no explanation, which is worse than landing on the first
 * row — so the fallback is not optional and is not a detail to be re-written
 * inline at each call site.
 *
 * Returns undefined only when there is genuinely nothing to select.
 */
export function pickLanding(
  remembered: string | undefined,
  ids: string[],
): string | undefined {
  if (remembered && ids.includes(remembered)) return remembered;
  return ids[0];
}

export { todayStr };
