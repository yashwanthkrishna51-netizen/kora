// api/_audit.js — shared audit-log writer.
// Used by write.js, login.js, force-logout.js to record who-did-what-when.
// A logging failure must NEVER break the caller's real operation — always swallow errors.

async function logAudit(env, entry) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        actor_id: entry.actorId || null,
        username: entry.username || null,
        role: entry.role || null,
        action: entry.action || 'Unknown action',
        entity: entry.entity || null,
        screen: entry.screen || null,
        ip: entry.ip || null,
        user_agent: entry.userAgent || null,
      }),
    });
  } catch (err) {
    // Never let audit logging break the real request — just note it server-side.
    console.error('Audit log write failed:', err.message);
  }
}

// x-forwarded-for can be a comma-separated list (proxied through multiple hops) —
// the first entry is the original client.
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

module.exports = { logAudit, clientIp };