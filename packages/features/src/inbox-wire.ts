import { isWireBoolean, isWireNumber, isWireString } from "@luke/wire";
import { Schema as EffectSchema } from "effect";
import {
  CODING_AGENT_ATTACHMENT_TYPE,
  CODING_AGENT_BOUNDS,
  type CodingAgentAttachment,
  codingAgentMessageRequestSchema,
  hasWordsOrFiles,
} from "./coding-agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import { CODE_PATH_MAX_CHARS, codeLineSchema, commitShaSchema } from "./task-wire.js";

/**
 * inbox-wire.ts -- the developer's inbox: what a task's coding agents need of the developer, posted by the agents and answered on the desktop.
 *
 * An item is one thing an agent cannot do or decide alone, kept on the
 * service as a row of its own rather than in the agent's transcript, so it
 * stands where the developer looks whatever the transcript has scrolled
 * past, and the agent can change it or take it back. The agent names each
 * item by a key of its own: posting under a key it used before replaces
 * that item, and reopens it where it was answered or closed, so an item is
 * kept current rather than posted twice. An item is a title, the blocks
 * of context under it, and the response it asks for. The blocks are a
 * closed set of shapes, Markdown, a link, a reference to lines of the
 * agent's repository at a commit, and an image, each a tagged record, so a
 * later block type is one more member rather than a new column. An image
 * is one the agent took in its sandbox, a screenshot of what it rendered:
 * the agent posts it by the file's path there, the service reads the file
 * and keeps it as an attachment of the item's, and the block the desktop
 * reads names the attachment, which the desktop fetches under the account
 * and never by an address the agent wrote. The
 * response is a closed set too, each answered its own way: a choice among
 * the agent's options, one or several, or in the developer's own words;
 * an approval or a decline of a step; words; a task the developer does by
 * hand and marks done or not possible; a form of typed fields; or nothing
 * but an acknowledgement, for something the developer should know. An
 * item says whether the agent needs to hear back: where it does, the
 * answer reaches the agent as one of the developer's messages, which
 * steers its turn or opens one; where it does not, the answer is kept and
 * the agent reads it the next time it reads its inbox. Every item carries
 * a revision the agent's every change moves on, and an answer names the
 * revision it answers, so an answer to an item the agent has since changed
 * is refused rather than taken for the item as it now stands. An answer may
 * carry files, as a message to an agent may: they reach the agent with the
 * answer, and the service keeps them beside the item as its answer files,
 * which the item names by attachment, file name, and type until the answer
 * is taken back or the agent posts the item again.
 *
 * Beside its one answer, an item holds a thread: messages a member of its
 * workspace or its agent adds at any point, open or settled, each in
 * Markdown with the files it carried, read oldest first. A message changes
 * neither the item's status, nor its answer, nor its revision, and moves
 * the instant the item last changed, so the item comes to the top of the
 * inbox. A member's message reaches the agent as one of the developer's
 * messages, under its own lead, as an answer does, and wakes an agent that
 * stopped as a message typed in its tab does. The thread outlives a post
 * under the item's key, which changes what the item asks and not what was
 * said about it.
 *
 * The agent posts, closes, and reads its items through the tools named
 * below, whose inputs are declared here so the model is shown, eve holds,
 * and the desktop draws one shape. A task's inbox is read past a cursor the
 * service hands back, held open while nothing changed, as a transcript is.
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added. The item a desktop reads carries the version of
 * this vocabulary the service wrote it in, and reads a block or a response
 * of a type this build does not know as its type alone, so a desktop
 * behind the service draws what it knows and a placeholder for the rest
 * rather than refusing the whole inbox.
 */

/**
 * The version of this vocabulary: moved on when a block or a response type
 * is added, so a desktop reading an item written under a later one knows
 * what it cannot draw was written for a newer Luke. Version 1 was the
 * fixed kinds, a choice, an approval, a question, and a task, with one
 * Markdown details field; version 2 is blocks and a response; version 3
 * adds the code block; version 4 adds the image block.
 */
export const INBOX_WIRE_VERSION = 4;

export const INBOX_BOUNDS = {
  /** The most characters an item's key may spell: a short slug the agent chooses. */
  MAX_KEY_CHARS: 80,
  /** The most characters an item's title may spell: one line in the inbox. */
  MAX_TITLE_CHARS: 160,
  /** The most blocks an item may carry: the context the developer needs, never a report. */
  MAX_BLOCKS: 8,
  /** The most characters a Markdown block may spell. */
  MAX_MARKDOWN_CHARS: 8_000,
  /** The most characters a link's address may spell. */
  MAX_URL_CHARS: 2_000,
  /** The most lines a code block points at: the exact lines that matter, never a file. */
  MAX_CODE_LINES: 60,
  /** The most characters an image's path in the agent's sandbox may spell. */
  MAX_PATH_CHARS: 1_024,
  /** The most characters an image's alt words may spell: what the picture shows, in a sentence or two. */
  MAX_ALT_CHARS: 300,
  /**
   * The most bytes one image may hold: the bound an image already has on a
   * message to an agent, so a picture is one size in either direction, and
   * one a screenshot at a screen's own scale fits under.
   */
  MAX_IMAGE_BYTES: CODING_AGENT_BOUNDS.MAX_IMAGE_BYTES,
  /** The most characters a label may spell: a link's, an option's, a field's, a select's option, or a box's placeholder. */
  MAX_LABEL_CHARS: 160,
  /** The most options a choice or a select may offer: a choice a person makes at a glance. */
  MAX_OPTIONS: 6,
  /** The most characters an option's detail may spell: the trade-off in a sentence or two. */
  MAX_OPTION_DETAIL_CHARS: 600,
  /** The most fields a form may ask: what a person fills in at a glance. */
  MAX_FIELDS: 8,
  /** The most characters a form's text field may take. */
  MAX_FIELD_VALUE_CHARS: 1_000,
  /** The most characters the developer's note may spell. */
  MAX_NOTE_CHARS: 4_000,
  /** The most characters the agent's reason for closing an item may spell. */
  MAX_REASON_CHARS: 600,
  /** The most items one agent keeps open at once: what a person works through, never a log. */
  MAX_OPEN_PER_AGENT: 20,
  /** The most settled items a read of a task's inbox carries beside every open one, the latest changed first. */
  MAX_ITEMS_READ: 200,
  /** The most settled items an agent's inbox tool answers with beside every open one: enough to hear what was answered lately. */
  MAX_SETTLED_TOLD: 20,
  /** The most characters a cursor may spell. */
  MAX_CURSOR_CHARS: 64,
  /** The most characters an answer's key may spell; a UUID is the usual. */
  MAX_CLIENT_KEY_CHARS: 128,
  /** The most characters a message on an item's thread may spell: a Markdown block's bound, whoever writes it. */
  MAX_MESSAGE_CHARS: 8_000,
  /** The most messages an item read carries, the latest ones, oldest first among them: a thread read at a glance, never a log. */
  MAX_MESSAGES_READ: 50,
  /** The most pictures the agent's message on a thread may carry, each held to the image bound. */
  MAX_REPLY_IMAGES: 4,
} as const;

/** The tools an agent keeps its items with, by the names their tool parts carry in its transcript. */
export const INBOX_TOOL = {
  /** Posts an item, or replaces the one under the same key. */
  POST: "post_to_inbox",
  /** Takes an item back, with why. */
  CLOSE: "close_inbox_item",
  /** Reads the agent's items as they stand, answers and all. */
  READ: "read_inbox",
  /** Writes the agent's message on one of its items' threads, by key. */
  REPLY: "reply_inbox",
} as const;

/** The blocks an item's context is made of. */
export const INBOX_BLOCK = {
  /** Words in Markdown. */
  MARKDOWN: "markdown",
  /** An address with a label, such as the GitHub page a task is done on. */
  LINK: "link",
  /** Lines of a file of the agent's repository, as they stood at a commit. */
  CODE: "code",
  /** A picture the agent took in its sandbox, kept as an attachment of the item's. */
  IMAGE: "image",
} as const;

/** The pictures an image block may be, by the media type each is kept and served under; the bytes are sniffed for one of these, never trusted by name. */
export const INBOX_IMAGE_TYPE = {
  PNG: CODING_AGENT_ATTACHMENT_TYPE.PNG,
  JPEG: CODING_AGENT_ATTACHMENT_TYPE.JPEG,
  WEBP: CODING_AGENT_ATTACHMENT_TYPE.WEBP,
} as const;

export type InboxImageType = (typeof INBOX_IMAGE_TYPE)[keyof typeof INBOX_IMAGE_TYPE];

/** An image's media type as the wire carries it: one of the three the service keeps. */
export const inboxImageTypeSchema = EffectSchema.Literals(Object.values(INBOX_IMAGE_TYPE));

/** The responses an item asks for, each answered its own way. */
export const INBOX_RESPONSE = {
  /** Pick one of the agent's options, or several where it allows, one perhaps recommended, or answer in the developer's own words. */
  CHOICE: "choice",
  /** Approve or decline a step the agent proposes. */
  APPROVAL: "approval",
  /** An open answer in the developer's own words. */
  TEXT: "text",
  /** A to-do: something the developer does by hand, such as a setting on GitHub, marked done or not possible. The wire value stays "task", because stored items and a released desktop name it so. */
  TODO: "task",
  /** Typed fields the developer fills in. */
  FORM: "form",
  /** Nothing but an acknowledgement: something the developer should know. */
  NONE: "none",
} as const;

type InboxResponseType = (typeof INBOX_RESPONSE)[keyof typeof INBOX_RESPONSE];

/** The fields a form may ask. */
export const INBOX_FIELD = {
  /** A line of words. */
  TEXT: "text",
  /** A number. */
  NUMBER: "number",
  /** One of the field's options. */
  SELECT: "select",
  /** Yes or no. */
  BOOLEAN: "boolean",
} as const;

/** Where an item stands. */
export const INBOX_STATUS = {
  /** Waiting on the developer. */
  OPEN: "open",
  /** The developer answered it. */
  ANSWERED: "answered",
  /** The agent took it back. */
  CLOSED: "closed",
} as const;

export type InboxStatus = (typeof INBOX_STATUS)[keyof typeof INBOX_STATUS];

/** How the developer answered an item. */
export const INBOX_REPLY = {
  /** Picked one or more of a choice's options. */
  CHOSE: "chose",
  /** Approved an approval's step. */
  APPROVED: "approved",
  /** Declined an approval's step. */
  DECLINED: "declined",
  /** Answered in their own words: a text, or a choice none of whose options fit. */
  ANSWERED: "answered",
  /** Did a task. */
  DONE: "done",
  /** Could not, or would not, do a task. */
  NOT_DONE: "not-done",
  /** Filled in a form. */
  SUBMITTED: "submitted",
  /** Read an item that asked for nothing. */
  ACKNOWLEDGED: "acknowledged",
} as const;

export type InboxReplyKind = (typeof INBOX_REPLY)[keyof typeof INBOX_REPLY];

/** The answers each response takes. */
const INBOX_REPLIES_OF = {
  [INBOX_RESPONSE.CHOICE]: [INBOX_REPLY.CHOSE, INBOX_REPLY.ANSWERED],
  [INBOX_RESPONSE.APPROVAL]: [INBOX_REPLY.APPROVED, INBOX_REPLY.DECLINED],
  [INBOX_RESPONSE.TEXT]: [INBOX_REPLY.ANSWERED],
  [INBOX_RESPONSE.TODO]: [INBOX_REPLY.DONE, INBOX_REPLY.NOT_DONE],
  [INBOX_RESPONSE.FORM]: [INBOX_REPLY.SUBMITTED],
  [INBOX_RESPONSE.NONE]: [INBOX_REPLY.ACKNOWLEDGED],
} as const satisfies Record<InboxResponseType, readonly InboxReplyKind[]>;

function boundedText(maximumChars: number) {
  return EffectSchema.String.check(EffectSchema.isMaxLength(maximumChars));
}

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** An item's key as the agent spells it: a short slug, the same each time it means the same item. */
export const inboxKeySchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_KEY_CHARS),
  EffectSchema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u),
);

/** A link's address: a web page, and nothing a desktop would hand to another scheme. */
const WEB_ADDRESS = /^https?:\/\/\S+$/u;

/**
 * The blocks an agent writes as they are kept: words in Markdown, a link
 * with its label, or the lines of a file the agent points at, in its
 * repository as `owner/name`, from its first line to its last, at the
 * commit it read them at, so the reference never moves under a later push.
 * Note that a code block carries no line of the file: the desktop reads
 * them from GitHub at that commit, as its File tab reads a file.
 */
const WORD_BLOCKS = [
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.MARKDOWN),
    text: filledText(INBOX_BOUNDS.MAX_MARKDOWN_CHARS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.LINK),
    url: EffectSchema.String.check(
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_URL_CHARS),
      EffectSchema.isPattern(WEB_ADDRESS),
    ),
    label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.CODE),
    repo: githubRepositoryFullNameSchema,
    path: filledText(CODE_PATH_MAX_CHARS),
    startLine: codeLineSchema,
    endLine: codeLineSchema,
    sha: commitShaSchema,
  }),
] as const;

/** One word block as a person writes it from the window: Markdown, a link, or lines of code, never a picture. */
export const inboxWordBlockSchema = EffectSchema.Union(WORD_BLOCKS);

/** What an image block says of its picture: the words that stand for it where it cannot be seen. */
const imageWords = { alt: filledText(INBOX_BOUNDS.MAX_ALT_CHARS) };

/** One block of an item's context as the service keeps it and the desktop reads it: a word block as the agent wrote it, or an image by the attachment the service keeps it as. */
export const inboxBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    attachmentId: wireUuidSchema,
    ...imageWords,
  }),
]);

export type InboxBlock = typeof inboxBlockSchema.Type;

/** A code block as an item carries it: the repository, the path, the lines, and the commit. */
export type InboxCodeBlock = Extract<InboxBlock, { type: typeof INBOX_BLOCK.CODE }>;

/** Whether a code block's lines run forward from its first and are few enough to read at a glance. */
export function codeLinesReadable(block: Pick<InboxCodeBlock, "startLine" | "endLine">): boolean {
  return (
    block.endLine >= block.startLine &&
    block.endLine - block.startLine < INBOX_BOUNDS.MAX_CODE_LINES
  );
}

/** An image block as an item carries one, naming the attachment the desktop fetches. */
export type InboxImageBlock = Extract<InboxBlock, { type: typeof INBOX_BLOCK.IMAGE }>;

/** An item's context: its blocks in order, few. */
export const inboxBlocksSchema = EffectSchema.Array(inboxBlockSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_BLOCKS),
);

/** One block as the agent posts it: the word blocks as they are kept, and an image by the path of its file in the agent's sandbox, which the service reads and keeps. */
export const inboxPostBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    path: filledText(INBOX_BOUNDS.MAX_PATH_CHARS),
    ...imageWords,
  }),
]);

export type InboxPostBlock = typeof inboxPostBlockSchema.Type;

/** An item's context as the agent posts it: its blocks in order, few. */
export const inboxPostBlocksSchema = EffectSchema.Array(inboxPostBlockSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_BLOCKS),
);

/** One option of a choice: its label, and the trade-off in a sentence where the agent wrote one. */
export const inboxOptionSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  detail: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_OPTION_DETAIL_CHARS)),
});

/** One field of a form: its type, its label, which names its value in the answer, whether it must be filled, and a select's options. */
export const inboxFieldSchema = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(INBOX_FIELD)),
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  required: EffectSchema.optionalKey(EffectSchema.Boolean),
  options: EffectSchema.optionalKey(
    EffectSchema.Array(filledText(INBOX_BOUNDS.MAX_LABEL_CHARS)).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
  ),
});

export type InboxField = typeof inboxFieldSchema.Type;

/**
 * What an item asks of the developer, one of six: a choice among options,
 * several where `multiple`, the label it recommends named; an approval; words,
 * with what the box says while empty; a task; a form of fields; or nothing
 * but an acknowledgement.
 */
export const inboxResponseSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.CHOICE),
    options: EffectSchema.Array(inboxOptionSchema).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
    multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
    recommended: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(INBOX_RESPONSE.APPROVAL) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.TEXT),
    placeholder: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_LABEL_CHARS)),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(INBOX_RESPONSE.TODO) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.FORM),
    fields: EffectSchema.Array(inboxFieldSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
    ),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(INBOX_RESPONSE.NONE) }),
]);

export type InboxResponse = typeof inboxResponseSchema.Type;

/** A choice as an item asks it, with the options an answer must name. */
export type InboxChoice = Extract<InboxResponse, { type: typeof INBOX_RESPONSE.CHOICE }>;

/** A form as an item asks it, with the fields an answer fills. */
export type InboxForm = Extract<InboxResponse, { type: typeof INBOX_RESPONSE.FORM }>;

/**
 * What a post's tool part carries as its input: the item's key, a title,
 * the blocks of context under it, an image among them by its path in the
 * sandbox, the response it asks for, and whether the agent needs to hear
 * back, which it does unless it says not. The model is shown this schema
 * and eve holds the call to it.
 */
export const inboxPostInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  title: filledText(INBOX_BOUNDS.MAX_TITLE_CHARS),
  blocks: EffectSchema.optionalKey(inboxPostBlocksSchema),
  response: inboxResponseSchema,
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxPost = typeof inboxPostInputSchema.Type;

/** What a close's tool part carries as its input: the item's key, and why the agent takes it back. */
export const inboxCloseInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  reason: filledText(INBOX_BOUNDS.MAX_REASON_CHARS),
});

/**
 * What a reply's tool part carries as its input: the key of one of the
 * agent's own items, its words in Markdown, and the pictures it shows, each
 * by the path of its file in the agent's sandbox, as an image block names
 * one; words or pictures or both, which the tool holds it to.
 */
export const inboxReplyInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  text: boundedText(INBOX_BOUNDS.MAX_MESSAGE_CHARS),
  images: EffectSchema.optionalKey(
    EffectSchema.Array(
      EffectSchema.Struct({ path: filledText(INBOX_BOUNDS.MAX_PATH_CHARS) }),
    ).check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_REPLY_IMAGES)),
  ),
});

export type InboxReplyInput = typeof inboxReplyInputSchema.Type;

/** What a read's tool part carries as its input: nothing, since an agent reads its own items alone. */
export const inboxReadInputSchema = EffectSchema.Struct({});

/** What a form's field holds once filled: words, a number, an option, or yes or no, by the field's type. */
export const inboxFieldValueSchema = EffectSchema.Union([
  boundedText(INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS),
  EffectSchema.Finite,
  EffectSchema.Boolean,
]);

export type InboxFieldValue = typeof inboxFieldValueSchema.Type;

/** One field filled: the field's label, and what it holds. */
export const inboxFormValueSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  value: inboxFieldValueSchema,
});

export type InboxFormValue = typeof inboxFormValueSchema.Type;

/** A form's values, one per field filled, each named by its field's label. */
export const inboxFormValuesSchema = EffectSchema.Array(inboxFormValueSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
);

type InboxFormValues = typeof inboxFormValuesSchema.Type;

/** The developer's answer: how they answered, the options where they picked, the form's values where they filled one, and their note. */
export const inboxReplySchema = EffectSchema.Struct({
  reply: EffectSchema.Literals(Object.values(INBOX_REPLY)),
  choices: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String).check(
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
  ),
  values: EffectSchema.optionalKey(inboxFormValuesSchema),
  note: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_NOTE_CHARS)),
});

export type InboxReply = typeof inboxReplySchema.Type;

/** The types this build draws, by which a read tells a type it does not know. */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(INBOX_BLOCK),
  ...Object.values(INBOX_RESPONSE),
]);

/**
 * A type this build does not know, as a newer service wrote one: read as
 * the type's name alone, so it narrows away from every type this build
 * draws, and drawn as a placeholder naming a newer Luke. Note that a type
 * this build knows is refused here, because a known block or response
 * that fails its own shape is a broken read and not a newer one.
 */
const unknownTypeSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((type) => !KNOWN_TYPES.has(type)),
).pipe(EffectSchema.brand("UnknownInboxType"));

/** A block as a desktop reads one: one this build knows, or the type alone of one it does not. */
export const inboxReadBlockSchema = EffectSchema.Union([
  ...inboxBlockSchema.members,
  EffectSchema.Struct({ type: unknownTypeSchema }),
]);

export type InboxReadBlock = typeof inboxReadBlockSchema.Type;

/** A response as a desktop reads one: one this build knows, or the type alone of one it does not. */
export const inboxReadResponseSchema = EffectSchema.Union([
  ...inboxResponseSchema.members,
  EffectSchema.Struct({ type: unknownTypeSchema }),
]);

export type InboxReadResponse = typeof inboxReadResponseSchema.Type;

/**
 * One file the developer's answer carried, as an item names it: the
 * attachment the service keeps it as, which the desktop fetches under the
 * account, its own name, and the media type it travelled as. Note that the
 * type is read as words rather than one of the types a message carries,
 * because a newer service that takes one more type must not leave a
 * desktop behind it unable to read the whole inbox.
 */
export const inboxAnswerFileSchema = EffectSchema.Struct({
  attachmentId: wireUuidSchema,
  name: EffectSchema.String,
  mediaType: EffectSchema.String,
});

type InboxAnswerFile = typeof inboxAnswerFileSchema.Type;

/** Who wrote a message on an item's thread: a member of the item's workspace, or the item's own agent. */
export const INBOX_MESSAGE_AUTHOR = {
  MEMBER: "member",
  AGENT: "agent",
} as const;

export type InboxMessageAuthor = (typeof INBOX_MESSAGE_AUTHOR)[keyof typeof INBOX_MESSAGE_AUTHOR];

/**
 * One message on an item's thread as an item read carries it: who wrote it,
 * the member by id and name where a member did, and none for a member whose
 * account is gone or for the agent, which is the item's own; the words as
 * Markdown, written as they were sent, so a mention in them stands as its
 * link; the files it carried, named as an answer's are and fetched by the
 * same attachment path; and when it was written.
 */
export const inboxMessageSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  author: EffectSchema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  /** The member who wrote it, on a member's message whose account still stands. */
  member: EffectSchema.optionalKey(memberRefSchema),
  /** The words in Markdown; empty where the files carry the message alone. */
  text: EffectSchema.String,
  /** The files it carried, in the order they were attached; absent where it carried none. */
  files: EffectSchema.optionalKey(EffectSchema.Array(inboxAnswerFileSchema)),
  createdAt: countedNumber,
});

export type InboxMessage = typeof inboxMessageSchema.Type;

/** One item as the desktop reads it. */
export const inboxItemSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  key: EffectSchema.String,
  revision: countedNumber,
  /** The version of this vocabulary the service wrote the item in. */
  version: countedNumber,
  title: EffectSchema.String,
  blocks: EffectSchema.Array(inboxReadBlockSchema),
  response: inboxReadResponseSchema,
  needsReply: EffectSchema.Boolean,
  status: EffectSchema.Literals(Object.values(INBOX_STATUS)),
  /**
   * The member who started the agent that posted the item, whose question it
   * is, as the account's read names it (`account-inbox-wire.ts`); absent from
   * a service before it, which the desktop reads as the reader's own, as it
   * read every item before.
   */
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  /** The developer's answer, on an answered item. */
  answer: EffectSchema.optionalKey(inboxReplySchema),
  /** The files the answer carried, in the order they were attached; absent where it carried none. */
  answerFiles: EffectSchema.optionalKey(EffectSchema.Array(inboxAnswerFileSchema)),
  /**
   * The member who answered, on an answered item, any member of the task's
   * workspace; absent for an answer nobody can be named for, and from a
   * service before answerers were kept. The window says "You" only where it
   * is the signed-in account.
   */
  answeredBy: EffectSchema.optionalKey(memberRefSchema),
  /** Why the agent took the item back, on a closed one. */
  closedReason: EffectSchema.optionalKey(EffectSchema.String),
  /** The item's thread, oldest first, the latest `MAX_MESSAGES_READ` of it; absent where nobody wrote one. */
  messages: EffectSchema.optionalKey(EffectSchema.Array(inboxMessageSchema)),
  /** When the agent first posted the item under its key. */
  postedAt: countedNumber,
  /**
   * When the item was last answered or closed, on a settled item; absent on
   * an open one, and from a service before it was kept, which a reader takes
   * as `updatedAt`. A message on the thread never moves it.
   */
  settledAt: EffectSchema.optionalKey(countedNumber),
  /** When the item last changed, by the agent or the developer, a message on its thread included. */
  updatedAt: countedNumber,
});

export type InboxItem = typeof inboxItemSchema.Type;

/** Where a reader of an inbox starts: before anything. */
export const INBOX_CURSOR_START = "0";

/** Where a reader of an inbox stands, as the service last handed it back. */
export const inboxCursorSchema = filledText(INBOX_BOUNDS.MAX_CURSOR_CHARS);

/** A task's inbox as it stands: every item its agents posted, the latest changed first, and the cursor to read on from. */
export const inboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxItemSchema),
  cursor: EffectSchema.String,
});

export type InboxAnswer = typeof inboxAnswerSchema.Type;

/**
 * An answer to one item: the revision it answers, the answer, the files the
 * developer attached, bounded as a message's to an agent are, and a key the
 * client made, so an answer sent again after a lost reply is taken once.
 */
export const inboxAnswerRequestSchema = EffectSchema.Struct({
  revision: countedNumber,
  ...inboxReplySchema.fields,
  attachments: codingAgentMessageRequestSchema.fields.attachments,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

export type InboxAnswerRequest = typeof inboxAnswerRequestSchema.Type;

/** What an answer comes back as: the item as it then stands, and whether the answer was taken, which it is not where the agent changed the item first. */
export const inboxAnsweredSchema = EffectSchema.Struct({
  item: inboxItemSchema,
  taken: EffectSchema.Boolean,
});

/** How the developer's answer opens, in the message that hands it to the agent. */
export const INBOX_ANSWER_LEAD = "Inbox answer";

/**
 * A member's message on an item's thread: the words in Markdown, trimmed and
 * bounded, the files they attached, bounded as a message's to an agent are,
 * words or files or both and never neither, and a key the client made, so
 * a message sent again after a lost reply is written once.
 */
export const inboxMessageRequestSchema = EffectSchema.Struct({
  text: EffectSchema.Trim.check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
  attachments: codingAgentMessageRequestSchema.fields.attachments,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
}).check(EffectSchema.makeFilter(({ text, attachments }) => hasWordsOrFiles(text, attachments)));

export type InboxMessageRequest = typeof inboxMessageRequestSchema.Type;

/** What a member's message comes back as: the item as it then stands, its thread with the message on it. */
export const inboxMessagedSchema = EffectSchema.Struct({ item: inboxItemSchema });

/** How a member's message on an item's thread opens, in the message that hands it to the agent. */
export const INBOX_MESSAGE_LEAD = "Inbox message";

/**
 * The message a member's message on an item's thread reaches the agent as:
 * a first line naming the item by its key and title, as an answer's does,
 * then the member's words as they wrote them, so what they mention reads as
 * it was written.
 */
export function inboxThreadMessage(item: Pick<InboxItem, "key" | "title">, text: string): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_MESSAGE_LEAD} on "${title}" (key ${item.key}):`;
  return text.trim() === "" ? header : `${header}\n\n${text.trim()}`;
}

/** Whether a response read off the wire is one this build knows, which its type decides. */
export function knownResponse(response: InboxReadResponse): response is InboxResponse {
  return Object.values<string>(INBOX_RESPONSE).includes(response.type);
}

/** Whether a block read off the wire is one this build knows, which its type decides. */
export function knownBlock(block: InboxReadBlock): block is InboxBlock {
  return Object.values<string>(INBOX_BLOCK).includes(block.type);
}

/** A field's value as words: a number as it prints, yes or no for a boolean. */
export function fieldValueWords(value: InboxFieldValue): string {
  if (isWireBoolean(value)) return value ? "yes" : "no";
  return String(value);
}

/** A form's values as lines, one per field filled, in the form's own order. */
function valueLines(values: InboxFormValues): string {
  return values.map(({ label, value }) => `- ${label}: ${fieldValueWords(value)}`).join("\n");
}

/** The answer's own words, as the agent reads them. */
function replyWords(reply: InboxReply): string {
  switch (reply.reply) {
    case INBOX_REPLY.CHOSE:
      return `Chose ${(reply.choices ?? []).map((choice) => `"${choice}"`).join(", ")}.`;
    case INBOX_REPLY.APPROVED:
      return "Approved.";
    case INBOX_REPLY.DECLINED:
      return "Declined.";
    case INBOX_REPLY.ANSWERED:
      return "Answered in their own words.";
    case INBOX_REPLY.DONE:
      return "Done.";
    case INBOX_REPLY.NOT_DONE:
      return "Not done.";
    case INBOX_REPLY.SUBMITTED:
      return "Filled in the form.";
    case INBOX_REPLY.ACKNOWLEDGED:
      return "Acknowledged.";
  }
}

/** The files an answer carries, by count alone: those sent with it, or those an item names as its answer's. */
type AnswerFiles = readonly (CodingAgentAttachment | InboxAnswerFile)[];

/**
 * Whether an answer reaches the agent as one of the developer's messages:
 * every answer to an item that asks to be heard back, and any other carrying
 * words the developer typed or a file they attached, since either is handed
 * over to be read; a bare press on an item that asks nothing back, Done or
 * Got it, is kept for the agent to read in its own time. The service hands
 * an answer off by it, and the window says where an answer went and reads
 * the agent again by it.
 */
export function inboxAnswerHeard(
  item: Pick<InboxItem, "needsReply">,
  reply: InboxReply,
  files: AnswerFiles = [],
): boolean {
  return item.needsReply || (reply.note ?? "").trim() !== "" || files.length > 0;
}

/**
 * The message an answer reaches the agent as: a first line naming the item
 * by its key and title with what the developer did, then a form's values
 * one per line, then their note. Note that the title is put on one line,
 * because the line is read whole.
 */
export function inboxAnswerMessage(
  item: Pick<InboxItem, "key" | "title">,
  reply: InboxReply,
): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_ANSWER_LEAD} on "${title}" (key ${item.key}): ${replyWords(reply)}`;
  const values = reply.values === undefined ? "" : valueLines(reply.values);
  const note = reply.note?.trim() ?? "";
  return [header, values, note].filter((part) => part !== "").join("\n\n");
}

/** Whether a field's value is of the field's type, and names one of a select's options. */
function fieldTakes(field: InboxField, value: InboxFieldValue): boolean {
  switch (field.type) {
    case INBOX_FIELD.TEXT:
      return isWireString(value);
    case INBOX_FIELD.NUMBER:
      return isWireNumber(value) && Number.isFinite(value);
    case INBOX_FIELD.SELECT:
      return isWireString(value) && (field.options ?? []).includes(value);
    case INBOX_FIELD.BOOLEAN:
      return isWireBoolean(value);
  }
}

/** Whether a filled value counts as filled: words with something in them, or any number or boolean. */
function filled(value: InboxFieldValue): boolean {
  return !isWireString(value) || value.trim() !== "";
}

/** Why a form's values do not fill the form, or nothing where they do: each names a field once and is of its type, and every required field is filled. */
function formRefusal(form: InboxForm, values: InboxFormValues | undefined): string | undefined {
  const given = new Map((values ?? []).map(({ label, value }) => [label, value]));
  if (given.size !== (values ?? []).length) return "A value names a field twice.";
  const fields = new Map(form.fields.map((field) => [field.label, field]));
  for (const [label, value] of given) {
    const field = fields.get(label);
    if (field === undefined) return "A value names no field of the form.";
    if (!fieldTakes(field, value)) return "A value is not of its field's type.";
  }
  for (const field of form.fields) {
    const value = given.get(field.label);
    if (field.required === true && (value === undefined || !filled(value))) {
      return "A required field of the form is empty.";
    }
  }
  return undefined;
}

/** Why a pick does not fit the choice, or nothing where it does: at least one option, each offered and once, and one alone unless the choice allows several. */
function choiceRefusal(
  choice: InboxChoice,
  choices: readonly string[] | undefined,
): string | undefined {
  const picked = choices ?? [];
  if (picked.length === 0) return "A pick names no option.";
  if (picked.length > 1 && choice.multiple !== true) return "The choice takes one option.";
  if (new Set(picked).size !== picked.length) return "A pick names an option twice.";
  const offered = new Set(choice.options.map((option) => option.label));
  if (!picked.every((label) => offered.has(label))) return "The pick names no option of the item.";
  return undefined;
}

/**
 * Why an answer does not fit its item, or nothing where it does: the
 * response takes the reply, a pick names offered options, a form's values
 * fill it, and words or files stand where the answer is the developer's
 * own, as a message to an agent may be files alone. A response this build
 * does not know takes nothing.
 */
export function inboxReplyRefusal(
  item: Pick<InboxItem, "response">,
  reply: InboxReply,
  files: AnswerFiles = [],
): string | undefined {
  const response = item.response;
  if (!knownResponse(response)) return "The item asks something this Luke does not know.";
  const takes: readonly InboxReplyKind[] = INBOX_REPLIES_OF[response.type];
  if (!takes.includes(reply.reply)) return "The item does not take that answer.";
  if (reply.reply === INBOX_REPLY.CHOSE && response.type === INBOX_RESPONSE.CHOICE) {
    return choiceRefusal(response, reply.choices);
  }
  if (reply.reply === INBOX_REPLY.SUBMITTED && response.type === INBOX_RESPONSE.FORM) {
    return formRefusal(response, reply.values);
  }
  if (
    reply.reply === INBOX_REPLY.ANSWERED &&
    (reply.note ?? "").trim() === "" &&
    files.length === 0
  ) {
    return "An answer in the developer's own words needs words or a file.";
  }
  return undefined;
}
