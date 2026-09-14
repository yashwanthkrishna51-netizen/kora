/**
 * Domain shapes.
 *
 * These mirror the v1 jsonb structures the old app used, because the new API
 * deliberately keeps the same camelCase field names in its DTOs (see the
 * migration plan). The v2 normalized tables map onto these via lib/db/mappers.
 */

export type Rag = "Red" | "Amber" | "Green";

export type Status =
  | "Not Started"
  | "In Progress"
  | "At Risk"
  | "On Hold — Internal"
  | "On Hold — Client"
  | "Pending Client"
  | "Under Review"
  | "Delayed"
  | "Cancelled"
  | "Completed";

export type Role = "viewer" | "editor" | "admin";

export type MilestoneStatus = "Pending" | "Achieved" | "Missed";

export type AmsEntryStatus = "Open" | "In Progress" | "Closed";

export interface Attachment {
  /** Canonical location in the `kora-attachments` bucket. Signed on read. */
  storagePath: string;
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Short-lived signed URL, added by the read path. Never persisted. */
  url?: string;
}

/** A timeline/update entry. Called `timeline` on integrations, `updates` on phases. */
export interface ActivityEntry {
  id: string;
  date: string;
  update: string;
  addedBy: string;
  addedAt?: string;
  editedAt?: string;
  attachment?: Attachment;
  reactions?: string[];
  history?: { at: string; by: string; update: string }[];
}

export interface Milestone {
  id: string;
  name: string;
  status: MilestoneStatus;
  dueDate?: string;
  owner?: string;
  notes?: string;
  /**
   * Optimistic-concurrency token = the row's `updated_at`.
   *
   * Optional because the v1 jsonb had no equivalent and the migration
   * mappers reconstruct this shape without one. Every read through the API
   * supplies it, and every PATCH/DELETE of this entity requires it back as
   * If-Match.
   */
  _v?: string;
}

export interface Integration {
  id: string;
  name: string;
  status: Status;
  assignee?: string;
  dueDate?: string;
  description?: string;
  nextAction?: string;
  effortWeight?: number;
  createdAt?: string;
  timeline?: ActivityEntry[];
  milestones?: Milestone[];
  /**
   * Optimistic-concurrency token = the row's `updated_at`.
   *
   * Optional because the v1 jsonb had no equivalent and the migration
   * mappers reconstruct this shape without one. Every read through the API
   * supplies it, and every PATCH/DELETE of this entity requires it back as
   * If-Match.
   */
  _v?: string;
}

export interface Phase {
  id: string;
  name: string;
  status: Status;
  assignee?: string;
  startDate?: string;
  targetDate?: string;
  currentActivity?: string;
  nextAction?: string;
  updates?: ActivityEntry[];
  /**
   * Optimistic-concurrency token = the row's `updated_at`.
   *
   * Optional because the v1 jsonb had no equivalent and the migration
   * mappers reconstruct this shape without one. Every read through the API
   * supplies it, and every PATCH/DELETE of this entity requires it back as
   * If-Match.
   */
  _v?: string;
}

export interface Module {
  id: string;
  name: string;
  phases?: Phase[];
  /**
   * Optimistic-concurrency token = the row's `updated_at`.
   *
   * Optional because the v1 jsonb had no equivalent and the migration
   * mappers reconstruct this shape without one. Every read through the API
   * supplies it, and every PATCH/DELETE of this entity requires it back as
   * If-Match.
   */
  _v?: string;
}

export interface WorkLogEntry {
  id: string;
  dateRaised?: string;
  /** Legacy alias still present on old rows. */
  date?: string;
  dueDate?: string;
  raisedBy?: string;
  loggedBy?: string;
  module?: string;
  project?: string;
  description?: string;
  type?: string;
  category?: string;
  queryLevel?: string;
  entryStatus?: AmsEntryStatus;
  ragStatus?: Rag;
  modeOfSupport?: string;
  dependencies?: string;
  solution?: string;
  hours?: number;
  loggedAt?: string;
  edits?: { at: string; by: string; changed: string[] }[];
  /**
   * Optimistic-concurrency token = the row's `updated_at`.
   *
   * Optional because the v1 jsonb had no equivalent and the migration
   * mappers reconstruct this shape without one. Every read through the API
   * supplies it, and every PATCH/DELETE of this entity requires it back as
   * If-Match.
   */
  _v?: string;
}

export interface Client {
  id: string;
  name: string;
  description?: string;
  createdAt?: string;
  /** Optimistic-concurrency token = the row's `updated_at`. */
  _v?: string;

  integrations?: Integration[];

  /**
   * Domain membership.
   *
   * In v1 this was encoded as a null-sentinel: `modules === undefined` meant
   * "not in the Implementation domain", while `[]` meant "in-domain, empty".
   * v2 makes it explicit via `hasImplementation` / `hasAms`, because zero child
   * rows can't carry that distinction. Both are present on the DTO so callers
   * can rely on the flag and never re-derive it from array-ness.
   */
  hasImplementation?: boolean;
  hasAms?: boolean;
  modules?: Module[];
  workLog?: WorkLogEntry[];

  manDayRate?: number;
  totalAvailableHours?: number;
  currency?: "INR" | "USD";
  masterAssignee?: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  email?: string;
  role: Role;
  createdAt?: string;
  lockedUntil?: string | null;
  failedAttempts?: number;
  lockoutLevel?: number;
  _v?: string;
}
