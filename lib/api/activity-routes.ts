import { withAuth, json } from "@/lib/api/handler";
import {
  appendActivity, editActivity, deleteActivity, type FeedKind,
} from "@/lib/db/mutations/activity";
import { activityCreate } from "@/lib/validation/entities";
import { parseBody } from "@/lib/api/mutate";
import { logAudit } from "@/lib/audit";
import type { Ctx } from "@/lib/api/handler";

/**
 * An integration's timeline and a phase's updates are the same feed on two
 * parents, so the handlers are built once and mounted twice rather than
 * copied. Copying is how the two drift, and a divergence here means one feed
 * quietly loses the author check or the edit history.
 *
 * NO If-Match on any of these. Posting to a feed is not an edit of a shared
 * field — two people commenting at once is a conversation, not a conflict,
 * and the insert is atomic in SQL.
 */

function audit<P>(ctx: Ctx<P>, action: string) {
  return logAudit(ctx.db, {
    actorId: ctx.user.id, username: ctx.user.username, role: ctx.user.role,
    action, entity: "activity", ip: ctx.ip, userAgent: ctx.userAgent,
  });
}

export function activityCollection<P extends Record<string, string>>(
  kind: FeedKind,
  parentIdOf: (params: P) => string,
) {
  return withAuth<P>({ role: "editor" }, async (ctx) => {
    const input = await parseBody(ctx.req, activityCreate);
    const result = await appendActivity(
      ctx.db, kind, parentIdOf(ctx.params), ctx.user, input,
    );
    await audit(ctx, `Post ${kind} update`);
    return json(result, 201);
  });
}

export function activityItem<P extends Record<string, string>>(
  kind: FeedKind,
  parentIdOf: (params: P) => string,
  entryIdOf: (params: P) => string,
) {
  const PATCH = withAuth<P>({ role: "editor" }, async (ctx) => {
    const input = await parseBody(ctx.req, activityCreate);
    const result = await editActivity(
      ctx.db, kind, parentIdOf(ctx.params), entryIdOf(ctx.params),
      ctx.user, input,
    );
    await audit(ctx, `Edit ${kind} update`);
    return json(result);
  });

  const DELETE = withAuth<P>({ role: "editor" }, async (ctx) => {
    const result = await deleteActivity(
      ctx.db, kind, parentIdOf(ctx.params), entryIdOf(ctx.params), ctx.user,
    );
    await audit(ctx, `Delete ${kind} update`);
    return json(result);
  });

  return { PATCH, DELETE };
}
