import { activityItem } from "@/lib/api/activity-routes";

export const runtime = "nodejs";

const handlers = activityItem<{ phaseId: string; entryId: string }>(
  "phase",
  (p) => p.phaseId,
  (p) => p.entryId,
);

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
