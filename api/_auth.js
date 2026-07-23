// api/_auth.js — shared token validation, used by read.js, write.js, upload.js
// Consolidates what used to be three duplicated copies of isValidToken.
// Now also checks: token expiry (exp claim) and per-user token_version
// (lets an admin force-logout one user, or everyone, by bumping token_version —
// any previously issued token instantly stops working since its embedded
// version no longer matches).

const crypto = require('crypto');

function verifySignature(token, secret) {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig.length === expected.length ? sig : expected, 'hex');
  if (!crypto.timingSafeEqual(a, b) || sig.length !== expected.length) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch {
    return null;
  }
}

function signToken(payload, secret) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

// Full validation: signature -> not expired -> token_version still current (not revoked).
// Returns the payload (with an added `_reason` on failure set to null) or null if invalid.
// A Supabase lookup is required for the token_version check, so this is async and needs
// the Supabase connection details passed in.
async function validateToken(token, secret, supabaseUrl, supabaseKey) {
  const payload = verifySignature(token, secret);
  if (!payload) return { valid: false, reason: 'bad_signature' };

  if (typeof payload.exp === 'number' && Date.now() > payload.exp) {
    return { valid: false, reason: 'expired' };
  }

  // Confirm the token's embedded version still matches the user's current version.
  // This is what makes force-logout (single user or everyone) actually work.
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(payload.id)}&select=token_version,role`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );
    if (!r.ok) return { valid: false, reason: 'lookup_failed' };
    const rows = await r.json();
    if (!rows.length) return { valid: false, reason: 'user_not_found' };
    const current = rows[0];
    if ((current.token_version || 0) !== (payload.tokenVersion || 0)) {
      return { valid: false, reason: 'revoked' };
    }
    // Always use the freshly-fetched role, never the one embedded in the token —
    // if an admin changes someone's role, that change must take effect immediately,
    // not whenever their token happens to expire.
    return { valid: true, payload: { ...payload, role: current.role } };
  } catch (err) {
    return { valid: false, reason: 'lookup_error' };
  }
}

module.exports = { verifySignature, signToken, validateToken };