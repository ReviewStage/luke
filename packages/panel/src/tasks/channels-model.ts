import type { ArchivedChannel, Channel } from "@luke/features/channel-wire";

/**
 * channels-model.ts -- a workspace's channels as the sidebar lists them under the Inbox, and the channel the Inbox is narrowed to (STAG-547).
 *
 * A channel is a topic its workspace's threads live in, each thread an Inbox
 * item (`channel-wire.ts`), so a channel is the Inbox narrowed to one topic.
 * The sidebar lists the standing channels and then the projects' under the
 * Inbox's row, each counting the open asks that wait on the reader. A
 * channel reads as unread while something was posted in it since the
 * reader last looked, which its row says in the unread weight.
 */

/** The channel every thread that names none goes to, which is never renamed or archived; the service mints it under this name (`GENERAL_CHANNEL`). */
const GENERAL_CHANNEL_NAME = "general";

/** A workspace's channels as the sidebar sections them: the standing ones, then the projects'. */
export interface ChannelSections {
  readonly standing: readonly Channel[];
  readonly projects: readonly Channel[];
}

/**
 * What the Inbox row's ⋯ offers of each kind of channel, the
 * standing ones and the projects', in its order: what makes one, and what
 * lists the archived ones.
 */
export const CHANNEL_SECTIONS = [
  { project: false, add: "New channel", browse: "Browse archived channels" },
  { project: true, add: "New project channel", browse: "Browse archived project channels" },
] as const;

/** The workspace's channels as the sidebar sections them, each section in the service's order. */
export function channelSections(channels: readonly Channel[]): ChannelSections {
  return {
    standing: channels.filter((channel) => !channel.project),
    projects: channels.filter((channel) => channel.project),
  };
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

/** The channel the Inbox is narrowed to: one of the workspace's, an archived one, that the channel chosen stands nowhere, or none. */
export const CHANNEL_SHOWN = {
  CHANNEL: "channel",
  /** The channel chosen is one of the workspace's archived channels, which Unarchive opens again. */
  ARCHIVED: "archived",
  /** The channel chosen is neither open nor among the archived channels given. */
  MISSING: "missing",
  /** No channel is chosen, the Inbox listing every channel, or the channels are not read yet. */
  NONE: "none",
} as const;

export type ChannelShown =
  | { readonly kind: typeof CHANNEL_SHOWN.CHANNEL; readonly channel: Channel }
  | { readonly kind: typeof CHANNEL_SHOWN.ARCHIVED; readonly channel: ArchivedChannel }
  | { readonly kind: typeof CHANNEL_SHOWN.MISSING }
  | { readonly kind: typeof CHANNEL_SHOWN.NONE };

/**
 * The channel the Inbox is narrowed to once the channels are read: the
 * channel chosen where it is still open, or where it is among the
 * `archived` channels given; a missing channel's state where it is neither,
 * so a link to an unknown channel says so rather than showing another; and
 * none while nothing is chosen, where the Inbox lists every channel.
 */
export function channelShown(
  channels: readonly Channel[] | undefined,
  chosenId: string | undefined,
  archived: readonly ArchivedChannel[] = [],
): ChannelShown {
  if (channels === undefined || chosenId === undefined) return { kind: CHANNEL_SHOWN.NONE };
  const chosen = channels.find((channel) => channel.id === chosenId);
  if (chosen !== undefined) return { kind: CHANNEL_SHOWN.CHANNEL, channel: chosen };
  const gone = archived.find((channel) => channel.id === chosenId);
  return gone === undefined
    ? { kind: CHANNEL_SHOWN.MISSING }
    : { kind: CHANNEL_SHOWN.ARCHIVED, channel: gone };
}

/** A channel's name as it is typed, written as a channel's is: lowercase, a dash for each run of anything but letters and digits, none at its ends. */
export function channelSlug(typed: string): string {
  return typed
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
