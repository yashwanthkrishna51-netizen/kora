// api/read.js — Supabase version
// Replaces the GitHub-backed read after migration.
// Returns same interface as before: { content: base64(json), sha: 'supabase' }
// Frontend needs zero changes.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { refreshAttachmentUrls } = require('./_storage');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  const token = req.headers['x-session-token'];
  const check = await validateToken(token, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!check.valid) {
    return res.status(401).json({ error: 'Unauthorized', reason: check.reason });
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

      // Every attachment.url in phase updates was signed with a fresh,
      // short-lived URL at whatever time it was last read/saved — regenerate
      // fresh ones now so nothing served to the client is ever expired.
      await refreshAttachmentUrls(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clients);

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

      // Only admins get the full record (needed for the Admin > Users panel,
      // including passwordHash so it can be passed through unchanged on save).
      // Non-admins only need id/name/role/username for assignee dropdowns —
      // no email, no password hash, no created_at should ever reach them.
      const isAdmin = check.payload.role === 'admin';
      const users = rows.map(row => isAdmin ? {
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email || '',
        role: row.role,
        passwordHash: row.password_hash,
        createdAt: row.created_at,
        lockedUntil: row.locked_until,
        failedAttempts: row.failed_attempts || 0,
        lockoutLevel: row.lockout_level || 0,
      } : {
        id: row.id,
        username: row.username,
        name: row.name,
        role: row.role,
      });

      const content = Buffer.from(JSON.stringify(users)).toString('base64');
      return res.status(200).json({ content, sha: 'supabase' });
    }

    return res.status(404).json({ error: `Unknown path: ${path}` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};