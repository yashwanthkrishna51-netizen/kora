import { z } from "zod";
import {
  STATUSES,
  MILESTONE_STATUSES,
  AMS_TYPES,
  AMS_QUERY_LEVELS,
  AMS_ENTRY_STATUSES,
  AMS_MODES,
  PHASES,
} from "@/lib/domain/constants";
import { idSchema } from "./ids";

/**
 * Request schemas for every write.
 *
 * The old app validated ids and passwords and took the rest on trust: a status
 * was whatever string the browser sent, so a typo or a stale build could write
 * a value no filter matched, and the record quietly disappeared from every
 * view that filtered on status. Enumerations are closed here for that reason,
 * not for tidiness.
 *
 * Three conventions throughout:
 *
 *   CREATE schemas omit `id`. Ids are minted server-side — see ids.ts.
 *
 *   UPDATE schemas are `.partial()` over the same fields, so a PATCH carries
 *   only what changed. An empty patch is rejected rather than treated as a
 *   no-op save, because it is always a client bug and it would still bump the
 *   OCC token and invalidate everyone else's copy for no reason.
 *
 *   `.strict()` everywhere. An unknown key is a 400, not something silently
 *   dropped: it is how a renamed field gets noticed in a day rather than after
 *   a month of writes that quietly did nothing.
 */

/** Dates are stored in `date` columns; the wire format is plain YYYY-MM-DD. */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Not a real date");

const optionalDate = dateString.nullish();

/** Free text. Capped so one paste cannot make a row nobody can load. */
const text = (max: number) => z.string().max(max);

const money = z
  .number()
  .nonnegative("Cannot be negative")
  .finite()
  .max(1_000_000_000);

const hours = z
  .number()
  .nonnegative("Cannot be negative")
  .finite()
  // A single entry above this is a data-entry slip (a date typed into an hours
  // box), and it silently wrecks the AMS pool arithmetic for the whole month.
  .max(10_000, "That many hours is almost certainly a mistake");

/* ---------------------------------------------------------------- clients */

export const clientCreate = z
  .object({
    name: text(200).trim().min(1, "Name is required"),
    description: text(4000).optional(),
    currency: z.enum(["INR", "USD"]).optional(),
    masterAssignee: text(120).nullish(),
    manDayRate: money.nullish(),
    totalAvailableHours: hours.nullish(),
    // Domain membership is explicit now. In v1 it was carried by whether the
    // `modules` / `workLog` keys existed at all, which is how six clients came
    // within one migration of vanishing from their domain view.
    hasImplementation: z.boolean().optional(),
    hasAms: z.boolean().optional(),
  })
  .strict();

export const clientUpdate = clientCreate.partial().strict();

/* ----------------------------------------------------------- integrations */

export const integrationCreate = z
  .object({
    name: text(200).trim().min(1, "Name is required"),
    status: z.enum(STATUSES as [string, ...string[]]).optional(),
    assignee: text(120).nullish(),
    dueDate: optionalDate,
    description: text(4000).optional(),
    nextAction: text(2000).optional(),
    effortWeight: z.number().positive().max(100).optional(),
  })
  .strict();

export const integrationUpdate = integrationCreate.partial().strict();

/* ------------------------------------------------------------- milestones */

export const milestoneCreate = z
  .object({
    integrationId: idSchema,
    name: text(200).trim().min(1, "Name is required"),
    status: z.enum(MILESTONE_STATUSES as [string, ...string[]]).optional(),
    dueDate: optionalDate,
    owner: text(120).nullish(),
    notes: text(4000).optional(),
  })
  .strict();

// integrationId is deliberately not updatable: moving a milestone between
// integrations would also have to move it between clients, and nothing in the
// UI offers it. Delete and recreate instead.
export const milestoneUpdate = milestoneCreate.omit({ integrationId: true })
  .partial()
  .strict();

/* ---------------------------------------------------------------- modules */

export const moduleCreate = z
  .object({ name: text(200).trim().min(1, "Name is required") })
  .strict();

export const moduleUpdate = moduleCreate.partial().strict();

/* ----------------------------------------------------------------- phases */

/**
 * Phases are never created or deleted through the API.
 *
 * A module has exactly the nine fixed phases, created with it in the same
 * transaction. Allowing a tenth, or the removal of one, would break the
 * Implementation matrix, which is a fixed 9-column grid.
 */
export const phaseUpdate = z
  .object({
    status: z.enum(STATUSES as [string, ...string[]]),
    assignee: text(120).nullish(),
    startDate: optionalDate,
    targetDate: optionalDate,
    currentActivity: text(4000),
    nextAction: text(2000),
  })
  .partial()
  .strict();

export const phaseNameSchema = z.enum(PHASES);

/* -------------------------------------------------------------- work log */

export const workLogCreate = z
  .object({
    dateRaised: dateString,
    dueDate: optionalDate,
    raisedBy: text(120).nullish(),
    module: text(200).nullish(),
    project: text(200).nullish(),
    description: text(4000).optional(),
    type: z.enum(AMS_TYPES).nullish(),
    queryLevel: z.enum(AMS_QUERY_LEVELS).nullish(),
    entryStatus: z.enum(AMS_ENTRY_STATUSES as [string, ...string[]]).optional(),
    ragStatus: z.enum(["Green", "Amber", "Red"]).nullish(),
    modeOfSupport: z.enum(AMS_MODES).nullish(),
    dependencies: text(4000).optional(),
    solution: text(4000).optional(),
    hours: hours.optional(),
  })
  .strict();

export const workLogUpdate = workLogCreate.partial().strict();

/* -------------------------------------------------------------- activity */

/**
 * One entry in an activity feed.
 *
 * `addedBy` and the timestamp are set server-side from the session, never
 * accepted from the client — otherwise anyone could post as anyone, in a feed
 * whose whole purpose is attribution.
 */
export const activityCreate = z
  .object({
    update: text(8000).trim().min(1, "Write something first"),
    attachment: z
      .object({
        storagePath: text(500).min(1),
        fileName: text(300).min(1),
        mimeType: text(200).optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
      })
      .strict()
      .nullish(),
  })
  .strict();

export const activityUpdate = activityCreate.strict();

/* ------------------------------------------------------------------ users */

export const userCreate = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "At least 3 characters")
      .max(64)
      .regex(/^[A-Za-z0-9._-]+$/, "Letters, numbers, dot, dash and underscore only"),
    name: text(120).trim().min(1, "Name is required"),
    email: z.email("Enter a valid email address").max(200).or(z.literal("")),
    role: z.enum(["viewer", "editor", "admin"]),
    // Plaintext, hashed server-side at cost 12. A `passwordHash` from the
    // client is never accepted: the old app took one on trust, which turned
    // any stolen admin session into a harvest of every hash in the table.
    password: z.string().min(8, "At least 8 characters").max(200),
  })
  .strict();

export const userUpdate = userCreate
  .partial()
  // Username is immutable: it is the login identifier and it appears verbatim
  // in every audit row already written. Renaming it would silently detach a
  // person from their own history.
  .omit({ username: true })
  .strict();

/* ---------------------------------------------------------- client email */

/**
 * A message to a client, with the generated report attached.
 *
 * `cc` is capped here rather than in the rate limiter: a send is a send
 * regardless of how many people it copies, but an unbounded cc list turns one
 * "email" into a mass mailing from the company mailbox.
 */
export const clientEmailSend = z
  .object({
    /**
     * Which client this report is about. Optional, and the NAME is never taken
     * from the caller — the route looks it up.
     *
     * v1 sent `clientName` as a string and wrote it straight into the audit
     * row, so the record of an outbound email was labelled with whatever the
     * browser said. Sending an id instead means the audit row names the client
     * the server can verify, and a wrong id yields no label rather than a
     * convincing wrong one.
     */
    clientId: z.string().max(64).optional(),
    to: z.email("Enter a valid email address").max(200),
    cc: z.array(z.email().max(200)).max(5, "At most 5 cc recipients").optional(),
    // CR/LF stripped because this reaches a mail header. Graph builds the
    // header from JSON so header injection is not reachable today, but the
    // property should hold at this layer rather than depend on the transport.
    subject: z
      .string()
      .trim()
      .min(1, "Add a subject")
      .max(200)
      .transform((s) => s.replace(/[\r\n]+/g, " ")),
    bodyText: z.string().trim().min(1, "Write a message").max(20_000),
    attachment: z
      .object({
        fileName: text(200).min(1),
        /** base64. Capped at 12MB encoded, matching the old handler. */
        contentBase64: z.string().max(12 * 1024 * 1024, "That attachment is too large"),
      })
      .strict()
      .optional(),
  })
  .strict();

/* -------------------------------------------------------------- settings */

export const capacityWeightsUpdate = z
  .object({
    module: z.number().nonnegative().max(100),
    pmo: z.number().nonnegative().max(100),
    ams: z.number().nonnegative().max(100),
    cap: z.number().positive().max(1000),
  })
  .strict();

export const digestRecipientsUpdate = z
  .object({
    emails: z.array(z.email().max(200)).max(50),
  })
  .strict();

/**
 * Rejects a PATCH that would change nothing.
 *
 * Applied to every update schema. A no-op still takes the write path, bumps
 * `updated_at` and invalidates the OCC token every other open tab is holding,
 * so it produces spurious conflicts for a request that had no content.
 */
export function assertNonEmptyPatch<T extends object>(patch: T): T {
  if (Object.keys(patch).length === 0) {
    throw new z.ZodError([
      {
        code: "custom",
        path: [],
        message: "Nothing to update",
        input: patch,
      },
    ]);
  }
  return patch;
}
