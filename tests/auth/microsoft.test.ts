import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import { users } from "@/lib/db/schema";
import { createVerifier, challengeFor, newNonce, nonceMatches } from "@/lib/auth/microsoft/pkce";
import { signState, verifyState, safeNext, SSO_STATE_TTL_MS } from "@/lib/auth/microsoft/state";
import { resolveSsoUser, domainAllowed, allowedDomains } from "@/lib/auth/microsoft/gate";
import { exchangeCode, fetchGraphMe, SSO_SCOPE } from "@/lib/auth/microsoft/exchange";
import { signToken, buildPayload } from "@/lib/auth/token";
import { ssoErrorMessage, SSO_ERRORS } from "@/lib/auth/messages";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Microsoft SSO.
 *
 * The hardening over v1 is what most of this covers: PKCE, a state bound to
 * the browser that started the flow, and a gate that refuses rather than
 * guesses when two accounts share an email.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const readSql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
const SECRET = "test-signing-secret";

let pg: PGlite;
let db: AnyDb;

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;
  await pg.exec(`do $$ begin
    if not exists (select from pg_roles where rolname='service_role') then
      create role service_role;
    end if; end $$;`);
  for (const f of [
    "0001_baseline_v1_schema.sql", "0002_v2_schema.sql",
    "0003_domain_membership.sql", "0005_backend_indexes.sql",
    // Production has this trigger; a test schema without it silently makes
    // updated_at (and therefore every OCC token) hold still.
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(readSql(f));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec("truncate table users restart identity cascade");
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await pg?.close();
});

/* ==================================================================== PKCE */

describe("PKCE", () => {
  it("matches the RFC 7636 S256 test vector", () => {
    // Appendix B. If this drifts, Entra rejects every exchange with a code
    // challenge mismatch and the message gives no hint why.
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("produces verifiers in the length range the RFC allows", () => {
    for (let i = 0; i < 20; i++) {
      const v = createVerifier();
      expect(v.length).toBeGreaterThanOrEqual(43);
      expect(v.length).toBeLessThanOrEqual(128);
      expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
    }
  });

  it("does not repeat a verifier or a nonce", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(createVerifier());
      seen.add(newNonce());
    }
    expect(seen.size).toBe(100);
  });

  it("compares nonces without crashing on a length mismatch", () => {
    // The returned nonce is attacker-controlled, so its length is too, and a
    // raw timingSafeEqual would throw RangeError.
    const nonce = newNonce();
    expect(nonceMatches(nonce, nonce)).toBe(true);
    for (const bad of ["", "x", nonce + "x", "y".repeat(9999)]) {
      expect(nonceMatches(bad, nonce)).toBe(false);
    }
  });
});

/* =================================================================== state */

describe("SSO state", () => {
  const validState = (over: Record<string, unknown> = {}) => ({
    purpose: "msftAuthState" as const,
    nonce: "n", verifier: "v",
    iat: 1000, exp: 1000 + SSO_STATE_TTL_MS,
    ...over,
  });

  it("round-trips a state it signed", () => {
    const token = signState(validState(), SECRET);
    expect(verifyState(token, SECRET, 2000)?.nonce).toBe("n");
  });

  it("rejects a state signed with a different secret", () => {
    const token = signState(validState(), "other-secret");
    expect(verifyState(token, SECRET, 2000)).toBeNull();
  });

  it("rejects an expired state", () => {
    const token = signState(validState(), SECRET);
    expect(verifyState(token, SECRET, 1000 + SSO_STATE_TTL_MS + 1)).toBeNull();
  });

  it("REFUSES A REAL SESSION TOKEN presented as state", () => {
    // Both are signed with INTEGTRACK_SECRET, so a signature check alone
    // passes. The `purpose` discriminator is the only thing separating them,
    // and the old app carried the same check for the same reason.
    const session = signToken(
      buildPayload({ id: "u1", username: "meera", role: "admin" }), SECRET,
    );
    expect(verifyState(session, SECRET, Date.now())).toBeNull();
  });

  it("rejects a correctly-shaped payload with the wrong purpose", () => {
    // The session-token case above is also caught by the nonce/verifier shape
    // checks, so it does not isolate the discriminator. This one carries every
    // field a state needs and differs only in `purpose` — which is what the
    // check exists for: the next signed payload someone adds with similar
    // field names must not be accepted here.
    const impostor = signState(
      validState({ purpose: "ssoTicket" }) as never, SECRET,
    );
    expect(verifyState(impostor, SECRET, 2000)).toBeNull();
  });

  it("rejects a state missing its verifier", () => {
    const token = signState(
      validState({ verifier: undefined }) as never, SECRET,
    );
    expect(verifyState(token, SECRET, 2000)).toBeNull();
  });

  it("accepts only same-site destinations", () => {
    expect(safeNext("/dashboard")).toBe("/dashboard");
    expect(safeNext("/implementation/c1/m1/BPU")).toBe("/implementation/c1/m1/BPU");
    // Protocol-relative: browsers treat this as absolute, so a leading-slash
    // check alone is an open redirect.
    expect(safeNext("//evil.com")).toBeUndefined();
    expect(safeNext("https://evil.com")).toBeUndefined();
    expect(safeNext(null)).toBeUndefined();
  });
});

/* ==================================================================== gate */

describe("the never-provision gate", () => {
  const seed = (rows: Record<string, unknown>[]) =>
    db.insert(users).values(rows as never);

  it("signs in a user whose email matches", async () => {
    await seed([{ id: "u1", username: "meera", name: "Meera",
      email: "meera@kognoz.com", role: "admin", passwordHash: "$2b$12$x" }]);

    const res = await resolveSsoUser(db, "meera@kognoz.com");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.user.role).toBe("admin");
  });

  it("matches case- and whitespace-insensitively", async () => {
    await seed([{ id: "u1", username: "meera", name: "Meera",
      email: "Meera@Kognoz.com", role: "admin", passwordHash: "$2b$12$x" }]);

    for (const variant of ["meera@kognoz.com", "  MEERA@KOGNOZ.COM  "]) {
      expect((await resolveSsoUser(db, variant)).ok).toBe(true);
    }
  });

  it("refuses a valid Microsoft account with no Kora user", async () => {
    // The entire point of the feature: SSO signs people in, never creates them.
    const res = await resolveSsoUser(db, "stranger@kognoz.com");
    expect(res).toEqual({ ok: false, code: "not_authorized" });
  });

  it("REFUSES when two users share an email rather than picking one", async () => {
    // users.email has no unique constraint. The old query took limit=1 from an
    // unordered result, so SSO signed you into whichever row came back first —
    // possibly the more privileged one.
    await seed([
      { id: "u1", username: "meera", name: "Meera", email: "shared@kognoz.com",
        role: "viewer", passwordHash: "$2b$12$x" },
      { id: "u2", username: "meera2", name: "Meera B", email: "shared@kognoz.com",
        role: "admin", passwordHash: "$2b$12$x" },
    ]);

    expect(await resolveSsoUser(db, "shared@kognoz.com"))
      .toEqual({ ok: false, code: "sso_ambiguous" });
  });

  it("does not treat SQL wildcards in the address as wildcards", async () => {
    // The old query used PostgREST `ilike`, where `_` and `%` from a
    // Graph-supplied string are pattern metacharacters.
    await seed([{ id: "u1", username: "ab", name: "AB", email: "aXb@kognoz.com",
      role: "admin", passwordHash: "$2b$12$x" }]);

    expect((await resolveSsoUser(db, "a_b@kognoz.com")).ok).toBe(false);
    expect((await resolveSsoUser(db, "%@kognoz.com")).ok).toBe(false);
  });

  it("does not match a user whose email is blank", async () => {
    // The column defaults to ''. Without the guard, an empty Graph email would
    // match every user who never set one.
    await seed([{ id: "u1", username: "noemail", name: "No Email", email: "",
      role: "admin", passwordHash: "$2b$12$x" }]);

    expect((await resolveSsoUser(db, "")).ok).toBe(false);
    expect((await resolveSsoUser(db, "   ")).ok).toBe(false);
  });

  it("refuses an account outside the allowed domain", async () => {
    // Redundant with the user-table match on its own — but it is the guard
    // against the mistake one level up: an admin adding a contractor or a
    // client contact to `users`, who could then sign in with their own
    // Microsoft account.
    vi.stubEnv("AZURE_ALLOWED_DOMAIN", "kognozconsulting.com");
    await seed([{ id: "u1", username: "outsider", name: "Outsider",
      email: "someone@gmail.com", role: "admin", passwordHash: "$2b$12$x" }]);

    expect(await resolveSsoUser(db, "someone@gmail.com"))
      .toEqual({ ok: false, code: "domain_not_allowed" });
  });

  it("still admits an account inside the allowed domain", async () => {
    vi.stubEnv("AZURE_ALLOWED_DOMAIN", "kognozconsulting.com");
    await seed([{ id: "u1", username: "meera", name: "Meera",
      email: "meera@kognozconsulting.com", role: "admin", passwordHash: "$2b$12$x" }]);

    expect((await resolveSsoUser(db, "MEERA@KognozConsulting.com")).ok).toBe(true);
  });

  it("matches the domain exactly, never as a suffix", () => {
    // Suffix matching would admit `notkognozconsulting.com`, which is the
    // exact trick this exists to stop.
    vi.stubEnv("AZURE_ALLOWED_DOMAIN", "kognozconsulting.com");
    expect(domainAllowed("a@kognozconsulting.com")).toBe(true);
    expect(domainAllowed("a@notkognozconsulting.com")).toBe(false);
    expect(domainAllowed("a@kognozconsulting.com.evil.com")).toBe(false);
    expect(domainAllowed("a@sub.kognozconsulting.com")).toBe(false);
    expect(domainAllowed("no-at-sign")).toBe(false);
  });

  it("allows every domain when the variable is unset", () => {
    // The right default for anyone who has not thought about it — the
    // user-table gate is still doing the real work.
    vi.stubEnv("AZURE_ALLOWED_DOMAIN", "");
    expect(allowedDomains()).toEqual([]);
    expect(domainAllowed("anyone@anywhere.com")).toBe(true);
  });

  it("accepts a comma-separated list, with or without a leading @", () => {
    vi.stubEnv("AZURE_ALLOWED_DOMAIN", " kognozconsulting.com , @konverz.ai ");
    expect(allowedDomains()).toEqual(["kognozconsulting.com", "konverz.ai"]);
    expect(domainAllowed("a@konverz.ai")).toBe(true);
    expect(domainAllowed("a@elsewhere.com")).toBe(false);
  });

  it("fails closed when the lookup itself errors", async () => {
    const broken = {
      select: () => { throw new Error("connection lost"); },
    } as unknown as AnyDb;
    expect(await resolveSsoUser(broken, "a@b.com"))
      .toEqual({ ok: false, code: "lookup_failed" });
  });
});

/* ================================================================ exchange */

describe("token exchange and profile", () => {
  const creds = { clientId: "id", clientSecret: "secret", tenantId: "tenant" };

  it("sends PKCE and the client secret together", async () => {
    // Entra expects both from a Web-platform registration; PKCE is additive.
    let body: URLSearchParams | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = init.body as URLSearchParams;
      return new Response(JSON.stringify({ access_token: "tok" }), { status: 200 });
    }) as unknown as typeof fetch;

    await exchangeCode(creds, "the-code", "the-verifier", fetchImpl);

    expect(body?.get("code_verifier")).toBe("the-verifier");
    expect(body?.get("client_secret")).toBe("secret");
    expect(body?.get("grant_type")).toBe("authorization_code");
    expect(body?.get("scope")).toBe(SSO_SCOPE);
  });

  it("requests only user-consentable scopes", () => {
    // Anything beyond these would need an admin consent grant, turning a
    // self-service sign-in into a ticket.
    expect(SSO_SCOPE).toBe("openid profile email User.Read");
  });

  it("reports a failed exchange without leaking Entra's message", async () => {
    const fetchImpl = (async () =>
      new Response("AADSTS50011: redirect URI mismatch for tenant contoso", {
        status: 400,
      })) as unknown as typeof fetch;

    const res = await exchangeCode(creds, "c", "v", fetchImpl);
    expect(res).toEqual({ ok: false, code: "exchange_failed" });
  });

  it("survives the token endpoint being unreachable", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await exchangeCode(creds, "c", "v", fetchImpl))
      .toEqual({ ok: false, code: "exchange_failed" });
  });

  it("falls back to the UPN when the account has no mailbox", async () => {
    // `mail` is null for accounts without Exchange — common enough that this
    // is not an edge case.
    const fetchImpl = (async () =>
      new Response(JSON.stringify({
        mail: null, userPrincipalName: "meera@kognoz.com", displayName: "Meera",
      }), { status: 200 })) as unknown as typeof fetch;

    const res = await fetchGraphMe("tok", fetchImpl);
    expect(res).toMatchObject({ ok: true, email: "meera@kognoz.com" });
  });

  it("reports no_email when neither field is present", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ mail: null, userPrincipalName: null }), {
        status: 200,
      })) as unknown as typeof fetch;
    expect(await fetchGraphMe("tok", fetchImpl))
      .toEqual({ ok: false, code: "no_email" });
  });
});

/* ================================================================ messages */

describe("error messages", () => {
  it("has a message for every code the callback can emit", () => {
    for (const code of [
      "not_configured", "not_authorized", "state_invalid", "no_code",
      "exchange_failed", "graph_failed", "no_email", "sso_ambiguous",
      "lookup_failed", "unexpected_error",
    ]) {
      expect(SSO_ERRORS[code]).toBeTruthy();
    }
  });

  it("never leaves an unknown code showing a blank screen", () => {
    // The `msft_*` family is dynamic — whatever Entra put in ?error=.
    expect(ssoErrorMessage("msft_access_denied")).toBeTruthy();
    expect(ssoErrorMessage("something_new")).toBeTruthy();
    expect(ssoErrorMessage(null)).toBeNull();
  });
});

describe("SSO start refuses a host it cannot come back to", () => {
  /**
   * Both halves of this actually happened: a second local project owned :3000
   * so our dev server fell back to :3001, and the first Vercel deploy had no
   * KORA_APP_URL so the live app asked Microsoft to send codes to localhost.
   *
   * In both cases Microsoft authenticates the person successfully and then
   * delivers the code somewhere useless. The symptom is a 400 from an
   * unrelated app — which is exactly as confusing as it sounds.
   */
  const hostOf = (url: string) => new URL(url).host;

  it("treats a matching host as fine", () => {
    vi.stubEnv("KORA_APP_URL", "https://korav2.vercel.app");
    expect(hostOf("https://korav2.vercel.app")).toBe("korav2.vercel.app");
  });

  it("spots the port fallback that broke local sign-in", () => {
    vi.stubEnv("KORA_APP_URL", "http://localhost:3000");
    // Next fell back to 3001 because another project held 3000.
    expect(hostOf("http://localhost:3000")).not.toBe("localhost:3001");
  });

  it("spots the unset KORA_APP_URL that broke the deploy", async () => {
    // Unset, appUrl() falls back to localhost — so a deployed app would ask
    // Microsoft to redirect to the developer's laptop.
    vi.stubEnv("KORA_APP_URL", "");
    const { appUrl } = await import("@/lib/azure/config");
    expect(hostOf(appUrl())).toBe("localhost:3000");
    expect(hostOf(appUrl())).not.toBe("korav2-virid.vercel.app");
  });
});
