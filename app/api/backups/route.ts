import { withAuth, json } from "@/lib/api/handler";
import { supabase } from "@/lib/supabase";
import { BACKUP_BUCKET } from "@/lib/backup/store";

export const runtime = "nodejs";

export interface BackupArtifact {
  name: string;
  path: string;
  bytes: number | null;
  createdAt: string | null;
}

/**
 * GET /api/backups — what the nightly cron has actually written. Admin only.
 *
 * This exists because "the backup is configured" and "the backup ran" are
 * different claims, and only the second one matters. `/api/health` reports the
 * first: it checks that storage credentials work, which they do, while
 * `kora-backups` has been EMPTY since it was created — the cron has never once
 * succeeded and nothing surfaced that.
 *
 * So this is deliberately a listing of artifacts rather than a status flag. An
 * empty list is the finding.
 *
 * Returns metadata only. The objects hold a full database dump; a signed
 * download URL from here would turn an admin session into a data export, so
 * retrieval stays a Supabase-console operation with its own audit trail.
 */
export const GET = withAuth({ role: "admin" }, async () => {
  const { data, error } = await supabase()
    .storage.from(BACKUP_BUCKET)
    .list("", { limit: 100, sortBy: { column: "name", order: "desc" } });

  if (error) {
    // Reported as a result, not thrown. A missing bucket or a rejected
    // credential is exactly what this screen is for showing.
    return json({ backups: [], error: error.message, bucket: BACKUP_BUCKET });
  }

  const backups: BackupArtifact[] = (data ?? [])
    // `list("")` returns folder placeholders as zero-byte entries with no
    // metadata; they are not artifacts.
    .filter((o) => o.name && o.id !== null)
    .map((o) => ({
      name: o.name,
      path: o.name,
      bytes:
        typeof o.metadata?.size === "number" ? (o.metadata.size as number) : null,
      createdAt: o.created_at ?? null,
    }));

  return json({ backups, bucket: BACKUP_BUCKET });
});
