import { withAuth } from "@/lib/api/handler";
import { createIntegration } from "@/lib/db/mutations/tracker";
import { integrationCreate } from "@/lib/validation/entities";
import { created } from "@/lib/api/mutate";

export const runtime = "nodejs";

export const POST = withAuth<{ clientId: string }>({ role: "editor" }, (ctx) =>
  created(ctx, integrationCreate, "Create integration", "integrations", (input) =>
    createIntegration(ctx.db, ctx.params.clientId, input),
  ),
);
