import { Schema as EffectSchema } from "effect";
import {
  fieldValueWords,
  INBOX_BOUNDS,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxFormValue,
  type InboxReadResponse,
  type InboxReply,
  inboxKeySchema,
  inboxPostBlocksSchema,
  inboxReadBlockSchema,
  inboxReadResponseSchema,
  inboxReplyRefusal,
  inboxReplySchema,
  inboxResponseSchema,
  inboxWordBlockSchema,
} from "./inbox-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export {
  /** @public */
  codeLinesReadable,
  /** @public */
  fieldValueWords,
  /** @public */
  INBOX_BLOCK as CHAT_BLOCK,
  /** @public */
  INBOX_FIELD as CHAT_FIELD,
  /** @public */
  INBOX_IMAGE_TYPE as CHAT_IMAGE_TYPE,
  /** @public */
  INBOX_REPLY as CHAT_REPLY,
  /** @public */
  INBOX_STATUS as ASK_STATUS,
  /** @public */
  type InboxBlock as ChatBlock,
  /** @public */
  type InboxChoice as ChatChoice,
  /** @public */
  type InboxCodeBlock as ChatCodeBlock,
  /** @public */
  type InboxField as ChatField,
  /** @public */
  type InboxFieldValue as ChatFieldValue,
  /** @public */
  type InboxForm as ChatForm,
  /** @public */
  type InboxFormValue as ChatFormValue,
  /** @public */
  type InboxImageBlock as ChatImageBlock,
  /** @public */
  type InboxImageType as ChatImageType,
  /** @public */
  type InboxPostBlock as ChatPostBlock,
  /** @public */
  type InboxReadBlock as ChatReadBlock,
  /** @public */
  type InboxReadResponse as ChatReadResponse,
  /** @public */
  type InboxReply as ChatReply,
  /** @public */
  type InboxReplyKind as ChatReplyKind,
  /** @public */
  type InboxResponse as ChatResponse,
  /** @public */
  type InboxStatus as AskStatus,
  /** @public */
  inboxBlockSchema as chatBlockSchema,
  /** @public */
  inboxBlocksSchema as chatBlocksSchema,
  /** @public */
  inboxFieldSchema as chatFieldSchema,
  /** @public */
  inboxFieldValueSchema as chatFieldValueSchema,
  /** @public */
  inboxFormValueSchema as chatFormValueSchema,
  /** @public */
  inboxFormValuesSchema as chatFormValuesSchema,
  /** @public */
  inboxImageTypeSchema as chatImageTypeSchema,
  /** @public */
  inboxKeySchema as chatKeySchema,
  /** @public */
  inboxOptionSchema as chatOptionSchema,
  /** @public */
  inboxPostBlockSchema as chatPostBlockSchema,
  /** @public */
  inboxPostBlocksSchema as chatPostBlocksSchema,
  /** @public */
  inboxReadBlockSchema as chatReadBlockSchema,
  /** @public */
  inboxReadResponseSchema as chatReadResponseSchema,
  /** @public */
  inboxReplySchema as chatReplySchema,
  /** @public */
  inboxResponseSchema as chatResponseSchema,
  /** @public */
  knownBlock,
  /** @public */
  knownResponse,
} from "./inbox-wire.js";

/**
 * chat-wire.ts -- a workspace's chat: the members, channels, messages, and asks its coding agents, planners, and people talk through.
 *
 * A workspace has one chat, reached only through tools on the agent's side
 * and through the window on a person's. Every member has a handle minted
 * once and kept for life: a person's is a slug of their name, a coding
 * agent's `agent-N`, and a plan's planner is always `luke`, told apart by
 * the plan a channel or an author belongs to. A channel is the workspace's
 * `#general`, a plan's own channel where its agents post by default, a
 * topic channel a member opened, or a DM between two members; a thread is
 * a reply to a root message. Messages are records of their own, addressed
 * by a sequence the whole workspace shares, so one cursor reads every
 * channel a member sees.
 *
 * A message's body is blocks, Markdown where the poster wrote words, and
 * may carry an ask under a key of its poster's: the same response shapes
 * the Inbox asks with, re-posted under the key to update it in place at a
 * bumped revision, answered by any member at the revision it names as a
 * reply in its thread, and resolved by its poster. The block and ask shapes
 * are the Inbox's own (`inbox-wire.ts`), named here as the chat's.
 *
 * The tools an agent talks through are named here, as the Inbox's are, and
 * their inputs declared here so the model is shown, eve holds, and the
 * window draws one shape. A request refuses a key it does not name; an
 * answer ignores one a newer service added, and reads a block or a response
 * of a type this build does not know as its type alone. A name marked
 * `@public` is vocabulary the chat's store, tools, and window read as they
 * land, which keeps knip from reading it as dead meanwhile.
 */

function filledText(maximumChars: number) {
  return EffectSchema.String.check(
    EffectSchema.isNonEmpty(),
    EffectSchema.isMaxLength(maximumChars),
  );
}

/**
 * What an ask asks for, by the response type its wire carries: the Inbox's
 * own values, a task named as the chat's vocabulary names it.
 * @public
 */
export const CHAT_ASK = {
  CHOICE: INBOX_RESPONSE.CHOICE,
  APPROVAL: INBOX_RESPONSE.APPROVAL,
  TEXT: INBOX_RESPONSE.TEXT,
  TASK: INBOX_RESPONSE.TODO,
  FORM: INBOX_RESPONSE.FORM,
  NONE: INBOX_RESPONSE.NONE,
} as const satisfies Record<string, (typeof INBOX_RESPONSE)[keyof typeof INBOX_RESPONSE]>;

/** The bounds of the chat: those of a message's body and its ask, which are the Inbox's, and the chat's own. */
export const CHAT_BOUNDS = {
  MAX_KEY_CHARS: INBOX_BOUNDS.MAX_KEY_CHARS,
  MAX_TITLE_CHARS: INBOX_BOUNDS.MAX_TITLE_CHARS,
  MAX_BLOCKS: INBOX_BOUNDS.MAX_BLOCKS,
  MAX_MARKDOWN_CHARS: INBOX_BOUNDS.MAX_MARKDOWN_CHARS,
  MAX_URL_CHARS: INBOX_BOUNDS.MAX_URL_CHARS,
  MAX_CODE_LINES: INBOX_BOUNDS.MAX_CODE_LINES,
  MAX_PATH_CHARS: INBOX_BOUNDS.MAX_PATH_CHARS,
  MAX_ALT_CHARS: INBOX_BOUNDS.MAX_ALT_CHARS,
  MAX_IMAGE_BYTES: INBOX_BOUNDS.MAX_IMAGE_BYTES,
  MAX_LABEL_CHARS: INBOX_BOUNDS.MAX_LABEL_CHARS,
  MAX_OPTIONS: INBOX_BOUNDS.MAX_OPTIONS,
  MAX_OPTION_DETAIL_CHARS: INBOX_BOUNDS.MAX_OPTION_DETAIL_CHARS,
  MAX_FIELDS: INBOX_BOUNDS.MAX_FIELDS,
  MAX_FIELD_VALUE_CHARS: INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS,
  MAX_NOTE_CHARS: INBOX_BOUNDS.MAX_NOTE_CHARS,
  MAX_REASON_CHARS: INBOX_BOUNDS.MAX_REASON_CHARS,
  MAX_CURSOR_CHARS: INBOX_BOUNDS.MAX_CURSOR_CHARS,
  MAX_CLIENT_KEY_CHARS: INBOX_BOUNDS.MAX_CLIENT_KEY_CHARS,
  /** The most characters one post's words may spell: a message, never a report. */
  MAX_TEXT_CHARS: 4_000,
  /** The most messages one read answers with. */
  MAX_READ: 50,
  /** The most members one post tells by mention: a post to a crowd is a plain post. */
  MAX_STEERS_PER_POST: 3,
  /** The most topic channels a workspace keeps open beside its general and plan channels. */
  MAX_TOPIC_CHANNELS: 12,
  /** The most posts one agent's turn may make. */
  MAX_POSTS_PER_TURN: 20,
  /** The most characters a handle may spell. */
  MAX_HANDLE_CHARS: 40,
} as const;

/**
 * The tools a member talks in chat with, by the names their tool parts carry in a transcript.
 * @public
 */
export const CHAT_TOOL = {
  /** Posts a message, to a channel, a member, or a thread, an ask among them. */
  POST: "post_chat",
  /** Reads the roster, the channels, and the messages not yet read or before a place. */
  READ: "read_chat",
  /** Takes an ask of the poster's back, with why. */
  RESOLVE: "resolve_ask",
} as const;

/**
 * The kinds of member a workspace's chat holds.
 * @public
 */
export const MEMBER_KIND = {
  /** A person in the workspace. */
  HUMAN: "human",
  /** A coding agent started on one of the workspace's plans. */
  AGENT: "agent",
  /** A plan's Luke, one per plan, always `@luke`. */
  PLANNER: "planner",
} as const;

/** @public */
export type MemberKind = (typeof MEMBER_KIND)[keyof typeof MEMBER_KIND];

/**
 * The kinds of channel a workspace's chat holds.
 * @public
 */
export const CHANNEL_KIND = {
  /** The workspace's one `#general`. */
  GENERAL: "general",
  /** A plan's own channel, named from the plan on first use, where its agents post by default. */
  PLAN: "plan",
  /** A channel a member opened on a topic. */
  TOPIC: "topic",
  /** Two members alone. */
  DM: "dm",
} as const;

/** @public */
export type ChannelKind = (typeof CHANNEL_KIND)[keyof typeof CHANNEL_KIND];

/**
 * The name of a workspace's general channel.
 * @public
 */
export const GENERAL_CHANNEL = "general";

/**
 * The handle every plan's planner answers to, told apart by the plan.
 * @public
 */
export const PLANNER_HANDLE = "luke";

/**
 * How a `to` names a channel, and how it names a member.
 * @public
 */
export const CHAT_TARGET_SIGIL = {
  CHANNEL: "#",
  MEMBER: "@",
} as const;

/**
 * How a chat notice opens, in the line that tells an agent of a message.
 * @public
 */
export const CHAT_NOTICE_LEAD = "Chat";

/** A handle's grammar: a slug opening on a letter. */
const HANDLE_GRAMMAR = /^[a-z][a-z0-9-]*$/u;

/** A channel's name, without its `#`: the same grammar as a key. */
export const chatChannelNameSchema = inboxKeySchema;

/** A member's handle, without its `@`. */
export const chatHandleSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_HANDLE_CHARS),
  EffectSchema.isPattern(HANDLE_GRAMMAR),
);

/** Where a post goes, as a poster names it: `#name` for a channel, `@handle` for a member's DM, each within its own grammar's bound. */
export const chatTargetSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_KEY_CHARS + 1),
  EffectSchema.isPattern(
    new RegExp(
      `^(#[a-z0-9][a-z0-9._-]{0,${CHAT_BOUNDS.MAX_KEY_CHARS - 1}}|@[a-z][a-z0-9-]{0,${CHAT_BOUNDS.MAX_HANDLE_CHARS - 1}})$`,
      "u",
    ),
  ),
);

/**
 * A mention in a post's words: an `@handle` glued to no word before it or
 * after it, so an address or a token past the grammar names no one, while
 * punctuation after it, `@luke:` or `@agent-2's`, ends it.
 */
const MENTION = /(?<![\w@.-])@([a-z][a-z0-9-]*)(?![\w@-]|\.\w)/gu;

/** The handles a post's words mention, each once, in the order first mentioned. */
export function mentionedHandles(text: string): readonly string[] {
  const handles = [...text.matchAll(MENTION)]
    .map((match) => match[1] ?? "")
    .filter((handle) => handle.length <= CHAT_BOUNDS.MAX_HANDLE_CHARS);
  return [...new Set(handles)];
}

/**
 * An ask as its poster states it: the response it asks for, a one-line
 * title where the message's words are not its heading, and whether the
 * poster needs to hear back, which it does unless it says not.
 */
export const chatAskSchema = EffectSchema.Struct({
  title: EffectSchema.optionalKey(filledText(CHAT_BOUNDS.MAX_TITLE_CHARS)),
  response: inboxResponseSchema,
  needsReply: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type ChatAsk = typeof chatAskSchema.Type;

const postFields = {
  text: filledText(CHAT_BOUNDS.MAX_TEXT_CHARS),
  to: EffectSchema.optionalKey(chatTargetSchema),
  replyTo: EffectSchema.optionalKey(countedNumber),
};

/** A post goes one place: a reply posts into its thread's channel, so it names no `to` of its own. */
function oneDestination(post: { readonly to?: string; readonly replyTo?: number }): boolean {
  return post.to === undefined || post.replyTo === undefined;
}

/**
 * What a post's tool part carries as its input: the words, Markdown; where
 * they go, a channel by `#name` or a member's DM by `@handle`, the poster's
 * plan channel where unsaid; and the message it replies to in a thread, by
 * its sequence number, which posts into that message's channel and names no
 * `to`. An `@handle` in the words tells that member.
 */
export const postChatInputSchema = EffectSchema.Struct(postFields).check(
  EffectSchema.makeFilter(oneDestination),
);

/** An ask is always posted under a key, since the key is how its poster updates it and resolves it. */
function askKeyed(post: { readonly key?: string; readonly ask?: unknown }): boolean {
  return post.ask === undefined || post.key !== undefined;
}

/**
 * A post that may carry an ask: a post's fields, the ask under the poster's
 * key, which it must name and re-posted under which it updates in place,
 * and the blocks under the words, an image among them by its path in the
 * sandbox.
 */
export const postChatAskInputSchema = EffectSchema.Struct({
  ...postFields,
  key: EffectSchema.optionalKey(inboxKeySchema),
  ask: EffectSchema.optionalKey(chatAskSchema),
  blocks: EffectSchema.optionalKey(inboxPostBlocksSchema),
}).check(EffectSchema.makeFilter(askKeyed), EffectSchema.makeFilter(oneDestination));

/**
 * What a read's tool part carries as its input: a channel by `#name` or a
 * member's DM by `@handle`, a thread by its root's sequence number, and a
 * place to read back from, by sequence number; with none, what the reader
 * has not read yet.
 */
export const readChatInputSchema = EffectSchema.Struct({
  channel: EffectSchema.optionalKey(chatTargetSchema),
  thread: EffectSchema.optionalKey(countedNumber),
  before: EffectSchema.optionalKey(countedNumber),
});

/** What a resolve's tool part carries as its input: the ask's key, and why its poster takes it back. */
export const resolveAskInputSchema = EffectSchema.Struct({
  key: inboxKeySchema,
  reason: filledText(CHAT_BOUNDS.MAX_REASON_CHARS),
});

/**
 * A member as a reader sees one: its handle and kind, and what it stands
 * for by kind, a person's account, an agent, or a plan's planner; and
 * whether it has left, an archived agent or plan, which is still named in
 * the messages it wrote.
 */
export const chatMemberSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literals(Object.values(MEMBER_KIND)),
  handle: EffectSchema.String,
  userId: EffectSchema.optionalKey(EffectSchema.String),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  planId: EffectSchema.optionalKey(wireUuidSchema),
  left: EffectSchema.Boolean,
});

/** @public */
export type ChatMember = typeof chatMemberSchema.Type;

/** A channel as a reader sees one: its kind, its name, the plan it is of, the two members of a DM, and whether it is archived. */
export const chatChannelSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  kind: EffectSchema.Literals(Object.values(CHANNEL_KIND)),
  name: EffectSchema.optionalKey(EffectSchema.String),
  planId: EffectSchema.optionalKey(wireUuidSchema),
  members: EffectSchema.optionalKey(
    EffectSchema.Array(wireUuidSchema).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(2),
    ),
  ),
  archived: EffectSchema.Boolean,
});

/** @public */
export type ChatChannel = typeof chatChannelSchema.Type;

/** An ask as a message carries it: its key and revision, where it stands, what it asks, the answer and its answerer, and why its poster resolved it. */
export const chatMessageAskSchema = EffectSchema.Struct({
  key: EffectSchema.String,
  revision: countedNumber,
  status: EffectSchema.Literals(Object.values(INBOX_STATUS)),
  title: EffectSchema.optionalKey(EffectSchema.String),
  response: inboxReadResponseSchema,
  needsReply: EffectSchema.Boolean,
  answer: EffectSchema.optionalKey(inboxReplySchema),
  answeredBy: EffectSchema.optionalKey(wireUuidSchema),
  closedReason: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * A message as a reader sees one: its place in the workspace's sequence,
 * the place it last changed at, which an updated ask moves, its channel, the
 * thread root it replies to, its author, its body, the members it mentions,
 * when it was posted, and the ask it carries.
 */
export const chatMessageSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  seq: countedNumber,
  touchedSeq: countedNumber,
  channelId: wireUuidSchema,
  parentId: EffectSchema.optionalKey(wireUuidSchema),
  authorId: wireUuidSchema,
  blocks: EffectSchema.Array(inboxReadBlockSchema),
  mentions: EffectSchema.Array(wireUuidSchema),
  postedAt: countedNumber,
  ask: EffectSchema.optionalKey(chatMessageAskSchema),
});

/** @public */
export type ChatMessage = typeof chatMessageSchema.Type;

/**
 * Where a reader of a workspace's chat starts: before anything.
 * @public
 */
export const CHAT_CURSOR_START = "0";

/**
 * What a window's read of a workspace's chat names in its query: the
 * workspace, and the cursor it reads on from, as the service last handed it
 * back or the start.
 */
export const CHAT_QUERY = { WORKSPACE_ID: "workspaceId", AFTER: "after" } as const;

/** Where a reader of a workspace's chat stands, as the service last handed it back. */
export const chatCursorSchema = filledText(CHAT_BOUNDS.MAX_CURSOR_CHARS);

/**
 * A workspace's chat as the window reads it past a cursor: the reader's own
 * member and how far it has read, every member and channel it sees, the
 * messages posted or changed past the cursor, and the cursor to read on from.
 */
export const chatAnswerSchema = EffectSchema.Struct({
  self: wireUuidSchema,
  readSeq: countedNumber,
  members: EffectSchema.Array(chatMemberSchema),
  channels: EffectSchema.Array(chatChannelSchema),
  messages: EffectSchema.Array(chatMessageSchema),
  cursor: EffectSchema.String,
});

/** @public */
export type ChatAnswer = typeof chatAnswerSchema.Type;

/**
 * A form's values as lines, one per field filled, in the form's own order.
 * @public
 */
export function formValueLines(values: readonly InboxFormValue[]): string {
  return values.map(({ label, value }) => `- ${label}: ${fieldValueWords(value)}`).join("\n");
}

/**
 * An answer's own words, as its poster reads them.
 * @public
 */
export function replyWords(reply: InboxReply): string {
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

/**
 * Why an answer does not fit the response it answers, or nothing where it
 * does, as the Inbox reads an answer to an item.
 * @public
 */
export function replyRefusal(response: InboxReadResponse, reply: InboxReply): string | undefined {
  return inboxReplyRefusal({ response }, reply);
}

/** Whether a window's post carries its words one way: as text, or as blocks, never both or neither. */
function wordsOnce(post: { readonly text?: string; readonly blocks?: unknown }): boolean {
  return (post.text === undefined) !== (post.blocks === undefined);
}

/** Whether a window's post names one place: a `to`, or the message it replies to, never both. */
function placedOnce(post: { readonly to?: string; readonly replyTo?: number }): boolean {
  return post.to === undefined || post.replyTo === undefined;
}

/**
 * A person's post from the window: the words, as Markdown text or as word
 * blocks, a link or lines of code among them and never a picture, which a
 * window has no way to hand in yet; where it goes, a channel by `#name` or
 * a member's DM by `@handle`, `#general` where unsaid, or the message it
 * replies to by its place; and the window's own key for the post, which a
 * retry carries again. An `@handle` in the words tells that member.
 */
export const chatPostRequestSchema = EffectSchema.Struct({
  text: EffectSchema.optionalKey(filledText(CHAT_BOUNDS.MAX_TEXT_CHARS)),
  blocks: EffectSchema.optionalKey(
    EffectSchema.Array(inboxWordBlockSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_BLOCKS),
    ),
  ),
  to: EffectSchema.optionalKey(chatTargetSchema),
  replyTo: EffectSchema.optionalKey(countedNumber),
  clientKey: filledText(CHAT_BOUNDS.MAX_CLIENT_KEY_CHARS),
}).check(EffectSchema.makeFilter(wordsOnce), EffectSchema.makeFilter(placedOnce));

/** @public */
export type ChatPostRequest = typeof chatPostRequestSchema.Type;

/** A person's answer to an ask from the window: the ask by its place, the revision they saw, the answer, and the window's key for it. */
export const chatAnswerRequestSchema = EffectSchema.Struct({
  answer: EffectSchema.Struct({
    seq: countedNumber,
    revision: countedNumber,
    reply: inboxReplySchema,
  }),
  clientKey: filledText(CHAT_BOUNDS.MAX_CLIENT_KEY_CHARS),
});

/** A person resolving an ask of their own from the window: the ask by its place, and why. */
export const chatResolveRequestSchema = EffectSchema.Struct({
  resolve: EffectSchema.Struct({
    seq: countedNumber,
    reason: filledText(CHAT_BOUNDS.MAX_REASON_CHARS),
  }),
});

/** A person's window saying they have read to a place. */
export const chatReadToRequestSchema = EffectSchema.Struct({ readTo: countedNumber });

/**
 * What the window writes to a workspace's chat (POST): a post, an answer to
 * an ask, an ask of the person's own resolved, or how far they have read.
 * @public
 */
export const chatWriteRequestSchema = EffectSchema.Union([
  chatPostRequestSchema,
  chatAnswerRequestSchema,
  chatResolveRequestSchema,
  chatReadToRequestSchema,
]);

/** @public */
export type ChatWriteRequest = typeof chatWriteRequestSchema.Type;

/** Who a post came to, by handle: told now, held for their next read, left, and the handles its words mention that name no member. */
export const chatReceiptSchema = EffectSchema.Struct({
  told: EffectSchema.Array(EffectSchema.String),
  held: EffectSchema.Array(EffectSchema.String),
  left: EffectSchema.Array(EffectSchema.String),
  unresolved: EffectSchema.Array(EffectSchema.String),
});

/**
 * What a write to the chat answers, one key for each kind of write: a post,
 * the message and who it came to, a repeat under its key finishing a
 * telling the first left undone and steering no one twice; an answer, the ask as it then stands and whether the answer was
 * taken, which it is not at a revision its poster has moved past or on an
 * ask no longer open; a resolve, the ask resolved; and a read, where the
 * person's cursor then stands.
 */
export const chatWriteAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ posted: chatMessageSchema, receipt: chatReceiptSchema }),
  EffectSchema.Struct({ ask: chatMessageSchema, taken: EffectSchema.Boolean }),
  EffectSchema.Struct({ resolved: chatMessageSchema }),
  EffectSchema.Struct({ readSeq: countedNumber }),
]);

/** @public */
export type ChatWriteAnswer = typeof chatWriteAnswerSchema.Type;
