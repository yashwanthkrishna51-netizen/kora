import { withAuth } from "@/lib/api/handler";
import { updateIntegration, archiveIntegration } from "@/lib/db/mutations/tracker";
import { integrationUpdate } from "@/lib/validation/entities";
import { updated, removed } from "@/lib/api/mutate";

import { actorName } from "@/lib/api/actor";

export const runtime = "nodejs";

export const PATCH = withAuth<{ integrationId: string }>(
  { role: "editor" },
  (ctx) =>
    updated(ctx, integrationUpdate, "Update integration", "integrations",
      (input, token) =>
        updateIntegration(ctx.db, ctx.params.integrationId, token, input),
    ),
);

/** Archives the integration and its milestones together. */
export const DELETE = withAuth<{ integrationId: string }>(
  { role: "editor" },
  (ctx) =>
    removed(ctx, "Archive integration", "integrations", (token) =>
      archiveIntegration(ctx.db, ctx.params.integrationId, token, actorName(ctx)),
    ),
);
