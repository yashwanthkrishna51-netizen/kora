import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * The optimistic-concurrency token.
 *
 * `_v` is a row's `updated_at`. A GET hands it out, a later PATCH echoes it in
 * `If-Match`, and the write only lands if the row has not moved since.
 *
 * It is NOT selected raw. Postgres renders `timestamptz` in the session's
 * TimeZone and trims trailing zeros, so the same instant can print as
 * `2026-08-27 14:11:43.262+00` on one connection and `... 19:41:43.262+05:30`
 * on another, and `.750` prints as `.75`. Supabase happens to run UTC today,
 * but a token whose text depends on a session GUC is a bad thing to hand a
 * client and compare later. It is also not ISO-8601, so `new Date(row._v)` in
 * the browser works only by V8's leniency.
 *
 * `to_char` at UTC fixes both: one spelling per instant, on every connection,
 * and a string the frontend can parse. Microseconds are kept because Postgres
 * stores them — truncating to milliseconds would make a token that never
 * matches its own row, and every save would 409.
 */
export function vToken(col: PgColumn): SQL<string> {
  return sql<string>`to_char(${col} at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/**
 * Compares a client-supplied `_v` against the stored row.
 *
 * The cast is what makes the comparison safe: Postgres parses the token back
 * to an instant, so this is an equality test on timestamps, not on their text.
 * A malformed token raises `22007` (invalid_datetime_format), which the error
 * mapper turns into a 400 rather than a 500.
 */
export function vMatches(col: PgColumn, token: string): SQL<unknown> {
  return sql`${col} = ${token}::timestamptz`;
}
