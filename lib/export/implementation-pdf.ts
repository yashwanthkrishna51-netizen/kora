import type { CellHookData } from "jspdf-autotable";
import { fmtDate } from "@/lib/utils/dates";
import { PHASES } from "@/lib/domain/constants";
import { implProgress, implAutoRag } from "@/lib/domain/implementation";
import { BRAND_RGB, ZEBRA_RGB, statusRgb, type Rgb } from "./palette";
import {
  loadLogo,
  cover,
  headerBar,
  thankYou,
  makeTextSafe,
  updatesCellHeight,
  paintUpdatesCell,
  TABLE_HEAD_STYLES,
  type UpdatesCell,
} from "./pdf-doc";
import { exportFilename, downloadBlob, blobToBase64 } from "./download";
import type { Client, Phase } from "@/lib/domain/types";

/**
 * The Implementation Status Report.
 *
 * Three parts after the cover: a summary page carrying the module × phase
 * matrix — the same grid the tracker screen shows — then one detail row per
 * phase with its full update history, then the closing page.
 *
 * ALL NINE PHASES ARE ALWAYS LISTED, including ones a module has no row for.
 * v1 did this and it is right: the fixed nine-phase lifecycle is the point of
 * the report, and a phase missing from the data means "not started", not
 * "does not exist". Dropping it would make a module look further along than
 * it is.
 */

const INK: Rgb = BRAND_RGB.ink;
const MUTED: Rgb = BRAND_RGB.muted;

interface PhaseRow extends UpdatesCell {
  isHeader: boolean;
  status: string;
  row: string[];
}

export interface ImplementationPdfResult {
  blob: Blob;
  filename: string;
  base64: string;
}

export async function exportImplementationPdf(
  client: Client,
  opts: { returnBlob?: boolean } = {},
): Promise<ImplementationPdfResult | void> {
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const autoTable = autoTableModule.default;

  const logo = await loadLogo();
  const doc = new jsPDF({ orientation: "landscape", format: "a4", unit: "mm" });
  makeTextSafe(doc);

  const modules = client.modules ?? [];

  /* ─────────────────────────────────────────────────── 1. cover */

  cover(doc, logo, {
    kicker: "IMPLEMENTATION STATUS REPORT",
    title: client.name,
  });

  /* ──────────────────────────────── 2. summary page + the matrix */

  doc.addPage();

  const allPhases = modules.flatMap((m) => m.phases ?? []);
  const counts: Record<string, number> = {};
  for (const p of allPhases) counts[p.status] = (counts[p.status] ?? 0) + 1;

  const stats: { label: string; value: number; fill: Rgb }[] = [
    { label: "Modules", value: modules.length, fill: BRAND_RGB.deepBlue },
    { label: "Total Phases", value: allPhases.length, fill: BRAND_RGB.muted },
    { label: "In Progress", value: counts["In Progress"] ?? 0, fill: statusRgb("In Progress") },
    { label: "At Risk", value: counts["At Risk"] ?? 0, fill: statusRgb("At Risk") },
    { label: "Completed", value: counts.Completed ?? 0, fill: statusRgb("Completed") },
  ];

  stats.forEach((s, i) => {
    const x = 10 + i * 57;
    doc.setFillColor(...s.fill);
    doc.roundedRect(x, 18, 50, 20, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...BRAND_RGB.white);
    doc.text(String(s.value), x + 25, 30, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(s.label, x + 25, 37, { align: "center" });
  });

  // One line of context the matrix cannot carry: the overall RAG and progress.
  const progress = implProgress(client);
  const rag = implAutoRag(client);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  doc.text(
    `RAG: ${rag ?? "—"} · ${progress.completed}/${progress.total} phases complete (${progress.pct}%)`,
    10,
    45,
  );

  autoTable(doc, {
    startY: 49,
    margin: { top: 16, left: 10, right: 10, bottom: 10 },
    head: [["Module", ...PHASES]],
    body: modules.map((m) => [
      m.name,
      ...PHASES.map((phName) => {
        const ph = (m.phases ?? []).find((x) => x.name === phName);
        const status = ph?.status ?? "Not Started";
        // Status first, then the two things a reader asks next. The status must
        // stay on line ONE — didParseCell colours the cell by reading it.
        return [
          status,
          ph?.targetDate ? fmtDate(ph.targetDate) : "",
          ph?.assignee ?? "",
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ]),
    headStyles: { ...TABLE_HEAD_STYLES, fontSize: 7.5 },
    styles: { fontSize: 7, cellPadding: 2.5, valign: "middle", halign: "center" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold", cellWidth: 38 } },
    alternateRowStyles: { fillColor: ZEBRA_RGB },
    didParseCell: (d: CellHookData) => {
      if (d.section !== "body" || d.column.index === 0) return;
      // The first line is the status; the rest is date and assignee.
      const status = String(d.cell.raw ?? "").split("\n")[0];
      d.cell.styles.textColor = darken(statusRgb(status));
      d.cell.styles.fontStyle = "bold";
    },
    didDrawPage: () => headerBar(doc, logo, "Implementation Summary", client.name),
  });

  /* ────────────────────────────────────────── 3. phase detail */

  doc.addPage();

  const detailRows: PhaseRow[] = [];
  for (const m of modules) {
    detailRows.push({
      isHeader: true,
      status: "",
      updates: [],
      nextText: "",
      row: ["", m.name, "", "", "", ""],
    });
    for (const phName of PHASES) {
      const ph: Partial<Phase> =
        (m.phases ?? []).find((x) => x.name === phName) ?? {};
      detailRows.push({
        isHeader: false,
        status: ph.status ?? "Not Started",
        updates: ph.updates ?? [],
        nextText: ph.nextAction ?? "",
        row: [
          "",
          phName,
          ph.status ?? "Not Started",
          ph.startDate ? fmtDate(ph.startDate) : "-",
          ph.targetDate ? fmtDate(ph.targetDate) : "-",
          "",
        ],
      });
    }
  }

  autoTable(doc, {
    startY: 16,
    margin: { top: 16, left: 10, right: 10, bottom: 10 },
    head: [["", "Phase", "Status", "Start Date", "Target Date", "All Updates & Next Action"]],
    body: detailRows.map((d) => d.row),
    headStyles: TABLE_HEAD_STYLES,
    styles: { fontSize: 8, cellPadding: 3, valign: "top" },
    alternateRowStyles: { fillColor: ZEBRA_RGB },
    // Fixed, summing to 277 = 297 - 10 - 10. v1 used 'auto' on the last column
    // here, which its own Integration-report comment blames for runaway blank
    // pages; the two reports now use the same measured approach.
    columnStyles: {
      0: { cellWidth: 3 },
      1: { cellWidth: 68 },
      2: { cellWidth: 30 },
      3: { cellWidth: 30 },
      4: { cellWidth: 30 },
      5: { cellWidth: 116 },
    },
    didParseCell: (d: CellHookData) => {
      if (d.section !== "body") return;
      const meta = detailRows[d.row.index];
      if (!meta) return;

      if (meta.isHeader) {
        // A module band across the full width.
        d.cell.styles.fillColor = BRAND_RGB.deepBlue;
        d.cell.styles.textColor = BRAND_RGB.white;
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fontSize = 9;
        if (d.column.index !== 1) d.cell.text = [""];
        return;
      }

      if (d.column.index === 0) {
        d.cell.styles.fillColor = statusRgb(meta.status);
        d.cell.text = [""];
      }
      if (d.column.index === 2) {
        d.cell.styles.textColor = darken(statusRgb(meta.status));
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
      if (!meta || meta.isHeader) return;
      paintUpdatesCell(doc, meta, d.cell, d.row.index, INK, MUTED);
    },
    didDrawPage: () =>
      headerBar(doc, logo, "Phase Details & Updates", client.name, 12),
  });

  /* ───────────────────────────────────────────── 4. thank you */

  thankYou(doc, logo);

  const filename = exportFilename(client.name, "Implementation_Report", "pdf");
  const blob = doc.output("blob");
  if (opts.returnBlob) {
    return { blob, filename, base64: await blobToBase64(blob) };
  }
  downloadBlob(blob, filename);
}

/** Readable as text on white. Same rule as the integration report. */
function darken(rgb: Rgb, amount = 0.45): Rgb {
  return rgb.map((v) => Math.round(v * amount)) as Rgb;
}
