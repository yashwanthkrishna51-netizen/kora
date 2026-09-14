import { withAuth } from "@/lib/api/handler";
import { updateMilestone, archiveMilestone } from "@/lib/db/mutations/tracker";
import { milestoneUpdate } from "@/lib/validation/entities";
import { updated, removed } from "@/lib/api/mutate";

import { actorName } from "@/lib/api/actor";

export const runtime = "nodejs";

export const PATCH = withAuth<{ milestoneId: string }>(
  { role: "editor" },
  (ctx) =>
    updated(ctx, milestoneUpdate, "Update milestone", "milestones",
      (input, token) =>
        updateMilestone(ctx.db, ctx.params.milestoneId, token, input),
    ),
);

export const DELETE = withAuth<{ milestoneId: string }>(
  { role: "editor" },
  (ctx) =>
    removed(ctx, "Archive milestone", "milestones", (token) =>
      archiveMilestone(ctx.db, ctx.params.milestoneId, token, actorName(ctx)),
    ),
);
