// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProgressRing } from "@/components/ui/progress-ring";

/**
 * The rail's completion ring.
 *
 * Scoped to the arithmetic, because every failure mode here is silent: an arc
 * that overdraws looks like a full ring, a division by zero renders "NaN%"
 * inside a circle, and a rounded percentage that disagrees with the fraction
 * beside it is the thing the SQL parity test exists to prevent — undone in the
 * last component before the screen. Geometry and colour are not tested; those
 * are visible the moment anyone looks at it.
 */

/** The value arc, if one was drawn. The track has no dasharray. */
function arc(container: HTMLElement): SVGCircleElement | null {
  return container.querySelector("circle[stroke-dasharray]");
}

/** What fraction of the circumference the value arc covers. */
function drawn(container: HTMLElement): number {
  const c = arc(container);
  if (!c) return 0;
  const [len, gap] = (c.getAttribute("stroke-dasharray") ?? "")
    .split(" ")
    .map(Number);
  return len / (len + gap);
}

describe("ProgressRing", () => {
  it("rounds the percentage the way the fraction beside it reads", () => {
    const { container } = render(<ProgressRing value={2} total={9} />);
    // 22.2%, and the rail prints "2/9" next to it.
    expect(container.querySelector("text")!.textContent).toBe("22%");
    expect(drawn(container)).toBeCloseTo(0.22, 2);
  });

  it("draws nothing at all at zero", () => {
    // A `0 C` dasharray still paints a dot under a round linecap, which reads
    // as 1% rather than as none.
    const { container } = render(<ProgressRing value={0} total={4} />);
    expect(arc(container)).toBeNull();
    expect(container.querySelector("text")!.textContent).toBe("0%");
  });

  it("survives a zero denominator", () => {
    const { container } = render(<ProgressRing value={0} total={0} />);
    expect(container.querySelector("text")!.textContent).toBe("0%");
    expect(arc(container)).toBeNull();
  });

  it("cannot overdraw past the whole circle", () => {
    // Data, not a caller, is the likely source: the two counts come from
    // different subqueries and a stale one could exceed the other.
    const { container } = render(<ProgressRing value={12} total={9} />);
    expect(drawn(container)).toBeCloseTo(1, 5);
    expect(container.querySelector("text")!.textContent).toBe("100%");
  });

  it("says what the fraction is of, since the digits do not", () => {
    render(
      <ProgressRing value={2} total={9} label="2 of 9 phases signed off" />,
    );
    expect(
      screen.getByRole("img", { name: "2 of 9 phases signed off" }),
    ).toBeInTheDocument();
  });

  it("falls back to a spoken label rather than none", () => {
    render(<ProgressRing value={3} total={4} />);
    expect(
      screen.getByRole("img", { name: "3 of 4 complete" }),
    ).toBeInTheDocument();
  });
});
