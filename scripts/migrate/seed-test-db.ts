/**
 * seed-test-db — builds a throwaway v1+v2 database for exercising the
 * migration tooling.
 *
 *   docker run -d --name kora-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16
 *   MIGRATION_DATABASE_URL=postgresql://postgres:postgres@localhost:55432/postgres \
 *     pnpm tsx scripts/migrate/seed-test-db.ts
 *
 * The seed data is deliberately hostile. Every record here exists because it is
 * a way the migration could lose or corrupt data, and it is far better to meet
 * these on a disposable database than during a cutover window:
 *
 *   - a client in the Implementation domain with ZERO modules (the null-sentinel)
 *   - duplicate client names differing only by case
 *   - an unparseable due date ("TBD")
 *   - a work-log entry with no dateRaised (NOT NULL in v2)
 *   - a phase carrying the legacy `moduleId::phaseName` synthetic id
 *   - a phase with no id at all
 *   - a duplicate phase name inside one module
 *   - a phase name outside the fixed nine
 *   - attachments as public URL, expired signed URL, bare path and foreign URL
 *
 * Refuses to run against anything that isn't local.
 */
import fs from "node:fs";
import path from "node:path";
import { announce, connect, resolveTarget } from "./lib/db";
import { SAMPLE_V1_CLIENTS } from "./lib/sample-v1";

const MIGRATIONS = [
  "0001_baseline_v1_schema.sql",
  "0002_v2_schema.sql",
  "0003_domain_membership.sql",
  "0005_backend_indexes.sql",
  // 0004 is intentionally omitted: the seed contains duplicate names on
  // purpose, so applying it here would (correctly) fail.
];

async function main() {
  const target = resolveTarget();
  announce("seed-test-db", target, "DROPS AND RECREATES public schema");

  if (target.env !== "local") {
    console.error(
      `  REFUSING TO RUN.\n\n` +
        `  This drops the entire public schema. Target resolved to ${target.env}\n` +
        `  (${target.host}), not local. Point MIGRATION_DATABASE_URL at a\n` +
        `  throwaway database — e.g. a local Docker Postgres.\n`,
    );
    process.exit(1);
  }

  const sql = connect(target);
  try {
    console.log("  Resetting schema…");
    await sql.unsafe(`drop schema public cascade; create schema public;`);

    // The v2 DDL grants to service_role, which exists on Supabase but not on a
    // stock Postgres image. Create it so the files apply unmodified.
    await sql.unsafe(`
      do $$ begin
        if not exists (select from pg_roles where rolname = 'service_role') then
          create role service_role;
        end if;
      end $$;
    `);

    for (const file of MIGRATIONS) {
      const p = path.resolve(process.cwd(), "db/migrations", file);
      console.log(`  Applying ${file}…`);
      await sql.unsafe(fs.readFileSync(p, "utf8"));
    }

    console.log(`  Seeding ${SAMPLE_V1_CLIENTS.length} v1 clients…`);
    for (const c of SAMPLE_V1_CLIENTS) {
      await sql`
        insert into clients ${sql({
          id: c.id,
          name: c.name,
          description: c.description ?? "",
          created_at: c.created_at,
          updated_at: c.updated_at,
          // Pass the real arrays. postgres.js serializes them into proper
          // jsonb; JSON.stringify-ing first would store a jsonb *scalar
          // string* instead of an array — data that reads back fine through a
          // parser but is not shaped like anything the live database holds.
          integrations: sql.json((c.integrations ?? []) as never),
          // Preserve the null-sentinel: an absent key stays SQL NULL.
          modules: c.modules === undefined ? null : sql.json(c.modules as never),
          work_log: c.work_log === undefined ? null : sql.json(c.work_log as never),
          man_day_rate: c.man_day_rate ?? null,
          total_available_hours: c.total_available_hours ?? null,
          currency: c.currency ?? "INR",
          master_assignee: c.master_assignee ?? null,
        })}
      `;
    }

    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from clients
    `;
    console.log(`\n  Seeded. clients = ${count}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  seed failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
