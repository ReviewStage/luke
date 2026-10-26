import { Schema as EffectSchema } from "effect";
import { inboxItemSchema } from "./inbox-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * channel-wire.ts -- a workspace's channels, the topic areas its inbox threads live in, as the panel and the service read them.
 *
 * Every member of a workspace sees every one of its open channels, and any
 * member creates, renames, or archives one, but never its #general, where
 * every thread that names no channel goes. What differs per reader is how
 * many open asks wait on them in each channel and when they last looked at
 * it. Every write answers the workspace's channels as they then stand, as
 * the read does, so the panel draws the service's word rather than its
 * guess. A channel's threads are inbox items (`inbox-wire.ts`), each read
 * with the channel it lives in.
 */

export const CHANNEL_BOUNDS = {
  /** The most characters a channel's name may spell. */
  MAX_NAME_CHARS: 80,
  /** The most characters a channel's purpose may spell. */
  MAX_PURPOSE_CHARS: 250,
} as const;

/** A channel's name: a lowercase slug of words joined by hyphens, as `app` or `release-notes`. */
export const channelNameSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(CHANNEL_BOUNDS.MAX_NAME_CHARS),
  EffectSchema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
);

/** A channel's purpose: one line saying what belongs in it, which an agent reads to choose it. */
const channelPurposeSchema = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(CHANNEL_BOUNDS.MAX_PURPOSE_CHARS),
);

/** One open channel of a workspace as its reader reads it. */
export const channelSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  name: EffectSchema.String,
  purpose: EffectSchema.String,
  /** Whether the channel is for one project rather than a standing area. */
  project: EffectSchema.Boolean,
  /** The member who made it; absent on a #general the workspace minted itself, and once their account is gone. */
  createdBy: EffectSchema.optionalKey(EffectSchema.String),
  createdAt: countedNumber,
  /** How many of its threads hold an ask open that waits on the reader. */
  waiting: countedNumber,
  /** When the reader last looked at it; absent where they never have. */
  lookedAt: EffectSchema.optionalKey(countedNumber),
});

export type Channel = typeof channelSchema.Type;

/** A workspace's open channels by name, as the read and every write answer them. */
export const channelsAnswerSchema = EffectSchema.Struct({
  channels: EffectSchema.Array(channelSchema),
});

export type ChannelsAnswer = typeof channelsAnswerSchema.Type;

/** The read's query: the workspace whose channels are read. */
export const channelsQuerySchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

/** A channel a member makes: its workspace, name, and purpose, and whether it is one project's, which it is not where the request says nothing. */
export const channelCreateRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: channelNameSchema,
  purpose: channelPurposeSchema,
  project: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type ChannelCreateRequest = typeof channelCreateRequestSchema.Type;

/** One open channel of a workspace, named by both. */
const channelOfWorkspace = { workspaceId: workspaceIdSchema, channelId: wireUuidSchema };

/** A channel given a new name; never #general. */
export const channelRenameRequestSchema = EffectSchema.Struct({
  ...channelOfWorkspace,
  name: channelNameSchema,
});

export type ChannelRenameRequest = typeof channelRenameRequestSchema.Type;

/** A channel archived, which frees its name and leaves its threads where they are; never #general. */
export const channelArchiveRequestSchema = EffectSchema.Struct(channelOfWorkspace);

export type ChannelArchiveRequest = typeof channelArchiveRequestSchema.Type;

/** The reader's look at a channel, stamped at the service's now, which marks what was posted before it as seen. */
export const channelLookRequestSchema = EffectSchema.Struct(channelOfWorkspace);

export type ChannelLookRequest = typeof channelLookRequestSchema.Type;

/** The threads read's query: the channel whose threads are read. */
export const channelThreadsQuerySchema = EffectSchema.Struct({ channelId: wireUuidSchema });

/** One thread as a channel carries it: the inbox item, and the channel it lives in. */
export const channelThreadSchema = EffectSchema.Struct({
  ...inboxItemSchema.fields,
  channelId: wireUuidSchema,
});

export type ChannelThread = typeof channelThreadSchema.Type;

/** A channel's latest threads the reader may read, and every older one whose open ask waits on them, oldest posted first. */
export const channelThreadsAnswerSchema = EffectSchema.Struct({
  threads: EffectSchema.Array(channelThreadSchema),
});

export type ChannelThreadsAnswer = typeof channelThreadsAnswerSchema.Type;
