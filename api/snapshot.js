// api/snapshot.js — captures a daily per-client portfolio rollup for trend
// analysis, and serves back recent history for computing trend arrows/lines.
//
// POST: upsert today's rollup rows (idempotent — same client+date overwrites,
//   so it's safe to call this every time anyone loads the Dashboard; no cron
//   needed). Server's own date is used, not the client's clock.
// GET: returns snapshot rows for a date range, for building trend deltas.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: missing env vars' });
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
    const { rows } = req.body || {};
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: 'rows array required' });
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
        const detail = await r.text().catch(() => '');
        return res.status(r.status).json({ error: 'Snapshot upsert failed', detail });
      }
      return res.status(200).json({ ok: true, captured: payload.length, date: today });
    } catch (err) {
      return res.status(500).json({ error: err.message });
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
      const rows = await r.json();
      return res.status(200).json({ rows });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
};