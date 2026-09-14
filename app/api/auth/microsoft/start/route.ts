import { NextResponse } from "next/server";
import { withPublic } from "@/lib/api/handler";
import { azureApp, authorizeUrl, ssoRedirectUri, appUrl } from "@/lib/azure/config";
import { createVerifier, challengeFor, newNonce } from "@/lib/auth/microsoft/pkce";
import {
  signState, setSsoCookie, safeNext, SSO_STATE_TTL_MS,
} from "@/lib/auth/microsoft/state";
import { SSO_SCOPE } from "@/lib/auth/microsoft/exchange";

export const runtime = "nodejs";

const bounce = (code: string) =>
  NextResponse.redirect(`${appUrl()}/login?ssoError=${encodeURIComponent(code)}`);

/**
 * GET /api/auth/microsoft/start — begins the sign-in.
 *
 * Redirects are issued with NextResponse.redirect rather than `redirect()`
 * from next/navigation. `redirect()` works by throwing, and withPublic's
 * catch-all would turn that throw into a JSON 500 with a correlation id.
 */
export const GET = withPublic(async ({ req }) => {
  const creds = azureApp();
  const secret = process.env.INTEGTRACK_SECRET;
  if (!creds || !secret) return bounce("not_configured");

  /**
   * Refuse to start a flow that cannot possibly finish.
   *
   * `redirect_uri` is built from KORA_APP_URL and must match what is
   * registered in Entra character for character. If the app is reachable on a
   * host KORA_APP_URL does not name — a deployment where the variable was
   * never set, or a dev server that fell back to :3001 because something else
   * had :3000 — then Microsoft authenticates the user and sends the code
   * somewhere else entirely. Both happened here: a second local project owned
   * :3000, and the first deploy had no KORA_APP_URL, so the live app asked
   * Microsoft to send its codes to localhost.
   *
   * The failure downstream is bewildering (a 400 from an unrelated app, or a
   * silent redirect to a machine that is not yours). Catching it at the start
   * turns it into one sentence naming the exact mismatch.
   */
  const requestHost = req.headers.get("host");
  const expectedHost = (() => {
    try {
      return new URL(appUrl()).host;
    } catch {
      return null;
    }
  })();

  if (requestHost && expectedHost && requestHost !== expectedHost) {
    console.error(
      `SSO refused: reached on host "${requestHost}" but KORA_APP_URL says ` +
        `"${expectedHost}". Microsoft would send the code to ${ssoRedirectUri()}, ` +
        `which is not where this request came from.`,
    );
    return bounce("host_mismatch");
  }

  const verifier = createVerifier();
  const nonce = newNonce();
  const now = Date.now();

  // The verifier and the destination stay server-side in an httpOnly cookie;
  // only the nonce travels through the URL.
  await setSsoCookie(
    signState(
      {
        purpose: "msftAuthState",
        nonce,
        verifier,
        next: safeNext(new URL(req.url).searchParams.get("next")),
        iat: now,
        exp: now + SSO_STATE_TTL_MS,
      },
      secret,
    ),
  );

  const url = new URL(authorizeUrl(creds.tenantId));
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ssoRedirectUri());
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SSO_SCOPE);
  url.searchParams.set("state", nonce);
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  // Without this, a shared machine silently reuses whichever Entra session is
  // cached, and the "not registered in Kora" bounce becomes baffling — the
  // person never saw an account picker, so they cannot tell which account was
  // tried. One extra click buys a comprehensible failure.
  url.searchParams.set("prompt", "select_account");

  return NextResponse.redirect(url.toString());
});
