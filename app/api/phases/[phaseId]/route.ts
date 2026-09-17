import { withAuth } from "@/lib/api/handler";
import { updatePhase } from "@/lib/db/mutations/tracker";
import { phaseUpdate } from "@/lib/validation/entities";
import { updated } from "@/lib/api/mutate";

export const runtime = "nodejs";

/**
 * PATCH /api/phases/[phaseId]
 *
 * There is no POST or DELETE: a module has exactly the nine fixed phases,
 * created with it. The Implementation matrix is a nine-column grid and every
 * completion percentage assumes all nine rows exist.
 *
 * Carries the signoff gate, which until now ran only in the browser.
 */
export const PATCH = withAuth<{ phaseId: string }>({ role: "editor" }, (ctx) =>
  updated(ctx, phaseUpdate, "Update phase", "phases", (input, token) =>
    updatePhase(ctx.db, ctx.params.phaseId, token, input),
  ),
);
