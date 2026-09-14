import { z } from "zod";
import { withAuth, json } from "@/lib/api/handler";
import { clearLockout, assertUserId } from "@/lib/auth/account";

export const runtime = "nodejs";

const Body = z.object({
  // Opt-in, because those rows are also the evidence of an attack in progress.
  clearNetworkLocks: z.boolean().optional(),
});

export const POST = withAuth<{ userId: string }>(
  { role: "admin" },
  async ({ db, user, ip, userAgent, params, req }) => {
    const body = Body.safeParse(await req.json().catch(() => ({})));
    const opts = body.success ? body.data : {};

    const id = assertUserId(params.userId);
    const result = await clearLockout(db, id, user, { ip, userAgent }, opts);

    // Surfacing the network-lock count is the actual fix here: the old button
    // cleared the account and said nothing about the second lock still in force.
    const message =
      result.networkLocksCleared > 0
        ? `Unlocked ${result.username} and cleared ${result.networkLocksCleared} network lock(s).`
        : result.networkLocksActive > 0
          ? `Unlocked ${result.username}. ${result.networkLocksActive} network lock(s) are still active — if they still cannot sign in, retry with clearNetworkLocks.`
          : `Unlocked ${result.username}.`;

    return json({ ...result, message });
  },
);
