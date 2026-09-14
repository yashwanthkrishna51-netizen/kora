import { PageSkeleton } from "@/components/ui/page-skeleton";

/** Six KPI tiles over the critical-items table, on the real `.k-kpi-strip` grid. */
export default function Loading() {
  return <PageSkeleton shape="kpi" rows={6} />;
}
