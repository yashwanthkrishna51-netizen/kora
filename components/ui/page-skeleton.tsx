/**
 * The shape of a screen, before the screen exists.
 *
 * This is what a `loading.tsx` renders, which makes it different from
 * `DelayedSkeleton` in two ways worth stating, because copying that component's
 * behaviour here would be a mistake.
 *
 * NO DELAY. `DelayedSkeleton` waits 200ms on purpose: a query served from cache
 * resolves in ~5ms, and a skeleton that appears and disappears inside one frame
 * reads as a glitch. That reasoning does not transfer to navigation. On a route
 * change the previous screen is already gone, so a delayed fallback is not a
 * calmer skeleton — it is a blank page. These paint immediately.
 *
 * NO JAVASCRIPT. A server component with no hooks, so it is part of the static
 * shell Next streams before any async work resolves, and part of the payload
 * `<Link>` prefetches. That is the whole point: the click has to produce
 * something on screen without waiting for a database on another continent.
 *
 * It mirrors `.k-page` and the real header/table rhythm so nothing jumps when
 * the content arrives.
 */

function Bar({ w, h = 12 }: { w: number | string; h?: number }) {
  return <div className="k-skeleton" style={{ width: w, height: h }} />;
}

/** Title, meta line, and the action buttons every tracker screen carries. */
function Header() {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <Bar w="min(280px, 60%)" h={22} />
        <div className="mt-2.5 flex flex-wrap items-center gap-3">
          <Bar w={120} />
          <Bar w={92} />
          <Bar w={104} />
        </div>
      </div>
      <div className="flex gap-2">
        <Bar w={88} h={30} />
        <Bar w={104} h={30} />
      </div>
    </header>
  );
}

/** A table with its header row — the integrations, AMS and audit screens. */
function TableBlock({ rows }: { rows: number }) {
  return (
    <div className="k-card mt-4 overflow-hidden">
      <div className="flex items-center gap-4 border-b border-k-line-2 px-3.5 py-2.5">
        <Bar w="34%" h={9} />
        <Bar w="15%" h={9} />
        <Bar w="14%" h={9} />
        <Bar w="12%" h={9} />
        <Bar w="12%" h={9} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-k-line-2 px-3.5 py-3 last:border-b-0"
        >
          {/* The first column is a title over a sub-line, as the real rows are,
              so the row height matches and the list does not reflow. */}
          <div className="min-w-0" style={{ width: "34%" }}>
            <Bar w={i % 3 === 0 ? "78%" : "56%"} h={11} />
            <div className="mt-1.5">
              <Bar w="38%" h={8} />
            </div>
          </div>
          <Bar w="15%" h={26} />
          <Bar w="14%" h={26} />
          <Bar w="12%" h={11} />
          <Bar w="12%" h={11} />
        </div>
      ))}
    </div>
  );
}

/** The tracker index screens: a grid of client cards. */
function CardsBlock({ rows }: { rows: number }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="k-card p-4">
          <Bar w="62%" h={13} />
          <div className="mt-2">
            <Bar w="40%" h={9} />
          </div>
          <div className="mt-3.5">
            <Bar w="100%" h={6} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The dashboard's six-up KPI strip, on the same grid as the real one. */
function KpiBlock() {
  return (
    <div className="k-kpi-strip mt-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="k-card p-3.5">
          <Bar w={44} h={22} />
          <div className="mt-2">
            <Bar w="70%" h={9} />
          </div>
          <div className="mt-1.5">
            <Bar w="50%" h={8} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton({
  shape = "table",
  rows = 8,
  chips = false,
}: {
  shape?: "table" | "cards" | "kpi";
  /** Rows for `table`, cards for `cards`. Ignored by `kpi`. */
  rows?: number;
  /** The status filter row the tracker detail screens carry above their table. */
  chips?: boolean;
}) {
  return (
    <div className="k-page" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      <Header />

      {chips && (
        <div className="mt-4 flex flex-wrap gap-2" aria-hidden>
          {[46, 82, 74, 118, 94].map((w, i) => (
            <Bar key={i} w={w} h={26} />
          ))}
        </div>
      )}

      <div aria-hidden>
        {shape === "kpi" && (
          <>
            <KpiBlock />
            <TableBlock rows={rows} />
          </>
        )}
        {shape === "cards" && <CardsBlock rows={rows} />}
        {shape === "table" && <TableBlock rows={rows} />}
      </div>
    </div>
  );
}
