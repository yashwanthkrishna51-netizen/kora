// api/_errors.js — L-1 fix: every endpoint used to return `err.message`
// straight to the client, which can leak internal/Supabase error detail
// (table names, constraint names, connection info). This logs the real
// error server-side (visible in Vercel logs) and returns only a generic
// message plus a short correlation id the user can quote when reporting
// an issue — enough to find the real error in logs without exposing it.

function corrId() {
  return Math.random().toString(36).slice(2, 8);
}

// Use for expected, already-safe-to-show messages (validation errors we
// wrote ourselves, e.g. "Invalid username or password").
function safeError(res, statusCode, message, extra = {}) {
  return res.status(statusCode).json({ error: message, ...extra });
}

// Use for anything from a catch block — unexpected errors, DB errors,
// network errors. Never forwards err.message to the client.
function serverError(res, err, context) {
  const id = corrId();
  console.error(`[${id}] ${context}:`, err && err.stack ? err.stack : err);
  const statusCode = (err && err.statusCode) || 500;
  // Errors we threw ourselves (assertId/assertRole/assertPassword) carry a
  // safe, already-reviewed message and a 4xx status — fine to show directly.
  if (statusCode >= 400 && statusCode < 500 && err && err.statusCode) {
    return res.status(statusCode).json({ error: err.message });
  }
  return res.status(statusCode).json({ error: 'Something went wrong. Please try again.', ref: id });
}

module.exports = { safeError, serverError };