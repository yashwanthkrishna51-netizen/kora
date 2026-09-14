import {
  isOverdue,
  isStale,
  daysOverdue,
  lastUpdateDate,
  integRagLabel,
} from "@/lib/domain/integrations";
import { daysDiff } from "@/lib/utils/dates";
import { statusHex } from "./palette";
import type { Client, Integration } from "@/lib/domain/types";

/**
 * Report-only integration logic.
 *
 * FIVE OF THESE SHARE A NAME WITH SOMETHING IN `lib/domain/integrations.ts`
 * AND DO A DIFFERENT THING. That is not an accident of this port — it is true
 * in the old app too, where `js/export.js` deliberately redefined them for the
 * report's needs. The screen ranks integrations for a human scanning a table;
 * the report ranks them for a client reading a summary, and the two disagree.
 *
 *   domain `integSeverityRank`      0–3   ·  here: 0–11 across ten statuses
 *   domain `sortIntegWorstFirst`    name tiebreak  ·  here: most-overdue first
 *   domain `integRiskReason`        4 branches, may return null  ·  here: 11, never null
 *   domain `integStatusSegments`    3-part progress bar  ·  here: donut slices
 *   domain `integMilestoneCounts`   takes an Integration  ·  here: takes a Client
 *
 * So they live here under `report`-prefixed names. Importing the domain version
 * into a generator would produce a plausible, wrongly-ordered report rather than
 * an error, which is the worst kind of mistake to make in something a client
 * reads. `tests/design/export-imports.test.ts` is the tripwire.
 */

/**
 * Where each status sits when nothing more urgent applies.
 *
 * Gaps at 0, 1 and 7 are intentional — those slots belong to the dynamic cases
 * in `reportSeverityRank` (overdue-and-at-risk, at-risk, and stale-in-progress),
 * which must sort between the fixed ones rather than alongside them.
 */
const FALLBACK_RANK: Record<string, number> = {
  "On Hold — Client": 2,
  "On Hold — Internal": 3,
  "Pending Client": 4,
  "Under Review": 5,
  Delayed: 6,
  "In Progress": 8,
  "Not Started": 9,
  Completed: 10,
  Cancelled: 11,
};

export function reportSeverityRank(i: Integration, now?: Date): number {
  if (i.status === "At Risk") return isOverdue(i, now) ? 0 : 1;
  if (i.status === "In Progress" && isStale(i, 7, now)) return 7;
  return FALLBACK_RANK[i.status] ?? 8;
}

/**
 * Worst first: severity, then most-overdue, then soonest due.
 *
 * The `'9999'` sentinel puts undated items last under a string compare, which
 * is what v1 relied on and is why this sorts dates as strings rather than
 * parsing them — every date in this system is `YYYY-MM-DD`, so lexical order
 * IS chronological order, and parsing would only add a timezone to get wrong.
 */
export function reportSortWorstFirst(
  list: readonly Integration[],
  now?: Date,
): Integration[] {
  return [...list].sort((a, b) => {
    const r = reportSeverityRank(a, now) - reportSeverityRank(b, now);
    if (r) return r;

    const ao = isOverdue(a, now);
    const bo = isOverdue(b, now);
    if (ao && bo) return (daysOverdue(b, now) ?? 0) - (daysOverdue(a, now) ?? 0);
    if (ao !== bo) return ao ? -1 : 1;

    return (a.dueDate || "9999").localeCompare(b.dueDate || "9999");
  });
}

/**
 * One short phrase saying why this row is where it is.
 *
 * Always returns a string — the domain version returns `string | null` and the
 * report has nowhere to put a null. Cascade order matters: the first match
 * wins, so "At Risk and overdue" reports the overdue days rather than the
 * generic flag.
 */
export function reportRiskReason(i: Integration, now?: Date): string {
  const staleDays = () => {
    const lu = lastUpdateDate(i);
    const d = lu ? daysDiff(lu, now) : null;
    return d;
  };

  if (i.status === "At Risk" && isOverdue(i, now)) {
    return `${daysOverdue(i, now)}d overdue`;
  }
  if (i.status === "At Risk" && isStale(i, 7, now)) {
    const d = staleDays();
    return d !== null ? `No update in ${d}d` : "No updates logged";
  }
  if (i.status === "At Risk") return "Flagged At Risk";
  if (i.status === "On Hold — Client") return "Waiting on client";
  if (i.status === "On Hold — Internal") return "On hold internally";
  if (i.status === "Pending Client") return "Waiting on client input";
  if (i.status === "Delayed") return "Delayed";
  if (i.status === "Under Review") return "Under review";
  if (i.status === "In Progress" && isStale(i, 7, now)) {
    const d = staleDays();
    return d !== null ? `No update in ${d}d` : "Stale";
  }

  const daysUntil = i.dueDate ? -(daysDiff(i.dueDate, now) ?? 0) : null;
  return daysUntil !== null && daysUntil >= 0 ? `Due in ${daysUntil}d` : "On track";
}

const RISKY_STATUSES = [
  "At Risk",
  "On Hold — Client",
  "On Hold — Internal",
  "Pending Client",
  "Under Review",
  "Delayed",
];

/** The "top items needing attention" list on the executive summary. */
export function reportTopRisks(c: Client, n = 3, now?: Date): Integration[] {
  const integs = c.integrations ?? [];
  const risky = integs.filter(
    (i) =>
      RISKY_STATUSES.includes(i.status) ||
      (i.status === "In Progress" && isStale(i, 7, now)),
  );
  return reportSortWorstFirst(risky, now).slice(0, n);
}

export interface RagReason {
  label: string;
  reason: string;
}

/**
 * The RAG banner's headline and its one-line justification.
 *
 * The label comes from the domain's `integRagLabel` — the report must never
 * compute a RAG of its own, or a client's PDF could disagree with the screen it
 * was generated from.
 */
export function reportRagReason(c: Client, now?: Date): RagReason {
  const integs = c.integrations ?? [];
  const label = integRagLabel(c, now);
  const total = integs.length;
  const atRisk = integs.filter((i) => i.status === "At Risk").length;
  const overdue = integs.filter((i) => isOverdue(i, now)).length;
  const stale = integs.filter((i) => isStale(i, 7, now) && !isOverdue(i, now)).length;

  if (label === "Red") {
    const parts: string[] = [];
    if (atRisk) parts.push(`${atRisk} At Risk`);
    if (overdue) parts.push(`${overdue} overdue`);
    if (stale) parts.push(`${stale} stale 7d+`);
    return {
      label,
      reason: parts.length
        ? `${parts.join(" · ")} of ${total} total`
        : "See details below",
    };
  }
  if (label === "Amber") {
    return {
      label,
      reason: `${stale} integration${stale === 1 ? "" : "s"} stale 7+ days with no update`,
    };
  }
  if (label === "Green") return { label, reason: "All integrations on track" };
  return { label: "—", reason: "No integrations tracked yet" };
}

export interface MilestoneCounts {
  achieved: number;
  pending: number;
  missed: number;
  total: number;
}

/**
 * Milestones across the WHOLE CLIENT.
 *
 * Takes a Client, where the domain function of the same name takes a single
 * Integration. Getting these the wrong way round yields `0/0/0` rather than an
 * error — silently dropping a section from the report.
 */
export function reportMilestoneCounts(c: Client): MilestoneCounts {
  const all = (c.integrations ?? []).flatMap((i) => i.milestones ?? []);
  return {
    achieved: all.filter((m) => m.status === "Achieved").length,
    pending: all.filter((m) => m.status === "Pending").length,
    missed: all.filter((m) => m.status === "Missed").length,
    total: all.length,
  };
}

export interface DonutSegment {
  status: string;
  count: number;
  /** Literal hex INCLUDING the leading `#`. */
  hex: string;
}

/**
 * Donut slices: per-status counts, biggest first, capped at five plus "Other".
 *
 * The cap is the handoff's chart guidance — a donut with eleven slices is a
 * colour-matching puzzle, not a chart.
 *
 * The colours are Kognoz's, from `STATUS_COLORS[*].fill`, NOT v1's `SHEX`
 * table. The grouping, ordering and cap are identical to v1 and are what the
 * golden test pins; the hex deliberately differs, per handoff §13.
 */
export function reportDonutSegments(c: Client): DonutSegment[] {
  const counts: Record<string, number> = {};
  for (const i of c.integrations ?? []) {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
  }

  let entries: DonutSegment[] = Object.entries(counts)
    .map(([status, count]) => ({ status, count, hex: statusHex(status) }))
    .sort((a, b) => b.count - a.count);

  if (entries.length > 6) {
    const kept = entries.slice(0, 5);
    const other = entries.slice(5).reduce((s, e) => s + e.count, 0);
    entries = [...kept, { status: "Other", count: other, hex: "#939598" }];
  }
  return entries;
}

/**
 * The donut itself, as a PNG data URL.
 *
 * jsPDF has no chart primitive, so this rasterises through a real Canvas 2D
 * context and is therefore BROWSER-ONLY. Stroke-based: an arc at radius r with
 * a lineWidth of lw gives a ring between r-lw/2 and r+lw/2, which is why there
 * is no inner-circle punch-out.
 */
export function buildDonutDataUrl(
  segments: readonly DonutSegment[],
  px = 240,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context for the chart");

  const cx = px / 2;
  const cy = px / 2;
  const r = px * 0.36;
  const lw = px * 0.22;
  const total = segments.reduce((s, x) => s + x.count, 0) || 1;

  // Start at 12 o'clock, not 3 — a chart that begins on the right reads as
  // rotated.
  let start = -Math.PI / 2;
  for (const seg of segments) {
    const angle = (seg.count / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + angle);
    ctx.lineWidth = lw;
    ctx.strokeStyle = seg.hex;
    ctx.stroke();
    start += angle;
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(px * 0.22)}px Arial`;
  ctx.fillStyle = "#212121";
  ctx.fillText(String(total), cx, cy - px * 0.03);
  ctx.font = `600 ${Math.round(px * 0.08)}px Arial`;
  ctx.fillStyle = "#71717A";
  ctx.fillText("TOTAL", cx, cy + px * 0.14);

  return canvas.toDataURL("image/png");
}
