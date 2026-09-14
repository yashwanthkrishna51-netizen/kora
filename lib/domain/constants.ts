import type { Status, Role, MilestoneStatus, AmsEntryStatus } from "./types";

/** Ported verbatim from the old app's js/core.js:12-21. Order is load-bearing:
 *  it drives dropdown order and the Implementation phase grid's column order. */

export const STATUSES: Status[] = [
  "Not Started",
  "In Progress",
  "At Risk",
  "On Hold — Internal",
  "On Hold — Client",
  "Pending Client",
  "Under Review",
  "Delayed",
  "Cancelled",
  "Completed",
];

export const ROLES: Role[] = ["viewer", "editor", "admin"];

/** The nine fixed delivery phases. A module always has exactly these, in order. */
export const PHASES = [
  "BPU",
  "BPU Signoff",
  "CRP",
  "CRP Signoff",
  "UAT",
  "UAT Signoff",
  "Data Migration / Production Migration",
  "Go Live",
  "Hypercare",
] as const;

export type PhaseName = (typeof PHASES)[number];

/**
 * Display-only shortening for the one phase name that does not fit a column.
 *
 * The FULL name stays in the data, in tooltips and in the URL — it is the
 * routing key, and the catch-all segment that carries its embedded slash
 * depends on it (README §7). Only the visible label changes.
 */
const SHORT_PHASE: Record<string, string> = {
  "Data Migration / Production Migration": "Data Migration",
};

export const shortPhase = (name: string): string => SHORT_PHASE[name] ?? name;

/** Completing one of these requires an update carrying an attachment. */
export const SIGNOFF_PHASES: readonly string[] = [
  "BPU Signoff",
  "CRP Signoff",
  "UAT Signoff",
];

export const MILESTONE_STATUSES: MilestoneStatus[] = [
  "Pending",
  "Achieved",
  "Missed",
];

export const AMS_TYPES = [
  "Bug Fix",
  "Enhancement",
  "Config Change",
  "Support Ticket",
  "Reporting",
  "Training",
  "Meeting",
  "Consultation",
] as const;

export const AMS_QUERY_LEVELS = [
  "L1 - Low",
  "L2 - Medium",
  "L3 - High",
  "L4 - Critical",
] as const;

export const AMS_ENTRY_STATUSES: AmsEntryStatus[] = [
  "Open",
  "In Progress",
  "Closed",
];

export const AMS_MODES = ["Online / Remote", "Offline / In-person"] as const;

export const CURRENCIES = {
  INR: { symbol: "₹", code: "INR" },
  USD: { symbol: "$", code: "USD" },
} as const;

export const HOURS_PER_DAY = 8;

/** Default capacity weights; overridden by the `capacity_weights` app setting. */
export const DEFAULT_CAPACITY_WEIGHTS = {
  module: 1,
  pmo: 0.5,
  ams: 0.25,
  cap: 5,
} as const;

/**
 * Status → the colours a FILLED cell needs: a ground and a label that reads on
 * it.
 *
 * Separate from `STATUS_COLORS` below rather than folded into it, because the
 * two answer different questions. `STATUS_COLORS.fill` is a frozen hex — the
 * PDF and Excel exports need a real colour value, and a canvas cannot resolve
 * `var()`. That is fine for a dot drawn on paper and wrong for a grid cell on
 * screen: a frozen hex does not flip in dark mode, which is the exact bug the
 * implementation matrix was rescued from once already.
 *
 * So the screen gets tokens. Every entry here is a `var(--k-*)` that has a dark
 * counterpart, and a test asserts both that and that every `Status` appears.
 *
 * THE LABEL COLOUR IS NOT WHITE. Measured against all eight grounds in both
 * themes, white runs 2.15:1 to 3.76:1 — it fails AA on every status and the
 * 3:1 large-text bar on six. `--k-on-fill` runs 4.71:1 to 9.28:1. The two pale
 * statuses are the exception and take the ordinary muted text colour, because
 * `--k-line-2` in dark mode is a navy on which the dark ink would be 1.93:1.
 *
 * Not Started stays the pale `--k-line-2` the matrix already used for it, and
 * Cancelled takes a real grey: "never begun" and "abandoned" should not look
 * identical across a grid you scan for gaps.
 */
export const STATUS_CELL: Record<Status, { fill: string; ink: string }> = {
  Completed: { fill: "var(--k-fill-ok)", ink: "var(--k-on-fill)" },
  "In Progress": { fill: "var(--k-cyan)", ink: "var(--k-on-fill)" },
  "At Risk": { fill: "var(--k-fill-risk)", ink: "var(--k-on-fill)" },
  Delayed: { fill: "var(--k-fill-warn)", ink: "var(--k-on-fill)" },
  "Pending Client": { fill: "var(--k-olive)", ink: "var(--k-on-fill)" },
  "Under Review": { fill: "var(--k-sky)", ink: "var(--k-on-fill)" },
  "On Hold — Internal": { fill: "var(--k-grey)", ink: "var(--k-on-fill)" },
  // Both On Holds share a grey, as STATUS_COLORS does. Splitting them by hue
  // here would make the matrix disagree with every status pill in the app.
  "On Hold — Client": { fill: "var(--k-grey)", ink: "var(--k-on-fill)" },
  Cancelled: { fill: "var(--k-grey)", ink: "var(--k-on-fill)" },
  "Not Started": { fill: "var(--k-line-2)", ink: "var(--k-mute)" },
};

/**
 * Status → colour, on the Kognoz palette.
 *
 * `fill` is for dots, bars, grid cells and borders. `text` is the darkened
 * AA-safe pair for any text, and `tint` is the pill background. Never render
 * `fill` as text — that rule is why these are triples rather than one hex.
 * Replaces the old SHEX/SDOT/SRGB maps wholesale.
 */
export const STATUS_COLORS: Record<
  Status,
  { fill: string; text: string; tint: string }
> = {
  Completed: {
    fill: "#88B787",
    text: "var(--k-text-green)",
    tint: "var(--k-tint-green)",
  },
  "In Progress": {
    fill: "#009BDD",
    text: "var(--k-text-cyan)",
    tint: "var(--k-tint-cyan)",
  },
  "At Risk": {
    fill: "#EF4444",
    text: "var(--k-text-red)",
    tint: "var(--k-tint-risk)",
  },
  Delayed: {
    fill: "#F59E0B",
    text: "var(--k-text-amber)",
    tint: "var(--k-tint-warn)",
  },
  "Pending Client": {
    fill: "#75A02F",
    text: "var(--k-text-olive)",
    tint: "var(--k-tint-olive)",
  },
  "Under Review": {
    fill: "#43AFCD",
    text: "var(--k-text-sky)",
    tint: "var(--k-tint-sky)",
  },
  "On Hold — Internal": {
    fill: "#939598",
    text: "var(--k-text-grey)",
    tint: "var(--k-tint-grey)",
  },
  "On Hold — Client": {
    fill: "#939598",
    text: "var(--k-text-grey)",
    tint: "var(--k-tint-grey)",
  },
  Cancelled: {
    fill: "#A1A1AA",
    text: "var(--k-mute)",
    tint: "var(--k-tint-neutral)",
  },
  "Not Started": {
    fill: "#A1A1AA",
    text: "var(--k-mute)",
    tint: "var(--k-tint-neutral)",
  },
};

export const RAG_COLORS = {
  Red: { fill: "#EF4444", text: "var(--k-text-red)" },
  Amber: { fill: "#F59E0B", text: "var(--k-text-amber)" },
  Green: { fill: "#88B787", text: "var(--k-text-green)" },
} as const;

/** Query-level → colour, reusing the status triples (handoff §9). */
export const QUERY_LEVEL_COLORS: Record<
  string,
  { fill: string; text: string; tint: string }
> = {
  "L4 - Critical": STATUS_COLORS["At Risk"],
  "L3 - High": STATUS_COLORS["Delayed"],
  "L2 - Medium": STATUS_COLORS["In Progress"],
  "L1 - Low": STATUS_COLORS["On Hold — Internal"],
};

/** Deterministic avatar palette, drawn from the Kognoz supporting hues. */
export const AVATAR_PALETTE = [
  "#005184",
  "#43AFCD",
  "#55B09D",
  "#75A02F",
  "#009BDD",
  "#88B787",
  "#939598",
] as const;
