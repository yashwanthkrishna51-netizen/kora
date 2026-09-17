import type { jsPDF } from "jspdf";
import type { CellHookData } from "jspdf-autotable";
import { BRAND_RGB, ZEBRA_RGB, type Rgb } from "./palette";
import { fmtDate } from "@/lib/utils/dates";
import type { ActivityEntry } from "@/lib/domain/types";

/**
 * The parts every report PDF repeats.
 *
 * In `js/export.js` there was no shared scaffolding at all: five generators
 * each hand-rolled a cover, a header bar and a thank-you page. The cover
 * geometry is identical between the Integration and Implementation reports; the
 * thank-you page is byte-identical in all five; the header bar repeats with two
 * variations. That is roughly a third of the file, duplicated four times, and it
 * is why a fix to one report's logo placement had to be applied by hand to the
 * others — the file's own comment records two separate mispositioning bugs from
 * exactly that.
 *
 * Landscape A4 in millimetres throughout: W=297, H=210.
 *
 * ── ONE DELIBERATE DEPARTURE FROM HANDOFF §13, STATED PLAINLY ──
 * §13 asks for Calibri/Carlito headings, Open Sans body and JetBrains Mono
 * figures. These use jsPDF's built-in Helvetica. Embedding three families means
 * shipping their TTFs as base64 inside the export chunk — several hundred KB
 * on top of jsPDF itself, on a path that is already a dynamic import for size
 * reasons. v1 used Helvetica too, so this is not a regression, and the visible
 * brand change §13 is really about is the PALETTE, which is fully applied.
 * Embedding the fonts is a self-contained follow-up; it is not done here, and
 * this comment exists so nobody later believes it was.
 */

export const PAGE = { w: 297, h: 210 } as const;

/**
 * Characters jsPDF's built-in fonts CANNOT render, and what to use instead.
 *
 * The standard PDF fonts are WinAnsi-encoded. Anything outside that set is
 * dropped SILENTLY — no error, no placeholder glyph, just a gap. Verified on a
 * generated report: `On Hold — Internal` came out as `On Hold  Internal`, and
 * `Executive Summary’s` as `Executive Summarys`.
 *
 * This is not a cosmetic edge case here. Four of the ten status names contain
 * an em dash, so it affects every report on the majority of rows, and the app
 * writes typographic quotes into its own copy.
 *
 * Mapping to ASCII rather than embedding a Unicode font is the deliberate
 * trade: embedding Carlito plus Open Sans means roughly a megabyte of base64
 * TTF in a chunk that is already dynamically imported for size. Doing that
 * would ALSO deliver §13's typography, so it remains the better eventual fix —
 * but a hyphen where an em dash belongs is a normal-looking business document,
 * and a missing character is a bug the reader sees.
 *
 * Note `·` (U+00B7) and `°` are IN WinAnsi and render fine — only these need
 * mapping.
 */
const UNRENDERABLE: [RegExp, string][] = [
  [/[\u2014\u2015]/g, "-"], // em dash, horizontal bar
  [/\u2013/g, "-"], // en dash
  [/[\u2018\u2019\u201B]/g, "'"], // curly single quotes
  [/[\u201C\u201D\u201F]/g, '"'], // curly double quotes
  [/\u2026/g, "..."], // ellipsis
  [/\u2022/g, "-"], // bullet
  [/\u00A0/g, " "], // non-breaking space
  [/[\u200B-\u200D\uFEFF]/g, ""], // zero-width junk
];

/** Make one string safe for a built-in PDF font. */
export function pdfSafe(s: string): string {
  let out = s;
  for (const [re, to] of UNRENDERABLE) out = out.replace(re, to);
  return out;
}

/**
 * Route EVERY string the document draws through `pdfSafe`.
 *
 * Wrapping the instance's `text` rather than sanitising at call sites, because
 * the call sites are not all ours: autoTable draws its own cells, and any
 * generator added later would have to remember. One wrap covers all of it, and
 * there is no way to forget.
 */
export function makeTextSafe(doc: jsPDF): void {
  const original = doc.text.bind(doc);
  const fix = (t: unknown): unknown =>
    typeof t === "string" ? pdfSafe(t) : Array.isArray(t) ? t.map(fix) : t;

  doc.text = ((text: string | string[], ...rest: unknown[]) =>
    (original as (...a: unknown[]) => unknown)(fix(text), ...rest)) as typeof doc.text;
}

/** The logo's true aspect, from the 315×94 asset in public/. */
const LOGO_ASPECT = 315 / 94;

let logoDataUrl: string | null | undefined;

/**
 * The Kognoz mark as a data URL, fetched once per page load.
 *
 * jsPDF's `addImage` accepts a URL string, but it then relies on the image
 * already being decodable synchronously — which is a race, and v1 wrapped every
 * call in a bare try/catch that silently produced logo-less PDFs when it lost.
 * Fetching once and caching the data URL removes the race instead of swallowing
 * it. `null` means we tried and failed; the reports still generate, because a
 * missing logo is not worth failing a client report over.
 */
export async function loadLogo(): Promise<string | null> {
  if (logoDataUrl !== undefined) return logoDataUrl;
  try {
    const res = await fetch("/kognoz-logo.png");
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    logoDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("logo read failed"));
      reader.readAsDataURL(blob);
    });
  } catch {
    logoDataUrl = null;
  }
  return logoDataUrl;
}

/**
 * Draw the logo with its top-left at (x, topY), scaled to `maxH` tall.
 *
 * `topY` is the literal top edge — no anchor arithmetic. v1 once computed the
 * position from three-quarters of the height and that produced two separate
 * misalignment bugs; its own comment says the direct form "removes that whole
 * bug class rather than patching y-values". Kept exactly that way.
 *
 * The asset has a WHITE ground and no transparency, so it must never be drawn
 * straight onto the deep-blue cover — callers put a white chip behind it.
 */
export function addLogo(
  doc: jsPDF,
  logo: string | null,
  x: number,
  topY: number,
  maxH: number,
): void {
  if (!logo) return;
  try {
    doc.addImage(logo, "PNG", x, topY, maxH * LOGO_ASPECT, maxH);
  } catch {
    // A report without a logo beats no report.
  }
}

/** The logo on a white chip, for use on the coloured cover. */
function logoOnChip(
  doc: jsPDF,
  logo: string | null,
  centreX: number,
  topY: number,
  h: number,
): void {
  if (!logo) return;
  const w = h * LOGO_ASPECT;
  const pad = 3;
  doc.setFillColor(...BRAND_RGB.white);
  doc.roundedRect(centreX - w / 2 - pad, topY - pad, w + pad * 2, h + pad * 2, 1.5, 1.5, "F");
  addLogo(doc, logo, centreX - w / 2, topY, h);
}

const LONG_DATE: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "long",
  year: "numeric",
};

export interface CoverOptions {
  /** Small caps line above the title, e.g. "INTEGRATION STATUS REPORT". */
  kicker: string;
  /** Usually the client name. */
  title: string;
  /** e.g. "Period: 01 Aug 2026 - 31 Aug 2026". Shifts the rule down. */
  period?: string;
  /** Replaces the default "Prepared by Kognoz Consulting" footer line. */
  footer?: string;
}

/** The full-bleed brand cover. Draws onto the CURRENT page. */
export function cover(
  doc: jsPDF,
  logo: string | null,
  opts: CoverOptions,
): void {
  const { w, h } = PAGE;

  doc.setFillColor(...BRAND_RGB.deepBlue);
  doc.rect(0, 0, w, h, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_RGB.onBrandLight);
  doc.text(opts.kicker, w / 2, 58, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.setTextColor(...BRAND_RGB.white);
  // Wrapped, because a long client name at 34pt runs off a 297mm page and v1
  // simply let it.
  const titleLines = doc.splitTextToSize(opts.title, w - 60) as string[];
  doc.text(titleLines, w / 2, 80, { align: "center" });

  let ruleY = 92 + (titleLines.length - 1) * 12;

  if (opts.period) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(...BRAND_RGB.onBrandLight);
    doc.text(opts.period, w / 2, ruleY + 3, { align: "center" });
    ruleY += 8;
  }

  doc.setFillColor(...BRAND_RGB.sky);
  doc.rect(w / 2 - 12, ruleY, 24, 1, "F");

  logoOnChip(doc, logo, w / 2, h - 33.5, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...BRAND_RGB.onBrandLight);
  doc.text(opts.footer ?? "Prepared by Kognoz Consulting", w / 2, h - 9, {
    align: "center",
  });

  doc.setFontSize(10);
  doc.setTextColor(...BRAND_RGB.muted);
  doc.text(new Date().toLocaleDateString("en-IN", LONG_DATE), w / 2, h - 4, {
    align: "center",
  });
}

/**
 * The 14mm brand strip at the top of a content page.
 *
 * Safe to call from autoTable's `didDrawPage`, which is how every continuation
 * page gets one.
 */
export function headerBar(
  doc: jsPDF,
  logo: string | null,
  title: string,
  right?: string,
  titleSize = 11,
): void {
  const { w } = PAGE;
  doc.setFillColor(...BRAND_RGB.deepBlue);
  doc.rect(0, 0, w, 14, "F");
  logoOnChip(doc, logo, 10 + (10 * LOGO_ASPECT) / 2, 2, 10);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(titleSize);
  doc.setTextColor(...BRAND_RGB.white);
  doc.text(title, 58, 9.5);

  if (right) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(right, w - 10, 9.5, { align: "right" });
  }
}

/** The closing page. Identical in every report, which is why it lives here. */
export function thankYou(doc: jsPDF, logo: string | null): void {
  const { w, h } = PAGE;
  doc.addPage();
  doc.setFillColor(...BRAND_RGB.deepBlue);
  doc.rect(0, 0, w, h, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.setTextColor(...BRAND_RGB.white);
  doc.text("Thank You", w / 2, h / 2 - 8, { align: "center" });

  doc.setFillColor(...BRAND_RGB.sky);
  doc.rect(w / 2 - 10, h / 2, 20, 1, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_RGB.onBrandLight);
  doc.text("Kognoz · HR Transformation & Consulting", w / 2, h / 2 + 10, {
    align: "center",
  });

  logoOnChip(doc, logo, w / 2, h / 2 + 18, 18);
}

/**
 * Shared autoTable header styling, so the generators cannot drift apart.
 *
 * Handoff §13: header rows are `#005184` with white text. The tuple types line
 * up with autotable v5's `Color`, which is `[number, number, number]` — the
 * same shape as `Rgb`, so no casting is needed and a wrong-length array is a
 * compile error rather than a silently black table head.
 */
export const TABLE_HEAD_STYLES = {
  fillColor: BRAND_RGB.deepBlue,
  textColor: BRAND_RGB.white,
  fontStyle: "bold",
  fontSize: 9,
} as const;

/* ─────────────────────────────────── the "All Updates & Next" cell */

/**
 * Both the Integration and Implementation appendices end in one wide cell
 * holding a phase or integration's entire update history plus its next action.
 * It is custom-painted rather than left to autoTable because it mixes weights
 * and colours within one cell, which a table cell cannot express.
 *
 * The height calculation and the painter MUST agree exactly, which is why they
 * live together and share `UPD_LH`. v1's Implementation report sized this cell
 * by stuffing a fake string into it and letting autoTable measure — and its own
 * comment in the Integration report records that the mismatch between guessed
 * and drawn height was the actual cause of the oversized gaps people reported.
 * Measuring what will really be drawn is the fix, so both reports use it here.
 */

export const UPD_LH = 3.3;

export interface UpdatesCell {
  updates: ActivityEntry[];
  nextText: string;
}

/** Exactly the height `paintUpdatesCell` will need. */
export function updatesCellHeight(
  doc: jsPDF,
  meta: UpdatesCell,
  maxW: number,
): number {
  let h = 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  h += UPD_LH;

  if (meta.updates.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    for (const t of meta.updates) {
      h += UPD_LH;
      h += (doc.splitTextToSize(t.update ?? "", maxW) as string[]).length * UPD_LH + UPD_LH;
    }
  } else {
    h += UPD_LH * 2;
  }

  h += UPD_LH;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  h +=
    (doc.splitTextToSize(meta.nextText || "No next action noted.", maxW) as string[])
      .length * UPD_LH;

  // Caps one pathological row at about an extra page rather than letting a
  // measurement error produce runaway blank pages.
  return Math.min(h + 4, 180);
}

/**
 * Draw it.
 *
 * `dimOlder` de-emphasises everything but the latest entry — nothing is
 * dropped, the full history still prints, but the update that matters now is
 * not buried at equal weight. v1 did this on the Integration report and not on
 * the Implementation one; there is no reason for them to differ, so both do.
 */
export function paintUpdatesCell(
  doc: jsPDF,
  meta: UpdatesCell,
  cell: CellHookData["cell"],
  rowIndex: number,
  ink: Rgb,
  muted: Rgb,
): void {
  doc.setFillColor(...(rowIndex % 2 ? BRAND_RGB.white : ZEBRA_RGB));
  doc.rect(cell.x, cell.y, cell.width, cell.height, "F");

  const x = cell.x + 3;
  const maxW = cell.width - 6;
  let y = cell.y + 4;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ink);
  doc.text(`Updates (${meta.updates.length}):`, x, y);
  y += UPD_LH;

  if (meta.updates.length) {
    meta.updates.forEach((t, idx) => {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...(idx === 0 ? ink : muted));
      doc.text(`(${fmtDate(t.date)})`, x, y);
      y += UPD_LH;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...muted);
      const lines = doc.splitTextToSize(t.update ?? "", maxW) as string[];
      doc.text(lines, x, y);
      y += lines.length * UPD_LH + UPD_LH;
    });
  } else {
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...muted);
    doc.text("No updates yet.", x, y);
    y += UPD_LH * 2;
  }

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...ink);
  doc.text("Next:", x, y);
  y += UPD_LH;
  doc.setFont("helvetica", meta.nextText ? "normal" : "italic");
  doc.setTextColor(...muted);
  doc.text(
    doc.splitTextToSize(meta.nextText || "No next action noted.", maxW) as string[],
    x,
    y,
  );
}
