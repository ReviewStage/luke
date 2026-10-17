import { Schema as EffectSchema } from "effect";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { TASK_BOUNDS } from "./task-wire.js";

/**
 * plan-comment-wire.ts -- comments on a task's plan on the wire: a thread anchored to words of the plan, its comments and what happened to it, and what a member sends to start, answer, resolve, and reopen one.
 *
 * A thread is anchored to a stretch of the plan's text: words a member
 * selected, or a whole block (a paragraph, a list, a heading) they commented
 * beside. The service keeps the anchor as offsets into the plan's Markdown
 * beside the thread, never in the text itself, and moves it with its words
 * on every save (`plan-comment-anchor.ts`); a thread whose words were
 * deleted keeps its quote and stands with no anchor, which the window says
 * as "Original content deleted". A thread's entries are its comments, and
 * the lines of what happened to it in between: who asked Luke or a coding
 * agent to read it, and who resolved or reopened it. Posting a comment asks
 * no one anything.
 *
 * Every member of the plan's workspace reads and writes every thread, and
 * every agent on the task does through its tools; resolving and reopening
 * need nothing more. A comment is edited or deleted only by its writer, and
 * a whole thread is deleted by any member.
 */

export const PLAN_COMMENT_BOUNDS = {
  /** The longest one comment may be. */
  MAX_WORDS_CHARS: 8_000,
  /** The longest quote a thread keeps of the words it was anchored to. */
  MAX_QUOTE_CHARS: 2_000,
  /** The most threads one plan may hold, resolved ones among them. */
  MAX_THREADS_PER_PLAN: 500,
  /** The most comments one thread may hold, and the most lines of what happened to it it says. */
  MAX_ENTRIES_PER_THREAD: 200,
  /** The longest key a client sends a write under. */
  MAX_CLIENT_KEY_CHARS: 200,
  /** The longest cursor the service hands back. */
  MAX_CURSOR_CHARS: 200,
} as const;

/** What a thread is anchored to: words a member selected, or a whole block they commented beside. */
export const PLAN_COMMENT_SCOPE = {
  WORDS: "words",
  BLOCK: "block",
} as const;

export type PlanCommentScope = (typeof PLAN_COMMENT_SCOPE)[keyof typeof PLAN_COMMENT_SCOPE];

/** Whether a thread still stands in the margin, or was resolved into the plan's history. */
export const PLAN_COMMENT_STATUS = {
  OPEN: "open",
  RESOLVED: "resolved",
} as const;

export type PlanCommentStatus = (typeof PLAN_COMMENT_STATUS)[keyof typeof PLAN_COMMENT_STATUS];

/** Who wrote an entry: a member of the workspace, Luke, or one of the task's coding agents. */
export const PLAN_COMMENT_ACTOR = {
  MEMBER: "member",
  LUKE: "luke",
  AGENT: "agent",
} as const;

export type PlanCommentActor = (typeof PLAN_COMMENT_ACTOR)[keyof typeof PLAN_COMMENT_ACTOR];

/** What one entry of a thread is: a comment, or a line of what happened to the thread. */
export const PLAN_COMMENT_ENTRY = {
  COMMENT: "comment",
  /** Someone sent the thread to Luke or a coding agent to read and answer. */
  ASKED: "asked",
  RESOLVED: "resolved",
  REOPENED: "reopened",
} as const;

export type PlanCommentEntryKind = (typeof PLAN_COMMENT_ENTRY)[keyof typeof PLAN_COMMENT_ENTRY];

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** A comment's words as written: not blank, and held to the bound. */
export const planCommentWordsSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(PLAN_COMMENT_BOUNDS.MAX_WORDS_CHARS),
  EffectSchema.isPattern(/\S/u),
);

/** A key the client made for one write, so a write sent again after a lost answer is taken once. */
export const planCommentClientKeySchema = filledText(PLAN_COMMENT_BOUNDS.MAX_CLIENT_KEY_CHARS);

/** Where a thread's words stand in the plan's text: offsets into its Markdown. */
export const planCommentSpanSchema = EffectSchema.Struct({
  from: countedNumber,
  to: countedNumber,
});

/**
 * Who wrote an entry: a member, named as the service names one, Luke, or a
 * coding agent by its id, whose name the window reads off the task's agents.
 * An entry whose member's account is gone names no member.
 */
export const planCommentWriterSchema = EffectSchema.Struct({
  actor: EffectSchema.Literals(Object.values(PLAN_COMMENT_ACTOR)),
  by: EffectSchema.optionalKey(memberRefSchema),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type PlanCommentWriter = typeof planCommentWriterSchema.Type;

/** Who a thread was sent to: Luke, or a coding agent by its id. */
export const planCommentAskedSchema = EffectSchema.Struct({
  actor: EffectSchema.Literals([PLAN_COMMENT_ACTOR.LUKE, PLAN_COMMENT_ACTOR.AGENT]),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type PlanCommentAsked = typeof planCommentAskedSchema.Type;

/** One entry of a thread, as the window and the agents read it. */
export const planCommentEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literals(Object.values(PLAN_COMMENT_ENTRY)),
  writer: planCommentWriterSchema,
  /** A comment's words. */
  words: EffectSchema.optionalKey(EffectSchema.String),
  /** Who an ask sent the thread to. */
  asked: EffectSchema.optionalKey(planCommentAskedSchema),
  /** When the entry was written. */
  at: countedNumber,
  /** When a comment's words were last edited, where they were. */
  editedAt: EffectSchema.optionalKey(countedNumber),
});

export type PlanCommentEntry = typeof planCommentEntrySchema.Type;

/** One thread, as the window and the agents read it. */
export const planCommentThreadSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: EffectSchema.Literals(Object.values(PLAN_COMMENT_SCOPE)),
  /** The words the thread was anchored to, as they stood when it was started or last moved. */
  quote: EffectSchema.String,
  /** Where the words stand in the plan's text now; absent once every one of them was deleted. */
  anchor: EffectSchema.optionalKey(planCommentSpanSchema),
  /** The heading of the section the words stand, or last stood, in; empty before the first heading. */
  section: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(PLAN_COMMENT_STATUS)),
  entries: EffectSchema.Array(planCommentEntrySchema),
  createdAt: countedNumber,
  /** When anything about the thread last changed. */
  updatedAt: countedNumber,
  /** Moved on by every change of the thread. */
  revision: countedNumber,
});

export type PlanCommentThread = typeof planCommentThreadSchema.Type;

/** Where a reader of a plan's comments starts: before anything. */
export const PLAN_COMMENTS_CURSOR_START = "0";

/** Where a reader of a plan's comments stands, as the service last handed it back. */
export const planCommentsCursorSchema = filledText(PLAN_COMMENT_BOUNDS.MAX_CURSOR_CHARS);

/** A plan's comments as they stand (GET `/api/plans/{id}/comments`): every thread, oldest first, and the cursor to read on from. */
export const planCommentsAnswerSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(planCommentThreadSchema),
  cursor: EffectSchema.String,
});

export type PlanCommentsAnswer = typeof planCommentsAnswerSchema.Type;

/** A plan's text as a thread's anchor is measured in. */
const ANCHOR_TEXT = EffectSchema.String.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS));

/**
 * A thread started (POST `/api/plans/{id}/comments`): its first comment, the
 * words it is anchored to, and the plan's text the anchor is measured in,
 * which the service carries over to the text as it stands, so a thread
 * started in an editor with words not yet saved lands on the same words.
 */
export const planCommentStartRequestSchema = EffectSchema.Struct({
  clientKey: planCommentClientKeySchema,
  scope: EffectSchema.Literals(Object.values(PLAN_COMMENT_SCOPE)),
  quote: filledText(PLAN_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
  anchor: planCommentSpanSchema,
  text: ANCHOR_TEXT,
  words: planCommentWordsSchema,
});

export type PlanCommentStartRequest = typeof planCommentStartRequestSchema.Type;

/** What a member does to one thread (POST `/api/plans/{id}/comments/{thread}`). */
export const PLAN_COMMENT_ACTION = {
  REPLY: "reply",
  EDIT: "edit",
  DELETE: "delete",
  RESOLVE: "resolve",
  REOPEN: "reopen",
  DELETE_THREAD: "delete-thread",
} as const;

export const planCommentActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({
    action: EffectSchema.Literal(PLAN_COMMENT_ACTION.REPLY),
    clientKey: planCommentClientKeySchema,
    words: planCommentWordsSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PLAN_COMMENT_ACTION.EDIT),
    entry: wireUuidSchema,
    words: planCommentWordsSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(PLAN_COMMENT_ACTION.DELETE),
    entry: wireUuidSchema,
  }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PLAN_COMMENT_ACTION.RESOLVE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PLAN_COMMENT_ACTION.REOPEN) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(PLAN_COMMENT_ACTION.DELETE_THREAD) }),
]);

export type PlanCommentActionRequest = typeof planCommentActionRequestSchema.Type;

/** Why a write to a thread took nothing, answered in band. */
export const PLAN_COMMENT_REFUSAL = {
  /** The plan already holds `PLAN_COMMENT_BOUNDS.MAX_THREADS_PER_PLAN` threads, or the thread its bound of comments. */
  TOO_MANY: "too-many",
  /** The anchor names no words of the text it was measured in, or none of them stand in the plan now. */
  NO_WORDS: "no-words",
  /** The comment is someone else's, which only its writer edits or deletes. */
  NOT_YOURS: "not-yours",
  /** The comment named is not one of the thread's. */
  NO_ENTRY: "no-entry",
  /** The key the reply was sent under already wrote to another thread of the plan. */
  KEY_TAKEN: "key-taken",
} as const;

export type PlanCommentRefusal = (typeof PLAN_COMMENT_REFUSAL)[keyof typeof PLAN_COMMENT_REFUSAL];

/** What a write to a thread answers: the thread as it now stands, that it was deleted, or why nothing was taken. */
export const planCommentThreadAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ thread: planCommentThreadSchema }),
  EffectSchema.Struct({ deleted: wireUuidSchema }),
  EffectSchema.Struct({ refused: EffectSchema.Literals(Object.values(PLAN_COMMENT_REFUSAL)) }),
]);

export type PlanCommentThreadAnswer = typeof planCommentThreadAnswerSchema.Type;

/**
 * Where the open editor's anchors stand in the text a save sends, and the
 * threads the editor carried anchors for: a thread it carried and no longer
 * holds an anchor for had its words deleted there, and one it holds again
 * had them brought back by undo, which no carrying-over of the text alone can
 * tell. A thread the editor never carried is carried over by the text.
 */
export const planCommentAnchorsSchema = EffectSchema.Struct({
  anchors: EffectSchema.Array(
    EffectSchema.Struct({ thread: wireUuidSchema, ...planCommentSpanSchema.fields }),
  ).check(EffectSchema.isMaxLength(PLAN_COMMENT_BOUNDS.MAX_THREADS_PER_PLAN)),
  carried: EffectSchema.Array(wireUuidSchema).check(
    EffectSchema.isMaxLength(PLAN_COMMENT_BOUNDS.MAX_THREADS_PER_PLAN),
  ),
});

export type PlanCommentAnchors = typeof planCommentAnchorsSchema.Type;
