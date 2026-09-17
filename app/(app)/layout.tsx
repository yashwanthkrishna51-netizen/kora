import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth/current-session";
import { AppChrome } from "@/components/app-chrome";

/**
 * The authenticated shell.
 *
 * The session is validated HERE, on the server, not in proxy.ts. The proxy
 * checks a signature and an expiry so an unauthenticated visitor lands on
 * /login rather than on a shell that flashes and bounces — but it does not
 * touch the database, so it cannot know the session was revoked or the role
 * changed. This does the full check, and every API route does it again.
 *
 * That means the role driving the sidebar is always the DATABASE's role, never
 * the one baked into the token. A demotion takes effect on the next page load
 * rather than in seven days when the token expires.
 */
/**
 * Never prerendered.
 *
 * Every page under this layout depends on who is asking, so a build-time HTML
 * snapshot is meaningless — and worse than meaningless: Next attempted to
 * prerender `/ams`, ran this layout, and hit the database during `next build`.
 *
 * `cookies()` below would normally mark the route dynamic on its own, but only
 * once it is CALLED. Argument evaluation is left to right, so
 * `validateSession(getDb(), await readSessionCookie())` reached `getDb()`
 * first — before Next had learned this route could not be static. The cookie
 * is now read before the database handle is asked for, and this export states
 * the intent rather than relying on that ordering holding.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // One session lookup per request, shared with every page below via
  // React.cache — see lib/auth/current-session.ts, which also owns the
  // cookie-before-handle ordering this comment used to guard here.
  const session = await getCurrentSession();

  if (!session.valid) {
    // The proxy normally catches this first; reaching here means the session
    // was revoked between the proxy's signature check and now.
    redirect("/login");
  }

  return (
    <AppChrome
      user={{
        name: session.user.name,
        username: session.user.username,
        role: session.user.role,
      }}
    >
      {children}
    </AppChrome>
  );
}
