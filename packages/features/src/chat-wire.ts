import { Schema as EffectSchema } from "effect";
import {
  type CodingAgentAttachment,
  codingAgentMessageRequestSchema,
} from "./coding-agent-wire.js";
import {
  fieldValueWords,
  INBOX_BLOCK,
  INBOX_BOUNDS,
  INBOX_IMAGE_TYPE,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  type InboxBlock,
  type InboxFormValue,
  inboxBlockSchema,
  inboxFieldSchema,
  inboxFormValuesSchema,
  inboxKeySchema,
  inboxOptionSchema,
  inboxPostBlocksSchema,
  inboxReplyRefusal,
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
  type InboxCodeBlock as ChatCodeBlock,
  /** @public */
  type InboxField as ChatField,
  /** @public */
  type InboxFieldValue as ChatFieldValue,
  /** @public */
  type InboxFormValue as ChatFormValue,
  /** @public */
  type InboxImageBlock as ChatImageBlock,
  /** @public */
  type InboxImageType as ChatImageType,
  /** @public */
  type InboxPostBlock as ChatPostBlock,
  /** @public */
  type InboxReplyKind as ChatReplyKind,
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
} from "./inbox-wire.js";

/**
 * chat-wire.ts -- a workspace's chat: the members, channels, messages, and asks its coding agents, planners, and people talk through.
 *
 * A workspace has one chat, reached only through tools on the agent's side
 * and through the window on a person's. A member is named the way the rest
 * of the app names a person, an agent, or a task's Luke: by its mention
 * link (`mention-link.ts`), `[@Ada Lovelace](…/person/<userId>)`, an agent's
 * under its task or its workspace, a Luke's under his task, which a post
 * addresses a member by, a `to` names a DM by, and a reader is named by;
 * the handle each member was minted is no longer read. A channel is the workspace's
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
 * reply in its thread, and resolved by its poster. The block shapes are the
 * Inbox's own (`inbox-wire.ts`), named here as the chat's. The ask's shapes,
 * its response, its answer, and how a block or a response of a type this
 * build does not know is read, are the chat's own, copied from the Inbox's
 * version 4, because the Inbox's asks moved on to a vocabulary of their own
 * (version 5) and a chat ask must not move with them.
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

function boundedText(maximumChars: number) {
  return EffectSchema.String.check(EffectSchema.isMaxLength(maximumChars));
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
  /** The most characters a `to` may spell: a channel's `#name`, or a member's mention link, whose label is a name and whose address an agent's task and id make long. */
  MAX_TARGET_CHARS: 512,
  /** The most characters a topic channel's purpose may spell: a line under its name, never a brief. */
  MAX_PURPOSE_CHARS: 250,
  /** The most pictures one post from the window may carry: a message's blocks, its words' one left out. */
  MAX_POST_PICTURES: INBOX_BOUNDS.MAX_BLOCKS - 1,
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
  /** Renames a topic channel, says or clears what it is for, or archives it or brings it back. */
  EDIT_CHANNEL: "edit_channel",
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
  /** A plan's Luke, one per plan, named by his task's `…/plan/<taskId>/luke` link. */
  LUKE: "planner",
} as const;

/** @public */
export type MemberKind = (typeof MEMBER_KIND)[keyof typeof MEMBER_KIND];

/**
 * What a member is called where no mention link can be written of it, or no
 * name is known: a task's Luke is Luke, and an agent whose coding agent is
 * gone, or a person whose account is, a former one.
 * @public
 */
export const CHAT_MEMBER_LABEL = {
  LUKE: "Luke",
  FORMER_AGENT: "Former agent",
  FORMER_PERSON: "Former member",
} as const;

/**
 * The kinds of channel a workspace's chat holds.
 * @public
 */
export const CHANNEL_KIND = {
  /** The workspace's one `#general`. */
  GENERAL: "general",
  /** A task's own channel, named from the task on first use, where its agents post by default; stored as `plan`. */
  TASK: "plan",
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
export const LUKE_HANDLE = "luke";

/**
 * How a `to` names a channel, and how the window's composer opens a member's mention.
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

/** A notice's closing line telling the agent what the message asks, by the kind of answer it asks for. */
export function chatNoticeAsksLine(response: string): string {
  return `It asks you (${response}): answer it in its thread.`;
}

/** A notice's closing line telling the agent how to reply to the message at its place. */
export function chatNoticeReplyLine(seq: number): string {
  return `Reply with ${CHAT_TOOL.POST}({ replyTo: ${seq}, text }).`;
}

/**
 * A notice's head as `chat-notify.ts` writes it, whole: the lead, who said it,
 * by their mention link or a plain name, where, and its place.
 */
const CHAT_NOTICE_HEAD = new RegExp(
  `^${CHAT_NOTICE_LEAD} · .+ (?:to you|in #\\S*)(?:, in a thread)? \\(m \\d+\\):$`,
  "u",
);

/** The closing lines as `chatNoticeAsksLine` and `chatNoticeReplyLine` write them, whole, which nothing a member typed is read as. */
const CHAT_NOTICE_CLOSINGS = [
  /^It asks you \([a-z-]+\): answer it in its thread\.$/u,
  new RegExp(`^Reply with ${CHAT_TOOL.POST}\\(\\{ replyTo: \\d+, text \\}\\)\\.$`, "u"),
] as const;

/**
 * A notice's own words as a person reads them: the message, without the head
 * naming who said it where, which the card says in its own head, and without
 * the closing lines at its end telling the agent how to answer, which are the
 * model's alone. Only lines of the closings' whole shape, after the message,
 * are taken away, so a message that itself opens "Reply with" keeps every
 * word. A text of no notice's shape is answered as it is.
 */
export function chatNoticeWords(text: string): string {
  const [head, ...rest] = text.split("\n\n");
  if (head === undefined || !CHAT_NOTICE_HEAD.test(head)) return text;
  const words = [...rest];
  // The reply line ends every notice, and the asks line stands before it where the message asks.
  for (const closing of [...CHAT_NOTICE_CLOSINGS].reverse()) {
    const last = words.at(-1);
    if (last !== undefined && closing.test(last)) words.pop();
  }
  return words.join("\n\n").trim();
}

/** A handle's grammar: a slug opening on a letter. */
const HANDLE_GRAMMAR = /^[a-z][a-z0-9-]*$/u;

/** A channel's name, without its `#`: the same grammar as a key. */
export const chatChannelNameSchema = inboxKeySchema;

/** What a topic channel says it is for: one line of words, with no line break in it. */
const chatPurposeSchema = filledText(CHAT_BOUNDS.MAX_PURPOSE_CHARS).check(
  EffectSchema.isPattern(/^[^\r\n]*$/u),
);

/** A member's handle, without its `@`. */
export const chatHandleSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_HANDLE_CHARS),
  EffectSchema.isPattern(HANDLE_GRAMMAR),
);

/** A channel as a `to` names it: `#name`, within a key's grammar and bound. */
const CHANNEL_TARGET = `#[a-z0-9][a-z0-9._-]{0,${CHAT_BOUNDS.MAX_KEY_CHARS - 1}}`;

/**
 * A member as a `to` names it: its mention link written whole,
 * `[@Name](address)`, its label's brackets and backslashes escaped, or the
 * address alone. Only the shape is held here; whether the address names a
 * member of the chat is the service's to say.
 */
const MEMBER_TARGET = String.raw`\[@(?:[^\\\]\r\n]|\\.)+\]\([^\s()]+\)|[a-z][a-z0-9+.-]*:\/\/[^\s()]+`;

/** Where a post goes, as a poster names it: `#name` for a channel, or a member's mention link, or its bare address, for that member's DM. */
export const chatTargetSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_TARGET_CHARS),
  EffectSchema.isPattern(new RegExp(`^(?:${CHANNEL_TARGET}|${MEMBER_TARGET})$`, "u")),
);

/**
 * What an ask asks for, one of six, as the Inbox asked before its version 5:
 * a choice among options, several where `multiple`, the label it recommends
 * named; an approval; words, with what the box says while empty; a task; a
 * form of fields; or nothing but an acknowledgement.
 * @public
 */
export const chatResponseSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_ASK.CHOICE),
    options: EffectSchema.Array(inboxOptionSchema).check(
      EffectSchema.isMinLength(2),
      EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_OPTIONS),
    ),
    multiple: EffectSchema.optionalKey(EffectSchema.Boolean),
    recommended: EffectSchema.optionalKey(EffectSchema.String),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(CHAT_ASK.APPROVAL) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_ASK.TEXT),
    placeholder: EffectSchema.optionalKey(boundedText(CHAT_BOUNDS.MAX_LABEL_CHARS)),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(CHAT_ASK.TASK) }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(CHAT_ASK.FORM),
    fields: EffectSchema.Array(inboxFieldSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_FIELDS),
    ),
  }),
  EffectSchema.Struct({ type: EffectSchema.Literal(CHAT_ASK.NONE) }),
]);

/** @public */
export type ChatResponse = typeof chatResponseSchema.Type;

/**
 * A choice as an ask asks it, with the options an answer must name.
 * @public
 */
export type ChatChoice = Extract<ChatResponse, { type: typeof CHAT_ASK.CHOICE }>;

/**
 * A form as an ask asks it, with the fields an answer fills.
 * @public
 */
export type ChatForm = Extract<ChatResponse, { type: typeof CHAT_ASK.FORM }>;

/**
 * A member's answer to an ask: how they answered, the options where they
 * picked, the form's values where they filled one, and their note.
 * @public
 */
export const chatReplySchema = EffectSchema.Struct({
  reply: EffectSchema.Literals(Object.values(INBOX_REPLY)),
  choices: EffectSchema.optionalKey(
    EffectSchema.Array(EffectSchema.String).check(
      EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_OPTIONS),
    ),
  ),
  values: EffectSchema.optionalKey(inboxFormValuesSchema),
  note: EffectSchema.optionalKey(boundedText(CHAT_BOUNDS.MAX_NOTE_CHARS)),
});

/** @public */
export type ChatReply = typeof chatReplySchema.Type;

/** The block and ask types this build draws, by which a read tells a type it does not know. */
const CHAT_KNOWN_TYPES: ReadonlySet<string> = new Set([
  ...Object.values(INBOX_BLOCK),
  ...Object.values(CHAT_ASK),
]);

/**
 * A block or ask type this build does not know, as a newer service wrote
 * one: read as the type's name alone, and drawn as a placeholder naming a
 * newer Luke. A type this build knows is refused here, because a known one
 * that fails its own shape is a broken read and not a newer one.
 */
const unknownChatTypeSchema = EffectSchema.String.check(
  EffectSchema.makeFilter((type) => !CHAT_KNOWN_TYPES.has(type)),
).pipe(EffectSchema.brand("UnknownChatType"));

/**
 * A block as a reader reads one: one this build knows, or the type alone of one it does not.
 * @public
 */
export const chatReadBlockSchema = EffectSchema.Union([
  ...inboxBlockSchema.members,
  EffectSchema.Struct({ type: unknownChatTypeSchema }),
]);

/** @public */
export type ChatReadBlock = typeof chatReadBlockSchema.Type;

/**
 * A response as a reader reads one: one this build knows, or the type alone of one it does not.
 * @public
 */
export const chatReadResponseSchema = EffectSchema.Union([
  ...chatResponseSchema.members,
  EffectSchema.Struct({ type: unknownChatTypeSchema }),
]);

/** @public */
export type ChatReadResponse = typeof chatReadResponseSchema.Type;

/**
 * Whether a response read off the wire is one this build knows, which its type decides.
 * @public
 */
export function knownResponse(response: ChatReadResponse): response is ChatResponse {
  return Object.values<string>(CHAT_ASK).includes(response.type);
}

/**
 * Whether a block read off the wire is one this build knows, which its type decides.
 * @public
 */
export function knownBlock(block: ChatReadBlock): block is InboxBlock {
  return Object.values<string>(INBOX_BLOCK).includes(block.type);
}

/**
 * An ask as its poster states it: the response it asks for, a one-line
 * title where the message's words are not its heading, and whether the
 * poster needs to hear back, which it does unless it says not.
 */
export const chatAskSchema = EffectSchema.Struct({
  title: EffectSchema.optionalKey(filledText(CHAT_BOUNDS.MAX_TITLE_CHARS)),
  response: chatResponseSchema,
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
 * they go, a channel by `#name` or a member's DM by its mention link, the
 * poster's plan channel where unsaid; and the message it replies to in a
 * thread, by its sequence number, which posts into that message's channel
 * and names no `to`. A member's mention link in the words tells that member.
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
  /** What a topic channel `to` opens is for; nothing where the post opens none. */
  purpose: EffectSchema.optionalKey(chatPurposeSchema),
  key: EffectSchema.optionalKey(inboxKeySchema),
  ask: EffectSchema.optionalKey(chatAskSchema),
  blocks: EffectSchema.optionalKey(inboxPostBlocksSchema),
}).check(EffectSchema.makeFilter(askKeyed), EffectSchema.makeFilter(oneDestination));

/**
 * What a read's tool part carries as its input: a channel by `#name` or a
 * member's DM by its mention link, a thread by its root's sequence number, and a
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

/** What an edit of a topic channel's tool part carries: the topic by `#name`, and what changes of it, each left out standing. */
export const editChannelInputSchema = EffectSchema.Struct({
  channel: EffectSchema.String.check(
    EffectSchema.isPattern(
      new RegExp(`^#[a-z0-9][a-z0-9._-]{0,${CHAT_BOUNDS.MAX_KEY_CHARS - 1}}$`, "u"),
    ),
  ),
  name: EffectSchema.optionalKey(chatChannelNameSchema),
  purpose: EffectSchema.optionalKey(EffectSchema.NullOr(chatPurposeSchema)),
  archived: EffectSchema.optionalKey(EffectSchema.Boolean),
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
  /** The member's handle, which a person's window no longer names anyone by; absent from a service past it. */
  handle: EffectSchema.optionalKey(EffectSchema.String),
  /** What a person or an agent is called: a person's account's name, an agent's title, or its model's id before it has one; absent for a Luke, always Luke, and for a member whose account or agent is gone. */
  name: EffectSchema.optionalKey(EffectSchema.String),
  userId: EffectSchema.optionalKey(EffectSchema.String),
  agentId: EffectSchema.optionalKey(wireUuidSchema),
  /** The plan a planner is Luke on, or the plan an agent works on; absent for a person, an agent on no plan, and from a service before agents named theirs. */
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
  /** What a topic channel says it is for; absent where it says nothing. */
  purpose: EffectSchema.optionalKey(EffectSchema.String),
});

/** @public */
export type ChatChannel = typeof chatChannelSchema.Type;

/** An ask as a message carries it: its key and revision, where it stands, what it asks, the answer and its answerer, and why its poster resolved it. */
export const chatMessageAskSchema = EffectSchema.Struct({
  key: EffectSchema.String,
  revision: countedNumber,
  status: EffectSchema.Literals(Object.values(INBOX_STATUS)),
  title: EffectSchema.optionalKey(EffectSchema.String),
  response: chatReadResponseSchema,
  needsReply: EffectSchema.Boolean,
  answer: EffectSchema.optionalKey(chatReplySchema),
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
  blocks: EffectSchema.Array(chatReadBlockSchema),
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

/**
 * What a window's read of one picture a message carries names in its
 * query: the workspace, the message, and the attachment its image block
 * names.
 */
export const CHAT_ATTACHMENT_QUERY = {
  WORKSPACE_ID: CHAT_QUERY.WORKSPACE_ID,
  MESSAGE_ID: "messageId",
  ATTACHMENT_ID: "attachmentId",
} as const;

/** Where a reader of a workspace's chat stands, as the service last handed it back. */
export const chatCursorSchema = filledText(CHAT_BOUNDS.MAX_CURSOR_CHARS);

/** How far the reader has read one channel on that channel's own cursor, where that is past its floor. */
export const chatChannelReadSchema = EffectSchema.Struct({
  channelId: wireUuidSchema,
  readSeq: countedNumber,
});

/**
 * A workspace's chat as the window reads it past a cursor: the reader's own
 * member and how far it has read everywhere, each channel it has read
 * further on that channel's own cursor, every member and channel it sees,
 * the messages posted or changed past the cursor, and the cursor to read on
 * from. A service that predates per-channel cursors sends no `reads`.
 */
export const chatAnswerSchema = EffectSchema.Struct({
  self: wireUuidSchema,
  readSeq: countedNumber,
  reads: EffectSchema.optionalKey(EffectSchema.Array(chatChannelReadSchema)),
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
export function replyWords(reply: ChatReply): string {
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
 * does, as the Inbox read an answer to an item before its version 5. A
 * response this build does not know takes nothing.
 * @public
 */
export function replyRefusal(response: ChatReadResponse, reply: ChatReply): string | undefined {
  if (!knownResponse(response)) return "The item asks something this Luke does not know.";
  return inboxReplyRefusal({ response }, reply);
}

/** What a window's post carries: its words as text or as blocks, and the pictures under them. */
interface WindowPost {
  readonly text?: string;
  readonly blocks?: readonly unknown[];
  readonly attachments?: readonly CodingAgentAttachment[];
}

/** Whether a window's post carries its words one way at most, as text or as blocks, and carries something: words, pictures, or both. */
function wordsOnce(post: WindowPost): boolean {
  if (post.text !== undefined && post.blocks !== undefined) return false;
  return (
    post.text !== undefined || post.blocks !== undefined || (post.attachments ?? []).length > 0
  );
}

/** The image types a picture may be, which a post's files are held to. */
const CHAT_IMAGE_TYPES: ReadonlySet<string> = new Set(Object.values(INBOX_IMAGE_TYPE));

/** Whether every file a post carries is a picture, and the message its words and pictures make holds no more blocks than any message. */
function picturesFit(post: WindowPost): boolean {
  const pictures = post.attachments ?? [];
  const words = post.blocks?.length ?? (post.text === undefined ? 0 : 1);
  return (
    pictures.every((picture) => CHAT_IMAGE_TYPES.has(picture.mediaType)) &&
    words + pictures.length <= CHAT_BOUNDS.MAX_BLOCKS
  );
}

/** Whether a window's post names one place at most: a `to`, the channel shown, or the message it replies to. */
function placedOnce(post: {
  readonly to?: string;
  readonly channelId?: string;
  readonly replyTo?: number;
}): boolean {
  return [post.to, post.channelId, post.replyTo].filter((place) => place !== undefined).length <= 1;
}

/**
 * A person's post from the window: the words, as Markdown text or as word
 * blocks, a link or lines of code among them; the pictures under them, in
 * the coding agent's file shape, PNG, JPEG, or WebP alone, which the
 * service keeps and the message names as image blocks after the words, a
 * post of pictures alone carrying no words; where it goes, the channel the
 * window shows by its id, a channel by `#name`, `#general` where unsaid, or
 * the message it replies to by its place; and the window's own key for the
 * post, which a retry carries again. A member's mention link in the words
 * tells that member.
 */
export const chatPostRequestSchema = EffectSchema.Struct({
  text: EffectSchema.optionalKey(filledText(CHAT_BOUNDS.MAX_TEXT_CHARS)),
  blocks: EffectSchema.optionalKey(
    EffectSchema.Array(inboxWordBlockSchema).check(
      EffectSchema.isMinLength(1),
      EffectSchema.isMaxLength(CHAT_BOUNDS.MAX_BLOCKS),
    ),
  ),
  attachments: codingAgentMessageRequestSchema.fields.attachments,
  to: EffectSchema.optionalKey(chatTargetSchema),
  /** The channel the window shows, a direct message among them, which names its place by what it is rather than by any member's name. */
  channelId: EffectSchema.optionalKey(wireUuidSchema),
  replyTo: EffectSchema.optionalKey(countedNumber),
  clientKey: filledText(CHAT_BOUNDS.MAX_CLIENT_KEY_CHARS),
}).check(
  EffectSchema.makeFilter(wordsOnce),
  EffectSchema.makeFilter(picturesFit),
  EffectSchema.makeFilter(placedOnce),
);

/** @public */
export type ChatPostRequest = typeof chatPostRequestSchema.Type;

/** A person's answer to an ask from the window: the ask by its place, the revision they saw, the answer, and the window's key for it. */
export const chatAnswerRequestSchema = EffectSchema.Struct({
  answer: EffectSchema.Struct({
    seq: countedNumber,
    revision: countedNumber,
    reply: chatReplySchema,
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

/** A person's window saying they have read to a place: in the channel shown, or every channel where it names none. */
export const chatReadToRequestSchema = EffectSchema.Struct({
  readTo: countedNumber,
  channelId: EffectSchema.optionalKey(wireUuidSchema),
});

/** A person's window opening a topic channel under a name of its own, with what it is for. */
export const chatOpenRequestSchema = EffectSchema.Struct({
  open: EffectSchema.Struct({
    name: chatChannelNameSchema,
    purpose: EffectSchema.optionalKey(chatPurposeSchema),
  }),
});

/** @public */
export type ChatOpenRequest = typeof chatOpenRequestSchema.Type;

/** A person's window renaming a topic channel, saying or clearing its purpose, or archiving it or bringing it back; each left out stays. */
export const chatEditRequestSchema = EffectSchema.Struct({
  edit: EffectSchema.Struct({
    channelId: wireUuidSchema,
    name: EffectSchema.optionalKey(chatChannelNameSchema),
    purpose: EffectSchema.optionalKey(EffectSchema.NullOr(chatPurposeSchema)),
    archived: EffectSchema.optionalKey(EffectSchema.Boolean),
  }),
});

/** @public */
export type ChatEditRequest = typeof chatEditRequestSchema.Type;

/**
 * What the window writes to a workspace's chat (POST): a post, an answer to
 * an ask, an ask of the person's own resolved, how far they have read, or a
 * topic channel opened or edited.
 * @public
 */
export const chatWriteRequestSchema = EffectSchema.Union([
  chatPostRequestSchema,
  chatAnswerRequestSchema,
  chatResolveRequestSchema,
  chatReadToRequestSchema,
  chatOpenRequestSchema,
  chatEditRequestSchema,
]);

/** @public */
export type ChatWriteRequest = typeof chatWriteRequestSchema.Type;

/** Who a post came to, each member by its mention link or a plain name where none can be written: told now, held for their next read, left, and the labels of the links its words write that name no member. */
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
 * ask no longer open; a resolve, the ask resolved; a read, where the
 * person's cursor then stands everywhere, and each channel past it; and a
 * channel opened or edited, the channel as it then stands.
 */
export const chatWriteAnswerSchema = EffectSchema.Union([
  EffectSchema.Struct({ posted: chatMessageSchema, receipt: chatReceiptSchema }),
  EffectSchema.Struct({ ask: chatMessageSchema, taken: EffectSchema.Boolean }),
  EffectSchema.Struct({ resolved: chatMessageSchema }),
  EffectSchema.Struct({
    readSeq: countedNumber,
    reads: EffectSchema.optionalKey(EffectSchema.Array(chatChannelReadSchema)),
  }),
  EffectSchema.Struct({ channel: chatChannelSchema }),
]);

/** @public */
export type ChatWriteAnswer = typeof chatWriteAnswerSchema.Type;
