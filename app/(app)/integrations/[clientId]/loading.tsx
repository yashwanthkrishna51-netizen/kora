import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * Clicking a client in the rail is the most frequent navigation in the app, and
 * this is the boundary that makes it feel like one. It sits below the tracker
 * layout, so the rail keeps its scroll position and its filter text while the
 * content beside it is replaced.
 */
export default function Loading() {
  return <PageSkeleton shape="table" rows={8} chips={true} />;
}
