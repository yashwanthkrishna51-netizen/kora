import { z } from "zod";
import { withAuth, json } from "@/lib/api/handler";
import { badRequest } from "@/lib/api/errors";
import { changePassword } from "@/lib/auth/account";
import { setSessionCookie } from "@/lib/auth/cookies";

export const runtime = "nodejs";

const Body = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  // Both optional: this endpoint also serves a plain email update, which is
  // why it still demands the current password either way.
  newPassword: z.string().max(200).optional(),
  email: z.email("Enter a valid email address").max(200).optional(),
});

export const POST = withAuth({}, async ({ db, user, ip, userAgent, req }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");
  }

  const result = await changePassword(db, {
    userId: user.id,
    ...parsed.data,
    ip,
    userAgent,
  });

  // token_version has moved, so the cookie this request arrived with is now
  // invalid. Re-set it, or the person is signed out by their own action.
  await setSessionCookie(result.token);

  return json({
    user: result.user,
    passwordChanged: result.passwordChanged,
    ...(result.passwordChanged
      ? { message: "Password changed. Other sessions have been signed out." }
      : {}),
  });
});
