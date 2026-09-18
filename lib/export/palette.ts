import { STATUS_COLORS, RAG_COLORS } from "@/lib/domain/constants";
import type { Status, Rag } from "@/lib/domain/types";

/**
 * The export palette, in the only form jsPDF and xlsx can use.
 *
 * TWO RULES, both of which produce silently wrong output if broken.
 *
 * 1. **Only `.fill` is a real colour outside the DOM.** `STATUS_COLORS[s].text`
 *    and `.tint` are `var(--k-text-green)` strings. They resolve against a
 *    stylesheet, so in a PDF they render as garbage and in a spreadsheet as the
 *    literal text `var(...)`. The docblock on `STATUS_COLORS` states the
 *    opposite rule — never use a fill as text — and that rule is correct *in
 *    the DOM*, where the AA-safe `text` variant exists. Outside it, `fill` is
 *    all there is, which is why this module exists rather than call sites
 *    reaching into `STATUS_COLORS` directly.
 *
 * 2. **These are the Kognoz colours, not v1's.** Every old generator opened
 *    `NV=[14,116,144], MG=[37,99,235]` — `#0e7490` and `#2563eb`, the two hexes
 *    the handoff's grep gate forbids. Handoff §13 replaces them wholesale, so
 *    reports will change colour the first time this ships. That is intended,
 *    and it is visible to clients.
 */

export type Rgb = [number, number, number];

/** `#005184` -> `[0, 81, 132]`. Throws rather than guess. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    // A `var(--…)` string lands here, which is the whole point: fail loudly at
    // the boundary instead of drawing a black rectangle in a client report.
    throw new Error(`Not a literal hex colour: ${hex}`);
  }
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* ---------------------------------------------------------------- brand */

/** Handoff §13, verbatim. */
export const BRAND = {
  /** Cover and section fills, table header rows. */
  deepBlue: "#005184",
  /** Rules and secondary accents. Replaces v1's magenta/blue second colour. */
  sky: "#43AFCD",
  positive: "#88B787",
  warning: "#F59E0B",
  critical: "#EF4444",
  ink: "#212121",
  muted: "#71717A",
  hairline: "#E4E4E7",
  white: "#FFFFFF",
  /**
   * Light accent for text sitting ON the deep-blue cover.
   *
   * v1 used `rgb(125,211,232)` here. This is the design system's own
   * dark-mode teal, which is within one or two units of it and is an actual
   * Kognoz token rather than a number someone picked — the cover is the same
   * problem dark mode solves: readable on a dark blue ground.
   */
  onBrandLight: "#7FC4E8",
} as const;

export const BRAND_RGB = {
  deepBlue: hexToRgb(BRAND.deepBlue),
  sky: hexToRgb(BRAND.sky),
  positive: hexToRgb(BRAND.positive),
  warning: hexToRgb(BRAND.warning),
  critical: hexToRgb(BRAND.critical),
  ink: hexToRgb(BRAND.ink),
  muted: hexToRgb(BRAND.muted),
  hairline: hexToRgb(BRAND.hairline),
  white: hexToRgb(BRAND.white),
  onBrandLight: hexToRgb(BRAND.onBrandLight),
} as const;

/** Zebra striping. A very light tint of the brand rather than a neutral grey. */
export const ZEBRA_RGB: Rgb = [246, 249, 251];

/* --------------------------------------------------------------- status */

/** `"At Risk"` -> `"#EF4444"`. Unknown statuses fall back to the muted grey. */
export function statusHex(status: string | null | undefined): string {
  return STATUS_COLORS[status as Status]?.fill ?? "#939598";
}

/** `"At Risk"` -> `[239, 68, 68]`. */
export function statusRgb(status: string | null | undefined): Rgb {
  return hexToRgb(statusHex(status));
}

/** `"Red"` -> `"#EF4444"`. */
export function ragHex(rag: string | null | undefined): string {
  return RAG_COLORS[rag as Rag]?.fill ?? "#939598";
}

export function ragRgb(rag: string | null | undefined): Rgb {
  return hexToRgb(ragHex(rag));
}

/**
 * A colour blended toward white — for the group-header bands in the PDF index.
 *
 * v1 computed this inline as `v + (255-v)*0.85` with a comment explaining that
 * white-on-colour goes near-invisible for the lighter statuses. Same maths,
 * named, so the reason survives.
 */
export function tint(rgb: Rgb, amount = 0.85): Rgb {
  return rgb.map((v) => Math.round(v + (255 - v) * amount)) as Rgb;
}
