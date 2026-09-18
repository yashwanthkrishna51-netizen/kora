import { cookies } from "next/headers";
import { signSigned, verifySigned } from "@/lib/auth/token";

/**
 * The SSO state, split between a cookie and the URL.
 *
 * The old flow signed a state token carrying only an `origin` and passed the
 * whole thing through the query string. That is a replay and expiry guard, but
 * it binds the callback to nothing — any browser could complete a flow any
 * other browser started, which is the CSRF case the `state` parameter exists
 * to close.
 *
 * Here they are separated by what each channel can safely carry:
 *
 *   COOKIE (httpOnly, 10 min)  nonce, PKCE verifier, post-login destination
 *   URL (`?state=`)            the bare nonce, nothing else
 *
 * The verifier must never leave the server, and httpOnly keeps it away from
 * page script too. The query string travels through address bars, referrer
 * headers and proxy logs, so it carries a random value that means nothing on
 * its own. The destination rides in the cookie where it cannot be tampered
 * with, which removes the open-redirect surface entirely.
 */

export const SSO_STATE_TTL_MS = 10 * 60 * 1000;

export interface SsoState {
  /** Discriminator. A session token is also signed by us; this keeps them apart. */
  purpose: "msftAuthState";
  nonce: string;
  verifier: string;
  next?: string;
  iat: number;
  exp: number;
}

const PROD_NAME = "__Host-kora_sso";
const DEV_NAME = "kora_sso";

// Mirrors lib/auth/cookies.ts: the `__Host-` prefix requires Secure, which
// localhost cannot satisfy.
const isSecure = () => process.env.NODE_ENV === "production";
export const ssoCookieName = () => (isSecure() ? PROD_NAME : DEV_NAME);

export function signState(state: SsoState, secret: string): string {
  return signSigned(state, secret);
}

export function verifyState(
  token: string | null | undefined,
  secret: string | null | undefined,
  now: number,
): SsoState | null {
  const parsed = verifySigned<SsoState>(token, secret);
  if (!parsed) return null;
  // Not optional, even though the shape checks below happen to reject today's
  // only other signed payload (a session token has no nonce or verifier).
  // `verifySigned` proves nothing but "signed by us", so the discriminator is
  // what keeps this from accepting the next signed token someone adds that
  // happens to carry similarly-named fields.
  if (parsed.purpose !== "msftAuthState") return null;
  if (typeof parsed.exp !== "number" || now > parsed.exp) return null;
  if (typeof parsed.nonce !== "string" || typeof parsed.verifier !== "string") {
    return null;
  }
  return parsed;
}

export async function setSsoCookie(value: string): Promise<void> {
  const jar = await cookies();
  jar.set(ssoCookieName(), value, {
    httpOnly: true,
    secure: isSecure(),
    // Lax, not Strict: Strict drops the cookie on the redirect back from
    // Microsoft, which breaks the flow entirely. Same trade as the session
    // cookie, and documented there too.
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SSO_STATE_TTL_MS / 1000),
  });
}

/**
 * Reads the cookie and clears it in the same breath.
 *
 * Single-use, unconditionally and before any validation: a cancelled or failed
 * attempt must not leave a live PKCE verifier sitting in the browser.
 */
export async function readAndClearSsoCookie(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(PROD_NAME)?.value ?? jar.get(DEV_NAME)?.value ?? null;
  for (const name of [PROD_NAME, DEV_NAME]) {
    jar.set(name, "", { httpOnly: true, path: "/", maxAge: 0 });
  }
  return value || null;
}

/**
 * Only same-site paths are accepted as a post-login destination.
 *
 * `//evil.com` is protocol-relative and browsers treat it as absolute, so
 * checking for a leading slash alone is not enough.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}
