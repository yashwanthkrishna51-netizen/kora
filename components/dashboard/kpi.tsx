import Link from "next/link";

/**
 * A KPI card, with the handoff's `border-left: 3px` accent.
 *
 * The accent is the only place a saturated fill touches this card, and it is a
 * 3px bar — graphical, so a fill is right. The number and the label are both
 * text and take text tokens.
 */
export function Kpi({
  label,
  value,
  accent,
  sub,
  href,
  size = 28,
}: {
  label: string;
  value: string | number;
  /** A CSS colour for the left rule. */
  accent: string;
  sub?: React.ReactNode;
  href?: string;
  size?: number;
}) {
  // VALUE FIRST, per artboard 1b. The label used to sit above it as a 10px
  // uppercase eyebrow; six tiles read left-to-right as a strip of numbers, and
  // putting the number first is what makes them scannable as one row rather
  // than six little headed cards.
  const inner = (
    <>
      <span className="k-num block leading-none" style={{ fontSize: size }}>
        {value}
      </span>
      <span className="mt-[7px] block text-[11px] leading-[1.35] text-k-mute">
        {label}
      </span>
      {sub && (
        <span className="mt-1 block text-[11px] text-k-mute-2">{sub}</span>
      )}
    </>
  );

  const className = "k-card block px-4 py-3.5" + (href ? " k-card-hover" : "");
  const style = { borderLeft: `3px solid ${accent}` };

  return href ? (
    <Link href={href} className={className} style={style}>
      {inner}
    </Link>
  ) : (
    <div className={className} style={style}>
      {inner}
    </div>
  );
}

/**
 * The 6-up strip. Collapses to 3 then 2 rather than scrolling sideways.
 *
 * The 6-up engages at 1180px — the artboard's own width, and the width the page
 * is capped to — rather than at `xl`'s 1280. Between the two the strip was
 * wrapping to two rows of three tall, mostly-empty tiles on a page that already
 * had room for all six.
 */
export function KpiStrip({ children }: { children: React.ReactNode }) {
  return <div className="k-kpi-strip">{children}</div>;
}
