// api/cron/backup.js — daily free-tier backup safety net.
//
// Supabase free tier has zero automated backups / no PITR. This endpoint is
// hit once a day by Vercel Cron (Hobby plan: min interval = daily) and dumps
// the full `clients` and `users` tables as raw JSON into the SAME Storage
// bucket already used for attachments (kora-attachments), under a
// `backups/` prefix — no new bucket, no new env vars, reuses existing
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
//
// This is NOT a substitute for Point-In-Time-Recovery — it's a once-a-day
// snapshot. Worst case data-loss window with this in place: ~24h, vs.
// "gone forever" without it (see the Anand work-log incident).
//
// Auth: protected by CRON_SECRET (set in Vercel env vars). Vercel's own
// cron invocations automatically send this as a Bearer token when
// CRON_SECRET is set — see https://vercel.com/docs/cron-jobs/manage-cron-jobs
// A request without the correct secret is rejected before touching Supabase.

const BUCKET = 'kora-attachments';
const KEEP_DAYS = 30; // prune backups older than this so the bucket doesn't grow forever

function isoDateStamp(d) {
  return d.toISOString().slice(0, 19).replace(/[:T]/g, '-'); // e.g. 2026-07-28-03-00-00
}

async function fetchTable(supabaseUrl, serviceKey, table) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Failed reading ${table}: ${r.status} ${body}`);
  }
  return r.json();
}

async function uploadBackup(supabaseUrl, serviceKey, storagePath, jsonBody) {
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${BUCKET}/${storagePath}`;
  const r = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: jsonBody,
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Failed uploading ${storagePath}: ${r.status} ${body}`);
  }
}

async function listBackups(supabaseUrl, serviceKey) {
  const r = await fetch(`${supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefix: 'backups/', limit: 1000, sortBy: { column: 'name', order: 'asc' } }),
  });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}

async function deleteBackups(supabaseUrl, serviceKey, paths) {
  if (!paths.length) return;
  await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: paths }),
  });
}

module.exports = async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" automatically
  // when CRON_SECRET is set as an env var. Reject anything else so a random
  // internet request can't trigger this endpoint on demand.
  if (CRON_SECRET) {
    const authHeader = req.headers['authorization'] || '';
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const now = new Date();
    const stamp = isoDateStamp(now);

    const [clients, users] = await Promise.all([
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'clients'),
      fetchTable(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'users'),
    ]);

    const payload = JSON.stringify({
      takenAt: now.toISOString(),
      clients,
      users,
    });

    const storagePath = `backups/${stamp}.json`;
    await uploadBackup(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, storagePath, payload);

    // Prune anything older than KEEP_DAYS so the bucket doesn't grow forever.
    const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000);
    const existing = await listBackups(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stale = existing
      .filter(f => f && f.name && f.name.endsWith('.json'))
      .filter(f => {
        // filenames are the isoDateStamp, e.g. 2026-07-28-03-00-00.json
        const raw = f.name.replace('.json', '');
        const parts = raw.split('-');
        if (parts.length < 6) return false;
        const [y, mo, d, h, mi, s] = parts;
        const fileDate = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
        return !isNaN(fileDate.getTime()) && fileDate < cutoff;
      })
      .map(f => `backups/${f.name}`);

    if (stale.length) {
      await deleteBackups(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, stale);
    }

    return res.status(200).json({
      ok: true,
      backup: storagePath,
      clientsCount: clients.length,
      usersCount: users.length,
      pruned: stale.length,
    });
  } catch (err) {
    console.error('cron/backup.js error:', err.message);
    return res.status(500).json({ error: 'Backup failed', detail: err.message });
  }
};