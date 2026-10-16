import { Schema as EffectSchema } from "effect";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * issue-wire.ts -- a workspace's issues, as the desktop lists, reads, files, and changes them.
 *
 * An issue is one piece of work a workspace tracks: a title, a Markdown
 * description, where it stands, and how much it matters. It belongs to its
 * workspace, so every member reads and changes every issue of it, and an
 * account outside the workspace reads none of it. Each issue is numbered
 * from one inside its workspace as it is filed, and the number is never
 * reused, so the identifier a window draws from it names one issue for
 * good. An issue is archived rather than deleted: an archived one leaves the
 * list unless the list asks for archived issues, and may be brought back.
 *
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added. Declared directly with Effect's `Schema.Struct` and
 * exported under its own name.
 */

export const ISSUE_BOUNDS = {
  /** The most characters a title may spell, trimmed: a line of the list. */
  MAX_TITLE_CHARS: 200,
  /** The most characters a description may spell: room for a long write-up, never a log. */
  MAX_DESCRIPTION_CHARS: 20_000,
  /** The most issues one list answers, the most recently changed first. */
  MAX_ISSUES_READ: 500,
} as const;

/** Where an issue stands. */
export const ISSUE_STATUS = {
  BACKLOG: "backlog",
  TODO: "todo",
  IN_PROGRESS: "in-progress",
  DONE: "done",
  CANCELED: "canceled",
} as const;

export type IssueStatus = (typeof ISSUE_STATUS)[keyof typeof ISSUE_STATUS];

/** The order a list draws its statuses in: the work under way first, the work settled last. */
export const ISSUE_STATUS_ORDER: readonly IssueStatus[] = [
  ISSUE_STATUS.IN_PROGRESS,
  ISSUE_STATUS.TODO,
  ISSUE_STATUS.BACKLOG,
  ISSUE_STATUS.DONE,
  ISSUE_STATUS.CANCELED,
];

/** How much an issue matters; none is an issue no one has weighed yet. */
export const ISSUE_PRIORITY = {
  NONE: "none",
  URGENT: "urgent",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type IssuePriority = (typeof ISSUE_PRIORITY)[keyof typeof ISSUE_PRIORITY];

/** Where a priority sorts inside its status, lowest first: urgent at the top, an unweighed issue at the foot. */
export const ISSUE_PRIORITY_RANK = {
  [ISSUE_PRIORITY.URGENT]: 0,
  [ISSUE_PRIORITY.HIGH]: 1,
  [ISSUE_PRIORITY.MEDIUM]: 2,
  [ISSUE_PRIORITY.LOW]: 3,
  [ISSUE_PRIORITY.NONE]: 4,
} as const satisfies Record<IssuePriority, number>;

export const issueStatusSchema = EffectSchema.Literals(Object.values(ISSUE_STATUS));

export const issuePrioritySchema = EffectSchema.Literals(Object.values(ISSUE_PRIORITY));

const titleSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(ISSUE_BOUNDS.MAX_TITLE_CHARS),
);

const descriptionSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(ISSUE_BOUNDS.MAX_DESCRIPTION_CHARS),
);

/**
 * One issue: its workspace and its number there, what it says, where it
 * stands, who filed it, null where they are gone, and when it was archived,
 * null while it is not. Instants are epoch milliseconds.
 */
export const issueSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  workspaceId: EffectSchema.String,
  number: EffectSchema.Int.check(EffectSchema.isGreaterThanOrEqualTo(1)),
  title: EffectSchema.String,
  description: EffectSchema.String,
  status: issueStatusSchema,
  priority: issuePrioritySchema,
  creator: EffectSchema.NullOr(memberRefSchema),
  archivedAt: EffectSchema.NullOr(countedNumber),
  createdAt: countedNumber,
  updatedAt: countedNumber,
});

export type Issue = typeof issueSchema.Type;

/** A workspace's issues, the most recently changed first (GET). */
export const issueListAnswerSchema = EffectSchema.Struct({
  issues: EffectSchema.Array(issueSchema),
});

/** One issue, as a read or a write answers it. */
export const issueAnswerSchema = EffectSchema.Struct({
  issue: issueSchema,
});

/**
 * An issue to file (POST): the workspace it is filed in and its title, and
 * its description, status, and priority where given; an issue filed with
 * none of those is an empty one in the backlog, unweighed.
 */
export const issueCreateRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  title: titleSchema,
  description: EffectSchema.optionalKey(descriptionSchema),
  status: EffectSchema.optionalKey(issueStatusSchema),
  priority: EffectSchema.optionalKey(issuePrioritySchema),
});

/** Whether a change names anything to change: one that names nothing is refused rather than answered unchanged. */
function changeNamesAField(change: {
  title?: string;
  description?: string;
  status?: IssueStatus;
  priority?: IssuePriority;
  archived?: boolean;
}): boolean {
  return Object.keys(change).length > 0;
}

/**
 * A change to an issue (PATCH): any of its title, description, status, and
 * priority, a field left out standing as it was, and whether it is
 * archived; at least one of them.
 */
export const issueChangeRequestSchema = EffectSchema.Struct({
  title: EffectSchema.optionalKey(titleSchema),
  description: EffectSchema.optionalKey(descriptionSchema),
  status: EffectSchema.optionalKey(issueStatusSchema),
  priority: EffectSchema.optionalKey(issuePrioritySchema),
  archived: EffectSchema.optionalKey(EffectSchema.Boolean),
}).check(EffectSchema.makeFilter(changeNamesAField));
