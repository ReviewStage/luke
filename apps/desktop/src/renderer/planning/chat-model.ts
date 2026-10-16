import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_TARGET_SIGIL,
  type ChatAnswer,
  type ChatChannel,
  type ChatMember,
  type ChatMessage,
  type ChatReply,
  MEMBER_KIND,
  type postChatInputSchema,
} from "@luke/features/chat-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import type { ChatTarget } from "./chat-mention";

/**
 * chat-model.ts -- what the window's Chat draws of a workspace's chat: the rail of places, each channel's unread count, a channel's messages with their threads, and For you.
 *
 * Everything here is read off one answer of the service's
 * (`chat-wire.ts`'s `chatAnswerSchema`): the reader's own member, how far
 * it has read, every member and channel it sees, and the messages. The
 * rail leads with For you, then the channels, `#general` first, each
 * plan's own channel, then the topics, and then the direct messages, the
 * latest spoken in first. A channel counts what was posted in it past the
 * reader's cursor by anyone but the reader. A channel's messages read as
 * roots in the order they were posted, each with the replies of its
 * thread in theirs. For you is what waits on the reader: every open ask
 * someone else posted, the oldest first, since the longest kept waiting is
 * answered first, then each direct message and mention of the reader not
 * yet read, the oldest first.
 *
 * What the window sends is a post, in the shape an agent's `post_chat`
 * takes, to the place shown or into a thread, or an answer to an ask at
 * the revision the developer read. The composer offers every member who
 * has not left by `@handle` and every channel standing by `#name`.
 */

/** The places the window's Chat shows: For you, or one channel. */
export const CHAT_PLACE = {
  FOR_YOU: "for-you",
  CHANNEL: "channel",
} as const;

export type ChatPlace =
  | { readonly kind: typeof CHAT_PLACE.FOR_YOU }
  | { readonly kind: typeof CHAT_PLACE.CHANNEL; readonly channelId: string };

/** Where the window's Chat opens: For you. */
export const FOR_YOU: ChatPlace = { kind: CHAT_PLACE.FOR_YOU };

/** Why a message is in For you. */
export const FOR_YOU_REASON = {
  /** An ask someone posted, still open. */
  ASK: "ask",
  /** A direct message to the reader, not yet read. */
  DIRECT: "direct",
  /** A message mentioning the reader, not yet read. */
  MENTION: "mention",
} as const;

type ForYouReason = (typeof FOR_YOU_REASON)[keyof typeof FOR_YOU_REASON];

/** A post the window sends: the words, where they go, and the message they reply to in a thread (`chat-wire.ts`'s `postChatInputSchema`). */
export type ChatPost = typeof postChatInputSchema.Type;

/** An answer the window sends to an ask: the message carrying it, the revision the developer read, and the answer. */
export interface ChatAskAnswer {
  readonly seq: number;
  readonly revision: number;
  readonly reply: ChatReply;
}

/** What Luke is called wherever a plan's planner speaks. */
const PLANNER_NAME = "Luke";

/** The order the rail lists channels in, by kind: `#general`, the plans', then the topics. */
const CHANNEL_ORDER = {
  [CHANNEL_KIND.GENERAL]: 0,
  [CHANNEL_KIND.PLAN]: 1,
  [CHANNEL_KIND.TOPIC]: 2,
  [CHANNEL_KIND.DM]: 3,
} as const satisfies Record<ChatChannel["kind"], number>;

/** What the window knows beside the chat that names its members: each agent's line, each plan's name, and the reader's own name. */
export interface ChatNames {
  readonly agents: ReadonlyMap<string, TaskAgentLine>;
  readonly plans: ReadonlyMap<string, string>;
  readonly selfName: string | undefined;
}

/** The names a window knows: each agent's line from the plans' summaries and the lines a chat read carries, each plan's name, and the reader's own. */
export function chatNames(
  plans: readonly TaskSummary[],
  agents: readonly TaskAgentLine[],
  selfName: string | undefined,
): ChatNames {
  const lines = [...plans.flatMap((plan) => plan.agents?.agents ?? []), ...agents];
  return {
    agents: new Map(lines.map((line) => [line.id, line])),
    plans: new Map(plans.map((plan) => [plan.id, plan.name])),
    selfName,
  };
}

/** A member as a line names it: what it is called, its handle, the agent's line where it is one, and the plan it stands for. */
export interface ChatWho {
  readonly member: ChatMember | undefined;
  readonly name: string;
  readonly handle: string;
  readonly agent: TaskAgentLine | undefined;
  readonly planName: string | undefined;
}

/** One row of the rail: the channel, what it is called, what it says beside that, and how many unread messages it holds. */
export interface ChatRailRow {
  readonly channel: ChatChannel;
  readonly label: string;
  /** What a direct message's row says after the name: the other member's agent title or plan. */
  readonly sub: string | undefined;
  /** The other member of a direct message, for its mark. */
  readonly other: ChatWho | undefined;
  readonly unread: number;
}

export interface ChatRail {
  /** How many messages wait on the reader in For you. */
  readonly forYou: number;
  readonly channels: readonly ChatRailRow[];
  readonly direct: readonly ChatRailRow[];
}

/** A root message and the replies of its thread, each in the order posted. */
export interface ChatThread {
  readonly message: ChatMessage;
  readonly replies: readonly ChatMessage[];
}

/** A message in For you: why, the thread it heads or stands in, and the channel it was posted in. */
export interface ForYouEntry extends ChatThread {
  readonly reason: ForYouReason;
  readonly channel: ChatChannel;
}

function bySeq(one: ChatMessage, other: ChatMessage): number {
  return one.seq - other.seq;
}

/** Whether the reader has yet to read a message: posted past its cursor by someone else. */
function unreadBy(chat: ChatAnswer, message: ChatMessage): boolean {
  return message.seq > chat.readSeq && message.authorId !== chat.self;
}

/** The member of a direct message who is not the reader, by id; none for a channel. */
function otherOf(chat: ChatAnswer, channel: ChatChannel): string | undefined {
  if (channel.kind !== CHANNEL_KIND.DM) return undefined;
  return channel.members?.find((id) => id !== chat.self) ?? channel.members?.[0];
}

/** A member by its id, the way every line names it: an agent by its title, a plan's planner as Luke, a person by their handle, the reader by their own name. */
export function chatWho(chat: ChatAnswer, names: ChatNames, memberId: string): ChatWho {
  const member = chat.members.find((each) => each.id === memberId);
  const handle = member?.handle ?? "unknown";
  const agent = member?.agentId === undefined ? undefined : names.agents.get(member.agentId);
  const planName = member?.planId === undefined ? undefined : names.plans.get(member.planId);
  const name =
    member?.kind === MEMBER_KIND.PLANNER
      ? PLANNER_NAME
      : member?.kind === MEMBER_KIND.AGENT
        ? (agent?.title ?? handle)
        : memberId === chat.self && names.selfName !== undefined
          ? names.selfName
          : handle;
  return { member, name, handle, agent, planName };
}

/** What a channel is called: a channel's own name, a direct message's other member's handle. */
export function channelLabel(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  const other = otherOf(chat, channel);
  if (other !== undefined) return chatWho(chat, names, other).handle;
  return (
    channel.name ?? (channel.planId === undefined ? "" : names.plans.get(channel.planId)) ?? ""
  );
}

/** Every message of a channel's in the order posted. */
function messagesIn(chat: ChatAnswer, channelId: string): readonly ChatMessage[] {
  return chat.messages.filter((message) => message.channelId === channelId).toSorted(bySeq);
}

/** The rail: For you's count, the channels in their order, and the direct messages, the latest spoken in first. */
export function chatRail(chat: ChatAnswer, names: ChatNames): ChatRail {
  const row = (channel: ChatChannel): ChatRailRow => {
    const other = otherOf(chat, channel);
    const who = other === undefined ? undefined : chatWho(chat, names, other);
    return {
      channel,
      label: channelLabel(chat, names, channel),
      sub: who?.agent?.title ?? who?.planName,
      other: who,
      unread: messagesIn(chat, channel.id).filter((message) => unreadBy(chat, message)).length,
    };
  };
  const shown = chat.channels.filter((channel) => !channel.archived);
  const latest = (channel: ChatChannel) => messagesIn(chat, channel.id).at(-1)?.seq ?? 0;
  const channels = shown
    .filter((channel) => channel.kind !== CHANNEL_KIND.DM)
    .toSorted(
      (one, other) =>
        CHANNEL_ORDER[one.kind] - CHANNEL_ORDER[other.kind] ||
        channelLabel(chat, names, one).localeCompare(channelLabel(chat, names, other)),
    );
  const direct = shown
    .filter((channel) => channel.kind === CHANNEL_KIND.DM)
    .toSorted((one, other) => latest(other) - latest(one));
  return { forYou: forYou(chat).length, channels: channels.map(row), direct: direct.map(row) };
}

/**
 * A channel's messages as threads: each root in the order posted, its
 * replies under it in theirs. A reply whose root is not among the messages
 * read stands as a root of its own, so nothing read goes undrawn.
 */
export function channelThreads(chat: ChatAnswer, channelId: string): readonly ChatThread[] {
  const messages = messagesIn(chat, channelId);
  const ids = new Set(messages.map((message) => message.id));
  const rooted = (message: ChatMessage) =>
    message.parentId !== undefined && ids.has(message.parentId);
  return messages
    .filter((message) => !rooted(message))
    .map((message) => ({
      message,
      replies: messages.filter((reply) => reply.parentId === message.id),
    }));
}

/** Why a message waits on the reader, or nothing where it does not. */
function waitingReason(chat: ChatAnswer, message: ChatMessage, channel: ChatChannel) {
  if (message.authorId === chat.self) return undefined;
  if (message.ask?.status === ASK_STATUS.OPEN) return FOR_YOU_REASON.ASK;
  if (!unreadBy(chat, message)) return undefined;
  if (channel.kind === CHANNEL_KIND.DM) return FOR_YOU_REASON.DIRECT;
  return message.mentions.includes(chat.self) ? FOR_YOU_REASON.MENTION : undefined;
}

/** For you: every open ask someone else posted, the oldest first, then each unread direct message and mention of the reader, the oldest first. */
export function forYou(chat: ChatAnswer): readonly ForYouEntry[] {
  const channels = new Map(chat.channels.map((channel) => [channel.id, channel]));
  const entries = chat.messages.toSorted(bySeq).flatMap((message): ForYouEntry[] => {
    const channel = channels.get(message.channelId);
    if (channel === undefined || channel.archived) return [];
    const reason = waitingReason(chat, message, channel);
    if (reason === undefined) return [];
    const replies = chat.messages.filter((reply) => reply.parentId === message.id).toSorted(bySeq);
    return [{ reason, channel, message, replies }];
  });
  return [
    ...entries.filter((entry) => entry.reason === FOR_YOU_REASON.ASK),
    ...entries.filter((entry) => entry.reason !== FOR_YOU_REASON.ASK),
  ];
}

/** The channel a place shows, or none for For you or a channel the chat no longer holds. */
export function placeChannel(chat: ChatAnswer, place: ChatPlace): ChatChannel | undefined {
  if (place.kind !== CHAT_PLACE.CHANNEL) return undefined;
  return chat.channels.find((channel) => channel.id === place.channelId);
}

/** Where a post to the channel goes, as `post_chat`'s `to` names it: `#name`, or a DM's `@handle`. */
export function postTarget(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
  const label = channelLabel(chat, names, channel);
  return channel.kind === CHANNEL_KIND.DM
    ? `${CHAT_TARGET_SIGIL.MEMBER}${label}`
    : `${CHAT_TARGET_SIGIL.CHANNEL}${label}`;
}

/** What the composer offers to name: every member who has not left but the reader, and every channel standing that is not a DM. */
export function chatTargets(chat: ChatAnswer, names: ChatNames): readonly ChatTarget[] {
  const members = chat.members
    .filter((member) => !member.left && member.id !== chat.self)
    .map((member): ChatTarget => {
      const who = chatWho(chat, names, member.id);
      const detail = member.kind === MEMBER_KIND.HUMAN ? undefined : who.name;
      return { sigil: CHAT_TARGET_SIGIL.MEMBER, name: member.handle, detail };
    });
  const channels = chat.channels
    .filter((channel) => !channel.archived && channel.kind !== CHANNEL_KIND.DM)
    .map(
      (channel): ChatTarget => ({
        sigil: CHAT_TARGET_SIGIL.CHANNEL,
        name: channelLabel(chat, names, channel),
        detail: channel.planId === undefined ? undefined : names.plans.get(channel.planId),
      }),
    );
  // Note that every plan's planner answers to `@luke`, so a handle is offered once.
  const offered = [...members, ...channels];
  return offered.filter(
    (target, at) =>
      offered.findIndex((each) => each.sigil === target.sigil && each.name === target.name) === at,
  );
}
