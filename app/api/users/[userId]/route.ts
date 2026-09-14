import { withAuth } from "@/lib/api/handler";
import { updateUser, deleteUser } from "@/lib/db/mutations/users";
import { userUpdate } from "@/lib/validation/entities";
import { updated, removed } from "@/lib/api/mutate";

export const runtime = "nodejs";

/**
 * PATCH /api/users/[userId] — admin only.
 *
 * The last-admin guard runs inside the same transaction as the write. The old
 * app checked the array the browser posted, so two tabs demoting each other
 * both passed and left the organisation with no admin at all.
 */
export const PATCH = withAuth<{ userId: string }>({ role: "admin" }, (ctx) =>
  updated(ctx, userUpdate, "Update user", "users", (input, token) =>
    updateUser(ctx.db, ctx.params.userId, token, input),
  ),
);

export const DELETE = withAuth<{ userId: string }>({ role: "admin" }, (ctx) =>
  removed(ctx, "Delete user", "users", (token) =>
    deleteUser(ctx.db, ctx.params.userId, token, ctx.user.id),
  ),
);
