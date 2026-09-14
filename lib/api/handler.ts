import { NextResponse, type NextRequest } from "next/server";
import { getDb, type Db } from "@/lib/db/client";
import { readSessionCookie } from "@/lib/auth/cookies";
import { validateSession, type SessionUser } from "@/lib/auth/session";
import { clientIp, userAgent } from "./ip";
import {
  AppError,
  errorResponse,
  forbidden,
  readOnly,
  unauthorized,
} from "./errors";

/**
 * The wrapper every authenticated route uses.
 *
 * Centralising this is what keeps authorisation from drifting: in the old app
 * each of the ten functions re-derived its own role check, and the ones that
 * were missed are exactly where the gaps turned up — `ops?op=settings` had no
 * role check at all and leaked the digest recipient list to any viewer.
 */

export type Role = "viewer" | "editor" | "admin";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export interface Ctx<P = Record<string, string>> {
  /**
   * The database handle, resolved on FIRST ACCESS rather than eagerly.
   *
   * `withPublic` used to build one for every route, which coupled routes that
   * never touch the database to its availability: a misconfigured
   * DATABASE_URL made `/api/auth/microsoft/start` — a pure redirect that
   * issues no query — return an opaque 500 alongside everything else. A route
   * should fail on the dependencies it actually uses.
   */
  db: Db;
  user: SessionUser;
  ip: string | null;
  userAgent: string | null;
  req: NextRequest;
  /** Route params, already awaited — Next 16 hands them over as a promise. */
  params: P;
}

export interface AuthOptions {
  /** Minimum role. Omit to allow any signed-in user. */
  role?: Role;
}

/**
 * THE READ-ONLY GATE.
 *
 * During the parallel run the new app is live for everyone to read while the
 * old app stays the only place anything is edited. Two apps writing the same
 * database is not survivable here — one edit in the old app rewrites a whole
 * client's subtree in v2 from the v1 jsonb, silently replacing anything this
 * app wrote — so "only one writer" is the property the whole arrangement rests
 * on, and it is enforced here rather than by asking people not to.
 *
 * ONE PLACE IS ENOUGH, which is worth stating because it looks too easy: every
 * write route in the app goes through `withAuth`, including the four activity
 * routes, which reach it via `activityCollection`. Login, logout and the two
 * crons use `withPublic` and are deliberately NOT gated — people must still be
 * able to sign in and out, and the nightly backup should keep running.
 *
 * An environment variable rather than a build flag, so lifting it is a Vercel
 * setting change and a redeploy, not a code change.
 */
export function isReadOnly(): boolean {
  return process.env.KORA_READ_ONLY === "1";
}

function assertWritable(): void {
  if (!isReadOnly()) return;
  throw readOnly(
    "Kora is read-only right now. Please make this change in the current Kora — " +
      "everything here is a live view of the same data.",
  );
}

export function withAuth<P = Record<string, string>>(
  opts: AuthOptions,
  handler: (ctx: Ctx<P>) => Promise<NextResponse>,
) {
  return async (
    req: NextRequest,
    routeCtx?: { params?: Promise<P> },
  ): Promise<NextResponse> => {
    const context = `${req.method} ${new URL(req.url).pathname}`;
    const t0 = performance.now();
    try {
      const db = getDb();
      const token = await readSessionCookie();
      const session = await validateSession(db, token);
      const authMs = Math.round(performance.now() - t0);

      if (!session.valid) {
        // The client maps the reason to a message; it reveals nothing an
        // attacker does not already know, since they hold the token.
        throw unauthorized("Not signed in", { reason: session.reason });
      }

      const required = opts.role;
      if (required && RANK[session.user.role as Role] < RANK[required]) {
        // Note this uses the role read fresh from the database in
        // validateSession, never the one embedded in the token, so a
        // demotion takes effect on the very next request.
        throw forbidden();
      }

      // Same-origin guard for mutations. SameSite=Lax already blocks the
      // cross-site form POSTs CSRF relies on; this is the cheap second layer.
      if (req.method !== "GET" && req.method !== "HEAD") {
        assertSameOrigin(req);
        assertWritable();
      }

      const t1 = performance.now();
      const res = await handler({
        db,
        user: session.user,
        ip: clientIp(req.headers),
        userAgent: userAgent(req.headers),
        req,
        params: ((await routeCtx?.params) ?? {}) as P,
      });

      /**
       * SERVER-TIMING, on every authenticated response.
       *
       * `auth` is the session lookup — one database round trip that every
       * request pays before it does anything useful — and `handler` is the
       * real work. Splitting them is the difference between "the API is slow"
       * and "the API spends 200ms proving who you are, because the database is
       * on another continent". Visible in the browser's Network panel under
       * Timing with no profiler and no redeploy, which is what makes it usable
       * against production rather than against my laptop.
       */
      res.headers.set(
        "Server-Timing",
        `auth;dur=${authMs}, handler;dur=${Math.round(performance.now() - t1)}`,
      );
      return res;
    } catch (err) {
      return errorResponse(err, context);
    }
  };
}

/** Public routes still want the db + client info, without a session. */
export function withPublic<P = Record<string, string>>(
  handler: (
    ctx: Omit<Ctx<P>, "user"> & { user: null },
  ) => Promise<NextResponse>,
) {
  return async (
    req: NextRequest,
    routeCtx?: { params?: Promise<P> },
  ): Promise<NextResponse> => {
    const context = `${req.method} ${new URL(req.url).pathname}`;
    try {
      return await handler({
        // Lazy: a public route that issues no query must not fail because the
        // database is unreachable. See the note on Ctx.db.
        get db() {
          return getDb();
        },
        user: null,
        ip: clientIp(req.headers),
        userAgent: userAgent(req.headers),
        req,
        params: ((await routeCtx?.params) ?? {}) as P,
      });
    } catch (err) {
      return errorResponse(err, context);
    }
  };
}

/**
 * Rejects a mutation that did not originate from our own origin.
 *
 * `Sec-Fetch-Site` is set by the browser and cannot be spoofed by page script.
 * Requests with neither header (curl, server-to-server) are allowed through —
 * they carry no ambient cookie, so they are not the CSRF case.
 */
function assertSameOrigin(req: NextRequest): void {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new AppError(403, "Cross-site request blocked");
  }

  const origin = req.headers.get("origin");
  if (origin) {
    const expected = process.env.KORA_APP_URL;
    const host = req.headers.get("host");
    const ok =
      (expected && origin === expected.replace(/\/+$/, "")) ||
      (host && new URL(origin).host === host);
    if (!ok) throw new AppError(403, "Cross-site request blocked");
  }
}

/**
 * The single JSON responder.
 *
 * Takes a status number rather than a ResponseInit because a second helper
 * with a different second argument existed briefly and was picked by accident
 * twice — `json(body, 201)` silently meaning `{}` is the kind of mistake that
 * only shows up as a 200 where a 201 was intended.
 */
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}
