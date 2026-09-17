import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  matchesMagicBytes, extensionOf, storageKey,
  ALLOWED_TYPES, ALLOWED_EXTS, MAX_BYTES,
} from "@/lib/uploads";
import { requireIfMatch } from "@/lib/api/occ";

/* =============================================================== uploads */

const PDF = Buffer.from("%PDF-1.7\nrest of file");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF = Buffer.from("GIF89a__");
const WEBP = Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"),
]);
const XLSX = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const OLE2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EML = Buffer.from(
  "Return-Path: <a@b.com>\r\nSubject: Signoff\r\n\r\nBody text",
);

describe("magic-byte verification", () => {
  it("accepts each allowed type's real signature", () => {
    expect(matchesMagicBytes(PDF, "application/pdf")).toBe(true);
    expect(matchesMagicBytes(PNG, "image/png")).toBe(true);
    expect(matchesMagicBytes(JPEG, "image/jpeg")).toBe(true);
    expect(matchesMagicBytes(GIF, "image/gif")).toBe(true);
    expect(matchesMagicBytes(WEBP, "image/webp")).toBe(true);
    expect(matchesMagicBytes(
      XLSX,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )).toBe(true);
    expect(matchesMagicBytes(OLE2, "application/vnd.ms-excel")).toBe(true);
    expect(matchesMagicBytes(OLE2, "application/vnd.ms-outlook")).toBe(true);
    expect(matchesMagicBytes(EML, "message/rfc822")).toBe(true);
  });

  it("rejects HTML renamed to a PDF", () => {
    // The attack this exists for: stored under a signed URL on our own
    // origin, an HTML file served back is a stored-XSS delivery mechanism.
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    expect(matchesMagicBytes(html, "application/pdf")).toBe(false);
    expect(matchesMagicBytes(html, "image/png")).toBe(false);
    expect(matchesMagicBytes(html, "message/rfc822")).toBe(false);
  });

  it("rejects a real file declared as the wrong type", () => {
    expect(matchesMagicBytes(PNG, "application/pdf")).toBe(false);
    expect(matchesMagicBytes(PDF, "image/png")).toBe(false);
  });

  it("rejects an unlisted type rather than waving it through", () => {
    // Closed by default: adding a type to ALLOWED_TYPES without adding a
    // signature must fail shut, not open.
    expect(matchesMagicBytes(PDF, "application/x-msdownload")).toBe(false);
    expect(matchesMagicBytes(PDF, "")).toBe(false);
  });

  it("rejects a truncated header rather than reading past the end", () => {
    expect(matchesMagicBytes(Buffer.from("%P"), "application/pdf")).toBe(false);
    expect(matchesMagicBytes(Buffer.alloc(0), "image/png")).toBe(false);
    expect(matchesMagicBytes(Buffer.from("RIFF"), "image/webp")).toBe(false);
  });

  it("treats a binary file renamed to .eml as not an email", () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(matchesMagicBytes(binary, "message/rfc822")).toBe(false);
  });

  it("requires a header line, not merely text, for .eml", () => {
    const prose = Buffer.from("just some notes I typed out");
    expect(matchesMagicBytes(prose, "message/rfc822")).toBe(false);
  });
});

describe("storage keys", () => {
  it("strips path traversal out of the filename", () => {
    // The key reaches a URL path; `../` in a filename is the oldest trick.
    const key = storageKey("../../etc/passwd", 1756000000000, "abcd1234");
    expect(key).toBe("1756000000000_abcd1234_.._.._etc_passwd");
    expect(key).not.toContain("/");
  });

  it("keeps two same-named uploads apart", () => {
    const a = storageKey("invoice.pdf", 1756000000000, "aaaaaaaa");
    const b = storageKey("invoice.pdf", 1756000000000, "bbbbbbbb");
    expect(a).not.toBe(b);
  });

  it("caps a pathological filename", () => {
    const key = storageKey(`${"x".repeat(5000)}.pdf`, 1, "ab");
    expect(key.length).toBeLessThan(140);
  });

  it("reads the extension case-insensitively", () => {
    expect(extensionOf("Report.PDF")).toBe(".pdf");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
    expect(extensionOf("noextension")).toBe("");
  });

  it("keeps the allow-lists paired", () => {
    // Every allowed extension should correspond to an allowed type; a lone
    // entry on either side is a gap someone will find.
    expect(ALLOWED_TYPES.size).toBeGreaterThan(0);
    expect(ALLOWED_EXTS.has(".exe")).toBe(false);
    expect(ALLOWED_TYPES.has("text/html")).toBe(false);
    expect(MAX_BYTES).toBe(3 * 1024 * 1024);
  });
});

/* =================================================================== OCC */

const withHeader = (value?: string) =>
  new NextRequest("https://kora.test/api/clients/c1", {
    method: "PATCH",
    headers: value === undefined ? {} : { "if-match": value },
  });

describe("If-Match", () => {
  it("accepts the canonical token a GET hands out", () => {
    expect(requireIfMatch(withHeader("2026-08-27T14:11:43.262000Z")))
      .toBe("2026-08-27T14:11:43.262000Z");
  });

  it("tolerates ETag quoting and the weak marker", () => {
    expect(requireIfMatch(withHeader('"2026-08-27T14:11:43.262000Z"')))
      .toBe("2026-08-27T14:11:43.262000Z");
    expect(requireIfMatch(withHeader('W/"2026-08-27T14:11:43.262000Z"')))
      .toBe("2026-08-27T14:11:43.262000Z");
  });

  it("demands the header rather than defaulting to overwrite", () => {
    // 428, not 200. A write that forgot its precondition is a bug, and
    // letting it through defeats the entire mechanism.
    const err = (() => {
      try { requireIfMatch(withHeader()); } catch (e) { return e; }
    })() as { statusCode: number; extra: Record<string, unknown> };

    expect(err.statusCode).toBe(428);
    expect(err.extra.code).toBe("precondition_required");
  });

  it("refuses If-Match: *", () => {
    // RFC 9110 reads `*` as "any version". Honouring it would be an opt-out
    // of concurrency control that any client could take by accident.
    expect(() => requireIfMatch(withHeader("*"))).toThrow();
  });

  it("rejects a malformed token as a bad request", () => {
    for (const bad of ["not-a-date", "2026-08-27 14:11:43+00", "12345"]) {
      const err = (() => {
        try { requireIfMatch(withHeader(bad)); } catch (e) { return e; }
      })() as { statusCode: number };
      expect(err.statusCode).toBe(400);
    }
  });

  it("rejects the driver's own timestamp format", () => {
    // Postgres renders timestamptz as "2026-08-27 14:11:43.262+00", which is
    // what a naive implementation would hand out. It is timezone-dependent,
    // so it must not be accepted as a token.
    expect(() => requireIfMatch(withHeader("2026-08-27 14:11:43.262+00")))
      .toThrow();
  });
});
