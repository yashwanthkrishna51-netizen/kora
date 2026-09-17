import { z } from "zod";
import { withPublic, json } from "@/lib/api/handler";
import { badRequest } from "@/lib/api/errors";
import { attemptLogin } from "@/lib/auth/login";
import { setSessionCookie } from "@/lib/auth/cookies";

// node:crypto and bcrypt both need the Node runtime.
export const runtime = "nodejs";

const Body = z.object({
  username: z.string().min(1, "Username is required").max(120),
  password: z.string().min(1, "Password is required").max(200),
});

export const POST = withPublic(async ({ db, ip, userAgent, req }) => {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw badRequest(parsed.error.issues[0]?.message ?? "Invalid request");
  }

  const result = await attemptLogin(db, { ...parsed.data, ip, userAgent });

  if (!result.ok) {
    return json(
      { error: result.error, ...(result.lockedUntil ? { lockedUntil: result.lockedUntil } : {}) },
      result.status,
    );
  }

  // The token never reaches JavaScript: httpOnly, so an injected script
  // cannot read it the way it could read the old localStorage session.
  await setSessionCookie(result.token);
  return json({ user: result.user });
});
