import { IssueLog } from "./issues";

/**
 * Type coercion from v1's loose jsonb into v2's real column types.
 *
 * The governing rule: a value that cannot be coerced is NEVER silently turned
 * into null. It raises a gate issue and blocks the migration until a human
 * fixes the record in the old app. Silently nulling is how a due date quietly
 * disappears and nobody notices for a month.
 *
 * The old dual-write did the opposite (`i.dueDate || null`), which is why a
 * client with one bad date has had its entire v2 shadow row failing to write
 * this whole time.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects impossible dates that still match the shape, e.g. 2026-02-31. */
function isRealCalendarDate(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * v1 string -> v2 `date` column.
 * Empty/absent becomes null (an expected, recorded transformation).
 * A full ISO timestamp is truncated to its date part.
 * Anything else non-empty is a gate.
 */
export function coerceDate(
  value: unknown,
  log: IssueLog,
  location: string,
): string | null {
  if (value === null || value === undefined || value === "") {
    log.add("DATE_EMPTY_TO_NULL", location);
    return null;
  }

  if (typeof value !== "string") {
    log.add("DATE_UNPARSEABLE", location, value, `expected string, got ${typeof value}`);
    return null;
  }

  const s = value.trim();
  if (s === "") {
    log.add("DATE_EMPTY_TO_NULL", location);
    return null;
  }

  if (DATE_ONLY.test(s)) {
    if (!isRealCalendarDate(s)) {
      log.add("DATE_UNPARSEABLE", location, s, "not a real calendar date");
      return null;
    }
    return s;
  }

  // Full ISO timestamp -> keep the date part only.
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoMatch && isRealCalendarDate(isoMatch[1])) {
    log.add("DATE_TS_TRUNCATED", location, s);
    return isoMatch[1];
  }

  log.add("DATE_UNPARSEABLE", location, s);
  return null;
}

/** v1 loose value -> v2 `numeric`. Range is advisory; unparseable is a gate. */
export function coerceNumber(
  value: unknown,
  fallback: number,
  log: IssueLog,
  location: string,
  range?: { min?: number; max?: number },
): number {
  let out: number;

  if (value === null || value === undefined || value === "") {
    log.add("NUM_DEFAULTED", location, value);
    out = fallback;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      log.add("NUM_UNPARSEABLE", location, value);
      return fallback;
    }
    out = value;
  } else if (typeof value === "string") {
    const n = Number(value.trim());
    if (!Number.isFinite(n)) {
      log.add("NUM_UNPARSEABLE", location, value);
      return fallback;
    }
    log.add("NUM_PARSED_FROM_STRING", location, value);
    out = n;
  } else {
    log.add("NUM_UNPARSEABLE", location, value, `unexpected type ${typeof value}`);
    return fallback;
  }

  if (range) {
    if (
      (range.min !== undefined && out < range.min) ||
      (range.max !== undefined && out > range.max)
    ) {
      log.add("NUM_OUT_OF_RANGE", location, out, JSON.stringify(range));
    }
  }

  return out;
}

/** Nullable numeric (man_day_rate, total_available_hours) — absent stays null. */
export function coerceNullableNumber(
  value: unknown,
  log: IssueLog,
  location: string,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      log.add("NUM_UNPARSEABLE", location, value);
      return null;
    }
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value.trim());
    if (!Number.isFinite(n)) {
      log.add("NUM_UNPARSEABLE", location, value);
      return null;
    }
    log.add("NUM_PARSED_FROM_STRING", location, value);
    return n;
  }
  log.add("NUM_UNPARSEABLE", location, value, `unexpected type ${typeof value}`);
  return null;
}

/** Text destined for a NOT NULL column. Empty raises a gate. */
export function coerceRequiredText(
  value: unknown,
  log: IssueLog,
  location: string,
): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) {
    log.add("NAME_EMPTY", location, value);
    return "";
  }
  return s;
}

/** Text for a nullable column. */
export function coerceText(value: unknown, fallback: string | null = null) {
  if (value === null || value === undefined) return fallback;
  const s = String(value);
  return s === "" ? fallback : s;
}

/** Timestamp passthrough for created_at/updated_at, preserving v1's values. */
export function coerceTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}
