// api/read.js — reads clients/users from Supabase Postgres.
// Response shape (content: base64(json), sha: 'supabase') is a holdover from
// this project's pre-Supabase, GitHub-Contents-API-backed version — kept
// as-is so the frontend never needed to change when the backend migrated.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { refreshAttachmentUrls } = require('./_storage');
const { serverError } = require('./_errors');

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
      if (!r.ok) {
        return res.status(500).json({ error: 'Failed to read clients' });
      }
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
        if (row.master_assignee) c.masterAssignee = row.master_assignee;
        c._v = row.updated_at;
        return c;
      });

      // Every attachment.url in phase updates was signed with a fresh,
      // short-lived URL at whatever time it was last read/saved — regenerate
      // fresh ones now so nothing served to the client is ever expired.
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        await refreshAttachmentUrls(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clients);
      }

      const content = Buffer.from(JSON.stringify(clients)).toString('base64');
      return res.status(200).json({ content, sha: 'supabase' });
    }

    if (path === 'data/users.json') {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=*&order=username.asc`,
        { headers: sbHeaders }
      );
      if (!r.ok) {
        return res.status(500).json({ error: 'Failed to read users' });
      }
      const rows = await r.json();

      const isAdmin = check.payload.role === 'admin';
      const users = rows.map(row => isAdmin ? {
        id: row.id,
        username: row.username,
        name: row.name,
        email: row.email || '',
        role: row.role,
        createdAt: row.created_at,
        lockedUntil: row.locked_until,
        failedAttempts: row.failed_attempts || 0,
        lockoutLevel: row.lockout_level || 0,
        _v: row.updated_at,
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
    return serverError(res, err, 'read.js');
  }
};