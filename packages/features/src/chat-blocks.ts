import { isWireBoolean, isWireNumber, isWireString } from "@luke/wire";
import { Schema as EffectSchema } from "effect";
import { CODING_AGENT_ATTACHMENT_TYPE, CODING_AGENT_BOUNDS } from "./coding-agent-wire.js";
import { githubRepositoryFullNameSchema } from "./github-repositories-wire.js";
import { CODE_PATH_MAX_CHARS, codeLineSchema, commitShaSchema } from "./task-wire.js";
import { wireUuidSchema } from "./service-wire.js";

/**
 * chat-blocks.ts -- what a chat message's body and its ask are made of: the blocks, the responses an ask asks, and the answers it takes.
 *
 * Kept apart from the rest of the chat's vocabulary (`chat-wire.ts`, which
 * re-exports every name here) because the Inbox's wire shares these shapes
 * and the window's bundle reaches them through it: a module of these alone
 * is what the Inbox's reader pays for, and none of the chat's own requests
 * and answers ride in with it.
 */

/** The bounds of a message's body and its ask, which the Inbox shares. */
export const ASK_BOUNDS = {
  /** The most characters a key may spell, an ask's or a channel's name: a short slug the poster chooses. */
  MAX_KEY_CHARS: 80,
  /** The most characters an ask's title may spell: one line. */
  MAX_TITLE_CHARS: 160,
  /** The most blocks a message may carry. */
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
  /** The most characters an answer's note may spell. */
  MAX_NOTE_CHARS: 4_000,
  /** The most characters the poster's reason for resolving an ask may spell. */
  MAX_REASON_CHARS: 600,
  /** The most characters a cursor may spell. */
  MAX_CURSOR_CHARS: 64,
  /** The most characters a client's key for a post or an answer may spell; a UUID is the usual. */
  MAX_CLIENT_KEY_CHARS: 128,
} as const;

/** The blocks a message's body is made of. */
export const CHAT_BLOCK = {
  /** Words in Markdown. */
  MARKDOWN: "markdown",
  /** An address with a label, such as the GitHub page a task is done on. */
  LINK: "link",
  /** Lines of a file of the agent's repository, as they stood at a commit. */
  CODE: "code",
  /** A picture the agent took in its sandbox, kept as an attachment of the message's. */
  IMAGE: "image",
} as const;

/** The pictures an image block may be, by the media type each is kept and served under; the bytes are sniffed for one of these, never trusted by name. */
export const CHAT_IMAGE_TYPE = {
  PNG: CODING_AGENT_ATTACHMENT_TYPE.PNG,
  JPEG: CODING_AGENT_ATTACHMENT_TYPE.JPEG,
  WEBP: CODING_AGENT_ATTACHMENT_TYPE.WEBP,
} as const;

export type ChatImageType = (typeof CHAT_IMAGE_TYPE)[keyof typeof CHAT_IMAGE_TYPE];

/** An image's media type as the wire carries it: one of the three the service keeps. */
export const chatImageTypeSchema = EffectSchema.Literals(Object.values(CHAT_IMAGE_TYPE));

/** The responses an ask asks for, each answered its own way. */
export const CHAT_ASK = {
  /** Pick one of the poster's options, or several where it allows, one perhaps recommended, or answer in one's own words. */
  CHOICE: "choice",
  /** Approve or decline a step the poster proposes. */
  APPROVAL: "approval",
  /** An open answer in one's own words. */
  TEXT: "text",
  /** Something done by hand, such as a setting on GitHub, marked done or not possible. */
  TASK: "task",
  /** Typed fields filled in. */
  FORM: "form",
  /** Nothing but an acknowledgement: something the room should know. */
  NONE: "none",
} as const;

type ChatAskType = (typeof CHAT_ASK)[keyof typeof CHAT_ASK];

/** The fields a form may ask. */
export const CHAT_FIELD = {
  /** A line of words. */
  TEXT: "text",
  /** A number. */
  NUMBER: "number",
  /** One of the field's options. */
  SELECT: "select",
  /** Yes or no. */
  BOOLEAN: "boolean",
} as const;

/** Where an ask stands. */
export const ASK_STATUS = {
  /** Waiting on an answer. */
  OPEN: "open",
  /** A member answered it. */
  ANSWERED: "answered",
  /** The poster resolved it. */
  CLOSED: "closed",
} as const;

export type AskStatus = (typeof ASK_STATUS)[keyof typeof ASK_STATUS];

/** How an ask was answered. */
export const CHAT_REPLY = {
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
  /** Read an ask that asked for nothing. */
  ACKNOWLEDGED: "acknowledged",
} as const;

export type ChatReplyKind = (typeof CHAT_REPLY)[keyof typeof CHAT_REPLY];

/** The answers each response takes. */
const CHAT_REPLIES_OF = {
  [CHAT_ASK.CHOICE]: [CHAT_REPLY.CHOSE, CHAT_REPLY.ANSWERED],
  [CHAT_ASK.APPROVAL]: [CHAT_REPLY.APPROVED, CHAT_REPLY.DECLINED],
  [CHAT_ASK.TEXT]: [CHAT_REPLY.ANSWERED],
  [CHAT_ASK.TASK]: [CHAT_REPLY.DONE, CHAT_REPLY.NOT_DONE],
  [CHAT_ASK.FORM]: [CHAT_REPLY.SUBMITTED],
  [CHAT_ASK.NONE]: [CHAT_REPLY.ACKNOWLEDGED],
} as const satisfies Record<ChatAskType, readonly ChatReplyKind[]>;

function boundedText(maximumChars: number) {
  return EffectSchema.String.check(EffectSchema.isMaxLength(maximumChars));
}

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/** A key's grammar: a slug opening on a letter or a digit. */
const KEY_GRAMMAR = /^[a-z0-9][a-z0-9._-]*$/u;

/** A key as a poster spells it, an ask's: a short slug, the same each time it means the same ask. */
export const chatKeySchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(ASK_BOUNDS.MAX_KEY_CHARS),
  EffectSchema.isPattern(KEY_GRAMMAR),
);

/** A link's address: a web page, and nothing a desktop would hand to another scheme. */
const WEB_ADDRESS = /^https?:\/\/\S+$/u;

/**
 * The blocks a poster writes as they are kept: words in Markdown, a link
 * with its label, or the lines of a file the agent points at, in its
 * repository as `owner/name`, from its first line to its last, at the
 * commit it read them at, so the reference never moves under a later push.
 * Note that a code block carries no line of the file: the desktop reads
 * them from GitHub at that commit, as its File tab reads a file.
 */
const WORD_BLOCKS = [
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_BLOCK.MARKDOWN),
    text: filledText(ASK_BOUNDS.MAX_MARKDOWN_CHARS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_BLOCK.LINK),
    url: EffectSchema.String.check(
      EffectSchema.isMaxLength(ASK_BOUNDS.MAX_URL_CHARS),
      EffectSchema.isPattern(WEB_ADDRESS),
    ),
    label: filledText(ASK_BOUNDS.MAX_LABEL_CHARS),
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_BLOCK.CODE),
    repo: githubRepositoryFullNameSchema,
    path: filledText(CODE_PATH_MAX_CHARS),
    startLine: codeLineSchema,
    endLine: codeLineSchema,
    sha: commitShaSchema,
  }),
] as const;

/** What an image block says of its picture: the words that stand for it where it cannot be seen. */
const imageWords = { alt: filledText(ASK_BOUNDS.MAX_ALT_CHARS) };

/** One block of a message as the service keeps it and the desktop reads it: a word block as the poster wrote it, or an image by the attachment the service keeps it as. */
export const chatBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_BLOCK.IMAGE),
    attachmentId: wireUuidSchema,
    ...imageWords,
  }),
]);

export type ChatBlock = typeof chatBlockSchema.Type;

/** A code block as a message carries it: the repository, the path, the lines, and the commit. */
export type ChatCodeBlock = Extract<ChatBlock, { type: typeof CHAT_BLOCK.CODE }>;

/** Whether a code block's lines run forward from its first and are few enough to read at a glance. */
export function codeLinesReadable(block: Pick<ChatCodeBlock, "startLine" | "endLine">): boolean {
  return (
    block.endLine >= block.startLine && block.endLine - block.startLine < ASK_BOUNDS.MAX_CODE_LINES
  );
}

/** An image block as a message carries one, naming the attachment the desktop fetches. */
export type ChatImageBlock = Extract<ChatBlock, { type: typeof CHAT_BLOCK.IMAGE }>;

/** A message's body: its blocks in order, few. */
export const chatBlocksSchema = EffectSchema.Array(chatBlockSchema).check(
  EffectSchema.isMaxLength(ASK_BOUNDS.MAX_BLOCKS),
);

/** One block as an agent posts it: the word blocks as they are kept, and an image by the path of its file in the agent's sandbox, which the service reads and keeps. */
export const chatPostBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_BLOCK.IMAGE),
    path: filledText(ASK_BOUNDS.MAX_PATH_CHARS),
    ...imageWords,
  }),
]);

export type ChatPostBlock = typeof chatPostBlockSchema.Type;

/** A message's body as an agent posts it: its blocks in order, few. */
export const chatPostBlocksSchema = EffectSchema.Array(chatPostBlockSchema).check(
  EffectSchema.isMaxLength(ASK_BOUNDS.MAX_BLOCKS),
);

/** One option of a choice: its label, and the trade-off in a sentence where the poster wrote one. */
export const chatOptionSchema = EffectSchema.Struct({
  label: filledText(ASK_BOUNDS.MAX_LABEL_CHARS),
  detail: EffectSchema.optionalKey(boundedText(ASK_BOUNDS.MAX_OPTION_DETAIL_CHARS)),
});

/** One field of a form: its type, its label, which names its value in the answer, whether it must be filled, and a select's options. */
export const chatFieldSchema = EffectSchema.Struct({
  type: EffectSchema.Literals(Object.values(CHAT_FIELD)),
  label: filledText(ASK_BOUNDS.MAX_LABEL_CHARS),
  required: EffectSchema.optionalKey(EffectSchema.Boolean),
  options: EffectSchema.optionalKey(
    EffectSchema.Array(filledText(ASK_BOUNDS.MAX_LABEL_CHARS)).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(ASK_BOUNDS.MAX_OPTIONS),
    ),
  ),
});

export type ChatField = typeof chatFieldSchema.Type;

/**
 * What an ask asks, one of six: a choice among options, several where
 * `multiple`, the label it recommends named; an approval; words, with what
 * the box says while empty; a task; a form of fields; or nothing but an
 * acknowledgement.
 */
export const chatResponseSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_ASK.CHOICE),
    options: EffectSchema.Array(chatOptionSchema).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(ASK_BOUNDS.MAX_OPTIONS),
    ),
    multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
    recommended: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(CHAT_ASK.APPROVAL) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_ASK.TEXT),
    placeholder: EffectSchema.optionalKey(boundedText(ASK_BOUNDS.MAX_LABEL_CHARS)),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(CHAT_ASK.TASK) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_ASK.FORM),
    fields: EffectSchema.Array(chatFieldSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(ASK_BOUNDS.MAX_FIELDS),
    ),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(CHAT_ASK.NONE) }),
]);

export type ChatResponse = typeof chatResponseSchema.Type;

/** A choice as an ask asks it, with the options an answer must name. */
export type ChatChoice = Extract<ChatResponse, { type: typeof CHAT_ASK.CHOICE }>;

/** A form as an ask asks it, with the fields an answer fills. */
export type ChatForm = Extract<ChatResponse, { type: typeof CHAT_ASK.FORM }>;

/** What a form's field holds once filled: words, a number, an option, or yes or no, by the field's type. */
export const chatFieldValueSchema = EffectSchema.Union([
  boundedText(ASK_BOUNDS.MAX_FIELD_VALUE_CHARS),
  EffectSchema.Finite,
  EffectSchema.Boolean,
]);

export type ChatFieldValue = typeof chatFieldValueSchema.Type;

/** One field filled: the field's label, and what it holds. */
export const chatFormValueSchema = EffectSchema.Struct({
  label: filledText(ASK_BOUNDS.MAX_LABEL_CHARS),
  value: chatFieldValueSchema,
});

export type ChatFormValue = typeof chatFormValueSchema.Type;

/** A form's values, one per field filled, each named by its field's label. */
export const chatFormValuesSchema = EffectSchema.Array(chatFormValueSchema).check(
  EffectSchema.isMaxLength(ASK_BOUNDS.MAX_FIELDS),
);

type ChatFormValues = typeof chatFormValuesSchema.Type;

/** An answer to an ask: how it was answered, the options where one picked, the form's values where one filled it, and a note. */
export const chatReplySchema = EffectSchema.Struct({
  reply: EffectSchema.Literals(Object.values(CHAT_REPLY)),
  choices: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String).check(EffectSchema.isMaxLength(ASK_BOUNDS.MAX_OPTIONS)),
  ),
  values: EffectSchema.optionalKey(chatFormValuesSchema),
  note: EffectSchema.optionalKey(boundedText(ASK_BOUNDS.MAX_NOTE_CHARS)),
});

export type ChatReply = typeof chatReplySchema.Type;

/** The types this build draws, by which a read tells a type it does not know. */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(CHAT_BLOCK),
  ...Object.values(CHAT_ASK),
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
).pipe(EffectSchema.brand("UnknownChatType"));

/** A block as a desktop reads one: one this build knows, or the type alone of one it does not. */
export const chatReadBlockSchema = EffectSchema.Union([
  ...chatBlockSchema.members,
  EffectSchema.Struct({ type: unknownTypeSchema }),
]);

export type ChatReadBlock = typeof chatReadBlockSchema.Type;

/** A response as a desktop reads one: one this build knows, or the type alone of one it does not. */
export const chatReadResponseSchema = EffectSchema.Union([
  ...chatResponseSchema.members,
  EffectSchema.Struct({ type: unknownTypeSchema }),
]);

export type ChatReadResponse = typeof chatReadResponseSchema.Type;

/** Whether a response read off the wire is one this build knows, which its type decides. */
export function knownResponse(response: ChatReadResponse): response is ChatResponse {
  return Object.values<string>(CHAT_ASK).includes(response.type);
}

/** Whether a block read off the wire is one this build knows, which its type decides. */
export function knownBlock(block: ChatReadBlock): block is ChatBlock {
  return Object.values<string>(CHAT_BLOCK).includes(block.type);
}

/** A field's value as words: a number as it prints, yes or no for a boolean. */
export function fieldValueWords(value: ChatFieldValue): string {
  if (isWireBoolean(value)) return value ? "yes" : "no";
  return String(value);
}

/** A form's values as lines, one per field filled, in the form's own order. */
export function formValueLines(values: ChatFormValues): string {
  return values.map(({ label, value }) => `- ${label}: ${fieldValueWords(value)}`).join("\n");
}

/** An answer's own words, as its poster reads them. */
export function replyWords(reply: ChatReply): string {
  switch (reply.reply) {
    case CHAT_REPLY.CHOSE:
      return `Chose ${(reply.choices ?? []).map((choice) => `"${choice}"`).join(", ")}.`;
    case CHAT_REPLY.APPROVED:
      return "Approved.";
    case CHAT_REPLY.DECLINED:
      return "Declined.";
    case CHAT_REPLY.ANSWERED:
      return "Answered in their own words.";
    case CHAT_REPLY.DONE:
      return "Done.";
    case CHAT_REPLY.NOT_DONE:
      return "Not done.";
    case CHAT_REPLY.SUBMITTED:
      return "Filled in the form.";
    case CHAT_REPLY.ACKNOWLEDGED:
      return "Acknowledged.";
  }
}

/** Whether a field's value is of the field's type, and names one of a select's options. */
function fieldTakes(field: ChatField, value: ChatFieldValue): boolean {
  switch (field.type) {
    case CHAT_FIELD.TEXT:
      return isWireString(value);
    case CHAT_FIELD.NUMBER:
      return isWireNumber(value) && Number.isFinite(value);
    case CHAT_FIELD.SELECT:
      return isWireString(value) && (field.options ?? []).includes(value);
    case CHAT_FIELD.BOOLEAN:
      return isWireBoolean(value);
  }
}

/** Whether a filled value counts as filled: words with something in them, or any number or boolean. */
function filled(value: ChatFieldValue): boolean {
  return !isWireString(value) || value.trim() !== "";
}

/** Why a form's values do not fill the form, or nothing where they do: each names a field once and is of its type, and every required field is filled. */
function formRefusal(form: ChatForm, values: ChatFormValues | undefined): string | undefined {
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
  choice: ChatChoice,
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
 * Why an answer does not fit the response it answers, or nothing where it
 * does: the response takes the reply, a pick names offered options, a
 * form's values fill it, and words stand where the answer is in one's own
 * words. A response this build does not know takes nothing.
 */
export function replyRefusal(response: ChatReadResponse, reply: ChatReply): string | undefined {
  if (!knownResponse(response)) return "The item asks something this Luke does not know.";
  const takes: readonly ChatReplyKind[] = CHAT_REPLIES_OF[response.type];
  if (!takes.includes(reply.reply)) return "The item does not take that answer.";
  if (reply.reply === CHAT_REPLY.CHOSE && response.type === CHAT_ASK.CHOICE) {
    return choiceRefusal(response, reply.choices);
  }
  if (reply.reply === CHAT_REPLY.SUBMITTED && response.type === CHAT_ASK.FORM) {
    return formRefusal(response, reply.values);
  }
  if (reply.reply === CHAT_REPLY.ANSWERED && (reply.note ?? "").trim() === "") {
    return "An answer in the developer's own words needs words.";
  }
  return undefined;
}
