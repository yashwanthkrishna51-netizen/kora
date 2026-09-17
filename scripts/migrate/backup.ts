/**
 * backup — JSON snapshot of everything the migration could conceivably affect.
 *
 *   pnpm migrate:backup
 *
 * A logical `pg_dump -Fc` is still the better artefact and the runbook calls
 * for one at cutover. This exists because pg_dump has to match the server's
 * major version and often isn't installed, and "we couldn't take a backup
 * because a client tool was missing" is not an acceptable reason to touch
 * production without one.
 *
 * Writes to backups/ (gitignored — this contains real client data).
 *
 * `users` is captured WITH password hashes here, unlike the app's own nightly
 * backup which deliberately excludes them: this snapshot is a pre-change safety
 * net held locally for a few hours, not an artefact that lives in a storage
 * bucket for thirty days. Delete it once the migration is done.
 */
import fs from "node:fs";
import path from "node:path";
import { announce, connect, resolveTarget } from "./lib/db";

// Everything the migration reads, plus everything a mistake could touch.
const TABLES = [
  "clients",
  "users",
  "audit_log",
  "portfolio_snapshots",
  "app_settings",
  "login_ip_throttle",
  "clients_v2",
  "integrations_v2",
  "milestones_v2",
  "modules_v2",
  "phases_v2",
  "ams_work_log_v2",
];

async function main() {
  const target = resolveTarget();
  announce("backup — JSON snapshot", target, "read-only");

  const sql = connect(target);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `v1-snapshot-${stamp}.json`);

  try {
    const dump: Record<string, unknown[]> = {};
    const counts: Record<string, number> = {};

    for (const table of TABLES) {
      const [{ exists }] = await sql<{ exists: boolean }[]>`
        select to_regclass(${"public." + table}) is not null as exists
      `;
      if (!exists) {
        console.log(`  ${table.padEnd(22)} — not present, skipped`);
        continue;
      }
      const rows = await sql.unsafe(`select * from ${table}`);
      dump[table] = rows as unknown[];
      counts[table] = rows.length;
      console.log(`  ${table.padEnd(22)} ${String(rows.length).padStart(7)} rows`);
    }

    fs.writeFileSync(
      file,
      JSON.stringify(
        { takenAt: new Date().toISOString(), target: target.label, counts, tables: dump },
        null,
        2,
      ),
      { mode: 0o600 },
    );

    const mb = (fs.statSync(file).size / 1024 / 1024).toFixed(2);
    console.log(`\n  Wrote ${file}\n  ${mb} MB\n`);
    console.log(
      "  Keep a second copy off this machine before making changes.\n" +
        "  Delete it once the migration is complete — it contains client data\n" +
        "  and password hashes.\n",
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  backup failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
