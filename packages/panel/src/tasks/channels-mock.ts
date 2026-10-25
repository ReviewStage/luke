/**
 * channels-mock.ts -- PROTOTYPE ONLY: the Channels mockup's state, which the `channels` fixture profile turns on.
 *
 * Channels are topics that Inbox threads live in, and the Inbox becomes For
 * you inside them (STAG-547). Nothing here is wired to the service: the
 * fixture registers which channel and kind each synthetic item has, and the
 * sidebar, the Inbox's list, and its pane read them to draw the mockup.
 */

import { STATUS_TONE, type StatusTone } from "@luke/ui";
import { useSyncExternalStore } from "react";

/** The places the mockup's sidebar lists: For you, then each channel. */
export const MOCK_CHANNEL = {
  FOR_YOU: "for-you",
  APP: "app",
  SERVICE: "service",
  INFRA: "infra",
  GENERAL: "general",
  CHANNELS: "channels",
} as const;

export type MockChannel = (typeof MOCK_CHANNEL)[keyof typeof MOCK_CHANNEL];

/** What kind of thread an item is, as the kind an agent names when it posts one. */
export const THREAD_KIND = {
  DECISION: "decision",
  TO_DO: "to-do",
  REVIEW: "review",
  BLOCKED: "blocked",
  HEADS_UP: "heads-up",
  SHIPPED: "shipped",
  THREAD: "thread",
  ANNOUNCEMENT: "announcement",
} as const;

export type ThreadKind = (typeof THREAD_KIND)[keyof typeof THREAD_KIND];

/** Each kind's words on a row and over a thread. */
export const THREAD_KIND_WORDS = {
  [THREAD_KIND.DECISION]: "Decision",
  [THREAD_KIND.TO_DO]: "To do",
  [THREAD_KIND.REVIEW]: "Review",
  [THREAD_KIND.BLOCKED]: "Blocked",
  [THREAD_KIND.HEADS_UP]: "Heads-up",
  [THREAD_KIND.SHIPPED]: "Shipped",
  [THREAD_KIND.THREAD]: "Thread",
  [THREAD_KIND.ANNOUNCEMENT]: "Announcement",
} as const satisfies Record<ThreadKind, string>;

/** PROTOTYPE ONLY: the tone each thread kind's badge wears on a row, open or settled. */
export function kindTone(kind: ThreadKind, open: boolean): StatusTone {
  switch (kind) {
    case THREAD_KIND.DECISION:
    case THREAD_KIND.TO_DO:
    case THREAD_KIND.REVIEW:
      return open ? STATUS_TONE.ATTENTION : STATUS_TONE.NEUTRAL;
    case THREAD_KIND.BLOCKED:
      return open ? STATUS_TONE.DANGER : STATUS_TONE.NEUTRAL;
    case THREAD_KIND.SHIPPED:
      return STATUS_TONE.MERGED;
    case THREAD_KIND.ANNOUNCEMENT:
      return STATUS_TONE.WORKING;
    case THREAD_KIND.HEADS_UP:
    case THREAD_KIND.THREAD:
      return STATUS_TONE.NEUTRAL;
  }
}

/** A channel as the sidebar and its list's head draw it. */
export interface ChannelInfo {
  readonly id: Exclude<MockChannel, typeof MOCK_CHANNEL.FOR_YOU>;
  readonly name: string;
  readonly purpose: string;
  /** Whether it is a project's, archived once the project ships, rather than a standing topic. */
  readonly project: boolean;
  /** What is being worked on in it now, as its head says. */
  readonly inFlight: string;
}

export const CHANNELS: readonly ChannelInfo[] = [
  {
    id: MOCK_CHANNEL.APP,
    name: "app",
    purpose: "Desktop, web client, panel, ui, catalog, iOS, voice",
    project: false,
    inFlight: "6 agents · Inbox rows, Composer drafts, +4",
  },
  {
    id: MOCK_CHANNEL.SERVICE,
    name: "service",
    purpose: "Service, database, features, wire, agent-runner, web server",
    project: false,
    inFlight: "3 agents · Channels schema, Chat search, +1",
  },
  {
    id: MOCK_CHANNEL.INFRA,
    name: "infra",
    purpose: "CI, release, dependencies, Vercel, Neon, Sentry",
    project: false,
    inFlight: "1 agent · Sentry on previews",
  },
  {
    id: MOCK_CHANNEL.GENERAL,
    name: "general",
    purpose: "Anything that cuts across",
    project: false,
    inFlight: "",
  },
  {
    id: MOCK_CHANNEL.CHANNELS,
    name: "channels",
    purpose: "Project: Chat rebuilt on the Inbox · archived when it ships",
    project: true,
    inFlight: "2 agents · Channels view, Channels schema",
  },
];

/** Where an item stands in the mockup: its channel and its kind. */
export interface ChannelItemMeta {
  readonly channel: ChannelInfo["id"];
  readonly kind: ThreadKind;
  /** Whether a notice is addressed to its reader, who alone is asked for Got it; a notice addressed to nobody is only read. */
  readonly addressed?: boolean;
}

/** The kinds a row's badge names: those an ask's glyph cannot say. */
const BADGED_KINDS: ReadonlySet<ThreadKind> = new Set<ThreadKind>([
  THREAD_KIND.REVIEW,
  THREAD_KIND.HEADS_UP,
  THREAD_KIND.SHIPPED,
  THREAD_KIND.ANNOUNCEMENT,
]);

/** Whether a row names its thread's kind in a badge, in place of its line's glyph. */
export function badgedKind(kind: ThreadKind): boolean {
  return BADGED_KINDS.has(kind);
}

interface ChannelsMockState {
  readonly on: boolean;
  readonly channel: MockChannel;
  /** Whether a channel's thread stands open beside its stream, as Slack's thread pane does. */
  readonly threadOpen: boolean;
}

/** A post the reader made in a channel's box, which the mockup keeps in the window alone. */
export interface ChannelPost {
  readonly id: string;
  readonly channel: MockChannel;
  readonly text: string;
  readonly at: number;
}

let state: ChannelsMockState = { on: false, channel: MOCK_CHANNEL.FOR_YOU, threadOpen: false };
let posts: readonly ChannelPost[] = [];
/** What a channel's sidebar row says: how many of its threads need the reader, and whether any is unread. */
export interface ChannelCount {
  readonly needsYou: number;
  readonly unread: boolean;
}

let items: ReadonlyMap<string, ChannelItemMeta> = new Map();
let counts: ReadonlyMap<MockChannel, ChannelCount> = new Map();
const listeners = new Set<() => void>();

function publish(next: ChannelsMockState): void {
  if (
    next.on === state.on &&
    next.channel === state.channel &&
    next.threadOpen === state.threadOpen
  )
    return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Turns the mockup on with the items' channels and kinds, as the channels fixture lands. */
export function startChannelsMock(
  meta: ReadonlyMap<string, ChannelItemMeta>,
  counted: ReadonlyMap<MockChannel, ChannelCount>,
): void {
  items = meta;
  counts = counted;
  publish({ ...state, on: true });
}

/** Shows a channel, or For you. */
export function chooseChannel(channel: MockChannel): void {
  publish({ ...state, channel, threadOpen: channel === state.channel ? state.threadOpen : false });
}

/** Opens the chosen thread beside the channel's stream. */
export function openThread(): void {
  publish({ ...state, threadOpen: true });
}

/** Closes the thread beside the channel's stream. */
export function closeThread(): void {
  publish({ ...state, threadOpen: false });
}

/** Posts the reader's words in a channel, kept in the window alone. */
export function addChannelPost(channel: MockChannel, text: string): void {
  if (text.trim() === "") return;
  const at = Date.now();
  posts = [...posts, { id: `post-${posts.length}-${at}`, channel, text, at }];
  for (const listener of listeners) listener();
}

/** The reader's posts in a channel. */
export function useChannelPosts(channel: MockChannel): readonly ChannelPost[] {
  const all = useSyncExternalStore(subscribe, () => posts);
  return all.filter((post) => post.channel === channel);
}

/** Whether the mockup is on, and the channel shown. */
export function useChannelsMock(): ChannelsMockState {
  return useSyncExternalStore(subscribe, () => state);
}

/** An item's channel and kind, where the mockup gives it one. */
export function channelItem(itemId: string): ChannelItemMeta | undefined {
  return items.get(itemId);
}

/** A channel by its id. */
export function channelInfo(channel: MockChannel): ChannelInfo | undefined {
  return CHANNELS.find((each) => each.id === channel);
}

/** The items in a channel, by id. */
export function channelItemIds(channel: MockChannel): ReadonlySet<string> {
  return new Set([...items].filter(([, meta]) => meta.channel === channel).map(([id]) => id));
}

/** A channel's sidebar count. */
export function channelCount(channel: MockChannel): ChannelCount {
  return counts.get(channel) ?? { needsYou: 0, unread: false };
}

/** Whether an item is a channel's thread addressed to nobody, whose notice is read rather than nodded to. */
export function channelUnaddressed(itemId: string): boolean {
  const meta = items.get(itemId);
  return meta !== undefined && meta.addressed !== true;
}
