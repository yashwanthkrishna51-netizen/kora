import fs from "node:fs";
import path from "node:path";
import type { Issue, IssueLog } from "./issues";

/**
 * Reporting.
 *
 * Two audiences: a human deciding whether it is safe to proceed, and a machine
 * diffing one run against another. So every tool emits both a readable console
 * summary and a JSON artefact.
 *
 * Reports contain real client data and are gitignored.
 */

const REPORT_DIR = path.resolve(process.cwd(), "scripts/migrate/reports");

export function writeReport(name: string, payload: unknown): string {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  // Timestamp is passed in by the caller rather than generated here, so a
  // dry run and its verify can share a filename stem.
  const file = path.join(REPORT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

/** Groups issues by code so a thousand identical warnings read as one line. */
export function summarize(log: IssueLog) {
  const byCode = new Map<string, Issue[]>();
  for (const issue of log.issues) {
    const list = byCode.get(issue.code) ?? [];
    list.push(issue);
    byCode.set(issue.code, list);
  }
  return byCode;
}

export function printSummary(log: IssueLog, opts: { showInfo?: boolean } = {}) {
  const byCode = summarize(log);
  const order: Array<"gate" | "warning" | "info"> = ["gate", "warning", "info"];

  for (const severity of order) {
    if (severity === "info" && !opts.showInfo) continue;

    const codes = [...byCode.entries()].filter(
      ([, list]) => list[0].severity === severity,
    );
    if (!codes.length) continue;

    const heading =
      severity === "gate"
        ? "BLOCKING — must be fixed before migrating"
        : severity === "warning"
          ? "Warnings — review once"
          : "Expected transformations";
    console.log(`\n  ${heading}`);

    for (const [code, list] of codes.sort(
      (a, b) => b[1].length - a[1].length,
    )) {
      console.log(`    ${code.padEnd(24)} ${String(list.length).padStart(6)}`);
      // Show enough examples to act on, not the whole list.
      if (severity !== "info") {
        for (const issue of list.slice(0, 8)) {
          const val = issue.value ? `  value=${JSON.stringify(issue.value)}` : "";
          const det = issue.detail ? `  (${issue.detail})` : "";
          console.log(`        ${issue.location}${val}${det}`);
        }
        if (list.length > 8) {
          console.log(`        … ${list.length - 8} more (see the JSON report)`);
        }
      }
    }
  }
}

export function printTable(
  rows: Array<Record<string, string | number>>,
  columns: string[],
): void {
  if (!rows.length) {
    console.log("    (none)");
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)),
  );
  const line = (cells: string[]) =>
    "    " + cells.map((c, i) => c.padEnd(widths[i])).join("  ");

  console.log(line(columns));
  console.log("    " + widths.map((w) => "─".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(line(columns.map((c) => String(r[c] ?? ""))));
  }
}
