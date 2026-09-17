import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie } from "@/lib/auth/cookies";

export const runtime = "nodejs";

/**
 * `/logout` — sign out by typing a URL.
 *
 * A ROUTE HANDLER, NOT A PAGE, because clearing the cookie is the whole job and
 * a Server Component cannot do it: `cookies().set()` throws during render. A
 * route handler is the one place a GET may set a cookie, so the address bar,
 * a bookmark and a link all work without a form.
 *
 * `POST /api/auth/logout` stays as it is — that is what the sidebar button
 * calls, and it answers JSON. This is the human-typed door to the same thing.
 *
 * ONLY ON A REAL NAVIGATION. A GET that mutates means `<img src=".../logout">`
 * on any page anywhere signs the reader out — not dangerous, but rude, and
 * trivially avoided: `Sec-Fetch-Dest: document` is sent by every browser on a
 * top-level navigation and never on a subresource. A request that is not one
 * still lands on /login, so nothing hangs; it simply does not clear anything.
 * Browsers that send no `Sec-Fetch-*` at all are treated as navigations, since
 * refusing them would break sign-out on the browser rather than protect it.
 *
 * `proxy.ts` lets this path through in both signed-in and signed-out states —
 * see the comment there; either arm of its usual logic breaks this route.
 */
export async function GET(req: NextRequest) {
  const dest = req.headers.get("sec-fetch-dest");
  const isNavigation = dest === null || dest === "document";

  if (isNavigation) await clearSessionCookie();

  // 303, not the default 307: the browser must follow with a GET, and this is
  // the one redirect in the app that answers a request whose method matters.
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
