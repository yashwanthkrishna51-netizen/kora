import crypto from "node:crypto";

/**
 * PKCE (RFC 7636), S256.
 *
 * The old flow had none. For a confidential client sending a `client_secret`,
 * PKCE is not strictly required — but it is what makes an intercepted
 * authorization code useless on its own, and the code is the part that travels
 * back through the user's browser and lands in history, referrer headers and
 * any proxy in between. It costs two hashes.
 *
 * PKCE is additive here, not a replacement: the token request sends the
 * verifier AND the client secret, which is what Entra expects from a Web
 * platform registration.
 */

const b64url = (b: Buffer) => b.toString("base64url");

/** 32 bytes -> 43 base64url characters, inside RFC 7636's 43-128 range. */
export function createVerifier(): string {
  return b64url(crypto.randomBytes(32));
}

export function challengeFor(verifier: string): string {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

/** The value that binds a callback to the browser that started it. */
export function newNonce(): string {
  return b64url(crypto.randomBytes(32));
}

/**
 * Constant-time nonce comparison.
 *
 * The nonce arrives attacker-controlled on the way back in, so its length is
 * attacker-controlled too, and `timingSafeEqual` throws RangeError on
 * mismatched lengths. Hashing both sides makes them 32 bytes by construction —
 * the same reasoning as the cron secret and the token signature.
 */
export function nonceMatches(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
