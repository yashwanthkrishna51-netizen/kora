import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import {
  users, clients, integrations, modules, phases, appSettings,
} from "@/lib/db/schema";
import { runDigest, SEND_PACING_MS } from "@/lib/digest/run";
import { sendMail, getGraphToken, resetGraphTokenCache } from "@/lib/mail/graph";
import type { AnyDb } from "@/lib/auth/db-types";
import type { OutboundEmail } from "@/lib/digest/compute";

/**
 * The impure halves: the digest's orchestration, and the Graph transport.
 *
 * No test here is allowed to reach the network. Each installs a global fetch
 * that throws, so a refactor which forgets to inject one fails loudly rather
 * than quietly dialling Microsoft.
 */

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const readSql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

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
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(readSql(f));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec(
    `truncate table phases_v2, modules_v2, milestones_v2, integrations_v2,
     ams_work_log_v2, clients_v2, users, app_settings, audit_log
     restart identity cascade`,
  );
  resetGraphTokenCache();
  vi.unstubAllEnvs();
  vi.stubGlobal("fetch", () => {
    throw new Error("no network in tests");
  });
});

afterAll(async () => {
  await pg?.close();
});

async function seed() {
  await db.insert(users).values([
    { id: "u1", username: "kavya", name: "Kavya", email: "kavya@kognoz.com",
      role: "editor", passwordHash: "$2b$12$x", tokenVersion: 0 },
    { id: "u2", username: "arjun", name: "Arjun", email: "arjun@kognoz.com",
      role: "editor", passwordHash: "$2b$12$x", tokenVersion: 0 },
  ]);
  await db.insert(clients).values([
    { id: "c1", name: "Aster Retail", hasImplementation: true, masterAssignee: "Arjun" },
    { id: "c2", name: "Gone", archived: true },
  ]);
  await db.insert(integrations).values([
    { id: "i1", clientId: "c1", name: "Payroll", status: "In Progress", assignee: "Kavya" },
    { id: "i2", clientId: "c1", name: "Archived", status: "In Progress",
      assignee: "Kavya", archived: true },
  ]);
  await db.insert(modules).values({ id: "m1", clientId: "c1", name: "Core HR" });
  await db.insert(phases).values({
    id: "p1", moduleId: "m1", clientId: "c1", phaseName: "BPU",
    status: "In Progress", assignee: "",
  });
  await db.insert(appSettings).values({
    key: "digest_recipients", value: { emails: ["ops@kognoz.com"] },
  });
}

describe("digest run", () => {
  it("plans without sending on a dry run", async () => {
    await seed();
    const send = vi.fn();
    const res = await runDigest({
      db, appUrl: "https://kora.test", dryRun: true, send, sleep: async () => {},
    });

    expect(send).not.toHaveBeenCalled();
    expect(res.planned).toBeGreaterThan(0);
    expect(res.preview?.every((p) => p.to && p.subject)).toBe(true);
  });

  it("sends one message per recipient", async () => {
    await seed();
    const sent: OutboundEmail[] = [];
    const res = await runDigest({
      db, appUrl: "https://kora.test",
      send: async (e) => { sent.push(e); }, sleep: async () => {},
    });

    expect(res.sent).toBe(sent.length);
    expect(res.failed).toBe(0);
    // Kavya owns the integration; Arjun is master assignee on the phase.
    expect(sent.map((e) => e.to).sort())
      .toEqual(["arjun@kognoz.com", "kavya@kognoz.com"]);
  });

  it("excludes archived clients and archived children", async () => {
    await seed();
    const sent: OutboundEmail[] = [];
    await runDigest({
      db, appUrl: "https://kora.test",
      send: async (e) => { sent.push(e); }, sleep: async () => {},
    });
    const all = sent.map((e) => e.html).join("");
    expect(all).not.toContain("Archived");
    expect(all).not.toContain("Gone");
  });

  it("keeps going when one recipient fails", async () => {
    // One bad address must not cost everyone else their reminder.
    await seed();
    const send = vi.fn(async (e: OutboundEmail) => {
      if (e.to === "kavya@kognoz.com") throw new Error("mailbox full");
    });
    const res = await runDigest({
      db, appUrl: "https://kora.test", send, sleep: async () => {},
    });

    expect(res.failed).toBe(1);
    expect(res.sent).toBe(res.planned - 1);
    expect(res.ok).toBe(true);
  });

  it("paces between sends but not after the last one", async () => {
    await seed();
    const delays: number[] = [];
    const res = await runDigest({
      db, appUrl: "https://kora.test", send: async () => {},
      sleep: async (ms) => { delays.push(ms); },
    });

    expect(delays).toHaveLength(res.planned - 1);
    expect(delays.every((d) => d === SEND_PACING_MS)).toBe(true);
  });

  it("sends nothing when there is nothing to remind about", async () => {
    const res = await runDigest({
      db, appUrl: "https://kora.test", send: async () => {}, sleep: async () => {},
    });
    expect(res.planned).toBe(0);
    expect(res.ok).toBe(true);
  });
});

describe("graph transport", () => {
  const okToken = () =>
    new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), {
      status: 200, headers: { "content-type": "application/json" },
    });

  it("caches the token instead of re-authenticating per message", async () => {
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");

    const fetchImpl = vi.fn(async () => okToken());
    const now = () => 1_000_000;

    await getGraphToken({ fetchImpl: fetchImpl as unknown as typeof fetch, now });
    await getGraphToken({ fetchImpl: fetchImpl as unknown as typeof fetch, now });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-authenticates once the token is close to expiry", async () => {
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");

    const fetchImpl = vi.fn(async () => okToken());
    await getGraphToken({ fetchImpl: fetchImpl as unknown as typeof fetch, now: () => 0 });
    // 3600s token, 60s margin — just past the margin.
    await getGraphToken({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 3_541_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 and honours retry-after", async () => {
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("AZURE_DEFAULT_MAIL_SENDER", "kora@kognoz.com");

    const delays: number[] = [];
    let sendCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/oauth2/")) return okToken();
      sendCalls++;
      if (sendCalls === 1) {
        return new Response("", { status: 429, headers: { "retry-after": "7" } });
      }
      return new Response("", { status: 202 });
    });

    await sendMail(
      { to: "a@b.com", subject: "s", html: "<p>x</p>" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: async (ms) => { delays.push(ms); },
      },
    );

    expect(sendCalls).toBe(2);
    expect(delays).toEqual([7000]);
  });

  it("retries a 503 too, which the old client did not", async () => {
    // Graph throttles with both. Handling only 429 meant a throttled digest
    // lost the rest of its recipients silently.
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("AZURE_DEFAULT_MAIL_SENDER", "kora@kognoz.com");

    let sendCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/oauth2/")) return okToken();
      sendCalls++;
      return sendCalls === 1
        ? new Response("", { status: 503 })
        : new Response("", { status: 202 });
    });

    await sendMail(
      { to: "a@b.com", subject: "s", html: "<p>x</p>" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} },
    );
    expect(sendCalls).toBe(2);
  });

  it("gives up after three attempts rather than retrying forever", async () => {
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("AZURE_DEFAULT_MAIL_SENDER", "kora@kognoz.com");

    let sendCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/oauth2/")) return okToken();
      sendCalls++;
      return new Response("", { status: 429 });
    });

    await expect(
      sendMail(
        { to: "a@b.com", subject: "s", html: "<p>x</p>" },
        { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} },
      ),
    ).rejects.toThrow(/429/);
    expect(sendCalls).toBe(3);
  });

  it("does not leak Graph's error body to the caller", async () => {
    // Entra and Graph name tenants, mailboxes and principals in error text.
    vi.stubEnv("AZURE_CLIENT_ID", "id");
    vi.stubEnv("AZURE_CLIENT_SECRET", "secret");
    vi.stubEnv("AZURE_TENANT_ID", "tenant");
    vi.stubEnv("AZURE_DEFAULT_MAIL_SENDER", "kora@kognoz.com");

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes("/oauth2/")) return okToken();
      return new Response(
        JSON.stringify({ error: { message: "Access to OrganizationX mailbox denied" } }),
        { status: 403 },
      );
    });

    const err = await sendMail(
      { to: "a@b.com", subject: "s", html: "<p>x</p>" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} },
    ).catch((e) => e);

    expect(String(err.message)).not.toContain("OrganizationX");
  });

  it("console transport sends nothing and needs no credentials", async () => {
    // This is what lets the whole path be exercised before the Azure app
    // registration exists.
    vi.stubEnv("KORA_MAIL_TRANSPORT", "console");
    const fetchImpl = vi.fn();
    await sendMail(
      { to: "a@b.com", subject: "s", html: "<p>x</p>" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
