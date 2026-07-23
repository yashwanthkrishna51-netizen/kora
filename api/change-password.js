// api/change-password.js — dedicated self-service "change my own password /
// email" endpoint.
//
// Replaces the previous approach (js/events.js my-profile handler doing a
// client-side sha256 compare against passwordHash). That was broken two
// ways: (1) it could never succeed for anyone already migrated to bcrypt,
// since a bcrypt hash can never equal a client-computed sha256 hash, and
// (2) worse, it would silently WRITE a new client-computed sha256 hash
// straight into passwordHash on any password change — quietly downgrading
// a properly-migrated bcrypt user back to the weak legacy scheme.
//
// This endpoint verifies the current password server-side, supporting BOTH
// legacy sha256 and current bcrypt (same dual-scheme check as login.js), and
// always bcrypt-hashes any new password. On password change, it also bumps
// token_version — every OTHER active session (other device/tab) is logged
// out immediately — and issues a fresh token so the current session keeps
// working without forcing a re-login.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateToken, signToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { logAudit, clientIp } = require('./_audit');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}
function isBcryptHash(hash) {
  return typeof hash === 'string' && /^\$2[aby]\$/.test(hash);
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: missing env vars' });
  }

  const token = req.headers['x-session-token'];
  const check = await validateToken(token, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!check.valid) {
    return res.status(401).json({ error: 'Unauthorized', reason: check.reason });
  }

  const { currentPassword, newPassword, email } = req.body || {};
  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required' });
  }
  if (newPassword && newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(check.payload.id)}&select=*&limit=1`,
      { headers: sbHeaders }
    );
    if (!r.ok) return res.status(500).json({ error: 'Database error' });
    const rows = await r.json();
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    // Verify current password — same dual-scheme check as login.js, so this
    // works whether the user's hash has been migrated to bcrypt yet or not.
    const passwordOk = isBcryptHash(user.password_hash)
      ? await bcrypt.compare(currentPassword, user.password_hash)
      : sha256(currentPassword) === user.password_hash;

    if (!passwordOk) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const update = {};
    if (typeof email === 'string') update.email = email.trim();

    const passwordChanged = !!newPassword;
    if (passwordChanged) {
      update.password_hash = await bcrypt.hash(newPassword, 10);
      // Bump token_version — invalidates every OTHER session immediately.
      // A fresh token is issued below so THIS session isn't logged out by it.
      update.token_version = (user.token_version || 0) + 1;
    }

    if (Object.keys(update).length > 0) {
      const upd = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify(update),
      });
      if (!upd.ok) return res.status(500).json({ error: 'Failed to save changes' });
    }

    await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
      actorId: user.id,
      username: user.username,
      role: user.role,
      action: passwordChanged ? 'Password changed (self-service)' : 'Profile updated (self-service)',
      entity: 'users',
      screen: 'my-profile',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });

    const newTokenVersion = update.token_version !== undefined ? update.token_version : (user.token_version || 0);
    const iat = Date.now();
    const newToken = signToken({
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: newTokenVersion,
      iat,
      exp: iat + SEVEN_DAYS_MS,
    }, INTEGTRACK_SECRET);

    return res.status(200).json({
      token: newToken,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: update.email !== undefined ? update.email : (user.email || ''),
        role: user.role,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};