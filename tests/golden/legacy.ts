/**
 * Golden-master harness.
 *
 * Loads the ORIGINAL vanilla-JS functions out of the old app and makes them
 * callable from tests, so the TypeScript ports can be diffed against the real
 * implementation rather than against my reading of it. If a port ever drifts,
 * these tests fail with a concrete input.
 *
 * The old files are one flat global scope with no exports, so we slice out the
 * functions we need by name and evaluate them in a VM context seeded with the
 * globals they close over.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const LEGACY_ROOT =
  process.env.KORA_LEGACY_ROOT ?? path.resolve(__dirname, "../../../kora/js");

export const legacyAvailable = fs.existsSync(
  path.join(LEGACY_ROOT, "core.js"),
);

function read(file: string): string {
  return fs.readFileSync(path.join(LEGACY_ROOT, file), "utf8");
}

/**
 * Extract a top-level `function name(...) { ... }` declaration by brace
 * matching. The old files are hand-written and consistently formatted, so a
 * brace counter is sufficient and avoids pulling in a parser.
 */
function extractFn(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`legacy function not found: ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let inStr: string | null = null;
  let prev = "";
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
    prev = ch;
  }
  throw new Error(`unbalanced braces extracting: ${name}`);
}

export interface LegacyApi {
  todayStr(): string;
  daysDiff(s: string | null | undefined): number | null;
  isOverdue(i: unknown): boolean;
  isStale(i: unknown, days?: number): boolean;
  integRagLabel(c: unknown): string | null;
  overallRagLabel(...rags: (string | null)[]): string | null;
  implProgress(c: unknown): {
    total: number;
    completed: number;
    atRisk: number;
    pct: number;
  };
  implAutoRag(c: unknown): string | null;
  amsTotals(c: unknown, from: string, to: string): Record<string, unknown>;
  amsClientRag(c: unknown): string | null;
  milestoneUrgencyColor(ms: unknown): string;

  /* ---- js/export.js — the report-only variants, see integration-report-helpers */
  integSeverityRank(i: unknown): number;
  sortIntegWorstFirst(list: unknown[]): unknown[];
  integRiskReason(i: unknown): string;
  integTopRisks(c: unknown, n?: number): unknown[];
  integRagReason(c: unknown): { label: string; reason: string };
  integMilestoneCounts(c: unknown): {
    achieved: number;
    pending: number;
    missed: number;
    total: number;
  };
  integStatusSegments(c: unknown): { status: string; count: number; hex: string }[];
}

/**
 * Builds the legacy API inside a VM. `now` is not injectable in the original
 * code (it calls Date.now()/new Date() directly), so callers must freeze time
 * with vi.setSystemTime before invoking — the same clock then drives both
 * implementations.
 */
export function loadLegacy(): LegacyApi {
  const core = read("core.js");
  const impl = read("implementation.js");
  const ams = read("ams.js");
  const exp = read("export.js");

  const parts = [
    // Constants the extracted functions close over.
    "const HOURS_PER_DAY = 8;",
    "const CURRENCIES = { INR: { symbol: '\\u20B9', code: 'INR' }, USD: { symbol: '$', code: 'USD' } };",
    "const AMS_TYPES = ['Bug Fix','Enhancement','Config Change','Support Ticket','Reporting','Training','Meeting','Consultation'];",
    "const AMS_QUERY_LEVELS = ['L1 - Low','L2 - Medium','L3 - High','L4 - Critical'];",
    "const AMS_MODES = ['Online / Remote','Offline / In-person'];",
    // v1's export palette. Transcribed from core.js:25 because it is a const,
    // not a function. The PORT deliberately uses different colours (handoff
    // \u00a713), so the golden test compares slice grouping and order, never hex.
    "const SHEX = { 'Completed': '22c55e', 'In Progress': '0e7490', 'At Risk': 'be185d', 'On Hold \u2014 Internal': '7c3aed', 'On Hold \u2014 Client': '9333ea', 'Pending Client': 'd97706', 'Under Review': '0284c7', 'Delayed': 'ea580c', 'Cancelled': '94a3b8', 'Not Started': '64748b' };",

    extractFn(core, "todayStr"),
    extractFn(core, "daysDiff"),
    extractFn(core, "isOverdue"),
    extractFn(core, "daysOverdue"),
    extractFn(core, "lastUpdateDate"),
    extractFn(core, "isStale"),
    extractFn(core, "milestoneUrgencyColor"),
    extractFn(core, "integRagLabel"),
    extractFn(core, "overallRagLabel"),

    extractFn(impl, "implProgress"),
    extractFn(impl, "implAutoRag"),

    extractFn(ams, "amsEntryAmount"),
    extractFn(ams, "entryDate"),
    extractFn(ams, "entryType"),
    extractFn(ams, "entryRaisedBy"),
    extractFn(ams, "amsTotals"),
    extractFn(ams, "amsClientRag"),

    // js/export.js. These share five names with lib/domain/integrations.ts and
    // do different things — which is exactly why they are worth diffing.
    // INTEG_FALLBACK_RANK is a `const`, not a function, so extractFn cannot
    // reach it; it is transcribed here from export.js:134.
    "const INTEG_FALLBACK_RANK = { 'On Hold \u2014 Client': 2, 'On Hold \u2014 Internal': 3, 'Pending Client': 4, 'Under Review': 5, 'Delayed': 6, 'In Progress': 8, 'Not Started': 9, 'Completed': 10, 'Cancelled': 11 };",
    extractFn(exp, "integSeverityRank"),
    extractFn(exp, "sortIntegWorstFirst"),
    extractFn(exp, "integRiskReason"),
    extractFn(exp, "integTopRisks"),
    extractFn(exp, "integRagReason"),
    extractFn(exp, "integMilestoneCounts"),
    extractFn(exp, "integStatusSegments"),

    // Surface them for the harness.
    `({ todayStr, daysDiff, isOverdue, isStale, integRagLabel, overallRagLabel,
        implProgress, implAutoRag, amsTotals, amsClientRag, milestoneUrgencyColor,
        integSeverityRank, sortIntegWorstFirst, integRiskReason, integTopRisks,
        integRagReason, integMilestoneCounts, integStatusSegments })`,
  ];

  const context = vm.createContext({ Date, Math, Number, Object, JSON, isNaN });
  return vm.runInContext(parts.join("\n"), context) as LegacyApi;
}
