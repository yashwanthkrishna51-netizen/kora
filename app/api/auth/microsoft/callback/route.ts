import { NextResponse, type NextRequest } from "next/server";
import type { Db } from "@/lib/db/client";
import { withPublic } from "@/lib/api/handler";
import { azureApp, appUrl } from "@/lib/azure/config";
import { readAndClearSsoCookie, verifyState } from "@/lib/auth/microsoft/state";
import { nonceMatches } from "@/lib/auth/microsoft/pkce";
import { exchangeCode, fetchGraphMe } from "@/lib/auth/microsoft/exchange";
import { resolveSsoUser } from "@/lib/auth/microsoft/gate";
import { issueSession } from "@/lib/auth/login";
import { setSessionCookie } from "@/lib/auth/cookies";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const bounce = (code: string) =>
  NextResponse.redirect(`${appUrl()}/login?ssoError=${encodeURIComponent(code)}`);

/**
 * GET /api/auth/microsoft/callback — completes the sign-in.
 *
 * The token never touches a URL. The old app minted a 60-second `ssoTicket`,
 * put it in the query string and had the SPA trade it back — which meant a
 * replayable bearer credential sitting in browser history, since the ticket
 * was never single-use. Setting the httpOnly session cookie here removes the
 * whole mechanism.
 *
 * Validation order matters: everything through the nonce check happens BEFORE
 * any outbound call, so a fabricated callback costs one HMAC and nothing else.
 */
export const GET = withPublic(async (ctx) => {
  /**
   * A REDIRECT ENDPOINT REACHED BY A BROWSER ALWAYS REDIRECTS.
   *
   * withPublic's catch-all turns an unexpected throw into a JSON 500 with a
   * correlation id, which is right for an API route and wrong here: the person
   * has just authenticated with Microsoft and would land on
   * `{"error":"Something went wrong","ref":"4tjqkj"}` — stranded, with no
   * message and no way back.
   *
   * It happened for a reason worth recording. `ctx.db` is a lazy getter, so
   * `resolveSsoUser(db, …)` evaluates it as an ARGUMENT and `getDb()` throws
   * before the function is entered — meaning the gate's careful
   * `lookup_failed` handling never ran. Any failure inside this handler now
   * becomes a bounce with a code the login page can phrase, and the real cause
   * goes to the server log where an operator can find it.
   */
  try {
    return await handleCallback(ctx);
  } catch (err) {
    console.error(
      "SSO callback failed:",
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    return bounce("unexpected_error");
  }
});

async function handleCallback({
  req,
  db,
  ip,
  userAgent,
}: {
  req: NextRequest;
  db: Db;
  ip: string | null;
  userAgent: string | null;
}) {
  const params = new URL(req.url).searchParams;

  // Single-use, unconditionally and first: a cancelled attempt must not leave
  // a live PKCE verifier behind.
  const cookie = await readAndClearSsoCookie();

  const msftError = params.get("error");
  if (msftError) {
    // Entra's code is echoed so a consent or cancellation is diagnosable, but
    // sanitised — it lands in a URL and then on screen.
    const safe = msftError.toLowerCase().replace(/[^a-z_]/g, "").slice(0, 40);
    return bounce(`msft_${safe}`);
  }

  const creds = azureApp();
  const secret = process.env.INTEGTRACK_SECRET;
  if (!creds || !secret) return bounce("not_configured");

  const state = verifyState(cookie, secret, Date.now());
  if (!state) return bounce("state_invalid");

  // The per-browser binding the old flow lacked. Same code for a wrong nonce
  // and an expired state, so an attacker cannot tell the two apart.
  const returned = params.get("state");
  if (!returned || !nonceMatches(returned, state.nonce)) {
    return bounce("state_invalid");
  }

  const code = params.get("code");
  if (!code) return bounce("no_code");

  const exchanged = await exchangeCode(creds, code, state.verifier);
  if (!exchanged.ok) return bounce(exchanged.code);

  const profile = await fetchGraphMe(exchanged.accessToken);
  if (!profile.ok) return bounce(profile.code);

  const gate = await resolveSsoUser(db, profile.email);
  if (!gate.ok) {
    // Logged with the address so an admin can act on it; the person only sees
    // the message the login page maps from the code.
    await logAudit(db, {
      action: `Login failed via SSO (${gate.code}): ${profile.email}`,
      entity: "session",
      screen: "login",
      ip,
      userAgent,
    });
    return bounce(gate.code);
  }

  const session = await issueSession(db, gate.user, {
    ip,
    userAgent,
    action: "Login success (Microsoft SSO)",
  });

  await setSessionCookie(session.token);
  return NextResponse.redirect(`${appUrl()}${state.next ?? "/dashboard"}`);
}
