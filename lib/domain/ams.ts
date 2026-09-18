import { todayStr, addDaysStr } from "@/lib/utils/dates";
import { CURRENCIES, HOURS_PER_DAY } from "./constants";
import type { Client, Rag, WorkLogEntry } from "./types";

/** AMS billing + health, ported from js/ams.js:2-65. */

/** Field accessors — old rows use legacy aliases, so both are honoured. */
export function entryDate(e: WorkLogEntry): string {
  return e.dateRaised || e.date || "";
}
export function entryType(e: WorkLogEntry): string {
  return e.type || e.category || "—";
}
export function entryRaisedBy(e: WorkLogEntry): string {
  return e.raisedBy || e.loggedBy || "—";
}

export function currencySymbol(client?: Pick<Client, "currency">): string {
  return CURRENCIES[client?.currency ?? "INR"]?.symbol ?? "₹";
}

/** Hours are billed as man-days: an 8-hour day at the client's day rate. */
export function amsEntryAmount(hours: number, rate?: number): number | null {
  if (!rate) return null;
  return (hours / HOURS_PER_DAY) * rate;
}

export interface AmsTotals {
  log: WorkLogEntry[];
  totalHours: number;
  totalAmount: number | null;
  byType: Record<string, number>;
  hasRate: boolean;
  hasBucket: boolean;
  totalAvailableHours?: number;
  billableHours: number;
  coveredHours: number;
  consumedAllTime: number;
  balanceAvailable: number | null;
}

/**
 * Retainer maths for a date window.
 *
 * The key rule: when a client has a retainer (`totalAvailableHours`), hours
 * consume that pool FIRST and only the overage is billable. The pool is drawn
 * down in chronological order, so hours logged before the window's start still
 * count against it — that's what `remainingAtPeriodStart` accounts for.
 *
 * `balanceAvailable` is deliberately all-time, not window-scoped: it answers
 * "how much retainer is left", which doesn't depend on what you're looking at.
 */
export function amsTotals(
  client: Client,
  fromDate = "",
  toDate = "",
): AmsTotals {
  const allLog = client.workLog ?? [];
  const log = allLog.filter(
    (e) =>
      (!fromDate || entryDate(e) >= fromDate) &&
      (!toDate || entryDate(e) <= toDate),
  );

  const totalHours = log.reduce((a, e) => a + Number(e.hours || 0), 0);
  const allTimeHours = allLog.reduce((a, e) => a + Number(e.hours || 0), 0);

  const bucket = client.totalAvailableHours;
  const hasBucket = bucket !== undefined && bucket !== null && bucket > 0;
  const hasRate = !!(client.manDayRate && client.manDayRate > 0);

  let billableHours = totalHours;
  let coveredHours = 0;
  let balanceAvailable: number | null = null;

  if (hasBucket && bucket) {
    const hoursBeforePeriod = fromDate
      ? allLog
          .filter((e) => entryDate(e) < fromDate)
          .reduce((a, e) => a + Number(e.hours || 0), 0)
      : 0;
    const remainingAtPeriodStart = Math.max(0, bucket - hoursBeforePeriod);
    coveredHours = Math.min(totalHours, remainingAtPeriodStart);
    billableHours = Math.max(0, totalHours - remainingAtPeriodStart);
    balanceAvailable = Math.max(0, bucket - allTimeHours);
  }

  const totalAmount = hasRate
    ? (amsEntryAmount(billableHours, client.manDayRate) ?? 0)
    : null;

  const byType: Record<string, number> = {};
  for (const e of log) {
    const tp = entryType(e);
    byType[tp] = (byType[tp] ?? 0) + Number(e.hours || 0);
  }

  return {
    log,
    totalHours,
    totalAmount,
    byType,
    hasRate,
    hasBucket,
    totalAvailableHours: bucket,
    billableHours,
    coveredHours,
    consumedAllTime: allTimeHours,
    balanceAvailable,
  };
}

/**
 * The single canonical AMS health formula.
 *
 * Historically this existed twice with diverging rules, so the same client
 * could read Green on the AMS page and Red on the dashboard. The merged version
 * checks everything either one checked; do not fork it again — the dashboard,
 * the scorecard and snapshot capture all call this one.
 *
 * Red:   an open entry flagged Red, or L4, or past its due date,
 *        or the retainer is nearly exhausted (<= max(2h, 15% of pool)).
 * Amber: an open entry flagged Amber, or L3, or due within three days.
 */
export function amsClientRag(client: Client, now: Date = new Date()): Rag | null {
  const entries = client.workLog ?? [];
  if (!entries.length) return null;

  const today = todayStr(now);
  const open = entries.filter((e) => (e.entryStatus || "Open") !== "Closed");

  if (open.some((e) => e.ragStatus === "Red")) return "Red";
  if (open.some((e) => (e.queryLevel || "").includes("L4"))) return "Red";
  if (open.some((e) => e.dueDate && e.dueDate < today)) return "Red";

  const t = amsTotals(client, "", "");
  if (
    t.hasBucket &&
    t.balanceAvailable !== null &&
    t.balanceAvailable <= Math.max(2, (t.totalAvailableHours ?? 0) * 0.15)
  ) {
    return "Red";
  }

  if (open.some((e) => e.ragStatus === "Amber")) return "Amber";
  if (open.some((e) => (e.queryLevel || "").includes("L3"))) return "Amber";

  const soonStr = addDaysStr(3, now);
  if (open.some((e) => e.dueDate && e.dueDate <= soonStr && e.dueDate >= today))
    return "Amber";

  return "Green";
}

/** Open / L3+L4 counts used by the dashboard KPI strip. */
export function amsOpenCounts(client: Client) {
  const entries = client.workLog ?? [];
  const open = entries.filter((e) => (e.entryStatus || "Open") !== "Closed");
  const openL3L4 = open.filter((e) => {
    const q = e.queryLevel || "";
    return q.includes("L3") || q.includes("L4");
  });
  return { open: open.length, openL3L4: openL3L4.length };
}

/** Reactive vs proactive split for the work-mix tile. */
const REACTIVE_TYPES = new Set(["Bug Fix", "Support Ticket"]);

export function amsWorkMix(totals: AmsTotals) {
  let reactive = 0;
  let proactive = 0;
  for (const [type, hours] of Object.entries(totals.byType)) {
    if (REACTIVE_TYPES.has(type)) reactive += hours;
    else proactive += hours;
  }
  const total = reactive + proactive;
  return {
    reactive,
    proactive,
    reactivePct: total ? Math.round((reactive / total) * 100) : 0,
    proactivePct: total ? Math.round((proactive / total) * 100) : 0,
  };
}

/** Retainer gauge threshold colour (handoff §9). */
export function poolGaugeColor(consumedPct: number): string {
  if (consumedPct > 95) return "var(--k-fill-risk)";
  if (consumedPct >= 70) return "var(--k-fill-warn)";
  return "var(--k-fill-ok)";
}
