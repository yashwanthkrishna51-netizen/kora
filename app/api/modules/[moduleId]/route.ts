import { withAuth } from "@/lib/api/handler";
import { updateModule, archiveModule } from "@/lib/db/mutations/tracker";
import { moduleUpdate } from "@/lib/validation/entities";
import { updated, removed } from "@/lib/api/mutate";

import { actorName } from "@/lib/api/actor";

export const runtime = "nodejs";

export const PATCH = withAuth<{ moduleId: string }>({ role: "editor" }, (ctx) =>
  updated(ctx, moduleUpdate, "Update module", "modules", (input, token) =>
    updateModule(ctx.db, ctx.params.moduleId, token, input),
  ),
);

/** Archives the module and its nine phases together. */
export const DELETE = withAuth<{ moduleId: string }>({ role: "editor" }, (ctx) =>
  removed(ctx, "Archive module", "modules", (token) =>
    archiveModule(ctx.db, ctx.params.moduleId, token, actorName(ctx)),
  ),
);
