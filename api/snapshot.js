// api/snapshot.js — captures a daily per-client portfolio rollup for trend
// analysis, and serves back recent history for computing trend arrows/lines.
//
// POST: upsert today's rollup rows (idempotent — same client+date overwrites,
//   so it's safe to call this every time anyone loads the Dashboard; no cron
//   needed). Server's own date is used, not the client's clock.
// GET: returns snapshot rows for a date range, for building trend deltas.
//
// SECURITY fix (M-2, see KORA_SECURITY_REMEDIATION_PLAN.md): this endpoint
// previously checked only that the caller was authenticated, never their
// role. That meant a viewer could POST forged rows — silently faking the
// leadership Dashboard's trend arrows and health history, with no audit
// trail at all — and GET returned ams_hours_month (financial data) to every
// role even though the Dashboard UI itself hides that behind admin-only.
// Now: POST requires editor/admin and is audit-logged; GET strips financial
// fields for non-admins, matching the UI's own gating exactly.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { logAudit, clientIp } = require('./_audit');
const { serverError } = require('./_errors');

const MAX_ROWS_PER_CALL = 500; // generous ceiling for number of clients in one snapshot call

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const token = req.headers['x-session-token'];
  const check = await validateToken(token, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!check.valid) {
    return res.status(401).json({ error: 'Unauthorized', reason: check.reason });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  if (req.method === 'POST') {
    // M-2 fix: viewers must not be able to write snapshot rows at all — this
    // data feeds the leadership Dashboard's trend indicators directly.
    if (check.payload.role === 'viewer') {
      return res.status(403).json({ error: 'Viewers cannot capture snapshots' });
    }

    const { rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: 'rows array required' });
    }
    if (rows.length > MAX_ROWS_PER_CALL) {
      return res.status(400).json({ error: `Too many rows in one call (max ${MAX_ROWS_PER_CALL})` });
    }

    const today = new Date().toISOString().slice(0, 10); // server date, not client's
    const payload = rows.map(r => ({
      snapshot_date: today,
      client_id: r.clientId,
      client_name: r.clientName || '',
      integ_total: r.integTotal || 0,
      integ_at_risk: r.integAtRisk || 0,
      integ_in_progress: r.integInProgress || 0,
      integ_completed: r.integCompleted || 0,
      impl_rag: r.implRag || null,
      impl_total_phases: r.implTotalPhases || 0,
      impl_completed_phases: r.implCompletedPhases || 0,
      ams_rag: r.amsRag || null,
      ams_open_entries: r.amsOpenEntries || 0,
      ams_open_l3l4: r.amsOpenL3L4 || 0,
      ams_hours_month: r.amsHoursMonth || 0,
      overall_rag: r.overallRag || null,
    }));

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_snapshots?on_conflict=snapshot_date,client_id`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        return res.status(r.status).json({ error: 'Snapshot capture failed' });
      }

      // M-2 fix: this write had no audit trail at all before — a forged
      // snapshot left zero trace. Now it's logged like every other write.
      await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
        actorId: check.payload.id,
        username: check.payload.username,
        role: check.payload.role,
        action: `Captured portfolio snapshot (${payload.length} clients)`,
        entity: 'portfolio_snapshots',
        screen: 'dashboard',
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
      });

      return res.status(200).json({ ok: true, captured: payload.length, date: today });
    } catch (err) {
      return serverError(res, err, 'snapshot.js POST');
    }
  }

  if (req.method === 'GET') {
    const { from, to, clientId } = req.query;
    const filters = [];
    if (from) filters.push(`snapshot_date=gte.${encodeURIComponent(from)}`);
    if (to) filters.push(`snapshot_date=lte.${encodeURIComponent(to)}`);
    if (clientId) filters.push(`client_id=eq.${encodeURIComponent(clientId)}`);

    try {
      const qs = ['select=*', ...filters, 'order=snapshot_date.asc'].join('&');
      const r = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_snapshots?${qs}`, { headers: sbHeaders });
      if (!r.ok) return res.status(r.status).json({ error: 'Snapshot read error' });
      let rows = await r.json();

      // M-2 fix: ams_hours_month is financial data. The Dashboard UI already
      // hides the Financial Rollup section from non-admins — the API was
      // handing it over regardless. Strip it here so the API matches the UI.
      if (check.payload.role !== 'admin') {
        rows = rows.map(({ ams_hours_month, ...rest }) => rest);
      }

      return res.status(200).json({ rows });
    } catch (err) {
      return serverError(res, err, 'snapshot.js GET');
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
};