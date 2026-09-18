import { withAuth, json } from "@/lib/api/handler";
import { captureSnapshot } from "@/lib/db/mutations/snapshots";
import { logAudit } from "@/lib/audit";
import { listSnapshots } from "@/lib/db/queries/misc";

export const runtime = "nodejs";

export const GET = withAuth({}, async ({ db, user, req }) => {
  const p = new URL(req.url).searchParams;
  const rows = await listSnapshots(db, {
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    clientId: p.get("clientId") ?? undefined,
    // Billable hours are omitted entirely for non-admins.
    isAdmin: user.role === "admin",
  });
  return json({ rows });
});

/**
 * POST /api/snapshots — capture today's rollup. Editors and above.
 *
 * Takes NO body. Everything is computed from the database (see
 * lib/db/mutations/snapshots.ts) rather than accepted from the caller, which
 * is the one meaningful change from v1: that endpoint wrote whatever figures
 * the browser sent.
 *
 * Viewers are refused because this data feeds the leadership dashboard's
 * trend indicators — the same reason the old app blocked them.
 */
export const POST = withAuth({ role: "editor" }, async (ctx) => {
  const result = await captureSnapshot(ctx.db);

  await logAudit(ctx.db, {
    actorId: ctx.user.id,
    username: ctx.user.username,
    role: ctx.user.role,
    action: `Captured portfolio snapshot (${result.clients} clients)`,
    entity: "portfolio_snapshots",
    screen: "dashboard",
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return json(result);
});
