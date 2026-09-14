import { tokenUrl, GRAPH_ME_URL, ssoRedirectUri } from "@/lib/azure/config";

/**
 * The two outbound calls of the callback: code -> token, token -> identity.
 *
 * Both return a tagged result rather than throwing, so the callback's error
 * mapping is exhaustive and typed — every failure has to be turned into one of
 * the `?ssoError=` codes the login page knows how to phrase.
 *
 * Identity comes from a server-to-server Graph call rather than from parsing
 * the id_token. That is deliberate and should stay: Microsoft vouches for the
 * identity directly, so there is no JWKS fetch, no signature verification and
 * no JWT library — none of which is in package.json, and each of which is a
 * way to get subtly wrong what is currently just a fetch.
 */

export interface Credentials {
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

export type ExchangeResult =
  | { ok: true; accessToken: string }
  | { ok: false; code: "exchange_failed" };

export async function exchangeCode(
  creds: Credentials,
  code: string,
  verifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ExchangeResult> {
  try {
    const res = await fetchImpl(tokenUrl(creds.tenantId), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        // Must match the authorize request AND the Entra registration exactly.
        redirect_uri: ssoRedirectUri(),
        grant_type: "authorization_code",
        scope: SSO_SCOPE,
        // PKCE. Sent alongside the secret, not instead of it.
        code_verifier: verifier,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // AADSTS codes name the tenant and the app; useful in a log, wrong in a
      // redirect. AADSTS50011 in particular means the redirect URI does not
      // match what is registered — worth recognising quickly.
      console.error(`SSO token exchange failed (${res.status}):`, detail.slice(0, 500));
      return { ok: false, code: "exchange_failed" };
    }

    const data = (await res.json()) as { access_token?: string };
    if (!data.access_token) return { ok: false, code: "exchange_failed" };
    return { ok: true, accessToken: data.access_token };
  } catch (err) {
    console.error("SSO token exchange threw:", err);
    return { ok: false, code: "exchange_failed" };
  }
}

/** The delegated scopes. All user-consentable — no admin consent needed. */
export const SSO_SCOPE = "openid profile email User.Read";

export type ProfileResult =
  | { ok: true; email: string; displayName: string }
  | { ok: false; code: "graph_failed" | "no_email" };

export async function fetchGraphMe(
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProfileResult> {
  try {
    const res = await fetchImpl(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      console.error(`SSO profile lookup failed (${res.status})`);
      return { ok: false, code: "graph_failed" };
    }

    const me = (await res.json()) as {
      mail?: string | null;
      userPrincipalName?: string | null;
      displayName?: string | null;
    };

    // `mail` is null for accounts without an Exchange mailbox, which is common
    // enough that falling back to the UPN is not an edge case.
    const email = (me.mail || me.userPrincipalName || "").trim();
    if (!email) return { ok: false, code: "no_email" };

    return { ok: true, email, displayName: (me.displayName ?? "").trim() };
  } catch (err) {
    console.error("SSO profile lookup threw:", err);
    return { ok: false, code: "graph_failed" };
  }
}
