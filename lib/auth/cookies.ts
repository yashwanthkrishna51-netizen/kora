import { cookies } from "next/headers";
import { SEVEN_DAYS_MS } from "./token";

/**
 * Session cookie.
 *
 * The old app kept its token in localStorage and sent it as `x-session-token`.
 * Any script that reached the page could read it. An httpOnly cookie cannot be
 * read from JavaScript at all, which removes session theft from the list of
 * things an XSS gets you, and — being same-origin — removes the need for CORS
 * entirely.
 *
 * `__Host-` is the strictest prefix the browser enforces: it REQUIRES Secure,
 * Path=/, and no Domain attribute, which stops a subdomain from writing a
 * cookie the app would then trust. It cannot be used over plain HTTP, so local
 * development falls back to an unprefixed name.
 */

const PROD_NAME = "__Host-kora_session";
const DEV_NAME = "kora_session";

export function cookieName(): string {
  return isSecureContext() ? PROD_NAME : DEV_NAME;
}

function isSecureContext(): boolean {
  // Vercel always serves HTTPS; localhost does not.
  return process.env.NODE_ENV === "production";
}

/** Both names, so a cookie set before a config change is still found. */
export function candidateNames(): string[] {
  return [PROD_NAME, DEV_NAME];
}

export async function readSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  for (const name of candidateNames()) {
    const value = jar.get(name)?.value;
    if (value) return value;
  }
  return null;
}

export async function setSessionCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(cookieName(), token, {
    httpOnly: true,
    secure: isSecureContext(),
    // Lax rather than Strict: Strict would drop the cookie on the redirect
    // back from Microsoft's sign-in, breaking SSO. Lax still blocks the
    // cross-site POSTs that CSRF depends on.
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SEVEN_DAYS_MS / 1000),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  // Clear both names so logout works regardless of which one is present.
  for (const name of candidateNames()) {
    jar.set(name, "", {
      httpOnly: true,
      secure: isSecureContext(),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
