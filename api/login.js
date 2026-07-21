// api/login.js — Supabase version
// Replaces the GitHub-backed login after migration.

const crypto = require('crypto');

async function sha256(str) {
  const buf = crypto.createHash('sha256').update(str).digest();
  return Buffer.from(buf).toString('hex');
}

function signToken(payload, secret) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Server misconfigured: missing env vars' });
  }

  const { username, passwordHash } = req.body || {};
  if (!username || !passwordHash) {
    return res.status(400).json({ error: 'username and passwordHash required' });
  }

  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Query Supabase for user
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/users?username=eq.${encodeURIComponent(username)}&select=*&limit=1`,
      { headers: sbHeaders }
    );
    if (!r.ok) return res.status(500).json({ error: 'Database error' });
    const rows = await r.json();
    if (!rows.length) return res.status(401).json({ error: 'Invalid username or password' });

    const user = rows[0];

    // Compare password hash
    if (user.password_hash !== passwordHash) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Sign session token
    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      iat: Date.now(),
    };
    const token = signToken(tokenPayload, INTEGTRACK_SECRET);

    const userOut = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email || '',
      role: user.role,
    };

    return res.status(200).json({ token, user: userOut, usersSha: 'supabase' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
