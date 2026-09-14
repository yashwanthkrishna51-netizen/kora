import type { CellHookData } from "jspdf-autotable";
import { fmtDate } from "@/lib/utils/dates";
import {
  amsTotals,
  entryDate,
  entryType,
  entryRaisedBy,
} from "@/lib/domain/ams";
import { BRAND_RGB, ZEBRA_RGB, statusRgb, type Rgb } from "./palette";
import {
  loadLogo,
  cover,
  headerBar,
  thankYou,
  makeTextSafe,
  TABLE_HEAD_STYLES,
} from "./pdf-doc";
import { exportFilename, downloadBlob, blobToBase64 } from "./download";
import type { Client } from "@/lib/domain/types";

/**
 * The AMS Activity Report.
 *
 * ADMIN ONLY, preserving v1. There, the whole export menu sat inside a
 * `can('admin')` branch on the AMS screen, so an editor never saw it — and the
 * handler re-checked. This report shows every support hour logged against a
 * client over a period, which is the input to what they are billed; it is not
 * the same class of document as the tracker screens it sits beside.
 *
 * The DATE WINDOW IS PASSED IN, not read from anywhere. v1 reached into
 * `S.amsFrom` / `S.amsTo` — module-level state belonging to the AMS screen —
 * which meant the report silently depended on a filter set somewhere else, and
 * the portfolio export inherited whatever the AMS page had last been left on.
 */

const MUTED: Rgb = BRAND_RGB.muted;

/** Status colours for the entry-status column. Not the tracker STATUSES. */
const ENTRY_STATUS_RGB: Record<string, Rgb> = {
  Open: BRAND_RGB.sky,
  "In Progress": statusRgb("In Progress"),
  Closed: statusRgb("Completed"),
};

export interface AmsRange {
  from: string;
  to: string;
}

export interface AmsPdfResult {
  blob: Blob;
  filename: string;
  base64: string;
}

/** "01 Aug 2026 - 31 Aug 2026", or "All Time" when unbounded. */
function periodLabel({ from, to }: AmsRange): string {
  if (!from && !to) return "All Time";
  return `${from ? fmtDate(from) : "Start"} - ${to ? fmtDate(to) : "Today"}`;
}

export async function exportAmsActivityPdf(
  client: Client,
  range: AmsRange,
  opts: { returnBlob?: boolean } = {},
): Promise<AmsPdfResult | void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm" });
  makeTextSafe(doc);

  const totals = amsTotals(client, range.from, range.to);
  // ASCENDING here, unlike every other report: this reads as a chronological
  // record of work done, not a worst-first triage list. Copied before sorting —
  // v1's portfolio export called `.sort()` on `c.workLog` directly and mutated
  // shared application state as a side effect of generating a PDF.
  const entries = [...totals.log].sort((a, b) =>
    entryDate(a).localeCompare(entryDate(b)),
  );
  const period = periodLabel(range);

  /* ─────────────────────────────────────────────────── 1. cover */

  cover(doc, logo, {
    kicker: "AMS ACTIVITY REPORT",
    title: client.name,
    period: `Period: ${period}`,
  });

  /* ──────────────────────────────────────── 2. summary + table */

  doc.addPage();
  headerBar(doc, logo, "AMS Activity Log", client.name);

  const closed = entries.filter((e) => e.entryStatus === "Closed").length;
  const inProgress = entries.filter((e) => e.entryStatus === "In Progress").length;
  const open = entries.filter((e) => (e.entryStatus ?? "Open") === "Open").length;

  const stats: { label: string; value: string; fill: Rgb }[] = [
    { label: "Total Entries", value: String(entries.length), fill: BRAND_RGB.deepBlue },
    { label: "Total Hours", value: totals.totalHours.toFixed(1), fill: BRAND_RGB.muted },
    { label: "Open", value: String(open), fill: ENTRY_STATUS_RGB.Open },
    { label: "In Progress", value: String(inProgress), fill: ENTRY_STATUS_RGB["In Progress"] },
    { label: "Closed", value: String(closed), fill: ENTRY_STATUS_RGB.Closed },
  ];

  stats.forEach((s, i) => {
    const x = 10 + i * 57;
    doc.setFillColor(...s.fill);
    doc.roundedRect(x, 18, 50, 20, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...BRAND_RGB.white);
    doc.text(s.value, x + 25, 30, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(s.label, x + 25, 37, { align: "center" });
  });

  autoTable(doc, {
    startY: 42,
    margin: { top: 18, left: 8, right: 8, bottom: 10 },
    head: [[
      "#", "Date Raised", "Raised By", "Module", "Project", "Description",
      "Type", "Level", "Dependencies", "Status", "Solution", "Mode", "Hrs",
    ]],
    body: entries.map((e, i) => [
      String(i + 1),
      fmtDate(entryDate(e)),
      entryRaisedBy(e),
      e.module || "-",
      e.project || "-",
      e.description || "-",
      entryType(e),
      e.queryLevel || "-",
      e.dependencies || "-",
      e.entryStatus || "Open",
      e.solution || "-",
      e.modeOfSupport || "-",
      Number(e.hours ?? 0).toFixed(1),
    ]),
    headStyles: { ...TABLE_HEAD_STYLES, fontSize: 7.5 },
    styles: { fontSize: 7, cellPadding: 2, valign: "top", overflow: "linebreak" },
    alternateRowStyles: { fillColor: ZEBRA_RGB },
    // Thirteen columns on 281mm. Description and Solution take what is left,
    // because they are the two that genuinely vary in length.
    columnStyles: {
      0: { cellWidth: 8, halign: "center" },
      1: { cellWidth: 22 },
      2: { cellWidth: 24 },
      3: { cellWidth: 24 },
      4: { cellWidth: 22 },
      5: { cellWidth: "auto" },
      6: { cellWidth: 20 },
      7: { cellWidth: 18 },
      8: { cellWidth: 22 },
      9: { cellWidth: 20 },
      10: { cellWidth: "auto" },
      11: { cellWidth: 20 },
      12: { cellWidth: 12, halign: "right" },
    },
    didParseCell: (d: CellHookData) => {
      if (d.section !== "body" || d.column.index !== 9) return;
      const rgb = ENTRY_STATUS_RGB[String(d.cell.raw ?? "")];
      if (rgb) {
        d.cell.styles.textColor = rgb.map((v) => Math.round(v * 0.45)) as Rgb;
        d.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: () => headerBar(doc, logo, "AMS Activity Log", client.name),
  });

  // Said plainly on the page, because a report covering a window is easy to
  // mistake for a complete record once it is printed and passed on.
  const finalY = (doc as unknown as { lastAutoTable: { finalY: number } })
    .lastAutoTable.finalY;
  if (finalY < 195) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(
      period === "All Time"
        ? "All work-log entries recorded for this client."
        : `Covers ${period} only. Entries outside this window are not shown.`,
      10,
      Math.min(finalY + 6, 200),
    );
  }

  /* ───────────────────────────────────────────── 3. thank you */

  thankYou(doc, logo);

  const filename = exportFilename(client.name, "AMS_Activity_Report", "pdf");
  const blob = doc.output("blob");
  if (opts.returnBlob) {
    return { blob, filename, base64: await blobToBase64(blob) };
  }
  downloadBlob(blob, filename);
}
