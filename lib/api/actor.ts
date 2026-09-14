import type { SessionUser } from "@/lib/auth/session";

/**
 * Who to record on a soft delete.
 *
 * The same string the activity feed stores as `addedBy` and the audit log
 * stores as `username`, so the three agree and a recovery can be traced across
 * them. Display name first because that is what a person recognises; username
 * is the fallback for accounts that have never had one set.
 */
export function actorName(ctx: { user: SessionUser }): string {
  return ctx.user.name || ctx.user.username;
}
