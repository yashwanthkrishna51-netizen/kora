import { withAuth } from "@/lib/api/handler";
import { updateWorkLogEntry, archiveWorkLogEntry } from "@/lib/db/mutations/tracker";
import { workLogUpdate } from "@/lib/validation/entities";
import { updated, removed } from "@/lib/api/mutate";

import { actorName } from "@/lib/api/actor";

export const runtime = "nodejs";

export const PATCH = withAuth<{ entryId: string }>({ role: "editor" }, (ctx) =>
  updated(ctx, workLogUpdate, "Update work log entry", "ams_work_log",
    (input, token) =>
      updateWorkLogEntry(ctx.db, ctx.params.entryId, token, input),
  ),
);

export const DELETE = withAuth<{ entryId: string }>({ role: "editor" }, (ctx) =>
  removed(ctx, "Archive work log entry", "ams_work_log", (token) =>
    archiveWorkLogEntry(ctx.db, ctx.params.entryId, token, actorName(ctx)),
  ),
);
