import type { Channel, ChannelThread } from "@luke/features/channel-wire";
import {
  type InboxItem,
  type InboxMessage,
  inboxAsksOpen,
  inboxWaitsOn,
  threadNeedsReader,
} from "@luke/features/inbox-wire";

/**
 * channels-model.ts -- a workspace's channels as the sidebar lists them and one channel's threads as its stream draws them (STAG-547).
 *
 * A channel is a topic its workspace's threads live in, each thread an Inbox
 * item (`channel-wire.ts`). The sidebar lists the standing channels and then
 * the projects', each counting the open asks that wait on the reader. A
 * channel's stream is its threads oldest first, a divider before each day,
 * and the New line before the first thread someone else posted since the
 * reader last looked. The reader views it three ways, Mine by default: Mine,
 * the threads of their own tasks, those asking them, and those they wrote
 * in; Everyone, every thread; and Needs me, the open asks addressed to them
 * alone. A thread needs the reader while its ask stands open and it waits
 * on them, which the stream marks on the attention tint and nothing else. A
 * channel reads as unread while something was posted in it since the
 * reader last looked, which its row says in the unread weight.
 */

/** The channel every thread that names none goes to, which is never renamed or archived; the service mints it under this name (`GENERAL_CHANNEL`). */
const GENERAL_CHANNEL_NAME = "general";

/** Which of a channel's threads the stream shows. */
export const CHANNEL_VIEW = {
  MINE: "mine",
  EVERYONE: "everyone",
  NEEDS_ME: "needs-me",
} as const;

export type ChannelView = (typeof CHANNEL_VIEW)[keyof typeof CHANNEL_VIEW];

/** Each view as its menu and the channel's title name it, in the menu's order. */
const CHANNEL_VIEW_WORDS = {
  [CHANNEL_VIEW.MINE]: "Mine",
  [CHANNEL_VIEW.EVERYONE]: "Everyone",
  [CHANNEL_VIEW.NEEDS_ME]: "Needs me",
} as const satisfies Record<ChannelView, string>;

/** What a row of the stream is: a day's divider, the New line, or a thread. */
export const STREAM_ROW = {
  DAY: "day",
  NEW: "new",
  THREAD: "thread",
} as const;

export type StreamRow =
  | { readonly kind: typeof STREAM_ROW.DAY; readonly key: string; readonly words: string }
  | { readonly kind: typeof STREAM_ROW.NEW }
  | { readonly kind: typeof STREAM_ROW.THREAD; readonly thread: ChannelThread };

/** A workspace's channels as the sidebar sections them: the standing ones, then the projects'. */
export interface ChannelSections {
  readonly standing: readonly Channel[];
  readonly projects: readonly Channel[];
}

/**
 * The sidebar's sections of channels, and a phone's list's, in their order:
 * what each is called, whether it holds the projects', what its "+" makes,
 * and how wide each of its rows' names stands while the channels are read,
 * a few rows' worth, since nobody knows how many there are yet.
 */
export const CHANNEL_SECTIONS = [
  { label: "Channels", project: false, add: "New channel", reading: ["56%", "72%", "44%"] },
  { label: "Projects", project: true, add: "New project channel", reading: ["64%"] },
] as const;

export type ChannelSectionLook = (typeof CHANNEL_SECTIONS)[number];

/** The replies line under a post: who replied, how many replies, and who the open ask waits on. */
export interface RepliesLine {
  /** One message for each person who replied, the agent counted once, in the order they first replied. */
  readonly repliers: readonly InboxMessage[];
  /** "N replies", or "Reply in thread" where nobody has. */
  readonly words: string;
  /** "Waiting on you" or "Waiting on <name>" while an ask stands open; none otherwise. */
  readonly waiting: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day a time falls on, in the reader's own time zone. */
function dayStart(at: number): number {
  return new Date(at).setHours(0, 0, 0, 0);
}

/** A day's divider's words: Today, Yesterday, or the weekday and date. */
function dayWords(at: number, now: number): string {
  const today = dayStart(now);
  const day = dayStart(at);
  if (day >= today) return "Today";
  if (day >= today - DAY_MS) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * Whether a thread is the reader's own, as Mine lists it: of a task of
 * theirs (`ownTask`) or an agent they started, asking them, or one they
 * wrote in.
 */
function threadIsMine(item: InboxItem, readerId: string | undefined, ownTask: boolean): boolean {
  if (readerId === undefined) return false;
  if (ownTask || item.startedBy?.userId === readerId) return true;
  if (threadNeedsReader(item, readerId)) return true;
  return (item.thread ?? []).some((message) => message.member?.userId === readerId);
}

/** The threads a view shows, in the order given; `ownTask` says which threads stand on a task of the reader's. */
export function viewedThreads(
  threads: readonly ChannelThread[],
  view: ChannelView,
  readerId: string | undefined,
  ownTask: (thread: ChannelThread) => boolean,
): readonly ChannelThread[] {
  switch (view) {
    case CHANNEL_VIEW.EVERYONE:
      return threads;
    case CHANNEL_VIEW.MINE:
      return threads.filter((thread) => threadIsMine(thread, readerId, ownTask(thread)));
    case CHANNEL_VIEW.NEEDS_ME:
      return threads.filter((thread) => threadNeedsReader(thread, readerId));
  }
}

/** How many threads need the reader, which Needs me counts in its menu. */
export function needsReaderCount(
  threads: readonly ChannelThread[],
  readerId: string | undefined,
): number {
  return threads.filter((thread) => threadNeedsReader(thread, readerId)).length;
}

/** A view's entry in the View options menu: its name, Needs me counting what waits on the reader. */
export function channelViewLabel(view: ChannelView, needsCount: number): string {
  const words = CHANNEL_VIEW_WORDS[view];
  return view === CHANNEL_VIEW.NEEDS_ME && needsCount > 0 ? `${words} · ${needsCount}` : words;
}

/** The channel's title: its name, and the view after it where it is not Mine. */
export function channelTitle(name: string, view: ChannelView): string {
  return view === CHANNEL_VIEW.MINE ? `#${name}` : `#${name} · ${CHANNEL_VIEW_WORDS[view]}`;
}

/** What an empty stream says, by its view. */
export function emptyStreamWords(name: string, view: ChannelView): string {
  switch (view) {
    case CHANNEL_VIEW.EVERYONE:
      return `Nothing has been posted in #${name} yet`;
    case CHANNEL_VIEW.MINE:
      return `Nothing of yours in #${name} right now`;
    case CHANNEL_VIEW.NEEDS_ME:
      return `Nothing in #${name} needs you`;
  }
}

/**
 * The stream's rows: the threads oldest posted first, a divider before each
 * day, and the New line before the first thread posted since the reader
 * last looked (`lookedAt`) by someone else. A channel never looked at draws
 * no New line, since everything in it would stand under one.
 */
export function streamRows(
  threads: readonly ChannelThread[],
  seams: {
    readonly lookedAt: number | undefined;
    readonly readerId: string | undefined;
    readonly now: number;
  },
): readonly StreamRow[] {
  const { lookedAt, readerId, now } = seams;
  const sorted = threads.toSorted((a, b) => a.postedAt - b.postedAt);
  const firstNew =
    lookedAt === undefined
      ? undefined
      : sorted.find(
          (thread) =>
            thread.postedAt > lookedAt &&
            (readerId === undefined || thread.thread?.[0]?.member?.userId !== readerId),
        );
  const rows: StreamRow[] = [];
  let lastDay: number | undefined;
  for (const thread of sorted) {
    const day = dayStart(thread.postedAt);
    if (day !== lastDay) {
      rows.push({ kind: STREAM_ROW.DAY, key: String(day), words: dayWords(thread.postedAt, now) });
      lastDay = day;
    }
    if (thread === firstNew) rows.push({ kind: STREAM_ROW.NEW });
    rows.push({ kind: STREAM_ROW.THREAD, thread });
  }
  return rows;
}

/** The replies line under a post, read from its thread: everything after its first message is a reply. */
export function repliesLine(item: InboxItem, readerId: string | undefined): RepliesLine {
  const replies = (item.thread ?? []).slice(1);
  const byWho = new Map<string, InboxMessage>();
  for (const reply of replies) {
    const who = reply.member?.userId ?? reply.author;
    if (!byWho.has(who)) byWho.set(who, reply);
  }
  const words =
    replies.length === 0
      ? "Reply in thread"
      : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`;
  const waitsOn = inboxAsksOpen(item) ? inboxWaitsOn(item) : undefined;
  const waiting =
    waitsOn === undefined
      ? undefined
      : waitsOn.userId === readerId
        ? "Waiting on you"
        : `Waiting on ${waitsOn.name}`;
  return { repliers: [...byWho.values()], words, waiting };
}

/** The workspace's channels as the sidebar sections them, each section in the service's order. */
export function channelSections(channels: readonly Channel[]): ChannelSections {
  return {
    standing: channels.filter((channel) => !channel.project),
    projects: channels.filter((channel) => channel.project),
  };
}

/** The channels one of `CHANNEL_SECTIONS` lists, in the service's order. */
export function sectionChannels(
  channels: readonly Channel[],
  section: ChannelSectionLook,
): readonly Channel[] {
  return channels.filter((channel) => channel.project === section.project);
}

/**
 * Whether a channel reads as unread to the reader: something they may read
 * was posted in it since they last looked, or they never looked at one that
 * holds a thread.
 */
export function channelUnread(channel: Channel): boolean {
  const { latestPostedAt, lookedAt } = channel;
  if (latestPostedAt === undefined) return false;
  return lookedAt === undefined || latestPostedAt > lookedAt;
}

/** Whether a channel may be renamed or archived: any but #general. */
export function channelEditable(channel: Channel): boolean {
  return channel.name !== GENERAL_CHANNEL_NAME;
}

/** The workspace's #general, where its channels hold it. */
export function generalChannel(channels: readonly Channel[]): Channel | undefined {
  return channels.find((channel) => channel.name === GENERAL_CHANNEL_NAME);
}

/** What the Inbox's place shows of the workspace's channels: one of them, that the channel chosen stands no more, or none. */
export const CHANNEL_SHOWN = {
  CHANNEL: "channel",
  /** The channel chosen is archived, or was never one of the workspace's open channels. */
  MISSING: "missing",
  /** The channels are not read yet, or the workspace has none. */
  NONE: "none",
} as const;

export type ChannelShown =
  | { readonly kind: typeof CHANNEL_SHOWN.CHANNEL; readonly channel: Channel }
  | { readonly kind: typeof CHANNEL_SHOWN.MISSING }
  | { readonly kind: typeof CHANNEL_SHOWN.NONE };

/**
 * What the place shows once the channels are read: the channel chosen
 * where it is still open, a missing channel's state where it is not, so a
 * link to an archived or unknown channel says so rather than showing
 * another, and #general, else the first, while nothing is chosen.
 */
export function channelShown(
  channels: readonly Channel[] | undefined,
  chosenId: string | undefined,
): ChannelShown {
  if (channels === undefined) return { kind: CHANNEL_SHOWN.NONE };
  const chosen = channels.find((channel) => channel.id === chosenId);
  if (chosenId !== undefined && chosen === undefined) return { kind: CHANNEL_SHOWN.MISSING };
  const channel = chosen ?? generalChannel(channels) ?? channels[0];
  return channel === undefined
    ? { kind: CHANNEL_SHOWN.NONE }
    : { kind: CHANNEL_SHOWN.CHANNEL, channel };
}

/**
 * The channel `by` steps from the one shown, through the sidebar's order,
 * the standing channels then the projects', wrapping round at either end;
 * from none shown, down is the first and up the last.
 */
export function channelStep(
  channels: readonly Channel[],
  shownId: string | undefined,
  by: 1 | -1,
): Channel | undefined {
  const { standing, projects } = channelSections(channels);
  const ordered = [...standing, ...projects];
  if (ordered.length === 0) return undefined;
  const at = ordered.findIndex((channel) => channel.id === shownId);
  const from = at === -1 ? (by === 1 ? -1 : 0) : at;
  return ordered[(from + by + ordered.length) % ordered.length];
}

/** "↑ N older asks need you", as the jump over the stream says it. */
export function olderAsksWords(count: number): string {
  return count === 1 ? "1 older ask needs you" : `${count} older asks need you`;
}

/** A channel's name as it is typed, written as a channel's is: lowercase, a dash for each run of anything but letters and digits, none at its ends. */
export function channelSlug(typed: string): string {
  return typed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/** How many open asks wait on the reader across every channel, as a phone's bar counts them. */
export function channelsWaiting(channels: readonly Channel[]): number {
  return channels.reduce((total, channel) => total + channel.waiting, 0);
}
