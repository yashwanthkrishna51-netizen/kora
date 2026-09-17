import { withAuth, json } from "@/lib/api/handler";
import { restoreClient } from "@/lib/db/mutations/clients";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

/**
 * POST /api/clients/[clientId]/restore — undo an archive.
 *
 * No If-Match: the caller is acting on a row they cannot currently read, so
 * they have no token to send. This is the payoff for soft deletion — the old
 * app's real DELETE had no counterpart short of restoring last night's dump.
 */
export const POST = withAuth<{ clientId: string }>(
  { role: "admin" },
  async (ctx) => {
    const result = await restoreClient(ctx.db, ctx.params.clientId);
    await logAudit(ctx.db, {
      actorId: ctx.user.id, username: ctx.user.username, role: ctx.user.role,
      action: "Restore client", entity: "clients",
      ip: ctx.ip, userAgent: ctx.userAgent,
    });
    return json(result);
  },
);
