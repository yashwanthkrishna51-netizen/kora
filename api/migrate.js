// api/migrate.js
// One-time migration: GitHub encrypted JSON → Supabase PostgreSQL
// Valid-session required. Role is verified from live GitHub data (not token payload).

const crypto = require('crypto');
const { decryptString } = require('./_crypto');

function isValidToken(token, secret) {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(sig.length === expected.length ? sig : expected, 'hex');
  return crypto.timingSafeEqual(a, b) && sig.length === expected.length;
}

function getUsernameFromToken(token) {
  // Token payload is base64url("username:passwordHash")
  try {
    const dot = token.lastIndexOf('.');
    const decoded = Buffer.from(token.slice(0, dot), 'base64url').toString();
    return decoded.split(':')[0];
  } catch { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const {
    GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO,
    INTEGTRACK_SECRET, INTEGTRACK_ENC_KEY,
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  } = process.env;

  const token = req.headers['x-session-token'];
  if (!isValidToken(token, INTEGTRACK_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are not set in Vercel.' });
  }
  if (!GITHUB_PAT || !GITHUB_OWNER || !GITHUB_REPO || !INTEGTRACK_ENC_KEY) {
    return res.status(500).json({ error: 'GitHub env vars not set — migration reads from GitHub.' });
  }

  const ghHeaders = {
    Authorization: `token ${GITHUB_PAT}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'IntegTrack-Kognoz',
  };
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  const report = { clients: 0, users: 0, errors: [] };

  try {
    // ── 1. Read + decrypt users first (need for role check) ───────
    const uRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data/users.json`,
      { headers: ghHeaders }
    );
    if (!uRes.ok) {
      const e = await uRes.json();
      return res.status(500).json({ error: `GitHub users read failed: ${e.message}` });
    }
    const uData = await uRes.json();
    const uEncrypted = Buffer.from(uData.content, 'base64').toString().replace(/\n/g, '');
    const users = JSON.parse(decryptString(uEncrypted, INTEGTRACK_ENC_KEY));

    // ── 2. Verify caller is admin (role from live data, not token) ─
    const callerUsername = getUsernameFromToken(token);
    const callerUser = users.find(u => u.username === callerUsername);
    if (!callerUser || callerUser.role !== 'admin') {
      return res.status(403).json({ error: `Admin only. Token belongs to "${callerUsername || 'unknown'}" (role: ${callerUser?.role || 'not found'}).` });
    }

    // ── 3. Read + decrypt clients ─────────────────────────────────
    const cRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data/clients.json`,
      { headers: ghHeaders }
    );
    if (!cRes.ok) {
      const e = await cRes.json();
      return res.status(500).json({ error: `GitHub clients read failed: ${e.message}` });
    }
    const cData = await cRes.json();
    const cEncrypted = Buffer.from(cData.content, 'base64').toString().replace(/\n/g, '');
    const clients = JSON.parse(decryptString(cEncrypted, INTEGTRACK_ENC_KEY));

    // ── 4. Upsert clients into Supabase ───────────────────────────
    const clientRows = clients.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description || '',
      created_at: c.createdAt || new Date().toISOString(),
      integrations: c.integrations || [],
      modules: c.modules !== undefined ? c.modules : null,
      work_log: c.workLog !== undefined ? c.workLog : null,
      man_day_rate: c.manDayRate || null,
      total_available_hours: c.totalAvailableHours || null,
      currency: c.currency || 'INR',
    }));

    if (clientRows.length > 0) {
      const sbClientsRes = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(clientRows),
      });
      if (!sbClientsRes.ok) {
        const e = await sbClientsRes.json();
        report.errors.push(`Clients upsert error: ${e.message || JSON.stringify(e)}`);
      } else {
        report.clients = clients.length;
      }
    }

    // ── 5. Upsert users into Supabase ─────────────────────────────
    const userRows = users.map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email || '',
      role: u.role,
      password_hash: u.passwordHash,
      created_at: u.createdAt || new Date().toISOString(),
    }));

    if (userRows.length > 0) {
      const sbUsersRes = await fetch(`${SUPABASE_URL}/rest/v1/users`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify(userRows),
      });
      if (!sbUsersRes.ok) {
        const e = await sbUsersRes.json();
        report.errors.push(`Users upsert error: ${e.message || JSON.stringify(e)}`);
      } else {
        report.users = users.length;
      }
    }

    return res.status(200).json({
      success: report.errors.length === 0,
      clients_migrated: report.clients,
      users_migrated: report.users,
      errors: report.errors,
      message: report.errors.length === 0
        ? `Migration complete. ${report.clients} clients and ${report.users} users copied to Supabase.`
        : `Migration finished with errors. Check the errors array.`,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
