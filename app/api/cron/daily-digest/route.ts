import type { NextRequest } from "next/server";
import { withPublic, json } from "@/lib/api/handler";
import type { Db } from "@/lib/db/client";
import { requireCronAuth, cronActor } from "@/lib/api/cron-auth";
import { runDigest } from "@/lib/digest/run";
import { captureSnapshot } from "@/lib/db/mutations/snapshots";
import { appUrl } from "@/lib/azure/config";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
// ~20 recipients at 350ms apiece is well under 10s. The ceiling is here so a
// slow mailbox surfaces as a visible timeout rather than a half-sent digest.
export const maxDuration = 300;

/**
 * The daily digest. Vercel Cron calls GET at 03:30 UTC (09:00 IST).
 *
 * POST is the admin "run now" path and accepts `?dryRun=1`, which plans the
 * whole thing and reports who would receive what without sending — the only
 * safe way to check a routing change against real data.
 *
 * IT ALSO CAPTURES THE DAILY PORTFOLIO SNAPSHOT, which needs explaining.
 *
 * Snapshots are what the dashboard's trend arrows compare against. v1 captured
 * one opportunistically on every dashboard load (`kora/js/core.js:299`), so a
 * day nobody opened the dashboard simply had no row, and the trend was lumpy.
 * Nothing in this app captured one at all — the read hook existed, the POST
 * route existed, and no caller did — so at cutover the arrows would have gone
 * stale and then empty, with nothing to connect it to the switchover.
 *
 * It rides on the digest rather than getting its own cron because the Hobby
 * plan allows exactly two and both are spoken for. That turns out to be the
 * better home anyway: the digest already loads every client tree, it runs at a
 * fixed time so the series is evenly spaced rather than depending on who
 * happened to log in, and "the daily rollup" is what a snapshot is.
 *
 * It runs even on a dry run — a dry run withholds EMAIL, and skipping the
 * capture would make "check the routing safely" silently cost a day of trend
 * data. It is idempotent on `snapshot_date`, so running it twice is harmless.
 */
async function run(req: NextRequest, db: Db) {
  const caller = await requireCronAuth(req, db);
  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";

  const result = await runDigest({ db, appUrl: appUrl(), dryRun });

  // Never let snapshot capture break the digest — v1 wrapped its own call in a
  // bare try/catch for the same reason. A missing trend arrow is a nuisance; a
  // digest that fails to send is twenty people not being told what is overdue.
  let snapshot: { date: string; clients: number } | null = null;
  try {
    snapshot = await captureSnapshot(db);
  } catch (err) {
    console.error(
      "Snapshot capture failed; the digest was unaffected:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
  }

  if (!dryRun) {
    await logAudit(db, {
      ...cronActor(caller, "Daily digest"),
      entity: "digest",
    });
  }

  return json({ ...result, snapshot });
}

export const GET = withPublic(({ req, db }) => run(req, db));
export const POST = withPublic(({ req, db }) => run(req, db));
