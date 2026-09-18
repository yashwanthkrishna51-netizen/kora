import { sql, getTableName, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * A fully-qualified `"table"."column"` reference.
 *
 * Interpolating a column into a `sql` template renders it BARE — `${clients.id}`
 * becomes `"id"`, not `"clients_v2"."id"`. At the top level of a statement that
 * is unambiguous, so it reads fine and works fine. Inside a correlated
 * subquery it is not: the inner table's own `id` shadows the outer one, and
 * `where i.client_id = "id"` quietly becomes `i.client_id = i.id` — a
 * comparison that is essentially never true. No error, no warning, just zeroes.
 *
 * Any outer-table reference inside a subquery goes through here. The table name
 * is read off the column rather than typed as a literal, so renaming a table
 * cannot leave a stale string behind.
 */
export function qualify(col: PgColumn): SQL {
  return sql`${sql.identifier(getTableName(col.table))}.${sql.identifier(col.name)}`;
}
