import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { readSessionCookie } from "./cookies";
import { validateSession, type SessionResult } from "./session";
import { timed } from "@/lib/server/timing";

/**
 * The signed-in user for THIS request, resolved at most once.
 *
 * `React.cache` memoizes per request, not globally, so two server components in
 * the same render share one result and two different visitors never can.
 *
 * WHY IT EXISTS: the (app) layout validated the session, then the dashboard and
 * admin pages each validated it again — the same cookie, the same row, in the
 * same render pass. Against a local Postgres that was invisible; against a
 * remote pooler it is a whole extra round trip on the critical path of every
 * navigation, and the page cannot start rendering until it returns.
 *
 * COOKIE FIRST, THEN THE HANDLE. `validateSession(getDb(), await readSessionCookie())`
 * evaluates left to right and so reaches `getDb()` before the await, which is
 * what once made this route look statically analysable to Next and produced a
 * build-time database connection. That ordering now has exactly one home
 * instead of three, which is the point.
 */
export const getCurrentSession = cache(async (): Promise<SessionResult> => {
  const token = await readSessionCookie();
  const db = getDb();
  return timed("auth", () => validateSession(db, token));
});
