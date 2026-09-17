import type { jsPDF } from "jspdf";
import type { CellHookData } from "jspdf-autotable";
import { isOverdue, daysOverdue } from "@/lib/domain/integrations";
import { fmtDate } from "@/lib/utils/dates";
import { STATUSES } from "@/lib/domain/constants";
import {
  reportSortWorstFirst,
  reportTopRisks,
  reportRiskReason,
  reportRagReason,
  reportMilestoneCounts,
  reportDonutSegments,
  buildDonutDataUrl,
  type RagReason,
} from "./integration-report-helpers";
import {
  BRAND_RGB,
  ZEBRA_RGB,
  statusRgb,
  ragRgb,
  tint,
  hexToRgb,
  type Rgb,
} from "./palette";
import {
  PAGE,
  loadLogo,
  cover,
  headerBar,
  thankYou,
  makeTextSafe,
  updatesCellHeight,
  paintUpdatesCell,
  TABLE_HEAD_STYLES,
} from "./pdf-doc";
import { exportFilename, downloadBlob, blobToBase64 } from "./download";
import type { Client, Integration, ActivityEntry } from "@/lib/domain/types";

/**
 * The Integration Status Report.
 *
 * The most-used export in the system and the one the client-email path
 * attaches, so it is the first ported and the one to check hardest.
 *
 * Structure, unchanged from v1 because the structure is the point:
 *   1. Brand cover
 *   2. PART 1 — Executive Summary, one page, deliberately safe to forward on
 *      its own to someone who will never read the appendix
 *   3. PART 2 — divider with a grouped index
 *   4. PART 2 — the appendix table, worst-first, full update history
 *   5. Thank you
 *
 * Everything is drawn in millimetres on landscape A4 (297 × 210).
 */

const { w: W, h: H } = PAGE;

/** Muted body greys, from the brand's ink/muted rather than v1's Tailwind greys. */
const INK: Rgb = BRAND_RGB.ink;
const MUTED: Rgb = BRAND_RGB.muted;
const FAINT: Rgb = hexToRgb("#A1A1AA");

interface DetailRow {
  status: string;
  overdue: boolean;
  updates: ActivityEntry[];
  nextText: string;
  row: string[];
}

export interface IntegrationPdfResult {
  blob: Blob;
  filename: string;
  /** Raw base64, ready for `clientEmailSend.attachment.contentBase64`. */
  base64: string;
}

/**
 * Generate the report.
 *
 * `returnBlob` gives the bytes back instead of downloading them, which is how
 * the client-email dialog gets its attachment. v1 called that `returnDoc` and
 * returned base64 only; this returns the Blob too, so the same call can serve a
 * download and a preview later without regenerating.
 */
export async function exportIntegrationPdf(
  client: Client,
  opts: { returnBlob?: boolean } = {},
): Promise<IntegrationPdfResult | void> {
  // Dynamic so neither library lands in the main chunk. jspdf-autotable v5
  // exports a function taking the doc, unlike v3 which patched the prototype.
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm" });
  // Before anything is drawn: the built-in fonts drop em dashes and curly
  // quotes without complaint, and four status names contain an em dash.
  makeTextSafe(doc);
  const integrations = client.integrations ?? [];

  /* ─────────────────────────────────────────────────── 1. cover */

  cover(doc, logo, {
    kicker: "INTEGRATION STATUS REPORT",
    title: client.name,
  });

  /* ──────────────────────────────────── 2. PART 1 · exec summary */

  doc.addPage();
  headerBar(doc, logo, "PART 1 · Executive Summary", client.name);

  drawRagBanner(doc, 10, 20, 277, reportRagReason(client));

  // Left card — what needs attention, and the milestone tally.
  doc.setDrawColor(...BRAND_RGB.hairline);
  doc.setLineWidth(0.3);
  doc.roundedRect(10, 42, 160, 62, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_RGB.deepBlue);
  doc.text("TOP ITEMS NEEDING ATTENTION", 14, 49);

  const topRisks = reportTopRisks(client, 3);
  if (!topRisks.length) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text("No items currently flagged — portfolio healthy.", 14, 58);
  } else {
    topRisks.forEach((i, idx) => {
      const ry = 56 + idx * 8.5;
      doc.setFillColor(...statusRgb(i.status));
      doc.circle(16, ry - 1.5, 1.3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(...INK);
      // Truncated: a long integration name at 8.5pt overruns the 160mm card
      // and lands on top of the donut. v1 let it.
      doc.text(clip(doc, i.name, 148), 20, ry);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text(reportRiskReason(i), 20, ry + 3.7);
    });
  }

  const ms = reportMilestoneCounts(client);
  if (ms.total > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...BRAND_RGB.deepBlue);
    doc.text("MILESTONES", 14, 87);

    const chips = [
      { l: "Achieved", v: ms.achieved, base: BRAND_RGB.positive },
      { l: "Pending", v: ms.pending, base: BRAND_RGB.warning },
      { l: "Missed", v: ms.missed, base: BRAND_RGB.critical },
    ];
    chips.forEach((m, idx) => {
      const mx = 14 + idx * 51;
      doc.setFillColor(...tint(m.base, 0.86));
      doc.roundedRect(mx, 90, 47, 11, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...darken(m.base));
      doc.text(String(m.v), mx + 5, 97);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.text(m.l, mx + 15, 97);
    });
  }

  // Right card — the status-mix donut and its legend.
  doc.setDrawColor(...BRAND_RGB.hairline);
  doc.roundedRect(180, 42, 107, 62, 2, 2, "S");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...BRAND_RGB.deepBlue);
  doc.text("STATUS MIX", 184, 49);

  const segments = reportDonutSegments(client);
  if (segments.length) {
    try {
      doc.addImage(buildDonutDataUrl(segments), "PNG", 184, 53, 32, 32);
    } catch {
      // No canvas (or a tainted one) loses the chart, not the report.
    }
  }
  const segTotal = segments.reduce((s, x) => s + x.count, 0) || 1;
  let ly = 58;
  for (const seg of segments) {
    doc.setFillColor(...hexToRgb(seg.hex));
    doc.rect(220, ly - 2.2, 2.6, 2.6, "F");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(seg.status, 224, ly);
    doc.setFont("helvetica", "bold");
    doc.text(
      `${seg.count} · ${Math.round((seg.count / segTotal) * 100)}%`,
      284,
      ly,
      { align: "right" },
    );
    ly += 7;
  }

  // Legend strip — the app-wide meaning of each colour, so the page really can
  // stand alone.
  let lx = 10;
  const legY = 113;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BRAND_RGB.deepBlue);
  doc.text("Legend:", lx, legY);
  lx += doc.getTextWidth("Legend:") + 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  const legend: [string, string][] = [
    ["At Risk — action needed", "At Risk"],
    ["On Hold—Client — waiting on you", "On Hold — Client"],
    ["On Hold—Internal — waiting on Kognoz", "On Hold — Internal"],
    ["In Progress — on track", "In Progress"],
    ["Completed", "Completed"],
  ];
  for (const [label, status] of legend) {
    doc.setFillColor(...statusRgb(status));
    doc.roundedRect(lx, legY - 2.6, 2.6, 2.6, 0.5, 0.5, "F");
    doc.setTextColor(...MUTED);
    doc.text(label, lx + 4, legY);
    lx += 4 + doc.getTextWidth(label) + 7;
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7);
  doc.setTextColor(...FAINT);
  doc.text(
    "This page is designed to stand alone — safe to forward to leadership without the appendix. Full detail on Part 2, next page.",
    10,
    203,
  );

  /* ─────────────────────────────── 3. PART 2 divider + mini index */

  doc.addPage();
  doc.setFillColor(...ZEBRA_RGB);
  doc.rect(0, 0, W, H, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_RGB.sky);
  doc.text("PART 2", W / 2, 50, { align: "center" });
  doc.setFontSize(24);
  doc.setTextColor(...BRAND_RGB.deepBlue);
  doc.text("Detailed Appendix", W / 2, 62, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(
    doc.splitTextToSize(
      "Integration-by-integration detail, full update history, and next actions for the working team. Sorted worst-first, same order as the Executive Summary’s Top Items list.",
      170,
    ),
    W / 2,
    71,
    { align: "center" },
  );

  // Grouped by status in severity order, capped so the index stays one page.
  const groups = STATUSES.map((st) => ({
    st,
    items: reportSortWorstFirst(integrations.filter((i) => i.status === st)),
  })).filter((g) => g.items.length);

  const MAX_ROWS = 18;
  let rowsUsed = 0;
  let truncated = 0;
  const renderGroups: { st: string; items: Integration[] }[] = [];
  for (const g of groups) {
    if (rowsUsed >= MAX_ROWS) {
      truncated += g.items.length;
      continue;
    }
    const take = g.items.slice(0, MAX_ROWS - rowsUsed);
    renderGroups.push({ st: g.st, items: take });
    rowsUsed += 1 + take.length;
    if (take.length < g.items.length) truncated += g.items.length - take.length;
  }

  const boxH = Math.min(
    100,
    10 +
      renderGroups.reduce((s, g) => s + 5 + g.items.length * 4.3, 0) +
      (truncated ? 5 : 0),
  );
  const boxX = (W - 160) / 2;
  const boxY = 90;
  doc.setDrawColor(...BRAND_RGB.hairline);
  doc.roundedRect(boxX, boxY, 160, boxH, 2, 2, "S");

  let ty = boxY + 7;
  for (const g of renderGroups) {
    const rgb = statusRgb(g.st);
    // A LIGHT TINT with coloured text, never a solid fill with white text.
    // White-on-colour reads fine for the dark statuses and goes almost
    // invisible for the light ones — Cancelled grey, Pending Client olive.
    doc.setFillColor(...tint(rgb));
    doc.rect(boxX, ty - 3.6, 160, 5, "F");
    doc.setFillColor(...rgb);
    doc.rect(boxX, ty - 3.6, 1.6, 5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...darken(rgb));
    doc.text(g.st, boxX + 5, ty);
    ty += 5;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.8);
    doc.setTextColor(...INK);
    for (const i of g.items) {
      doc.text(i.name.length > 62 ? `${i.name.slice(0, 60)}…` : i.name, boxX + 4, ty);
      ty += 4.3;
    }
  }
  if (truncated > 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text(`+${truncated} more — see appendix`, boxX + 4, ty);
  }

  /* ──────────────────────────────────── 4. appendix detail table */

  doc.addPage();
  const sorted = reportSortWorstFirst(integrations);

  const detailRows: DetailRow[] = sorted.map((i) => {
    const overdue = isOverdue(i);
    const dueCell = i.dueDate ? fmtDate(i.dueDate) : "—";
    return {
      status: i.status,
      overdue,
      // Newest-first already: the API stores activity newest-first, matching
      // v1's unshift-on-add.
      updates: i.timeline ?? [],
      nextText: i.nextAction ?? "",
      row: [
        "",
        i.name,
        i.assignee || "Unassigned",
        i.status,
        overdue ? `${dueCell}\n${daysOverdue(i)}d OVERDUE` : dueCell,
        "",
      ],
    };
  });

  autoTable(doc, {
    startY: 16,
    margin: { top: 16, left: 10, right: 10, bottom: 10 },
    head: [["", "Integration", "Assignee", "Status", "Due Date", "All Updates & Next Steps"]],
    body: detailRows.map((d) => d.row),
    headStyles: TABLE_HEAD_STYLES,
    styles: { fontSize: 8, cellPadding: 3, valign: "top" },
    alternateRowStyles: { fillColor: ZEBRA_RGB },
    // FIXED widths, not 'auto'. v1's note is explicit that 'auto' on the last
    // column produced runaway blank pages. 3+50+35+28+32+129 = 277 = 297-10-10.
    columnStyles: {
      0: { cellWidth: 3 },
      1: { cellWidth: 50 },
      2: { cellWidth: 35 },
      3: { cellWidth: 28 },
      4: { cellWidth: 32 },
      5: { cellWidth: 129 },
    },
    didParseCell: (d: CellHookData) => {
      if (d.section !== "body") return;
      const meta = detailRows[d.row.index];
      if (!meta) return;

      if (d.column.index === 0) {
        // A 3mm status stripe down the left edge of the row.
        d.cell.styles.fillColor = statusRgb(meta.status);
        d.cell.text = [""];
      }
      if (d.column.index === 3) {
        d.cell.styles.textColor = darken(statusRgb(meta.status));
        d.cell.styles.fontStyle = "bold";
      }
      if (d.column.index === 4 && meta.overdue) {
        d.cell.styles.textColor = BRAND_RGB.critical;
        d.cell.styles.fontStyle = "bold";
      }
      if (d.column.index === 5) {
        d.cell.text = [""];
        d.cell.styles.minCellHeight = updatesCellHeight(doc, meta, d.cell.width - 6);
      }
    },
    didDrawCell: (d: CellHookData) => {
      if (d.section !== "body" || d.column.index !== 5) return;
      const meta = detailRows[d.row.index];
      if (!meta) return;
      paintUpdatesCell(doc, meta, d.cell, d.row.index, INK, MUTED);
    },
    didDrawPage: () => {
      headerBar(doc, logo, "Appendix — Integration Detail", client.name, 12);
    },
  });

  /* ───────────────────────────────────────────────── 5. thank you */

  thankYou(doc, logo);

  const filename = exportFilename(client.name, "Integration_Report", "pdf");
  const blob = doc.output("blob");

  if (opts.returnBlob) {
    return { blob, filename, base64: await blobToBase64(blob) };
  }
  downloadBlob(blob, filename);
}

/* ------------------------------------------------------------------ bits */

/** The RAG banner across the top of the executive summary. */
function drawRagBanner(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  info: RagReason,
): void {
  const line = info.label === "—" ? BRAND_RGB.muted : ragRgb(info.label);
  doc.setDrawColor(...line);
  doc.setFillColor(...tint(line, 0.92));
  doc.setLineWidth(0.4);
  doc.roundedRect(x, y, w, 18, 2, 2, "FD");

  doc.setFillColor(...line);
  doc.circle(x + 8, y + 9, 2.6, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...darken(line));
  doc.text(`Portfolio Health: ${info.label.toUpperCase()}`, x + 16, y + 7.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(info.reason, x + 16, y + 13.5);
}

/**
 * A fill colour darkened enough to be readable as text on white.
 *
 * The design system solves this with paired `fill`/`text` tokens, but the
 * `text` half is a CSS `var()` and unusable outside the DOM. Rather than
 * transcribe ten more hexes that would then drift from the stylesheet, this
 * derives one: the status fills are mid-tone, and 55% toward black clears AA on
 * white for every one of them.
 */
function darken(rgb: Rgb, amount = 0.45): Rgb {
  return rgb.map((v) => Math.round(v * amount)) as Rgb;
}

/** Truncate to fit a width, with an ellipsis. */
function clip(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let s = text;
  while (s.length > 1 && doc.getTextWidth(`${s}…`) > maxW) s = s.slice(0, -1);
  return `${s}…`;
}
