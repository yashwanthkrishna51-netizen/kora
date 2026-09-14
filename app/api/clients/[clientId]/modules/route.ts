import { withAuth } from "@/lib/api/handler";
import { createModule } from "@/lib/db/mutations/tracker";
import { moduleCreate } from "@/lib/validation/entities";
import { created } from "@/lib/api/mutate";

export const runtime = "nodejs";

/** Creates the module and all nine phases in one transaction. */
export const POST = withAuth<{ clientId: string }>({ role: "editor" }, (ctx) =>
  created(ctx, moduleCreate, "Create module", "modules", (input) =>
    createModule(ctx.db, ctx.params.clientId, input),
  ),
);
