import { fmtDate, fmtDateTime } from "@/lib/utils/dates";
import {
  entryDate,
  entryType,
  entryRaisedBy,
  amsTotals,
} from "@/lib/domain/ams";
import { implProgress } from "@/lib/domain/implementation";
import { BRAND } from "./palette";
import { exportFilename, downloadBlob } from "./download";
import type { Client, ActivityEntry } from "@/lib/domain/types";

/**
 * The spreadsheet exports.
 *
 * Four per-client sheets plus two portfolio-wide dumps, ported from
 * `kora/js/export.js:802-871`.
 *
 * ── WHY NOT `xlsx` ──
 * v1 used SheetJS and set `ws[cell].s = { font: { bold: true } }` on its header
 * row. That has never done anything: cell styling is a Pro-only feature and the
 * community build drops the property on write, silently. So every export this
 * app has ever produced had a plain header row while the code said otherwise.
 * 0.18.5 also carries two known CVEs.
 *
 * `write-excel-file` is 1.8 MB against exceljs's 21.8, is browser-first, and
 * styles cells for real — which handoff §13 requires: header rows in `#005184`
 * with white text.
 */

type Cell = string | number | null;

interface HeaderStyle {
  value: string;
  fontWeight: "bold";
  color: string;
  backgroundColor: string;
  align?: "left" | "right";
}

/**
 * §13's header row: deep blue, white, bold.
 *
 * §13 also asks for 10pt uppercase with letter-spacing. Neither uppercase-as-a-
 * style nor letter-spacing exists in the xlsx format — the closest is writing
 * the label already uppercased, which would then be what a person copying the
 * column name gets. The labels stay as written; the colour, which is the part
 * that carries the brand, is applied.
 */
function headerRow(labels: readonly string[]): HeaderStyle[] {
  return labels.map((value) => ({
    value,
    fontWeight: "bold" as const,
    color: BRAND.white,
    backgroundColor: BRAND.deepBlue,
  }));
}

/** Column widths, in characters. Long free-text columns get more room. */
function widths(labels: readonly string[]): { width: number }[] {
  return labels.map((l) => {
    const wide = /update|description|activity|action|solution|notes|agent/i.test(l);
    const narrow = /^(#|hrs|hours|status|role|level|rag)$/i.test(l);
    return { width: wide ? 60 : narrow ? 10 : Math.max(14, l.length + 4) };
  });
}

/**
 * Build and download one sheet.
 *
 * Dynamic import so the library never reaches the main chunk. `toBlob` rather
 * than `toFile` because the download helper is shared with the PDF path — one
 * place decides how a file reaches the user.
 */
async function writeSheet(
  labels: readonly string[],
  rows: Cell[][],
  sheetName: string,
  filename: string,
): Promise<void> {
  // `/browser`, not the bare package: it exposes no root export, and the node
  // entry pulls in fs. Getting this wrong is a build error, not a runtime one.
  const writeXlsxFile = (await import("write-excel-file/browser")).default;
  const blob = await writeXlsxFile([headerRow(labels), ...rows], {
    sheet: sheetName,
    columns: widths(labels),
    stickyRowsCount: 1,
  }).toBlob();
  downloadBlob(blob, filename);
}

/** Activity entries flattened into one cell, newest first, as v1 did. */
function joinUpdates(entries: ActivityEntry[] | undefined): string {
  return (entries ?? [])
    .map((t) => `(${fmtDate(t.date)}) ${t.update ?? ""}`)
    .join("\n");
}

export type ClientSheet = "integrations" | "milestones" | "impl" | "ams";

/**
 * One client, one domain, one sheet.
 *
 * v1 had no `else` branch here: an unrecognised type left `headers` undefined
 * and produced a corrupt sheet rather than an error. This is exhaustive over
 * the union, so a new variant is a compile error.
 */
export async function exportClientExcel(
  type: ClientSheet,
  client: Client,
): Promise<void> {
  switch (type) {
    case "integrations": {
      const labels = [
        "Integration", "Status", "Assignee", "Due Date",
        "Description", "Next Action", "All Updates",
      ] as const;
      const rows: Cell[][] = (client.integrations ?? []).map((i) => [
        i.name,
        i.status,
        i.assignee || "",
        i.dueDate ? fmtDate(i.dueDate) : "",
        i.description || "",
        i.nextAction || "",
        joinUpdates(i.timeline),
      ]);
      return writeSheet(labels, rows, "Integrations",
        exportFilename(client.name, "Integrations", "xlsx"));
    }

    case "milestones": {
      const labels = [
        "Integration", "Milestone", "Status", "Due Date", "Owner", "Notes",
      ] as const;
      const rows: Cell[][] = (client.integrations ?? []).flatMap((i) =>
        (i.milestones ?? []).map((m) => [
          i.name,
          m.name,
          m.status,
          m.dueDate ? fmtDate(m.dueDate) : "",
          m.owner || "",
          m.notes || "",
        ]),
      );
      return writeSheet(labels, rows, "Milestones",
        exportFilename(client.name, "Milestones", "xlsx"));
    }

    case "impl": {
      const labels = [
        "Module", "Phase", "Status", "Assignee", "Start Date",
        "Target Date", "Current Activity", "Next Action", "All Updates",
      ] as const;
      const rows: Cell[][] = (client.modules ?? []).flatMap((m) =>
        (m.phases ?? []).map((p) => [
          m.name,
          p.name,
          p.status,
          p.assignee || "",
          p.startDate ? fmtDate(p.startDate) : "",
          p.targetDate ? fmtDate(p.targetDate) : "",
          p.currentActivity || "",
          p.nextAction || "",
          joinUpdates(p.updates),
        ]),
      );
      return writeSheet(labels, rows, "Implementation",
        exportFilename(client.name, "Implementation", "xlsx"));
    }

    case "ams": {
      const labels = [
        "#", "Date Raised", "Due Date", "Raised By", "Module", "Project",
        "Description", "Type", "Query Level", "Entry Status", "RAG",
        "Mode", "Hours",
      ] as const;
      // Read through the domain accessors, never the raw fields: `entryDate`,
      // `entryType` and `entryRaisedBy` carry v1's legacy fallbacks, and the
      // read path no longer emits the columns those fall back to.
      const rows: Cell[][] = (client.workLog ?? []).map((e, i) => [
        i + 1,
        fmtDate(entryDate(e)),
        e.dueDate ? fmtDate(e.dueDate) : "",
        entryRaisedBy(e),
        e.module || "",
        e.project || "",
        e.description || "",
        entryType(e),
        e.queryLevel || "",
        e.entryStatus || "Open",
        e.ragStatus || "",
        e.modeOfSupport || "",
        // A NUMBER, not a formatted string — the whole point of a spreadsheet
        // is that this column can be summed. v1 wrote `.toFixed(1)`, so every
        // hours column arrived as text and SUM() returned zero.
        Number(e.hours ?? 0),
      ]);
      return writeSheet(labels, rows, "AMS",
        exportFilename(client.name, "AMS_Entries", "xlsx"));
    }
  }
}

export interface AuditExportRow {
  ts: string;
  username: string | null;
  role: string | null;
  action: string;
  entity: string | null;
  screen: string | null;
  ip: string | null;
  userAgent: string | null;
}

/** `screen-name` -> `Screen Name`, matching v1's admin table. */
function screenLabel(s: string | null): string {
  if (!s) return "";
  return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The audit log, as filtered on screen. Admin only by where it is offered. */
export async function exportAuditExcel(rows: AuditExportRow[]): Promise<void> {
  const labels = [
    "Timestamp", "Username", "Role", "Action",
    "Entity", "Screen", "IP", "User Agent",
  ] as const;
  const body: Cell[][] = rows.map((r) => [
    fmtDateTime(r.ts),
    r.username ?? "System",
    r.role ?? "",
    r.action,
    r.entity ?? "",
    screenLabel(r.screen),
    r.ip ?? "",
    r.userAgent ?? "",
  ]);
  return writeSheet(labels, body, "Audit Log",
    exportFilename("Kora", "Audit_Log", "xlsx"));
}

export type AdminDomain = "integrations" | "impl" | "ams";

/**
 * The portfolio roll-up behind the admin Clients tab.
 *
 * Takes full trees rather than the tab's own `ClientSummary` list, because the
 * columns v1 offered — At Risk, Completed, at-risk phases, total hours — are
 * computed from the children and `ClientSummary` carries only counts.
 *
 * Domain membership is read from KEY PRESENCE (`modules !== undefined`), which
 * is what `toV1Shape` emits, not from `hasImplementation` — those flags exist
 * on `ClientSummary` and are absent from a tree. Using counts instead would
 * drop the six production clients that are in a domain with nothing in it yet.
 */
export async function exportAdminTableExcel(
  domain: AdminDomain,
  clients: Client[],
): Promise<void> {
  if (domain === "impl") {
    const labels = ["Client", "Modules", "At Risk Phases"] as const;
    const rows: Cell[][] = clients
      .filter((c) => c.modules !== undefined)
      .map((c) => [c.name, (c.modules ?? []).length, implProgress(c).atRisk]);
    return writeSheet(labels, rows, "Implementation",
      exportFilename("Kora", "Implementation_Portfolio", "xlsx"));
  }

  if (domain === "ams") {
    const labels = ["Client", "Day Rate", "Total Hours Logged"] as const;
    const rows: Cell[][] = clients
      .filter((c) => c.workLog !== undefined)
      .map((c) => [
        c.name,
        c.manDayRate ?? "Retainer",
        Number(amsTotals(c, "", "").totalHours.toFixed(1)),
      ]);
    return writeSheet(labels, rows, "AMS",
      exportFilename("Kora", "AMS_Portfolio", "xlsx"));
  }

  const labels = ["Client", "Integrations", "At Risk", "Completed"] as const;
  const rows: Cell[][] = clients
    .filter((c) => (c.integrations ?? []).length > 0)
    .map((c) => {
      const integs = c.integrations ?? [];
      return [
        c.name,
        integs.length,
        integs.filter((i) => i.status === "At Risk").length,
        integs.filter((i) => i.status === "Completed").length,
      ];
    });
  return writeSheet(labels, rows, "Integrations",
    exportFilename("Kora", "Integrations_Portfolio", "xlsx"));
}
