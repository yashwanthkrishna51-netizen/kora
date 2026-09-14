/**
 * One place that knows the Azure endpoints and the app's own URL.
 *
 * SSO and mail share a single app registration, so they must share the
 * construction of these URLs or they will eventually disagree about which
 * tenant they are talking to.
 */

export function azureApp() {
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const tenantId = process.env.AZURE_TENANT_ID;
  // Null rather than throwing: a missing registration must produce a
  // "not configured" message on the login screen, not a 500.
  if (!clientId || !clientSecret || !tenantId) return null;
  return { clientId, clientSecret, tenantId };
}

const base = (tenantId: string) =>
  `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;

export const authorizeUrl = (tenantId: string) => `${base(tenantId)}/authorize`;
export const tokenUrl = (tenantId: string) => `${base(tenantId)}/token`;

export const GRAPH_ME_URL =
  "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id";

/**
 * The app's own absolute URL.
 *
 * TRAILING SLASHES ARE STRIPPED, and that matters more than it looks: the SSO
 * redirect URI is derived from this and Entra matches redirect URIs as exact
 * strings. A trailing slash in the environment variable yields AADSTS50011 and
 * sends you hunting for a credentials problem that does not exist.
 */
export function appUrl(): string {
  // `||`, not `??`. An env var set to the empty string is functionally unset,
  // and it is easy to create one that way in a hosting dashboard — but `??`
  // only catches null and undefined, so an empty value would sail through and
  // produce a redirect_uri of "/api/auth/microsoft/callback" with no origin.
  // Entra rejects that, and the error names none of this.
  // Trim BEFORE the fallback: "  " is truthy, so trimming afterwards would
  // let a whitespace-only value through and yield an origin-less redirect_uri.
  const raw = (process.env.KORA_APP_URL ?? "").trim();
  return (raw || "http://localhost:3000").replace(/\/+$/, "");
}

/** Must match, character for character, what is registered in Entra. */
export function ssoRedirectUri(): string {
  return `${appUrl()}/api/auth/microsoft/callback`;
}
