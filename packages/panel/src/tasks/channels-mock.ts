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
}

interface ChannelsMockState {
  readonly on: boolean;
  readonly channel: MockChannel;
}

let state: ChannelsMockState = { on: false, channel: MOCK_CHANNEL.FOR_YOU };
/** What a channel's sidebar row says: how many of its threads need the reader, and whether any is unread. */
export interface ChannelCount {
  readonly needsYou: number;
  readonly unread: boolean;
}

let items: ReadonlyMap<string, ChannelItemMeta> = new Map();
let counts: ReadonlyMap<MockChannel, ChannelCount> = new Map();
const listeners = new Set<() => void>();

function publish(next: ChannelsMockState): void {
  if (next.on === state.on && next.channel === state.channel) return;
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
  publish({ ...state, channel });
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
