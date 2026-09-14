import { withAuth, json } from "@/lib/api/handler";
import { forceLogoutAll } from "@/lib/auth/account";
import { clearSessionCookie } from "@/lib/auth/cookies";

export const runtime = "nodejs";

/**
 * Signs everyone out, including the admin who called it.
 *
 * That is intended: the operation exists for the cutover freeze, where the
 * whole point is that nobody keeps writing. The caller's own cookie is cleared
 * here too rather than leaving them holding a token the server will reject on
 * the next request, which would look like a random failure.
 */
export const POST = withAuth({ role: "admin" }, async ({ db, user, ip, userAgent }) => {
  const result = await forceLogoutAll(db, user, { ip, userAgent });
  await clearSessionCookie();

  return json({
    ...result,
    message: `Signed out ${result.affected} user${result.affected === 1 ? "" : "s"}, including you.`,
  });
});
