import { ALLOWED_TYPES, ALLOWED_EXTS, MAX_BYTES, extensionOf } from "@/lib/uploads";

/**
 * The browser half of attachment upload.
 *
 * `lib/uploads.ts` is the authority and it stays that way — the server rejects
 * anything this misses. This exists to fail FAST and locally: a 3MB upload that
 * travels the network to be told its extension is wrong is a slow way to learn
 * something the browser already knew.
 *
 * WHY THE MAGIC-BYTE CHECK IS REWRITTEN RATHER THAN IMPORTED. The server's
 * `matchesMagicBytes` takes a Node `Buffer` and calls
 * `b.subarray(0,4).toString("ascii")`. A `Uint8Array` also has `subarray` and
 * `toString`, so passing one type-errors but would NOT throw at runtime —
 * `Uint8Array.prototype.toString()` ignores its argument and returns
 * `"37,80,68,70"`. PDF, GIF and WEBP would silently fail every check. A shim
 * would be worse than a rewrite.
 *
 * The asymmetries below are the server's, mirrored deliberately. Where it
 * requires a length but only inspects part of it, so does this — a file the
 * server accepts must never be rejected here, and vice versa.
 */

const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, to));

/** `D0 CF 11 E0` — the OLE2 container that .xls and .msg both use. */
function isOle2(b: Uint8Array): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0xd0 &&
    b[1] === 0xcf &&
    b[2] === 0x11 &&
    b[3] === 0xe0
  );
}

/**
 * An .eml is just text, so there is no signature — the server samples the first
 * 8192 bytes, rejects anything containing a NUL, and looks for a mail header.
 */
function looksLikeEml(b: Uint8Array): boolean {
  const sample = b.subarray(0, 8192);
  if (sample.includes(0)) return false;
  const text = new TextDecoder("utf-8").decode(sample);
  return /^(From|To|Subject|Date|Received|Return-Path|Delivered-To|Message-ID|MIME-Version|Content-Type):/im.test(
    text,
  );
}

export function matchesMagicBytesBrowser(
  b: Uint8Array,
  mimeType: string,
): boolean {
  switch (mimeType) {
    case "application/pdf":
      return b.length >= 4 && ascii(b, 0, 4) === "%PDF";
    case "image/png":
      // Requires 8 bytes, inspects 4. The server does the same.
      return (
        b.length >= 8 &&
        b[0] === 0x89 &&
        b[1] === 0x50 &&
        b[2] === 0x4e &&
        b[3] === 0x47
      );
    case "image/jpeg":
    case "image/jpg":
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/gif":
      // Requires 6, pins 4 — "GIF8" covers both 87a and 89a.
      return b.length >= 6 && ascii(b, 0, 4) === "GIF8";
    case "image/webp":
      return (
        b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP"
      );
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      // .xlsx is a zip. `b[3]` is deliberately unchecked, as on the server.
      return (
        b.length >= 4 &&
        b[0] === 0x50 &&
        b[1] === 0x4b &&
        (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
      );
    case "application/vnd.ms-excel":
    case "application/vnd.ms-outlook":
      return isOle2(b);
    case "message/rfc822":
      return looksLikeEml(b);
    default:
      // Closed by default, like the server. An unknown type never passes.
      return false;
  }
}

/** The upload endpoint's response, which is also `activityCreate.attachment`. */
export interface UploadedFile {
  storagePath: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
}

/**
 * `fileName` is capped at 300 by `activityCreate`, but the upload route returns
 * `file.name` raw and uncapped. A long name therefore uploads successfully
 * (201) and then fails the post that references it — the file is in storage and
 * unreachable. Truncated here, keeping the extension, so the two agree.
 */
export function safeFileName(name: string): string {
  if (name.length <= 300) return name;
  const ext = extensionOf(name);
  return name.slice(0, 300 - ext.length) + ext;
}

/** Local pre-check. Returns an error message, or null when the file is fine. */
export async function validateFile(file: File): Promise<string | null> {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_BYTES) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 3MB.`;
  }

  const mimeType = file.type || "";
  if (!ALLOWED_TYPES.has(mimeType)) {
    return `File type "${mimeType || "unknown"}" is not allowed. Supported: PDF, Excel (.xlsx/.xls), images (JPG, PNG, GIF, WEBP), email (.eml, .msg).`;
  }

  const ext = extensionOf(file.name);
  if (!ALLOWED_EXTS.has(ext)) {
    return `Extension "${ext || "(none)"}" is not allowed.`;
  }

  // Only the head is read — enough for every signature, and it avoids pulling a
  // 3MB file into memory to look at twelve bytes. The EML check needs 8192.
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  if (!matchesMagicBytesBrowser(head, mimeType)) {
    return "That file's contents do not match its declared type.";
  }

  return null;
}

/**
 * Upload one file.
 *
 * NOT via `api()`. That helper sets `content-type: application/json` and
 * stringifies the body; a multipart upload needs the browser to set the
 * boundary itself, so this is a raw fetch. Same-origin credentials, matching
 * the rest of the app.
 */
export async function uploadFile(file: File): Promise<UploadedFile> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch("/api/uploads", {
    method: "POST",
    body: form,
    credentials: "same-origin",
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      typeof body.error === "string" ? body.error : "Upload failed. Try again.",
    );
  }

  return {
    storagePath: String(body.storagePath),
    fileName: safeFileName(String(body.fileName)),
    mimeType: body.mimeType as string | undefined,
    sizeBytes: body.sizeBytes as number | undefined,
  };
}
