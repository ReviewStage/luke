import { ACCOUNT_CHAT_REASON } from "@luke/features/account-inbox-wire";
import { type ChatMemberMention, chatMentionsIn } from "@luke/features/chat-mentions";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_BLOCK,
  CHAT_BOUNDS,
  CHAT_MEMBER_LABEL,
  type ChatAnswer,
  type ChatChannel,
  type ChatEditRequest,
  type ChatMember,
  type ChatMessage,
  type ChatOpenRequest,
  type ChatPostRequest,
  type ChatReadBlock,
  type ChatReply,
  GENERAL_CHANNEL,
  knownBlock,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { DICTATION_BOUNDS } from "@luke/features/dictation-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { agentTabLabel, CATALOG_ID_SEPARATOR, modelLabel } from "@luke/features/model-label";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import type { TaskSectionIcon } from "@luke/features/task-section-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";

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
 * has not left by name, written as their mention link, and every channel
 * standing by `#name`. Every member is named by who they are, never by a
 * handle: a person by their account's name, an agent by its title, and a
 * task's Luke as Luke.
 *
 * Every read here goes through one index of the answer (`chatIndex`), built
 * the first time the answer is read and kept on it: its members and channels
 * by id, each channel's messages in the order posted, each message's
 * replies, and each channel's unread count and newest message. What is read
 * of the roster alone (who a member is, what the composer offers, what a
 * dictation listens for) is kept on the roster's own arrays, which a push
 * keeps while the roster stands, so a new message reads none of it again.
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

/** Why a message is in For you: the account's own reasons a chat message waits on the developer. */
export const FOR_YOU_REASON = ACCOUNT_CHAT_REASON;

type ForYouReason = (typeof FOR_YOU_REASON)[keyof typeof FOR_YOU_REASON];

/** A post the window sends: the words, the pictures under them, where they go, and the message they reply to in a thread (`chat-wire.ts`'s `chatPostRequestSchema`, its key the sender's to mint). */
export type ChatPost = Omit<ChatPostRequest, "blocks" | "clientKey">;

/** A topic channel opened, or one renamed, its purpose said or cleared, or archived or brought back, as the window writes it. */
export type ChatChannelChange = ChatOpenRequest | ChatEditRequest;

/** An answer the window sends to an ask: the message carrying it, the revision the developer read, and the answer. */
export interface ChatAskAnswer {
  readonly seq: number;
  readonly revision: number;
  readonly reply: ChatReply;
}

/** The order the rail lists channels in, by kind: `#general`, the plans', then the topics. */
const CHANNEL_ORDER = {
  [CHANNEL_KIND.GENERAL]: 0,
  [CHANNEL_KIND.TASK]: 1,
  [CHANNEL_KIND.TOPIC]: 2,
  [CHANNEL_KIND.DM]: 3,
} as const satisfies Record<ChatChannel["kind"], number>;

/** An agent's line as chat names it by: a plan's summary's, and the automation whose run started it where a read of the agent says. */
export type ChatAgentLine = TaskAgentLine & { readonly automationName?: string };

/** What the window knows beside the chat that names its members: each agent's line, each plan's name, and the reader's own name. */
export interface ChatNames {
  readonly agents: ReadonlyMap<string, ChatAgentLine>;
  readonly tasks: ReadonlyMap<string, string>;
  /** The task each agent a plan's summary names works on, by the agent's id. */
  readonly agentTasks: ReadonlyMap<string, string>;
  readonly selfName: string | undefined;
}

/** The names a window knows: each agent's line from the plans' summaries and the lines a chat read carries, each plan's name, and the reader's own. */
export function chatNames(
  tasks: readonly TaskSummary[],
  agents: readonly ChatAgentLine[],
  selfName: string | undefined,
): ChatNames {
  const lines = [...tasks.flatMap((task) => task.agents?.agents ?? []), ...agents];
  return {
    agents: new Map(lines.map((line) => [line.id, line])),
    tasks: new Map(tasks.map((task) => [task.id, task.name])),
    agentTasks: new Map(
      tasks.flatMap((task) =>
        (task.agents?.agents ?? []).map((line) => [line.id, task.id] as const),
      ),
    ),
    selfName,
  };
}

/** A member as a line names it: what it is called, the agent's line where it is one, and the plan it stands for. */
export interface ChatWho {
  readonly member: ChatMember | undefined;
  readonly name: string;
  readonly agent: ChatAgentLine | undefined;
  readonly taskName: string | undefined;
}

/** One row of the rail: the channel, what it is called, and how many unread messages it holds. */
export interface ChatRailRow {
  readonly channel: ChatChannel;
  readonly label: string;
  /** The other member of a direct message, for its mark. */
  readonly other: ChatWho | undefined;
  /** Both members of a direct message between two others, by id, whose two faces its mark draws; empty for the reader's own and for a channel. */
  readonly between: readonly string[];
  readonly unread: number;
  /** How many open asks someone else posted in it wait on the reader, as For you lists them. */
  readonly asks: number;
  /** The newest root or reply the channel holds as read, which its row previews; none in an empty one. */
  readonly latest: ChatMessage | undefined;
}

export interface ChatRail {
  /** How many messages wait on the reader in For you. */
  readonly forYou: number;
  /** #general, then the topics standing. */
  readonly channels: readonly ChatRailRow[];
  /** The tasks' own channels, grouped as the reader's sidebar groups the tasks. */
  readonly tasks: readonly ChatRailGroup[];
  /** The channels archived: a task's that was archived with it, and a topic archived. */
  readonly archived: readonly ChatRailRow[];
  readonly direct: readonly ChatRailRow[];
}

/** A group of task channels in the rail: under the reader's pinned tasks, one of their sections, or the rest, and its rows in order. */
interface ChatRailGroup {
  /** The group's own key, which a list draws it under. */
  readonly key: string;
  /** What heads it, as the sidebar heads the same tasks. */
  readonly title: string;
  /** The section's icon, as the sidebar's section head wears it; none for Pinned, the rest, and a section made without one. */
  readonly icon: TaskSectionIcon | undefined;
  readonly rows: readonly ChatRailRow[];
}

/** How the reader's sidebar groups tasks: the tasks pinned, in their order, and the sections they keep, each with its tasks in order. */
export interface ChatTaskGrouping {
  readonly pinned: readonly string[];
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
    readonly icon: TaskSectionIcon | undefined;
    readonly taskIds: readonly string[];
  }[];
}

/** What a group of task channels is headed by, where the rail draws it. */
const TASK_GROUP = {
  PINNED: "Pinned",
  OTHER: "Tasks",
} as const;

/** The keys of the groups no section names. */
const TASK_GROUP_KEY = {
  PINNED: "pinned",
  OTHER: "other",
} as const;

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

/** What is read of a chat's roster alone: the reader, every member, and every channel. */
export type ChatRoster = Pick<ChatAnswer, "self" | "members" | "channels">;

/** The value kept for a key, made the first time it is asked for. */
function keptOn<Key extends object, Value>(
  cache: WeakMap<Key, Value>,
  key: Key,
  make: () => Value,
): Value {
  const held = cache.get(key);
  if (held !== undefined) return held;
  const made = make();
  cache.set(key, made);
  return made;
}

/** Each roster's members by id, kept on its members' array. */
const MEMBERS_BY_ID = new WeakMap<readonly ChatMember[], ReadonlyMap<string, ChatMember>>();

/** Each roster's channels by id, kept on its channels' array. */
const CHANNELS_BY_ID = new WeakMap<readonly ChatChannel[], ReadonlyMap<string, ChatChannel>>();

/** The members by id, the first of any id held twice, as a search of the list would find it. */
function membersById(members: readonly ChatMember[]): ReadonlyMap<string, ChatMember> {
  return keptOn(MEMBERS_BY_ID, members, () => firstById(members));
}

function channelsById(channels: readonly ChatChannel[]): ReadonlyMap<string, ChatChannel> {
  return keptOn(CHANNELS_BY_ID, channels, () => firstById(channels));
}

function firstById<Each extends { readonly id: string }>(
  list: readonly Each[],
): ReadonlyMap<string, Each> {
  const byId = new Map<string, Each>();
  for (const each of list) if (!byId.has(each.id)) byId.set(each.id, each);
  return byId;
}

/**
 * One answer read once: its members and channels by id, its messages in the
 * order posted, each channel's and each message's replies in theirs, how far
 * the reader has read each channel on its own cursor, and each channel's
 * unread count and newest message.
 */
export interface ChatIndex {
  readonly members: ReadonlyMap<string, ChatMember>;
  readonly channels: ReadonlyMap<string, ChatChannel>;
  /** Every message in the order posted. */
  readonly posted: readonly ChatMessage[];
  /** Each channel's messages in the order posted, by the channel's id; a channel holding none stands nowhere. */
  readonly messages: ReadonlyMap<string, readonly ChatMessage[]>;
  /** Each message's replies in the order posted, by the id of the message they reply to. */
  readonly replies: ReadonlyMap<string, readonly ChatMessage[]>;
  /** The reader's own cursor in each channel it read on its own, by the channel's id. */
  readonly reads: ReadonlyMap<string, number>;
  /** How many messages someone else posted or changed past the reader's cursor, by channel. */
  readonly unread: ReadonlyMap<string, number>;
  /** The newest message each channel holds, by the channel's id. */
  readonly latest: ReadonlyMap<string, ChatMessage>;
}

/** Each answer's index, kept on the answer, which is never written to. */
const INDEXES = new WeakMap<ChatAnswer, ChatIndex>();

/** Adds a message to the list held under a key, in the order given. */
function filed(lists: Map<string, ChatMessage[]>, key: string, message: ChatMessage): void {
  const list = lists.get(key);
  if (list === undefined) lists.set(key, [message]);
  else list.push(message);
}

function builtIndex(chat: ChatAnswer): ChatIndex {
  const reads = new Map<string, number>();
  for (const each of chat.reads ?? []) {
    if (!reads.has(each.channelId)) reads.set(each.channelId, each.readSeq);
  }
  const posted = chat.messages.toSorted(bySeq);
  const messages = new Map<string, ChatMessage[]>();
  const replies = new Map<string, ChatMessage[]>();
  const unread = new Map<string, number>();
  for (const message of posted) {
    filed(messages, message.channelId, message);
    if (message.parentId !== undefined) filed(replies, message.parentId, message);
    const read = Math.max(chat.readSeq, reads.get(message.channelId) ?? 0);
    if (message.touchedSeq > read && message.authorId !== chat.self) {
      unread.set(message.channelId, (unread.get(message.channelId) ?? 0) + 1);
    }
  }
  const latest = new Map<string, ChatMessage>();
  for (const [channelId, list] of messages) {
    const newest = list.at(-1);
    if (newest !== undefined) latest.set(channelId, newest);
  }
  return {
    members: membersById(chat.members),
    channels: channelsById(chat.channels),
    posted,
    messages,
    replies,
    reads,
    unread,
    latest,
  };
}

/**
 * The answer's index, built the first time it is read and kept on it, so
 * every read of one answer, the rail's, For you's, a channel's threads, and
 * the sidebar's count alike, walks its messages once between them.
 */
export function chatIndex(chat: ChatAnswer): ChatIndex {
  return keptOn(INDEXES, chat, () => builtIndex(chat));
}

/** How far the reader has read a channel: its own cursor there where it read further, else its cursor everywhere. */
function readSeqIn(chat: ChatAnswer, channelId: string): number {
  return Math.max(chat.readSeq, chatIndex(chat).reads.get(channelId) ?? 0);
}

/** Whether the reader has yet to read a message: posted or changed past its cursor in the message's channel by someone else, as the service counts it. */
function unreadBy(chat: ChatAnswer, message: ChatMessage): boolean {
  return message.touchedSeq > readSeqIn(chat, message.channelId) && message.authorId !== chat.self;
}

/** The member of a direct message who is not the reader, by id; none for a channel. */
function otherOf(chat: Pick<ChatAnswer, "self">, channel: ChatChannel): string | undefined {
  if (channel.kind !== CHANNEL_KIND.DM) return undefined;
  return channel.members?.find((id) => id !== chat.self) ?? channel.members?.[0];
}

/** A catalog id's own name past its provider: lower-case words, digits, and dots, joined by dashes. */
const CATALOG_MODEL_NAME = /^[a-z0-9.]+(?:-[a-z0-9.]+)*$/u;

/** Whether a name is a model's catalog id: a provider the catalog lists, its separator, and a model's own name. */
function isCatalogId(name: string): boolean {
  const [provider, model, ...rest] = name.split(CATALOG_ID_SEPARATOR);
  return (
    rest.length === 0 &&
    model !== undefined &&
    Object.values<string>(MODEL_PROVIDER).includes(provider ?? "") &&
    CATALOG_MODEL_NAME.test(model)
  );
}

/**
 * What an agent member is called where the window holds no line of it: the
 * name the chat read carries, which is its model's catalog id until it has a
 * title, so an id is named as a tab names its model (`modelLabel`), and any
 * other name, a title holding a slash among them, as it was written.
 */
function agentMemberName(name: string | undefined): string {
  if (name === undefined) return CHAT_MEMBER_LABEL.FORMER_AGENT;
  return isCatalogId(name) ? modelLabel(name) : name;
}

/**
 * A member by its id, the way every line names it: an agent as every place
 * of the window names it (`agentTabLabel`), its title,
 * else its model's name, a person by their account's name, the reader by
 * their own.
 */
export function chatWho(
  chat: Pick<ChatAnswer, "self" | "members">,
  names: ChatNames,
  memberId: string,
): ChatWho {
  const member = membersById(chat.members).get(memberId);
  const agent = member?.agentId === undefined ? undefined : names.agents.get(member.agentId);
  const taskName = member?.planId === undefined ? undefined : names.tasks.get(member.planId);
  const name =
    member?.kind === MEMBER_KIND.AGENT
      ? agent === undefined
        ? agentMemberName(member.name)
        : agentTabLabel(agent)
      : memberId === chat.self && names.selfName !== undefined
        ? names.selfName
        : (member?.name ?? CHAT_MEMBER_LABEL.FORMER_PERSON);
  return { member, name, agent, taskName };
}

/** Whether the reader is one of a direct message's two; a channel holds no such pair. */
function inDm(chat: Pick<ChatAnswer, "self">, channel: ChatChannel): boolean {
  return channel.members?.includes(chat.self) ?? false;
}

/**
 * Whether the reader may post in a channel: one standing, and a direct
 * message only where they are one of its two, as the service holds them
 * to. Note that a reader shown a direct message between two others has
 * no box to write in it, since a post there would open their own with
 * one of the two instead.
 */
export function postsIn(chat: Pick<ChatAnswer, "self">, channel: ChatChannel): boolean {
  if (channel.archived) return false;
  return channel.kind !== CHANNEL_KIND.DM || inDm(chat, channel);
}

/** What a channel is called: a channel's own name, a direct message's other member's name, or both of its two's where the reader is neither. */
export function channelLabel(
  chat: Pick<ChatAnswer, "self" | "members">,
  names: ChatNames,
  channel: ChatChannel,
): string {
  if (channel.kind === CHANNEL_KIND.DM && !inDm(chat, channel)) {
    return (channel.members ?? []).map((id) => chatWho(chat, names, id).name).join(" ↔ ");
  }
  const other = otherOf(chat, channel);
  if (other !== undefined) return chatWho(chat, names, other).name;
  return (
    channel.name ?? (channel.planId === undefined ? "" : names.tasks.get(channel.planId)) ?? ""
  );
}

/** Every message of a channel's in the order posted. */
function messagesIn(chat: ChatAnswer, channelId: string): readonly ChatMessage[] {
  return chatIndex(chat).messages.get(channelId) ?? [];
}

/**
 * The task channels grouped as the sidebar groups their tasks: the pinned
 * first, in the pins' order, then each section in its order, then the rest
 * by name under Tasks, as the sidebar names the tasks no section holds. A
 * task stands in its first group only. Note
 * that the order within a group is the sidebar's own, so a task is found
 * where the reader keeps it.
 */
function taskGroups(
  rows: readonly ChatRailRow[],
  grouping: ChatTaskGrouping | undefined,
): readonly ChatRailGroup[] {
  const byTask = new Map(
    rows.flatMap((row) =>
      row.channel.planId === undefined ? [] : [[row.channel.planId, row] as const],
    ),
  );
  const placed = new Set<string>();
  const take = (taskIds: readonly string[]) =>
    taskIds.flatMap((taskId) => {
      const row = byTask.get(taskId);
      if (row === undefined || placed.has(taskId)) return [];
      placed.add(taskId);
      return [row];
    });
  const groups: ChatRailGroup[] = [];
  const pinned = take(grouping?.pinned ?? []);
  if (pinned.length > 0)
    groups.push({
      key: TASK_GROUP_KEY.PINNED,
      title: TASK_GROUP.PINNED,
      icon: undefined,
      rows: pinned,
    });
  for (const section of grouping?.sections ?? []) {
    const held = take(section.taskIds);
    if (held.length > 0) {
      groups.push({ key: section.id, title: section.title, icon: section.icon, rows: held });
    }
  }
  const rest = rows.filter(
    (row) => row.channel.planId === undefined || !placed.has(row.channel.planId),
  );
  if (rest.length > 0) {
    groups.push({
      key: TASK_GROUP_KEY.OTHER,
      title: TASK_GROUP.OTHER,
      icon: undefined,
      rows: rest,
    });
  }
  return groups;
}

/**
 * The rail: For you's count, the channels in their order, and the direct
 * messages, the latest spoken in first. Note that each channel's name and
 * newest message are read once before the sort, never inside its
 * comparisons, which run some thousands of times over a workspace's.
 */
export function chatRail(
  chat: ChatAnswer,
  names: ChatNames,
  grouping?: ChatTaskGrouping | undefined,
): ChatRail {
  const index = chatIndex(chat);
  const waiting = forYou(chat);
  const asks = new Map<string, number>();
  for (const entry of waiting) {
    if (entry.reason === FOR_YOU_REASON.ASK) {
      asks.set(entry.channel.id, (asks.get(entry.channel.id) ?? 0) + 1);
    }
  }
  const labels = new Map(
    chat.channels.map((channel) => [channel, channelLabel(chat, names, channel)] as const),
  );
  const labelOf = (channel: ChatChannel) => labels.get(channel) ?? "";
  const row = (channel: ChatChannel): ChatRailRow => {
    const other = otherOf(chat, channel);
    const who = other === undefined ? undefined : chatWho(chat, names, other);
    return {
      channel,
      label: labelOf(channel),
      other: who,
      between:
        channel.kind === CHANNEL_KIND.DM && !inDm(chat, channel) ? (channel.members ?? []) : [],
      unread: index.unread.get(channel.id) ?? 0,
      asks: asks.get(channel.id) ?? 0,
      latest: index.latest.get(channel.id),
    };
  };
  const shown = chat.channels.filter((channel) => !channel.archived);
  const latest = (channel: ChatChannel) => index.latest.get(channel.id)?.seq ?? 0;
  const byName = (one: ChatChannel, other: ChatChannel) =>
    CHANNEL_ORDER[one.kind] - CHANNEL_ORDER[other.kind] ||
    labelOf(one).localeCompare(labelOf(other));
  const channels = shown
    .filter(
      (channel) => channel.kind === CHANNEL_KIND.GENERAL || channel.kind === CHANNEL_KIND.TOPIC,
    )
    .toSorted(byName);
  const tasks = shown.filter((channel) => channel.kind === CHANNEL_KIND.TASK).toSorted(byName);
  // Note that an archived DM has no place to come back from, so the archive holds channels alone.
  const archived = chat.channels
    .filter((channel) => channel.archived && channel.kind !== CHANNEL_KIND.DM)
    .toSorted(byName);
  const direct = shown
    .filter((channel) => channel.kind === CHANNEL_KIND.DM)
    .toSorted((one, other) => latest(other) - latest(one));
  return {
    forYou: waiting.length,
    channels: channels.map(row),
    tasks: taskGroups(tasks.map(row), grouping),
    archived: archived.map(row),
    direct: direct.map(row),
  };
}

/** Each answer's threads, by channel, kept on the answer. */
const THREADS = new WeakMap<ChatAnswer, Map<string, readonly ChatThread[]>>();

/**
 * A channel's messages as threads: each root in the order posted, its
 * replies under it in theirs. A reply whose root is not among the messages
 * read stands as a root of its own, so nothing read goes undrawn.
 */
export function channelThreads(chat: ChatAnswer, channelId: string): readonly ChatThread[] {
  const threads = keptOn(THREADS, chat, () => new Map<string, readonly ChatThread[]>());
  const held = threads.get(channelId);
  if (held !== undefined) return held;
  const index = chatIndex(chat);
  const messages = messagesIn(chat, channelId);
  const ids = new Set(messages.map((message) => message.id));
  const rooted = (message: ChatMessage) =>
    message.parentId !== undefined && ids.has(message.parentId);
  const made = messages
    .filter((message) => !rooted(message))
    .map((message) => ({
      message,
      replies: (index.replies.get(message.id) ?? []).filter(
        (reply) => reply.channelId === channelId,
      ),
    }));
  threads.set(channelId, made);
  return made;
}

/** How long after a message its author's next one still reads as the same run, drawn under one name as Slack draws it. */
export const CHAT_RUN_SPAN = 5 * 60 * 1000;

/**
 * Whether a root continues the run the one before it began: the same
 * author, within `CHAT_RUN_SPAN` of it, and the one before holding no
 * replies, since its thread stands between them. A continued root draws
 * without its author's face and name, as Slack's grouped messages do.
 */
export function continuesRun(before: ChatThread | undefined, thread: ChatThread): boolean {
  if (before === undefined || before.replies.length > 0) return false;
  const gap = thread.message.postedAt - before.message.postedAt;
  return before.message.authorId === thread.message.authorId && gap >= 0 && gap <= CHAT_RUN_SPAN;
}

/**
 * The seq of the first root in a channel someone else posted past the
 * reader's cursor there, where its "New" line stands as the channel opens;
 * nothing where none is. Note that a root is counted by when it was posted,
 * not when it last changed, so an old message edited or answered since
 * never reads as new, and that a reply, drawn folded under its root, is
 * never where the line stands.
 */
export function firstUnreadSeq(chat: ChatAnswer, channelId: string): number | undefined {
  const read = readSeqIn(chat, channelId);
  return channelThreads(chat, channelId).find(
    ({ message }) => message.seq > read && message.authorId !== chat.self,
  )?.message.seq;
}

/** One block as a paragraph of the Markdown a message's Copy takes; nothing for a picture, which has no address a reader can open, or a block this build does not know. */
function blockMarkdown(block: ChatReadBlock): string | undefined {
  if (!knownBlock(block)) return undefined;
  switch (block.type) {
    case CHAT_BLOCK.MARKDOWN:
      return block.text;
    case CHAT_BLOCK.LINK: {
      // Its label's brackets and its address's parentheses escaped, so the link reads back as written.
      const label = block.label.replace(/[\\[\]]/gu, (mark) => `\\${mark}`);
      return `[${label}](${block.url.replaceAll("(", "%28").replaceAll(")", "%29")})`;
    }
    case CHAT_BLOCK.CODE: {
      const path = block.path.split("/").map(encodeURIComponent).join("/");
      const lines =
        block.endLine > block.startLine
          ? `#L${block.startLine}-L${block.endLine}`
          : `#L${block.startLine}`;
      return `https://github.com/${block.repo}/blob/${block.sha}/${path}${lines}`;
    }
    case CHAT_BLOCK.IMAGE:
      return undefined;
  }
}

/** A message's words as the Markdown its Copy takes: each block a paragraph of its own, in order, a code block by its lines' GitHub address. */
export function messageMarkdown(message: ChatMessage): string {
  return message.blocks
    .flatMap((block) => blockMarkdown(block) ?? [])
    .filter((paragraph) => paragraph !== "")
    .join("\n\n");
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
/** Each answer's For you, kept on the answer, which the rail, the sidebar's count, and the pane all read. */
const FOR_YOU_ENTRIES = new WeakMap<ChatAnswer, readonly ForYouEntry[]>();

export function forYou(chat: ChatAnswer): readonly ForYouEntry[] {
  return keptOn(FOR_YOU_ENTRIES, chat, () => {
    const index = chatIndex(chat);
    const entries = index.posted.flatMap((message): ForYouEntry[] => {
      const channel = index.channels.get(message.channelId);
      // Note that nothing waits on the reader where they cannot answer it: an archived channel, or a direct message between two others.
      if (channel === undefined || !postsIn(chat, channel)) return [];
      const reason = waitingReason(chat, message, channel);
      if (reason === undefined) return [];
      const replies = index.replies.get(message.id) ?? [];
      return [{ reason, channel, message, replies }];
    });
    return [
      ...entries.filter((entry) => entry.reason === FOR_YOU_REASON.ASK),
      ...entries.filter((entry) => entry.reason !== FOR_YOU_REASON.ASK),
    ];
  });
}

/** The channel a place shows, or none for For you or a channel the chat no longer holds. */
export function placeChannel(
  chat: Pick<ChatAnswer, "channels">,
  place: ChatPlace,
): ChatChannel | undefined {
  if (place.kind !== CHAT_PLACE.CHANNEL) return undefined;
  return channelsById(chat.channels).get(place.channelId);
}

/** Whether a mention names the member: a person by their account, an agent by its id. */
function namesMember(mention: ChatMemberMention, member: ChatMember): boolean {
  return mention.kind === MENTION_KIND.PERSON
    ? member.kind === MEMBER_KIND.HUMAN && member.userId === mention.userId
    : member.agentId === mention.agentId;
}

/**
 * Whether a post in the channel reaches the member, as the service holds
 * the chat to its tasks (`chat-store.ts`): a person in any channel; a
 * task's agents in that task's own channel alone, and an
 * agent on no task in the general channel; and in a DM, its own two. A
 * member a post cannot reach hears nothing of it, so naming them there
 * names no one.
 */
export function reachedIn(member: ChatMember, channel: ChatChannel): boolean {
  if (channel.kind === CHANNEL_KIND.DM) return channel.members?.includes(member.id) ?? false;
  if (member.kind === MEMBER_KIND.HUMAN) return true;
  if (channel.kind === CHANNEL_KIND.TASK) {
    return member.planId !== undefined && member.planId === channel.planId;
  }
  return (
    channel.kind === CHANNEL_KIND.GENERAL &&
    member.kind === MEMBER_KIND.AGENT &&
    member.planId === undefined
  );
}

/** The members a post in the channel reaches but the reader, each still here. */
function toldIn(
  chat: Pick<ChatAnswer, "self" | "members">,
  channel: ChatChannel | undefined,
): readonly ChatMember[] {
  return chat.members
    .filter((member) => !member.left && member.id !== chat.self)
    .filter((member) => channel === undefined || reachedIn(member, channel));
}

/** A person a chat message may name: their member, their account, and their name. */
interface ChatMentionablePerson {
  readonly memberId: string;
  readonly userId: string;
  readonly name: string;
}

/** An agent a chat message may name: its member, its id, its name, and the task it works on, which tells it apart from another of its name. */
interface ChatMentionableAgent {
  readonly memberId: string;
  readonly agentId: string;
  readonly name: string;
  readonly task?: { readonly id: string; readonly name: string | undefined } | undefined;
}

/** A channel a chat message's `#` may name: its name, the task whose channel it is, and that task's name. */
interface ChatMentionableChannel {
  readonly name: string;
  readonly taskId: string | undefined;
  readonly detail: string | undefined;
}

/** What a chat message's `@` and `#` offer: the people and the agents a mention tells, and the channels. */
export interface ChatMentionables {
  readonly people: readonly ChatMentionablePerson[];
  readonly agents: readonly ChatMentionableAgent[];
  readonly channels: readonly ChatMentionableChannel[];
}

/** What each roster offers, by the names it is read with and the channel posted in, kept on the roster. */
const MENTIONABLES = new WeakMap<
  ChatRoster,
  WeakMap<ChatNames, Map<ChatChannel | undefined, ChatMentionables>>
>();

/**
 * What the composer offers to name: every member who has not left but the
 * reader, a person by their account and an agent by its id, each by name,
 * and every channel standing that is not a DM. Where the composer posts in
 * a channel, only the members a post there reaches are offered
 * (`reachedIn`), so an agent is never named where it cannot hear it.
 */
export function chatMentionables(
  chat: ChatRoster,
  names: ChatNames,
  channel?: ChatChannel,
): ChatMentionables {
  const byNames = keptOn(MENTIONABLES, chat, () => new WeakMap());
  const byChannel = keptOn(byNames, names, () => new Map());
  const held = byChannel.get(channel);
  if (held !== undefined) return held;
  const made = mentionablesIn(chat, names, channel);
  byChannel.set(channel, made);
  return made;
}

function mentionablesIn(
  chat: ChatRoster,
  names: ChatNames,
  channel: ChatChannel | undefined,
): ChatMentionables {
  const told = toldIn(chat, channel);
  const people = told.flatMap((member): readonly ChatMentionablePerson[] =>
    member.kind === MEMBER_KIND.HUMAN && member.userId !== undefined
      ? [{ memberId: member.id, userId: member.userId, name: chatWho(chat, names, member.id).name }]
      : [],
  );
  const agents = told.flatMap((member): readonly ChatMentionableAgent[] => {
    if (member.kind !== MEMBER_KIND.AGENT || member.agentId === undefined) return [];
    const who = chatWho(chat, names, member.id);
    const task =
      member.planId === undefined ? undefined : { id: member.planId, name: who.taskName };
    return [{ memberId: member.id, agentId: member.agentId, name: who.name, task }];
  });
  const channels = chat.channels
    .filter((each) => !each.archived && each.kind !== CHANNEL_KIND.DM)
    .map(
      (each): ChatMentionableChannel => ({
        name: channelLabel(chat, names, each),
        taskId: each.planId,
        detail: each.planId === undefined ? undefined : names.tasks.get(each.planId),
      }),
    );
  return { people, agents, channels };
}

/**
 * Whether a post of the words in the channel would address more members
 * than a post tells: each member a post there reaches that the words
 * mention, then, for a reply, the thread's root author and its repliers,
 * each counted once and the reader not at all. A post tells the first
 * `MAX_STEERS_PER_POST` of them and no more (`chat-notify.ts`); a direct
 * message tells its other member alone, whatever it mentions.
 */
export function toldPastBound(
  chat: Pick<ChatAnswer, "self" | "members">,
  channel: ChatChannel,
  text: string,
  thread: readonly string[] = [],
): boolean {
  if (channel.kind === CHANNEL_KIND.DM) return false;
  const reached = toldIn(chat, channel);
  const named = chatMentionsIn(text).members.flatMap(({ mention }) =>
    reached.filter((member) => namesMember(mention, member)).map((member) => member.id),
  );
  const addressed = new Set([...named, ...thread].filter((id) => id !== chat.self));
  return addressed.size > CHAT_BOUNDS.MAX_STEERS_PER_POST;
}

/** What the wire refuses in a dictation's word: a line break, or an angle bracket. */
const REFUSED_KEYWORD = /[<>\r\n]/u;

/** What each roster listens for, by the names it is read with, kept on the roster. */
const KEYWORDS = new WeakMap<ChatRoster, WeakMap<ChatNames, readonly string[]>>();

/**
 * The words a dictation in the chat is likely to say, which tell the
 * transcription model how to spell them: the name of every person and
 * agent still here, each agent's title, and every standing channel's name, each once
 * and within the wire's bounds, as `dictation-keywords.ts` holds a task's.
 */
export function chatKeywords(chat: ChatRoster, names: ChatNames): readonly string[] {
  return keptOn(
    keptOn(KEYWORDS, chat, () => new WeakMap()),
    names,
    () => keywordsOf(chat, names),
  );
}

function keywordsOf(chat: ChatRoster, names: ChatNames): readonly string[] {
  const here = chat.members.filter((member) => !member.left);
  const named = [
    ...here.map((member) => member.name ?? ""),
    ...here.map((member) =>
      member.agentId === undefined ? "" : (names.agents.get(member.agentId)?.title ?? ""),
    ),
    ...chat.channels
      .filter((channel) => channel.kind !== CHANNEL_KIND.DM && !channel.archived)
      .map((channel) => channelLabel(chat, names, channel)),
  ];
  const kept = new Set<string>();
  for (const word of named) {
    const trimmed = word.trim();
    if (trimmed === "" || trimmed.length > DICTATION_BOUNDS.MAX_KEYWORD_CHARS) continue;
    if (REFUSED_KEYWORD.test(trimmed)) continue;
    kept.add(trimmed);
    if (kept.size === DICTATION_BOUNDS.MAX_KEYWORDS) break;
  }
  return [...kept];
}

/** The characters a channel's name is spelled in, its first a letter or a digit (`chatChannelNameSchema`). */
const CHANNEL_NAME = /^[a-z0-9][a-z0-9._-]*$/u;

/** The most characters a channel's name may spell (`CHAT_BOUNDS.MAX_KEY_CHARS`). */
const MAX_CHANNEL_NAME_CHARS = CHAT_BOUNDS.MAX_KEY_CHARS;

/** What a channel's name as typed is written as: lower case, each run of spaces a hyphen, nothing around it. */
export function topicName(words: string): string {
  return words.trim().toLowerCase().replace(/\s+/gu, "-");
}

/** Why a name a person typed cannot be a topic channel's, the channel being renamed aside; nothing where it can. */
export function topicNameProblem(
  chat: ChatAnswer,
  name: string,
  renaming: string | undefined,
): string | undefined {
  if (name === "") return "Name the channel.";
  if (name.length > MAX_CHANNEL_NAME_CHARS) {
    return `A channel's name is at most ${MAX_CHANNEL_NAME_CHARS} characters.`;
  }
  if (!CHANNEL_NAME.test(name)) {
    return "Use lowercase letters, numbers, dots, dashes, and underscores, starting with a letter or a number.";
  }
  const taken =
    name === GENERAL_CHANNEL ||
    chat.channels.some((channel) => channel.name === name && channel.id !== renaming);
  return taken ? `#${name} is already a channel.` : undefined;
}
