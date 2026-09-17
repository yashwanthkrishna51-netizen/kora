import { TrackerIndex } from "@/components/tracker-index";
import { TrackerLanding } from "@/components/tracker-landing";

/**
 * NO `clientTreesQuery()` PREFETCH HERE.
 *
 * On a desktop `TrackerLanding` redirects away from this route before the index
 * ever renders, so server-rendering the 95 kB client tree would mean every
 * landing paid for a payload it throws away. The index still needs it below
 * 768px, where it is the only client picker, and fetches it itself when it
 * actually renders.
 */
export default function Page() {
  return (
    <TrackerLanding domain="integrations">
      <TrackerIndex domain="integrations" />
    </TrackerLanding>
  );
}
