import { activityCollection } from "@/lib/api/activity-routes";

export const runtime = "nodejs";

export const POST = activityCollection<{ integrationId: string }>(
  "integration",
  (p) => p.integrationId,
);
