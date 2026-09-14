import { sendMail } from "./graph";
import { clientEmailHtml } from "./templates";
import { consume, clientEmailLimits } from "@/lib/api/rate-limit";
import { appUrl } from "@/lib/azure/config";
import { logAudit } from "@/lib/audit";
import type { AnyDb } from "@/lib/auth/db-types";
import type { SessionUser } from "@/lib/auth/session";
import type { z } from "zod";
import type { clientEmailSend } from "@/lib/validation/entities";

/**
 * A person emails a client a report.
 *
 * The mail leaves from the shared mailbox, not from the sender — app-only
 * Mail.Send has no other option. That surprises people, so the audit row names
 * who actually triggered it.
 */
export async function sendClientEmail(
  db: AnyDb,
  actor: SessionUser,
  input: z.infer<typeof clientEmailSend>,
  ctx: {
    ip?: string | null;
    userAgent?: string | null;
    clientName?: string;
    screen?: string | null;
  },
): Promise<{ sent: true; to: string; cc: number }> {
  // Before the send, and not refunded afterwards.
  await consume(db, clientEmailLimits(actor.id));

  await sendMail({
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    html: clientEmailHtml({ bodyText: input.bodyText, appUrl: appUrl() }),
    attachments: input.attachment
      ? [{
          name: input.attachment.fileName,
          // Forced, never taken from the request: the file is a report this
          // server generated, and letting the caller name the type is how an
          // attachment becomes something other than a document.
          contentType: "application/pdf",
          contentBytes: input.attachment.contentBase64,
        }]
      : undefined,
    // Client-facing mail is worth a copy in Sent Items; the digest is not.
    saveToSentItems: true,
  });

  await logAudit(db, {
    actorId: actor.id,
    username: actor.username,
    role: actor.role,
    // The recipient is recorded; the message body deliberately is not.
    action: `Emailed report to ${input.to}${ctx.clientName ? ` (${ctx.clientName})` : ""}`,
    entity: "client_email",
    screen: ctx.screen ?? null,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  return { sent: true, to: input.to, cc: input.cc?.length ?? 0 };
}
