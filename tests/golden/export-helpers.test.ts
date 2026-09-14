import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { loadLegacy, legacyAvailable, type LegacyApi } from "./legacy";
import { makeClients } from "./fixtures";
import {
  reportSeverityRank,
  reportSortWorstFirst,
  reportRiskReason,
  reportTopRisks,
  reportRagReason,
  reportMilestoneCounts,
  reportDonutSegments,
} from "@/lib/export/integration-report-helpers";
import type { Client, Integration } from "@/lib/domain/types";

/**
 * Golden master for the REPORT-ONLY integration helpers.
 *
 * These are the five that share a name with something in
 * `lib/domain/integrations.ts` and behave differently. The domain versions are
 * already covered by `parity.test.ts`; nothing covered these, and they are the
 * ones that decide what a client sees at the top of a PDF.
 *
 * The failure this is really guarding against is not a typo — it is importing
 * `integSeverityRank` from `lib/domain` instead of from `lib/export`. That
 * compiles, runs, and produces a report ordered by a completely different rule.
 */

const FROZEN = new Date("2026-08-31T12:00:00.000Z");
const describeIf = legacyAvailable ? describe : describe.skip;

describeIf("golden master: report helpers match js/export.js", () => {
  let legacy: LegacyApi;
  let clients: Client[];

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN);
    legacy = loadLegacy();
    clients = [1, 7, 42, 1337, 90210].flatMap((seed) =>
      makeClients(seed, 60, FROZEN),
    );
  });

  afterAll(() => vi.useRealTimers());

  /** Only clients that actually have integrations exercise these. */
  const withIntegs = () => clients.filter((c) => (c.integrations ?? []).length > 0);

  it("covers a meaningful number of cases", () => {
    // A guard on the guard: if the generator ever stops producing integrations,
    // every test below would pass vacuously.
    const cs = withIntegs();
    expect(cs.length).toBeGreaterThan(100);
    expect(cs.flatMap((c) => c.integrations ?? []).length).toBeGreaterThan(300);
  });

  it("reportSeverityRank agrees on every integration", () => {
    for (const c of withIntegs()) {
      for (const i of c.integrations ?? []) {
        expect(
          reportSeverityRank(i),
          `${c.name} / ${i.name} (${i.status})`,
        ).toBe(legacy.integSeverityRank(i));
      }
    }
  });

  it("reportSeverityRank spans the full 0–11 scale across the fixtures", () => {
    // Without this, the agreement above could hold while both sides only ever
    // returned the fallback 8.
    const seen = new Set(
      withIntegs().flatMap((c) =>
        (c.integrations ?? []).map((i) => reportSeverityRank(i)),
      ),
    );
    expect(seen.size).toBeGreaterThan(4);
    expect(Math.min(...seen)).toBeLessThanOrEqual(1);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(9);
  });

  it("reportSortWorstFirst produces the same ORDER", () => {
    for (const c of withIntegs()) {
      const mine = reportSortWorstFirst(c.integrations ?? []).map((i) => i.id);
      const theirs = (
        legacy.sortIntegWorstFirst(c.integrations ?? []) as Integration[]
      ).map((i) => i.id);
      expect(mine, c.name).toEqual(theirs);
    }
  });

  it("reportSortWorstFirst does not mutate its input", () => {
    // v1 spreads before sorting; the Portfolio PDF's AMS section did NOT and
    // sorted shared state in place. Worth pinning that this one is the safe kind.
    const c = withIntegs()[0];
    const before = (c.integrations ?? []).map((i) => i.id);
    reportSortWorstFirst(c.integrations ?? []);
    expect((c.integrations ?? []).map((i) => i.id)).toEqual(before);
  });

  it("reportRiskReason agrees on every integration", () => {
    for (const c of withIntegs()) {
      for (const i of c.integrations ?? []) {
        expect(
          reportRiskReason(i),
          `${c.name} / ${i.name} (${i.status})`,
        ).toBe(legacy.integRiskReason(i));
      }
    }
  });

  it("reportRiskReason exercises more than one branch", () => {
    const reasons = new Set(
      withIntegs().flatMap((c) =>
        (c.integrations ?? []).map((i) => reportRiskReason(i)),
      ),
    );
    expect(reasons.size).toBeGreaterThan(5);
    // It must never return null or an empty string — the report has nowhere to
    // put one, unlike the domain version which is allowed to.
    for (const r of reasons) expect(r).toBeTruthy();
  });

  it("reportTopRisks picks the same items in the same order", () => {
    for (const c of withIntegs()) {
      const mine = reportTopRisks(c).map((i) => i.id);
      const theirs = (legacy.integTopRisks(c) as Integration[]).map((i) => i.id);
      expect(mine, c.name).toEqual(theirs);
      expect(mine.length).toBeLessThanOrEqual(3);
    }
  });

  it("reportRagReason agrees on label and wording", () => {
    for (const c of withIntegs()) {
      expect(reportRagReason(c), c.name).toEqual(legacy.integRagReason(c));
    }
  });

  it("reportMilestoneCounts agrees, and counts across the WHOLE client", () => {
    for (const c of clients) {
      expect(reportMilestoneCounts(c), c.name).toEqual(
        legacy.integMilestoneCounts(c),
      );
    }
    // The domain function of the same name takes ONE integration. If this ever
    // gets swapped for it, totals collapse to a single integration's milestones.
    const multi = clients.find(
      (c) => (c.integrations ?? []).filter((i) => (i.milestones ?? []).length).length > 1,
    );
    if (multi) {
      const biggest = Math.max(
        ...(multi.integrations ?? []).map((i) => (i.milestones ?? []).length),
      );
      expect(reportMilestoneCounts(multi).total).toBeGreaterThan(biggest);
    }
  });

  it("reportDonutSegments groups, orders and caps identically", () => {
    // Colour is deliberately NOT compared: v1 used #0e7490/#be185d from SHEX,
    // and handoff §13 replaces the palette wholesale. What must not change is
    // the grouping, the descending order, the 5-slice cap and the Other bucket.
    for (const c of withIntegs()) {
      const mine = reportDonutSegments(c).map(({ status, count }) => ({
        status,
        count,
      }));
      const theirs = legacy
        .integStatusSegments(c)
        .map(({ status, count }) => ({ status, count }));
      expect(mine, c.name).toEqual(theirs);
    }
  });

  it("reportDonutSegments emits real hex, never a CSS var", () => {
    // STATUS_COLORS[*].text and .tint are `var(--k-…)` strings. jsPDF renders
    // those as garbage rather than throwing, so this is the boundary check.
    for (const c of withIntegs()) {
      for (const seg of reportDonutSegments(c)) {
        expect(seg.hex, `${c.name} / ${seg.status}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("caps at six slices with the sixth named Other", () => {
    // Built by hand rather than fished out of the fixtures: the generator gives
    // each client a handful of statuses and NONE of them reaches seven
    // distinct ones, so the cap branch never fires on generated data. An
    // earlier version of this test asserted the fixtures would cover it and
    // failed — which is the guard working. The cap is a real rule in a client
    // -facing chart, so it gets a real case.
    const many: Client = {
      ...withIntegs()[0],
      integrations: [
        // Counts are deliberately distinct and descending so the ordering is
        // unambiguous and "which five survive" is a fact, not a tie-break.
        ...Array.from({ length: 9 }, (_, n) => ({ status: "Completed", n })),
        ...Array.from({ length: 8 }, (_, n) => ({ status: "In Progress", n })),
        ...Array.from({ length: 7 }, (_, n) => ({ status: "At Risk", n })),
        ...Array.from({ length: 6 }, (_, n) => ({ status: "Delayed", n })),
        ...Array.from({ length: 5 }, (_, n) => ({ status: "Under Review", n })),
        ...Array.from({ length: 4 }, (_, n) => ({ status: "Pending Client", n })),
        ...Array.from({ length: 3 }, (_, n) => ({ status: "Cancelled", n })),
        ...Array.from({ length: 2 }, (_, n) => ({ status: "Not Started", n })),
      ].map(({ status, n }, idx) => ({
        id: `i_${idx}`,
        name: `${status} ${n}`,
        status,
        assignee: "",
        dueDate: "",
        description: "",
        nextAction: "",
        effortWeight: 0.5,
        timeline: [],
        milestones: [],
      })) as Integration[],
    };

    const segs = reportDonutSegments(many);
    expect(segs.length).toBe(6);
    expect(segs[5].status).toBe("Other");
    // Eight statuses in, five kept, three folded: 4 + 3 + 2.
    expect(segs[5].count).toBe(9);
    expect(segs.slice(0, 5).map((s) => s.status)).toEqual([
      "Completed",
      "In Progress",
      "At Risk",
      "Delayed",
      "Under Review",
    ]);

    // And it still agrees with v1 on this case, which is the point of being here.
    expect(segs.map(({ status, count }) => ({ status, count }))).toEqual(
      legacy
        .integStatusSegments(many)
        .map(({ status, count }) => ({ status, count })),
    );
  });

  it("no client ever produces more than six slices", () => {
    for (const c of withIntegs()) {
      expect(reportDonutSegments(c).length, c.name).toBeLessThanOrEqual(6);
    }
  });
});
