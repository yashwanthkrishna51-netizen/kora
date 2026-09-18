/**
 * verify-admin-lock — proves the last-admin guard survives real concurrency.
 *
 *   pnpm verify:admin-lock        (local Postgres only; refuses anything else)
 *
 * This lives outside the test suite because the suite runs on PGlite, which is
 * a single connection — two transactions there serialise no matter what the
 * code does, so the race cannot be produced and a passing test would prove
 * nothing. That is exactly how the bug survived: the guard was moved inside a
 * transaction, the sequential test passed, and everyone assumed it was closed.
 *
 * It was not. Under READ COMMITTED two transactions demoting two DIFFERENT
 * admins never contend — neither can see the other's uncommitted write, so
 * each counts the other as still an admin. Both pass. Both commit. Nobody can
 * reach the admin panel again.
 *
 * Run it and watch: WITHOUT the advisory lock the run ends with zero admins.
 */
import postgres from "postgres";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

/** Must match ADMIN_ROLE_LOCK in lib/db/mutations/users.ts. */
const LOCK = 81402701;

/** Wide enough that both transactions are certainly inside the window. */
const WINDOW_MS = 150;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("\n  DATABASE_URL is not set.\n");
    process.exit(1);
  }

  const host = new URL(url).hostname;
  if (!(host === "localhost" || host === "127.0.0.1" || host.endsWith(".local"))) {
    console.error(
      `\n  REFUSING TO RUN — target is ${host}, which is not local.\n` +
        "  This creates and demotes throwaway admin accounts.\n",
    );
    process.exit(1);
  }

  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin`delete from users where id like 'race_%'`;
  await admin`
    insert into users (id, username, name, email, role, password_hash) values
      ('race_a','race_a','Race A','a@example.com','admin','$2b$12$notarealhash'),
      ('race_b','race_b','Race B','b@example.com','admin','$2b$12$notarealhash')`;
  await admin.end();

  /** One demotion, mirroring updateUser + assertAdminRemains. */
  async function demote(me: string, useLock: boolean): Promise<string> {
    const sql = postgres(url!, { max: 1, onnotice: () => {} });
    try {
      await sql.begin(async (tx) => {
        if (useLock) await tx`select pg_advisory_xact_lock(${LOCK})`;
        const [{ remaining }] = await tx`
          select count(*)::int as remaining from users
          where role = 'admin' and id <> ${me} and id like 'race_%'`;
        await new Promise((r) => setTimeout(r, WINDOW_MS));
        if (remaining === 0) throw new Error("last admin");
        await tx`update users set role = 'viewer' where id = ${me}`;
      });
      return "demoted";
    } catch (e) {
      return (e as Error).message === "last admin" ? "refused" : "error";
    } finally {
      await sql.end();
    }
  }

  console.log("\n  Two admins. Two concurrent demotions, one each.\n");
  let failed = false;

  for (const useLock of [false, true] as const) {
    const reset = postgres(url, { max: 1, onnotice: () => {} });
    await reset`update users set role = 'admin' where id like 'race_%'`;
    await reset.end();

    const outcomes = await Promise.all([
      demote("race_a", useLock),
      demote("race_b", useLock),
    ]);

    const check = postgres(url, { max: 1, onnotice: () => {} });
    const [{ n }] = await check`
      select count(*)::int as n from users
      where role = 'admin' and id like 'race_%'`;
    await check.end();

    const label = useLock ? "WITH the lock   " : "WITHOUT the lock";
    console.log(
      `  ${label}  ${outcomes.join(", ").padEnd(20)}  admins remaining: ${n}` +
        (n === 0 ? "   <-- LOCKED OUT" : ""),
    );

    // Without the lock we EXPECT zero — that is the bug being demonstrated.
    // With it, at least one admin must survive.
    if (useLock && n === 0) failed = true;
  }

  const cleanup = postgres(url, { max: 1, onnotice: () => {} });
  await cleanup`delete from users where id like 'race_%'`;
  await cleanup.end();

  if (failed) {
    console.error("\n  FAIL — the lock did not prevent the lockout.\n");
    process.exit(1);
  }
  console.log("\n  PASS — the advisory lock serialises the demotions.\n");
}

main().catch((err) => {
  console.error("\n  verify-admin-lock failed:\n");
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
