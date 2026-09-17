// api/login.js — Supabase version, with security hardening:
//   - Passwords are verified server-side with bcrypt
//   - Existing users with old SHA-256 hashes are lazily migrated to bcrypt on
//     their next successful login — no forced password reset needed
//   - Escalating lockout after repeated failed attempts, per-username
//   - NEW (M-5 fix): a second, independent IP-based throttle — see
//     api/_throttle.js. Per-username lockout alone let an unauthenticated
//     attacker lock out every account (including all admins) by
//     deliberately failing 5 attempts against each username in turn.
//   - NEW (M-5 fix): a dummy bcrypt.compare runs for unknown usernames too,
//     so response timing no longer reveals whether a username exists.
//   - Tokens expire after 7 days and embed a token_version for revocation
//   - L-1 fix: generic error responses, real error logged server-side only.

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { signToken } = require('./_auth');
const { logAudit, clientIp } = require('./_audit');
const { applyCors } = require('./_cors');
const { checkIpThrottle, recordIpFailure } = require('./_throttle');
const { serverError } = require('./_errors');

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS_BEFORE_LOCK = 5;
const LOCKOUT_MINUTES = [30, 240, 1440]; // 30 min -> 4 hr -> 24 hr (repeats at 24hr after this)
const BCRYPT_COST = 12; // L-5: raised from 10

// M-5 fix: a fixed, precomputed bcrypt hash (cost 12, matching BCRYPT_COST)
// used only to give an "unknown username" request roughly the same bcrypt
// verification cost as a real "wrong password" request — otherwise the two
// cases are distinguishable by response time even when the JSON body and
// status code are identical.
const DUMMY_HASH = '$2b$12$qs9g9NfuP.AOlgY5K24XsekwE.GxJ5.99rmHJDYy9O1ZIlKjBS/Pa';

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

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  const ip = clientIp(req), userAgent = req.headers['user-agent'];

  // M-5 fix: IP-axis check happens BEFORE any DB lookup or bcrypt work — a
  // throttled IP gets an instant, cheap rejection instead of triggering a
  // full username lookup + password verification every time.
  const throttle = await checkIpThrottle(env, ip);
  if (throttle.locked) {
    return res.status(429).json({
      error: `Too many attempts from your network. Try again in ${throttle.remainingMin} minute${throttle.remainingMin !== 1 ? 's' : ''}.`,
    });
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

    const INVALID = { error: 'Invalid username or password' };

    if (!rows.length) {
      // M-5 fix: run a dummy bcrypt comparison so this path takes roughly
      // the same time as the "wrong password" path below — otherwise an
      // attacker can tell known from unknown usernames purely from timing,
      // even though both return the same 401 body.
      await bcrypt.compare(password, DUMMY_HASH);
      await logAudit(env, { username, action: 'Login failed: unknown user', entity: 'session', screen: 'login', ip, userAgent });
      await recordIpFailure(env, ip, throttle.row);
      return res.status(401).json(INVALID);
    }

    const user = rows[0];

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const remainingMs = new Date(user.locked_until).getTime() - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      await logAudit(env, { username, action: `Login failed: locked out (${remainingMin}min left)`, entity: 'session', screen: 'login', ip, userAgent });
      await recordIpFailure(env, ip, throttle.row);
      return res.status(423).json({
        error: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin !== 1 ? 's' : ''}.`,
        lockedUntil: user.locked_until,
      });
    }

    let passwordOk = false;
    let needsRehash = false;

    if (isBcryptHash(user.password_hash)) {
      passwordOk = await bcrypt.compare(password, user.password_hash);
    } else {
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
        update.failed_attempts = 0;
      }

      await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: sbHeaders,
        body: JSON.stringify(update),
      });

      await logAudit(env, { username, action: 'Login failed: wrong password', entity: 'session', screen: 'login', ip, userAgent });
      await recordIpFailure(env, ip, throttle.row);
      return res.status(401).json(INVALID);
    }

    // --- Success: reset attempt/lockout state, lazily migrate hash if needed ---
    const successUpdate = { failed_attempts: 0, lockout_level: 0, locked_until: null };
    if (needsRehash) {
      successUpdate.password_hash = await bcrypt.hash(password, BCRYPT_COST);
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
    return serverError(res, err, 'login.js');
  }
};