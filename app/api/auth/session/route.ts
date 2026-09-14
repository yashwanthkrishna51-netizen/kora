import { getDb } from "@/lib/db/client";
import { readSessionCookie } from "@/lib/auth/cookies";
import { validateSession, reasonMessage } from "@/lib/auth/session";
import { errorResponse } from "@/lib/api/errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Who am I? Called on boot to restore a session.
 *
 * Returns 200 with `{user: null}` rather than 401 when there is no session:
 * "nobody is signed in" is the expected answer to this question, not an error,
 * and treating it as one makes every client log a failure on first load.
 */
export async function GET() {
  try {
    const token = await readSessionCookie();
    if (!token) return NextResponse.json({ user: null, reason: "no_token" });

    const session = await validateSession(getDb(), token);
    if (!session.valid) {
      return NextResponse.json({
        user: null,
        reason: session.reason,
        message: reasonMessage(session.reason),
      });
    }
    return NextResponse.json({ user: session.user });
  } catch (err) {
    return errorResponse(err, "GET /api/auth/session");
  }
}
