import { supabase } from "@/lib/supabase";
import { stalePaths } from "./dump";

/**
 * Where backups live.
 *
 * A SEPARATE bucket from attachments, deliberately. The old cron wrote its
 * dumps to `backups/` inside `kora-attachments` — the same bucket that serves
 * every user-facing signed attachment URL. One policy mistake there would have
 * exposed both the files people upload and thirty days of full database dumps.
 * They have nothing in common except that they are both blobs; giving them one
 * blast radius was the only reason.
 */

export const BACKUP_BUCKET = "kora-backups";

export async function putBackup(
  path: string,
  artifact: unknown,
): Promise<{ path: string; bytes: number }> {
  const body = Buffer.from(JSON.stringify(artifact));

  const { error } = await supabase()
    .storage.from(BACKUP_BUCKET)
    .upload(path, body, {
      contentType: "application/json",
      // A second run in the same second overwrites rather than failing. The
      // name carries seconds, so this only ever collides with itself.
      upsert: true,
    });

  if (error) throw new Error(`Backup upload failed: ${error.message}`);
  return { path, bytes: body.byteLength };
}

/**
 * Deletes dumps past the retention window.
 *
 * Listing is capped at 1000, which is ~33x the retention window, so a single
 * page always covers everything we could legitimately need to prune. If the
 * folder ever exceeded that, the extra objects are simply not considered —
 * which errs toward keeping too much, the right direction for a backup.
 */
export async function pruneBackups(now: Date): Promise<string[]> {
  const { data, error } = await supabase()
    .storage.from(BACKUP_BUCKET)
    .list("backups", { limit: 1000 });

  if (error) throw new Error(`Backup listing failed: ${error.message}`);

  const names = (data ?? []).map((o) => `backups/${o.name}`);
  const stale = stalePaths(names, now);
  if (!stale.length) return [];

  const { error: delError } = await supabase()
    .storage.from(BACKUP_BUCKET)
    .remove(stale);

  if (delError) throw new Error(`Backup prune failed: ${delError.message}`);
  return stale;
}
