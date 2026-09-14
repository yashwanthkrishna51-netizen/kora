import { auditLog } from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Audit trail, ported from api/_audit.js.
 *
 * Two rules carried over deliberately:
 *
 *   A write failure NEVER breaks the caller. Logging that an action happened
 *   must not be able to stop the action.
 *
 *   Actions are recorded as summaries, never payloads. No field values, no
 *   request bodies. That is why the earlier data-loss incident could not be
 *   reconstructed from the logs — and it is still the right trade, because the
 *   alternative is a permanent, growing copy of client data in a table nobody
 *   thinks of as sensitive.
 */

export interface AuditEntry {
  actorId?: string | null;
  username?: string | null;
  role?: string | null;
  action: string;
  entity?: string | null;
  screen?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export async function logAudit(db: AnyDb, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      // `id` and `ts` are database-generated, matching the old writer.
      actorId: entry.actorId ?? null,
      username: entry.username ?? null,
      role: entry.role ?? null,
      action: entry.action || "Unknown action",
      entity: entry.entity ?? null,
      screen: entry.screen ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    } as typeof auditLog.$inferInsert);
  } catch (err) {
    console.error(
      "audit write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
