import { Schema as EffectSchema } from "effect";
import {
  channelArchiveRequestSchema,
  channelCreateRequestSchema,
  channelLookRequestSchema,
  channelRenameRequestSchema,
  channelsAnswerSchema,
  channelsQuerySchema,
  channelThreadsAnswerSchema,
  channelThreadsQuerySchema,
} from "./channel-wire.js";

/**
 * channel-view.ts -- a workspace's channels as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf (`channel-client.ts`) and
 * answers the window one of the shapes here: the workspace's channels as
 * they then stand, which every write answers as the read does, or one
 * channel's threads; or why there is no answer. What a window asks with is
 * the service's own request (`channel-wire.ts`), checked again at the host.
 */

/** Why a channel call answered nothing a window can draw. */
export const CHANNEL_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The channel, or its workspace, is gone or not the account's to reach. */
  NOT_FOUND: "not-found",
  /** Another open channel of the workspace goes by that name. */
  NAME_TAKEN: "name-taken",
  /** The account may not do this with it: #general, which is never renamed or archived. */
  NOT_PERMITTED: "not-permitted",
  /** The service refused what was written: a name or a purpose it does not take. */
  INVALID: "invalid",
} as const;

export type ChannelCallFailure = (typeof CHANNEL_CALL_FAILURE)[keyof typeof CHANNEL_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(CHANNEL_CALL_FAILURE)),
});

/** The workspace whose channels are read. */
export const channelsListParamsSchema = channelsQuerySchema;

export type ChannelsListParams = typeof channelsListParamsSchema.Type;

/** A channel to make, as the service takes it. */
export const channelCreateParamsSchema = channelCreateRequestSchema;

export type ChannelCreateParams = typeof channelCreateParamsSchema.Type;

/** A channel given a new name. */
export const channelRenameParamsSchema = channelRenameRequestSchema;

export type ChannelRenameParams = typeof channelRenameParamsSchema.Type;

/** A channel archived. */
export const channelArchiveParamsSchema = channelArchiveRequestSchema;

export type ChannelArchiveParams = typeof channelArchiveParamsSchema.Type;

/** The reader's look at a channel stamped. */
export const channelLookParamsSchema = channelLookRequestSchema;

export type ChannelLookParams = typeof channelLookParamsSchema.Type;

/** The channel whose threads are read. */
export const channelThreadsParamsSchema = channelThreadsQuerySchema;

export type ChannelThreadsParams = typeof channelThreadsParamsSchema.Type;

/** The workspace's channels as they stand, the read's answer and every write's, or why there are none. */
export const channelsViewSchema = EffectSchema.Union([channelsAnswerSchema, failed]);

export type ChannelsView = typeof channelsViewSchema.Type;

/** One channel's latest threads, oldest first, or why there are none. */
export const channelThreadsViewSchema = EffectSchema.Union([channelThreadsAnswerSchema, failed]);

export type ChannelThreadsView = typeof channelThreadsViewSchema.Type;
