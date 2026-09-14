import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { withAuth, json } from "@/lib/api/handler";
import { badRequest } from "@/lib/api/errors";
import { logAudit } from "@/lib/audit";
import {
  ALLOWED_TYPES, ALLOWED_EXTS, MAX_BYTES,
  matchesMagicBytes, extensionOf, storageKey,
} from "@/lib/uploads";

export const runtime = "nodejs";

const BUCKET = "kora-attachments";

/**
 * POST /api/uploads — multipart, one file.
 *
 * Multipart rather than the old base64-in-JSON: base64 inflates the payload by
 * a third, and the old handler needed a separate character-count ceiling just
 * to avoid decoding something wildly oversized. A stream with a declared size
 * needs none of that.
 *
 * The response returns `storagePath`, and the caller stores THAT. The old app
 * baked a signed URL into the jsonb, so every stored link was expired within
 * four hours and only appeared to work because the read path overwrote it.
 */
export const POST = withAuth({ role: "editor" }, async (ctx) => {
  const form = await ctx.req.formData().catch(() => null);
  const file = form?.get("file");

  if (!(file instanceof File)) {
    throw badRequest("Attach a file under the field name \"file\".");
  }

  if (file.size === 0) throw badRequest("That file is empty.");
  if (file.size > MAX_BYTES) {
    throw badRequest(
      `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 3MB.`,
    );
  }

  const mimeType = file.type || "";
  if (!ALLOWED_TYPES.has(mimeType)) {
    throw badRequest(
      `File type "${mimeType || "unknown"}" is not allowed. Supported: PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP), email (.eml, .msg).`,
    );
  }

  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTS.has(ext)) {
    throw badRequest(`Extension "${ext || "(none)"}" is not allowed.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // The declared type is a claim; this is the evidence. Without it, renaming
  // an HTML file to .pdf gets it stored and served back under a signed URL
  // from our own origin.
  if (!matchesMagicBytes(buffer, mimeType)) {
    throw badRequest("That file's contents do not match its declared type.");
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase storage is not configured");

  const path = storageKey(file.name, Date.now(), randomBytes(4).toString("hex"));

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    // Set from our own verified type, never re-derived from the filename.
    contentType: mimeType,
    upsert: false,
  });

  if (error) {
    // The driver's message can name buckets and internal paths.
    throw badRequest("Upload failed. Try again.");
  }

  await logAudit(ctx.db, {
    actorId: ctx.user.id, username: ctx.user.username, role: ctx.user.role,
    action: "Upload attachment", entity: "storage",
    ip: ctx.ip, userAgent: ctx.userAgent,
  });

  // No URL here on purpose — the caller stores the path and the read path
  // signs it fresh on every load.
  return json(
    { storagePath: path, fileName: file.name, mimeType, sizeBytes: file.size },
    201,
  );
});
