/**
 * Microsoft Graph — sending mail.
 *
 * This is the CLIENT-CREDENTIALS flow: the app authenticates as itself, with no
 * user present, using the application permission `Mail.Send`. That has two
 * consequences worth stating plainly, because neither is obvious from the code:
 *
 *   Mail always comes from ONE fixed mailbox (`AZURE_DEFAULT_MAIL_SENDER`), never from
 *   the person who clicked the button. A client email sent by an editor arrives
 *   from that mailbox with that mailbox's reply-to.
 *
 *   An unscoped app-only `Mail.Send` grant lets this registration send as ANY
 *   mailbox in the tenant. Scoping it to the one mailbox — an Exchange
 *   Application Access Policy, or Exchange RBAC for Applications — is a
 *   tenant-side task that this code cannot do for itself. The old app's source
 *   recommended it and it was never applied.
 *
 * The SSO flow in lib/auth/microsoft/ uses the SAME app registration through a
 * DIFFERENT flow (delegated authorization-code). One registration, two flows.
 */

const TOKEN_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_SEND = (sender: string) =>
  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`;

export interface MailAttachment {
  name: string;
  contentType: string;
  contentBytes: string;
}

export interface MailMessage {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  html: string;
  attachments?: MailAttachment[];
  /** Client-facing mail is worth keeping a copy of; the digest is not. */
  saveToSentItems?: boolean;
}

export interface GraphDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ token */

let cached: { token: string; expiresAt: number } | undefined;

/** Test seam — a module-scope cache would otherwise leak between cases. */
export function resetGraphTokenCache(): void {
  cached = undefined;
}

export function azureCredentials() {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

export function tokenUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

/**
 * An app-only access token, cached until shortly before it expires.
 *
 * The 60-second margin is not cosmetic: a token that expires between the check
 * and Graph receiving it produces a 401 that looks like a credentials problem,
 * which is a bad thing to debug at 3am when the digest did not go out.
 */
export async function getGraphToken(deps: GraphDeps = {}): Promise<string> {
  const doFetch = deps.fetchImpl ?? fetch;
  const now = deps.now?.() ?? Date.now();

  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const creds = azureCredentials();
  if (!creds) {
    throw new Error(
      "AZURE_CLIENT_ID, AZURE_CLIENT_SECRET and AZURE_TENANT_ID are required to send mail",
    );
  }

  const res = await doFetch(tokenUrl(creds.tenantId), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      // Fixed for app-only: the actual permissions come from what was granted
      // and consented in the portal, not from anything requested here.
      scope: TOKEN_SCOPE,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) {
    // Entra's body names the tenant and the failing credential; it is useful
    // in a server log and wrong in a response.
    const detail = await res.text().catch(() => "");
    console.error(`Graph token request failed (${res.status}):`, detail.slice(0, 500));
    throw new Error("Could not authenticate with Microsoft Graph");
  }

  const data = (await res.json()) as { access_token: string; expires_in?: number };
  cached = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return cached.token;
}

/* ------------------------------------------------------------------- send */

const asList = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : v ? [v] : []).map((address) => ({
    emailAddress: { address },
  }));

export function isMailConfigured(): boolean {
  return (
    transportMode() === "console" ||
    (azureCredentials() !== null && !!process.env.AZURE_DEFAULT_MAIL_SENDER)
  );
}

/**
 * `KORA_MAIL_TRANSPORT=console` renders and logs instead of sending.
 *
 * This exists so the digest, the client-email route and the rate limiter can
 * all be exercised end to end against the real database while the Azure app
 * registration is still being approved — which involves an admin consent step
 * that can take days. Flipping one variable is the only change when the
 * credentials land.
 */
function transportMode(): "console" | "graph" {
  return process.env.KORA_MAIL_TRANSPORT === "console" ? "console" : "graph";
}

const MAX_ATTEMPTS = 3;

/**
 * Sends one message, retrying on throttling.
 *
 * Retries 429 AND 503. Graph throttles with both, and the old client only
 * handled 429 — so a throttled digest lost the rest of its recipients silently.
 * `retry-after` is honoured when present because guessing shorter than Graph
 * asked for is how a soft throttle becomes a hard block on the mailbox.
 *
 * A loop rather than recursion, so the attempt count is visible and cannot
 * accidentally become unbounded.
 */
export async function sendMail(
  message: MailMessage,
  deps: GraphDeps = {},
): Promise<void> {
  const sender = process.env.AZURE_DEFAULT_MAIL_SENDER;

  if (transportMode() === "console") {
    console.log(
      `[mail:console] to=${asList(message.to).map((r) => r.emailAddress.address).join(",")}` +
        ` subject=${JSON.stringify(message.subject)} bytes=${message.html.length}` +
        ` attachments=${message.attachments?.length ?? 0}`,
    );
    return;
  }

  if (!sender) throw new Error("AZURE_DEFAULT_MAIL_SENDER is required to send mail");

  const doFetch = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? wait;

  const body = JSON.stringify({
    message: {
      subject: message.subject,
      body: { contentType: "HTML", content: message.html },
      toRecipients: asList(message.to),
      ccRecipients: asList(message.cc),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.contentBytes,
            })),
          }
        : {}),
    },
    saveToSentItems: message.saveToSentItems ?? false,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const token = await getGraphToken(deps);
    const res = await doFetch(GRAPH_SEND(sender), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
    });

    if (res.ok) return;

    if ((res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS) {
      const header = Number(res.headers.get("retry-after"));
      const delay = Number.isFinite(header) && header > 0
        ? header * 1000
        : attempt * 2000;
      await sleep(delay);
      continue;
    }

    const detail = await res.text().catch(() => "");
    console.error(`Graph sendMail failed (${res.status}):`, detail.slice(0, 500));
    // A 403 here almost always means Mail.Send was never admin-consented.
    throw new Error(`Email failed to send (${res.status})`);
  }
}
