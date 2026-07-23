// api/clear-lockout.js — admin-only escape hatch for the login rate-limiter.
// Resets failed_attempts, lockout_level, and locked_until on a user, letting
// them log in again immediately instead of waiting out the escalating lockout
// (30min -> 4hr -> 24hr). Useful if a real user trips it by accident.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { logAudit, clientIp } = require('./_audit');

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
  if (check.payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

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

    await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
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
    return res.status(500).json({ error: err.message });
  }
};