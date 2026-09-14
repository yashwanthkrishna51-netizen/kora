import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * The fallback for a SECTION change — Dashboard to Integrations, and so on.
 *
 * It has to live here, one level above the trackers, because a `loading.tsx`
 * wraps `page.tsx` and any NESTED layouts but never the layout in its own
 * segment. `TrackerFrame` awaits the client list and the user list, so a
 * `loading.tsx` inside `integrations/` could not cover it — Next's own docs are
 * explicit: "Navigation blocks until the layout finishes rendering, and the
 * loading.js fallback will not be shown."
 *
 * Deliberately generic. This is on screen for the length of one server render
 * and it stands in for four different screens; a shape that guessed wrong would
 * be worse than a shape that does not guess.
 */
export default function Loading() {
  return <PageSkeleton shape="table" rows={7} />;
}
