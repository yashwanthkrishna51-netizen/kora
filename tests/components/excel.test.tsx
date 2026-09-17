// @vitest-environment jsdom
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { exportClientExcel, exportAuditExcel, exportAdminTableExcel } from "@/lib/export/excel";
import { makeClients } from "../golden/fixtures";
import type { Client } from "@/lib/domain/types";

/**
 * The spreadsheet exports, checked by opening what they produce.
 *
 * An .xlsx is a zip of XML, so the assertions here read the actual sheet
 * contents rather than the file size. That matters more than usual for this
 * format: v1's exports LOOKED fine and had two real defects that only show up
 * when you inspect the file —
 *
 *   1. the bold header row was a no-op (SheetJS drops cell styles), and
 *   2. `hours` was written with `.toFixed(1)`, so the one column anybody would
 *      want to total arrived as TEXT and SUM() returned zero.
 *
 * Both are fixed, and both are asserted here rather than trusted.
 */

const FROZEN = new Date("2026-08-31T12:00:00.000Z");

/** Whatever `downloadBlob` was handed, captured instead of saved. */
let captured: { blob: Blob; filename: string } | null = null;

vi.mock("@/lib/export/download", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/export/download")>();
  return {
    ...real,
    downloadBlob: (blob: Blob, filename: string) => {
      captured = { blob, filename };
    },
  };
});

/**
 * Pull one entry out of the xlsx zip, using only `node:zlib`.
 *
 * `write-excel-file` depends on fflate, but pnpm does not hoist transitive
 * dependencies, so importing it here would rely on a layout that is not ours
 * to guarantee. Reading the zip's central directory is thirty lines and depends
 * on nothing. Vitest runs in Node even under the jsdom environment, so the
 * built-in inflate is available.
 */
async function unzipEntry(blob: Blob, endsWith: string): Promise<string> {
  const { inflateRawSync } = await import("node:zlib");
  const buf = Buffer.from(await blob.arrayBuffer());

  // End-of-central-directory: scan back for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const names: string[] = [];

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    names.push(name);

    if (name.endsWith(endsWith)) {
      // Local header sizes can be zeroed when a data descriptor is used, so the
      // name/extra LENGTHS come from the local header but the compressed size
      // comes from the central directory, which is always populated.
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`no ${endsWith} in ${names.join(", ")}`);
}

describe("Excel exports", () => {
  let clients: Client[];

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
    clients = makeClients(42, 40, FROZEN);
    vi.useRealTimers();
  });

  afterEach(() => {
    captured = null;
  });

  it("produces a real xlsx with the expected name", async () => {
    const c = clients.find((x) => (x.integrations ?? []).length > 2)!;
    await exportClientExcel("integrations", c);

    expect(captured).not.toBeNull();
    const head = new Uint8Array(await captured!.blob.arrayBuffer()).slice(0, 2);
    // "PK" — an xlsx is a zip.
    expect(Array.from(head)).toEqual([0x50, 0x4b]);
    expect(captured!.filename).toMatch(/_Integrations_\d{2}[A-Z][a-z]{2}\d{4}\.xlsx$/);
  });

  it("writes one row per integration, plus the header", async () => {
    const c = clients.find((x) => (x.integrations ?? []).length > 2)!;
    await exportClientExcel("integrations", c);
    const sheet = await unzipEntry(captured!.blob, "sheet1.xml");
    const rows = sheet.match(/<row[ >]/g) ?? [];
    expect(rows.length).toBe((c.integrations ?? []).length + 1);
  });

  it("the header row is really styled, not silently dropped", async () => {
    // The exact defect that made `xlsx` unusable: it accepted the style object
    // and wrote a plain header. If the fill were dropped again, styles.xml
    // would carry no brand colour.
    const c = clients.find((x) => (x.integrations ?? []).length > 0)!;
    await exportClientExcel("integrations", c);
    const styles = await unzipEntry(captured!.blob, "styles.xml");
    // #005184 with the alpha prefix openpyxl-style writers use.
    expect(styles.toUpperCase()).toContain("005184");
  });

  it("HOURS is a number, so the column can be summed", async () => {
    // v1 wrote `Number(e.hours).toFixed(1)` — a string. Every AMS export
    // arrived with an unsummable hours column and nobody noticed, because it
    // looks identical until you select the range.
    const c = clients.find((x) => (x.workLog ?? []).length > 2)!;
    await exportClientExcel("ams", c);
    const sheet = await unzipEntry(captured!.blob, "sheet1.xml");

    // A numeric cell has no t="s"/t="str" attribute and holds a bare <v>.
    // A text cell is a shared string. Assert at least one numeric cell exists
    // and that no cell in the sheet is the string form of an hours value.
    const numericCells = sheet.match(/<c[^>]*(?<!t="s")><v>[\d.]+<\/v><\/c>/g) ?? [];
    expect(numericCells.length).toBeGreaterThan(0);

    const hours = (c.workLog ?? []).map((e) => Number(e.hours ?? 0));
    const shared = await unzipEntry(captured!.blob, "sharedStrings.xml").catch(() => "");
    for (const h of hours.filter((n) => n > 0)) {
      expect(
        shared.includes(`<t>${h.toFixed(1)}</t>`),
        `hours ${h} was written as text`,
      ).toBe(false);
    }
  });

  it("covers all four client sheets without throwing", async () => {
    const c = clients.find(
      (x) => (x.integrations ?? []).length > 0 && (x.modules ?? []).length > 0,
    )!;
    for (const kind of ["integrations", "milestones", "impl", "ams"] as const) {
      captured = null;
      await exportClientExcel(kind, c);
      expect(captured, `${kind} produced no file`).not.toBeNull();
    }
  });

  it("survives a client with nothing in a domain", async () => {
    // Header-only sheets are valid and are the right answer — an export that
    // refuses to run leaves the person wondering whether it broke.
    const empty: Client = { ...clients[0], integrations: [], modules: [], workLog: [] };
    for (const kind of ["integrations", "milestones", "impl", "ams"] as const) {
      captured = null;
      await exportClientExcel(kind, empty);
      const sheet = await unzipEntry(captured!.blob, "sheet1.xml");
      expect((sheet.match(/<row[ >]/g) ?? []).length).toBe(1);
    }
  });

  it("the audit export labels screens and names the System actor", async () => {
    await exportAuditExcel([
      {
        ts: "2026-09-01T10:00:00.000Z",
        username: null, role: null,
        action: "Backup written",
        entity: "backup", screen: "daily-digest",
        ip: null, userAgent: null,
      },
    ]);
    const shared = await unzipEntry(captured!.blob, "sharedStrings.xml");
    expect(shared).toContain("System");
    // `daily-digest` -> `Daily Digest`
    expect(shared).toContain("Daily Digest");
  });

  it("the admin roll-up uses domain MEMBERSHIP, not counts", async () => {
    // The null-sentinel a client in a domain with nothing in it relies on.
    // Filtering by `modules.length` instead of key presence would drop the six
    // production clients that are exactly this shape.
    const inDomainButEmpty: Client = { ...clients[0], modules: [] };
    const notInDomain: Client = { ...clients[1] };
    delete (notInDomain as { modules?: unknown }).modules;

    await exportAdminTableExcel("impl", [inDomainButEmpty, notInDomain]);
    const sheet = await unzipEntry(captured!.blob, "sheet1.xml");
    // Header + the in-domain client only.
    expect((sheet.match(/<row[ >]/g) ?? []).length).toBe(2);
  });
});
