import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * The index screen — but on a desktop it is the landing redirect that renders
 * behind this, and that goes to a client's table. Shaped for where the common
 * path ends up rather than for the card grid only a phone will see, so the
 * three skeletons on the way through do not swap shape mid-navigation.
 */
export default function Loading() {
  return <PageSkeleton shape="table" rows={9} />;
}
