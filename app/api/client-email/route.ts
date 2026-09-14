import { withAuth, json } from "@/lib/api/handler";
import { parseBody } from "@/lib/api/mutate";
import { clientEmailSend } from "@/lib/validation/entities";
import { sendClientEmail } from "@/lib/mail/client-email";
import { clients } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";

/**
 * POST /api/client-email — editor and above.
 *
 * Rate-limited per user and globally; the mailbox is shared, so one account
 * must not be able to spend everyone's standing with it.
 */
export const POST = withAuth({ role: "editor" }, async (ctx) => {
  const input = await parseBody(ctx.req, clientEmailSend);

  // Resolved here, never taken from the request. An audit row for mail that
  // left the company should name a client the server agrees exists; a stale or
  // wrong id simply yields no label.
  let clientName: string | undefined;
  if (input.clientId) {
    const row = await ctx.db
      .select({ name: clients.name })
      .from(clients)
      .where(eq(clients.id, input.clientId))
      .limit(1);
    clientName = row[0]?.name;
  }

  const result = await sendClientEmail(ctx.db, ctx.user, input, {
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    clientName,
    screen: ctx.req.headers.get("x-kora-screen"),
  });
  return json(result);
});
