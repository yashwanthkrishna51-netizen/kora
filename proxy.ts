import { NextResponse, type NextRequest } from "next/server";
import { verifyToken, isExpired } from "@/lib/auth/token";

/**
 * Route protection.
 *
 * In Next.js 16 this file is `proxy.ts`, not `middleware.ts`, and it runs on
 * the Node.js runtime — the edge runtime is not supported here and cannot be
 * configured. That is convenient: `node:crypto` is available, so the cookie
 * signature can be checked with the same code the API uses, rather than a
 * separate Web Crypto implementation that could drift from it.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. It checks the signature and expiry only —
 * no database, so it cannot know whether the session was revoked or the user's
 * role changed. Every API route re-validates in full via `validateSession`,
 * including the token_version read. What this buys is the redirect: an
 * unauthenticated visitor lands on /login instead of on an app shell that
 * flashes and then bounces them.
 */

const PUBLIC_PATHS = ["/login"];

/** Both cookie names, matching lib/auth/cookies.ts. */
const COOKIE_NAMES = ["__Host-kora_session", "kora_session"];

function readToken(req: NextRequest): string | null {
  for (const name of COOKIE_NAMES) {
    const v = req.cookies.get(name)?.value;
    if (v) return v;
  }
  return null;
}

function hasPlausibleSession(req: NextRequest): boolean {
  const secret = process.env.INTEGTRACK_SECRET;
  if (!secret) return false;

  const token = readToken(req);
  if (!token) return false;

  const payload = verifyToken(token, secret);
  if (!payload) return false;

  return !isExpired(payload);
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  /**
   * `/logout` answers to nobody here, and needs its own arm because BOTH of
   * the ones below are wrong for it.
   *
   * Treated as protected, a signed-out visitor is sent to
   * `/login?next=/logout` — and `next` is followed after signing in, so they
   * would be signed straight back out again. Treated as public, the branch
   * below redirects a SIGNED-IN visitor to /dashboard, and the handler that
   * clears the cookie never runs at all.
   *
   * It is safe to let through in both states: the handler clears whatever is
   * there and redirects to /login either way.
   */
  if (pathname === "/logout") return NextResponse.next();

  const signedIn = hasPlausibleSession(req);
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (isPublic) {
    // Already signed in and heading to /login — send them to the app instead,
    // unless they arrived carrying an SSO error that the page needs to show.
    if (signedIn && !req.nextUrl.searchParams.has("ssoError")) {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    return NextResponse.next();
  }

  if (!signedIn) {
    const url = new URL("/login", req.url);
    // Preserve where they were going, so the deep link survives the round trip
    // through sign-in rather than dumping everyone on the dashboard.
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except API routes, Next's own assets, and files with an
   * extension. API routes do their own full validation and must return JSON
   * 401s rather than an HTML redirect.
   */
  matcher: ["/((?!api/|_next/|.*\\.[^/]+$).*)"],
};
