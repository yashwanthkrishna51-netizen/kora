import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { loadLegacy, legacyAvailable, type LegacyApi } from "./legacy";
import { makeClients } from "./fixtures";
import {
  integRagLabel,
  overallRagLabel,
  isOverdue,
  isStale,
  milestoneUrgency,
} from "@/lib/domain/integrations";
import { implProgress, implAutoRag } from "@/lib/domain/implementation";
import { amsTotals, amsClientRag } from "@/lib/domain/ams";
import { daysDiff, todayStr } from "@/lib/utils/dates";
import type { Client } from "@/lib/domain/types";

/**
 * Differential test: the TypeScript ports must agree with the original
 * vanilla-JS implementations on every generated case.
 *
 * The legacy code reads the clock directly, so we freeze time and hand the same
 * frozen instant to the ports. FROZEN is mid-afternoon UTC on purpose — it
 * keeps the UTC-derived `todayStr()` equal to the local date, so the port's
 * known timezone quirk can't mask a real difference.
 */

const FROZEN = new Date("2026-08-31T12:00:00.000Z");
const NOW = () => new Date();

// Skips rather than fails when the old repo isn't checked out alongside.
const describeIf = legacyAvailable ? describe : describe.skip;

describeIf("golden master: TS ports match the original implementation", () => {
  let legacy: LegacyApi;
  let clients: Client[];

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
    legacy = loadLegacy();
    // Several seeds x 60 clients gives wide threshold coverage.
    clients = [1, 7, 42, 1337, 90210].flatMap((seed) =>
      makeClients(seed, 60, FROZEN),
    );
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it("generates a non-trivial corpus", () => {
    expect(clients.length).toBe(300);
    expect(clients.some((c) => c.modules?.length)).toBe(true);
    expect(clients.some((c) => c.workLog?.length)).toBe(true);
  });

  it("todayStr and daysDiff agree", () => {
    expect(todayStr(NOW())).toBe(legacy.todayStr());
    for (const off of [-400, -14, -7, -1, 0, 1, 7, 14, 400]) {
      const d = new Date(FROZEN);
      d.setDate(d.getDate() + off);
      const s = d.toISOString().slice(0, 10);
      expect(daysDiff(s, NOW())).toBe(legacy.daysDiff(s));
    }
    expect(daysDiff("", NOW())).toBe(legacy.daysDiff(""));
    expect(daysDiff(null, NOW())).toBe(legacy.daysDiff(null));
  });

  it("isOverdue / isStale agree for every integration", () => {
    let checked = 0;
    for (const c of clients) {
      for (const i of c.integrations ?? []) {
        expect({ id: i.id, v: isOverdue(i, NOW()) }).toEqual({
          id: i.id,
          v: legacy.isOverdue(i),
        });
        expect({ id: i.id, v: isStale(i, 7, NOW()) }).toEqual({
          id: i.id,
          v: legacy.isStale(i, 7),
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("integRagLabel agrees for every client", () => {
    for (const c of clients) {
      expect({ id: c.id, rag: integRagLabel(c, NOW()) }).toEqual({
        id: c.id,
        rag: legacy.integRagLabel(c),
      });
    }
  });

  it("implProgress agrees for every client", () => {
    for (const c of clients) {
      expect({ id: c.id, ...implProgress(c) }).toEqual({
        id: c.id,
        ...legacy.implProgress(c),
      });
    }
  });

  it("implAutoRag agrees for every client", () => {
    for (const c of clients) {
      expect({ id: c.id, rag: implAutoRag(c, NOW()) }).toEqual({
        id: c.id,
        rag: legacy.implAutoRag(c),
      });
    }
  });

  it("amsClientRag agrees for every client", () => {
    for (const c of clients) {
      expect({ id: c.id, rag: amsClientRag(c, NOW()) }).toEqual({
        id: c.id,
        rag: legacy.amsClientRag(c),
      });
    }
  });

  it("amsTotals agrees, including windowed retainer draw-down", () => {
    const windows: [string, string][] = [
      ["", ""],
      ["2026-08-01", "2026-08-31"],
      ["2026-01-01", "2026-12-31"],
      ["2026-09-01", ""],
      ["", "2026-08-15"],
    ];
    for (const c of clients) {
      for (const [from, to] of windows) {
        const mine = amsTotals(c, from, to);
        const theirs = legacy.amsTotals(c, from, to) as Record<string, unknown>;
        expect({
          id: c.id,
          from,
          to,
          totalHours: mine.totalHours,
          billableHours: mine.billableHours,
          coveredHours: mine.coveredHours,
          consumedAllTime: mine.consumedAllTime,
          balanceAvailable: mine.balanceAvailable,
          totalAmount: mine.totalAmount,
          hasBucket: mine.hasBucket,
          hasRate: mine.hasRate,
          byType: mine.byType,
        }).toEqual({
          id: c.id,
          from,
          to,
          totalHours: theirs.totalHours,
          billableHours: theirs.billableHours,
          coveredHours: theirs.coveredHours,
          consumedAllTime: theirs.consumedAllTime,
          balanceAvailable: theirs.balanceAvailable,
          totalAmount: theirs.totalAmount,
          hasBucket: theirs.hasBucket,
          hasRate: theirs.hasRate,
          byType: theirs.byType,
        });
      }
    }
  });

  it("overallRagLabel agrees across all RAG combinations", () => {
    const vals = [null, "Red", "Amber", "Green"] as const;
    for (const a of vals)
      for (const b of vals)
        for (const c of vals) {
          expect(overallRagLabel(a, b, c)).toBe(legacy.overallRagLabel(a, b, c));
        }
  });

  it("milestone urgency agrees", () => {
    for (const off of [-30, -4, -3, -2, -1, 0, 1, 5]) {
      const d = new Date(FROZEN);
      d.setDate(d.getDate() + off);
      const ms = { id: "m", name: "x", status: "Pending" as const, dueDate: d.toISOString().slice(0, 10) };
      expect(milestoneUrgency(ms, NOW())).toBe(legacy.milestoneUrgencyColor(ms));
    }
    const noDate = { id: "m", name: "x", status: "Pending" as const };
    expect(milestoneUrgency(noDate, NOW())).toBe(
      legacy.milestoneUrgencyColor(noDate),
    );
  });
});
