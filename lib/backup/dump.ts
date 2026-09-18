import { users } from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";
import {
  clients, integrations, milestones, modules, phases, amsWorkLog, appSettings,
} from "@/lib/db/schema";

/**
 * Nightly backup contents.
 *
 * Supabase's free tier has no point-in-time recovery, so this file is the only
 * thing between a bad afternoon and a permanent loss. Two things about the old
 * version were wrong enough to matter:
 *
 * IT DUMPED THE WRONG TABLES. api/cron/backup.js backs up the v1 `clients`
 * jsonb. After cutover that table is frozen — a backup of it restores the state
 * of the world on migration day and nothing since.
 *
 * IT CONTAINED EVERY PASSWORD HASH. Thirty days of dumps, each with the full
 * `users` row, sitting in the same bucket that serves attachment URLs. A backup
 * is the artefact most likely to be copied somewhere less careful than the
 * database, so it is the last place credentials should be.
 */

/**
 * The user columns a backup may contain.
 *
 * An explicit allow-list, not a delete-afterwards: the same discipline as
 * lib/db/queries/users.ts. A column added to the schema later is absent from
 * backups until someone consciously adds it here, which is the correct default
 * for a file that gets copied around.
 *
 * `password_hash` is the point. `token_version` is also out — restoring an old
 * value would silently un-revoke every session that had been force-logged-out.
 */
export const SAFE_USER_COLUMNS = {
  id: users.id,
  username: users.username,
  name: users.name,
  email: users.email,
  role: users.role,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

export interface BackupArtifact {
  takenAt: string;
  schema: "v2";
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
}

/**
 * Reads everything worth restoring.
 *
 * Archived rows are INCLUDED — soft-deleted data is exactly what someone asks
 * for when they call about a mistake, and excluding it would make the backup
 * useless for the case it most exists for.
 *
 * `audit_log` is excluded: append-only, never pruned, already the largest table,
 * and not the data whose loss motivated any of this.
 */
export async function collectBackup(
  db: AnyDb,
  now: Date,
): Promise<BackupArtifact> {
  const [
    clientRows, integrationRows, milestoneRows, moduleRows,
    phaseRows, workLogRows, settingRows, userRows,
  ] = await Promise.all([
    db.select().from(clients),
    db.select().from(integrations),
    db.select().from(milestones),
    db.select().from(modules),
    db.select().from(phases),
    db.select().from(amsWorkLog),
    db.select().from(appSettings),
    db.select(SAFE_USER_COLUMNS).from(users),
  ]);

  const tables: Record<string, unknown[]> = {
    clients_v2: clientRows,
    integrations_v2: integrationRows,
    milestones_v2: milestoneRows,
    modules_v2: moduleRows,
    phases_v2: phaseRows,
    ams_work_log_v2: workLogRows,
    app_settings: settingRows,
    users: userRows,
  };

  const counts = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, v.length]),
  );

  return { takenAt: now.toISOString(), schema: "v2", tables, counts };
}

/** `backups/2026-09-01-03-24-30.json` — the old app's naming, kept so a mixed folder still sorts. */
export function backupObjectName(now: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `backups/${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-` +
    `${p(now.getUTCDate())}-${p(now.getUTCHours())}-` +
    `${p(now.getUTCMinutes())}-${p(now.getUTCSeconds())}.json`
  );
}

/** Parses a stamp back out of an object name, or null if it does not look like one. */
export function parseBackupStamp(name: string): Date | null {
  const m = name.match(
    /(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[];
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export const KEEP_DAYS = 30;

/**
 * Which stored objects have aged out.
 *
 * A name that does not parse is NEVER pruned. The retention rule should only
 * ever delete files it positively recognises as old — anything else it does not
 * understand, and deleting on "I could not read the date" is how a prune turns
 * into an incident.
 */
export function stalePaths(
  names: string[],
  now: Date,
  keepDays = KEEP_DAYS,
): string[] {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return names.filter((name) => {
    const stamp = parseBackupStamp(name);
    if (!stamp) return false;
    return stamp.getTime() < cutoff;
  });
}
