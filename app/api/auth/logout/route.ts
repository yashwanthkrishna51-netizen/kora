import { withPublic, json } from "@/lib/api/handler";
import { clearSessionCookie } from "@/lib/auth/cookies";

export const runtime = "nodejs";

/**
 * Deliberately public and deliberately unconditional: logging out must work
 * even when the session is already expired, revoked or malformed. Requiring a
 * valid session here would leave a user with a broken token unable to clear it.
 */
export const POST = withPublic(async () => {
  await clearSessionCookie();
  return json({ ok: true });
});
