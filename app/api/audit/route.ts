import { withAuth, json } from "@/lib/api/handler";
import { listAudit } from "@/lib/db/queries/misc";

export const runtime = "nodejs";

export const GET = withAuth({ role: "admin" }, async ({ db, req }) => {
  const p = new URL(req.url).searchParams;
  const result = await listAudit(db, {
    from: p.get("from") ?? undefined,
    to: p.get("to") ?? undefined,
    user: p.get("user") ?? undefined,
    q: p.get("q") ?? undefined,
    limit: p.get("limit") ? Number(p.get("limit")) : undefined,
    offset: p.get("offset") ? Number(p.get("offset")) : undefined,
  });
  return json(result);
});
