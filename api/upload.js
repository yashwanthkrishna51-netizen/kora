// api/upload.js
// Uploads a file to Supabase Storage (bucket: kora-attachments)
// Accepts: PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP)
// Max size: 3MB
//
// SECURITY fixes (see KORA_SECURITY_REMEDIATION_PLAN.md):
//   M-1 — viewers could upload files; role check was missing entirely.
//   L-2 — mimeType was trusted from the client with no content inspection;
//         now checked against each file type's real magic bytes.
//   L-3 — the base64-decode try/catch was dead code (Buffer.from(str,'base64')
//         does not throw on invalid input); replaced with a real pre-check.
//   L-1 — generic error responses, real error logged server-side only.

const crypto = require('crypto');
const { validateToken } = require('./_auth');
const { applyCors } = require('./_cors');
const { BUCKET, signPath } = require('./_storage');
const { serverError } = require('./_errors');

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'message/rfc822',        // .eml — plain-text exported/forwarded email (Outlook, Gmail, any mail client)
  'application/vnd.ms-outlook', // .msg — Outlook's native binary message format
]);

const ALLOWED_EXTS = new Set(['.pdf', '.xlsx', '.xls', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.eml', '.msg']);

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
// Rough base64-length ceiling so we never even attempt to decode something
// wildly over the limit — base64 inflates size by ~4/3.
const MAX_BASE64_CHARS = Math.ceil(MAX_BYTES * 4 / 3) + 1024;

// L-2 fix: verify the file actually starts with the magic bytes for its
// claimed type, instead of trusting the client-supplied mimeType outright.
// This is a content check, not a full parser — enough to catch a renamed
// file, not a state-of-the-art format validator.
function isOle2Container(b) {
  // OLE2 Compound File Binary Format header signature. Both legacy .xls
  // AND Outlook's .msg are OLE2 containers, so this signature alone cannot
  // tell the two apart — a real parser would walk the directory sector and
  // check the root storage entry's CLSID. This is a content check, not a
  // full parser (see file header note), so it stops at "is this genuinely
  // an OLE2 file" rather than "is this specifically a .msg vs a .xls."
  // The extension + ALLOWED_EXTS check upstream is what pins down which
  // one it's supposed to be; this only catches a non-OLE2 file renamed
  // to .xls/.msg.
  return b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
}

function looksLikeEmlText(b) {
  // .eml has no binary magic bytes — it's a plain-text RFC 822 message,
  // so this is a heuristic, not a true signature check: confirm the file
  // is text (no NUL bytes in the sampled prefix) and that it contains at
  // least one line that looks like a real mail header near the top.
  // Catches a renamed binary/non-email file; does not catch a crafted
  // text file that fakes header lines — that's a real limit, not a bug.
  const sample = b.slice(0, 8192);
  if (sample.includes(0)) return false;
  const text = sample.toString('utf8');
  return /^(From|To|Subject|Date|Received|Return-Path|Delivered-To|Message-ID|MIME-Version|Content-Type):/im.test(text);
}

function matchesMagicBytes(buffer, mimeType) {
  const b = buffer;
  switch (mimeType) {
    case 'application/pdf':
      return b.length >= 4 && b.slice(0, 4).toString('ascii') === '%PDF';
    case 'image/png':
      return b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    case 'image/jpeg':
    case 'image/jpg':
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case 'image/gif':
      return b.length >= 6 && b.slice(0, 6).toString('ascii').startsWith('GIF8');
    case 'image/webp':
      return b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      // .xlsx is a zip archive — starts with the local-file-header signature.
      return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07);
    case 'application/vnd.ms-excel':
      // legacy .xls is an OLE2 compound document.
      return isOle2Container(b);
    case 'application/vnd.ms-outlook':
      // .msg is also an OLE2 compound document — see isOle2Container note.
      return isOle2Container(b);
    case 'message/rfc822':
      return looksLikeEmlText(b);
    default:
      return false;
  }
}

module.exports = async function handler(req, res) {
  applyCors(req, res, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const token = req.headers['x-session-token'];
  const check = await validateToken(token, INTEGTRACK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  if (!check.valid) {
    return res.status(401).json({ error: 'Unauthorized', reason: check.reason });
  }
  // M-1 fix: this check was missing entirely — any authenticated viewer
  // could upload unlimited files, matching neither write.js's role model
  // nor the UI (which never shows the upload control to viewers).
  if (check.payload.role === 'viewer') {
    return res.status(403).json({ error: 'Viewers cannot upload files' });
  }

  const { base64, fileName, mimeType } = req.body || {};

  if (!base64 || !fileName || !mimeType) {
    return res.status(400).json({ error: 'base64, fileName and mimeType are required' });
  }

  if (!ALLOWED_TYPES.has(mimeType)) {
    return res.status(400).json({
      error: `File type "${mimeType}" not allowed. Supported: PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP), email (.eml, .msg).`,
    });
  }

  const ext = '.' + fileName.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return res.status(400).json({ error: `Extension "${ext}" not allowed.` });
  }

  // L-3 fix: a real pre-check (instead of the old dead try/catch — Buffer.from
  // with 'base64' never throws, it just silently drops invalid characters).
  if (typeof base64 !== 'string' || base64.length === 0) {
    return res.status(400).json({ error: 'Invalid base64 data' });
  }
  if (base64.length > MAX_BASE64_CHARS) {
    return res.status(400).json({ error: 'File too large. Maximum is 3MB.' });
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    return res.status(400).json({ error: 'Invalid or empty file data' });
  }
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({
      error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum is 3MB.`,
    });
  }

  // L-2 fix: content must actually match the claimed type.
  if (!matchesMagicBytes(buffer, mimeType)) {
    return res.status(400).json({ error: 'File content does not match its declared type.' });
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const storagePath = `${timestamp}_${random}_${safeName}`;

  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    // Content-Type is set from our own verified mimeType, never re-derived
    // from user input beyond the magic-byte check above.
    'Content-Type': mimeType,
    'x-upsert': 'true',
  };

  try {
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: sbHeaders,
      body: buffer,
    });

    if (!uploadRes.ok) {
      const errBody = await uploadRes.json().catch(() => ({}));
      return res.status(uploadRes.status).json({
        error: errBody.message || errBody.error || 'Upload failed',
      });
    }

    const signedUrl = await signPath(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, storagePath, 24 * 60 * 60);
    return res.status(200).json({
      url: signedUrl || storagePath,
      fileName,
      mimeType,
      sizeBytes: buffer.length,
      storagePath,
    });
  } catch (err) {
    return serverError(res, err, 'upload.js');
  }
};