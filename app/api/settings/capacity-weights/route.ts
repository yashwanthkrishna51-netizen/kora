import { withAuth, json } from "@/lib/api/handler";
import { capacityWeightsUpdate } from "@/lib/validation/entities";
import { parseBody } from "@/lib/api/mutate";
import { putSetting } from "@/lib/db/mutations/settings";
import { logAudit } from "@/lib/audit";
import { getCapacityWeights } from "@/lib/db/queries/misc";

export const runtime = "nodejs";

/** Any signed-in user: the dashboard tile that uses these renders for everyone. */
export const GET = withAuth({}, async ({ db }) =>
  json({ capacityWeights: await getCapacityWeights(db) }),
);

/** PUT — admin only. Whole-object replace; there are only four numbers. */
export const PUT = withAuth({ role: "admin" }, async (ctx) => {
  const input = await parseBody(ctx.req, capacityWeightsUpdate);
  const value = await putSetting(ctx.db, "capacity_weights", input);
  await logAudit(ctx.db, {
    actorId: ctx.user.id, username: ctx.user.username, role: ctx.user.role,
    action: "Update capacity weights", entity: "app_settings",
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return json(value);
});
