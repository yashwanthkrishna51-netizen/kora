// api/auth-microsoft.js — "Sign in with Microsoft 365", all 3 steps in ONE
// file (start / callback / exchange), branched by method + query shape
// instead of 3 separate files. Vercel's Hobby plan caps a deployment at 12
// Serverless Functions (api/_*.js helpers don't count, real endpoint files
// do) — this app was already at exactly 12 before SSO, so 3 new files
// pushed it to 15. Merging these three into one is the fix; nothing about
// the actual auth logic changed from the original 3-file version, only how
// the 3 steps are dispatched to.
//
//   GET  /api/auth-microsoft                      -> START   (no code/error in the query)
//   GET  /api/auth-microsoft?code=...&state=...    -> CALLBACK (Microsoft's redirect back)
//   GET  /api/auth-microsoft?error=...&state=...    -> CALLBACK (user cancelled / Microsoft-side error)
//   POST /api/auth-microsoft   { ticket }          -> EXCHANGE (frontend picking up the ticket)
//
// SECURITY GATE (the actual point of this whole feature, unchanged from
// before): successfully signing in with Microsoft only proves the person
// controls that Microsoft identity — it does NOT by itself grant access to
// Kora. Access is only granted if that identity's email matches an
// existing row in Kora's own users table (see CALLBACK, step 3 below). No
// Kora account is ever created here, and nothing resembling a session is
// issued until after that check passes — mirrors how the rest of the app
// enforces access server-side rather than trusting a UI to hide a button
// (see write.js's role checks).

const { signToken, verifySignature } = require('./_auth');
const { logAudit, clientIp } = require('./_audit');
const { applyCors, ALLOWED_ORIGINS } = require('./_cors');

const STATE_TTL_MS = 10 * 60 * 1000;   // START: enough time for Microsoft's login/MFA/consent screens
const TICKET_TTL_MS = 60 * 1000;        // CALLBACK->EXCHANGE hand-off window, see EXCHANGE below
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000; // same session lifetime as password login (login.js)

module.exports = async function handler(req, res) {
  applyCors(req, res, 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') return handleExchange(req, res);
  if (req.method === 'GET') return handleGet(req, res);
  return res.status(405).json({ error: 'GET or POST only' });
};

// ── GET: dispatches to START or CALLBACK based on what's in the query ──
async function handleGet(req, res) {
  const { code, state, error } = req.query || {};
  if (code || error) return handleCallback(req, res, { code, state, error });
  return handleStart(req, res);
}

// ── STEP 1: START — redirects the browser to Microsoft's login page ──
async function handleStart(req, res) {
  const { AZURE_CLIENT_ID, AZURE_TENANT_ID, INTEGTRACK_SECRET } = process.env;
  if (!AZURE_CLIENT_ID || !AZURE_TENANT_ID || !INTEGTRACK_SECRET) {
    return res.status(500).json({ error: 'Microsoft sign-in is not configured on this server.' });
  }

  // redirect_uri has to exactly match one registered on the Azure app AND
  // exactly match what the CALLBACK step sends back during token exchange.
  // Rather than trusting req.headers.host blindly (host-header-injection
  // risk — this value ends up embedded in an outbound URL), it's only ever
  // built from Kora's own known-good origins — the same allow-list
  // _cors.js already maintains. Both real Kora deploy domains work with no
  // extra env var, as long as both are registered on the Azure app
  // (Authentication -> Redirect URIs -> Web -> add both, each ending in
  // just /api/auth-microsoft — no separate -callback path anymore).
  const candidateOrigin = `https://${req.headers.host}`;
  if (!ALLOWED_ORIGINS.includes(candidateOrigin)) {
    return res.status(400).json({ error: 'This domain is not configured for Microsoft sign-in.' });
  }
  const redirectUri = `${candidateOrigin}/api/auth-microsoft`;

  // State is a short-lived signed token, not server-stored — consistent
  // with the rest of this serverless app having no session store of its
  // own. It carries the exact origin/redirect_uri this request used, so
  // CALLBACK can reconstruct an identical redirect_uri for the token
  // exchange without trusting a second, later Host header.
  const iat = Date.now();
  const state = signToken({ purpose: 'msftAuthState', origin: candidateOrigin, iat, exp: iat + STATE_TTL_MS }, INTEGTRACK_SECRET);

  const authUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(AZURE_TENANT_ID)}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', AZURE_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', 'openid profile email User.Read');
  authUrl.searchParams.set('state', state);

  res.writeHead(302, { Location: authUrl.toString() });
  return res.end();
}

// ── STEP 2: CALLBACK — Microsoft redirects here after sign-in/cancel ──
async function handleCallback(req, res, { code, state, error: msftError }) {
  const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;
  const env = { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  const ip = clientIp(req), userAgent = req.headers['user-agent'];

  // Every failure path lands back on Kora's own login page (never
  // Microsoft, never an arbitrary attacker-influenced address) with a
  // generic, safe-to-show error code — mirrors login.js's L-1 fix (real
  // detail server-side only, via console.error at each call site below).
  async function bounceToLogin(fallbackOrigin, errorCode, auditAction) {
    if (auditAction) {
      try { await logAudit(env, { action: auditAction, entity: 'session', screen: 'login', ip, userAgent }); } catch (_) { }
    }
    const origin = ALLOWED_ORIGINS.includes(fallbackOrigin) ? fallbackOrigin : ALLOWED_ORIGINS[0];
    res.writeHead(302, { Location: `${origin}/?ssoError=${encodeURIComponent(errorCode)}` });
    return res.end();
  }

  if (!AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_TENANT_ID || !INTEGTRACK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return bounceToLogin(ALLOWED_ORIGINS[0], 'not_configured');
  }

  if (msftError) {
    // Person cancelled at Microsoft's screen, or a Microsoft-side error
    // (e.g. admin consent required for this app in this tenant).
    return bounceToLogin(ALLOWED_ORIGINS[0], 'msft_' + String(msftError).slice(0, 40));
  }

  const statePayload = verifySignature(state, INTEGTRACK_SECRET);
  if (!statePayload || statePayload.purpose !== 'msftAuthState' || Date.now() > statePayload.exp) {
    // Wrong/expired/missing state — refuse rather than guess. This is the
    // CSRF check: without it, a stolen or replayed code+state pair from a
    // different login attempt could be played against a victim's browser.
    return bounceToLogin(ALLOWED_ORIGINS[0], 'state_invalid');
  }
  const origin = statePayload.origin;
  const redirectUri = `${origin}/api/auth-microsoft`;

  if (!code) {
    return bounceToLogin(origin, 'no_code');
  }

  try {
    // 1) Exchange the one-time authorization code for tokens. redirect_uri
    // here must exactly match what START sent Microsoft.
    const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(AZURE_TENANT_ID)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        client_secret: AZURE_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid profile email User.Read',
      }),
    });
    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => '');
      console.error('auth-microsoft (callback): token exchange failed:', tokenRes.status, body.slice(0, 300));
      return bounceToLogin(origin, 'exchange_failed', 'Login failed: Microsoft token exchange error');
    }
    const tokenData = await tokenRes.json();

    // 2) Get the verified identity via Graph using the access token — this
    // way Microsoft itself vouches for the identity server-side, no
    // JWT/JWKS verification library needed on our end (none is in
    // package.json today, and this avoids adding one).
    const meRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName,id', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!meRes.ok) {
      console.error('auth-microsoft (callback): Graph /me failed:', meRes.status);
      return bounceToLogin(origin, 'graph_failed', 'Login failed: Microsoft profile lookup error');
    }
    const me = await meRes.json();
    // `mail` is null for some account/tenant configurations —
    // userPrincipalName is effectively always an email-shaped identifier,
    // used as the fallback.
    const azureEmail = (me.mail || me.userPrincipalName || '').trim();
    if (!azureEmail) {
      return bounceToLogin(origin, 'no_email', 'Login failed: Microsoft account has no usable email');
    }

    // 3) THE GATE. ilike (not eq) for a case-insensitive exact match —
    // Azure's casing for an email isn't guaranteed to match what's stored
    // in Kora. No fallback, no fuzzy match: anything other than a clean
    // match is a rejection.
    const sbHeaders = { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` };
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=ilike.${encodeURIComponent(azureEmail)}&select=*&limit=1`,
      { headers: sbHeaders }
    );
    if (!userRes.ok) {
      console.error('auth-microsoft (callback): user lookup failed:', userRes.status);
      return bounceToLogin(origin, 'lookup_failed', 'Login failed: user lookup error');
    }
    const rows = await userRes.json();
    if (!rows.length) {
      // Valid Microsoft identity, no matching Kora user — this is the
      // exact case this feature exists to stop at the door.
      return bounceToLogin(origin, 'not_authorized', `Login failed: Microsoft account (${azureEmail}) not in Kora user list`);
    }
    const user = rows[0];

    // Success — same token shape login.js issues, so every existing
    // endpoint's validateToken() treats an SSO session exactly like a
    // password session (same 7-day expiry, same token_version revocation,
    // same force-logout support, no other file needed to change).
    const iat = Date.now();
    const tokenPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: user.token_version || 0,
      iat,
      exp: iat + SEVEN_DAYS_MS,
    };
    const realToken = signToken(tokenPayload, INTEGTRACK_SECRET);
    const userOut = { id: user.id, username: user.username, name: user.name, email: user.email || '', role: user.role };

    await logAudit(env, { actorId: user.id, username: user.username, role: user.role, action: 'Login success (Microsoft SSO)', entity: 'session', screen: 'login', ip, userAgent });

    // Hand off through a short-lived ticket instead of putting the real
    // 7-day token straight in the URL — a URL persists in browser history
    // and proxy/server logs far longer than the few seconds this redirect
    // takes, so the ticket doesn't need that same lifetime. The frontend
    // exchanges it immediately (see EXCHANGE below / events.js init()) and
    // never shows it in the address bar (stripped via history.replaceState).
    const ticket = signToken({ purpose: 'ssoTicket', realToken, user: userOut, iat, exp: iat + TICKET_TTL_MS }, INTEGTRACK_SECRET);
    res.writeHead(302, { Location: `${origin}/?ssoTicket=${encodeURIComponent(ticket)}` });
    return res.end();
  } catch (err) {
    console.error('auth-microsoft (callback) error:', err && err.stack ? err.stack : err);
    return bounceToLogin(origin, 'unexpected_error');
  }
}

// ── STEP 3: EXCHANGE — frontend trades the short-lived ticket for the
// real session token. Same response shape as POST /api/login
// ({ token, user, usersSha }), so finishLogin() in events.js handles a
// password login and an SSO login identically. ──
async function handleExchange(req, res) {
  const { INTEGTRACK_SECRET } = process.env;
  if (!INTEGTRACK_SECRET) return res.status(500).json({ error: 'Server misconfigured' });

  const { ticket } = req.body || {};
  if (!ticket) return res.status(400).json({ error: 'ticket required' });

  const payload = verifySignature(ticket, INTEGTRACK_SECRET);
  // purpose check matters here specifically: verifySignature alone just
  // confirms "signed with our secret" — without checking purpose, a real
  // session token (also signed with the same secret) would otherwise pass
  // this check too. exp is a plain ms-timestamp compare, same convention
  // _auth.js's validateToken uses for the real session tokens.
  if (!payload || payload.purpose !== 'ssoTicket' || Date.now() > payload.exp) {
    return res.status(401).json({ error: 'Sign-in link expired or invalid. Please try Microsoft sign-in again.' });
  }

  return res.status(200).json({ token: payload.realToken, user: payload.user, usersSha: 'supabase' });
}