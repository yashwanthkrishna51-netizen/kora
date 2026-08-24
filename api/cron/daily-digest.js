// api/cron/daily-digest.js — daily reminder email to each assignee listing
// their open Integration items + Implementation phases ("what to be done"),
// plus one separate email to a configurable fallback list for anything with
// no assignee, or an assignee name that doesn't match a real Kora user
// account with an email on file.
//
// Mail is sent via Microsoft Graph (api/_mail.js), reusing the same Azure
// App Registration as SSO login — see api/_mail.js for exactly why that
// needs one additional app-only Mail.Send permission (SSO's own permission
// is delegated-only and can't be used with nobody logged in).
//
// Auth: CRON_SECRET Bearer token, identical pattern to api/cron/backup.js.
//
// Scope: Integration items + Implementation phases only. AMS work-log
// entries have no `assignee` field in the data model (only `raisedBy`, who
// logged the ticket, which isn't the same thing as who owns resolving it) —
// so AMS is structurally excluded here, not an oversight.
//
// Vercel Hobby-plan cron caveat (checked against Vercel's current docs,
// Aug 2026): Hobby allows up to 100 cron jobs, but only once-per-day
// execution, and the actual fire time is only guaranteed within the
// configured HOUR (±59 min) — "9am" on Hobby means "sometime between
// 9:00 and 9:59am IST," not the exact minute. Pro gives per-minute precision
// if that's ever needed.

const { sendMail, buildDigestEmailHtml } = require('../_mail');

const SKIP_STATUSES = new Set(['Completed', 'Cancelled']); // nothing left to do on these

function fetchTable(supabaseUrl, serviceKey, query) {
  return fetch(`${supabaseUrl}/rest/v1/${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then(async r => {
    if (!r.ok) throw new Error(`Fetch failed: ${query} — ${r.status} ${await r.text().catch(() => '')}`);
    return r.json();
  });
}

function daysOverdueRaw(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((today - d) / 86400000); // positive = overdue, 0 = due today, negative = future
}

function dueLabel(dateStr) {
  if (!dateStr) return null;
  const n = daysOverdueRaw(dateStr);
  if (n > 0) return { text: `Due ${dateStr} — ${n} day${n === 1 ? '' : 's'} overdue`, overdue: true };
  if (n === 0) return { text: `Due today (${dateStr})`, overdue: true };
  return { text: `Due ${dateStr}`, overdue: false };
}

// Flattens every client's Integration items + Implementation phases into a
// single list of digest-ready item records, skipping anything Completed/Cancelled.
function buildItems(clients, appUrl) {
  const items = [];
  for (const c of clients) {
    for (const i of (c.integrations || [])) {
      if (SKIP_STATUSES.has(i.status)) continue;
      const dl = dueLabel(i.dueDate);
      items.push({
        domain: 'Integration', name: i.name, client: c.name, status: i.status,
        dueLabel: dl ? dl.text : null, overdue: dl ? dl.overdue : false,
        description: i.description || '', nextAction: i.nextAction || '',
        link: `${appUrl}/integrations/${c.id}/${i.id}`,
        assigneeRaw: (i.assignee || '').trim(),
      });
    }
    for (const m of (c.modules || [])) {
      for (const ph of (m.phases || [])) {
        if (SKIP_STATUSES.has(ph.status)) continue;
        const dl = dueLabel(ph.targetDate);
        items.push({
          domain: 'Implementation', name: `${m.name} — ${ph.name}`, client: c.name, status: ph.status,
          dueLabel: dl ? dl.text : null, overdue: dl ? dl.overdue : false,
          description: '', nextAction: ph.nextAction || '',
          link: `${appUrl}/implementation/${c.id}/${m.id}/${encodeURIComponent(ph.name)}`,
          assigneeRaw: (ph.assignee || '').trim(),
        });
      }
    }
  }
  return items;
}

module.exports = async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET, KORA_APP_URL } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  // Same CRON_SECRET pattern as api/cron/backup.js — Vercel Cron sends this
  // automatically as a Bearer token when the env var is set.
  if (CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const appUrl = (KORA_APP_URL || 'https://kora-eight-black.vercel.app').replace(/\/$/, '');

  try {
    const [clients, users, settingsRows] = await Promise.all([
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'clients?select=*'),
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'users?select=*'),
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'app_settings?key=eq.digest_recipients&select=*'),
    ]);

    const fallbackEmails = (settingsRows[0]?.value?.emails || []).filter(Boolean);

    // assignee name (trimmed, lowercased) -> { email, name }, only for users
    // that actually have an email on file — `assignee` is a free-text/dropdown
    // NAME, not an email or user id, so this is a best-effort match.
    const emailByName = new Map();
    for (const u of users) {
      if (u.name && u.email) emailByName.set(u.name.trim().toLowerCase(), { email: u.email, name: u.name });
    }

    const items = buildItems(clients, appUrl);

    const perAssignee = new Map(); // email -> { name, items: [] }
    const fallbackItems = [];
    let unmatchedAssigneeCount = 0; // has a name, but it doesn't match any user (or that user has no email)

    for (const item of items) {
      if (!item.assigneeRaw) { fallbackItems.push(item); continue; }
      const match = emailByName.get(item.assigneeRaw.toLowerCase());
      if (!match) { unmatchedAssigneeCount++; fallbackItems.push(item); continue; }
      if (!perAssignee.has(match.email)) perAssignee.set(match.email, { name: match.name, items: [] });
      perAssignee.get(match.email).items.push(item);
    }

    // Promise.allSettled so one bad address doesn't stop everyone else's digest.
    const results = await Promise.allSettled(
      [...perAssignee.entries()].map(async ([email, { name, items: personItems }]) => {
        const overdueCount = personItems.filter(i => i.overdue).length;
        const html = buildDigestEmailHtml({
          greeting: `Hi ${name},`,
          intro: `You have ${personItems.length} open item${personItems.length === 1 ? '' : 's'}${overdueCount ? ` (${overdueCount} overdue)` : ''}. Here's what's outstanding:`,
          items: personItems,
        });
        await sendMail(process.env, {
          to: email,
          subject: `Kora — ${personItems.length} open item${personItems.length === 1 ? '' : 's'} for you today`,
          html,
        });
      })
    );

    let fallbackSent = false;
    if (fallbackItems.length && fallbackEmails.length) {
      const html = buildDigestEmailHtml({
        greeting: 'Unassigned / unmatched items',
        intro: `${fallbackItems.length} open item${fallbackItems.length === 1 ? '' : 's'} have no assignee, or an assignee name that doesn't match a Kora user account with an email on file. Routing here so nothing gets missed:`,
        items: fallbackItems,
      });
      await sendMail(process.env, {
        to: fallbackEmails,
        subject: `Kora — ${fallbackItems.length} unassigned item${fallbackItems.length === 1 ? '' : 's'} need an owner`,
        html,
      });
      fallbackSent = true;
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failedDetail = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || String(r.reason));

    return res.status(200).json({
      ok: true,
      itemsProcessed: items.length,
      assigneesEmailed: sent,
      assigneesFailed: failedDetail.length,
      failedDetail,
      fallbackItemCount: fallbackItems.length,
      fallbackSent,
      fallbackRecipientCount: fallbackEmails.length,
      unmatchedAssigneeCount,
    });
  } catch (err) {
    console.error('cron/daily-digest.js error:', err.message);
    return res.status(500).json({ error: 'Daily digest failed', detail: err.message });
  }
};