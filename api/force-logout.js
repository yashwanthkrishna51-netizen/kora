// api/force-logout.js — admin-only. Bumping a user's token_version instantly
// invalidates every token they currently hold (they'll be logged out next time
// any of their tabs/devices makes a request), without needing to touch the
// shared signing secret or affect anyone else.
//
// POST body: { scope: 'all' } to force-logout everyone, or { scope: 'user', userId }
// for a single user.

const { validateToken } = require('./_auth');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
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
  // Role is read fresh from the DB inside validateToken, not trusted from the
  // token itself — a demoted admin can't use a stale token to force-logout others.
  if (check.payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { scope, userId } = req.body || {};
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };

  try {
    if (scope === 'all') {
      // Supabase PostgREST can't do "column = column + 1" in a single PATCH body,
      // so fetch current versions and bump each — fine at this scale (an internal
      // tool's user count), not something to optimize prematurely.
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
      return res.status(200).json({ ok: true, affected: users.length });
    }

    if (scope === 'user' && userId) {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/users?id=eq.${encodeURIComponent(userId)}&select=token_version`,
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
      return res.status(200).json({ ok: true, affected: 1 });
    }

    return res.status(400).json({ error: "scope must be 'all' or 'user' (with userId)" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};