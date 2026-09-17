/**
 * backfill — rebuilds every v2 table from v1, in one transaction.
 *
 *   pnpm migrate:backfill                                   # dry run (default)
 *   pnpm migrate:backfill --execute --i-have-a-backup <file>
 *
 * Dry run is the default deliberately: the destructive form must be typed out
 * in full, including the name of the backup you took, which is a speed bump
 * that costs seconds and has repeatedly been the thing standing between a
 * tired operator and an unrecoverable afternoon.
 *
 * Refuses to proceed if preflight would gate. v1 is never written to.
 */
import { announce, confirmDestructive, connect, resolveTarget } from "./lib/db";
import { fromPostgresJs } from "./lib/executor";
import { readV1Clients } from "./lib/read-v1";
import { planBackfill, applyBackfill, assertTallies } from "./lib/backfill-core";
import { printSummary, printTable, writeReport } from "./lib/report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (process.argv[i + 1] ?? "");
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const execute = has("execute");
  const backupName = arg("i-have-a-backup");

  const target = resolveTarget();
  announce(
    "backfill — rebuild v2 from v1",
    target,
    execute ? "EXECUTE (writes v2)" : "dry run (no writes)",
  );

  if (execute && !backupName) {
    console.error(
      "  --execute requires --i-have-a-backup <filename>.\n\n" +
        "  Take one first:\n" +
        '    pg_dump "$KORA_DB_URL" --schema=public -Fc \\\n' +
        "      --file=CUTOVER_$(date +%Y%m%d_%H%M).dump\n\n" +
        "  Then pass its name so the run is recorded against it.\n",
    );
    process.exit(1);
  }

  const sql = connect(target);
  const exec = fromPostgresJs(sql);

  try {
    const clients = await readV1Clients(exec);
    console.log(`  Read ${clients.length} v1 clients.\n`);

    const plan = planBackfill(clients);

    console.log("  Planned rows");
    printTable(
      Object.entries(plan.tallies).map(([table, count]) => ({ table, count })),
      ["table", "count"],
    );

    printSummary(plan.log);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");

    if (plan.log.hasGates) {
      writeReport(`backfill-blocked-${stamp}`, {
        target: target.label,
        tallies: plan.tallies,
        counts: plan.log.counts(),
        issues: plan.log.issues,
      });
      console.error(
        `\n  BLOCKED: ${plan.log.gates.length} issue(s) must be fixed first.\n` +
          `  Run \`pnpm migrate:preflight\` for the full list.\n`,
      );
      process.exit(1);
    }

    if (!execute) {
      const file = writeReport(`backfill-dryrun-${stamp}`, {
        target: target.label,
        generatedAt: new Date().toISOString(),
        tallies: plan.tallies,
        counts: plan.log.counts(),
        issues: plan.log.issues,
      });
      console.log(`\n  Dry run only — nothing written.\n  Report: ${file}\n`);
      return;
    }

    await confirmDestructive(target);

    // One transaction: either v2 is fully rebuilt or it is untouched. There is
    // deliberately no partially-migrated state to reason about.
    //
    // Uses sql.begin rather than issuing BEGIN/COMMIT as statements, because
    // postgres.js pools connections and refuses the latter outright: a raw
    // BEGIN can land on a different connection from the statements that follow,
    // which would silently produce a half-applied migration running outside any
    // transaction at all. The callback's return value is committed; anything
    // thrown rolls the whole thing back.
    console.log("  Beginning transaction…");

    try {
      const written = await sql.begin(async (tx) => {
        const txExec = fromPostgresJs(tx as unknown as typeof sql);
        const result = await applyBackfill(txExec, plan);
        const check = await assertTallies(txExec, plan.tallies);

        if (!check.ok) {
          // Throwing here rolls back, rather than reporting success on a
          // partial write.
          throw new Error(
            `tally mismatch after insert:\n    ${check.diff.join("\n    ")}`,
          );
        }
        return result;
      });

      console.log("  Committed.\n");

      console.log("  Written");
      printTable(
        Object.entries(written).map(([table, count]) => ({ table, count })),
        ["table", "count"],
      );

      const file = writeReport(`backfill-executed-${stamp}`, {
        target: target.label,
        generatedAt: new Date().toISOString(),
        backup: backupName,
        tallies: plan.tallies,
        written,
        counts: plan.log.counts(),
        issues: plan.log.issues,
      });

      console.log(
        `\n  Report: ${file}\n\n` +
          `  NEXT: run \`pnpm migrate:verify\`. It must pass before cutover.\n`,
      );
    } catch (err) {
      // sql.begin has already rolled back by the time we get here.
      console.error(
        `\n  ROLLED BACK — v2 is unchanged, v1 was never touched.\n  ${
          err instanceof Error ? err.message : err
        }\n`,
      );
      process.exit(1);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("\n  backfill failed:", err instanceof Error ? err.message : err);
  process.exit(2);
});
