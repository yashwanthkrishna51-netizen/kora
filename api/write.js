// api/write.js — Supabase version
// Replaces the GitHub-backed write after migration.
// No SHA needed — no conflicts possible. Last write wins per row.
// Frontend interface unchanged: POST with { path, content, sha, message }
// sha is accepted but ignored.

const bcrypt = require('bcryptjs');
const { validateToken } = require('./_auth');
const { logAudit, clientIp } = require('./_audit');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  const token = req.headers['x-session-token'];
  const check = await validateToken(token, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!check.valid) {
    return res.status(401).json({ error: 'Unauthorized', reason: check.reason });
  }

  const { path, content, message, screen } = req.body || {};
  if (!path || content === undefined) {
    return res.status(400).json({ error: 'path and content required' });
  }

  // Server-side role enforcement — mirrors the UI's permission model instead
  // of just trusting the UI to hide buttons. Before this, any authenticated
  // user of ANY role (including viewer) could write anything by calling this
  // endpoint directly, bypassing the frontend entirely.
  //   - viewers can never write anything
  //   - only admins can write users.json (user management is admin-only in the UI)
  //   - editors and admins can write clients.json
  if (check.payload.role === 'viewer') {
    return res.status(403).json({ error: 'Viewers cannot make changes' });
  }
  if (path === 'data/users.json' && check.payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const auditBase = {
    actorId: check.payload.id,
    username: check.payload.username,
    role: check.payload.role,
    screen: screen || null,
    ip: clientIp(req),
    userAgent: req.headers['user-agent'],
  };

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

      await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
        ...auditBase,
        action: message || 'Update clients',
        entity: 'clients',
      });

      return res.status(200).json({ sha: 'supabase' });
    }

    if (path === 'data/users.json') {
      // Each incoming user row has EITHER:
      //   - a plaintext `password` field (this user's password is being set/changed
      //     right now) — must be bcrypt-hashed here, server-side, never trust a
      //     client-computed hash
      //   - or an existing `passwordHash` field (untouched from a previous read,
      //     already hashed in whatever scheme it's currently in) — passed through
      //     as-is, not re-hashed
      const rows = await Promise.all(data.map(async u => ({
        id: u.id,
        username: u.username,
        name: u.name,
        email: u.email || '',
        role: u.role,
        password_hash: u.password ? await bcrypt.hash(u.password, 10) : u.passwordHash,
        created_at: u.createdAt || new Date().toISOString(),
      })));

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

      await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
        ...auditBase,
        action: message || 'Update users',
        entity: 'users',
      });

      return res.status(200).json({ sha: 'supabase' });
    }

    return res.status(404).json({ error: `Unknown path: ${path}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};