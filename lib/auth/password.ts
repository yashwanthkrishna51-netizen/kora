import crypto from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Password verification and hashing.
 *
 * Ported from api/login.js. Two schemes are live in the production `users`
 * table: bcrypt (current) and a bare SHA-256 hex digest (original). Rather
 * than force a reset on everyone, a legacy hash is accepted once and
 * transparently upgraded on that user's next successful login.
 */

export const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * NOT A CREDENTIAL. A bcrypt hash of a value nobody knows, at production cost.
 *
 * It authenticates nothing: no password produces it, it is never stored on a
 * user, and it is only ever compared *against*. Its sole purpose is to burn
 * the same ~250ms a real verification costs when the username does not exist,
 * so that response timing cannot be used to enumerate accounts — both cases
 * return an identical 401, and without this they are trivially distinguishable
 * by a stopwatch.
 *
 * Kept as a constant deliberately. Generating one at startup would add a
 * bcrypt round to every cold start for no security benefit, since the value
 * being unknown is the only property that matters. Secret scanners flag the
 * shape; see .gitguardian.yaml.
 */
const DUMMY_HASH =
  "$2b$12$qs9g9NfuP.AOlgY5K24XsekwE.GxJ5.99rmHJDYy9O1ZIlKjBS/Pa";

export function isBcryptHash(hash: unknown): hash is string {
  return typeof hash === "string" && /^\$2[aby]\$/.test(hash);
}

function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

export interface VerifyResult {
  ok: boolean;
  /** True when a legacy SHA-256 hash matched and should be upgraded. */
  needsRehash: boolean;
}

export async function verifyPassword(
  plain: string,
  storedHash: string | null | undefined,
): Promise<VerifyResult> {
  if (!storedHash) {
    // No hash on the row at all — still burn the time, so this case is not
    // distinguishable from a wrong password either.
    await bcrypt.compare(plain, DUMMY_HASH);
    return { ok: false, needsRehash: false };
  }

  if (isBcryptHash(storedHash)) {
    return { ok: await bcrypt.compare(plain, storedHash), needsRehash: false };
  }

  // Legacy SHA-256. timingSafeEqual over the hex digests rather than `===`,
  // since both sides are fixed-length here and it costs nothing.
  const computed = sha256Hex(plain);
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(String(storedHash), "utf8");
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  return { ok, needsRehash: ok };
}

/** Equalises timing for a username that does not exist. */
export async function burnPasswordTime(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export class PasswordTooShortError extends Error {
  readonly statusCode = 400;
  constructor() {
    super(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    this.name = "PasswordTooShortError";
  }
}

export function assertPassword(pw: unknown): string {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordTooShortError();
  }
  return pw;
}
