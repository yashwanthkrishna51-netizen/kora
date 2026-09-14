import { activityCollection } from "@/lib/api/activity-routes";

export const runtime = "nodejs";

export const POST = activityCollection<{ phaseId: string }>(
  "phase",
  (p) => p.phaseId,
);
