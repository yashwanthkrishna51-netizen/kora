/**
 * Issue taxonomy for the migration.
 *
 * Every transformation the backfill performs is recorded as a coded issue, so
 * "the data changed shape" is never indistinguishable from "the data was
 * wrong". This is what lets verify.ts assert *zero unexplained differences*
 * rather than eyeballing a diff: each difference between v1 and v2 must be
 * attributable to an issue code that preflight predicted.
 *
 * Severity decides what happens next:
 *   info    — an expected, lossless transformation. Counted, not reported.
 *   warning — migrates, but a human should look at it once.
 *   gate    — blocks `backfill --execute`. Must be fixed in the old app first.
 */

export type Severity = "info" | "warning" | "gate";

export const ISSUE_CODES = {
  // --- dates ---------------------------------------------------------------
  DATE_EMPTY_TO_NULL: "info",
  DATE_TS_TRUNCATED: "info",
  /** A non-empty value that is not a date. Never silently nulled. */
  DATE_UNPARSEABLE: "gate",

  // --- numbers -------------------------------------------------------------
  NUM_PARSED_FROM_STRING: "info",
  NUM_DEFAULTED: "info",
  NUM_UNPARSEABLE: "gate",
  NUM_OUT_OF_RANGE: "warning",

  // --- identifiers ---------------------------------------------------------
  /** Row had no id; one was derived deterministically. */
  ID_DERIVED: "info",
  /** Phase id was the `moduleId::phaseName` synthetic; re-minted. */
  ID_REMINTED: "info",
  /** An id that exists but violates ^[A-Za-z0-9_-]{1,64}$. */
  ID_INVALID: "gate",
  /** Same id used by two rows that become one table in v2. */
  ID_COLLISION: "gate",

  // --- required text -------------------------------------------------------
  /** A column that is NOT NULL in v2 is empty in v1. */
  NAME_EMPTY: "gate",
  NAME_DUPLICATE_CI: "gate",

  // --- phases --------------------------------------------------------------
  PHASE_NAME_UNKNOWN: "gate",
  /** Violates uq_phases_v2_module_phasename_active. */
  PHASE_NAME_DUP: "gate",

  // --- AMS -----------------------------------------------------------------
  /** date_raised is NOT NULL in v2; a fallback was used. */
  DATERAISED_FALLBACK: "warning",

  // --- attachments ---------------------------------------------------------
  /** Signed URL dropped in favour of storagePath (signed fresh on read). */
  ATTACH_URL_STRIPPED: "info",
  /** Neither storagePath nor an extractable path. Object kept verbatim. */
  ATTACH_NO_PATH: "warning",

  // --- membership ----------------------------------------------------------
  /** Domain flag recovered from the v1 null-sentinel. */
  MEMBERSHIP_DERIVED: "info",
} as const;

export type IssueCode = keyof typeof ISSUE_CODES;

export interface Issue {
  code: IssueCode;
  severity: Severity;
  /** `clientId` or `clientId/integrations[2].dueDate` — precise enough to fix. */
  location: string;
  /** The offending value, stringified and truncated. */
  value?: string;
  detail?: string;
}

export function severityOf(code: IssueCode): Severity {
  return ISSUE_CODES[code];
}

/** Collects issues during a mapping run. One instance per backfill/preflight. */
export class IssueLog {
  readonly issues: Issue[] = [];

  add(
    code: IssueCode,
    location: string,
    value?: unknown,
    detail?: string,
  ): void {
    this.issues.push({
      code,
      severity: severityOf(code),
      location,
      value: value === undefined ? undefined : truncate(value),
      detail,
    });
  }

  get gates(): Issue[] {
    return this.issues.filter((i) => i.severity === "gate");
  }

  get warnings(): Issue[] {
    return this.issues.filter((i) => i.severity === "warning");
  }

  get hasGates(): boolean {
    return this.issues.some((i) => i.severity === "gate");
  }

  /** Counts per code — the shape verify.ts compares against its own run. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of this.issues) out[i.code] = (out[i.code] ?? 0) + 1;
    return out;
  }
}

function truncate(v: unknown, max = 120): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  const str = s ?? String(v);
  return str.length > max ? str.slice(0, max) + "…" : str;
}

/** `c123/integrations[2].dueDate` */
export function loc(
  clientId: string,
  collection?: string,
  index?: number,
  field?: string,
): string {
  let s = clientId;
  if (collection) s += `/${collection}`;
  if (index !== undefined) s += `[${index}]`;
  if (field) s += `.${field}`;
  return s;
}
