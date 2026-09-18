import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";
import * as schema from "@/lib/db/schema";
import {
  consume, windowStartFor, clientEmailLimits, HOUR_MS, DAY_MS,
} from "@/lib/api/rate-limit";
import { clientEmailSend } from "@/lib/validation/entities";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Rate limiting for user-triggered mail.
 *
 * Every message leaves through one shared Exchange mailbox, so the throttling
 * and reputational cost is shared too. These counters are what keeps one
 * compromised editor account from spending it.
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
    // Production has this trigger; a test schema without it silently makes
    // updated_at (and therefore every OCC token) hold still.
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(readSql(f));
  }
}, 60_000);

beforeEach(async () => {
  await pg.exec("truncate table rate_limits restart identity cascade");
});

afterAll(async () => {
  await pg?.close();
});

const NOW = new Date("2026-09-01T14:30:00Z");
const one = (limit: number, windowMs = HOUR_MS) => [
  { key: "test:key", limit, windowMs, label: "Limit reached" },
];

describe("windows", () => {
  it("aligns to the clock rather than the first hit", () => {
    // Aligned windows make the row self-expiring — a stale window is detected
    // in the same statement that increments — and make two concurrent requests
    // agree on the boundary.
    expect(windowStartFor(NOW, HOUR_MS)).toBe("2026-09-01T14:00:00.000Z");
    expect(windowStartFor(NOW, DAY_MS)).toBe("2026-09-01T00:00:00.000Z");
  });

  it("puts two moments in the same hour in the same window", () => {
    expect(windowStartFor(new Date("2026-09-01T14:00:01Z"), HOUR_MS))
      .toBe(windowStartFor(new Date("2026-09-01T14:59:59Z"), HOUR_MS));
  });
});

describe("consume", () => {
  it("allows up to the limit and refuses the next", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(consume(db, one(3), NOW)).resolves.toBeUndefined();
    }
    await expect(consume(db, one(3), NOW)).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("tells the caller when they can try again", async () => {
    await consume(db, one(1), NOW);
    const err = await consume(db, one(1), NOW).catch((e) => e);
    expect(err.message).toContain("15:00");
  });

  it("resets when the window rolls over", async () => {
    await consume(db, one(1), NOW);
    await expect(consume(db, one(1), NOW)).rejects.toThrow();
    // Next hour.
    await expect(
      consume(db, one(1), new Date("2026-09-01T15:00:00Z")),
    ).resolves.toBeUndefined();
  });

  it("counts concurrent calls exactly once each", async () => {
    // The check and the increment are one statement. Read-then-write would let
    // two callers both read 0 and both write 1.
    await Promise.all([
      consume(db, one(5), NOW),
      consume(db, one(5), NOW),
      consume(db, one(5), NOW),
    ]);
    const [row] = await db.select().from(schema.rateLimits);
    expect(row.count).toBe(3);
  });

  it("settles at the limit rather than climbing on retries", async () => {
    // The throw is inside the transaction, so a refused attempt rolls back its
    // own increment. The caller stays blocked either way — the count is
    // already at the limit — and the alternative (no transaction) would let a
    // send that never happened inflate the hourly counter.
    await consume(db, one(1), NOW);
    for (let i = 0; i < 5; i++) {
      await consume(db, one(1), NOW).catch(() => {});
    }
    const [row] = await db.select().from(schema.rateLimits);
    expect(row.count).toBe(1);
    // Still refused, which is the property that actually matters.
    await expect(consume(db, one(1), NOW)).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("fails closed when the database is unavailable", async () => {
    // Opposite of the login throttle, which fails open by design. This is the
    // only thing between one account and the company mailbox.
    const broken = {
      transaction: async () => { throw new Error("connection lost"); },
    } as unknown as AnyDb;
    await expect(consume(broken, one(10), NOW)).rejects.toThrow();
  });

  it("keeps separate keys separate", async () => {
    await consume(db, [
      { key: "a", limit: 1, windowMs: HOUR_MS, label: "a" },
    ], NOW);
    await expect(
      consume(db, [{ key: "b", limit: 1, windowMs: HOUR_MS, label: "b" }], NOW),
    ).resolves.toBeUndefined();
  });

  it("does not half-apply a multi-counter check", async () => {
    // All specs are in one transaction, so tripping the second must not leave
    // the first incremented.
    const specs = [
      { key: "first", limit: 10, windowMs: HOUR_MS, label: "first" },
      { key: "second", limit: 0, windowMs: HOUR_MS, label: "second" },
    ];
    await consume(db, specs, NOW).catch(() => {});

    const rows = await db.select().from(schema.rateLimits);
    expect(rows).toHaveLength(0);
  });
});

describe("client email limits", () => {
  it("caps per user per hour, per user per day, and globally per day", () => {
    const specs = clientEmailLimits("u1");
    expect(specs.map((s) => [s.key, s.limit])).toEqual([
      ["email:user:u1:h", 10],
      ["email:user:u1:d", 30],
      ["email:global:d", 200],
    ]);
  });

  it("shares the global counter across users", async () => {
    const globalOnly = (userId: string) =>
      clientEmailLimits(userId).filter((s) => s.key === "email:global:d");

    await consume(db, globalOnly("u1"), NOW);
    await consume(db, globalOnly("u2"), NOW);

    const [row] = await db.select().from(schema.rateLimits);
    expect(row.count).toBe(2);
  });
});

describe("client email validation", () => {
  const valid = {
    to: "client@example.com",
    subject: "Monthly report",
    bodyText: "Please find the report attached.",
  };

  it("caps the cc list", () => {
    const cc = Array.from({ length: 6 }, (_, i) => `p${i}@example.com`);
    expect(clientEmailSend.safeParse({ ...valid, cc }).success).toBe(false);
    expect(clientEmailSend.safeParse({ ...valid, cc: cc.slice(0, 5) }).success)
      .toBe(true);
  });

  it("strips newlines out of the subject", () => {
    // It reaches a mail header. Graph builds the header from JSON so injection
    // is not reachable today, but the property should hold here rather than
    // depend on the transport.
    const parsed = clientEmailSend.parse({
      ...valid, subject: "Report\r\nBcc: attacker@evil.com",
    });
    expect(parsed.subject).not.toContain("\n");
    expect(parsed.subject).not.toContain("\r");
  });

  it("rejects a malformed recipient", () => {
    expect(clientEmailSend.safeParse({ ...valid, to: "not-an-email" }).success)
      .toBe(false);
  });

  it("rejects an oversized attachment", () => {
    const parsed = clientEmailSend.safeParse({
      ...valid,
      attachment: {
        fileName: "report.pdf",
        contentBase64: "A".repeat(12 * 1024 * 1024 + 1),
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses unknown keys rather than dropping them", () => {
    expect(
      clientEmailSend.safeParse({ ...valid, bcc: "sneaky@evil.com" }).success,
    ).toBe(false);
  });
});
