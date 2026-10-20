import type { ChatMemberMention } from "@luke/features/chat-mentions";
import {
  ASK_STATUS,
  CHANNEL_KIND,
  CHAT_BOUNDS,
  CHAT_TARGET_SIGIL,
  type ChatAnswer,
  type ChatChannel,
  type ChatEditRequest,
  type ChatMember,
  type ChatMessage,
  type ChatOpenRequest,
  type ChatPostRequest,
  type ChatReply,
  GENERAL_CHANNEL,
  MEMBER_KIND,
} from "@luke/features/chat-wire";
import { DICTATION_BOUNDS } from "@luke/features/dictation-wire";
import {
  encodeMention,
  MENTION_KIND,
  type MentionPlace,
  mentionMarkdown,
} from "@luke/features/mention-link";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import type { ChatTarget } from "./chat-mention.js";

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

/** What Luke is called wherever a task's Luke speaks. */
const LUKE_NAME = "Luke";

/** What a member is called whose account, or whose agent, is gone, so nothing names them any more. */
const FORMER_NAME = {
  PERSON: "Former member",
  AGENT: "Former agent",
} as const;

/** The order the rail lists channels in, by kind: `#general`, the plans', then the topics. */
const CHANNEL_ORDER = {
  [CHANNEL_KIND.GENERAL]: 0,
  [CHANNEL_KIND.TASK]: 1,
  [CHANNEL_KIND.TOPIC]: 2,
  [CHANNEL_KIND.DM]: 3,
} as const satisfies Record<ChatChannel["kind"], number>;

/** What the window knows beside the chat that names its members: each agent's line, each plan's name, and the reader's own name. */
export interface ChatNames {
  readonly agents: ReadonlyMap<string, TaskAgentLine>;
  readonly tasks: ReadonlyMap<string, string>;
  /** The task each agent a plan's summary names works on, by the agent's id. */
  readonly agentTasks: ReadonlyMap<string, string>;
  readonly selfName: string | undefined;
}

/** The names a window knows: each agent's line from the plans' summaries and the lines a chat read carries, each plan's name, and the reader's own. */
export function chatNames(
  tasks: readonly TaskSummary[],
  agents: readonly TaskAgentLine[],
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
  readonly agent: TaskAgentLine | undefined;
  readonly taskName: string | undefined;
}

/** One row of the rail: the channel, what it is called, and how many unread messages it holds. */
export interface ChatRailRow {
  readonly channel: ChatChannel;
  readonly label: string;
  /** The other member of a direct message, for its mark. */
  readonly other: ChatWho | undefined;
  readonly unread: number;
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

/** A group of task channels in the rail: under the reader's pinned tasks, one of their sections, or none, and its rows in order. */
interface ChatRailGroup {
  /** The group's own key, which a list draws it under. */
  readonly key: string;
  /** What heads it; none for the tasks no pin or section holds where nothing else is grouped. */
  readonly title: string | undefined;
  readonly rows: readonly ChatRailRow[];
}

/** How the reader's sidebar groups tasks: the tasks pinned, in their order, and the sections they keep, each with its tasks in order. */
export interface ChatTaskGrouping {
  readonly pinned: readonly string[];
  readonly sections: readonly {
    readonly id: string;
    readonly title: string;
    readonly taskIds: readonly string[];
  }[];
}

/** What a group of task channels is headed by, where the rail draws it. */
const TASK_GROUP = {
  PINNED: "Pinned",
  OTHER: "Other tasks",
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

/** How far the reader has read a channel: its own cursor there where it read further, else its cursor everywhere. */
function readSeqIn(chat: ChatAnswer, channelId: string): number {
  const own = chat.reads?.find((each) => each.channelId === channelId)?.readSeq ?? 0;
  return Math.max(chat.readSeq, own);
}

/** Whether the reader has yet to read a message: posted or changed past its cursor in the message's channel by someone else, as the service counts it. */
function unreadBy(chat: ChatAnswer, message: ChatMessage): boolean {
  return message.touchedSeq > readSeqIn(chat, message.channelId) && message.authorId !== chat.self;
}

/** The member of a direct message who is not the reader, by id; none for a channel. */
function otherOf(chat: ChatAnswer, channel: ChatChannel): string | undefined {
  if (channel.kind !== CHANNEL_KIND.DM) return undefined;
  return channel.members?.find((id) => id !== chat.self) ?? channel.members?.[0];
}

/** A member by its id, the way every line names it: an agent by its title, a task's Luke as Luke, a person by their account's name, the reader by their own. */
export function chatWho(chat: ChatAnswer, names: ChatNames, memberId: string): ChatWho {
  const member = chat.members.find((each) => each.id === memberId);
  const agent = member?.agentId === undefined ? undefined : names.agents.get(member.agentId);
  const taskName = member?.planId === undefined ? undefined : names.tasks.get(member.planId);
  const name =
    member?.kind === MEMBER_KIND.LUKE
      ? LUKE_NAME
      : member?.kind === MEMBER_KIND.AGENT
        ? (agent?.title ?? member.name ?? FORMER_NAME.AGENT)
        : memberId === chat.self && names.selfName !== undefined
          ? names.selfName
          : (member?.name ?? FORMER_NAME.PERSON);
  return { member, name, agent, taskName };
}

/** Whether the reader is one of a direct message's two; a channel holds no such pair. */
function inDm(chat: ChatAnswer, channel: ChatChannel): boolean {
  return channel.members?.includes(chat.self) ?? false;
}

/**
 * Whether the reader may post in a channel: one standing, and a direct
 * message only where they are one of its two, as the service holds them
 * to. Note that a reader shown a direct message between two others has
 * no box to write in it, since a post there would open their own with
 * one of the two instead.
 */
export function postsIn(chat: ChatAnswer, channel: ChatChannel): boolean {
  if (channel.archived) return false;
  return channel.kind !== CHANNEL_KIND.DM || inDm(chat, channel);
}

/** What a channel is called: a channel's own name, a direct message's other member's name, or both of its two's where the reader is neither. */
export function channelLabel(chat: ChatAnswer, names: ChatNames, channel: ChatChannel): string {
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
  return chat.messages.filter((message) => message.channelId === channelId).toSorted(bySeq);
}

/** The rail: For you's count, the channels in their order, and the direct messages, the latest spoken in first. */
/**
 * The task channels grouped as the sidebar groups their tasks: the pinned
 * first, in the pins' order, then each section in its order, then the rest
 * by name, under Other tasks where any group stands above them and headed
 * by nothing where none does. A task stands in its first group only. Note
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
    groups.push({ key: TASK_GROUP_KEY.PINNED, title: TASK_GROUP.PINNED, rows: pinned });
  for (const section of grouping?.sections ?? []) {
    const held = take(section.taskIds);
    if (held.length > 0) groups.push({ key: section.id, title: section.title, rows: held });
  }
  const rest = rows.filter(
    (row) => row.channel.planId === undefined || !placed.has(row.channel.planId),
  );
  if (rest.length > 0) {
    groups.push({
      key: TASK_GROUP_KEY.OTHER,
      title: groups.length === 0 ? undefined : TASK_GROUP.OTHER,
      rows: rest,
    });
  }
  return groups;
}

export function chatRail(
  chat: ChatAnswer,
  names: ChatNames,
  grouping?: ChatTaskGrouping | undefined,
): ChatRail {
  const row = (channel: ChatChannel): ChatRailRow => {
    const other = otherOf(chat, channel);
    const who = other === undefined ? undefined : chatWho(chat, names, other);
    return {
      channel,
      label: channelLabel(chat, names, channel),
      other: who,
      unread: messagesIn(chat, channel.id).filter((message) => unreadBy(chat, message)).length,
      latest: messagesIn(chat, channel.id).at(-1),
    };
  };
  const shown = chat.channels.filter((channel) => !channel.archived);
  const latest = (channel: ChatChannel) => messagesIn(chat, channel.id).at(-1)?.seq ?? 0;
  const byName = (one: ChatChannel, other: ChatChannel) =>
    CHANNEL_ORDER[one.kind] - CHANNEL_ORDER[other.kind] ||
    channelLabel(chat, names, one).localeCompare(channelLabel(chat, names, other));
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
    forYou: forYou(chat).length,
    channels: channels.map(row),
    tasks: taskGroups(tasks.map(row), grouping),
    archived: archived.map(row),
    direct: direct.map(row),
  };
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
    // Note that nothing waits on the reader where they cannot answer it: an archived channel, or a direct message between two others.
    if (channel === undefined || !postsIn(chat, channel)) return [];
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

/** The mention a chip writes a member as: a person by their account, an agent by its id, and a Luke by his task; none for a member whose account, agent, or task is gone. */
function mentionOf(member: ChatMember): ChatMemberMention | undefined {
  if (member.kind === MEMBER_KIND.HUMAN && member.userId !== undefined) {
    return { kind: MENTION_KIND.PERSON, userId: member.userId };
  }
  if (member.kind === MEMBER_KIND.LUKE && member.planId !== undefined) {
    return { kind: MENTION_KIND.LUKE, taskId: member.planId };
  }
  if (member.kind === MEMBER_KIND.AGENT && member.agentId !== undefined) {
    // An agent on a task is linked under it, so its chip opens the task's tab for it rather than the agent alone.
    return member.planId === undefined
      ? { kind: MENTION_KIND.AGENT, agentId: member.agentId }
      : { kind: MENTION_KIND.AGENT, taskId: member.planId, agentId: member.agentId };
  }
  return undefined;
}

/**
 * What the composer offers to name: every member who has not left but the
 * reader, by name, each with the link a chip writes them as in the
 * workspace's place, and every channel standing that is not a DM. Note that
 * a member is offered only where that place is known, since a member is
 * written as their link and nothing else.
 */
export function chatTargets(
  chat: ChatAnswer,
  names: ChatNames,
  place: MentionPlace | undefined,
): readonly ChatTarget[] {
  const members = chat.members
    .filter((member) => !member.left && member.id !== chat.self)
    .flatMap((member): readonly ChatTarget[] => {
      const mention = mentionOf(member);
      if (mention === undefined || place === undefined) return [];
      const who = chatWho(chat, names, member.id);
      return [
        {
          sigil: CHAT_TARGET_SIGIL.MEMBER,
          name: who.name,
          // An agent or a Luke is told apart from another of its name by the task it works on.
          detail: member.kind === MEMBER_KIND.HUMAN ? undefined : who.taskName,
          mention,
          link: encodeMention(mention, place),
          markdown: mentionMarkdown(mention, who.name, place),
        },
      ];
    });
  const channels = chat.channels
    .filter((channel) => !channel.archived && channel.kind !== CHANNEL_KIND.DM)
    .map(
      (channel): ChatTarget => ({
        sigil: CHAT_TARGET_SIGIL.CHANNEL,
        name: channelLabel(chat, names, channel),
        detail: channel.planId === undefined ? undefined : names.tasks.get(channel.planId),
      }),
    );
  return [...members, ...channels];
}

/** What the wire refuses in a dictation's word: a line break, or an angle bracket. */
const REFUSED_KEYWORD = /[<>\r\n]/u;

/**
 * The words a dictation in the chat is likely to say, which tell the
 * transcription model how to spell them: the name of every person and
 * agent still here, each agent's title, and every standing channel's name, each once
 * and within the wire's bounds, as `dictation-keywords.ts` holds a task's.
 */
export function chatKeywords(chat: ChatAnswer, names: ChatNames): readonly string[] {
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
