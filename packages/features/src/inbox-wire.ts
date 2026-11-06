import {
  isWireBoolean,
  isWireNumber,
  isWireString,
  THREAD_LINE_EVENT,
  type ThreadLineMetadata,
} from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_BOUNDS,
  type AgentAttachment,
  agentMessageRequestSchema,
  hasWordsOrFiles,
} from "./agent-wire.js";
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

export const INBOX_WIRE_VERSION = 5;

export const INBOX_BOUNDS = {
  MAX_KEY_CHARS: 80,
  MAX_TITLE_CHARS: 160,
  MAX_BLOCKS: 8,
  MAX_MARKDOWN_CHARS: 8_000,
  MAX_URL_CHARS: 2_000,
  MAX_CODE_LINES: 60,
  MAX_PATH_CHARS: 1_024,
  MAX_ALT_CHARS: 300,
  MAX_IMAGE_BYTES: AGENT_BOUNDS.MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES: 4_000_000,
  MAX_LABEL_CHARS: 160,
  MAX_OPTIONS: 6,
  MAX_OPTION_DETAIL_CHARS: 600,
  MAX_FIELDS: 8,
  MAX_FIELD_VALUE_CHARS: 1_000,
  MAX_NOTE_CHARS: 4_000,
  MAX_REASON_CHARS: 600,
  MAX_OPEN_PER_AGENT: 20,
  MAX_ITEMS_READ: 200,
  MAX_SETTLED_TOLD: 20,
  MAX_CURSOR_CHARS: 64,
  MAX_CLIENT_KEY_CHARS: 128,
  MAX_MESSAGE_CHARS: 8_000,
  MAX_MESSAGES_READ: 50,
  MAX_MESSAGE_PICTURES: 8,
  MAX_STEPS: 8,
  MAX_STEP_CHARS: 600,
  MAX_ADDRESSEE_CHARS: 512,
} as const;

export const INBOX_TOOL = {
  POST: "post_thread",
  WITHDRAW: "withdraw_ask",
  READ: "read_threads",
} as const;

export const INBOX_BLOCK = {
  MARKDOWN: "markdown",
  LINK: "link",
  CODE: "code",
  IMAGE: "image",
} as const;

export const INBOX_IMAGE_TYPE = {
  PNG: AGENT_ATTACHMENT_TYPE.PNG,
  JPEG: AGENT_ATTACHMENT_TYPE.JPEG,
  WEBP: AGENT_ATTACHMENT_TYPE.WEBP,
} as const;

export type InboxImageType = (typeof INBOX_IMAGE_TYPE)[keyof typeof INBOX_IMAGE_TYPE];

export const INBOX_FILE_TYPE = {
  ...AGENT_ATTACHMENT_TYPE,
  WEBM: WEBM_TYPE,
} as const;

export type InboxFileType = (typeof INBOX_FILE_TYPE)[keyof typeof INBOX_FILE_TYPE];

export const INBOX_RESPONSE = {
  CHOICE: "choice",
  APPROVAL: "approval",
  TEXT: "text",
  TODO: "task",
  FORM: "form",
  NONE: "none",
} as const;

type InboxResponseType = (typeof INBOX_RESPONSE)[keyof typeof INBOX_RESPONSE];

export const INBOX_FIELD = {
  TEXT: "text",
  NUMBER: "number",
  SELECT: "select",
  BOOLEAN: "boolean",
} as const;

export const INBOX_STATUS = {
  OPEN: "open",
  ANSWERED: "answered",
  CLOSED: "closed",
} as const;

export type InboxStatus = (typeof INBOX_STATUS)[keyof typeof INBOX_STATUS];

export const INBOX_REPLY = {
  CHOSE: "chose",
  APPROVED: "approved",
  DECLINED: "declined",
  ANSWERED: "answered",
  DONE: "done",
  NOT_DONE: "not-done",
  SUBMITTED: "submitted",
  ACKNOWLEDGED: "acknowledged",
} as const;

export type InboxReplyKind = (typeof INBOX_REPLY)[keyof typeof INBOX_REPLY];

const INBOX_REPLIES_OF = {
  [INBOX_RESPONSE.CHOICE]: [INBOX_REPLY.CHOSE, INBOX_REPLY.ANSWERED],
  [INBOX_RESPONSE.APPROVAL]: [INBOX_REPLY.APPROVED, INBOX_REPLY.DECLINED],
  [INBOX_RESPONSE.TEXT]: [INBOX_REPLY.ANSWERED],
  [INBOX_RESPONSE.TODO]: [INBOX_REPLY.DONE, INBOX_REPLY.NOT_DONE],
  [INBOX_RESPONSE.FORM]: [INBOX_REPLY.SUBMITTED],
  [INBOX_RESPONSE.NONE]: [INBOX_REPLY.ACKNOWLEDGED],
} as const satisfies Record<InboxResponseType, readonly InboxReplyKind[]>;

export const INBOX_ASK = {
  DECIDE: "decide",
  DO: "do",
  ANSWER: "answer",
} as const;

export const INBOX_ASK_STATUS = {
  OPEN: "open",
  ANSWERED: "answered",
  REPLACED: "replaced",
  WITHDRAWN: "withdrawn",
} as const;

export const INBOX_APPROVAL_OPTION = {
  APPROVE: "Approve",
  DECLINE: "Decline",
} as const;

const inboxKeySchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_KEY_CHARS),
  EffectSchema.isPattern(/^[a-z0-9][a-z0-9._-]*$/u),
);

const WEB_ADDRESS = /^https?:\/\/\S+$/u;

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

const imageWords = { alt: filledText(INBOX_BOUNDS.MAX_ALT_CHARS) };

const inboxBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    attachmentId: wireUuidSchema,
    ...imageWords,
  }),
]);

type InboxBlock = typeof inboxBlockSchema.Type;

export type InboxCodeBlock = Extract<InboxBlock, { type: typeof INBOX_BLOCK.CODE }>;

export function codeLinesReadable(block: Pick<InboxCodeBlock, "startLine" | "endLine">): boolean {
  return (
    block.endLine >= block.startLine &&
    block.endLine - block.startLine < INBOX_BOUNDS.MAX_CODE_LINES
  );
}

const inboxPostBlockSchema = EffectSchema.Union([
  ...WORD_BLOCKS,
  EffectSchema.Struct({
    type: EffectSchema.Literal(INBOX_BLOCK.IMAGE),
    path: filledText(INBOX_BOUNDS.MAX_PATH_CHARS),
    ...imageWords,
  }),
]);

export type InboxPostBlock = typeof inboxPostBlockSchema.Type;

const inboxPostBlocksSchema = EffectSchema.Array(inboxPostBlockSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_BLOCKS),
);

const inboxOptionSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  detail: EffectSchema.optionalKey(boundedText(INBOX_BOUNDS.MAX_OPTION_DETAIL_CHARS)),
});

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
  recommended: EffectSchema.optionalKey(EffectSchema.String),
});

export type InboxField = typeof inboxFieldSchema.Type;

const recommendedInputSchema = EffectSchema.Union([
  EffectSchema.String,
  EffectSchema.Array(EffectSchema.String).check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
  ),
]);

const RECOMMENDED_FIELDS = {
  recommended: EffectSchema.optionalKey(EffectSchema.String),
  recommendations: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
    ),
  ),
};

interface Recommending {
  readonly recommended?: string | readonly string[];
  readonly recommendations?: readonly string[];
}

export function recommendedLabels(choice: Recommending): readonly string[] {
  if (choice.recommendations !== undefined) return choice.recommendations;
  if (choice.recommended === undefined) return [];
  return typeof choice.recommended === "string" ? [choice.recommended] : choice.recommended;
}

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

export type InboxChoice = Extract<InboxResponse, { type: typeof INBOX_RESPONSE.CHOICE }>;

export type InboxForm = Extract<InboxResponse, { type: typeof INBOX_RESPONSE.FORM }>;

export const inboxPostInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  title: filledText(INBOX_BOUNDS.MAX_TITLE_CHARS),
  blocks: EffectSchema.optionalKey(inboxPostBlocksSchema),
  response: inboxResponseSchema,
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type InboxPost = typeof inboxPostInputSchema.Type;

export const inboxReadInputSchema = EffectSchema.Struct({});

const inboxFieldValueSchema = EffectSchema.Union([
  boundedText(INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS),
  EffectSchema.Finite,
  EffectSchema.Boolean,
]);

export type InboxFieldValue = typeof inboxFieldValueSchema.Type;

export const inboxFormValueSchema = EffectSchema.Struct({
  label: filledText(INBOX_BOUNDS.MAX_LABEL_CHARS),
  value: inboxFieldValueSchema,
});

export type InboxFormValue = typeof inboxFormValueSchema.Type;

const inboxFormValuesSchema = EffectSchema.Array(inboxFormValueSchema).check(
  EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
);

type InboxFormValues = typeof inboxFormValuesSchema.Type;

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

function unknownTypeOf(known: readonly string[]) {
  const knownTypes: ReadonlySet<string> = new Set(known);
  return EffectSchema.String.check(EffectSchema.makeFilter((type) => !knownTypes.has(type))).pipe(
    EffectSchema.brand("UnknownInboxType"),
  );
}

const stepIndexSchema = EffectSchema.Int.check(
  EffectSchema.isGreaterThanOrEqualTo(0),
  EffectSchema.isLessThan(INBOX_BOUNDS.MAX_STEPS),
);

const DECIDE_FIELDS = {
  type: EffectSchema.Literal(INBOX_ASK.DECIDE),
  options: EffectSchema.Array(inboxOptionSchema).check(
    EffectSchema.isMinLength(2),
    EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_OPTIONS),
  ),
  multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
  ...RECOMMENDED_FIELDS,
};

const DECIDE_INPUT_FIELDS = {
  type: DECIDE_FIELDS.type,
  options: DECIDE_FIELDS.options,
  multiple: DECIDE_FIELDS.multiple,
  recommended: EffectSchema.optionalKey(recommendedInputSchema),
};

const DO_FIELDS = {
  type: EffectSchema.Literal(INBOX_ASK.DO),
  steps: EffectSchema.Array(filledText(INBOX_BOUNDS.MAX_STEP_CHARS)).check(
    EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_STEPS),
  ),
};

const ANSWER_FIELDS = {
  type: EffectSchema.Literal(INBOX_ASK.ANSWER),
  fields: EffectSchema.optionalKey(
    EffectSchema.Array(inboxFieldSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_FIELDS),
    ),
  ),
};

const inboxAskSchema = EffectSchema.Union([
  EffectSchema.Struct(DECIDE_FIELDS),
  EffectSchema.Struct(DO_FIELDS),
  EffectSchema.Struct(ANSWER_FIELDS),
]);

export type InboxAsk = typeof inboxAskSchema.Type;

const inboxAskInputSchema = EffectSchema.Union([
  EffectSchema.Struct(DECIDE_INPUT_FIELDS),
  EffectSchema.Struct(DO_FIELDS),
  EffectSchema.Struct(ANSWER_FIELDS),
]);

export type InboxAskInput = typeof inboxAskInputSchema.Type;

export function keptInboxAsk(ask: InboxAskInput): InboxAsk {
  if (ask.type !== INBOX_ASK.DECIDE) return ask;
  const { recommended: _recommended, ...rest } = ask;
  return { ...rest, ...keptRecommendation(ask) };
}

export const inboxThreadPostInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  title: EffectSchema.optionalKey(filledText(INBOX_BOUNDS.MAX_TITLE_CHARS)),
  body: filledText(INBOX_BOUNDS.MAX_MESSAGE_CHARS),
  to: EffectSchema.optionalKey(filledText(INBOX_BOUNDS.MAX_ADDRESSEE_CHARS)),
  ask: EffectSchema.optionalKey(inboxAskInputSchema),
});

export type InboxThreadPostInput = typeof inboxThreadPostInputSchema.Type;

export const inboxWithdrawInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  reason: filledText(INBOX_BOUNDS.MAX_REASON_CHARS),
});

const ASK_STANDING_FIELDS = {
  status: EffectSchema.Literals(Object.values(INBOX_ASK_STATUS)),
  withdrawnReason: EffectSchema.optionalKey(EffectSchema.String),
  withdrawnAt: EffectSchema.optionalKey(countedNumber),
};

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

export const inboxAnswerFileSchema = EffectSchema.Struct({
  attachmentId: wireUuidSchema,
  name: EffectSchema.String,
  mediaType: EffectSchema.String,
});

type InboxAnswerFile = typeof inboxAnswerFileSchema.Type;

export const INBOX_MESSAGE_AUTHOR = {
  MEMBER: "member",
  AGENT: "agent",
} as const;

export type InboxMessageAuthor = (typeof INBOX_MESSAGE_AUTHOR)[keyof typeof INBOX_MESSAGE_AUTHOR];

export const inboxMessageSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  author: EffectSchema.Literals(Object.values(INBOX_MESSAGE_AUTHOR)),
  member: EffectSchema.optionalKey(memberRefSchema),
  text: EffectSchema.String,
  files: EffectSchema.optionalKey(EffectSchema.Array(inboxAnswerFileSchema)),
  ask: EffectSchema.optionalKey(inboxReadAskSchema),
  answers: EffectSchema.optionalKey(inboxAnswersSchema),
  addressedTo: EffectSchema.optionalKey(memberRefSchema),
  clientKey: EffectSchema.optionalKey(EffectSchema.String),
  createdAt: countedNumber,
});

export type InboxMessage = typeof inboxMessageSchema.Type;

export const inboxItemSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  key: EffectSchema.String,
  revision: countedNumber,
  version: countedNumber,
  title: EffectSchema.String,
  needsReply: EffectSchema.Boolean,
  status: EffectSchema.Literals(Object.values(INBOX_STATUS)),
  startedBy: EffectSchema.optionalKey(memberRefSchema),
  waitsOn: EffectSchema.optionalKey(memberRefSchema),
  addressed: EffectSchema.optionalKey(EffectSchema.Boolean),
  answeredBy: EffectSchema.optionalKey(memberRefSchema),
  closedReason: EffectSchema.optionalKey(EffectSchema.String),
  closedBy: EffectSchema.optionalKey(memberRefSchema),
  thread: EffectSchema.optionalKey(EffectSchema.Array(inboxMessageSchema)),
  postedAt: countedNumber,
  settledAt: EffectSchema.optionalKey(countedNumber),
  updatedAt: countedNumber,
  unread: EffectSchema.optionalKey(EffectSchema.Boolean),
  markedUnread: EffectSchema.optionalKey(EffectSchema.Boolean),
  remindAt: EffectSchema.optionalKey(countedNumber),
  snoozedUntil: EffectSchema.optionalKey(countedNumber),
});

export type InboxItem = typeof inboxItemSchema.Type;

export type InboxPerson = NonNullable<InboxItem["startedBy"]>;

export interface InboxAsking {
  readonly message: InboxMessage;
  readonly ask: InboxReadAsk;
}

export function openAskOf(thread: readonly InboxMessage[]): InboxAsking | undefined {
  const message = thread.findLast((each) => each.ask?.status === INBOX_ASK_STATUS.OPEN);
  return message?.ask === undefined ? undefined : { message, ask: message.ask };
}

export function inboxWaitsOn(item: InboxItem): InboxPerson | undefined {
  return item.waitsOn ?? item.startedBy;
}

export function inboxAddressedTo(item: InboxItem): InboxPerson | undefined {
  return item.addressed === true ? item.waitsOn : undefined;
}

function inboxAsksOpen(item: InboxItem): boolean {
  return item.status === INBOX_STATUS.OPEN && openAskOf(item.thread ?? []) !== undefined;
}

export function threadNeedsReader(item: InboxItem, readerId: string | undefined): boolean {
  return readerId !== undefined && inboxAsksOpen(item) && inboxWaitsOn(item)?.userId === readerId;
}

export const INBOX_CURSOR_START = "0";

export const inboxCursorSchema = filledText(INBOX_BOUNDS.MAX_CURSOR_CHARS);

export const inboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(inboxItemSchema),
  cursor: EffectSchema.String,
});

export type InboxAnswer = typeof inboxAnswerSchema.Type;

export const inboxAcknowledgeRequestSchema = EffectSchema.Struct({
  revision: countedNumber,
  reply: EffectSchema.Literal(INBOX_REPLY.ACKNOWLEDGED),
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

export type InboxAcknowledgeRequest = typeof inboxAcknowledgeRequestSchema.Type;

const writtenIn = { txid: EffectSchema.optionalKey(EffectSchema.String) };

export const inboxAnsweredSchema = EffectSchema.Struct({
  item: inboxItemSchema,
  taken: EffectSchema.Boolean,
  ...writtenIn,
});

export const INBOX_ANSWER_LEAD = "Thread answer";

export const inboxCloseRequestSchema = EffectSchema.Struct({
  revision: countedNumber,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
  text: EffectSchema.optionalKey(
    EffectSchema.Trim.check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
  ),
  attachments: agentMessageRequestSchema.fields.attachments,
});

export type InboxCloseRequest = typeof inboxCloseRequestSchema.Type;

export const INBOX_CLOSE_LEAD = "Thread closed";

export function inboxClosedMessage(item: Pick<InboxItem, "key" | "title">, note = ""): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_CLOSE_LEAD} on "${title}" (key ${item.key}): Closed without an answer.`;
  return note.trim() === "" ? header : `${header}\n\n${note.trim()}`;
}

export const inboxMessageRequestSchema = EffectSchema.Struct({
  text: EffectSchema.Trim.check(EffectSchema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
  attachments: agentMessageRequestSchema.fields.attachments,
  clientKey: filledText(INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS),
  answers: EffectSchema.optionalKey(inboxAnswersSchema),
  revision: EffectSchema.optionalKey(countedNumber),
}).check(
  EffectSchema.makeFilter(
    ({ text, attachments, answers }) => answers !== undefined || hasWordsOrFiles(text, attachments),
  ),
);

export type InboxMessageRequest = typeof inboxMessageRequestSchema.Type;

export const inboxMessagedSchema = EffectSchema.Struct({ item: inboxItemSchema, ...writtenIn });

export const inboxStartRequestSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
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

const STARTED_TITLE_CHARS = 60;

const STARTED_TITLE_FALLBACK = "Untitled item";

const CODE_FENCE = /^\s*(?:```|~~~)/u;

const THEMATIC_BREAK = /^\s*([-*_])(?:[ \t]*\1){2,}\s*$/u;

function plainLine(line: string): string {
  if (CODE_FENCE.test(line) || THEMATIC_BREAK.test(line)) return "";
  return linkLabels(line.replace(/!\[/gu, "["))
    .replace(/^\s*(?:#{1,6}|>+|[-*+]|\d+[.)])\s+/u, "")
    .replace(/[*`~]/gu, "")
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function shortTitle(words: string): string {
  if (words.length <= STARTED_TITLE_CHARS) return words;
  const cut = words.slice(0, STARTED_TITLE_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${(space > STARTED_TITLE_CHARS / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

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

export const inboxItemHomeSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  planId: EffectSchema.NullOr(wireUuidSchema),
  workspaceId: EffectSchema.NonEmptyString,
});

export type InboxItemHome = typeof inboxItemHomeSchema.Type;

export const inboxReadStateSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  unread: EffectSchema.Boolean,
  ...writtenIn,
});

const LATEST_INSTANT = 8_640_000_000_000_000;

export const inboxRemindRequestSchema = EffectSchema.Struct({
  until: EffectSchema.NullOr(countedNumber.check(EffectSchema.isLessThanOrEqualTo(LATEST_INSTANT))),
});

export type InboxRemindRequest = typeof inboxRemindRequestSchema.Type;

export const inboxReadAllRequestSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.optionalKey(workspaceIdSchema),
});

export type InboxReadAllRequest = typeof inboxReadAllRequestSchema.Type;

export const inboxReadAllSchema = EffectSchema.Struct({ marked: countedNumber, ...writtenIn });

export const INBOX_MESSAGE_LEAD = "Thread message";

export function inboxThreadMessage(item: Pick<InboxItem, "key" | "title">, text: string): string {
  const title = item.title.replace(/\s+/gu, " ").trim();
  const header = `${INBOX_MESSAGE_LEAD} on "${title}" (key ${item.key}):`;
  return text.trim() === "" ? header : `${header}\n\n${text.trim()}`;
}

export const THREAD_LINE_LEAD = {
  [THREAD_LINE_EVENT.MESSAGE]: INBOX_MESSAGE_LEAD,
  [THREAD_LINE_EVENT.ANSWER]: INBOX_ANSWER_LEAD,
  [THREAD_LINE_EVENT.CLOSE]: INBOX_CLOSE_LEAD,
} as const;

const KEY_OPENS = '" (key ';

const KEY_CLOSES = "):";

const PARAGRAPH = "\n\n";

export function threadLineWords(text: string, event: ThreadLineMetadata["event"]): string {
  const cut = text.indexOf(PARAGRAPH);
  const head = cut === -1 ? text : text.slice(0, cut);
  const rest = cut === -1 ? "" : text.slice(cut + PARAGRAPH.length);
  if (event !== THREAD_LINE_EVENT.ANSWER) return rest.trim();
  const key = head.lastIndexOf(KEY_OPENS);
  const close = key === -1 ? -1 : head.indexOf(KEY_CLOSES, key + KEY_OPENS.length);
  const did = close === -1 ? head : head.slice(close + KEY_CLOSES.length).trim();
  return [did, rest.trim()].filter((part) => part !== "").join(PARAGRAPH);
}

export function threadLineTitle(
  text: string,
  event: ThreadLineMetadata["event"],
): string | undefined {
  const opens = `${THREAD_LINE_LEAD[event]} on "`;
  const cut = text.indexOf(PARAGRAPH);
  const head = cut === -1 ? text : text.slice(0, cut);
  const key = head.lastIndexOf(KEY_OPENS);
  if (!head.startsWith(opens) || key < opens.length) return undefined;
  const title = head.slice(opens.length, key);
  return title === "" ? undefined : title;
}

export function fieldValueWords(value: InboxFieldValue): string {
  if (isWireBoolean(value)) return value ? "yes" : "no";
  return String(value);
}

function valueLines(values: InboxFormValues): string {
  return values.map(({ label, value }) => `- ${label}: ${fieldValueWords(value)}`).join("\n");
}

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

type AnswerFiles = readonly (AgentAttachment | InboxAnswerFile)[];

export function inboxAnswerHeard(
  item: Pick<InboxItem, "needsReply">,
  reply: InboxReply,
  files: AnswerFiles = [],
): boolean {
  return item.needsReply || (reply.note ?? "").trim() !== "" || files.length > 0;
}

export interface InboxTodoTicks {
  readonly steps: readonly string[];
  readonly ticked: readonly number[];
}

function answerHeadWords(reply: InboxReply, todo: InboxTodoTicks | undefined): string {
  if (reply.reply !== INBOX_REPLY.ANSWERED || todo === undefined || todo.ticked.length === 0) {
    return replyWords(reply);
  }
  const total = todo.steps.length;
  return `Ticked ${todo.ticked.length} of ${total} ${total === 1 ? "step" : "steps"}.`;
}

function checklistLines(todo: InboxTodoTicks | undefined): string {
  if (todo === undefined) return "";
  const ticked = new Set(todo.ticked);
  return todo.steps
    .map((step, at) => `- [${ticked.has(at) ? "x" : " "}] ${step.replace(/\s+/gu, " ").trim()}`)
    .join("\n");
}

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

function filled(value: InboxFieldValue): boolean {
  return !isWireString(value) || value.trim() !== "";
}

const REQUIRED_EMPTY = "A required field of the form is empty.";

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

function saysAny(words: string, files: AnswerFiles): boolean {
  return words.trim() !== "" || files.length > 0;
}

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

function ownWordsRefusal(words: string, files: AnswerFiles): string | undefined {
  if (!saysAny(words, files)) {
    return "An answer in the developer's own words needs words or a file.";
  }
  return undefined;
}

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

const NOT_TAKEN = "The ask does not take that answer.";

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

export function inboxAnswersReply(answers: InboxAnswers, words: string): InboxReply {
  const note = words.trim();
  return {
    reply: answers.reply,
    ...(answers.choices === undefined ? undefined : { choices: answers.choices }),
    ...(answers.values === undefined ? undefined : { values: answers.values }),
    ...(note === "" ? undefined : { note }),
  };
}

export function knownAsk(ask: InboxReadAsk): InboxAsk | undefined {
  const { status: _status, withdrawnReason: _reason, withdrawnAt: _at, ...kept } = ask;
  return EffectSchema.is(inboxAskSchema)(kept) ? kept : undefined;
}

export interface InboxAskStanding {
  readonly status: InboxStatus;
  readonly openAskMessageId: string | null;
  readonly closedReason: string | null;
}

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
