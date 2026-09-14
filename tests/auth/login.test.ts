import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import * as schema from "@/lib/db/schema";
import { users, loginIpThrottle, auditLog } from "@/lib/db/schema";
import { attemptLogin } from "@/lib/auth/login";
import { validateSession } from "@/lib/auth/session";
import { verifyToken } from "@/lib/auth/token";
import { isBcryptHash } from "@/lib/auth/password";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Login, end to end, against a real Postgres.
 *
 * Every case here is one an ordinary happy-path test would miss and a real
 * user would eventually hit: a password stored under the old hashing scheme,
 * an account that locks, a session revoked by an admin while its holder is
 * still using it.
 */

const SECRET = "integration-test-secret";
const NOW = 1_800_000_000_000;

const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

const sha256 = (s: string) =>
  crypto.createHash("sha256").update(s).digest("hex");

let pg: PGlite;
let db: AnyDb;

async function seedUsers() {
  await db.delete(users);
  await db.delete(loginIpThrottle);

  await db.insert(users).values([
    {
      id: "u_bcrypt",
      username: "meera",
      name: "Meera Raghavan",
      email: "meera@example.com",
      role: "admin",
      passwordHash: await bcrypt.hash("correct-horse", 10), // low cost: tests
      tokenVersion: 0,
      failedAttempts: 0,
      lockoutLevel: 0,
    },
    {
      // Carries the ORIGINAL hashing scheme. Real production rows still look
      // like this, and forcing a reset on those users was never acceptable.
      id: "u_legacy",
      username: "vikram",
      name: "Vikram Shah",
      email: "vikram@example.com",
      role: "viewer",
      passwordHash: sha256("legacy-password"),
      tokenVersion: 0,
      failedAttempts: 0,
      lockoutLevel: 0,
    },
    {
      id: "u_locked",
      username: "arjun",
      name: "Arjun Mehta",
      email: "arjun@example.com",
      role: "editor",
      passwordHash: await bcrypt.hash("whatever", 10),
      tokenVersion: 0,
      failedAttempts: 0,
      lockoutLevel: 1,
      lockedUntil: new Date(NOW + 20 * 60000).toISOString(),
    },
  ]);
}

const login = (username: string, password: string, ip = "203.0.113.7", now = NOW) =>
  attemptLogin(db, { username, password, ip, userAgent: "vitest" }, now);

beforeAll(async () => {
  process.env.INTEGTRACK_SECRET = SECRET;
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;

  await pg.exec(`do $$ begin
    if not exists (select from pg_roles where rolname = 'service_role') then
      create role service_role;
    end if;
  end $$;`);
  for (const f of [
    "0001_baseline_v1_schema.sql",
    "0002_v2_schema.sql",
    "0003_domain_membership.sql",
    "0005_backend_indexes.sql",
    // 0006 installs the `set_updated_at` trigger on `users`, which is what
    // makes updated_at — and therefore the OCC token — move on a write. It was
    // missing here, so anything in this file that asserts on updated_at was
    // asserting against a schema production does not have.
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(read(f));
  }
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(seedUsers);

describe("successful login", () => {
  it("returns a valid token and the user", async () => {
    const res = await login("meera", "correct-horse");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.user).toMatchObject({
      id: "u_bcrypt",
      username: "meera",
      role: "admin",
      email: "meera@example.com",
    });

    const payload = verifyToken(res.token, SECRET);
    expect(payload).toMatchObject({ id: "u_bcrypt", tokenVersion: 0 });
  });

  it("accepts a username in the wrong case", async () => {
    // The old app matched exactly, so a user who capitalised their username
    // simply could not sign in and had no way to discover why.
    for (const variant of ["MEERA", "Meera", "mEeRa"]) {
      expect((await login(variant, "correct-horse")).ok).toBe(true);
    }
  });

  it("clears the failure counters", async () => {
    await login("meera", "wrong");
    await login("meera", "wrong");
    await login("meera", "correct-horse");
    const [row] = await db.select().from(users).where(eq(users.id, "u_bcrypt"));
    expect(row.failedAttempts).toBe(0);
    expect(row.lockoutLevel).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("writes an audit entry", async () => {
    await login("meera", "correct-horse");
    const rows = await db.select().from(auditLog);
    expect(rows.some((r) => r.action === "Login success")).toBe(true);
  });
});

describe("legacy SHA-256 passwords", () => {
  it("lets the user in and silently upgrades the hash to bcrypt", async () => {
    const before = (
      await db.select().from(users).where(eq(users.id, "u_legacy"))
    )[0];
    expect(isBcryptHash(before.passwordHash)).toBe(false);

    expect((await login("vikram", "legacy-password")).ok).toBe(true);

    const after = (
      await db.select().from(users).where(eq(users.id, "u_legacy"))
    )[0];
    expect(isBcryptHash(after.passwordHash)).toBe(true);
    // And the upgraded hash must still verify the same password.
    expect(await bcrypt.compare("legacy-password", after.passwordHash)).toBe(true);
  });

  it("still rejects the wrong password against a legacy hash", async () => {
    const res = await login("vikram", "nope");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });
});

describe("failures reveal nothing", () => {
  it("returns the same message for unknown user and wrong password", async () => {
    const unknown = await login("nobody", "x");
    const wrong = await login("meera", "x");
    expect(unknown.ok).toBe(false);
    expect(wrong.ok).toBe(false);
    if (unknown.ok || wrong.ok) return;
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.error).toBe(wrong.error);
  });

  it("does not create a user row for an unknown username", async () => {
    await login("nobody", "x");
    const rows = await db.select().from(users);
    expect(rows).toHaveLength(3);
  });
});

describe("account lockout", () => {
  it("locks on the fifth consecutive failure", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await login("meera", "wrong");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(401);
    }
    const fifth = await login("meera", "wrong");
    expect(fifth.ok).toBe(false);

    const [row] = await db.select().from(users).where(eq(users.id, "u_bcrypt"));
    expect(row.lockedUntil).not.toBeNull();
    expect(row.lockoutLevel).toBe(1);

    // And the CORRECT password is now refused too — that is the point.
    const correct = await login("meera", "correct-horse");
    expect(correct.ok).toBe(false);
    if (!correct.ok) expect(correct.status).toBe(423);
  });

  it("reports 423 with the remaining time while locked", async () => {
    const res = await login("arjun", "whatever");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(423);
    expect(res.error).toMatch(/20 minutes/);
    expect(res.lockedUntil).toBeTruthy();
  });

  it("lets the user back in once the lock expires", async () => {
    const later = NOW + 21 * 60000;
    const res = await login("arjun", "whatever", "203.0.113.7", later);
    expect(res.ok).toBe(true);
  });

  it("escalates the next lock to four hours", async () => {
    // arjun is already at level 1, so his next lock should be the second tier.
    const later = NOW + 21 * 60000;
    for (let i = 0; i < 5; i++) await login("arjun", "wrong", "203.0.113.7", later);
    const [row] = await db.select().from(users).where(eq(users.id, "u_locked"));
    const minutes = (new Date(row.lockedUntil!).getTime() - later) / 60000;
    expect(minutes).toBe(240);
    expect(row.lockoutLevel).toBe(2);
  });
});

describe("per-IP throttle", () => {
  // Each failed attempt deliberately performs a real cost-12 bcrypt so that an
  // unknown username costs the same as a wrong password. That makes 20 real
  // attempts take several seconds, so the accumulation arithmetic is unit
  // tested in core.test.ts and what is checked here is the WIRING: that the
  // counter advances, and that a locked row actually refuses a good password.

  it("advances the counter on each failure from the same address", async () => {
    const ip = "198.51.100.42";
    for (let i = 0; i < 3; i++) {
      await attemptLogin(
        db,
        { username: "meera", password: "wrong", ip, userAgent: "vitest" },
        NOW,
      );
    }
    const [row] = await db
      .select()
      .from(loginIpThrottle)
      .where(eq(loginIpThrottle.ip, ip));
    expect(row.attemptCount).toBe(3);
  });

  it("refuses even a CORRECT password while the address is locked", async () => {
    // This is what stops the username lockout being turned around and used to
    // lock every account in the company: the attacker's address is stopped
    // first, before any username is touched.
    const ip = "198.51.100.99";
    await db.insert(loginIpThrottle).values({
      ip,
      attemptCount: 0,
      windowStart: new Date(NOW).toISOString(),
      lockedUntil: new Date(NOW + 15 * 60000).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    });

    const blocked = await attemptLogin(
      db,
      { username: "meera", password: "correct-horse", ip, userAgent: "vitest" },
      NOW,
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(429);
      expect(blocked.error).toMatch(/Too many attempts from your network/);
    }
  });

  it("releases the address once the lock expires", async () => {
    const ip = "198.51.100.99";
    await db.insert(loginIpThrottle).values({
      ip,
      attemptCount: 0,
      windowStart: new Date(NOW).toISOString(),
      lockedUntil: new Date(NOW + 15 * 60000).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    });
    const res = await attemptLogin(
      db,
      { username: "meera", password: "correct-horse", ip, userAgent: "vitest" },
      NOW + 16 * 60000,
    );
    expect(res.ok).toBe(true);
  });

  it("does not affect a different address", async () => {
    const res = await login("meera", "correct-horse", "192.0.2.99");
    expect(res.ok).toBe(true);
  });
});

describe("session validation", () => {
  it("accepts a freshly issued token", async () => {
    const res = await login("meera", "correct-horse");
    if (!res.ok) throw new Error("login failed");
    const session = await validateSession(db, res.token, NOW);
    expect(session.valid).toBe(true);
    if (session.valid) expect(session.user.id).toBe("u_bcrypt");
  });

  it("rejects the token after token_version is bumped", async () => {
    // This is force-logout and password-change revocation.
    const res = await login("meera", "correct-horse");
    if (!res.ok) throw new Error("login failed");

    await db
      .update(users)
      .set({ tokenVersion: 1 })
      .where(eq(users.id, "u_bcrypt"));

    const session = await validateSession(db, res.token, NOW);
    expect(session.valid).toBe(false);
    if (!session.valid) expect(session.reason).toBe("revoked");
  });

  it("reports the role as it is NOW, not as it was when signed", async () => {
    // An admin demoted to viewer must lose access on the next request, not in
    // seven days when their token happens to expire.
    const res = await login("meera", "correct-horse");
    if (!res.ok) throw new Error("login failed");
    expect(verifyToken(res.token, SECRET)!.role).toBe("admin");

    await db.update(users).set({ role: "viewer" }).where(eq(users.id, "u_bcrypt"));

    const session = await validateSession(db, res.token, NOW);
    expect(session.valid).toBe(true);
    if (session.valid) expect(session.user.role).toBe("viewer");
  });

  it("rejects an expired token", async () => {
    const res = await login("meera", "correct-horse");
    if (!res.ok) throw new Error("login failed");
    const session = await validateSession(db, res.token, NOW + 8 * 86400_000);
    expect(session.valid).toBe(false);
    if (!session.valid) expect(session.reason).toBe("expired");
  });

  it("rejects a token for a user that no longer exists", async () => {
    const res = await login("meera", "correct-horse");
    if (!res.ok) throw new Error("login failed");
    await db.delete(users).where(eq(users.id, "u_bcrypt"));
    const session = await validateSession(db, res.token, NOW);
    expect(session.valid).toBe(false);
    if (!session.valid) expect(session.reason).toBe("user_not_found");
  });
});

/**
 * A clean sign-in must not write to the user row.
 *
 * Since migration 0006 a `set_updated_at` trigger fires on any UPDATE to
 * `users`, and `updated_at` IS the OCC token the admin screen sends as
 * If-Match. The login success path used to write the cleared-lockout state
 * unconditionally, so every sign-in moved that token — and an admin with the
 * users table open got a 409 "someone else changed this while you were
 * editing" on a role change or a delete, describing a conflict that had never
 * happened.
 *
 * Found by `pnpm verify:admin` against a real server, which reads a token,
 * signs someone in, and then uses it. These lock the behaviour into CI.
 */
describe("a successful login writes only when something changed", () => {
  beforeEach(seedUsers);

  it("leaves updated_at alone when there was nothing to clear", async () => {
    const before = await db
      .select({ v: users.updatedAt })
      .from(users)
      .where(eq(users.id, "u_bcrypt"));

    const res = await login("meera", "correct-horse");
    expect(res.ok).toBe(true);

    const after = await db
      .select({ v: users.updatedAt })
      .from(users)
      .where(eq(users.id, "u_bcrypt"));

    // The assertion that matters: an admin's If-Match token for this row is
    // still valid after this person signed in.
    expect(after[0].v).toEqual(before[0].v);
  });

  it("DOES write when there are failed attempts to clear", async () => {
    // The counter must still be reset — skipping the write entirely would let
    // failures accumulate across successful logins and lock out a user who has
    // been signing in fine.
    await login("meera", "wrong").catch(() => {});
    const mid = await db
      .select({ failed: users.failedAttempts })
      .from(users)
      .where(eq(users.id, "u_bcrypt"));
    expect(mid[0].failed).toBe(1);

    const res = await login("meera", "correct-horse");
    expect(res.ok).toBe(true);

    const after = await db
      .select({ failed: users.failedAttempts, level: users.lockoutLevel })
      .from(users)
      .where(eq(users.id, "u_bcrypt"));
    expect(after[0].failed).toBe(0);
    expect(after[0].level).toBe(0);
  });

  it("still rehashes a legacy password even though nothing needed clearing", async () => {
    // The two reasons to write are independent. A legacy user with a clean
    // lockout state must NOT skip the upgrade — that is the only moment the
    // plaintext is available.
    const res = await login("vikram", "legacy-password");
    expect(res.ok).toBe(true);

    const after = await db
      .select({ hash: users.passwordHash })
      .from(users)
      .where(eq(users.id, "u_legacy"));
    expect(after[0].hash.startsWith("$2")).toBe(true);
  });
});
