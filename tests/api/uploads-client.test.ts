import { describe, it, expect } from "vitest";
import { matchesMagicBytes } from "@/lib/uploads";
import {
  matchesMagicBytesBrowser,
  safeFileName,
} from "@/lib/uploads-client";

/**
 * The browser magic-byte check must agree with the server's, byte for byte.
 *
 * Two implementations of one rule is normally a smell, and here it is
 * unavoidable: the server's takes a Node `Buffer` and calls
 * `.toString("ascii")` on slices of it. Passing a `Uint8Array` would NOT throw
 * — `Uint8Array.prototype.toString()` ignores its argument and returns
 * `"37,80,68,70"` — so PDF, GIF and WEBP would silently fail every check while
 * appearing to work. A shim is more dangerous than a rewrite.
 *
 * So the rewrite is pinned to the original by running BOTH over the same
 * fixtures and requiring identical answers. If either drifts, this fails.
 */

const bytes = (...b: number[]) => Uint8Array.from(b);
const pad = (b: Uint8Array, n: number) => {
  const out = new Uint8Array(n);
  out.set(b.subarray(0, n));
  return out;
};
const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const FIXTURES: [name: string, mime: string, data: Uint8Array][] = [
  ["a real PDF", "application/pdf", pad(ascii("%PDF-1.7"), 16)],
  ["a PDF header that is too short", "application/pdf", ascii("%PD")],
  ["a PNG", "image/png", pad(bytes(0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10), 16)],
  ["a PNG with only 4 bytes (server requires 8)", "image/png", bytes(0x89, 0x50, 0x4e, 0x47)],
  ["a JPEG", "image/jpeg", pad(bytes(0xff, 0xd8, 0xff, 0xe0), 16)],
  ["a GIF87a", "image/gif", pad(ascii("GIF87a"), 16)],
  ["a GIF89a", "image/gif", pad(ascii("GIF89a"), 16)],
  ["a GIF with 4 bytes (server requires 6)", "image/gif", ascii("GIF8")],
  ["a WEBP", "image/webp", pad(Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]), 20)],
  ["a RIFF that is not WEBP", "image/webp", pad(Uint8Array.from([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("AVI ")]), 20)],
  ["an XLSX (zip 03)", XLSX, pad(bytes(0x50, 0x4b, 0x03, 0x04), 16)],
  ["an XLSX (zip 05)", XLSX, pad(bytes(0x50, 0x4b, 0x05, 0x06), 16)],
  ["an XLSX (zip 07)", XLSX, pad(bytes(0x50, 0x4b, 0x07, 0x08), 16)],
  ["a zip with an unexpected third byte", XLSX, pad(bytes(0x50, 0x4b, 0x09, 0x00), 16)],
  ["an OLE2 .xls", "application/vnd.ms-excel", pad(bytes(0xd0, 0xcf, 0x11, 0xe0), 16)],
  ["an OLE2 .msg", "application/vnd.ms-outlook", pad(bytes(0xd0, 0xcf, 0x11, 0xe0), 16)],
  ["an EML with a From header", "message/rfc822", ascii("From: a@b.com\r\nSubject: hi\r\n\r\nbody")],
  ["an EML with a Content-Type header", "message/rfc822", ascii("Content-Type: text/plain\r\n\r\nbody")],
  ["an EML containing a NUL", "message/rfc822", Uint8Array.from([...ascii("From: a@b.com"), 0, 65])],
  ["text with no mail header", "message/rfc822", ascii("just some words")],
  ["a PDF declared as PNG", "image/png", pad(ascii("%PDF-1.7"), 16)],
  ["anything at all, declared as an unknown type", "application/x-msdownload", pad(ascii("MZ"), 16)],
  ["an empty buffer", "application/pdf", new Uint8Array(0)],
];

describe("browser magic bytes agree with the server's", () => {
  it.each(FIXTURES)("%s", (_name, mime, data) => {
    const server = matchesMagicBytes(Buffer.from(data), mime);
    const browser = matchesMagicBytesBrowser(data, mime);
    expect(browser).toBe(server);
  });

  it("covers both outcomes, so agreement is not vacuous", () => {
    // If every fixture were rejected, "they agree" would be trivially true.
    const results = FIXTURES.map(([, mime, data]) =>
      matchesMagicBytesBrowser(data, mime),
    );
    expect(results.filter(Boolean).length).toBeGreaterThan(5);
    expect(results.filter((r) => !r).length).toBeGreaterThan(5);
  });
});

describe("safeFileName", () => {
  it("leaves an ordinary name alone", () => {
    expect(safeFileName("signoff.pdf")).toBe("signoff.pdf");
  });

  it("truncates to 300 and KEEPS the extension", () => {
    // The upload route returns `file.name` raw and uncapped, while
    // `activityCreate` caps `fileName` at 300 — so a long name uploads
    // successfully and then fails the post that references it, leaving the file
    // in storage and unreachable.
    const long = "a".repeat(400) + ".pdf";
    const out = safeFileName(long);
    expect(out.length).toBe(300);
    expect(out.endsWith(".pdf")).toBe(true);
  });
});
