// api/_validate.js — shared input-validation helpers.
// Extracted so write.js and change-password.js can never drift apart on what
// counts as a valid id / role / password (that drift is exactly how M-6 in
// the security audit happened in the first place).

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const VALID_ROLES = ['viewer', 'editor', 'admin'];

// Throws with a .statusCode so callers can turn it into the right HTTP response.
function assertId(v, label) {
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    const e = new Error(`Invalid ${label} identifier`);
    e.statusCode = 400;
    throw e;
  }
  return v;
}

function assertRole(v) {
  if (!VALID_ROLES.includes(v)) {
    const e = new Error(`Invalid role: ${v}`);
    e.statusCode = 400;
    throw e;
  }
  return v;
}

// Recursively walks a clients payload and validates every id-shaped field
// found at any depth (client, integration, module, phase, milestone,
// timeline entry, AMS work-log entry) — this is the primary fix for the
// stored-XSS chain (C-1) and the PostgREST filter-injection bug (H-1) in
// the security audit: neither is possible if every id is provably a plain
// slug before it ever reaches a DB query or gets rendered back out.
const ID_FIELDS = new Set(['id', 'clientId', 'integId', 'moduleId', 'mid', 'tid', 'uid']);
function assertIdsDeep(node, path = 'root') {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertIdsDeep(item, `${path}[${i}]`));
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (ID_FIELDS.has(key) && node[key] != null) assertId(node[key], `${path}.${key}`);
      else assertIdsDeep(node[key], `${path}.${key}`);
    }
  }
}

const MIN_PASSWORD_LENGTH = 8;
function assertPassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    const e = new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    e.statusCode = 400;
    throw e;
  }
  return pw;
}

module.exports = { ID_RE, VALID_ROLES, assertId, assertRole, assertIdsDeep, assertPassword, MIN_PASSWORD_LENGTH };