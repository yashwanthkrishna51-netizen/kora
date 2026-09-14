import { getClientTrees } from "@/lib/db/queries/clients";
import { getDigestRecipients, getDigestUserDirectory } from "@/lib/db/queries/misc";
import { planDigest, type OutboundEmail } from "./compute";
import { sendMail } from "@/lib/mail/graph";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * The impure shell around lib/digest/compute.ts.
 *
 * Fetches, calls the pure planner, sends. Everything that touches the outside
 * world — the clock, the mailer, the pause between sends — is injectable, so
 * the orchestration is testable without a network and without waiting.
 */

/**
 * All mail leaves through one mailbox, and Outlook throttles roughly four
 * concurrent operations per mailbox. Sending in parallel does not go faster;
 * it goes slower and then starts failing. 350ms is the old app's pacing.
 */
export const SEND_PACING_MS = 350;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface DigestResult {
  ok: boolean;
  planned: number;
  sent: number;
  failed: number;
  stats: { total: number; routed: number; unroutable: number };
  /** Populated on a dry run so an admin can see who would get what. */
  preview?: { to: string; subject: string }[];
}

export async function runDigest(opts: {
  db: AnyDb;
  appUrl: string;
  now?: Date;
  dryRun?: boolean;
  send?: (email: OutboundEmail) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}): Promise<DigestResult> {
  const { db, appUrl } = opts;
  const now = opts.now ?? new Date();
  const sleep = opts.sleep ?? wait;
  const send =
    opts.send ??
    ((email: OutboundEmail) =>
      sendMail({ to: email.to, subject: email.subject, html: email.html }));

  // getClientTrees is the same shaping path the API serves and migrate:verify
  // certified. It carries activity-log jsonb the digest never reads, which is
  // wasteful once a day and worth it: a bespoke narrow query here would be a
  // second definition of "what a client looks like", free to drift from the
  // one the UI shows.
  const [clients, users, recipients] = await Promise.all([
    getClientTrees(db),
    getDigestUserDirectory(db),
    getDigestRecipients(db),
  ]);

  const { emails, stats } = planDigest({
    clients,
    users,
    fallbackEmails: recipients.emails,
    appUrl,
    now,
  });

  if (opts.dryRun) {
    return {
      ok: true,
      planned: emails.length,
      sent: 0,
      failed: 0,
      stats,
      preview: emails.map((e) => ({ to: e.to, subject: e.subject })),
    };
  }

  let sent = 0;
  let failed = 0;

  for (const [index, email] of emails.entries()) {
    try {
      await send(email);
      sent++;
    } catch (err) {
      // One bad address must not cost everyone else their reminder. The old
      // cron had the same property; it is the reason the loop catches per
      // message rather than wrapping the whole run.
      failed++;
      console.error(
        `digest: send to ${email.to} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
    if (index < emails.length - 1) await sleep(SEND_PACING_MS);
  }

  return { ok: true, planned: emails.length, sent, failed, stats };
}
