// api/audit.js — admin-only read/filter/export for the audit_log table.
// GET only. Query params:
//   from, to      ISO date strings, inclusive range on ts
//   user          exact username filter
//   q             free-text search against action (case-insensitive substring)
//   limit, offset pagination (ignored when export=1)
//   export        '1' -> returns up to 5000 matching rows, unpaginated, for client-side download

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');

const EXPORT_CAP = 5000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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
  // Audit log is admin-only — anyone else, even editors, is refused.
  if (check.payload.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  const { from, to, user, q, export: doExport } = req.query;
  let limit = Math.min(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  let offset = parseInt(req.query.offset, 10) || 0;
  if (doExport === '1') { limit = EXPORT_CAP; offset = 0; }

  const filters = [];
  if (from) filters.push(`ts=gte.${encodeURIComponent(from)}`);
  if (to) filters.push(`ts=lte.${encodeURIComponent(to)}`);
  if (user) filters.push(`username=eq.${encodeURIComponent(user)}`);
  if (q) filters.push(`action=ilike.${encodeURIComponent('*' + q + '*')}`);

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'count=exact',
  };

  try {
    const qs = [
      'select=*',
      ...filters,
      'order=ts.desc',
      `limit=${limit}`,
      `offset=${offset}`,
    ].join('&');

    const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_log?${qs}`, { headers: sbHeaders });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Supabase read error', detail });
    }
    const rows = await r.json();

    // Supabase returns total count in Content-Range: "0-49/1234"
    let total = rows.length;
    const range = r.headers.get('content-range');
    if (range && range.includes('/')) {
      const parsed = parseInt(range.split('/')[1], 10);
      if (!isNaN(parsed)) total = parsed;
    }

    const out = rows.map(row => ({
      id: row.id,
      ts: row.ts,
      username: row.username,
      role: row.role,
      action: row.action,
      entity: row.entity,
      screen: row.screen,
      ip: row.ip,
      userAgent: row.user_agent,
    }));

    return res.status(200).json({ rows: out, total });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};