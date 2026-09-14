/**
 * apply — runs a numbered migration file against the target database.
 *
 *   pnpm migrate:apply 0003
 *   pnpm migrate:apply 0003 --dry-run     # print the SQL, change nothing
 *
 * Exists because psql is not always installed, and "we skipped the migration
 * because a client tool was missing" is not a good reason to improvise DDL at a
 * prompt. Each file runs inside a transaction, so a failure part-way through
 * leaves nothing half-applied.
 *
 * Refuses 0001 outright: that file reconstructs the v1 schema for local use and
 * must never touch a real database.
 */
import fs from "node:fs";
import path from "node:path";
import { announce, confirmDestructive, connect, resolveTarget } from "./lib/db";

const DIR = path.resolve(process.cwd(), "db/migrations");
const dryRun = process.argv.includes("--dry-run");
const prefix = process.argv[2];

function resolveFile(p: string): string {
  const matches = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".sql") && f.startsWith(p));

  if (!matches.length) {
    const available = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .join("\n    ");
    throw new Error(`No migration matches "${p}". Available:\n    ${available}`);
  }
  if (matches.length > 1) {
    throw new Error(`"${p}" is ambiguous: ${matches.join(", ")}`);
  }
  return matches[0];
}

async function main() {
  if (!prefix) {
    throw new Error("Usage: pnpm migrate:apply <number> [--dry-run]");
  }

  const file = resolveFile(prefix);

  if (file.startsWith("0001")) {
    throw new Error(
      "0001 reconstructs the v1 schema for local/CI databases only.\n" +
        "  It must never be applied to a database that holds real data.",
    );
  }

  const sqlText = fs.readFileSync(path.join(DIR, file), "utf8");
  const target = resolveTarget();

  announce(
    `apply — ${file}`,
    target,
    dryRun ? "dry run (prints only)" : "EXECUTE (applies DDL)",
  );

  // Show what will run. DDL is worth reading before it executes.
  const statements = sqlText
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("--"))
    .join("\n");
  console.log("  SQL to run:\n");
  console.log(
    statements
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );
  console.log("");

  if (dryRun) {
    console.log("  Dry run — nothing applied.\n");
    return;
  }

  await confirmDestructive(target);

  const sql = connect(target);
  try {
    // One transaction per file: Postgres supports transactional DDL, so a
    // failure leaves the schema exactly as it was rather than half-changed.
    await sql.begin(async (tx) => {
      await tx.unsafe(sqlText);
    });
    console.log(`  Applied ${file}.\n`);
    console.log(
      `  Record it in db/migrations/APPLIED.md against ${target.env}.\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  apply failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
