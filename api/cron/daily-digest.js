// api/cron/daily-digest.js — daily reminder email to each assignee listing
// their open Integration items + Implementation phases ("what to be done"),
// plus a routed fallback for anything nobody's directly responsible for.
//
// Mail is sent via Microsoft Graph (api/_mail.js), reusing the same Azure
// App Registration as SSO login — see api/_mail.js for exactly why that
// needs one additional app-only Mail.Send permission (SSO's own permission
// is delegated-only and can't be used with nobody logged in).
//
// Auth: EITHER a CRON_SECRET Bearer token (Vercel Cron's scheduled
// invocation, and curl testing) OR a valid admin session token via
// x-session-token (the in-app "Send Digest Now" button in Admin) — same
// dual-path pattern, just two ways to prove you're allowed to trigger this.
//
// Scope: Integration items + Implementation phases only. AMS work-log
// entries have no `assignee` field in the data model (only `raisedBy`, who
// logged the ticket, which isn't the same thing as who owns resolving it) —
// so AMS is structurally excluded here, not an oversight.
//
// ROUTING PRIORITY for each item, in order:
//   1. A real, resolvable phase/item-level assignee -> that person's own digest.
//   2. (Implementation only) No resolvable direct assignee, but the CLIENT
//      has a resolvable Master Assignee -> routed into that person's digest,
//      under a per-client "As Master Assignee" section (they're the client's
//      overall PMO, not the phase's day-to-day owner, so kept visually
//      separate from their own direct assignments).
//   3. Nothing resolvable at all -> the configurable fallback recipient list.
//
// Within (2) and (3), items are further split by status:
//   - "Not Started" items go in a de-prioritized, visually muted section —
//     nothing to chase yet, but not hidden either.
//   - Everything else (In Progress, At Risk, overdue, etc.) goes in the
//     normal, full-emphasis section.
// This split does NOT apply to a person's own directly-assigned items (1) —
// if it's actually assigned to you, you get a normal reminder even if you
// haven't started it yet, on the theory that a heads-up is exactly the point.
//
// Vercel Hobby-plan cron caveat (checked against Vercel's current docs,
// Aug 2026): Hobby allows up to 100 cron jobs, but only once-per-day
// execution, and the actual fire time is only guaranteed within the
// configured HOUR (±59 min) — "9am" on Hobby means "sometime between
// 9:00 and 9:59am IST," not the exact minute. Pro gives per-minute precision
// if that's ever needed.

const { validateToken } = require('../_auth');
const { sendMail, buildDigestEmailHtml, sleep } = require('../_mail');

const SKIP_STATUSES = new Set(['Completed', 'Cancelled']); // nothing left to do on these

function fetchTable(supabaseUrl, serviceKey, query) {
  return fetch(`${supabaseUrl}/rest/v1/${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  }).then(async r => {
    if (!r.ok) throw new Error(`Fetch failed: ${query} — ${r.status} ${await r.text().catch(() => '')}`);
    return r.json();
  });
}

async function isAuthorized(req, env) {
  const { CRON_SECRET, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  const authHeader = req.headers['authorization'] || '';
  if (CRON_SECRET && authHeader === `Bearer ${CRON_SECRET}`) return true;

  const sessionToken = req.headers['x-session-token'];
  if (sessionToken && INTEGTRACK_SECRET) {
    const check = await validateToken(sessionToken, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    if (check.valid && check.payload.role === 'admin') return true;
  }
  return false;
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
        masterAssigneeRaw: '', // Integration has no Master Assignee concept
        notStarted: i.status === 'Not Started',
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
          masterAssigneeRaw: (c.masterAssignee || '').trim(),
          notStarted: ph.status === 'Not Started',
        });
      }
    }
  }
  return items;
}

module.exports = async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, KORA_APP_URL } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }
  if (!(await isAuthorized(req, process.env))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const appUrl = (KORA_APP_URL || 'https://kora-eight-black.vercel.app').replace(/\/$/, '');

  try {
    const [clients, users, settingsRows] = await Promise.all([
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'clients?select=*'),
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'users?select=*'),
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'app_settings?key=eq.digest_recipients&select=*'),
    ]);

    const fallbackEmails = (settingsRows[0]?.value?.emails || []).filter(Boolean);

    // assignee/master-assignee name (trimmed, lowercased) -> { email, name },
    // only for users that actually have an email on file — these are
    // free-text/dropdown NAMEs, not emails or user ids, so this is a
    // best-effort match.
    const emailByName = new Map();
    for (const u of users) {
      if (u.name && u.email) emailByName.set(u.name.trim().toLowerCase(), { email: u.email, name: u.name });
    }

    const items = buildItems(clients, appUrl);

    // email -> { name, ownItems: [], masterByClient: Map(clientName -> {active:[], notStarted:[]}) }
    const perAssignee = new Map();
    function personBucket(email, name) {
      if (!perAssignee.has(email)) perAssignee.set(email, { name, ownItems: [], masterByClient: new Map() });
      return perAssignee.get(email);
    }

    const fallbackActive = [];
    const fallbackNotStarted = [];
    let unmatchedAssigneeCount = 0; // has an assignee name, but it doesn't match any user (or that user has no email)

    for (const item of items) {
      // 1. Real, resolvable direct assignee -> their own items, always full emphasis.
      if (item.assigneeRaw) {
        const match = emailByName.get(item.assigneeRaw.toLowerCase());
        if (match) {
          personBucket(match.email, match.name).ownItems.push(item);
          continue;
        }
        unmatchedAssigneeCount++; // falls through — still gets routed below, just flagged as a data-quality signal
      }

      // 2. No usable direct assignee — Implementation phases can fall back to
      //    the client's Master Assignee (the overall PMO for that client).
      if (item.domain === 'Implementation' && item.masterAssigneeRaw) {
        const masterMatch = emailByName.get(item.masterAssigneeRaw.toLowerCase());
        if (masterMatch) {
          const bucket = personBucket(masterMatch.email, masterMatch.name);
          if (!bucket.masterByClient.has(item.client)) bucket.masterByClient.set(item.client, { active: [], notStarted: [] });
          const clientBucket = bucket.masterByClient.get(item.client);
          (item.notStarted ? clientBucket.notStarted : clientBucket.active).push(item);
          continue;
        }
      }

      // 3. Nothing resolvable — generic fallback, split by Not Started.
      (item.notStarted ? fallbackNotStarted : fallbackActive).push(item);
    }

    // Sequential, not parallel — every email (per-assignee AND fallback) goes
    // through the SAME one mailbox (AZURE_MAIL_SENDER). Outlook enforces
    // roughly 4 concurrent operations per mailbox; firing sends in parallel
    // trips that almost immediately, surfacing as a mix of 429
    // ApplicationThrottled and 403 ErrorAccessDenied. A small pause between
    // each send keeps every request well under that ceiling. Vercel's
    // default function duration (300s on Hobby with fluid compute) gives
    // ample headroom even for a large recipient list at this pace.
    const SEND_PACING_MS = 350;
    const results = []; // {id, name, ok, error?} — shape matches the existing generic admin-task-runner UI so the manual-trigger button can reuse it unchanged
    for (const [email, { name, ownItems, masterByClient }] of perAssignee.entries()) {
      const sections = [{ heading: 'Your items', items: ownItems }];
      let masterTotal = 0;
      for (const [clientName, { active, notStarted }] of masterByClient.entries()) {
        masterTotal += active.length + notStarted.length;
        if (active.length) sections.push({ heading: `As Master Assignee — ${clientName}`, items: active });
        if (notStarted.length) sections.push({ heading: `As Master Assignee — ${clientName} (not started)`, muted: true, items: notStarted });
      }
      const totalCount = ownItems.length + masterTotal;
      const overdueCount = ownItems.filter(i => i.overdue).length;

      const html = buildDigestEmailHtml({
        greeting: `Hi ${name},`,
        intro: `You have ${totalCount} open item${totalCount === 1 ? '' : 's'}${overdueCount ? ` (${overdueCount} overdue)` : ''}${masterTotal ? `, including ${masterTotal} as Master Assignee` : ''}. Here's what's outstanding:`,
        sections,
      });
      try {
        await sendMail(process.env, {
          to: email,
          subject: `Kora — ${totalCount} open item${totalCount === 1 ? '' : 's'} for you today`,
          html,
        });
        results.push({ id: email, name, ok: true });
      } catch (err) {
        results.push({ id: email, name, ok: false, error: err.message });
      }
      await sleep(SEND_PACING_MS);
    }

    let fallbackSent = false;
    let fallbackError = null;
    const fallbackTotal = fallbackActive.length + fallbackNotStarted.length;
    if (fallbackTotal && fallbackEmails.length) {
      const sections = [
        { heading: 'Needs attention', items: fallbackActive },
        { heading: 'Not yet started', muted: true, items: fallbackNotStarted },
      ];
      const html = buildDigestEmailHtml({
        greeting: 'Unassigned / unmatched items',
        intro: `${fallbackTotal} open item${fallbackTotal === 1 ? '' : 's'} have no assignee (and no resolvable Master Assignee for Implementation phases), or an assignee name that doesn't match a Kora user account. Routing here so nothing gets missed:`,
        sections,
      });
      try {
        await sendMail(process.env, {
          to: fallbackEmails,
          subject: `Kora — ${fallbackTotal} unassigned item${fallbackTotal === 1 ? '' : 's'} need an owner`,
          html,
        });
        fallbackSent = true;
      } catch (err) {
        fallbackError = err.message;
      }
    }
    results.push({
      id: 'fallback', name: 'Fallback recipients',
      ok: fallbackTotal === 0 || fallbackSent || !fallbackEmails.length, // not a failure if there was simply nothing to send, or no recipients configured
      error: fallbackError || undefined,
    });

    const sent = results.filter(r => r.ok).length;
    const failedDetail = results.filter(r => !r.ok).map(r => `${r.name}: ${r.error}`);

    return res.status(200).json({
      ok: true,
      // Rich stats — used by curl/cron and for debugging.
      itemsProcessed: items.length,
      assigneesEmailed: results.filter(r => r.id !== 'fallback' && r.ok).length,
      assigneesFailed: results.filter(r => r.id !== 'fallback' && !r.ok).length,
      failedDetail,
      fallbackActiveCount: fallbackActive.length,
      fallbackNotStartedCount: fallbackNotStarted.length,
      fallbackSent,
      fallbackError,
      fallbackRecipientCount: fallbackEmails.length,
      unmatchedAssigneeCount,
      // Generic-shape fields — lets the existing admin-task-runner UI
      // (built for paginated batch endpoints like Resync V2) render this
      // single-shot endpoint's result with zero new UI code.
      processed: sent,
      failedCount: results.length - sent,
      results,
      done: true,
      nextOffset: null,
    });
  } catch (err) {
    console.error('cron/daily-digest.js error:', err.message);
    return res.status(500).json({ error: 'Daily digest failed', detail: err.message });
  }
};