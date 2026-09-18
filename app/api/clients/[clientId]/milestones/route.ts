import { withAuth } from "@/lib/api/handler";
import { createMilestone } from "@/lib/db/mutations/tracker";
import { milestoneCreate } from "@/lib/validation/entities";
import { created } from "@/lib/api/mutate";

export const runtime = "nodejs";

export const POST = withAuth<{ clientId: string }>({ role: "editor" }, (ctx) =>
  created(ctx, milestoneCreate, "Create milestone", "milestones", (input) =>
    createMilestone(ctx.db, ctx.params.clientId, input),
  ),
);
