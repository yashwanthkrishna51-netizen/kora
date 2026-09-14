import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import * as schema from "@/lib/db/schema";
import { users, loginIpThrottle, auditLog } from "@/lib/db/schema";
import {
  changePassword,
  forceLogoutAll,
  forceLogoutUser,
  clearLockout,
  assertUserId,
} from "@/lib/auth/account";
import { attemptLogin } from "@/lib/auth/login";
import { validateSession } from "@/lib/auth/session";
import type { AnyDb } from "@/lib/auth/db-types";

/**
 * Account operations against a real Postgres.
 *
 * The cases that matter are the ones about session invalidation: changing a
 * password must end other sessions but not your own, and a force-logout must
 * leave no token still working.
 */

const SECRET = "account-test-secret";
const NOW = 1_800_000_000_000;
const MIGRATIONS = path.resolve(process.cwd(), "db/migrations");
const read = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), "utf8");

let pg: PGlite;
let db: AnyDb;

const ADMIN = { id: "u_admin", username: "meera", role: "admin" };

async function seed() {
  await db.delete(users);
  await db.delete(loginIpThrottle);
  await db.delete(auditLog);

  const hash = await bcrypt.hash("original-password", 10);
  await db.insert(users).values([
    { id: "u_admin", username: "meera", name: "Meera", email: "m@example.com",
      role: "admin", passwordHash: hash, tokenVersion: 0 },
    { id: "u_editor", username: "arjun", name: "Arjun", email: "a@example.com",
      role: "editor", passwordHash: hash, tokenVersion: 0 },
    { id: "u_locked", username: "vikram", name: "Vikram", email: "v@example.com",
      role: "viewer", passwordHash: hash, tokenVersion: 0,
      failedAttempts: 0, lockoutLevel: 2,
      lockedUntil: new Date(NOW + 4 * 3600_000).toISOString() },
  ]);
}

const meta = { ip: "203.0.113.7", userAgent: "vitest" };

beforeAll(async () => {
  process.env.INTEGTRACK_SECRET = SECRET;
  pg = new PGlite();
  db = drizzle(pg, { schema }) as unknown as AnyDb;
  await pg.exec(`do $$ begin
    if not exists (select from pg_roles where rolname='service_role') then
      create role service_role;
    end if; end $$;`);
  for (const f of [
    "0001_baseline_v1_schema.sql",
    "0002_v2_schema.sql",
    "0003_domain_membership.sql",
    "0005_backend_indexes.sql",
    // Production has this trigger; a test schema without it silently makes
    // updated_at (and therefore every OCC token) hold still.
    "0006_updated_at_trigger.sql",
  ]) {
    await pg.exec(read(f));
  }
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(seed);

describe("change password", () => {
  it("ends other sessions but keeps the one making the change", async () => {
    // The whole reason a fresh token is returned. Without it, changing your
    // password signs you out immediately, which reads as a bug.
    const before = await attemptLogin(
      db,
      { username: "meera", password: "original-password", ...meta },
      NOW,
    );
    if (!before.ok) throw new Error("setup login failed");

    const result = await changePassword(
      db,
      {
        userId: "u_admin",
        currentPassword: "original-password",
        newPassword: "a-much-better-password",
        ...meta,
      },
      NOW,
    );

    // The token held elsewhere is now dead…
    const old = await validateSession(db, before.token, NOW);
    expect(old.valid).toBe(false);
    if (!old.valid) expect(old.reason).toBe("revoked");

    // …while the one just issued works.
    const fresh = await validateSession(db, result.token, NOW);
    expect(fresh.valid).toBe(true);
    expect(result.passwordChanged).toBe(true);
  });

  it("actually changes the password", async () => {
    await changePassword(
      db,
      {
        userId: "u_admin",
        currentPassword: "original-password",
        newPassword: "a-much-better-password",
        ...meta,
      },
      NOW,
    );

    expect((await attemptLogin(db, { username: "meera", password: "original-password", ...meta }, NOW)).ok).toBe(false);
    expect((await attemptLogin(db, { username: "meera", password: "a-much-better-password", ...meta }, NOW)).ok).toBe(true);
  });

  it("rejects a wrong current password without changing anything", async () => {
    await expect(
      changePassword(
        db,
        { userId: "u_admin", currentPassword: "not-it", newPassword: "something-long", ...meta },
        NOW,
      ),
    ).rejects.toThrow(/Current password is incorrect/);

    // And the original still works.
    expect((await attemptLogin(db, { username: "meera", password: "original-password", ...meta }, NOW)).ok).toBe(true);
  });

  it("rejects a new password below the minimum length", async () => {
    await expect(
      changePassword(
        db,
        { userId: "u_admin", currentPassword: "original-password", newPassword: "short", ...meta },
        NOW,
      ),
    ).rejects.toThrow(/at least 8 characters/);
  });

  it("updates email alone without disturbing sessions", async () => {
    // An email edit should not sign anyone out — only a password change should.
    const before = await attemptLogin(
      db, { username: "meera", password: "original-password", ...meta }, NOW,
    );
    if (!before.ok) throw new Error("setup login failed");

    const result = await changePassword(
      db,
      { userId: "u_admin", currentPassword: "original-password", email: "  new@example.com  ", ...meta },
      NOW,
    );

    expect(result.passwordChanged).toBe(false);
    expect(result.user.email).toBe("new@example.com"); // trimmed
    expect((await validateSession(db, before.token, NOW)).valid).toBe(true);
  });
});

describe("force logout", () => {
  it("invalidates every outstanding token in one statement", async () => {
    const a = await attemptLogin(db, { username: "meera", password: "original-password", ...meta }, NOW);
    const b = await attemptLogin(db, { username: "arjun", password: "original-password", ...meta }, NOW);
    if (!a.ok || !b.ok) throw new Error("setup login failed");

    const result = await forceLogoutAll(db, ADMIN, meta);
    expect(result.affected).toBe(3);

    for (const token of [a.token, b.token]) {
      const s = await validateSession(db, token, NOW);
      expect(s.valid).toBe(false);
      if (!s.valid) expect(s.reason).toBe("revoked");
    }
  });

  it("bumps every user's token_version by exactly one", async () => {
    await db.update(users).set({ tokenVersion: 5 }).where(eq(users.id, "u_editor"));
    await forceLogoutAll(db, ADMIN, meta);

    const rows = await db.select().from(users);
    expect(rows.find((r) => r.id === "u_admin")!.tokenVersion).toBe(1);
    // Increments from wherever it was, rather than resetting to a constant.
    expect(rows.find((r) => r.id === "u_editor")!.tokenVersion).toBe(6);
  });

  it("signs out one user without touching anyone else", async () => {
    const admin = await attemptLogin(db, { username: "meera", password: "original-password", ...meta }, NOW);
    const editor = await attemptLogin(db, { username: "arjun", password: "original-password", ...meta }, NOW);
    if (!admin.ok || !editor.ok) throw new Error("setup login failed");

    const result = await forceLogoutUser(db, "u_editor", ADMIN, meta);
    expect(result.username).toBe("arjun");

    expect((await validateSession(db, editor.token, NOW)).valid).toBe(false);
    expect((await validateSession(db, admin.token, NOW)).valid).toBe(true);
  });

  it("404s for a user that does not exist", async () => {
    await expect(forceLogoutUser(db, "nobody", ADMIN, meta)).rejects.toThrow(/not found/i);
  });
});

describe("clear lockout", () => {
  it("releases a locked account", async () => {
    const before = await attemptLogin(db, { username: "vikram", password: "original-password", ...meta }, NOW);
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.status).toBe(423);

    const result = await clearLockout(db, "u_locked", ADMIN, meta, {}, NOW);
    expect(result.username).toBe("vikram");

    const after = await attemptLogin(
      db, { username: "vikram", password: "original-password", ip: "192.0.2.1", userAgent: "vitest" }, NOW,
    );
    expect(after.ok).toBe(true);

    const [row] = await db.select().from(users).where(eq(users.id, "u_locked"));
    expect(row.lockoutLevel).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("reports active network locks instead of silently leaving the user stuck", async () => {
    // The old button cleared only the username axis, so the person tried again
    // and was refused by the IP throttle with nothing explaining why.
    await db.insert(loginIpThrottle).values({
      ip: "198.51.100.5",
      attemptCount: 0,
      windowStart: new Date(NOW).toISOString(),
      lockedUntil: new Date(NOW + 10 * 60000).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    });

    const result = await clearLockout(db, "u_locked", ADMIN, meta, {}, NOW);
    expect(result.networkLocksActive).toBe(1);
    // Not cleared unless asked — those rows are also attack evidence.
    expect(result.networkLocksCleared).toBe(0);
    expect(await db.select().from(loginIpThrottle)).toHaveLength(1);
  });

  it("clears network locks when explicitly asked", async () => {
    await db.insert(loginIpThrottle).values({
      ip: "198.51.100.5",
      attemptCount: 0,
      windowStart: new Date(NOW).toISOString(),
      lockedUntil: new Date(NOW + 10 * 60000).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    });

    const result = await clearLockout(
      db, "u_locked", ADMIN, meta, { clearNetworkLocks: true }, NOW,
    );
    expect(result.networkLocksCleared).toBe(1);
    expect(await db.select().from(loginIpThrottle)).toHaveLength(0);
  });

  it("does not count a lock that has already expired", async () => {
    await db.insert(loginIpThrottle).values({
      ip: "198.51.100.6",
      attemptCount: 0,
      windowStart: new Date(NOW - 3600_000).toISOString(),
      lockedUntil: new Date(NOW - 60_000).toISOString(), // already lapsed
      updatedAt: new Date(NOW).toISOString(),
    });

    const result = await clearLockout(db, "u_locked", ADMIN, meta, {}, NOW);
    expect(result.networkLocksActive).toBe(0);
  });
});

describe("audit trail", () => {
  it("records each account action", async () => {
    await changePassword(
      db,
      { userId: "u_admin", currentPassword: "original-password", newPassword: "a-much-better-password", ...meta },
      NOW,
    );
    await forceLogoutUser(db, "u_editor", ADMIN, meta);
    await clearLockout(db, "u_locked", ADMIN, meta, {}, NOW);

    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toContain("Password changed (self-service)");
    expect(actions).toContain("Force logout: arjun");
    expect(actions).toContain("Clear lockout: vikram");
  });
});

describe("user id validation", () => {
  it("rejects anything outside the id format", () => {
    // These become path segments and query parameters; the old server
    // validated ids on every save for the same reason.
    for (const bad of ["", "../etc", "a b", "x".repeat(65), "id;drop"]) {
      expect(() => assertUserId(bad)).toThrow();
    }
    expect(assertUserId("u_admin")).toBe("u_admin");
  });
});
