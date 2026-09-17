import type { NextRequest } from "next/server";
import { withPublic, json } from "@/lib/api/handler";
import type { Db } from "@/lib/db/client";
import { requireCronAuth, cronActor } from "@/lib/api/cron-auth";
import { collectBackup, backupObjectName } from "@/lib/backup/dump";
import { putBackup, pruneBackups } from "@/lib/backup/store";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
// Eight tables plus an upload and a prune. Well under this in practice; the
// ceiling exists so a slow storage call fails as a timeout we can see rather
// than a truncated backup we cannot.
export const maxDuration = 300;

/**
 * Nightly backup. Vercel Cron calls GET; an admin "run now" uses POST.
 *
 * Splitting the verbs matters: GET is what a link, a prefetch or a crawler
 * issues, and this endpoint writes a full database dump and deletes files.
 * Keeping the manual trigger on POST means none of those can fire it by
 * accident even with a valid admin session.
 */
async function run(req: NextRequest, db: Db) {
  const caller = await requireCronAuth(req, db);
  const now = new Date();

  const artifact = await collectBackup(db, now);
  const path = backupObjectName(now);
  const { bytes } = await putBackup(path, artifact);
  const pruned = await pruneBackups(now);

  await logAudit(db, {
    ...cronActor(caller, "Backup"),
    entity: "backup",
  });

  return json({
    ok: true,
    path,
    bytes,
    counts: artifact.counts,
    pruned: pruned.length,
  });
}

export const GET = withPublic(({ req, db }) => run(req, db));
export const POST = withPublic(({ req, db }) => run(req, db));
