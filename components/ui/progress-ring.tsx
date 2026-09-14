/**
 * A small completion ring with its percentage inside it.
 *
 * Lifted from the AMS work-mix donut (`components/ams/client-view.tsx`), which
 * is the only ring the app had and is private to that card: two stroke arcs on
 * one circle, `strokeDasharray` for the value, `rotate(-90)` so zero starts at
 * twelve o'clock. No library, and it scales cleanly at any size.
 *
 * TWO DIFFERENCES FROM THAT DONUT, both because of where this goes.
 *
 * It is 34px in a 268px rail rather than 108px in a card, so the arcs are drawn
 * in a 40-unit viewBox and scaled down — the stroke geometry stays in round
 * numbers and the text inside stays legible at whatever size the caller picks.
 *
 * It carries the number. A donut beside a legend does not need one; a ring in a
 * list row has no legend, and "some of it is filled" is not a number anyone can
 * act on. The percentage is inside rather than beside it because the rail is
 * 268px wide and shrinks to 200, and a separate label would be the first thing
 * to collide with the client's name.
 *
 * `role="img"` with a spoken label, because the ring and the digits say the
 * same thing twice and the digits alone ("22") do not say what of.
 */
export function ProgressRing({
  value,
  total,
  size = 34,
  label,
}: {
  /** The numerator. Clamped into `total`, so bad data cannot overdraw the arc. */
  value: number;
  total: number;
  size?: number;
  /** Spoken. Defaults to "<value> of <total> complete". */
  label?: string;
}) {
  const safeTotal = Math.max(0, Math.round(total));
  const safeValue = Math.min(Math.max(0, Math.round(value)), safeTotal);
  const pct = safeTotal > 0 ? Math.round((safeValue / safeTotal) * 100) : 0;

  // Three digits do not fit beside a percent sign at the two-digit size.
  const fs = pct >= 100 ? 9 : 11;

  const R = 16;
  const C = 2 * Math.PI * R;
  const done = (pct / 100) * C;

  return (
    <svg
      viewBox="0 0 40 40"
      style={{ width: size, height: size }}
      className="shrink-0"
      role="img"
      aria-label={label ?? `${safeValue} of ${safeTotal} complete`}
    >
      <g transform="rotate(-90 20 20)">
        <circle
          cx={20}
          cy={20}
          r={R}
          fill="none"
          // `--k-line`, not `--k-line-2`: the inner-divider token is #f4f4f5 in
          // light mode and an unfilled ring drawn in it all but disappears on
          // white. The structural hairline reads as an empty track in both
          // themes, which is what a ring at 0% has to be able to say.
          stroke="var(--k-line)"
          strokeWidth={5}
        />
        {/* Zero draws no arc at all. A dasharray of `0 C` still paints a dot
            under a round linecap, which reads as 1% rather than as none. */}
        {done > 0 && (
          <circle
            cx={20}
            cy={20}
            r={R}
            fill="none"
            stroke="var(--k-fill-ok)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={`${done} ${C - done}`}
          />
        )}
      </g>
      {/* THE SIGN IS NOT DECORATION. Alone in a list row that also reads
          "2/9 signed off", a bare "22" is a second number with no unit and
          invites being read as a count. It shrinks with the digits so that
          100% still clears the 27-unit hole inside the stroke. */}
      <text
        x={20}
        y={20}
        textAnchor="middle"
        dominantBaseline="central"
        className="k-mono"
        // A percentage the ring already shows; the digits are there to make it
        // exact, not to be read first, so they sit at `--k-mute` weight.
        fill="var(--k-mute)"
        fontSize={fs}
        fontWeight={600}
      >
        {pct}
        <tspan fontSize={fs * 0.78}>%</tspan>
      </text>
    </svg>
  );
}
