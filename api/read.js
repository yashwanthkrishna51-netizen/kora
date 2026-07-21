// api/read.js — Supabase version
// Replaces the GitHub-backed read after migration.
// Returns same interface as before: { content: base64(json), sha: 'supabase' }
// Frontend needs zero changes.

const crypto = require('crypto');

function isValidToken(token, secret) {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig.length === expected.length ? sig : expected, 'hex');
  return crypto.timingSafeEqual(a, b) && sig.length === expected.length;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  const token = req.headers['x-session-token'];
  if (!isValidToken(token, INTEGTRACK_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const path = req.query.path;
  if (!path) return res.status(400).json({ error: 'path query param required' });

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    if (path === 'data/clients.json') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?select=*&order=name.asc`,
        { headers: sbHeaders }
      );
      if (!r.ok) return res.status(r.status).json({ error: 'Supabase read error' });
      const rows = await r.json();

      // Reconstruct client objects matching old format exactly
      const clients = rows.map(row => {
        const c = {
          id: row.id,
          name: row.name,
          description: row.description || '',
          createdAt: row.created_at,
          integrations: row.integrations || [],
        };
        // Optional sections — only add if they exist (same sentinel pattern as before)
        if (row.modules !== null && row.modules !== undefined) c.modules = row.modules;
        if (row.work_log !== null && row.work_log !== undefined) c.workLog = row.work_log;
        if (row.man_day_rate !== null) c.manDayRate = row.man_day_rate;
        if (row.total_available_hours !== null) c.totalAvailableHours = row.total_available_hours;
        if (row.currency) c.currency = row.currency;
        return c;
      });

      const content = Buffer.from(JSON.stringify(clients)).toString('base64');
      return res.status(200).json({ content, sha: 'supabase' });
    }

    if (path === 'data/users.json') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=*&order=username.asc`,
        { headers: sbHeaders }
      );
      if (!r.ok) return res.status(r.status).json({ error: 'Supabase read error' });
      const rows = await r.json();

      const users = rows.map(row => ({
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email || '',
        role: row.role,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
      }));

      const content = Buffer.from(JSON.stringify(users)).toString('base64');
      return res.status(200).json({ content, sha: 'supabase' });
    }

    return res.status(404).json({ error: `Unknown path: ${path}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
