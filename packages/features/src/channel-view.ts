import { Schema as EffectSchema } from "effect";
import {
  channelArchiveRequestSchema,
  channelCreateRequestSchema,
  channelEditRequestSchema,
  channelLookRequestSchema,
  channelMoveAnswerSchema,
  channelMoveRequestSchema,
  channelsAnswerSchema,
  channelThreadsAnswerSchema,
  channelThreadsQuerySchema,
  channelUnarchiveRequestSchema,
} from "./channel-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * channel-view.ts -- a workspace's channels as one Mac's window hears them: each call's answer whole, or why there is none.
 *
 * The host asks the service on the window's behalf (`channel-client.ts`) and
 * answers the window one of the shapes here: the workspace's channels as
 * they then stand, which every write on a channel answers, a page of one
 * channel's threads, or a thread as a move left it; or why there is no
 * answer. A workspace's channels themselves reach a window on the app state
 * the host holds them in (`LIVE_READ.CHANNELS`), never as an answer here.
 * What a window asks with is the service's own request (`channel-wire.ts`),
 * checked again at the host.
 */

/** Why a channel call answered nothing a window can draw. */
export const CHANNEL_CALL_FAILURE = {
  /** The call never reached an answer: no credential, the network, a shape not read. */
  UNANSWERED: "unanswered",
  /** The channel, or its workspace, is gone or not the account's to reach. */
  NOT_FOUND: "not-found",
  /** Another open channel of the workspace goes by that name. */
  NAME_TAKEN: "name-taken",
  /** The account may not do this with it: #general, whose name never changes and which is never archived. */
  NOT_PERMITTED: "not-permitted",
  /** The service refused what was written: a name or a purpose it does not take. */
  INVALID: "invalid",
} as const;

export type ChannelCallFailure = (typeof CHANNEL_CALL_FAILURE)[keyof typeof CHANNEL_CALL_FAILURE];

const failed = EffectSchema.Struct({
  failure: EffectSchema.Literals(Object.values(CHANNEL_CALL_FAILURE)),
});

/** A channel to make, as the service takes it. */
export const channelCreateParamsSchema = channelCreateRequestSchema;

export type ChannelCreateParams = typeof channelCreateParamsSchema.Type;

/** A channel given a new name, a new purpose, or both. */
export const channelEditParamsSchema = channelEditRequestSchema;

export type ChannelEditParams = typeof channelEditParamsSchema.Type;

/** A channel archived. */
export const channelArchiveParamsSchema = channelArchiveRequestSchema;

export type ChannelArchiveParams = typeof channelArchiveParamsSchema.Type;

/** An archived channel opened again. */
export const channelUnarchiveParamsSchema = channelUnarchiveRequestSchema;

export type ChannelUnarchiveParams = typeof channelUnarchiveParamsSchema.Type;

/** A thread moved into another open channel of its workspace. */
export const channelMoveParamsSchema = channelMoveRequestSchema;

export type ChannelMoveParams = typeof channelMoveParamsSchema.Type;

/** The workspace whose channels a window holds. */
export const channelsFollowParamsSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

export type ChannelsFollowParams = typeof channelsFollowParamsSchema.Type;

/** The reader's look at a channel stamped. */
export const channelLookParamsSchema = channelLookRequestSchema;

export type ChannelLookParams = typeof channelLookParamsSchema.Type;

/** The channel whose threads are read, and the thread an older page is read before. */
export const channelThreadsParamsSchema = channelThreadsQuerySchema;

export type ChannelThreadsParams = typeof channelThreadsParamsSchema.Type;

/** The workspace's channels as they stand, every write's answer, or why there are none. */
export const channelsViewSchema = EffectSchema.Union([channelsAnswerSchema, failed]);

export type ChannelsView = typeof channelsViewSchema.Type;

/** A page of one channel's threads, oldest first, or why there are none. */
export const channelThreadsViewSchema = EffectSchema.Union([channelThreadsAnswerSchema, failed]);

export type ChannelThreadsView = typeof channelThreadsViewSchema.Type;

/** The thread as a move left it, or why it did not move. */
export const channelMoveViewSchema = EffectSchema.Union([channelMoveAnswerSchema, failed]);

export type ChannelMoveView = typeof channelMoveViewSchema.Type;
