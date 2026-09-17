// api/account.js — merges change-password.js, clear-lockout.js, and
// force-logout.js into one file. Same fix as auth-microsoft.js (3 files ->
// 1) for the same reason: Vercel Hobby plan caps a deployment at 12
// Serverless Functions, and this app had no spare room left after adding
// Microsoft SSO. Dispatched by `action` in the POST body instead of by
// URL, since all 3 were already POST-only. No behavior changed from the
// original 3 files — same validation, same audit log entries, same
// responses, just reorganized into one file with a shared auth check at
// the top instead of 3 copies of the same validateToken() call.
//
//   POST /api/account { action: 'change-password', currentPassword, newPassword?, email? }  -> any authenticated user, self-service
//   POST /api/account { action: 'clear-lockout', userId }                                    -> admin only
//   POST /api/account { action: 'force-logout', scope: 'all' | 'user', userId? }              -> admin only

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { validateToken, signToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { logAudit, clientIp } = require('./_audit');
const { assertPassword } = require('./_validate');
const { serverError } = require('./_errors');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const BCRYPT_COST = 12; // L-5: raised from 10, matches write.js/login.js

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

  const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  const { action } = req.body || {};

  if (action === 'change-password') return handleChangePassword(req, res, check, env, INTEGTRACK_SECRET);
  if (action === 'clear-lockout') return handleClearLockout(req, res, check, env);
  if (action === 'force-logout') return handleForceLogout(req, res, check, env);
  return res.status(400).json({ error: "action must be 'change-password', 'clear-lockout', or 'force-logout'" });
};

// ── change-password: self-service, any authenticated user ──
// Verifies current password server-side (dual-scheme, same as login.js),
// always bcrypt-hashes any new password. On password change, bumps
// token_version (logs out every OTHER active session immediately) and
// issues a fresh token so THIS session keeps working without a re-login.
async function handleChangePassword(req, res, check, env, INTEGTRACK_SECRET) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { currentPassword, newPassword, email } = req.body || {};
  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required' });
  }
  if (newPassword) {
    try {
      assertPassword(newPassword);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
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
      update.password_hash = await bcrypt.hash(newPassword, BCRYPT_COST);
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

    await logAudit(env, {
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
    return serverError(res, err, 'account.js (change-password)');
  }
}

// ── clear-lockout: admin-only escape hatch for the login rate-limiter ──
async function handleClearLockout(req, res, check, env) {
  if (check.payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify({ failed_attempts: 0, lockout_level: 0, locked_until: null }),
    });
    if (!r.ok) return res.status(500).json({ error: 'Failed to clear lockout' });
    const rows = await r.json();
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    await logAudit(env, {
      actorId: check.payload.id,
      username: check.payload.username,
      role: check.payload.role,
      action: `Clear lockout: ${rows[0].username}`,
      entity: 'users',
      screen: 'admin',
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return serverError(res, err, 'account.js (clear-lockout)');
  }
}

// ── force-logout: admin-only. Bumping token_version instantly invalidates
// every token a user currently holds, without touching the shared signing
// secret or affecting anyone else. ──
async function handleForceLogout(req, res, check, env) {
  if (check.payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { scope, userId } = req.body || {};
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  try {
    if (scope === 'all') {
      // Supabase PostgREST can't do "column = column + 1" in a single PATCH
      // body, so fetch current versions and bump each — fine at this scale
      // (an internal tool's user count), not something to optimize prematurely.
      const r = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,token_version`, { headers: sbHeaders });
      if (!r.ok) return res.status(500).json({ error: 'Failed to read users' });
      const users = await r.json();
      await Promise.all(
        users.map(u =>
          fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(u.id)}`, {
            method: 'PATCH',
            headers: sbHeaders,
            body: JSON.stringify({ token_version: (u.token_version || 0) + 1 }),
          })
        )
      );
      await logAudit(env, {
        actorId: check.payload.id, username: check.payload.username, role: check.payload.role,
        action: `Force logout: all users (${users.length})`, entity: 'session', screen: 'admin',
        ip: clientIp(req), userAgent: req.headers['user-agent'],
      });
      return res.status(200).json({ ok: true, affected: users.length });
    }

    if (scope === 'user' && userId) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=token_version,username`,
        { headers: sbHeaders }
      );
      if (!r.ok) return res.status(500).json({ error: 'Failed to read user' });
      const rows = await r.json();
      if (!rows.length) return res.status(404).json({ error: 'User not found' });
      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify({ token_version: (rows[0].token_version || 0) + 1 }),
      });
      await logAudit(env, {
        actorId: check.payload.id, username: check.payload.username, role: check.payload.role,
        action: `Force logout: ${rows[0].username}`, entity: 'session', screen: 'admin',
        ip: clientIp(req), userAgent: req.headers['user-agent'],
      });
      return res.status(200).json({ ok: true, affected: 1 });
    }

    return res.status(400).json({ error: "scope must be 'all' or 'user' (with userId)" });
  } catch (err) {
    return serverError(res, err, 'account.js (force-logout)');
  }
}