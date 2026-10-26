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
import { linkLabels } from "./mention-link.js";
import { countedNumber, memberRefSchema, wireUuidSchema } from "./service-wire.js";
import {
  CODE_PATH_MAX_CHARS,
  codeLineSchema,
  commitShaSchema,
  workspaceIdSchema,
} from "./task-wire.js";
import { boundedText, filledText } from "./text-schema.js";
import { WEBM_TYPE } from "./video-signature.js";

/**
 * inbox-wire.ts -- the developer's inbox: what a task's coding agents need of the developer, posted by the agents and answered on the desktop.
 *
 * An item is one thing an agent cannot do or decide alone, kept on the
 * service as a row of its own rather than in the agent's transcript, so it
 * stands where the developer looks whatever the transcript has scrolled
 * past, and the agent can change it or take it back. The agent names each
 * item by a key of its own: posting under a key it used before posts on
 * that item's thread, and reopens it where it was answered or closed, so an
 * item is kept current rather than posted twice. An item is a title and a
 * thread: messages its agent or a member of its workspace adds at any
 * point, open or settled, each in Markdown with the files it carried, read
 * oldest first. A picture the agent took in its sandbox, a screenshot of
 * what it rendered, is posted by the file's path there; the service reads
 * the file, keeps it as a file of the agent's message, and writes its
 * address into the words, which the desktop fetches under the account and
 * never by an address the agent wrote.
 *
 * An agent's message may end with an ask, and a member's may carry the
 * answer to one. An ask is one of three, each answered its own way:
 * `decide` among options, `do` steps the reader ticks, or `answer` with
 * typed fields or the reply's own words. A read carries where an ask
 * stands: open, answered, replaced by a newer ask, or withdrawn with why.
 * An answer is a member's message naming the message whose ask it answers,
 * with how they answered; the words under it are the message's own. Every
 * item carries a revision the agent's every post moves on. An answer to
 * any ask but a `do` the agent hears as one of the developer's messages,
 * which steers its turn or opens one, and a `do`'s where the item says the
 * agent waits on it (`needsReply`); otherwise the answer is kept and the
 * agent reads it the next time it reads its inbox. A thread whose agent
 * asks nothing, a notice, holds no ask open and waits on the developer's
 * nod alone, Got it, which names the revision it was shown and which its
 * agent never hears, or on a reply, which settles it as it reaches the
 * agent.
 *
 * An item is closed by its agent, which withdraws its ask with why, or by a
 * member, who puts it away without answering it, at the revision they were
 * shown. A member's close names the member and reaches the agent under its
 * own lead where the item asks to be heard back, so an agent waiting on it
 * is not left waiting; otherwise the agent reads it the next time it reads
 * its inbox. Either close is undone by the agent posting under the item's
 * key again. A message moves the instant the item last changed, so the
 * item comes to the top of the inbox, and a member's reaches the agent
 * under its own lead and wakes an agent that stopped, as a message typed
 * in its tab does.
 *
 * The agent posts, withdraws, and reads its items through the tools named
 * below, whose inputs are declared here so the model is shown, eve holds,
 * and the desktop draws one shape. A task's inbox is read past a cursor the
 * service hands back, held open while nothing changed, as a transcript is.
 * Every request refuses a key it does not name; an answer ignores one a
 * newer service added. An ask of a type this build does not know reads as
 * its type alone, so a desktop behind the service draws what it knows and a
 * placeholder for the rest rather than refusing the whole inbox. The
 * blocks and the responses below are also the vocabulary an old
 * transcript's post is written in.
 */

/**
 * The version of this vocabulary: moved on when a block or a response type
 * is added, so a desktop reading an item written under a later one knows
 * what it cannot draw was written for a newer Luke. Version 1 was the
 * fixed kinds, a choice, an approval, a question, and a task, with one
 * Markdown details field; version 2 is blocks and a response; version 3
 * adds the code block; version 4 adds the image block; version 5 adds an
 * ask (decide, do, or answer) and the answer to one on a thread's
 * messages, which an item is made of alone.
 */
export const INBOX_WIRE_VERSION = 5;

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
  /**
   * The most bytes one video may hold: a WebM the agent recorded of what it
   * did, held to the bound a transcript keeps one under, which the
   * recorder in its sandbox fits a recording to and which a function's
   * answer serves whole.
   */
  MAX_VIDEO_BYTES: 4_000_000,
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
  /** The most pictures the agent's message on a thread may carry, each held to the image bound: as many as a post's image blocks once could be. */
  MAX_MESSAGE_PICTURES: 8,
  /** The most steps a `do` ask may list: a to-do a person works through at a glance. */
  MAX_STEPS: 8,
  /** The most characters one step of a `do` ask may spell, in Markdown. */
  MAX_STEP_CHARS: 600,
  /** The most characters a post's channel may spell: a channel's name at its bound (`channel-wire.ts`), and the `#` an agent may write before it. */
  MAX_CHANNEL_CHARS: 81,
  /** The most characters a post's addressee may spell: a member's mention link written whole. */
  MAX_ADDRESSEE_CHARS: 512,
} as const;

/**
 * The tools an agent keeps its threads with, by the names their tool parts
 * carry in its transcript. Note that `close_inbox_item` and `reply_inbox`,
 * which a transcript before version 5 names, are retired, and so are
 * `post_to_inbox` and `read_inbox`, since named for the channels a thread
 * is posted to (`agent-tools.ts`'s `RETIRED_TOOL`): a post that asks
 * nothing is a reply, and a withdrawn ask is a close.
 */
export const INBOX_TOOL = {
  /** Adds the agent's message to the thread under its key, opening one under a new key in the channel it names, its ask replacing the open one. */
  POST: "post_thread",
  /** Withdraws the thread's open ask, with why. */
  WITHDRAW: "withdraw_ask",
  /** Reads the agent's threads as they stand, answers and all. */
  READ: "read_threads",
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

/**
 * The types a file of an item's may be kept and served under: any a
 * message's file travels as, or a WebM the agent recorded of what it did and
 * drew in its words as it draws a picture.
 */
export const INBOX_FILE_TYPE = {
  ...CODING_AGENT_ATTACHMENT_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export type InboxFileType = (typeof INBOX_FILE_TYPE)[keyof typeof INBOX_FILE_TYPE];

/** The responses an item asks for, each answered its own way. */
export const INBOX_RESPONSE = {
  /** Pick one of the agent's options, or several where it allows, some perhaps recommended, or answer in the developer's own words. */
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
  /** The agent took it back, or a member closed it without answering (`closedBy`). */
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

/** The asks a message on an item's thread may end with, from version 5, each answered its own way. */
export const INBOX_ASK = {
  /** Pick one of the agent's options, or several where it allows, some perhaps recommended. */
  DECIDE: "decide",
  /** Do steps by hand, ticking each, then mark it done, or say it could not be done. */
  DO: "do",
  /** Fill in typed fields, or, with none, answer in the reply's own words. */
  ANSWER: "answer",
} as const;

/** Where an ask stands, as a read carries it. */
export const INBOX_ASK_STATUS = {
  /** Waiting on an answer: the one ask of the item that is. */
  OPEN: "open",
  /** A member answered it. */
  ANSWERED: "answered",
  /** The agent asked again on a later message, which settled this one. */
  REPLACED: "replaced",
  /** The agent took it back, with why. */
  WITHDRAWN: "withdrawn",
} as const;

/**
 * The options a version 4 approval stands for as a `decide` ask, and the
 * picks an older desktop's Approve and Decline are read as.
 */
export const INBOX_APPROVAL_OPTION = {
  APPROVE: "Approve",
  DECLINE: "Decline",
} as const;

/** An item's key as the agent spells it: a short slug, the same each time it means the same item. */
const inboxKeySchema = EffectSchema.String.check(
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

/** What an image block says of its picture: the words that stand for it where it cannot be seen. */
const imageWords = { alt: filledText(INBOX_BOUNDS.MAX_ALT_CHARS) };

/** One block of an item's context as the service keeps it and the desktop reads it: a word block as the agent wrote it, or an image by the attachment the service keeps it as. */
const inboxBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    attachmentId: wireUuidSchema,
    ...imageWords,
  }),
]);

type InboxBlock = typeof inboxBlockSchema.Type;

/** A code block as an item carries it: the repository, the path, the lines, and the commit. */
export type InboxCodeBlock = Extract<InboxBlock, { type: typeof INBOX_BLOCK.CODE }>;

/** Whether a code block's lines run forward from its first and are few enough to read at a glance. */
export function codeLinesReadable(block: Pick<InboxCodeBlock, "startLine" | "endLine">): boolean {
  return (
    block.endLine >= block.startLine &&
    block.endLine - block.startLine < INBOX_BOUNDS.MAX_CODE_LINES
  );
}

/** One block as the agent posts it: the word blocks as they are kept, and an image by the path of its file in the agent's sandbox, which the service reads and keeps. */
const inboxPostBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    path: filledText(INBOX_BOUNDS.MAX_PATH_CHARS),
    ...imageWords,
  }),
]);

export type InboxPostBlock = typeof inboxPostBlockSchema.Type;

/** An item's context as the agent posts it: its blocks in order, few. */
const inboxPostBlocksSchema = EffectSchema.Array(inboxPostBlockSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_BLOCKS),
);

/** One option of a choice: its label, and the trade-off in a sentence where the agent wrote one. */
const inboxOptionSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  detail: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_OPTION_DETAIL_CHARS)),
});

/** One field of a form: its type, its label, which names its value in the answer, whether it must be filled, and a select's options, one perhaps recommended. */
const inboxFieldSchema = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(INBOX_FIELD)),
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  required: EffectSchema.optionalKey(EffectSchema.Boolean),
  options: EffectSchema.optionalKey(
    EffectSchema.Array(filledText(INBOX_BOUNDS.MAX_LABEL_CHARS)).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
  ),
  /** The select's option the agent recommends, as a choice names its recommended label. */
  recommended: EffectSchema.optionalKey(EffectSchema.String),
});

export type InboxField = typeof inboxFieldSchema.Type;

/**
 * What an agent recommends of a choice's options as it posts the choice:
 * one label, or a list of them, several only where the choice lets several
 * be picked.
 */
const recommendedInputSchema = EffectSchema.Union([
  EffectSchema.String,
  EffectSchema.Array(EffectSchema.String).check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
  ),
]);

/**
 * A choice's recommendation as it is kept: the first label recommended,
 * and every label in order where it recommends several. Note that the
 * first stays a label of its own, because a desktop from before several
 * reads `recommended` as one label and drops `recommendations` unread.
 */
const RECOMMENDED_FIELDS = {
  recommended: EffectSchema.optionalKey(EffectSchema.String),
  recommendations: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
  ),
};

/** A choice's recommendation as it was posted or as it is kept. */
interface Recommending {
  readonly recommended?: string | readonly string[];
  readonly recommendations?: readonly string[];
}

/** The labels a choice recommends, in order, as it was posted or as it is kept: none, one, or several. */
export function recommendedLabels(choice: Recommending): readonly string[] {
  if (choice.recommendations !== undefined) return choice.recommendations;
  if (choice.recommended === undefined) return [];
  return typeof choice.recommended === "string" ? [choice.recommended] : choice.recommended;
}

/** A posted recommendation as a choice keeps it: nothing, its one label, or its first label and every label. */
function keptRecommendation(choice: Recommending): {
  recommended?: string;
  recommendations?: readonly string[];
} {
  const labels = recommendedLabels(choice);
  const [first] = labels;
  if (first === undefined) return {};
  return labels.length === 1
    ? { recommended: first }
    : { recommended: first, recommendations: labels };
}

/**
 * What an item asks of the developer, one of six: a choice among options,
 * several where `multiple`, the labels it recommends named; an approval; words,
 * with what the box says while empty; a task; a form of fields, each select
 * naming the option it recommends; or nothing but an acknowledgement.
 */
const inboxResponseSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_RESPONSE.CHOICE),
    options: EffectSchema.Array(inboxOptionSchema).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
    multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
    ...RECOMMENDED_FIELDS,
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

/** What a read's tool part carries as its input: nothing, since an agent reads its own items alone. */
export const inboxReadInputSchema = EffectSchema.Struct({});

/** What a form's field holds once filled: words, a number, an option, or yes or no, by the field's type. */
const inboxFieldValueSchema = EffectSchema.Union([
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
const inboxFormValuesSchema = EffectSchema.Array(inboxFormValueSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
);

type InboxFormValues = typeof inboxFormValuesSchema.Type;

/** The developer's answer: how they answered, the options where they picked, the form's values where they filled one, and their note. */
const inboxReplySchema = EffectSchema.Struct({
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

/**
 * A type this build does not know, as a newer service wrote one: read as
 * the type's name alone, so it narrows away from every type this build
 * draws, and drawn as a placeholder naming a newer Luke. Note that a type
 * this build knows is refused here, because a known block, response, or
 * ask that fails its own shape is a broken read and not a newer one.
 */
function unknownTypeOf(known: readonly string[]) {
  const knownTypes: ReadonlySet<string> = new Set(known);
  return EffectSchema.String.check(EffectSchema.makeFilter((type) => !knownTypes.has(type))).pipe(
    EffectSchema.brand("UnknownInboxType"),
  );
}

/** A step of a `do` ask by its place in the ask's steps, from the first at 0. */
const stepIndexSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(0),
  EffectSchema.isLessThan(INBOX_BOUNDS.MAX_STEPS),
);

/** A `decide` ask's own keys as it is kept: two to six options, several to be picked where `multiple`, and those recommended by their labels, several where several may be picked. */
const DECIDE_FIELDS = {
  type: EffectSchema.Literal(INBOX_ASK.DECIDE),
  options: EffectSchema.Array(inboxOptionSchema).check(
    EffectSchema.isMinLength(2),
    EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
  ),
  multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
  ...RECOMMENDED_FIELDS,
};

/** A `decide` ask's own keys as the agent posts it: those it is kept by, but its recommendation one label or a list of them. */
const DECIDE_INPUT_FIELDS = {
  type: DECIDE_FIELDS.type,
  options: DECIDE_FIELDS.options,
  multiple: DECIDE_FIELDS.multiple,
  recommended: EffectSchema.optionalKey(recommendedInputSchema),
};

/**
 * A `do` ask's own keys: its steps in Markdown, in order, few. Note that
 * none is a `do` ask too, because a version 4 to-do named no step and its
 * item's words say what to do; marking it done ticks nothing.
 */
const DO_FIELDS = {
  type: EffectSchema.Literal(INBOX_ASK.DO),
  steps: EffectSchema.Array(filledText(INBOX_BOUNDS.MAX_STEP_CHARS)).check(
    EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_STEPS),
  ),
};

/** An `answer` ask's own keys: the fields of a form, where it asks typed values, and none where the reply's words are the answer. */
const ANSWER_FIELDS = {
  type: EffectSchema.Literal(INBOX_ASK.ANSWER),
  fields: EffectSchema.optionalKey(
    EffectSchema.Array(inboxFieldSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
    ),
  ),
};

/** What a message asks of its reader, one of three: decide among options, do steps, or answer. */
const inboxAskSchema = EffectSchema.Union([
  EffectSchema.Struct(DECIDE_FIELDS),
  EffectSchema.Struct(DO_FIELDS),
  EffectSchema.Struct(ANSWER_FIELDS),
]);

export type InboxAsk = typeof inboxAskSchema.Type;

/** An ask as the agent posts it: one it is kept as, but a `decide`'s recommendation one label or a list of them. */
const inboxAskInputSchema = EffectSchema.Union([
  EffectSchema.Struct(DECIDE_INPUT_FIELDS),
  EffectSchema.Struct(DO_FIELDS),
  EffectSchema.Struct(ANSWER_FIELDS),
]);

export type InboxAskInput = typeof inboxAskInputSchema.Type;

/** A posted ask as a message keeps it: a `decide`'s recommendation its first label and, where several, every one. */
export function keptInboxAsk(ask: InboxAskInput): InboxAsk {
  if (ask.type !== INBOX_ASK.DECIDE) return ask;
  const { recommended: _recommended, ...rest } = ask;
  return { ...rest, ...keptRecommendation(ask) };
}

/**
 * What a post's tool part carries as its input from version 5: the
 * thread's key, its title, which a first post under the key names, the
 * agent's message as one Markdown body, its pictures by their paths in the
 * agent's sandbox, the ask it may end with, and whether the agent waits to
 * hear a `do` done; an answer to any other ask is always heard. From
 * Channels, the channel it goes to by name, `#` or not, and the member its
 * ask is addressed to by their mention link, each read by the service
 * rather than held to a grammar here, so a name or a link that names
 * nothing is refused in words the model can act on. The model is shown
 * this schema and eve holds the call to it.
 */
export const inboxThreadPostInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  title: EffectSchema.optionalKey(filledText(INBOX_BOUNDS.MAX_TITLE_CHARS)),
  body: filledText(INBOX_BOUNDS.MAX_MESSAGE_CHARS),
  channel: EffectSchema.optionalKey(filledText(INBOX_BOUNDS.MAX_CHANNEL_CHARS)),
  to: EffectSchema.optionalKey(filledText(INBOX_BOUNDS.MAX_ADDRESSEE_CHARS)),
  ask: EffectSchema.optionalKey(inboxAskInputSchema),
  waits: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxThreadPostInput = typeof inboxThreadPostInputSchema.Type;

/** What a withdrawal's tool part carries as its input: the thread's key, and why the agent takes its open ask back. */
export const inboxWithdrawInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  reason: filledText(INBOX_BOUNDS.MAX_REASON_CHARS),
});

/** Where an ask stands as a read carries it, and why its agent withdrew it, on a withdrawn one. */
const ASK_STANDING_FIELDS = {
  status: EffectSchema.Literals(Object.values(INBOX_ASK_STATUS)),
  withdrawnReason: EffectSchema.optionalKey(EffectSchema.String),
};

/**
 * An ask as a message read carries it: one this build knows, or the type
 * alone of one it does not, each with where it stands, so a desktop behind
 * the service draws a placeholder for a newer ask and still knows whether
 * it waits.
 */
export const inboxReadAskSchema = EffectSchema.Union([
  EffectSchema.Struct({ ...DECIDE_FIELDS, ...ASK_STANDING_FIELDS }),
  EffectSchema.Struct({ ...DO_FIELDS, ...ASK_STANDING_FIELDS }),
  EffectSchema.Struct({ ...ANSWER_FIELDS, ...ASK_STANDING_FIELDS }),
  EffectSchema.Struct({
    type: unknownTypeOf(Object.values(INBOX_ASK)),
    ...ASK_STANDING_FIELDS,
  }),
]);

export type InboxReadAsk = typeof inboxReadAskSchema.Type;

/**
 * The answer a member's message carries: the message whose ask it answers,
 * by id, how they answered, the options where they picked, the form's
 * values where they filled one, and the steps they ticked, by place. Their
 * words and files are the message's own.
 */
export const inboxAnswersSchema = EffectSchema.Struct({
  ask: wireUuidSchema,
  reply: EffectSchema.Literals(Object.values(INBOX_REPLY)),
  choices: inboxReplySchema.fields.choices,
  values: EffectSchema.optionalKey(inboxFormValuesSchema),
  steps: EffectSchema.optionalKey(
    EffectSchema.Array(stepIndexSchema).check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_STEPS)),
  ),
});

export type InboxAnswers = typeof inboxAnswersSchema.Type;

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
 * same attachment path; from version 5, the ask it ends with, on an
 * agent's, or the answer it carries, on a member's; and when it was
 * written. Note that the words keep the name `text`, which a desktop before
 * version 5 requires.
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
  /** The ask the message ends with, and where it stands; absent where it asks nothing. */
  ask: EffectSchema.optionalKey(inboxReadAskSchema),
  /** The answer the message carries to an earlier message's ask; absent where it answers none. */
  answers: EffectSchema.optionalKey(inboxAnswersSchema),
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
  /** Whether the agent hears an answer to its open `do` ask as a message, rather than reading it in its own time; every other ask's answer it always hears. */
  needsReply: EffectSchema.Boolean,
  status: EffectSchema.Literals(Object.values(INBOX_STATUS)),
  /**
   * The member who started the agent that posted the item, whose question it
   * is, as the account's read names it (`account-inbox-wire.ts`); absent from
   * a service before it, which the desktop reads as the reader's own, as it
   * read every item before.
   */
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  /**
   * The member the item waits on: the member its agent addressed it to, or,
   * where it names none, its task's assignee, or, where the task has nobody
   * assigned or the agent works on no task, the member who started the agent
   * (`startedBy`). Absent from a service before it, which the desktop reads
   * as waiting on `startedBy`.
   */
  waitsOn: EffectSchema.optionalKey(memberRefSchema),
  /**
   * Whether the agent addressed the item to a member, who is then the one it
   * waits on (`waitsOn`): a notice addressed to nobody asks nobody for Got it
   * under Channels. Absent from a service before it, which the desktop reads
   * as addressed to nobody.
   */
  addressed: EffectSchema.optionalKey(EffectSchema.Boolean),
  /**
   * The member who answered, on an answered item, any member of the task's
   * workspace; absent for an answer nobody can be named for, and from a
   * service before answerers were kept. The window says "You" only where it
   * is the signed-in account.
   */
  answeredBy: EffectSchema.optionalKey(memberRefSchema),
  /** Why the agent took the item back, on one it closed. */
  closedReason: EffectSchema.optionalKey(EffectSchema.String),
  /**
   * The member who closed the item without answering it, on one a member
   * closed; absent on one its agent took back, and once the member's
   * account is gone. Absent from a service before members closed items.
   */
  closedBy: EffectSchema.optionalKey(memberRefSchema),
  /**
   * The item's thread, oldest first: the latest `MAX_MESSAGES_READ` of every
   * message, asks and answers included, and the first message and the one
   * whose ask is open however long ago they were written; absent where
   * nobody wrote one.
   */
  thread: EffectSchema.optionalKey(EffectSchema.Array(inboxMessageSchema)),
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
  /**
   * Whether the item is unread for the member reading it: it changed after
   * the last change they read through, or they marked it unread and have
   * not read it since. Their own answer or message leaves it read for them;
   * another member's marker never moves it. Absent from a service before it,
   * which the desktop reads as read.
   */
  unread: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxItem = typeof inboxItemSchema.Type;

/** A member an item names, as the service names them: who it waits on (`inboxWaitsOn`), or who started its agent. */
export type InboxPerson = NonNullable<InboxItem["startedBy"]>;

/** The message whose ask waits on an answer, and the ask; none where nothing waits. */
export interface InboxAsking {
  readonly message: InboxMessage;
  readonly ask: InboxReadAsk;
}

/** The thread's open ask: the latest message whose ask stands open; none where none does. */
export function openAskOf(thread: readonly InboxMessage[]): InboxAsking | undefined {
  const message = thread.findLast((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN);
  return message?.ask === undefined ? undefined : { message, ask: message.ask };
}

/**
 * The member an item waits on: the member its agent addressed it to, else
 * its task's assignee, or its agent's starter where the task has nobody
 * assigned or the agent works on no task, as the service resolves it
 * (`inbox-store.ts`'s `WAITS_ON`); its starter from a service before it
 * said; none where it names neither.
 */
export function inboxWaitsOn(item: InboxItem): InboxPerson | undefined {
  return item.waitsOn ?? item.startedBy;
}

/** Whether a thread still asks someone something: open, and holding an ask open, as the service's `ASKING` reads it. */
export function inboxAsksOpen(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) !== undefined;
}

/**
 * Whether a thread needs the reader: its ask stands open and waits on them.
 * The one reading of it, which a channel's count (`inbox-store.ts`'s
 * `askingReader`) must agree with and its stream, Needs me, and the tint
 * all draw from.
 */
export function threadNeedsReader(item: InboxItem, readerId: string | undefined): boolean {
  return readerId !== undefined && inboxAsksOpen(item) && inboxWaitsOn(item)?.userId === readerId;
}

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
 * A member's nod on a notice, Got it, which settles it as acknowledged: the
 * revision they were shown, so a notice the agent posted over since is not
 * settled unseen, and a key the client made, so a nod sent again after a
 * lost reply is taken once. Every other answer is a message on the thread
 * carrying the answer to its open ask (`inboxMessageRequestSchema`).
 */
export const inboxAcknowledgeRequestSchema = EffectSchema.Struct({
  revision: countedNumber,
  reply: EffectSchema.Literal(INBOX_REPLY.ACKNOWLEDGED),
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

export type InboxAcknowledgeRequest = typeof inboxAcknowledgeRequestSchema.Type;

/**
 * The transaction a member's write on the inbox committed in, as Neon's
 * mutations guide returns it, which a window following the inbox waits for
 * on its live view before it answers; left out where the write changed no
 * row, and by a service from before it, so there is nothing to wait for.
 */
const writtenIn = { txid: EffectSchema.optionalKey(EffectSchema.String) };

/** What a nod or a close comes back as: the item as it then stands, whether it was taken, which it is not where the agent changed the item first, and the transaction it was taken in. */
export const inboxAnsweredSchema = EffectSchema.Struct({
  item: inboxItemSchema,
  taken: EffectSchema.Boolean,
  ...writtenIn,
});

/** How the developer's answer opens, in the message that hands it to the agent. */
export const INBOX_ANSWER_LEAD = "Inbox answer";

/**
 * A member's close of one item without an answer: the revision they were
 * shown, so an item the agent changed since is not closed unseen, and a key
 * the client made, so a close sent again after a lost reply reaches the
 * agent once. It answers as a nod does (`inboxAnsweredSchema`): the item
 * as it then stands, and whether the close was taken.
 */
export const inboxCloseRequestSchema = EffectSchema.Struct({
  revision: countedNumber,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

export type InboxCloseRequest = typeof inboxCloseRequestSchema.Type;

/** How a member's close opens, in the message that tells the agent of it. */
export const INBOX_CLOSE_LEAD = "Inbox closed";

/**
 * The message a member's close reaches the agent as: a first line naming
 * the item by its key and title, as an answer's does, and that it was
 * closed without an answer, which the agent takes as the developer not
 * wanting what it asked.
 */
export function inboxClosedMessage(item: Pick<InboxItem, "key" | "title">): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  return `${INBOX_CLOSE_LEAD} on "${title}" (key ${item.key}): Closed without an answer.`;
}

/**
 * A member's message on an item's thread: the words in Markdown, trimmed and
 * bounded, the files they attached, bounded as a message's to an agent are,
 * and a key the client made, so a message sent again after a lost reply is
 * written once. From version 5 it may carry the answer to the thread's open
 * ask, which the reader pressed and attached to their reply: such a message
 * is the one that answers the ask, and may be the answer alone, with no
 * words or files; one without it is a plain reply, words or files or both
 * and never neither, which never answers.
 */
export const inboxMessageRequestSchema = EffectSchema.Struct({
  text: EffectSchema.Trim.check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
  attachments: codingAgentMessageRequestSchema.fields.attachments,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
  /** The answer to the thread's open ask, which names it; absent on a plain reply. */
  answers: EffectSchema.optionalKey(inboxAnswersSchema),
  /** The revision of the notice the reply was written on, which it settles where the notice still stands there; absent where it settles none, as from a client before it. */
  revision: EffectSchema.optionalKey(countedNumber),
}).check(
  EffectSchema.makeFilter(
    ({ text, attachments, answers }) => answers !== undefined || hasWordsOrFiles(text, attachments),
  ),
);

export type InboxMessageRequest = typeof inboxMessageRequestSchema.Type;

/** What a member's message comes back as: the item as it then stands, its thread with the message on it, and, where the message answered the thread's open ask, the transaction it was taken in. */
export const inboxMessagedSchema = EffectSchema.Struct({ item: inboxItemSchema, ...writtenIn });

/**
 * A thread a member starts with an agent, as a new mail is written: the
 * agent it goes to, its subject, and its first message, which is a member's
 * message as `inboxMessageRequestSchema` bounds one, words or files or both
 * and never neither. The service mints the thread's key from its subject, so
 * a member never names one the agent already keeps.
 */
export const inboxStartRequestSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  /** The thread's subject; absent where the member wrote none, which its first message's first line stands for (`inboxStartTitle`). */
  title: EffectSchema.optionalKey(
    EffectSchema.Trim.check(
      EffectSchema.isNonEmpty(),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_TITLE_CHARS),
    ),
  ),
  text: inboxMessageRequestSchema.fields.text,
  attachments: inboxMessageRequestSchema.fields.attachments,
  clientKey: inboxMessageRequestSchema.fields.clientKey,
}).check(EffectSchema.makeFilter(({ text, attachments }) => hasWordsOrFiles(text, attachments)));

export type InboxStartRequest = typeof inboxStartRequestSchema.Type;

/** The longest title a thread's first line stands for its subject in, cut on a word where one ends near it. */
const STARTED_TITLE_CHARS = 60;

/** The title of a thread started with no subject where its message holds neither words nor a file. */
const STARTED_TITLE_FALLBACK = "Untitled item";

/** A code fence's line, which opens or closes a block and says nothing itself, its language among it. */
const CODE_FENCE = /^\s*(?:```|~~~)/u;

/** A thematic break's line, three or more of one of its marks alone, which separates and says nothing. */
const THEMATIC_BREAK = /^\s*([-*_])(?:[ \t]*\1){2,}\s*$/u;

/**
 * A line of Markdown as plain words: its heading, quote, or list mark, each
 * link as its label or its mention's name (`linkLabels`), and no emphasis
 * or code marks, an underscore inside a word, as an identifier's, kept;
 * nothing for a code fence's line or a thematic break's.
 */
function plainLine(line: string): string {
  if (CODE_FENCE.test(line) || THEMATIC_BREAK.test(line)) return "";
  return linkLabels(line.replace(/!\[/gu, "["))
    .replace(/^\s*(?:#{1,6}|>+|[-*+]|\d+[.)])\s+/u, "")
    .replace(/[*`~]/gu, "")
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Words cut to a title's short line, on a word where one ends near the cut. */
function shortTitle(words: string): string {
  if (words.length <= STARTED_TITLE_CHARS) return words;
  const cut = words.slice(0, STARTED_TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > STARTED_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * The title of a thread a member started: the subject they wrote, or,
 * where they wrote none, the first line of their message that says
 * anything, as plain words, or the name of its first file where it holds
 * no words, each cut to a short line on a word.
 */
export function inboxStartTitle(
  request: Pick<InboxStartRequest, "title" | "text" | "attachments">,
): string {
  if (request.title !== undefined) return request.title;
  const line = request.text
    .split("\n")
    .map(plainLine)
    .find((each) => each !== "");
  return shortTitle(line ?? request.attachments?.[0]?.name ?? STARTED_TITLE_FALLBACK);
}

/** One item's read state for the member who marked it, as marking it read or unread answers it. */
export const inboxReadStateSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  unread: EffectSchema.Boolean,
  ...writtenIn,
});

/**
 * Marking every item of the reader's Inbox read: every item it lists, in
 * the one workspace named, or in every workspace of the account's where
 * none is.
 */
export const inboxReadAllRequestSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.optionalKey(workspaceIdSchema),
});

export type InboxReadAllRequest = typeof inboxReadAllRequestSchema.Type;

/** What marking every item read answers: how many items it marked read that were unread, and the transaction that marked them. */
export const inboxReadAllSchema = EffectSchema.Struct({ marked: countedNumber, ...writtenIn });

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

/** An answer's, a close's, or a thread message's first line, as `inboxAnswerMessage`, `inboxClosedMessage`, and `inboxThreadMessage` write it. */
const INBOX_LINE_HEAD = new RegExp(
  `^(${INBOX_ANSWER_LEAD}|${INBOX_CLOSE_LEAD}|${INBOX_MESSAGE_LEAD}) on (".*") \\(key [a-z0-9][a-z0-9._-]*\\):`,
  "u",
);

/**
 * An inbox answer or thread message as the developer reads it back in the
 * agent's transcript: its first line without the item's key, which names the
 * item to the agent and says nothing the title beside it does not to a
 * person. Any other line is answered as it is.
 */
export function inboxLineWords(text: string): string {
  return text.replace(INBOX_LINE_HEAD, "$1 on $2:");
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

/** A `do` ask's steps and those an answer to it ticked, by place, as the agent hears them. */
export interface InboxTodoTicks {
  readonly steps: readonly string[];
  readonly ticked: readonly number[];
}

/** What the developer did, as the header says it: a `do`'s steps ticked with neither press by how many, else the answer's own words. */
function answerHeadWords(reply: InboxReply, todo: InboxTodoTicks | undefined): string {
  if (reply.reply !== INBOX_REPLY.ANSWERED || todo === undefined || todo.ticked.length === 0) {
    return replyWords(reply);
  }
  const total = todo.steps.length;
  return `Ticked ${todo.ticked.length} of ${total} ${total === 1 ? "step" : "steps"}.`;
}

/** A `do`'s steps as a checklist, each ticked or not; nothing where it names none. */
function checklistLines(todo: InboxTodoTicks | undefined): string {
  if (todo === undefined) return "";
  const ticked = new Set(todo.ticked);
  return todo.steps
    .map((step, at) => `- [${ticked.has(at) ? "x" : " "}] ${step.replace(/\s+/gu, " ").trim()}`)
    .join("\n");
}

/**
 * The steps of the `do` ask an answer answers, and those the answer
 * ticked: the ask as given where the caller holds it, since a long
 * thread's read may have left it out, else as the item's thread carries
 * it; nothing where the answer is to another kind of ask, its ask names no
 * steps, or neither carries it.
 */
export function inboxTodoTicks(
  item: Pick<InboxItem, "thread">,
  answers: InboxAnswers,
  answered?: InboxAsk,
): InboxTodoTicks | undefined {
  const ask = answered ?? (item.thread ?? []).find((message) => message.id === answers.ask)?.ask;
  if (ask?.type !== INBOX_ASK.DO) return undefined;
  const steps = (ask as { readonly steps?: readonly string[] }).steps ?? [];
  return steps.length === 0 ? undefined : { steps, ticked: answers.steps ?? [] };
}

/**
 * The message an answer reaches the agent as: a first line naming the item
 * by its key and title with what the developer did, then a `do`'s steps as
 * a checklist where the answer's ask names them (`todo`), then a form's
 * values one per line, then their note. Note that the title is put on one
 * line, because the line is read whole.
 */
export function inboxAnswerMessage(
  item: Pick<InboxItem, "key" | "title">,
  reply: InboxReply,
  todo?: InboxTodoTicks,
): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_ANSWER_LEAD} on "${title}" (key ${item.key}): ${answerHeadWords(reply, todo)}`;
  const checklist = checklistLines(todo);
  const values = reply.values === undefined ? "" : valueLines(reply.values);
  const note = reply.note?.trim() ?? "";
  return [header, checklist, values, note].filter((part) => part !== "").join("\n\n");
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

/** The refusal of a form whose required field is empty. */
const REQUIRED_EMPTY = "A required field of the form is empty.";

/**
 * Why a form's values do not answer the form, or nothing where they do:
 * each names a field once and is of its type, a required one never blank,
 * and every required field is filled, unless the answer gives something, a
 * value filled or the developer's own words or files, since a form filled
 * in part still sends what was filled; a field left empty is simply absent
 * from the values, never there blank.
 */
function formRefusal(
  form: Pick<InboxForm, "fields">,
  values: InboxFormValues | undefined,
  said: boolean,
): string | undefined {
  const given = new Map((values ?? []).map(({ label, value }) => [label, value]));
  if (given.size !== (values ?? []).length) return "A value names a field twice.";
  const fields = new Map(form.fields.map((field) => [field.label, field]));
  for (const [label, value] of given) {
    const field = fields.get(label);
    if (field === undefined) return "A value names no field of the form.";
    if (!fieldTakes(field, value)) return "A value is not of its field's type.";
    if (field.required === true && !filled(value)) return REQUIRED_EMPTY;
  }
  if (said || [...given.values()].some(filled)) return undefined;
  for (const field of form.fields) {
    const value = given.get(field.label);
    if (field.required === true && value === undefined) return REQUIRED_EMPTY;
  }
  return undefined;
}

/** Whether the developer said something of their own beside an answer: words, or a file. */
function saysAny(words: string, files: AnswerFiles): boolean {
  return words.trim() !== "" || files.length > 0;
}

/** Why a pick does not fit the choice, or nothing where it does: at least one option, each offered and once, and one alone unless the choice allows several. */
function choiceRefusal(
  choice: Pick<InboxChoice, "options" | "multiple">,
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

/** Why an answer in the developer's own words does not stand, or nothing where it does: words or files, as a message to an agent may be files alone. */
function ownWordsRefusal(words: string, files: AnswerFiles): string | undefined {
  if (!saysAny(words, files)) {
    return "An answer in the developer's own words needs words or a file.";
  }
  return undefined;
}

/**
 * Why an answer does not fit the response it answers, or nothing where it
 * does: the response takes the reply, a pick names offered options, a
 * form's values fit it, filling it or giving something beside the note or
 * the files, and words or files stand where the answer is the developer's
 * own, as a message to an agent may be files alone.
 */
export function inboxReplyRefusal(
  response: InboxResponse,
  reply: InboxReply,
  files: AnswerFiles = [],
): string | undefined {
  const takes: readonly InboxReplyKind[] = INBOX_REPLIES_OF[response.type];
  if (!takes.includes(reply.reply)) return "The item does not take that answer.";
  if (reply.reply === INBOX_REPLY.CHOSE && response.type === INBOX_RESPONSE.CHOICE) {
    return choiceRefusal(response, reply.choices);
  }
  if (reply.reply === INBOX_REPLY.SUBMITTED && response.type === INBOX_RESPONSE.FORM) {
    return formRefusal(response, reply.values, saysAny(reply.note ?? "", files));
  }
  if (reply.reply === INBOX_REPLY.ANSWERED) return ownWordsRefusal(reply.note ?? "", files);
  return undefined;
}

/** The refusal of an answer an ask does not take at all. */
const NOT_TAKEN = "The ask does not take that answer.";

/**
 * Why the steps an answer ticks do not fit a `do` ask, or nothing where
 * they do: each names one of its steps, once, and Mark done ticks every one.
 */
function stepsRefusal(
  ask: Extract<InboxAsk, { type: typeof INBOX_ASK.DO }>,
  answers: InboxAnswers,
): string | undefined {
  const ticked = answers.steps ?? [];
  if (new Set(ticked).size !== ticked.length) return "A step is ticked twice.";
  if (!ticked.every((step) => step < ask.steps.length)) return "A tick names no step of the ask.";
  if (answers.reply === INBOX_REPLY.DONE && ticked.length !== ask.steps.length) {
    return "Mark done needs every step ticked.";
  }
  return undefined;
}

/**
 * Why an answer does not fit the ask it answers, or nothing where it does:
 * a `decide` takes a pick of offered options, or words or files where none
 * fits; a `do` takes Mark done, with every step ticked, Couldn't do it,
 * or the steps ticked with neither, at least one, as an answer;
 * an `answer` with fields takes their values, every required one filled
 * unless something is given, a value or words or files, and one without
 * takes words or files. The words and files are those of the answering
 * message.
 */
export function inboxAnswersRefusal(
  ask: InboxAsk,
  answers: InboxAnswers,
  words: string,
  files: AnswerFiles = [],
): string | undefined {
  switch (ask.type) {
    case INBOX_ASK.DECIDE:
      if (answers.reply === INBOX_REPLY.CHOSE) return choiceRefusal(ask, answers.choices);
      if (answers.reply === INBOX_REPLY.ANSWERED) return ownWordsRefusal(words, files);
      return NOT_TAKEN;
    case INBOX_ASK.DO:
      if (answers.reply === INBOX_REPLY.DONE || answers.reply === INBOX_REPLY.NOT_DONE) {
        return stepsRefusal(ask, answers);
      }
      // Steps ticked with neither press go as an answer that decides nothing, so it must tick one.
      if (answers.reply === INBOX_REPLY.ANSWERED && (answers.steps ?? []).length > 0) {
        return stepsRefusal(ask, answers);
      }
      return NOT_TAKEN;
    case INBOX_ASK.ANSWER:
      if (ask.fields !== undefined) {
        return answers.reply === INBOX_REPLY.SUBMITTED
          ? formRefusal({ fields: ask.fields }, answers.values, saysAny(words, files))
          : NOT_TAKEN;
      }
      return answers.reply === INBOX_REPLY.ANSWERED ? ownWordsRefusal(words, files) : NOT_TAKEN;
  }
}

/**
 * An older desktop's answer, given against the item's version 4 response,
 * as the answer to the open ask, which the message `asking.id` ends with:
 * a pick as a pick, Approve and Decline as a pick of that option, Done as
 * Mark done with every step ticked, since an older desktop shows none to
 * tick, and the rest as they are. The note becomes the answering message's
 * words. An acknowledgement answers no ask, since an item that asks nothing
 * has none. Note that the answer is not checked here: `inboxAnswersRefusal`
 * reads it against the ask.
 */
export function inboxReplyAnswers(
  asking: { readonly id: string; readonly ask: InboxAsk },
  reply: InboxReply,
): InboxAnswers | undefined {
  const ask = asking.id;
  switch (reply.reply) {
    case INBOX_REPLY.CHOSE:
      return reply.choices === undefined
        ? { ask, reply: INBOX_REPLY.CHOSE }
        : { ask, reply: INBOX_REPLY.CHOSE, choices: reply.choices };
    case INBOX_REPLY.APPROVED:
      return { ask, reply: INBOX_REPLY.CHOSE, choices: [INBOX_APPROVAL_OPTION.APPROVE] };
    case INBOX_REPLY.DECLINED:
      return { ask, reply: INBOX_REPLY.CHOSE, choices: [INBOX_APPROVAL_OPTION.DECLINE] };
    case INBOX_REPLY.DONE:
      return asking.ask.type === INBOX_ASK.DO
        ? { ask, reply: INBOX_REPLY.DONE, steps: asking.ask.steps.map((_step, index) => index) }
        : { ask, reply: INBOX_REPLY.DONE };
    case INBOX_REPLY.SUBMITTED:
      return reply.values === undefined
        ? { ask, reply: INBOX_REPLY.SUBMITTED }
        : { ask, reply: INBOX_REPLY.SUBMITTED, values: reply.values };
    case INBOX_REPLY.NOT_DONE:
    case INBOX_REPLY.ANSWERED:
      return { ask, reply: reply.reply };
    case INBOX_REPLY.ACKNOWLEDGED:
      return undefined;
  }
}

/**
 * A member's answer to an ask, with the words of the message that carries
 * it, as the agent hears an answer (`inboxAnswerMessage`) and as whether it
 * hears it is read (`inboxAnswerHeard`): how they answered, the options
 * picked, the values filled, and the words as the note, whole. Note that the
 * steps ticked are left out, because a reply names no step; the thread the
 * agent reads carries them.
 */
export function inboxAnswersReply(answers: InboxAnswers, words: string): InboxReply {
  const note = words.trim();
  return {
    reply: answers.reply,
    ...(answers.choices === undefined ? undefined : { choices: answers.choices }),
    ...(answers.values === undefined ? undefined : { values: answers.values }),
    ...(note === "" ? undefined : { note }),
  };
}

/** An ask as a message keeps it without where it stands, where this build knows its type; nothing for a type a newer deployment wrote. */
export function knownAsk(ask: InboxReadAsk): InboxAsk | undefined {
  const { status: _status, withdrawnReason: _reason, ...kept } = ask;
  return EffectSchema.is(inboxAskSchema)(kept) ? kept : undefined;
}

/** Where an item stands, as each ask of its thread is read against it. */
export interface InboxAskStanding {
  readonly status: InboxStatus;
  readonly openAskMessageId: string | null;
  readonly closedReason: string | null;
}

/**
 * An ask as a read carries it: as it was kept, unless it was kept open and
 * the item no longer holds it open, which a deployment from before version
 * 5 leaves by closing the item without a word to the ask; then withdrawn
 * with the item's reason where the item closed on it, answered where the
 * item was answered on it, and replaced where the item holds another.
 * Note that an ask withdrawn with no reason is a member's close without an
 * answer, the item's `closedBy` naming the member while the close stands,
 * because an agent's close always says why: a reader tells the two closes
 * apart by the reason alone, as it tells a closed item's.
 */
export function standingAsk(
  ask: InboxReadAsk,
  messageId: string,
  item: InboxAskStanding,
): InboxReadAsk {
  if (ask.status !== INBOX_ASK_STATUS.OPEN) return ask;
  const replaced = { ...ask, status: INBOX_ASK_STATUS.REPLACED };
  if (messageId !== item.openAskMessageId) return replaced;
  switch (item.status) {
    case INBOX_STATUS.OPEN:
      return ask;
    case INBOX_STATUS.ANSWERED:
      return { ...ask, status: INBOX_ASK_STATUS.ANSWERED };
    case INBOX_STATUS.CLOSED:
      return item.closedReason === null
        ? { ...ask, status: INBOX_ASK_STATUS.WITHDRAWN }
        : { ...ask, status: INBOX_ASK_STATUS.WITHDRAWN, withdrawnReason: item.closedReason };
  }
}
