"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Paperclip, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Field, fieldProps, validate } from "@/components/ui/form";
import { clientEmailSend } from "@/lib/validation/entities";
import { api, ApiError } from "@/lib/api/fetcher";
import { useSession } from "@/lib/query/permissions";
import { fmtDate, todayStr } from "@/lib/utils/dates";
import type { Client } from "@/lib/domain/types";

/**
 * Email the Integration Report to a client.
 *
 * The only path in this app whose output demonstrably leaves the building:
 * `audit_log` records five real sends, including a report to a client address.
 * The plan had it down as never used, which was wrong and is why it ships with
 * the exports rather than after them.
 *
 * The PDF is generated in the BACKGROUND while the form is being filled in,
 * which is v1's shape and the right one — a large client takes a moment, and
 * making someone wait on a spinner before they can start typing is worse than
 * making them wait at the end. Send is blocked until it is ready.
 *
 * FIVE THINGS ABOUT THE CONTRACT CHANGED from v1, and four of them fail loudly
 * rather than quietly, which is the only reason they are survivable:
 *
 *   POST /api/ops?op=send-client-email  ->  POST /api/client-email
 *   x-session-token header              ->  the session cookie, via api()
 *   cc: "a@x, b@y"                      ->  cc: string[], max 5
 *   attachment.name / .contentBytes     ->  .fileName / .contentBase64
 *   clientName in the body              ->  clientId; the server resolves the name
 *
 * That last one is the quiet one. v1 sent the client's NAME as a string and it
 * went straight into the audit row, so the record of an outbound email was
 * labelled with whatever the browser said. Sending an id means the audit names
 * a client the server can verify.
 */

interface Attachment {
  fileName: string;
  contentBase64: string;
}

export function ClientEmailDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const session = useSession();

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  // Seeded by INITIALISER, not by an effect. The parent renders this dialog
  // conditionally, so it mounts fresh every time it opens and the initialiser
  // runs then — which is what "reset the form on open" actually means. Doing it
  // in an effect would setState synchronously in the effect body, cascading a
  // render, and React 19 lints it for exactly that reason.
  const [subject, setSubject] = useState(
    () => `Integration Status Report - ${client.name} - ${fmtDate(todayStr())}`,
  );
  const [body, setBody] = useState(
    () =>
      `Hi,\n\nPlease find attached the latest integration status report for ${client.name}.\n\n` +
      `Do let us know if you have any questions.\n\nBest regards,\n` +
      `${session?.name ?? session?.username ?? ""}\nKognoz Consulting`,
  );
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachmentFailed, setAttachmentFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  /**
   * Start generating the PDF as soon as the dialog is open.
   *
   * An effect because it is work triggered by becoming visible, and it must be
   * cancellable: a slow generation must not land in a dialog that has since
   * been dismissed. Nothing here sets state synchronously — every setState is
   * inside a promise callback, which is the part of the rule that matters.
   */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      try {
        const { exportIntegrationPdf } = await import("@/lib/export/integration-pdf");
        const result = await exportIntegrationPdf(client, { returnBlob: true });
        if (cancelled || !result) return;
        setAttachment({
          // The route returns file.name uncapped while the schema caps
          // fileName at 200. A long client name would upload and then fail
          // validation, so it is trimmed here where the name is built.
          fileName: result.filename.slice(0, 200),
          contentBase64: result.base64,
        });
      } catch {
        if (!cancelled) setAttachmentFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, client, session]);

  /** `a@x.com, b@y.com` or one per line -> the array the schema wants. */
  const ccList = cc
    .split(/[\n,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  function send() {
    const payload = {
      // The server resolves the client's NAME from this, so the audit row for
      // an outbound email names a client it can verify. v1 sent the name as a
      // string and trusted it.
      clientId: client.id,
      to: to.trim(),
      ...(ccList.length ? { cc: ccList } : {}),
      subject: subject.trim(),
      bodyText: body,
      ...(attachment ? { attachment } : {}),
    };

    const parsed = validate(clientEmailSend, payload);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    if (ccList.length > 5) {
      setErrors({ cc: "At most 5 cc recipients." });
      return;
    }

    setSending(true);
    api<{ sent: boolean; to: string; cc: number }>("/api/client-email", {
      method: "POST",
      body: parsed.data,
      screen: "integrations",
    })
      .then((r) => {
        toast.success(
          r.cc > 0 ? `Sent to ${r.to} and ${r.cc} cc.` : `Sent to ${r.to}.`,
        );
        onOpenChange(false);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 429) {
          // Rate limits are consumed BEFORE the send and never refunded, so a
          // 429 means nothing went out — worth being unambiguous about.
          toast.error(`${err.message} Nothing was sent.`);
          return;
        }
        toast.error(
          err instanceof ApiError ? err.message : "Could not send that email.",
        );
      })
      .finally(() => setSending(false));
  }

  const blocked = sending || (!attachment && !attachmentFailed);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Email report to client"
      description={client.name}
      wide
      busy={sending}
      footer={
        <>
          <button
            type="button"
            className="k-btn k-btn-outline k-btn-sm"
            disabled={sending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="k-btn k-btn-primary k-btn-sm"
            disabled={blocked}
            onClick={send}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="To" htmlFor="ce-to" error={errors.to} required>
            <input
              {...fieldProps("ce-to", errors.to)}
              type="email"
              className="k-input"
              value={to}
              autoFocus
              onChange={(e) => {
                setTo(e.target.value);
                setErrors((x) => ({ ...x, to: undefined }));
              }}
            />
          </Field>

          <Field
            label="Cc"
            htmlFor="ce-cc"
            error={errors.cc}
            hint={`Comma-separated. At most 5.${ccList.length ? ` ${ccList.length} entered.` : ""}`}
          >
            <input
              {...fieldProps("ce-cc", errors.cc)}
              className="k-input"
              value={cc}
              onChange={(e) => {
                setCc(e.target.value);
                setErrors((x) => ({ ...x, cc: undefined }));
              }}
            />
          </Field>
        </div>

        <Field label="Subject" htmlFor="ce-subject" error={errors.subject} required>
          <input
            {...fieldProps("ce-subject", errors.subject)}
            className="k-input"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              setErrors((x) => ({ ...x, subject: undefined }));
            }}
          />
        </Field>

        <Field label="Message" htmlFor="ce-body" error={errors.bodyText} required>
          <textarea
            {...fieldProps("ce-body", errors.bodyText)}
            className="k-textarea"
            rows={8}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setErrors((x) => ({ ...x, bodyText: undefined }));
            }}
          />
        </Field>

        {/* Attachment state, spelled out. The send button is disabled until
            this resolves either way — sending a "please find attached" with
            nothing attached is the failure people actually notice. */}
        <div
          className="flex items-center gap-2 rounded-k border border-k-line-2 bg-k-surface px-3 py-2.5 text-[12px]"
          aria-live="polite"
        >
          {attachment ? (
            <>
              <Paperclip size={13} strokeWidth={1.5} aria-hidden className="text-k-primary" />
              <span className="k-mono truncate text-k-ink">{attachment.fileName}</span>
              <span className="ml-auto flex-none text-k-mute-2">
                {Math.round((attachment.contentBase64.length * 3) / 4 / 1024)} KB
              </span>
            </>
          ) : attachmentFailed ? (
            <span className="text-k-text-red">
              The report could not be generated. You can still send this without
              it.
            </span>
          ) : (
            <>
              <Loader2 size={13} strokeWidth={1.5} aria-hidden className="animate-spin text-k-mute" />
              <span className="text-k-mute">Generating the PDF attachment…</span>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
