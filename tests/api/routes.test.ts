import {
  describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * ROUTE-LEVEL tests — the layer nothing else touches.
 *
 * Every other suite tests one layer below the HTTP boundary: it calls
 * `listSnapshots(db, { isAdmin: false })` directly, or `requireIfMatch(req)` in
 * isolation. Those prove the pieces work. They cannot prove the ROUTES wire
 * them up, and two of this project's properties live only at that layer:
 *
 *   "digest-recipients is admin-only"
 *   "every PATCH and DELETE requires If-Match"
 *
 * Both were true by reading and untested — and an audit found four PATCH and
 * DELETE handlers that had no If-Match at all, precisely because nothing here
 * existed to catch it. A test that would have failed is worth more than a
 * comment that was accurate.
 *
 * These import the real `route.ts` files and invoke the exported handlers, so
 * a route that drops its role gate, forgets its precondition, or calls the
 * wrong mutation fails here.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const readSql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

let pg: PGlite;
let db: AnyDb;

/** Swapped per test to impersonate a role. */
let sessionToken: string | null = null;

// The route handlers reach for the app's singleton and for request-scoped
// cookies; neither exists in a test process, so both are replaced. Everything
// else — withAuth, the role ranking, requireIfMatch, the mutations — is real.
// vi.fn rather than a plain arrow, so a test can make the handle throw and
// assert that routes which never query still work.
vi.mock("@/lib/db/client", () => ({
  getDb: vi.fn(() => db),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name.includes("kora_session") && sessionToken
        ? { name, value: sessionToken }
        : undefined,
    set: () => {},
  }),
}));

const { GET: getDigestRecipients, PUT: putDigestRecipients } = await import(
  "@/app/api/settings/digest-recipients/route"
);
const { GET: getAudit } = await import("@/app/api/audit/route");
const { GET: getSnapshots, POST: postSnapshot } = await import(
  "@/app/api/snapshots/route"
);
const { POST: runDigestCron } = await import("@/app/api/cron/daily-digest/route");
const { GET: getClients, POST: postClient } = await import("@/app/api/clients/route");
const { GET: getBackups } = await import("@/app/api/backups/route");
const { isReadOnly } = await import("@/lib/api/handler");
const { POST: login } = await import("@/app/api/auth/login/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { PATCH: patchClient, DELETE: deleteClient } = await import(
  "@/app/api/clients/[clientId]/route"
);
const { PATCH: patchIntegration } = await import(
  "@/app/api/integrations/[integrationId]/route"
);

const { signToken, buildPayload } = await import("@/lib/auth/token");
const { clients, users, portfolioSnapshots } = await import("@/lib/db/schema");

const SECRET = "route-test-secret";

beforeAll(async () => {
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;
  await pg.exec(`do $$ begin
    if not exists (select from pg_roles where rolname='service_role') then
      create role service_role;
    end if; end $$;`);
  for (const f of [
    "0001_baseline_v1_schema.sql", "0002_v2_schema.sql",
    "0003_domain_membership.sql", "0004_client_name_ci_unique.sql",
    "0005_backend_indexes.sql", "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(readSql(f));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec(
    `truncate table phases_v2, modules_v2, milestones_v2, integrations_v2,
     ams_work_log_v2, clients_v2, users, app_settings, audit_log,
     portfolio_snapshots restart identity cascade`,
  );
  vi.stubEnv("INTEGTRACK_SECRET", SECRET);

  // Undo any mockImplementationOnce a previous test installed.
  // Cast at the seam: the tests run PGlite, getDb is typed for postgres-js.
  // Same substitution the whole suite already relies on, now made explicit
  // because vi.mocked gives the factory a real type.
  const { getDb } = await import("@/lib/db/client");
  vi.mocked(getDb).mockImplementation(() => db as unknown as ReturnType<typeof getDb>);

  await db.insert(users).values([
    { id: "u_admin", username: "meera", name: "Meera", email: "m@x.com",
      role: "admin", passwordHash: "$2b$12$x", tokenVersion: 0 },
    { id: "u_editor", username: "arjun", name: "Arjun", email: "a@x.com",
      role: "editor", passwordHash: "$2b$12$x", tokenVersion: 0 },
    { id: "u_viewer", username: "vikram", name: "Vikram", email: "v@x.com",
      role: "viewer", passwordHash: "$2b$12$x", tokenVersion: 0 },
  ]);
  signInAs("admin");
});

afterAll(async () => {
  await pg?.close();
});

function signInAs(role: "admin" | "editor" | "viewer" | null) {
  if (!role) {
    sessionToken = null;
    return;
  }
  const id = `u_${role}`;
  const username = { admin: "meera", editor: "arjun", viewer: "vikram" }[role];
  sessionToken = signToken(buildPayload({ id, username, role }), SECRET);
}

/** A request that looks like it came from our own page. */
function req(
  url: string,
  init: { method?: string; body?: unknown; ifMatch?: string } = {},
) {
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (init.ifMatch) headers["if-match"] = init.ifMatch;

  return new NextRequest(`https://kora.test${url}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const ctx = <T extends Record<string, string>>(params: T) => ({
  params: Promise.resolve(params),
});

/* ============================================================ role gates */

describe("the digest cron captures the daily snapshot", () => {
  // NOTHING captured snapshots. The read hook existed, the POST route existed,
  // and no caller did — so at cutover the dashboard's trend arrows would have
  // gone stale and then empty, with nothing to connect it to the switchover.
  // v1 captured one on every dashboard load; this rides on the digest because
  // the Hobby plan allows two crons and both are already spoken for.
  const CRON = "cron-test-secret";
  const cronReq = (path: string) =>
    new NextRequest(`http://localhost${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${CRON}` },
    });

  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", CRON);
    // No mail credentials in the test process, so the digest plans and reports
    // rather than sending. The snapshot must still be captured.
    vi.stubEnv("KORA_MAIL_TRANSPORT", "console");
  });

  it("writes a snapshot row, even on a DRY RUN", async () => {
    // A dry run withholds EMAIL. Skipping the capture too would make "check the
    // routing safely" silently cost a day of trend data.
    await db.insert(clients).values({ id: "c_snap", name: "Snapshot Co" });

    const res = await runDigestCron(cronReq("/api/cron/daily-digest?dryRun=1"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { snapshot: { clients: number } | null };
    expect(body.snapshot).not.toBeNull();
    expect(body.snapshot!.clients).toBeGreaterThan(0);
    expect((await db.select().from(portfolioSnapshots)).length).toBeGreaterThan(0);
  });

  it("is idempotent — a second run the same day does not duplicate", async () => {
    await db.insert(clients).values({ id: "c_snap", name: "Snapshot Co" });
    await runDigestCron(cronReq("/api/cron/daily-digest?dryRun=1"));
    const first = (await db.select().from(portfolioSnapshots)).length;
    await runDigestCron(cronReq("/api/cron/daily-digest?dryRun=1"));
    expect((await db.select().from(portfolioSnapshots)).length).toBe(first);
  });
});

describe("role gates, at the route", () => {
  it("refuses a viewer the digest recipient list", async () => {
    // The real leak in the old app: `ops?op=settings` had no role check and
    // handed any viewer the internal distribution list. Asserted here at the
    // route, not by calling the query function with isAdmin: false.
    signInAs("viewer");
    expect((await getDigestRecipients(req("/api/settings/digest-recipients"))).status)
      .toBe(403);

    signInAs("editor");
    expect((await getDigestRecipients(req("/api/settings/digest-recipients"))).status)
      .toBe(403);

    signInAs("admin");
    expect((await getDigestRecipients(req("/api/settings/digest-recipients"))).status)
      .toBe(200);
  });

  it("refuses a non-admin the audit log", async () => {
    signInAs("viewer");
    expect((await getAudit(req("/api/audit"))).status).toBe(403);
    signInAs("admin");
    expect((await getAudit(req("/api/audit"))).status).toBe(200);
  });

  it("refuses a viewer any write", async () => {
    signInAs("viewer");
    const res = await postClient(req("/api/clients", { method: "POST", body: { name: "X" } }));
    expect(res.status).toBe(403);
  });

  it("refuses everyone when there is no session at all", async () => {
    signInAs(null);
    expect((await getClients(req("/api/clients"))).status).toBe(401);
  });

  it("takes the role from the DATABASE, not the token", async () => {
    // A token minted while someone was an admin must stop working the moment
    // the row says otherwise — that is the whole point of re-reading it.
    sessionToken = signToken(
      buildPayload({ id: "u_viewer", username: "vikram", role: "admin" }),
      SECRET,
    );
    expect((await getAudit(req("/api/audit"))).status).toBe(403);
  });

  it("strips ams_hours_month from a snapshot read for a non-admin", async () => {
    await db.insert(clients).values({ id: "c1", name: "Aster", hasAms: true });
    signInAs("admin");
    await postSnapshot(req("/api/snapshots", { method: "POST" }));

    signInAs("viewer");
    const body = await (await getSnapshots(req("/api/snapshots"))).json();
    expect(body.snapshots ?? body).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("amsHoursMonth");

    signInAs("admin");
    const asAdmin = await (await getSnapshots(req("/api/snapshots"))).json();
    expect(JSON.stringify(asAdmin)).toContain("amsHoursMonth");
  });
});

/* ====================================================== the If-Match rule */

describe("If-Match, at the route", () => {
  async function makeClient(): Promise<{ id: string; v: string }> {
    signInAs("editor");
    const res = await postClient(
      req("/api/clients", { method: "POST", body: { name: "Aster Retail" } }),
    );
    const body = await res.json();
    return { id: body.id, v: body._v };
  }

  it("rejects a PATCH with no If-Match as 428, not 200", async () => {
    // A write that forgot its precondition is a bug. Letting it through
    // silently defeats the entire concurrency mechanism.
    const c = await makeClient();
    const res = await patchClient(
      req(`/api/clients/${c.id}`, { method: "PATCH", body: { description: "x" } }),
      ctx({ clientId: c.id }),
    );
    expect(res.status).toBe(428);
  });

  it("rejects a DELETE with no If-Match as 428", async () => {
    const c = await makeClient();
    signInAs("admin");
    const res = await deleteClient(
      req(`/api/clients/${c.id}`, { method: "DELETE" }),
      ctx({ clientId: c.id }),
    );
    expect(res.status).toBe(428);
  });

  it("accepts a PATCH carrying the current token", async () => {
    const c = await makeClient();
    const res = await patchClient(
      req(`/api/clients/${c.id}`, {
        method: "PATCH", body: { description: "SAP" }, ifMatch: c.v,
      }),
      ctx({ clientId: c.id }),
    );
    expect(res.status).toBe(200);
  });

  it("returns 409 with the current row for a stale token", async () => {
    const c = await makeClient();
    await patchClient(
      req(`/api/clients/${c.id}`, {
        method: "PATCH", body: { description: "theirs" }, ifMatch: c.v,
      }),
      ctx({ clientId: c.id }),
    );

    const res = await patchClient(
      req(`/api/clients/${c.id}`, {
        method: "PATCH", body: { description: "mine" }, ifMatch: c.v,
      }),
      ctx({ clientId: c.id }),
    );
    expect(res.status).toBe(409);

    const body = await res.json();
    expect(body.code).toBe("conflict");
    expect(body.current.description).toBe("theirs");
  });

  it("rejects a malformed token as 400, not 500", async () => {
    const c = await makeClient();
    const res = await patchClient(
      req(`/api/clients/${c.id}`, {
        method: "PATCH", body: { description: "x" }, ifMatch: "not-a-date",
      }),
      ctx({ clientId: c.id }),
    );
    expect(res.status).toBe(400);
  });

  it("applies the same rule to a nested resource", async () => {
    // Spot-check that the rule is not just on /api/clients.
    const res = await patchIntegration(
      req("/api/integrations/nope", { method: "PATCH", body: { name: "x" } }),
      ctx({ integrationId: "nope" }),
    );
    expect(res.status).toBe(428);
  });
});

/* ================================================== request-shape errors */

describe("request handling", () => {
  it("rejects an unknown field rather than dropping it", async () => {
    signInAs("editor");
    const res = await postClient(
      req("/api/clients", { method: "POST", body: { name: "X", nonsense: 1 } }),
    );
    expect(res.status).toBe(400);
  });

  it("turns a duplicate name into a usable 409, not a 500", async () => {
    signInAs("editor");
    await postClient(req("/api/clients", { method: "POST", body: { name: "Aster" } }));
    const res = await postClient(
      req("/api/clients", { method: "POST", body: { name: "  aster  " } }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("already exists");
  });

  it("blocks a cross-site write even with a valid session", async () => {
    signInAs("admin");
    const r = new NextRequest("https://kora.test/api/clients", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ name: "X" }),
    });
    expect((await postClient(r)).status).toBe(403);
  });

  it("writes an audit row for a write, naming the actor", async () => {
    signInAs("editor");
    await postClient(req("/api/clients", { method: "POST", body: { name: "Audited" } }));

    const rows = await db.select().from(schema.auditLog);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.username === "arjun")).toBe(true);
  });

  it("PUT on settings is admin-only", async () => {
    signInAs("editor");
    const res = await putDigestRecipients(
      req("/api/settings/digest-recipients", {
        method: "PUT", body: { emails: ["a@b.com"] },
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("deployment misconfiguration is caught, not hidden", () => {
  /**
   * The mistake this exists for, which took two rounds to diagnose:
   * `.env.local` deliberately points DATABASE_URL at a local Postgres so that
   * building screens never touches live client data. Copying that file
   * verbatim into Vercel is the obvious next step and the wrong one — and the
   * symptom is every route returning a generic 500 while the SSO callback
   * bounces to "sign-in is temporarily unavailable". Neither mentions the
   * database, or the URL, or the environment.
   */
  const LOCALHOST_URLS = [
    "postgresql://mayank@localhost:5432/kora_dev",
    "postgresql://u:p@127.0.0.1:5432/db",
    "postgresql://u:p@[::1]:5432/db",
  ];

  const looksLocal = (url: string) =>
    /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

  it("recognises every spelling of a local database", () => {
    for (const url of LOCALHOST_URLS) {
      expect(looksLocal(url)).toBe(true);
    }
  });

  it("does not mistake a real host for a local one", () => {
    // The pooler hostname must never trip this, or production refuses to boot.
    for (const url of [
      "postgresql://postgres.ref:pw@aws-1-ap-south-1.pooler.supabase.com:6543/postgres",
      "postgresql://u:p@db.example.com:5432/x",
      // Contains the word but is not the host.
      "postgresql://u:p@localhost.example.com:5432/x",
    ]) {
      expect(looksLocal(url)).toBe(false);
    }
  });

  it("health reports the localhost database rather than just failing", async () => {
    // Production only: locally a localhost database is the correct answer.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://mayank@localhost:5432/kora_dev");
    vi.stubEnv("KORA_APP_URL", "http://localhost:3000");

    const { GET: health } = await import("@/app/api/health/route");
    const body = await (await health(
      new NextRequest("https://kora.test/api/health"),
    )).json();

    expect(body.checks.database).toContain("LOCALHOST");
    expect(body.checks.appUrl).toContain("LOCALHOST");
    expect(body.ok).toBe(false);
  });

  it("does NOT flag localhost in development, where it is correct", async () => {
    // An endpoint that permanently reports ok:false during local development
    // teaches everyone to ignore it.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://mayank@localhost:5432/kora_dev");
    vi.stubEnv("KORA_APP_URL", "http://localhost:3000");

    const { GET: health } = await import("@/app/api/health/route");
    const body = await (await health(
      new NextRequest("https://kora.test/api/health"),
    )).json();

    expect(body.checks.database).not.toContain("LOCALHOST");
    expect(body.checks.appUrl).not.toContain("LOCALHOST");
  });

  it("health does not call out to anything unless asked", async () => {
    // The default must stay a cheap local check — otherwise a public endpoint
    // becomes a way to make the server hammer Graph and Supabase.
    vi.stubEnv("SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "key");
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubGlobal("fetch", () => {
      throw new Error("health made an outbound call without ?deep=1");
    });

    const { GET: health } = await import("@/app/api/health/route");
    const body = await (await health(
      new NextRequest("https://kora.test/api/health"),
    )).json();

    expect(body.checks.storage).toContain("configured");
    expect(body.checks.sso).toContain("configured");
  });

  it("health says REJECTED, not configured, for a credential that is refused", async () => {
    // "configured" only ever meant "non-empty" — a much weaker claim than it
    // reads as. Pasting a whole .env file into a dashboard can append a
    // trailing comment to a value, giving a credential that is present, wrong,
    // and reported as fine.
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "wrong-secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubGlobal("fetch", async () => new Response("bad", { status: 401 }));

    const { resetGraphTokenCache } = await import("@/lib/mail/graph");
    resetGraphTokenCache();

    const { GET: health } = await import("@/app/api/health/route");
    const body = await (await health(
      new NextRequest("https://kora.test/api/health?deep=1"),
    )).json();

    expect(body.checks.sso).toContain("REJECTED");
    expect(body.ok).toBe(false);
  });
});

describe("authenticated pages are never prerendered", () => {
  /**
   * `/ams` was statically prerendered, which ran the (app) layout during
   * `next build` and hit the database from a build machine. It only surfaced
   * because a guard happened to throw there; without it the build would have
   * quietly produced an HTML snapshot of a signed-out shell and served it to
   * everyone.
   *
   * `cookies()` marks a route dynamic, but only once CALLED — and argument
   * evaluation is left to right, so `validateSession(getDb(), await
   * readSessionCookie())` reached the database first. Two defences now: the
   * cookie is read before the handle is asked for, and the layout says so
   * explicitly. This asserts the explicit one, because the ordering is the
   * kind of thing a refactor undoes without noticing.
   */
  it("the (app) layout opts out of static rendering", async () => {
    const layout = await import("@/app/(app)/layout");
    expect(layout.dynamic).toBe("force-dynamic");
  });

  it("reads the session cookie before asking for a database handle", () => {
    // Belt and braces on the ordering that caused it. Scoped to the FUNCTION
    // BODY — a first version searched the whole file and matched the import on
    // line 2 and the explanatory comment on line 29, so it failed while the
    // code was correct.
    //
    // It now points at lib/auth/current-session.ts rather than the layout: the
    // layout, the dashboard and the admin page all used to repeat this pair,
    // and the session lookup was consolidated there so one request makes one
    // query. The invariant did not go away, it moved — and it is now asserted
    // in the single place it can be got wrong.
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "lib/auth/current-session.ts"),
      "utf8",
    );
    const body = src.slice(src.indexOf("export const getCurrentSession"));

    const cookieAt = body.indexOf("readSessionCookie()");
    const dbAt = body.indexOf("getDb()");
    expect(cookieAt).toBeGreaterThan(-1);
    expect(dbAt).toBeGreaterThan(-1);
    expect(cookieAt).toBeLessThan(dbAt);
  });
});

describe("a route fails on the dependencies it actually uses", () => {
  /**
   * `withPublic` built a database handle for every route eagerly. With a
   * misconfigured DATABASE_URL that made `/api/auth/microsoft/start` — a pure
   * redirect that issues no query — return an opaque 500 alongside everything
   * else, which is a confusing signal when you are trying to work out what is
   * actually broken.
   */
  it("SSO start works even when the database is unreachable", async () => {
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("KORA_APP_URL", "https://kora.test");

    // Any access to the handle throws, standing in for an unreachable server.
    const { getDb } = await import("@/lib/db/client");
    vi.mocked(getDb).mockImplementationOnce(() => {
      throw new Error("database unreachable");
    });

    const { GET: ssoStart } = await import("@/app/api/auth/microsoft/start/route");
    const res = await ssoStart(
      new NextRequest("https://kora.test/api/auth/microsoft/start", {
        headers: { host: "kora.test" },
      }),
    );

    // A redirect to Microsoft, not a 500.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("login.microsoftonline.com");
  });
});

describe("the SSO callback never returns a raw 500", () => {
  /**
   * This actually happened on the deployment: Microsoft authenticated the
   * person, redirected back with a code, and the callback answered
   * `{"error":"Something went wrong","ref":"4tjqkj"}`. That is the worst
   * outcome of an OAuth round trip — authenticated, then stranded on a JSON
   * error page with no message and no way back.
   *
   * The cause was subtle. `ctx.db` is a lazy getter, so
   * `resolveSsoUser(db, …)` evaluates it as an ARGUMENT: `getDb()` threw
   * before the function was entered, and the gate's own `lookup_failed`
   * handling never ran. withPublic's catch-all then did what it is supposed to
   * do for an API route.
   */
  beforeEach(() => {
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("KORA_APP_URL", "https://kora.test");
  });

  it("redirects rather than 500s when the database is unreachable", async () => {
    const { getDb } = await import("@/lib/db/client");
    vi.mocked(getDb).mockImplementation(() => {
      throw new Error("DATABASE_URL points at localhost");
    });

    const { GET: callback } = await import(
      "@/app/api/auth/microsoft/callback/route"
    );
    const res = await callback(
      new NextRequest(
        "https://kora.test/api/auth/microsoft/callback?code=abc&state=xyz",
        { headers: { host: "kora.test" } },
      ),
    );

    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login?ssoError=");
    expect(location).not.toContain("500");
  });

  it("still bounces with a legible code when Microsoft reports an error", async () => {
    const { GET: callback } = await import(
      "@/app/api/auth/microsoft/callback/route"
    );
    const res = await callback(
      new NextRequest(
        "https://kora.test/api/auth/microsoft/callback?error=access_denied",
        { headers: { host: "kora.test" } },
      ),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("ssoError=msft_access_denied");
  });

  it("every bounce code has a message the login page can show", async () => {
    // A bounce to a code with no message renders a blank explanation, which is
    // barely better than the 500 it replaced.
    const { SSO_ERRORS, ssoErrorMessage } = await import("@/lib/auth/messages");
    for (const code of [
      "unexpected_error", "not_configured", "state_invalid", "no_code",
      "exchange_failed", "graph_failed", "no_email", "not_authorized",
      "sso_ambiguous", "lookup_failed", "domain_not_allowed", "host_mismatch",
    ]) {
      expect(SSO_ERRORS[code], `no message for ${code}`).toBeTruthy();
    }
    expect(ssoErrorMessage("msft_access_denied")).toBeTruthy();
  });
});

/**
 * Step 16's two new reads.
 *
 * Both are admin-gated, and both gates are the kind that is true by reading
 * until something asserts it. `?archived=1` is the sharper one: it is a query
 * parameter on a route every signed-in user may call, so the gate lives inside
 * the handler rather than in `withAuth`, where a refactor could drop it without
 * touching any role declaration.
 */
describe("admin reads added in step 16", () => {
  it("GET /api/clients?archived=1 refuses a viewer and an editor", async () => {
    for (const role of ["viewer", "editor"] as const) {
      signInAs(role);
      const res = await getClients(req("/api/clients?archived=1"));
      expect(res.status, `${role} must not read archived clients`).toBe(403);
    }
  });

  it("GET /api/clients?archived=1 returns the archived list for an admin", async () => {
    signInAs("admin");
    const res = await getClients(req("/api/clients?archived=1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.clients)).toBe(true);
  });

  it("the archived flag does not leak into the ordinary list", async () => {
    // The active list and the archived list are the same route with the filter
    // inverted, so the risk is one bleeding into the other. An editor asking
    // for the normal list must still get it.
    signInAs("editor");
    const res = await getClients(req("/api/clients"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.clients)).toBe(true);
    // Every row in the ordinary list is an ACTIVE client, so none of them
    // carries the archived-list shape.
    for (const c of body.clients) expect(c).not.toHaveProperty("archivedAt");
  });

  it("GET /api/backups is admin-only", async () => {
    signInAs("viewer");
    expect((await getBackups(req("/api/backups"))).status).toBe(403);
    signInAs("editor");
    expect((await getBackups(req("/api/backups"))).status).toBe(403);
  });

  it("GET /api/backups is refused outright when signed out", async () => {
    signInAs(null);
    expect((await getBackups(req("/api/backups"))).status).toBe(401);
  });
});

/**
 * THE READ-ONLY GATE.
 *
 * The parallel run rests on exactly one property: only one app writes this
 * database. Two writers is not survivable — one edit in the old app rewrites a
 * whole client's subtree in v2 from the v1 jsonb, silently replacing anything
 * written here — so this is the assertion that the arrangement holds.
 *
 * The flag is set and cleared around each case rather than for the file, so a
 * failure cannot leak into the suites above and turn every other write test
 * into a 423.
 */
describe("read-only mode", () => {
  const setReadOnly = (on: boolean) => {
    if (on) process.env.KORA_READ_ONLY = "1";
    else delete process.env.KORA_READ_ONLY;
  };

  afterEach(() => setReadOnly(false));

  it("refuses every kind of write with 423, not 403", async () => {
    // 403 would say "not you". 423 says "not anyone, not yet" — a different
    // thing to the person reading it and to any client deciding to retry.
    signInAs("admin");
    setReadOnly(true);

    const cases: [string, Promise<Response>][] = [
      ["POST /api/clients", postClient(req("/api/clients", {
        method: "POST", body: { name: "Should Not Exist" },
      }))],
      ["PUT settings", putDigestRecipients(req("/api/settings/digest-recipients", {
        method: "PUT", body: { emails: ["a@b.test"] },
      }))],
      ["POST /api/snapshots", postSnapshot(req("/api/snapshots", { method: "POST" }))],
    ];

    for (const [label, p] of cases) {
      const res = await p;
      expect(res.status, label).toBe(423);
      const body = await res.json();
      expect(body.readOnly, `${label} must be recognisable without matching prose`).toBe(true);
      expect(body.error, label).toMatch(/current Kora/i);
    }
  });

  it("still allows every READ", async () => {
    // The entire point: people use this app all day, they just cannot edit.
    signInAs("viewer");
    setReadOnly(true);
    expect((await getClients(req("/api/clients"))).status).toBe(200);
    signInAs("admin");
    expect((await getAudit(req("/api/audit"))).status).toBe(200);
    expect((await getSnapshots(req("/api/snapshots"))).status).toBe(200);
  });

  it("does NOT block signing in or out", async () => {
    // Both are withPublic, so the gate in withAuth cannot reach them — but that
    // is a fact about the current wiring, and locking people out of their own
    // session would be the worst possible failure of a read-only flag.
    setReadOnly(true);
    signInAs(null);

    const inRes = await login(req("/api/auth/login", {
      method: "POST", body: { username: "meera", password: "correct-horse" },
    }));
    expect(inRes.status).not.toBe(423);

    signInAs("admin");
    const outRes = await logout(req("/api/auth/logout", { method: "POST" }));
    expect(outRes.status).not.toBe(423);
  });

  it("writes work normally when the flag is unset", async () => {
    // Guards the guard: without this the suite would pass with the gate stuck
    // permanently on, which is a far worse bug than it being off.
    signInAs("admin");
    setReadOnly(false);
    const res = await postClient(req("/api/clients", {
      method: "POST", body: { name: `Gate Off ${Date.now()}` },
    }));
    expect(res.status).toBe(201);
  });

  it("is off by default, so a missing variable never silently freezes the app", () => {
    delete process.env.KORA_READ_ONLY;
    expect(isReadOnly()).toBe(false);
    process.env.KORA_READ_ONLY = "0";
    expect(isReadOnly()).toBe(false);
    process.env.KORA_READ_ONLY = "1";
    expect(isReadOnly()).toBe(true);
  });
});
