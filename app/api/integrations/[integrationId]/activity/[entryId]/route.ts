import { activityItem } from "@/lib/api/activity-routes";

export const runtime = "nodejs";

const handlers = activityItem<{ integrationId: string; entryId: string }>(
  "integration",
  (p) => p.integrationId,
  (p) => p.entryId,
);

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
