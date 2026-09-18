import { withAuth, json } from "@/lib/api/handler";
import { createUser } from "@/lib/db/mutations/users";
import { userCreate } from "@/lib/validation/entities";
import { created } from "@/lib/api/mutate";
import { loadUsers } from "@/lib/server/loaders";

export const runtime = "nodejs";

/**
 * Shape depends on the caller's role — admins get lockout state and email,
 * everyone else gets just enough for an assignee dropdown. The role comes from
 * validateSession, which reads it fresh from the database, so a demotion takes
 * effect here immediately.
 */
export const GET = withAuth({}, async ({ user }) =>
  json(await loadUsers(user.role)),
);

/** POST /api/users — admin only. Plaintext in, bcrypt cost 12 stored. */
export const POST = withAuth({ role: "admin" }, (ctx) =>
  created(ctx, userCreate, "Create user", "users", (input) =>
    createUser(ctx.db, input),
  ),
);
