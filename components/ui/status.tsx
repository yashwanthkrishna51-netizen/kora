import {
  STATUS_COLORS,
  RAG_COLORS,
  QUERY_LEVEL_COLORS,
} from "@/lib/domain/constants";
import type { Rag, Status } from "@/lib/domain/types";

/**
 * Status, RAG and severity, rendered.
 *
 * THE ONE RULE THESE ENCODE: every hue exists as a saturated `fill` and a
 * darkened `text` variant, and a fill is never used as text. The fills are
 * chosen to read as blocks of colour — dots, bars, cell backgrounds — and
 * several of them (#88B787 green, #F59E0B amber, #A1A1AA neutral) fail AA
 * against white at body size. The handoff makes this a hard rule; putting it
 * in a component is the only way it survives ten screens.
 *
 * So: `fill` for the dot, `text` for the label, `tint` for the pill behind
 * both. A caller never picks a colour.
 */

/** Status as a tinted pill with a leading dot. */
export function StatusPill({
  status,
  size = "md",
}: {
  status: Status | string;
  size?: "sm" | "md";
}) {
  // An unrecognised status is possible — v1 stored free text in places — and
  // must render as itself rather than vanish or throw. Neutral is the honest
  // colour for "this is not one of the ten we know".
  const c = STATUS_COLORS[status as Status] ?? STATUS_COLORS["Not Started"];

  return (
    <span
      className="k-status"
      style={{
        background: c.tint,
        color: c.text,
        fontSize: size === "sm" ? 10 : 11,
        padding: size === "sm" ? "1px 6px" : "2px 8px",
      }}
    >
      <span
        aria-hidden
        className="inline-block shrink-0 rounded-full"
        style={{ width: 6, height: 6, background: c.fill }}
      />
      {status}
    </span>
  );
}

/**
 * A RAG dot.
 *
 * Carries its label as text for screen readers rather than as `title`, because
 * colour alone is not an accessible signal and a tooltip is not read out. The
 * visible dot has an inset ring — added during the contrast audit, since a
 * 8px dot of #88B787 on white is below 3:1 and the three RAG states were
 * otherwise distinguishable only by hue.
 */
export function RagDot({ rag, size = 8 }: { rag: Rag; size?: number }) {
  const c = RAG_COLORS[rag];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        // `.k-dot` rather than the ring inline: the class carries a
        // `.dark` variant that lightens the ring, and an inline box-shadow
        // beats it — so on a dark ground the ring was black on black and the
        // dot lost the very edge the contrast audit added it for. Size and
        // fill stay inline, where they vary.
        className="k-dot"
        style={{ width: size, height: size, background: c.fill }}
      />
      <span className="sr-only">{rag}</span>
    </span>
  );
}

/** RAG as a labelled pill, where the word matters as much as the colour. */
export function RagPill({ rag }: { rag: Rag }) {
  const c = RAG_COLORS[rag];
  return (
    <span className="k-status" style={{ color: c.text }}>
      <span
        aria-hidden
        className="k-dot"
        style={{ width: 6, height: 6, background: c.fill }}
      />
      {rag}
    </span>
  );
}

/** AMS severity (L1–L4), which reuses the status hues per handoff §9. */
export function QueryLevelPill({ level }: { level: string | null }) {
  if (!level) return <span className="text-k-mute">—</span>;
  const c = QUERY_LEVEL_COLORS[level] ?? STATUS_COLORS["Not Started"];
  return (
    <span
      className="k-status"
      style={{ background: c.tint, color: c.text, fontSize: 10 }}
    >
      {level}
    </span>
  );
}
