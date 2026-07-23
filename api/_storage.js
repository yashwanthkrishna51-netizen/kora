// api/_storage.js — shared Supabase Storage signed-URL helpers.
//
// REQUIRES a manual step: the kora-attachments bucket must be switched to
// PRIVATE in Supabase (Storage -> kora-attachments -> Edit bucket -> turn
// OFF "Public bucket"). Once private, the old permanent public URL 404s,
// and only these short-lived signed URLs can fetch a file — a leaked or
// copied link stops working once it expires instead of working forever.

const BUCKET = 'kora-attachments';
const DEFAULT_EXPIRES_IN = 4 * 60 * 60; // 4 hours — regenerated on every read.js call anyway

// Matches both the old permanent public URL shape and a previously-issued
// signed URL shape, extracting just the storage path in either case, so old
// data (uploaded before this change) keeps working with no migration needed.
const PATH_PATTERNS = [
  new RegExp(`/storage/v1/object/public/${BUCKET}/([^?]+)`),
  new RegExp(`/storage/v1/object/sign/${BUCKET}/([^?]+)`),
];

function extractStoragePath(value) {
  if (typeof value !== 'string' || !value) return null;
  for (const re of PATH_PATTERNS) {
    const m = value.match(re);
    if (m) return decodeURIComponent(m[1]);
  }
  // Not a URL at all — assume it's already a bare storage path (this is what
  // upload.js falls back to returning if signing fails at upload time).
  if (!value.includes('://')) return value;
  return null;
}

async function signPath(supabaseUrl, serviceKey, path, expiresIn = DEFAULT_EXPIRES_IN) {
  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.signedURL ? `${supabaseUrl}/storage/v1${d.signedURL}` : null;
  } catch (e) {
    return null;
  }
}

// Bulk-signs many paths in one call (Supabase's bulk sign endpoint). Falls
// back to per-path signing for anything the bulk call didn't return, so
// attachments keep working even if that endpoint's response shape changes.
async function signMany(supabaseUrl, serviceKey, paths, expiresIn = DEFAULT_EXPIRES_IN) {
  const map = {};
  if (!paths.length) return map;
  try {
    const r = await fetch(`${supabaseUrl}/storage/v1/object/sign/${BUCKET}`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn, paths }),
    });
    if (r.ok) {
      const rows = await r.json();
      if (Array.isArray(rows)) {
        rows.forEach(row => {
          const p = row.path || row.Key;
          if (row.signedURL && p) map[p] = `${supabaseUrl}/storage/v1${row.signedURL}`;
        });
      }
    }
  } catch (e) { /* fall through to per-path signing below */ }

  const missing = paths.filter(p => !map[p]);
  if (missing.length) {
    await Promise.all(missing.map(async p => {
      const url = await signPath(supabaseUrl, serviceKey, p, expiresIn);
      if (url) map[p] = url;
    }));
  }
  return map;
}

// Recursively finds every attachment URL/path in a nested object/array.
function collectStoragePaths(node, out) {
  if (Array.isArray(node)) {
    node.forEach(item => collectStoragePaths(item, out));
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (key === 'url' && typeof val === 'string') {
        const path = extractStoragePath(val);
        if (path) out.add(path);
      } else if (val && typeof val === 'object') {
        collectStoragePaths(val, out);
      }
    }
  }
}

// Rewrites every attachment url in place using a pre-built path->signedUrl map.
function rewriteAttachmentUrls(node, urlMap) {
  if (Array.isArray(node)) {
    node.forEach(item => rewriteAttachmentUrls(item, urlMap));
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (key === 'url' && typeof val === 'string') {
        const path = extractStoragePath(val);
        if (path && urlMap[path]) node[key] = urlMap[path];
      } else if (val && typeof val === 'object') {
        rewriteAttachmentUrls(val, urlMap);
      }
    }
  }
}

// One-call convenience used by read.js: find every attachment URL anywhere
// in `data`, sign them all fresh, rewrite in place. Safe no-op if there are
// no attachments at all (the common case for most clients).
async function refreshAttachmentUrls(supabaseUrl, serviceKey, data, expiresIn = DEFAULT_EXPIRES_IN) {
  const paths = new Set();
  collectStoragePaths(data, paths);
  if (!paths.size) return;
  const urlMap = await signMany(supabaseUrl, serviceKey, [...paths], expiresIn);
  rewriteAttachmentUrls(data, urlMap);
}

module.exports = { BUCKET, extractStoragePath, signPath, refreshAttachmentUrls };