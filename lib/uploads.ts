/**
 * Upload content checks, ported verbatim from api/upload.js.
 *
 * The rule these enforce: a file's declared MIME type is a claim by the
 * client, and a claim is not evidence. Before this existed, renaming
 * `payload.html` to `invoice.pdf` was enough to get it stored and served back
 * under a signed URL from our own origin — which is a stored-XSS delivery
 * mechanism, not merely an untidy attachment.
 *
 * These are content checks, not parsers. They catch a renamed file; they do
 * not catch a crafted one. That is a deliberate limit, stated rather than
 * papered over.
 */

export const MAX_BYTES = 3 * 1024 * 1024;

export const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.ms-outlook",
  "message/rfc822",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export const ALLOWED_EXTS = new Set([
  ".pdf", ".xlsx", ".xls", ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".eml", ".msg",
]);

/**
 * OLE2 Compound File header.
 *
 * Both legacy .xls and Outlook .msg are OLE2 containers, so this signature
 * alone cannot tell them apart — that would need the directory sector's root
 * CLSID. The extension check upstream is what pins down which one it is
 * supposed to be; this only rejects a non-OLE2 file wearing either name.
 */
function isOle2Container(b: Buffer): boolean {
  return (
    b.length >= 8 &&
    b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0
  );
}

/**
 * .eml has no binary signature — it is plain RFC 822 text.
 *
 * So this is a heuristic: no NUL bytes in the sampled prefix, and at least one
 * line that looks like a real mail header near the top. It catches a renamed
 * binary. It does not catch a text file that fakes header lines, which is a
 * real limit rather than an oversight.
 */
function looksLikeEmlText(b: Buffer): boolean {
  const sample = b.subarray(0, 8192);
  if (sample.includes(0)) return false;
  return /^(From|To|Subject|Date|Received|Return-Path|Delivered-To|Message-ID|MIME-Version|Content-Type):/im.test(
    sample.toString("utf8"),
  );
}

export function matchesMagicBytes(b: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case "application/pdf":
      return b.length >= 4 && b.subarray(0, 4).toString("ascii") === "%PDF";
    case "image/png":
      return (
        b.length >= 8 &&
        b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      );
    case "image/jpeg":
    case "image/jpg":
      return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/gif":
      return b.length >= 6 && b.subarray(0, 6).toString("ascii").startsWith("GIF8");
    case "image/webp":
      return (
        b.length >= 12 &&
        b.subarray(0, 4).toString("ascii") === "RIFF" &&
        b.subarray(8, 12).toString("ascii") === "WEBP"
      );
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      // .xlsx is a zip; this is the local-file-header signature.
      return (
        b.length >= 4 &&
        b[0] === 0x50 && b[1] === 0x4b &&
        (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)
      );
    case "application/vnd.ms-excel":
    case "application/vnd.ms-outlook":
      return isOle2Container(b);
    case "message/rfc822":
      return looksLikeEmlText(b);
    default:
      // Closed by default: an unlisted type fails rather than passing
      // unchecked, so adding a type to ALLOWED_TYPES without adding a
      // signature here rejects it instead of waving it through.
      return false;
  }
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

/**
 * A storage key that cannot escape the bucket or collide.
 *
 * The original name is sanitised to a slug rather than used directly: it
 * reaches a URL path, and `../` in a filename is the oldest trick there is.
 * The random prefix means two people uploading `invoice.pdf` on the same day
 * get two objects rather than one overwriting the other.
 */
export function storageKey(
  fileName: string,
  stamp: number,
  random: string,
): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return `${stamp}_${random}_${safe}`;
}
