// api/ops.js — consolidated admin-maintenance endpoint. Merges audit log,
// settings key/value store, v2-table backfill/resync, client-email sending,
// and the Sales Pipeline domain into one file, purely to stay well under
// Vercel Hobby's 12-serverless-function cap. Same reasoning as merging SSO
// into 1 file and change-password/clear-lockout/force-logout into account.js.
//
// Dispatch: ?op=audit | ?op=settings | ?op=backfill | ?op=send-client-email
//         | ?op=pipeline | ?op=teams — a query param works for both GET and POST, since
// Vercel populates req.query regardless of method, so a POST body doesn't
// collide with it.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { logAudit, clientIp } = require('./_audit');
const { serverError } = require('./_errors');
const { dualWriteClient } = require('./_dualwrite');
const { sendMail, buildClientEmailHtml } = require('./_mail');
const { assertId } = require('./_validate');

// ─── op=audit — verbatim from the old api/audit.js ─────────────────────
const AUDIT_EXPORT_CAP = 5000;
const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 200;

async function handleAudit(req, res, env, check) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (check.payload.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const { from, to, user, q, export: doExport } = req.query;
  let limit = Math.min(parseInt(req.query.limit, 10) || AUDIT_DEFAULT_LIMIT, AUDIT_MAX_LIMIT);
  let offset = parseInt(req.query.offset, 10) || 0;
  if (doExport === '1') { limit = AUDIT_EXPORT_CAP; offset = 0; }

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
    const qs = ['select=*', ...filters, 'order=ts.desc', `limit=${limit}`, `offset=${offset}`].join('&');
    const r = await fetch(`${SUPABASE_URL}/rest/v1/audit_log?${qs}`, { headers: sbHeaders });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Supabase read error', detail });
    }
    const rows = await r.json();
    let total = rows.length;
    const range = r.headers.get('content-range');
    if (range && range.includes('/')) {
      const parsed = parseInt(range.split('/')[1], 10);
      if (!isNaN(parsed)) total = parsed;
    }
    const out = rows.map(row => ({
      id: row.id, ts: row.ts, username: row.username, role: row.role,
      action: row.action, entity: row.entity, screen: row.screen,
      ip: row.ip, userAgent: row.user_agent,
    }));
    return res.status(200).json({ rows: out, total });
  } catch (err) {
    return serverError(res, err, 'ops.js audit');
  }
}

// ─── op=settings — verbatim from the current api/settings.js ──────────
const SETTINGS_ALLOWED_KEYS = ['capacity_weights', 'digest_recipients', 'pipeline_stage_weights', 'implementation_rag_rules', 'module_weights'];
const DEFAULT_CAPACITY_WEIGHTS = { module: 1, pmo: 0.5, ams: 0.25, cap: 5 };
const DEFAULT_DIGEST_RECIPIENTS = { emails: [] };
// Default win-probability % per stage — admin-editable via the Pipeline
// admin tab, same mechanism as capacity_weights.
const DEFAULT_PIPELINE_STAGE_WEIGHTS = { Lead: 10, Qualified: 30, 'Proposal Sent': 50, Negotiation: 75, Won: 100, Lost: 0 };
// Implementation RAG rules — admin-editable via Admin → Implementations, same
// mechanism as capacity_weights.
// - flagIncomplete (default ON): any non-Completed phase missing a mandatory
//   field (assignee/dates/activity/next action) displays Red. Self-resolving
//   per record — clears the moment that phase is opened, filled in and
//   saved. This is the intended day-to-day mechanism for "red until fixed".
// - forceRed (default OFF): a blunt, global emergency override — every
//   record shows Red no matter what. Not the default; a blanket "everything
//   is red all the time" was tried first and found too discouraging/alarming
//   to work with day to day, so flagIncomplete replaced it as the default.
const DEFAULT_IMPLEMENTATION_RAG_RULES = { forceRed: false, redDays: 14, amberDays: 7, flagIncomplete: true };

async function handleSettings(req, res, env, check) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=in.(capacity_weights,digest_recipients,pipeline_stage_weights,implementation_rag_rules,module_weights)&select=*`, { headers: sbHeaders });
      if (!r.ok) return res.status(r.status).json({ error: 'Settings read error' });
      const rows = await r.json();
      const cw = rows.find(row => row.key === 'capacity_weights')?.value || DEFAULT_CAPACITY_WEIGHTS;
      const dr = rows.find(row => row.key === 'digest_recipients')?.value || DEFAULT_DIGEST_RECIPIENTS;
      const psw = rows.find(row => row.key === 'pipeline_stage_weights')?.value || DEFAULT_PIPELINE_STAGE_WEIGHTS;
      const irr = rows.find(row => row.key === 'implementation_rag_rules')?.value || DEFAULT_IMPLEMENTATION_RAG_RULES;
      const mw = rows.find(row => row.key === 'module_weights')?.value || {};
      return res.status(200).json({
        capacityWeights: { ...DEFAULT_CAPACITY_WEIGHTS, ...cw },
        digestRecipients: { ...DEFAULT_DIGEST_RECIPIENTS, ...dr },
        pipelineStageWeights: { ...DEFAULT_PIPELINE_STAGE_WEIGHTS, ...psw },
        implementationRagRules: { ...DEFAULT_IMPLEMENTATION_RAG_RULES, ...irr },
        moduleWeights: mw,
      });
    } catch (err) {
      return serverError(res, err, 'ops.js settings GET');
    }
  }

  if (req.method === 'POST') {
    if (check.payload.role !== 'admin') return res.status(403).json({ error: 'Only admins can change settings' });

    const { key, value } = req.body || {};
    if (!SETTINGS_ALLOWED_KEYS.includes(key)) return res.status(400).json({ error: 'Unknown settings key' });
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return res.status(400).json({ error: 'value must be an object' });
    }
    if (key === 'capacity_weights') {
      for (const k of ['module', 'pmo', 'ams', 'cap']) {
        const n = Number(value[k]);
        if (!Number.isFinite(n) || n <= 0 || n > 50) return res.status(400).json({ error: `Invalid value for ${k}` });
      }
    }
    if (key === 'module_weights') {
      // { "<module name>": <weight> } — the standard effort for a module name,
      // used as the default when a module of that name is created. Per-module
      // overrides live on the module itself, not here.
      const entries = Object.entries(value);
      if (entries.length > 300) return res.status(400).json({ error: 'Too many modules (max 300)' });
      for (const [name, w] of entries) {
        if (typeof name !== 'string' || !name.trim() || name.length > 120) return res.status(400).json({ error: `Invalid module name: ${String(name).slice(0, 40)}` });
        const n = Number(w);
        if (!Number.isFinite(n) || n <= 0 || n > 50) return res.status(400).json({ error: `Invalid weight for ${name} (must be between 0 and 50)` });
      }
    }
    if (key === 'digest_recipients') {
      if (!Array.isArray(value.emails)) return res.status(400).json({ error: 'digest_recipients.emails must be an array' });
      if (value.emails.length > 25) return res.status(400).json({ error: 'Too many recipients (max 25)' });
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const e of value.emails) {
        if (typeof e !== 'string' || !EMAIL_RE.test(e.trim())) return res.status(400).json({ error: `Invalid email: ${e}` });
      }
    }
    if (key === 'pipeline_stage_weights') {
      for (const stage of PIPELINE_STAGES) {
        const n = Number(value[stage]);
        if (!Number.isFinite(n) || n < 0 || n > 100) return res.status(400).json({ error: `Invalid probability % for stage: ${stage}` });
      }
    }
    if (key === 'implementation_rag_rules') {
      if (typeof value.forceRed !== 'boolean') return res.status(400).json({ error: 'forceRed must be true/false' });
      if (typeof value.flagIncomplete !== 'boolean') return res.status(400).json({ error: 'flagIncomplete must be true/false' });
      for (const k of ['redDays', 'amberDays']) {
        const n = Number(value[k]);
        if (!Number.isFinite(n) || n <= 0 || n > 365) return res.status(400).json({ error: `Invalid value for ${k}` });
      }
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
        method: 'POST',
        headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ key, value, updated_at: new Date().toISOString(), updated_by: check.payload.username }]),
      });
      if (!r.ok) return res.status(r.status).json({ error: 'Settings write failed' });

      await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
        actorId: check.payload.id, username: check.payload.username, role: check.payload.role,
        action: `Updated setting: ${key}`, entity: 'app_settings', screen: 'dashboard',
        ip: clientIp(req), userAgent: req.headers['user-agent'],
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      return serverError(res, err, 'ops.js settings POST');
    }
  }

  return res.status(405).json({ error: 'GET or POST only' });
}

// ─── op=backfill — verbatim from the old api/backfill-v2.js ───────────
const BACKFILL_DEFAULT_BATCH_SIZE = 5;
const BACKFILL_MAX_BATCH_SIZE = 20;

async function handleBackfill(req, res, env, check) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (check.payload.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const offset = Math.max(0, parseInt(req.body?.offset, 10) || 0);
  const limit = Math.min(BACKFILL_MAX_BATCH_SIZE, Math.max(1, parseInt(req.body?.limit, 10) || BACKFILL_DEFAULT_BATCH_SIZE));

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/clients?select=*&order=id.asc&limit=${limit}&offset=${offset}`, { headers: sbHeaders });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return res.status(r.status).json({ error: 'Failed to read clients', detail: body.slice(0, 300) });
    }
    const rows = await r.json();
    const clients = rows.map(row => ({
      id: row.id, name: row.name, description: row.description,
      manDayRate: row.man_day_rate, totalAvailableHours: row.total_available_hours,
      currency: row.currency, masterAssignee: row.master_assignee,
      integrations: row.integrations || [], modules: row.modules, workLog: row.work_log,
    }));

    const results = [];
    for (const client of clients) {
      try {
        await dualWriteClient({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, client, check.payload.username);
        results.push({ id: client.id, name: client.name, ok: true });
      } catch (err) {
        results.push({ id: client.id, name: client.name, ok: false, error: err.message });
      }
    }

    const done = rows.length < limit;
    const failedCount = results.filter(r => !r.ok).length;

    await logAudit({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }, {
      actorId: check.payload.id, username: check.payload.username, role: check.payload.role,
      action: `Resynced v2 tables: offset ${offset}, ${results.length} clients (${failedCount} failed)`,
      entity: 'clients_v2', screen: 'admin', ip: clientIp(req), userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      ok: true, offset, limit, processed: results.length, failedCount, results,
      done, nextOffset: done ? null : offset + limit,
    });
  } catch (err) {
    return serverError(res, err, 'ops.js backfill');
  }
}

// ─── op=send-client-email — manually-composed client email with the
//     exported report PDF attached, sent via Microsoft Graph (api/_mail.js).
//     Distinct from the automated digest: a human writes the subject/body/cc
//     and attaches the PDF the frontend generated. Editor+ only.
//
//     Payload: { to, cc?, subject, bodyText, attachment: { name, contentBytes } }
//       - to:            one recipient email string (the client contact)
//       - cc:            optional comma/array of cc emails
//       - subject:       email subject line
//       - bodyText:      plain text body (wrapped in the branded shell)
//       - attachment:    the exported PDF as base64 (contentBytes), + filename
const MAX_ATTACHMENT_B64 = 12 * 1024 * 1024; // ~9MB decoded — Graph's simple sendMail caps attachments around here; larger needs the upload-session API, out of scope
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleSendClientEmail(req, res, env, check) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (check.payload.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot send emails' });

  const { to, cc, subject, bodyText, attachment, clientName } = req.body || {};

  if (!to || !EMAIL_RE.test(String(to).trim())) return res.status(400).json({ error: 'A valid recipient email is required' });
  const ccList = (Array.isArray(cc) ? cc : String(cc || '').split(',')).map(s => s.trim()).filter(Boolean);
  for (const e of ccList) {
    if (!EMAIL_RE.test(e)) return res.status(400).json({ error: `Invalid cc address: ${e}` });
  }
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'A subject is required' });
  if (!bodyText || !String(bodyText).trim()) return res.status(400).json({ error: 'An email body is required' });

  let attachments;
  if (attachment && attachment.contentBytes) {
    if (attachment.contentBytes.length > MAX_ATTACHMENT_B64) {
      return res.status(413).json({ error: 'Attachment too large to email (over ~9MB). Try exporting without heavy images, or share a link instead.' });
    }
    attachments = [{
      name: attachment.name || 'Report.pdf',
      contentType: 'application/pdf',
      contentBytes: attachment.contentBytes,
    }];
  }

  try {
    const appUrl = process.env.KORA_APP_URL || 'https://kora-eight-black.vercel.app';
    await sendMail(process.env, {
      to: String(to).trim(),
      cc: ccList,
      subject: String(subject).trim(),
      html: buildClientEmailHtml({ bodyText, appUrl }),
      attachments,
    });

    await logAudit(env, {
      actorId: check.payload.id, username: check.payload.username, role: check.payload.role,
      action: `Sent client email: "${String(subject).trim().slice(0, 80)}" to ${String(to).trim()}${clientName ? ` (${clientName})` : ''}`,
      entity: 'client_email', screen: 'integrations',
      ip: clientIp(req), userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({ ok: true, sentTo: String(to).trim(), cc: ccList, hadAttachment: !!attachments });
  } catch (err) {
    // Graph errors are safe to surface here (they're operational, not internal
    // leakage) and genuinely useful while the person is testing — e.g. a bad
    // address or a not-yet-granted Mail.Send shows up plainly instead of a
    // generic "something went wrong."
    return res.status(502).json({ error: 'Email failed to send', detail: err.message });
  }
}

// ─── op=pipeline — Sales Pipeline: list/create/update/move/mark-lost/stats ─
const PIPELINE_STAGES = ['Lead', 'Qualified', 'Proposal Sent', 'Negotiation', 'Won', 'Lost'];
const PIPELINE_LEAD_SOURCES = ['Referral', 'Inbound', 'Existing Client Expansion', 'Cold Outreach', 'Other'];
const PIPELINE_TARGET_DOMAINS = ['Integration', 'Implementation', 'Both'];
const STALE_DAYS = 7; // matches core.js's isStale() default — deal-rotting threshold

function pipelineRowToEntry(row) {
  return {
    id: row.id, name: row.name, clientId: row.client_id, prospectName: row.prospect_name,
    stage: row.stage, probability: row.probability, owner: row.owner,
    estimatedHours: row.estimated_hours, quotedValue: row.quoted_value,
    leadSource: row.lead_source, targetDomain: row.target_domain,
    expectedCloseDate: row.expected_close_date, nextAction: row.next_action, notes: row.notes,
    winLossReason: row.win_loss_reason, wonAt: row.won_at,
    lastActivityAt: row.last_activity_at, createdAt: row.created_at,
    _v: row.updated_at,
  };
}

async function handlePipeline(req, res, env, check) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  // ── GET — list all entries, or ?stats=1 for the admin funnel report ──
  if (req.method === 'GET') {
    try {
      if (req.query.stats === '1') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_entries?select=stage,quoted_value,probability,created_at,won_at`, { headers: sbHeaders });
        if (!r.ok) return res.status(r.status).json({ error: 'Pipeline stats read error' });
        const rows = await r.json();
        const funnel = PIPELINE_STAGES.map(stage => ({ stage, count: rows.filter(r => r.stage === stage).length }));
        const decided = rows.filter(r => r.stage === 'Won' || r.stage === 'Lost');
        const won = rows.filter(r => r.stage === 'Won');
        const winRate = decided.length ? Math.round((won.length / decided.length) * 100) : null;
        const openRows = rows.filter(r => r.stage !== 'Won' && r.stage !== 'Lost');
        const weightedValue = openRows.reduce((sum, r) => sum + (Number(r.quoted_value) || 0) * (Number(r.probability) || 0) / 100, 0);
        const closedDurations = won.filter(r => r.won_at && r.created_at).map(r => (new Date(r.won_at) - new Date(r.created_at)) / 86400000);
        const avgDaysToClose = closedDurations.length ? Math.round(closedDurations.reduce((a, b) => a + b, 0) / closedDurations.length) : null;
        return res.status(200).json({ funnel, winRate, weightedValue: Math.round(weightedValue), avgDaysToClose, totalOpen: openRows.length });
      }
      const r = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_entries?select=*&order=created_at.desc`, { headers: sbHeaders });
      if (!r.ok) return res.status(r.status).json({ error: 'Pipeline read error' });
      const rows = await r.json();
      return res.status(200).json({ entries: rows.map(pipelineRowToEntry) });
    } catch (err) {
      return serverError(res, err, 'ops.js pipeline GET');
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
  if (check.payload.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot modify the pipeline' });

  const { action } = req.body || {};

  try {
    // ── create ──
    if (action === 'create') {
      const e = req.body.entry || {};
      assertId(e.id, 'pipeline entry id');
      if (!e.name || !String(e.name).trim()) return res.status(400).json({ error: 'Name is required' });
      if (!PIPELINE_STAGES.includes(e.stage || 'Lead')) return res.status(400).json({ error: 'Invalid stage' });
      if (e.clientId) assertId(e.clientId, 'clientId');
      if (!e.clientId && !e.prospectName) return res.status(400).json({ error: 'Either an existing client or a prospect name is required' });
      if (e.leadSource && !PIPELINE_LEAD_SOURCES.includes(e.leadSource)) return res.status(400).json({ error: 'Invalid lead source' });
      if (e.targetDomain && !PIPELINE_TARGET_DOMAINS.includes(e.targetDomain)) return res.status(400).json({ error: 'Invalid target domain' });

      const now = new Date().toISOString();
      const row = {
        id: e.id, name: String(e.name).trim(), client_id: e.clientId || null, prospect_name: e.clientId ? null : (e.prospectName || '').trim(),
        stage: e.stage || 'Lead', probability: Number.isFinite(Number(e.probability)) ? Number(e.probability) : 10,
        owner: e.owner || null, estimated_hours: e.estimatedHours != null ? Number(e.estimatedHours) : null,
        quoted_value: e.quotedValue != null ? Number(e.quotedValue) : null, lead_source: e.leadSource || null,
        target_domain: e.targetDomain || null, expected_close_date: e.expectedCloseDate || null,
        next_action: e.nextAction || null, notes: e.notes || null,
        last_activity_at: now, created_at: now, updated_at: now, updated_by: check.payload.username,
      };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_entries`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(row),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return res.status(r.status).json({ error: d.message || 'Create failed' }); }
      const inserted = await r.json();
      await logAudit(env, { actorId: check.payload.id, username: check.payload.username, role: check.payload.role, action: `Added pipeline entry: ${row.name}`, entity: 'pipeline_entries', screen: 'pipeline', ip: clientIp(req), userAgent: req.headers['user-agent'] });
      return res.status(200).json({ ok: true, entry: pipelineRowToEntry(inserted[0]) });
    }

    // ── update — OCC-guarded, same conditional-PATCH pattern as write.js ──
    if (action === 'update') {
      const { id, fields, expectedUpdatedAt } = req.body;
      assertId(id, 'pipeline entry id');
      if (!fields || typeof fields !== 'object') return res.status(400).json({ error: 'fields object required' });
      if (fields.stage && !PIPELINE_STAGES.includes(fields.stage)) return res.status(400).json({ error: 'Invalid stage' });
      if (fields.leadSource && !PIPELINE_LEAD_SOURCES.includes(fields.leadSource)) return res.status(400).json({ error: 'Invalid lead source' });
      if (fields.targetDomain && !PIPELINE_TARGET_DOMAINS.includes(fields.targetDomain)) return res.status(400).json({ error: 'Invalid target domain' });

      const patch = { updated_at: new Date().toISOString(), updated_by: check.payload.username, last_activity_at: new Date().toISOString() };
      const map = { name: 'name', stage: 'stage', probability: 'probability', owner: 'owner', estimatedHours: 'estimated_hours', quotedValue: 'quoted_value', leadSource: 'lead_source', targetDomain: 'target_domain', expectedCloseDate: 'expected_close_date', nextAction: 'next_action', notes: 'notes' };
      for (const [k, col] of Object.entries(map)) if (fields[k] !== undefined) patch[col] = fields[k];

      const url = expectedUpdatedAt
        ? `${SUPABASE_URL}/rest/v1/pipeline_entries?id=eq.${encodeURIComponent(id)}&updated_at=eq.${encodeURIComponent(expectedUpdatedAt)}`
        : `${SUPABASE_URL}/rest/v1/pipeline_entries?id=eq.${encodeURIComponent(id)}`;
      const r = await fetch(url, { method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return res.status(r.status).json({ error: d.message || 'Update failed' }); }
      const updated = await r.json();
      if (!updated.length) return res.status(409).json({ error: 'Someone else updated this entry first — reload and retry.' });
      return res.status(200).json({ ok: true, entry: pipelineRowToEntry(updated[0]) });
    }

    // ── mark-lost ──
    if (action === 'mark-lost') {
      const { id, reason } = req.body;
      assertId(id, 'pipeline entry id');
      const now = new Date().toISOString();
      const r = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_entries?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' },
        body: JSON.stringify({ stage: 'Lost', win_loss_reason: reason || null, updated_at: now, updated_by: check.payload.username, last_activity_at: now }),
      });
      if (!r.ok) return res.status(r.status).json({ error: 'Update failed' });
      const updated = await r.json();
      if (!updated.length) return res.status(404).json({ error: 'Entry not found' });
      await logAudit(env, { actorId: check.payload.id, username: check.payload.username, role: check.payload.role, action: `Marked pipeline entry Lost: ${updated[0].name}${reason ? ` (${reason})` : ''}`, entity: 'pipeline_entries', screen: 'pipeline', ip: clientIp(req), userAgent: req.headers['user-agent'] });
      return res.status(200).json({ ok: true, entry: pipelineRowToEntry(updated[0]) });
    }

    // ── move — the conversion action: create the real Integration item
    //     and/or Implementation module on an existing or brand-new client,
    //     then mark the pipeline entry Won and keep it as history (never
    //     deleted, per the decision this was scoped against).
    if (action === 'move') {
      const { id, targetDomain, newClientName, integration, implementation } = req.body;
      assertId(id, 'pipeline entry id');
      if (!PIPELINE_TARGET_DOMAINS.includes(targetDomain)) return res.status(400).json({ error: 'targetDomain must be Integration, Implementation, or Both' });

      const entryRes = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_entries?id=eq.${encodeURIComponent(id)}&select=*`, { headers: sbHeaders });
      if (!entryRes.ok) return res.status(entryRes.status).json({ error: 'Could not read pipeline entry' });
      const entryRows = await entryRes.json();
      if (!entryRows.length) return res.status(404).json({ error: 'Pipeline entry not found' });
      const entry = entryRows[0];
      if (entry.stage === 'Won') return res.status(409).json({ error: 'This entry has already been moved' });

      let clientId = entry.client_id;

      // Prospect with no client yet — create a minimal client record first.
      if (!clientId) {
        const name = (newClientName || entry.prospect_name || entry.name || '').trim();
        if (!name) return res.status(400).json({ error: 'A client name is required to move a prospect' });
        clientId = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const now = new Date().toISOString();
        const newClientRow = { id: clientId, name, description: '', integrations: [], created_at: now, updated_at: now };
        const cr = await fetch(`${SUPABASE_URL}/rest/v1/clients`, { method: 'POST', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(newClientRow) });
        if (!cr.ok) { const d = await cr.json().catch(() => ({})); return res.status(cr.status).json({ error: d.message || 'Could not create client' }); }
        try { await dualWriteClient(env, { id: clientId, name, description: '', integrations: [] }, check.payload.username); } catch (e) { /* best-effort, same as every other dual-write call site */ }
      }

      // Read the client fresh (whether just-created or pre-existing) so we
      // append to its real current arrays, not a stale copy.
      const clientRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=*`, { headers: sbHeaders });
      if (!clientRes.ok) return res.status(clientRes.status).json({ error: 'Could not read target client' });
      const clientRows = await clientRes.json();
      if (!clientRows.length) return res.status(404).json({ error: 'Target client not found' });
      const clientRow = clientRows[0];

      const clientPatch = { updated_at: new Date().toISOString() };

      if (targetDomain === 'Integration' || targetDomain === 'Both') {
        const newItem = {
          id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          name: (integration && integration.name) || entry.name, status: 'Not Started',
          assignee: (integration && integration.assignee) || entry.owner || '',
          dueDate: (integration && integration.dueDate) || '',
          description: (integration && integration.description) || entry.notes || '',
          nextAction: (integration && integration.nextAction) || entry.next_action || '',
        };
        assertId(newItem.id, 'new integration item id');
        clientPatch.integrations = [...(clientRow.integrations || []), newItem];
      }

      if (targetDomain === 'Implementation' || targetDomain === 'Both') {
        const modId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const newModule = {
          id: modId, name: (implementation && implementation.moduleName) || entry.name,
          phases: [{ name: (implementation && implementation.firstPhaseName) || 'Kickoff', status: 'Not Started', assignee: (implementation && implementation.assignee) || entry.owner || '', targetDate: (implementation && implementation.targetDate) || '', nextAction: entry.next_action || '' }],
        };
        assertId(newModule.id, 'new implementation module id');
        clientPatch.modules = [...(clientRow.modules || []), newModule];
        if (!clientRow.master_assignee && entry.owner) clientPatch.master_assignee = entry.owner;
      }

      const writeRes = await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&updated_at=eq.${encodeURIComponent(clientRow.updated_at)}`, {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(clientPatch),
      });
      if (!writeRes.ok) return res.status(writeRes.status).json({ error: 'Failed to write to client record' });
      const written = await writeRes.json();
      if (!written.length) return res.status(409).json({ error: 'Client record changed concurrently — retry the move.' });

      try { await dualWriteClient(env, { id: clientId, name: clientRow.name, integrations: clientPatch.integrations || clientRow.integrations, modules: clientPatch.modules || clientRow.modules, workLog: clientRow.work_log }, check.payload.username); } catch (e) { /* best-effort */ }

      const now = new Date().toISOString();
      const pipelinePatch = { stage: 'Won', won_at: now, client_id: clientId, target_domain: targetDomain, updated_at: now, updated_by: check.payload.username, last_activity_at: now };
      const pr = await fetch(`${SUPABASE_URL}/rest/v1/pipeline_entries?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=representation' }, body: JSON.stringify(pipelinePatch) });
      const prJson = pr.ok ? await pr.json() : [];

      await logAudit(env, { actorId: check.payload.id, username: check.payload.username, role: check.payload.role, action: `Moved pipeline entry to ${targetDomain}: ${entry.name} → ${clientRow.name}`, entity: 'pipeline_entries', screen: 'pipeline', ip: clientIp(req), userAgent: req.headers['user-agent'] });

      return res.status(200).json({ ok: true, clientId, entry: prJson.length ? pipelineRowToEntry(prJson[0]) : null });
    }

    return res.status(400).json({ error: 'Unknown action (expected create, update, mark-lost, or move)' });
  } catch (err) {
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    return serverError(res, err, 'ops.js pipeline');
  }
}

// ─── dispatcher ─────────────────────────────────────────────────────

// ─── op=teams — Microsoft Teams Workflow (Power Automate) endpoint ─────
// Lets someone read and update Kora from a Teams Workflow card without
// opening the app. Integrations only for now; Implementation follows the
// same shape once this is proven.
//
// WHY THIS IS SAFE TO WRITE FROM, given the live delete-by-omission risk:
// the browser's saveClients() posts the ENTIRE client array and write.js
// deletes any row missing from it. Nothing here does that. Every write
// below re-reads ONE client row by id, mutates only its `integrations`
// jsonb, and PATCHes that single row. No array is ever sent, so there is
// no omission for the backend to interpret as a delete. This endpoint
// cannot remove a client, a module, or an AMS entry even if it wanted to.
//
// AUTH — deliberately two independent factors, because a Workflow has no
// Kora session:
//   1. x-teams-secret header must match TEAMS_SHARED_SECRET (proves the
//      call came from your Flow, which holds the secret).
//   2. `actor` must be an email that resolves to a real Kora user row.
//      Role is then enforced from THAT user, not from the secret. So
//      holding the secret does not let anyone act as somebody who has no
//      Kora account, and a viewer still cannot write.
//
//   GET  ?op=teams&action=clients
//        ?op=teams&action=integrations&clientId=
//        ?op=teams&action=item&clientId=&integId=
//        ?op=teams&action=mine&actor=
//   POST ?op=teams   { action:'update'|'post-update', actor, clientId, integId, ... }

// Mirrors STATUSES in js/core.js — kept in sync by hand. A status arriving
// from a Workflow card is validated against this, so a stale dropdown in
// Power Automate can't write a value the app doesn't understand.
const TEAMS_STATUSES = ['Not Started', 'In Progress', 'At Risk', 'On Hold — Internal', 'On Hold — Client', 'Pending Client', 'Under Review', 'Delayed', 'Cancelled', 'Completed'];
// Only these integration fields may be written from Teams. Anything else in
// the payload is ignored rather than merged.
const TEAMS_WRITABLE = ['status', 'assignee', 'dueDate', 'nextAction', 'description', 'effortWeight'];
const TEAMS_MAX_UPDATE_LEN = 4000;

function teamsSb(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Resolve the Teams sender to a Kora user. Case-insensitive, same ilike
// match SSO uses, since Azure's casing isn't guaranteed to match ours.
async function teamsResolveActor(env, email) {
  const clean = String(email || '').trim();
  if (!clean || clean.length > 320) return null;
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(clean)}&select=id,username,name,email,role&limit=1`,
    { headers: teamsSb(env) }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function teamsReadClient(env, clientId) {
  const r = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&select=id,name,integrations,updated_at&limit=1`,
    { headers: teamsSb(env) }
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

function teamsIntegSummary(i) {
  return {
    integId: i.id, name: i.name, status: i.status || '',
    assignee: i.assignee || '', dueDate: i.dueDate || '',
    nextAction: i.nextAction || '', description: i.description || '',
    effortWeight: i.effortWeight ?? 0.5,
    lastUpdate: i.timeline?.[0]?.update || '',
    lastUpdateOn: i.timeline?.[0]?.date || '',
    updateCount: (i.timeline || []).length,
  };
}

// Writes `integrations` on ONE client row, guarded by the row's updated_at
// (same optimistic-concurrency contract write.js uses). On a conflict the
// row is re-read and the mutation re-applied once — a Workflow user has no
// way to resolve a merge dialog, so one silent retry is the right call;
// a second conflict gives up loudly rather than clobbering.
async function teamsPatchIntegrations(env, clientId, mutate) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = await teamsReadClient(env, clientId);
    if (!row) return { ok: false, status: 404, error: 'Client not found' };
    const list = Array.isArray(row.integrations) ? row.integrations : [];
    const result = mutate(list, row);
    if (result && result.error) return { ok: false, status: result.status || 400, error: result.error };

    const r = await fetch(
      `${env.SUPABASE_URL}/rest/v1/clients?id=eq.${encodeURIComponent(clientId)}&updated_at=eq.${encodeURIComponent(row.updated_at)}`,
      {
        method: 'PATCH',
        headers: { ...teamsSb(env), Prefer: 'return=representation' },
        body: JSON.stringify({ integrations: list, updated_at: new Date().toISOString() }),
      }
    );
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      return { ok: false, status: 502, error: 'Supabase write error', detail };
    }
    const patched = await r.json();
    if (patched.length) return { ok: true, client: row, result };
    // zero rows patched => somebody else wrote first; loop re-reads
  }
  return { ok: false, status: 409, error: 'That record was being edited elsewhere. Try again.' };
}

async function handleTeams(req, res, env) {
  const secret = process.env.TEAMS_SHARED_SECRET;
  if (!secret) return res.status(500).json({ error: 'Teams integration not configured' });
  const provided = req.headers['x-teams-secret'];
  if (!provided || provided !== secret) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.method === 'POST' ? (req.body || {}) : {};
  const action = String(req.query.action || body.action || '').trim();
  const actorEmail = req.query.actor || body.actor;

  const actor = await teamsResolveActor(env, actorEmail);
  if (!actor) return res.status(403).json({ error: 'Your Teams account is not linked to a Kora user. Ask an admin to add your email in Kora.' });

  const canWrite = actor.role === 'admin' || actor.role === 'editor';

  try {
    // ── reads ──
    if (req.method === 'GET') {
      if (action === 'clients') {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/clients?select=id,name,integrations&order=name.asc`, { headers: teamsSb(env) });
        if (!r.ok) return res.status(502).json({ error: 'Supabase read error' });
        const rows = await r.json();
        const out = rows
          .filter(row => Array.isArray(row.integrations) && row.integrations.length)
          .map(row => ({ clientId: row.id, name: row.name, count: row.integrations.length }));
        return res.status(200).json({ actor: { name: actor.name, role: actor.role }, clients: out });
      }

      if (action === 'integrations') {
        const clientId = String(req.query.clientId || '');
        if (!clientId) return res.status(400).json({ error: 'clientId required' });
        const row = await teamsReadClient(env, clientId);
        if (!row) return res.status(404).json({ error: 'Client not found' });
        return res.status(200).json({
          clientId: row.id, client: row.name,
          integrations: (row.integrations || []).map(teamsIntegSummary),
        });
      }

      if (action === 'item') {
        const clientId = String(req.query.clientId || '');
        const integId = String(req.query.integId || '');
        if (!clientId || !integId) return res.status(400).json({ error: 'clientId and integId required' });
        const row = await teamsReadClient(env, clientId);
        if (!row) return res.status(404).json({ error: 'Client not found' });
        const i = (row.integrations || []).find(x => x.id === integId);
        if (!i) return res.status(404).json({ error: 'Integration not found' });
        // Option lists travel with the record so the Workflow card can be
        // built from live data instead of a hardcoded dropdown that rots.
        const ur = await fetch(`${env.SUPABASE_URL}/rest/v1/users?select=name,role&order=name.asc`, { headers: teamsSb(env) });
        const users = ur.ok ? await ur.json() : [];
        return res.status(200).json({
          clientId: row.id, client: row.name,
          ...teamsIntegSummary(i),
          recentUpdates: (i.timeline || []).slice(0, 3).map(t => ({ date: t.date, update: t.update, by: t.addedBy })),
          options: {
            statuses: TEAMS_STATUSES,
            assignees: users.filter(u => u.role === 'admin' || u.role === 'editor').map(u => u.name),
          },
          canWrite,
        });
      }

      if (action === 'mine') {
        const r = await fetch(`${env.SUPABASE_URL}/rest/v1/clients?select=id,name,integrations&order=name.asc`, { headers: teamsSb(env) });
        if (!r.ok) return res.status(502).json({ error: 'Supabase read error' });
        const rows = await r.json();
        const mine = [];
        rows.forEach(row => (row.integrations || []).forEach(i => {
          if ((i.assignee || '').trim().toLowerCase() !== actor.name.trim().toLowerCase()) return;
          if (['Completed', 'Cancelled'].includes(i.status)) return;
          mine.push({ clientId: row.id, client: row.name, ...teamsIntegSummary(i) });
        }));
        mine.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
        return res.status(200).json({ actor: { name: actor.name }, count: mine.length, integrations: mine });
      }

      return res.status(400).json({ error: 'Unknown action (expected clients, integrations, item, or mine)' });
    }

    // ── writes ──
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });
    if (!canWrite) return res.status(403).json({ error: `Your Kora role (${actor.role}) is read-only.` });

    const clientId = String(body.clientId || '');
    const integId = String(body.integId || '');
    if (!clientId || !integId) return res.status(400).json({ error: 'clientId and integId required' });

    if (action === 'update' || action === 'post-update') {
      const fields = action === 'update' ? (body.fields || {}) : {};
      const updateText = String(body.update || '').trim();

      // Validate before touching anything, so a bad card fails cleanly.
      if (fields.status !== undefined && !TEAMS_STATUSES.includes(fields.status)) {
        return res.status(400).json({ error: `Unknown status "${fields.status}"` });
      }
      if (fields.dueDate !== undefined && fields.dueDate !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(fields.dueDate)) {
        return res.status(400).json({ error: 'dueDate must be YYYY-MM-DD or empty' });
      }
      if (fields.effortWeight !== undefined) {
        const w = Number(fields.effortWeight);
        if (!Number.isFinite(w) || w <= 0 || w > 50) return res.status(400).json({ error: 'Invalid effortWeight' });
      }
      if (fields.assignee) {
        const ur = await fetch(`${env.SUPABASE_URL}/rest/v1/users?name=eq.${encodeURIComponent(fields.assignee)}&select=name&limit=1`, { headers: teamsSb(env) });
        const found = ur.ok ? await ur.json() : [];
        if (!found.length) return res.status(400).json({ error: `"${fields.assignee}" is not a Kora user` });
      }
      if (updateText.length > TEAMS_MAX_UPDATE_LEN) return res.status(400).json({ error: 'Update text too long' });
      if (action === 'post-update' && !updateText) return res.status(400).json({ error: 'Update text required' });

      const changed = [];
      const out = await teamsPatchIntegrations(env, clientId, (list) => {
        const i = list.find(x => x.id === integId);
        if (!i) return { error: 'Integration not found', status: 404 };
        for (const k of TEAMS_WRITABLE) {
          if (fields[k] === undefined) continue;
          const next = k === 'effortWeight' ? Number(fields[k]) : String(fields[k]).trim();
          if (i[k] === next) continue;
          changed.push(`${k}: ${i[k] ?? '—'} → ${next || '—'}`);
          i[k] = next;
        }
        if (updateText) {
          if (!Array.isArray(i.timeline)) i.timeline = [];
          i.timeline.unshift({
            id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
            date: new Date().toISOString().slice(0, 10),
            update: updateText,
            addedBy: actor.name,
            addedAt: new Date().toISOString(),
            source: 'teams',
          });
        }
        return { name: i.name };
      });

      if (!out.ok) return res.status(out.status).json({ error: out.error, detail: out.detail });
      if (!changed.length && !updateText) return res.status(200).json({ ok: true, message: 'Nothing changed.' });

      await logAudit(env, {
        username: actor.username, role: actor.role,
        action: `teams:${action}`,
        entity: `${out.client.name} / ${out.result.name}`,
        screen: 'teams-workflow',
        ip: clientIp(req), userAgent: req.headers['user-agent'] || 'teams-workflow',
      }).catch(() => { });

      return res.status(200).json({
        ok: true,
        client: out.client.name,
        integration: out.result.name,
        changed,
        updatePosted: !!updateText,
        message: `Saved to ${out.client.name} / ${out.result.name}${updateText ? ', update posted' : ''}.`,
      });
    }

    return res.status(400).json({ error: 'Unknown action (expected update or post-update)' });
  } catch (err) {
    return serverError(res, err, 'ops.js teams');
  }
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // op=teams authenticates with its own shared secret + actor email, so it
  // must be dispatched BEFORE the session-token gate below — a Power
  // Automate Workflow has no Kora session to present.
  if (req.query.op === 'teams') {
    return handleTeams(req, res, { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY });
  }

  const token = req.headers['x-session-token'];
  const check = await validateToken(token, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!check.valid) return res.status(401).json({ error: 'Unauthorized', reason: check.reason });

  const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  const op = req.query.op;

  if (op === 'audit') return handleAudit(req, res, env, check);
  if (op === 'settings') return handleSettings(req, res, env, check);
  if (op === 'backfill') return handleBackfill(req, res, env, check);
  if (op === 'send-client-email') return handleSendClientEmail(req, res, env, check);
  if (op === 'pipeline') return handlePipeline(req, res, env, check);
  return res.status(400).json({ error: 'Unknown or missing ?op= (expected audit, settings, backfill, send-client-email, pipeline, or teams)' });
};