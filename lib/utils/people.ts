/**
 * A person's initials, for a chip or a grid cell.
 *
 * Extracted from `Avatar`, where it had been written inline, because the
 * implementation matrix now needs the same two letters in every cell and two
 * copies of a transform this small drift in ways nobody notices — one of them
 * starts handling "de Silva" or a trailing space differently and the same
 * person appears under two labels on two screens.
 *
 * Two letters at most: a grid cell is ~90px wide and three initials at the size
 * that fits are no longer readable. The `?` fallback is deliberate — an empty
 * chip reads as a rendering fault, a `?` reads as missing data.
 */
export function initials(name: string | null | undefined): string {
  return (
    (name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}
