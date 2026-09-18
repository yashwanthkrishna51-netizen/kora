import { withAuth, json } from "@/lib/api/handler";
import { forceLogoutUser, assertUserId } from "@/lib/auth/account";

export const runtime = "nodejs";

export const POST = withAuth<{ userId: string }>(
  { role: "admin" },
  async ({ db, user, ip, userAgent, params }) => {
    const id = assertUserId(params.userId);
    const result = await forceLogoutUser(db, id, user, { ip, userAgent });

    return json({
      ...result,
      message: `Signed out ${result.username} on all devices.`,
    });
  },
);
