// api/ops.js — consolidated admin-maintenance endpoint. Merges 3 previously
// separate, low-traffic, admin-only endpoints — audit log (api/audit.js),
// settings key/value store (api/settings.js), v2-table backfill/resync
// (api/backfill-v2.js) — into one file, purely to stay well under Vercel
// Hobby's 12-serverless-function cap. Same reasoning as merging SSO into 1
// file and change-password/clear-lockout/force-logout into account.js.
//
// No functional change to any of the three operations — each one's logic
// below is the exact same code that lived in its own file, just relocated
// behind a dispatcher. Frontend call sites updated accordingly (see
// js/core.js and js/admin.js).
//
// Dispatch: ?op=audit | ?op=settings | ?op=backfill — a query param works
// for both GET and POST, since Vercel populates req.query regardless of
// method, so the batch-task-runner's POST body (offset/limit) doesn't
// collide with it.

const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { logAudit, clientIp } = require('./_audit');
const { serverError } = require('./_errors');
const { dualWriteClient } = require('./_dualwrite');
const { sendMail, buildClientEmailHtml } = require('./_mail');

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
const SETTINGS_ALLOWED_KEYS = ['capacity_weights', 'digest_recipients'];
const DEFAULT_CAPACITY_WEIGHTS = { module: 1, pmo: 0.5, ams: 0.25, cap: 5 };
const DEFAULT_DIGEST_RECIPIENTS = { emails: [] };

async function handleSettings(req, res, env, check) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?key=in.(capacity_weights,digest_recipients)&select=*`, { headers: sbHeaders });
      if (!r.ok) return res.status(r.status).json({ error: 'Settings read error' });
      const rows = await r.json();
      const cw = rows.find(row => row.key === 'capacity_weights')?.value || DEFAULT_CAPACITY_WEIGHTS;
      const dr = rows.find(row => row.key === 'digest_recipients')?.value || DEFAULT_DIGEST_RECIPIENTS;
      return res.status(200).json({
        capacityWeights: { ...DEFAULT_CAPACITY_WEIGHTS, ...cw },
        digestRecipients: { ...DEFAULT_DIGEST_RECIPIENTS, ...dr },
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
    if (key === 'digest_recipients') {
      if (!Array.isArray(value.emails)) return res.status(400).json({ error: 'digest_recipients.emails must be an array' });
      if (value.emails.length > 25) return res.status(400).json({ error: 'Too many recipients (max 25)' });
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      for (const e of value.emails) {
        if (typeof e !== 'string' || !EMAIL_RE.test(e.trim())) return res.status(400).json({ error: `Invalid email: ${e}` });
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

// ─── dispatcher ─────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured' });
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
  return res.status(400).json({ error: 'Unknown or missing ?op= (expected audit, settings, backfill, or send-client-email)' });
};