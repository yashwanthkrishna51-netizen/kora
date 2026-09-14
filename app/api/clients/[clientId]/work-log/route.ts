import { withAuth } from "@/lib/api/handler";
import { createWorkLogEntry } from "@/lib/db/mutations/tracker";
import { workLogCreate } from "@/lib/validation/entities";
import { created } from "@/lib/api/mutate";

export const runtime = "nodejs";

export const POST = withAuth<{ clientId: string }>({ role: "editor" }, (ctx) =>
  created(ctx, workLogCreate, "Create work log entry", "ams_work_log", (input) =>
    createWorkLogEntry(ctx.db, ctx.params.clientId, input),
  ),
);
