// api/_cors.js — shared CORS allow-list for every endpoint.
// Replaces the previous wildcard 'Access-Control-Allow-Origin: *' with an
// explicit list of Kora's real production URLs.
//
// IMPORTANT CAVEAT: this only affects browser-enforced CORS (i.e. blocks a
// malicious webpage's JS from reading responses cross-origin). It does NOT
// block direct API calls from curl/Postman/server-to-server — CORS is a
// browser convention, not a server access-control mechanism. The actual
// access control is (and must remain) the token + role checks in _auth.js.
//
// Add any new production or preview URL here as it's created.
const ALLOWED_ORIGINS = [
  'https://kora-eight-black.vercel.app',
  'https://integration-tracker-delta.vercel.app',
];

function applyCors(req, res, methods) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // Vary: Origin — tells caches/CDNs the response differs per-origin, so one
  // origin's cached CORS response is never served back to a different origin.
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
}

module.exports = { applyCors, ALLOWED_ORIGINS };