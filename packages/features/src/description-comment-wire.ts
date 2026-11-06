import { LEGACY_APP_WORD, literalsReadingLegacy } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { agentMessageRequestSchema } from "./agent-wire.js";
import { pageVersionNumberSchema } from "./page-wire.js";
import { chosenIdSchema, countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { TASK_BOUNDS } from "./task-wire.js";
import { filledText } from "./text-schema.js";

/**
 * description-comment-wire.ts -- comments on a task's description on the wire: a thread anchored to words of the description, its comments and what happened to it, and what a member sends to start, answer, resolve, and reopen one.
 *
 * A thread is anchored to a stretch of the description's text: words a member
 * selected, or a whole block (a paragraph, a list, a heading) they commented
 * beside. The service keeps the anchor as offsets into the description's Markdown
 * beside the thread, never in the text itself, and moves it with its words
 * on every save (`description-comment-anchor.ts`); a thread whose words were
 * deleted keeps its quote and stands with no anchor, which the window says
 * as "Original content deleted". A thread's entries are its comments, and
 * the lines of what happened to it in between: who asked the app or a coding
 * agent to read it, and who resolved or reopened it. Posting a comment asks
 * no one anything.
 *
 * A comment may carry files under its words, in the coding agent's file
 * shape: pictures, PDFs, and text files. The service keeps them in the
 * shared attachment table, owned by the comment, and an entry names each by
 * its id, its name, and its type; their bytes are read apart, as a description's
 * picture's are, at `descriptionAttachmentPath`.
 *
 * A thread may instead be on one of the task's pages (`page-wire.ts`): on
 * an element of the version a member was reading, which they picked in the
 * page's frame, or on the page as a whole. It names the page and that
 * version, and the element by its path in it, its quote the element's words
 * as the frame read them, or the version's title for the whole page. A page
 * thread is the task's like any other and is answered, resolved, and
 * reopened the same way, but is read apart from the description's: the description's read
 * holds no page thread, and a page's read holds that page's alone.
 *
 * Every member of the plan's workspace reads and writes every thread, and
 * every agent on the task does through its tools; resolving and reopening
 * need nothing more. A comment is edited or deleted only by its writer, and
 * a whole thread is deleted by any member.
 */

export const DESCRIPTION_COMMENT_BOUNDS = {
  /** The longest one comment may be. */
  MAX_WORDS_CHARS: 8_000,
  /** The longest quote a thread keeps of the words it was anchored to. */
  MAX_QUOTE_CHARS: 2_000,
  /** The most threads one description may hold, resolved ones among them. */
  MAX_THREADS_PER_DESCRIPTION: 500,
  /** The most comments one thread may hold, and the most lines of what happened to it it says. */
  MAX_ENTRIES_PER_THREAD: 200,
  /** The longest key a client sends a write under. */
  MAX_CLIENT_KEY_CHARS: 200,
  /** The longest cursor the service hands back. */
  MAX_CURSOR_CHARS: 200,
  /** The longest path a page thread keeps of the element it is on. */
  MAX_ELEMENT_PATH_CHARS: 1_000,
  /** The longest heading a page thread keeps of the section its element stands in. */
  MAX_SECTION_CHARS: 200,
} as const;

/** What a thread is anchored to: words a member selected or a whole block they commented beside, on the description; an element they picked or the whole of a page, on a page. */
export const DESCRIPTION_COMMENT_SCOPE = {
  WORDS: "words",
  BLOCK: "block",
  ELEMENT: "element",
  PAGE: "page",
} as const;

export type DescriptionCommentScope =
  (typeof DESCRIPTION_COMMENT_SCOPE)[keyof typeof DESCRIPTION_COMMENT_SCOPE];

/** Whether a thread still stands in the margin, or was resolved into the description's history. */
export const DESCRIPTION_COMMENT_STATUS = {
  OPEN: "open",
  RESOLVED: "resolved",
} as const;

export type DescriptionCommentStatus =
  (typeof DESCRIPTION_COMMENT_STATUS)[keyof typeof DESCRIPTION_COMMENT_STATUS];

/** Who wrote an entry: a member of the workspace, the app, or one of the task's coding agents. */
export const DESCRIPTION_COMMENT_ACTOR = {
  MEMBER: "member",
  APP: "app",
  AGENT: "agent",
} as const;

export type DescriptionCommentActor =
  (typeof DESCRIPTION_COMMENT_ACTOR)[keyof typeof DESCRIPTION_COMMENT_ACTOR];

/** Who wrote an entry or was asked in it, as its row stores it. Note that it reads `luke`, which rows from before the app was named `app` hold, as the app (a legacy read). */
export const descriptionCommentActorSchema = literalsReadingLegacy(
  Object.values(DESCRIPTION_COMMENT_ACTOR),
  LEGACY_APP_WORD,
  DESCRIPTION_COMMENT_ACTOR.APP,
);

/** What one entry of a thread is: a comment, or a line of what happened to the thread. */
export const DESCRIPTION_COMMENT_ENTRY = {
  COMMENT: "comment",
  /** Someone sent the thread to the app or a coding agent to read and answer. */
  ASKED: "asked",
  RESOLVED: "resolved",
  REOPENED: "reopened",
} as const;

export type DescriptionCommentEntryKind =
  (typeof DESCRIPTION_COMMENT_ENTRY)[keyof typeof DESCRIPTION_COMMENT_ENTRY];

/** A comment's words as written: not blank, and held to the bound. */
export const descriptionCommentWordsSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_WORDS_CHARS),
  EffectSchema.isPattern(/\S/u),
);

/** A key the client made for one write, so a write sent again after a lost answer is taken once. */
const descriptionCommentClientKeySchema = filledText(
  DESCRIPTION_COMMENT_BOUNDS.MAX_CLIENT_KEY_CHARS,
);

/** Where a thread's words stand in the description's text: offsets into its Markdown. */
const descriptionCommentSpanSchema = EffectSchema.Struct({
  from: countedNumber,
  to: countedNumber,
});

/**
 * Who wrote an entry: a member, named as the service names one, the app, or a
 * coding agent by its id, whose name the window reads off the task's agents.
 * An entry whose member's account is gone names no member.
 */
const descriptionCommentWriterSchema = EffectSchema.Struct({
  actor: descriptionCommentActorSchema,
  by: EffectSchema.optionalKey(memberRefSchema),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type DescriptionCommentWriter = typeof descriptionCommentWriterSchema.Type;

/** Who a thread was sent to: the app, or a coding agent by its id. */
const descriptionCommentAskedSchema = EffectSchema.Struct({
  actor: literalsReadingLegacy(
    [DESCRIPTION_COMMENT_ACTOR.APP, DESCRIPTION_COMMENT_ACTOR.AGENT],
    LEGACY_APP_WORD,
    DESCRIPTION_COMMENT_ACTOR.APP,
  ),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
});

export type DescriptionCommentAsked = typeof descriptionCommentAskedSchema.Type;

/**
 * One file a comment carries, as a reader hears it: the id its bytes are read
 * by, its own name, and the type they are served as, a plain string so a
 * window reads a type added later as a file it cannot draw rather than as a
 * thread it cannot read.
 */
const descriptionCommentFileSchema = EffectSchema.Struct({
  attachmentId: wireUuidSchema,
  name: EffectSchema.String,
  mediaType: EffectSchema.String,
});

export type DescriptionCommentFile = typeof descriptionCommentFileSchema.Type;

/** The files a comment carries as it is written: the files a message to a coding agent may carry, held to the same bounds. */
const descriptionCommentFilesSchema = agentMessageRequestSchema.fields.attachments;

/** One entry of a thread, as the window and the agents read it. */
const descriptionCommentEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_ENTRY)),
  writer: descriptionCommentWriterSchema,
  /** A comment's words. */
  words: EffectSchema.optionalKey(EffectSchema.String),
  /** The files a comment carries, in the order they were attached; absent where it carries none. */
  files: EffectSchema.optionalKey(EffectSchema.Array(descriptionCommentFileSchema)),
  /** Who an ask sent the thread to. */
  asked: EffectSchema.optionalKey(descriptionCommentAskedSchema),
  /** When the entry was written. */
  at: countedNumber,
  /** When a comment's words were last edited, where they were. */
  editedAt: EffectSchema.optionalKey(countedNumber),
});

export type DescriptionCommentEntry = typeof descriptionCommentEntrySchema.Type;

/** The path of an element of a page, as the frame wrote it: a CSS selector from the document's root. */
const descriptionCommentElementPathSchema = filledText(
  DESCRIPTION_COMMENT_BOUNDS.MAX_ELEMENT_PATH_CHARS,
);

/** The page a thread is on, the version it was left on, and the element it is on there, by its path; no element for the whole page. */
const descriptionCommentPageSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  version: pageVersionNumberSchema,
  element: EffectSchema.optionalKey(EffectSchema.String),
});

/** One thread, as the window and the agents read it. */
const descriptionCommentThreadSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  scope: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_SCOPE)),
  /** The words the thread was anchored to, as they stood when it was started or last moved; on a page, its element's words, or the version's title for the whole page. */
  quote: EffectSchema.String,
  /** Where the words stand in the description's text now; absent once every one of them was deleted, and on a page. */
  anchor: EffectSchema.optionalKey(descriptionCommentSpanSchema),
  /** The page the thread is on; absent for a thread on the description. */
  page: EffectSchema.optionalKey(descriptionCommentPageSchema),
  /** The heading of the section the words stand, or last stood, in; empty before the first heading. */
  section: EffectSchema.String,
  status: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_STATUS)),
  entries: EffectSchema.Array(descriptionCommentEntrySchema),
  createdAt: countedNumber,
  /** When anything about the thread last changed. */
  updatedAt: countedNumber,
  /** Moved on by every change of the thread. */
  revision: countedNumber,
});

export type DescriptionCommentThread = typeof descriptionCommentThreadSchema.Type;

/** Where a reader of a description's comments starts: before anything. */
export const DESCRIPTION_COMMENTS_CURSOR_START = "0";

/** Where a reader of a description's comments stands, as the service last handed it back. */
export const descriptionCommentsCursorSchema = filledText(
  DESCRIPTION_COMMENT_BOUNDS.MAX_CURSOR_CHARS,
);

/** A description's comments as they stand (GET `/api/plans/{id}/comments`): every thread, oldest first, and the cursor to read on from. */
export const descriptionCommentsAnswerSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(descriptionCommentThreadSchema),
  cursor: EffectSchema.String,
});

export type DescriptionCommentsAnswer = typeof descriptionCommentsAnswerSchema.Type;

/** A description's text as a thread's anchor is measured in. */
const ANCHOR_TEXT = EffectSchema.String.check(EffectSchema.isMaxLength(TASK_BOUNDS.MAX_BODY_CHARS));

/**
 * A thread started (POST `/api/plans/{id}/comments`): its first comment, the
 * words it is anchored to, and the description's text the anchor is measured in,
 * which the service carries over to the text as it stands, so a thread
 * started in an editor with words not yet saved lands on the same words. The
 * comment may carry files under its words, and the start may name the
 * thread's id, minted by its client so it draws the thread before the
 * service answers; without one the service mints it.
 */
const descriptionCommentDescriptionStartSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(chosenIdSchema),
  clientKey: descriptionCommentClientKeySchema,
  scope: EffectSchema.Literals([DESCRIPTION_COMMENT_SCOPE.WORDS, DESCRIPTION_COMMENT_SCOPE.BLOCK]),
  quote: filledText(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
  anchor: descriptionCommentSpanSchema,
  text: ANCHOR_TEXT,
  words: descriptionCommentWordsSchema,
  attachments: descriptionCommentFilesSchema,
});

/** The threads a comment sending a page's review names along with its own, by their ids; no more than a page holds. */
const reviewAlongSchema = EffectSchema.optionalKey(
  EffectSchema.Array(wireUuidSchema).check(
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION),
  ),
);

/**
 * A thread started on one of the task's pages (the same POST): its first
 * comment, the page and the version the member was reading, and the element
 * they picked in its frame, or that holds the words they selected there,
 * where they did, by its path, its words or those selected, and the heading
 * of the section it stands in. The service takes the page's
 * title as the quote of a thread on the whole page. It may name the
 * thread's id as a start on the description does.
 *
 * A member may gather several comments on a page into a review before any
 * agent hears them, new threads and replies alike: each but the last is
 * started or replied held, posted for every member to read but handed to no
 * one, and the last names the threads of the held ones along with it, so
 * each agent in any of them is handed them all in one message rather than
 * one message a comment.
 */
const descriptionCommentPageStartSchema = EffectSchema.Struct({
  id: EffectSchema.optionalKey(chosenIdSchema),
  clientKey: descriptionCommentClientKeySchema,
  page: EffectSchema.Struct({ id: wireUuidSchema, version: pageVersionNumberSchema }),
  element: EffectSchema.optionalKey(
    EffectSchema.Struct({
      path: descriptionCommentElementPathSchema,
      quote: filledText(DESCRIPTION_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
      section: EffectSchema.String.check(
        EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_SECTION_CHARS),
      ),
      /** Whether the quote is words selected in the element, which the page tints, rather than the element as a whole. */
      words: EffectSchema.optionalKey(EffectSchema.Literal(true)),
    }),
  ),
  words: descriptionCommentWordsSchema,
  attachments: descriptionCommentFilesSchema,
  /** Whether the thread is held in a review: posted, but handed to no agent until the start that sends the review names it along. */
  held: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  /** The threads of the same page holding comments this member held in the review this start sends, started or replied to, by their ids, handed over together with this one; no more than a page holds. */
  along: reviewAlongSchema,
});

/** A thread started on the description's words. */
export type DescriptionCommentStartRequest = typeof descriptionCommentDescriptionStartSchema.Type;

/** A thread started on a page of the description's task. */
export type DescriptionCommentPageStart = typeof descriptionCommentPageStartSchema.Type;

/** A thread started (POST `/api/plans/{id}/comments`): on the description's words, or on one of its task's pages. */
export const descriptionCommentStartRequestSchema = EffectSchema.Union([
  descriptionCommentDescriptionStartSchema,
  descriptionCommentPageStartSchema,
]);

export type DescriptionCommentStart = typeof descriptionCommentStartRequestSchema.Type;

/** What a member does to one thread (POST `/api/plans/{id}/comments/{thread}`). */
export const DESCRIPTION_COMMENT_ACTION = {
  REPLY: "reply",
  EDIT: "edit",
  DELETE: "delete",
  RESOLVE: "resolve",
  REOPEN: "reopen",
  DELETE_THREAD: "delete-thread",
  /** Sends the thread to the app or one of the task's coding agents, to read with the description and answer in the thread. */
  ASK: "ask",
} as const;

export const descriptionCommentActionRequestSchema = EffectSchema.Union([
  EffectSchema.Struct({
    action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.REPLY),
    clientKey: descriptionCommentClientKeySchema,
    words: descriptionCommentWordsSchema,
    attachments: descriptionCommentFilesSchema,
    /** Whether the reply is held in a review of the page its thread is on, as a start may be: posted, but handed to no agent until the comment sending the review names its thread along. */
    held: EffectSchema.optionalKey(EffectSchema.Literal(true)),
    /** The threads of the same page holding comments this member held in the review this reply sends, by their ids, handed over together with this one, as a start's are. */
    along: reviewAlongSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.EDIT),
    entry: wireUuidSchema,
    words: descriptionCommentWordsSchema,
  }),
  EffectSchema.Struct({
    action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.DELETE),
    entry: wireUuidSchema,
  }),
  EffectSchema.Struct({ action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.RESOLVE) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.REOPEN) }),
  EffectSchema.Struct({ action: EffectSchema.Literal(DESCRIPTION_COMMENT_ACTION.DELETE_THREAD) }),
]);

export type DescriptionCommentActionRequest = typeof descriptionCommentActionRequestSchema.Type;

/**
 * An ask written in a thread under its own key, saying whom a comment's
 * mention handed it to. The service writes it as it hands the thread over;
 * no client sends one, since a mention in the words is how a member asks.
 */
export interface DescriptionCommentAskRequest {
  readonly action: typeof DESCRIPTION_COMMENT_ACTION.ASK;
  readonly clientKey: string;
  readonly to: DescriptionCommentAsked;
}

/** Why a write to a thread took nothing, answered in band. */
export const DESCRIPTION_COMMENT_REFUSAL = {
  /** The description already holds `DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION` threads, or the thread its bound of comments. */
  TOO_MANY: "too-many",
  /** The anchor names no words of the text it was measured in, or none of them stand in the description now. */
  NO_WORDS: "no-words",
  /** The comment is someone else's, which only its writer edits or deletes. */
  NOT_YOURS: "not-yours",
  /** The comment named is not one of the thread's. */
  NO_ENTRY: "no-entry",
  /** The key the reply was sent under already wrote to another thread of the description. */
  KEY_TAKEN: "key-taken",
} as const;

export type DescriptionCommentRefusal =
  (typeof DESCRIPTION_COMMENT_REFUSAL)[keyof typeof DESCRIPTION_COMMENT_REFUSAL];

/** The transaction a write committed in, which a reader following the thread waits for before it takes the write as shown; absent where it wrote nothing, and from a service before it was answered. */
const writtenTxidSchema = EffectSchema.optionalKey(EffectSchema.String);

/** What a write to a thread answers: the thread as it now stands, that it was deleted, or why nothing was taken. */
export const descriptionCommentThreadAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({
    thread: descriptionCommentThreadSchema,
    /** The ones a comment's mentions asked who could not take the thread, an agent whose session is not running say; absent where every one did. */
    unsent: EffectSchema.optionalKey(EffectSchema.Array(descriptionCommentAskedSchema)),
    txid: writtenTxidSchema,
  }),
  EffectSchema.Struct({ deleted: wireUuidSchema, txid: writtenTxidSchema }),
  EffectSchema.Struct({
    refused: EffectSchema.Literals(Object.values(DESCRIPTION_COMMENT_REFUSAL)),
  }),
]);

export type DescriptionCommentThreadAnswer = typeof descriptionCommentThreadAnswerSchema.Type;

/**
 * Where the open editor's anchors stand in the text a save sends, and the
 * threads the editor carried anchors for: a thread it carried and no longer
 * holds an anchor for had its words deleted there, and one it holds again
 * had them brought back by undo, which no carrying-over of the text alone can
 * tell. A thread the editor never carried is carried over by the text.
 */
export const descriptionCommentAnchorsSchema = EffectSchema.Struct({
  anchors: EffectSchema.Array(
    EffectSchema.Struct({ thread: wireUuidSchema, ...descriptionCommentSpanSchema.fields }),
  ).check(EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION)),
  carried: EffectSchema.Array(wireUuidSchema).check(
    EffectSchema.isMaxLength(DESCRIPTION_COMMENT_BOUNDS.MAX_THREADS_PER_DESCRIPTION),
  ),
});

export type DescriptionCommentAnchors = typeof descriptionCommentAnchorsSchema.Type;

/** The tools the app and every coding agent on the task read and answer the description's comments with, by the name the model calls each. */
export const DESCRIPTION_COMMENT_TOOL = {
  READ: "read_comments",
  REPLY: "reply_to_comment",
  UPDATE: "update_comment",
} as const;
