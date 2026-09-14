/**
 * dump-schema — reads the real column definitions from the live database.
 *
 *   pnpm tsx scripts/migrate/dump-schema.ts
 *
 * `db/migrations/0001_baseline_v1_schema.sql` is a reconstruction, because the
 * v1 schema was never committed anywhere. Reconstructions contain guesses —
 * `audit_log.id` in particular was inferred, since the writer never sends it.
 * This prints what is actually there so the baseline can be corrected, and so
 * the Drizzle schema matches reality rather than an assumption.
 *
 * Read-only. Not a substitute for `pg_dump --schema-only`, which stays the
 * right artefact once it is installed.
 */
import { announce, connect, resolveTarget } from "./lib/db";

const TABLES = [
  "clients",
  "users",
  "audit_log",
  "login_ip_throttle",
  "portfolio_snapshots",
  "app_settings",
];

interface Col {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

async function main() {
  const target = resolveTarget();
  announce("dump-schema — real column types", target, "read-only");

  const sql = connect(target);
  try {
    const cols = await sql<Col[]>`
      select table_name, column_name, data_type, is_nullable,
             column_default, character_maximum_length
      from information_schema.columns
      where table_schema = 'public' and table_name = any(${TABLES})
      order by table_name, ordinal_position
    `;

    let current = "";
    for (const c of cols) {
      if (c.table_name !== current) {
        current = c.table_name;
        console.log(`\n  ${current}`);
      }
      const type =
        c.character_maximum_length
          ? `${c.data_type}(${c.character_maximum_length})`
          : c.data_type;
      const nn = c.is_nullable === "NO" ? " NOT NULL" : "";
      const def = c.column_default ? ` DEFAULT ${c.column_default}` : "";
      console.log(`    ${c.column_name.padEnd(24)} ${type}${nn}${def}`);
    }

    const cons = await sql<{
      table_name: string;
      constraint_name: string;
      constraint_type: string;
      cols: string;
    }[]>`
      select tc.table_name, tc.constraint_name, tc.constraint_type,
             string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as cols
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
       and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public'
        and tc.table_name = any(${TABLES})
        and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
      group by 1, 2, 3
      order by 1, 3
    `;

    console.log("\n  Keys");
    for (const c of cons) {
      console.log(
        `    ${c.table_name.padEnd(22)} ${c.constraint_type.padEnd(12)} (${c.cols})`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
