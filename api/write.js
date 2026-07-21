// api/write.js — Supabase version
// Replaces the GitHub-backed write after migration.
// No SHA needed — no conflicts possible. Last write wins per row.
// Frontend interface unchanged: POST with { path, content, sha, message }
// sha is accepted but ignored.

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  const token = req.headers['x-session-token'];
  if (!isValidToken(token, INTEGTRACK_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { path, content } = req.body || {};
  if (!path || content === undefined) {
    return res.status(400).json({ error: 'path and content required' });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates',
  };

  // Content comes as a JSON string from the frontend
  let data;
  try {
    data = typeof content === 'string' ? JSON.parse(content) : content;
  } catch (err) {
    return res.status(400).json({ error: 'content must be valid JSON' });
  }

  try {
    if (path === 'data/clients.json') {
      const rows = data.map(c => ({
        id: c.id,
        name: c.name,
        description: c.description || '',
        created_at: c.createdAt || new Date().toISOString(),
        integrations: c.integrations || [],
        modules: c.modules !== undefined ? c.modules : null,
        work_log: c.workLog !== undefined ? c.workLog : null,
        man_day_rate: c.manDayRate || null,
        total_available_hours: c.totalAvailableHours || null,
        currency: c.currency || 'INR',
      }));

      // Upsert all rows from the frontend
      if (rows.length > 0) {
        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify(rows),
        });
        if (!upsertRes.ok) {
          const e = await upsertRes.json();
          return res.status(upsertRes.status).json({ error: e.message || 'Supabase upsert error' });
        }
      }

      // Delete any rows that are no longer in the frontend array
      // (handles client deletion)
      const newIds = rows.map(r => r.id);
      if (newIds.length > 0) {
        // Delete where id not in the new set
        const idList = newIds.map(id => `"${id}"`).join(',');
        await fetch(
          `${SUPABASE_URL}/rest/v1/clients?id=not.in.(${idList})`,
          { method: 'DELETE', headers: { ...sbHeaders, Prefer: '' } }
        );
      } else {
        // All clients deleted — delete everything
        await fetch(
          `${SUPABASE_URL}/rest/v1/clients?id=neq.""`,
          { method: 'DELETE', headers: { ...sbHeaders, Prefer: '' } }
        );
      }

      return res.status(200).json({ sha: 'supabase' });
    }

    if (path === 'data/users.json') {
      const rows = data.map(u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email || '',
        role: u.role,
        password_hash: u.passwordHash,
        created_at: u.createdAt || new Date().toISOString(),
      }));

      if (rows.length > 0) {
        const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify(rows),
        });
        if (!upsertRes.ok) {
          const e = await upsertRes.json();
          return res.status(upsertRes.status).json({ error: e.message || 'Supabase upsert error' });
        }
      }

      // Delete removed users
      const newIds = rows.map(r => r.id);
      if (newIds.length > 0) {
        const idList = newIds.map(id => `"${id}"`).join(',');
        await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=not.in.(${idList})`,
          { method: 'DELETE', headers: { ...sbHeaders, Prefer: '' } }
        );
      }

      return res.status(200).json({ sha: 'supabase' });
    }

    return res.status(404).json({ error: `Unknown path: ${path}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
