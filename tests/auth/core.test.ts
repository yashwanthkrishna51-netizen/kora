import { describe, it, expect } from "vitest";
import {
  signToken,
  verifyToken,
  isExpired,
  buildPayload,
  SEVEN_DAYS_MS,
} from "@/lib/auth/token";
import {
  verifyPassword,
  hashPassword,
  assertPassword,
  isBcryptHash,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/password";
import {
  checkLocked,
  registerFailure,
  clearedState,
  LOCKOUT_MINUTES,
  MAX_ATTEMPTS_BEFORE_LOCK,
} from "@/lib/auth/lockout";
import {
  nextThrottleState,
  MAX_ATTEMPTS_PER_WINDOW,
  WINDOW_MINUTES,
  LOCK_MINUTES,
} from "@/lib/auth/throttle";
import crypto from "node:crypto";

/**
 * Auth core.
 *
 * Written as the attack or failure each rule prevents, rather than as coverage
 * of the happy path — these are the parts where a subtle regression is silent
 * until someone goes looking for it.
 */

const SECRET = "test-secret-not-a-real-one";
const NOW = 1_800_000_000_000;

const user = { id: "u1", username: "meera", role: "admin", tokenVersion: 3 };

describe("token", () => {
  it("round-trips a payload", () => {
    const payload = buildPayload(user, NOW);
    const decoded = verifyToken(signToken(payload, SECRET), SECRET);
    expect(decoded).toEqual(payload);
    expect(decoded!.exp - decoded!.iat).toBe(SEVEN_DAYS_MS);
  });

  it("rejects a token signed with a different secret", () => {
    const token = signToken(buildPayload(user, NOW), SECRET);
    expect(verifyToken(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered payload", () => {
    // Escalate the role and re-encode, keeping the original signature.
    const payload = buildPayload(user, NOW);
    const token = signToken(payload, SECRET);
    const [, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...payload, role: "admin", id: "someone-else" }),
    ).toString("base64url");
    expect(verifyToken(`${forged}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects a flipped signature", () => {
    const token = signToken(buildPayload(user, NOW), SECRET);
    const [b64, sig] = token.split(".");
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    expect(verifyToken(`${b64}.${flipped}`, SECRET)).toBeNull();
  });

  it("RETURNS NULL, never throws, on a non-hex signature", () => {
    // The regression this guards: Buffer.from(sig, "hex") silently yields a
    // short buffer for non-hex input, and timingSafeEqual throws RangeError on
    // unequal lengths. Without the pre-check that threw uncaught inside every
    // endpoint, so an unauthenticated caller could force a 500 at will.
    const b64 = Buffer.from(JSON.stringify(buildPayload(user, NOW))).toString(
      "base64url",
    );
    for (const bad of [
      "zzzz",
      "!".repeat(64),
      "g".repeat(64), // right length, not hex
      "abc",
      "",
      "0".repeat(63),
      "0".repeat(65),
    ]) {
      expect(() => verifyToken(`${b64}.${bad}`, SECRET)).not.toThrow();
      expect(verifyToken(`${b64}.${bad}`, SECRET)).toBeNull();
    }
  });

  it("rejects structurally broken tokens without throwing", () => {
    for (const bad of ["", "nodot", ".", "..", "a.b.c", "%%%.%%%"]) {
      expect(() => verifyToken(bad, SECRET)).not.toThrow();
      expect(verifyToken(bad, SECRET)).toBeNull();
    }
    expect(verifyToken(null, SECRET)).toBeNull();
    expect(verifyToken("x.y", null)).toBeNull();
  });

  it("rejects a correctly-signed but structurally wrong payload", () => {
    // Fails closed rather than letting undefined fields flow onward.
    const b64 = Buffer.from(JSON.stringify({ hello: "world" })).toString(
      "base64url",
    );
    const sig = crypto.createHmac("sha256", SECRET).update(b64).digest("hex");
    expect(verifyToken(`${b64}.${sig}`, SECRET)).toBeNull();
  });

  it("detects expiry at the boundary", () => {
    const payload = buildPayload(user, NOW);
    expect(isExpired(payload, payload.exp - 1)).toBe(false);
    expect(isExpired(payload, payload.exp)).toBe(false);
    expect(isExpired(payload, payload.exp + 1)).toBe(true);
  });

  it("carries tokenVersion, which is what makes revocation work", () => {
    const decoded = verifyToken(signToken(buildPayload(user, NOW), SECRET), SECRET);
    expect(decoded!.tokenVersion).toBe(3);
  });
});

describe("password", () => {
  it("verifies a bcrypt hash and does not ask for a rehash", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(isBcryptHash(hash)).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toEqual({
      ok: true,
      needsRehash: false,
    });
    expect((await verifyPassword("wrong", hash)).ok).toBe(false);
  });

  it("accepts a legacy SHA-256 hash and flags it for upgrade", async () => {
    // Real production rows still carry these; forcing a reset on everyone was
    // never acceptable, so they are upgraded on next successful login instead.
    const legacy = crypto.createHash("sha256").update("oldpassword").digest("hex");
    expect(isBcryptHash(legacy)).toBe(false);
    expect(await verifyPassword("oldpassword", legacy)).toEqual({
      ok: true,
      needsRehash: true,
    });
  });

  it("rejects a wrong password against a legacy hash", async () => {
    const legacy = crypto.createHash("sha256").update("oldpassword").digest("hex");
    expect(await verifyPassword("nope", legacy)).toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it("fails closed when the row has no hash at all", async () => {
    expect(await verifyPassword("anything", null)).toEqual({
      ok: false,
      needsRehash: false,
    });
    expect(await verifyPassword("anything", "")).toEqual({
      ok: false,
      needsRehash: false,
    });
  });

  it("enforces the minimum length", () => {
    expect(() => assertPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toThrow();
    expect(assertPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeTruthy();
    expect(() => assertPassword(12345678 as never)).toThrow();
    expect(() => assertPassword(undefined)).toThrow();
  });
});

describe("username lockout", () => {
  it("counts failures without locking below the threshold", () => {
    for (let attempts = 0; attempts < MAX_ATTEMPTS_BEFORE_LOCK - 1; attempts++) {
      const u = registerFailure({ failedAttempts: attempts, lockoutLevel: 0 }, NOW);
      expect(u.failed_attempts).toBe(attempts + 1);
      expect(u.locked_until).toBeUndefined();
    }
  });

  it("locks on the fifth failure for 30 minutes", () => {
    const u = registerFailure({ failedAttempts: 4, lockoutLevel: 0 }, NOW);
    expect(u.failed_attempts).toBe(0); // counter resets; the LEVEL escalates
    expect(u.lockout_level).toBe(1);
    expect(new Date(u.locked_until!).getTime()).toBe(NOW + 30 * 60000);
  });

  it("escalates 30m -> 4h -> 24h and then stays at 24h", () => {
    const minutes = [0, 1, 2, 3, 7].map(
      (level) =>
        (new Date(
          registerFailure({ failedAttempts: 4, lockoutLevel: level }, NOW)
            .locked_until!,
        ).getTime() -
          NOW) /
        60000,
    );
    expect(minutes).toEqual([
      LOCKOUT_MINUTES[0],
      LOCKOUT_MINUTES[1],
      LOCKOUT_MINUTES[2],
      LOCKOUT_MINUTES[2],
      LOCKOUT_MINUTES[2],
    ]);
  });

  it("reports remaining time while locked, and releases on expiry", () => {
    const until = new Date(NOW + 90 * 60000).toISOString();
    expect(checkLocked({ lockedUntil: until }, NOW)).toMatchObject({
      locked: true,
      remainingMin: 90,
    });
    expect(checkLocked({ lockedUntil: until }, NOW + 91 * 60000).locked).toBe(false);
    expect(checkLocked({ lockedUntil: null }, NOW).locked).toBe(false);
    // A malformed timestamp must not lock anybody out forever.
    expect(checkLocked({ lockedUntil: "not-a-date" }, NOW).locked).toBe(false);
  });

  it("clears everything on success", () => {
    expect(clearedState()).toEqual({
      failed_attempts: 0,
      lockout_level: 0,
      locked_until: null,
    });
  });
});

describe("per-IP throttle", () => {
  const iso = (ms: number) => new Date(ms).toISOString();

  it("starts a window on the first failure", () => {
    const s = nextThrottleState(null, NOW);
    expect(s).toEqual({
      attemptCount: 1,
      windowStart: iso(NOW),
      lockedUntil: null,
    });
  });

  it("increments within the window, keeping the original window start", () => {
    const start = iso(NOW);
    const s = nextThrottleState(
      { attemptCount: 4, windowStart: start },
      NOW + 5 * 60000,
    );
    expect(s.attemptCount).toBe(5);
    expect(s.windowStart).toBe(start);
  });

  it("starts a fresh window once the old one has elapsed", () => {
    // Otherwise a slow attacker accumulates forever and eventually trips the
    // lock on wholly unrelated attempts weeks apart.
    const later = NOW + (WINDOW_MINUTES + 1) * 60000;
    const s = nextThrottleState({ attemptCount: 19, windowStart: iso(NOW) }, later);
    expect(s.attemptCount).toBe(1);
    expect(s.windowStart).toBe(iso(later));
  });

  it("locks on the 20th attempt and resets the counter", () => {
    const s = nextThrottleState(
      { attemptCount: MAX_ATTEMPTS_PER_WINDOW - 1, windowStart: iso(NOW) },
      NOW,
    );
    expect(s.lockedUntil).toBe(iso(NOW + LOCK_MINUTES * 60000));
    expect(s.attemptCount).toBe(0);
    expect(s.windowStart).toBe(iso(NOW));
  });

  it("treats a corrupt window_start as the start of a new window", () => {
    const s = nextThrottleState({ attemptCount: 9, windowStart: "garbage" }, NOW);
    expect(s.attemptCount).toBe(1);
  });
});
