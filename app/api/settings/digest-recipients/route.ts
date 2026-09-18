import { withAuth, json } from "@/lib/api/handler";
import { digestRecipientsUpdate } from "@/lib/validation/entities";
import { parseBody } from "@/lib/api/mutate";
import { putSetting } from "@/lib/db/mutations/settings";
import { logAudit } from "@/lib/audit";
import { getDigestRecipients } from "@/lib/db/queries/misc";

export const runtime = "nodejs";

/**
 * ADMIN ONLY — this is the fix for a real gap.
 *
 * The old endpoint had no role check, so any viewer could read the internal
 * distribution list: a list of colleagues' email addresses, served to anyone
 * with an account.
 */
export const GET = withAuth({ role: "admin" }, async ({ db }) =>
  json({ digestRecipients: await getDigestRecipients(db) }),
);

export const PUT = withAuth({ role: "admin" }, async (ctx) => {
  const input = await parseBody(ctx.req, digestRecipientsUpdate);
  // Deduplicated case-insensitively: the digest sends one mail per address,
  // and "Ops@" alongside "ops@" means someone gets it twice every morning.
  const seen = new Set<string>();
  const emails = input.emails.filter((e) => {
    const key = e.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const value = await putSetting(ctx.db, "digest_recipients", { emails });
  await logAudit(ctx.db, {
    actorId: ctx.user.id, username: ctx.user.username, role: ctx.user.role,
    action: "Update digest recipients", entity: "app_settings",
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return json(value);
});
