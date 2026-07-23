// api/login.js — Supabase version, with security hardening:
//   - Passwords are verified server-side with bcrypt (client sends plaintext over HTTPS,
//     never a hash — eliminates the old pass-the-hash issue where the hash itself was
//     a usable credential)
//   - Existing users with old SHA-256 hashes are lazily migrated to bcrypt on their next
//     successful login — no forced password reset needed
//   - Escalating lockout after repeated failed attempts (see LOCKOUT_MINUTES below)
//   - Tokens expire after 7 days and embed a token_version for revocation

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { signToken } = require('./_auth');
const { logAudit, clientIp } = require('./_audit');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
// Escalating lockout duration in minutes, indexed by lockout_level (0-indexed).
// Caps at the last entry — does not escalate indefinitely.
const LOCKOUT_MINUTES = [30, 240, 1440]; // 30 min -> 4 hr -> 24 hr (repeats at 24hr after this)

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function isBcryptHash(hash) {
  return typeof hash === 'string' && /^\$2[aby]\$/.test(hash);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: missing env vars' });
  }

  // NOTE: field is `password` (plaintext), not `passwordHash`. The client no longer
  // hashes anything — that responsibility now lives entirely on the server.
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&select=*&limit=1`,
      { headers: sbHeaders }
    );
    if (!r.ok) return res.status(500).json({ error: 'Database error' });
    const rows = await r.json();

    // Same generic error whether the username doesn't exist or the password is wrong —
    // avoids revealing which usernames are valid.
    const INVALID = { error: 'Invalid username or password' };
    const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
    const ip = clientIp(req), userAgent = req.headers['user-agent'];

    if (!rows.length) {
      await logAudit(env, { username, action: 'Login failed: unknown user', entity: 'session', screen: 'login', ip, userAgent });
      return res.status(401).json(INVALID);
    }

    const user = rows[0];

    // --- Lockout check, before touching the password at all ---
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const remainingMs = new Date(user.locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      await logAudit(env, { username, action: `Login failed: locked out (${remainingMin}min left)`, entity: 'session', screen: 'login', ip, userAgent });
      return res.status(423).json({
        error: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin !== 1 ? 's' : ''}.`,
        lockedUntil: user.locked_until,
      });
    }

    // --- Verify password (bcrypt, with lazy migration from legacy SHA-256) ---
    let passwordOk = false;
    let needsRehash = false;

    if (isBcryptHash(user.password_hash)) {
      passwordOk = await bcrypt.compare(password, user.password_hash);
    } else {
      // Legacy path: old hashes were unsalted SHA-256 computed over the plaintext password.
      passwordOk = sha256(password) === user.password_hash;
      if (passwordOk) needsRehash = true;
    }

    if (!passwordOk) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      const update = { failed_attempts: newAttempts };

      if (newAttempts >= MAX_ATTEMPTS_BEFORE_LOCK) {
        const level = user.lockout_level || 0;
        const minutes = LOCKOUT_MINUTES[Math.min(level, LOCKOUT_MINUTES.length - 1)];
        update.locked_until = new Date(Date.now() + minutes * 60000).toISOString();
        update.lockout_level = level + 1;
        update.failed_attempts = 0; // reset counter, the lockout itself is now the deterrent
      }

      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify(update),
      });

      await logAudit(env, { username, action: 'Login failed: wrong password', entity: 'session', screen: 'login', ip, userAgent });
      return res.status(401).json(INVALID);
    }

    // --- Success: reset attempt/lockout state, lazily migrate hash if needed ---
    const successUpdate = { failed_attempts: 0, lockout_level: 0, locked_until: null };
    if (needsRehash) {
      successUpdate.password_hash = await bcrypt.hash(password, 10);
    }
    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: sbHeaders,
      body: JSON.stringify(successUpdate),
    });

    const iat = Date.now();
    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.token_version || 0,
      iat,
      exp: iat + SEVEN_DAYS_MS,
    };
    const token = signToken(tokenPayload, INTEGTRACK_SECRET);

    await logAudit(env, { actorId: user.id, username: user.username, role: user.role, action: 'Login success', entity: 'session', screen: 'login', ip, userAgent });

    const userOut = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email || '',
      role: user.role,
    };

    return res.status(200).json({ token, user: userOut, usersSha: 'supabase' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};