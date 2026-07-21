// api/upload.js
// Uploads a file to Supabase Storage (bucket: kora-attachments)
// Accepts: PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP)
// Max size: 3MB

const crypto = require('crypto');

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

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const ALLOWED_EXTS = new Set(['.pdf', '.xlsx', '.xls', '.jpg', '.jpeg', '.png', '.gif', '.webp']);

const MAX_BYTES = 3 * 1024 * 1024; // 3MB
const BUCKET = 'kora-attachments';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGTRACK_SECRET } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Supabase env vars not set' });
  }

  const token = req.headers['x-session-token'];
  if (!isValidToken(token, INTEGTRACK_SECRET)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { base64, fileName, mimeType } = req.body || {};

  if (!base64 || !fileName || !mimeType) {
    return res.status(400).json({ error: 'base64, fileName and mimeType are required' });
  }

  // Validate mime type
  if (!ALLOWED_TYPES.has(mimeType)) {
    return res.status(400).json({
      error: `File type "${mimeType}" not allowed. Supported: PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP).`,
    });
  }

  // Validate extension
  const ext = '.' + fileName.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    return res.status(400).json({ error: `Extension "${ext}" not allowed.` });
  }

  // Decode base64
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'Invalid base64 data' });
  }

  // Validate size
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({
      error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum is 3MB.`,
    });
  }

  // Build a safe, unique storage path
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const timestamp = Date.now();
  const random = crypto.randomBytes(4).toString('hex');
  const storagePath = `${timestamp}_${random}_${safeName}`;

  // Upload to Supabase Storage
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
        error: errBody.message || errBody.error || `Storage upload failed (${uploadRes.status})`,
      });
    }

    // Return public URL + metadata
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
    return res.status(200).json({
      url: publicUrl,
      fileName,
      mimeType,
      sizeBytes: buffer.length,
      storagePath,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
