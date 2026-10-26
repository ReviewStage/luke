import { Schema as EffectSchema } from "effect";
import {
  archivedChannelsAnswerSchema,
  channelArchiveRequestSchema,
  channelCreateRequestSchema,
  channelEditRequestSchema,
  channelLookRequestSchema,
  channelMoveAnswerSchema,
  channelMoveRequestSchema,
  channelsAnswerSchema,
  channelsQuerySchema,
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
 * they then stand, which every write on a channel answers as the read does,
 * its archived channels, a page of one channel's threads, or a thread as a
 * move left it; or why there is no answer. A window following a
 * workspace's channels hears which of them moved each time any does, and
 * reads them again itself. What a window asks with is
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
  /** The account may not do this with it: #general, whose name never changes and which is never archived. */
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

/** A channel given a new name, a new purpose, or both. */
export const channelEditParamsSchema = channelEditRequestSchema;

export type ChannelEditParams = typeof channelEditParamsSchema.Type;

/** A channel archived. */
export const channelArchiveParamsSchema = channelArchiveRequestSchema;

export type ChannelArchiveParams = typeof channelArchiveParamsSchema.Type;

/** An archived channel opened again. */
export const channelUnarchiveParamsSchema = channelUnarchiveRequestSchema;

export type ChannelUnarchiveParams = typeof channelUnarchiveParamsSchema.Type;

/** The workspace whose archived channels are read. */
export const channelsArchivedParamsSchema = channelsQuerySchema;

export type ChannelsArchivedParams = typeof channelsArchivedParamsSchema.Type;

/** A thread moved into another open channel of its workspace. */
export const channelMoveParamsSchema = channelMoveRequestSchema;

export type ChannelMoveParams = typeof channelMoveParamsSchema.Type;

/** The workspace whose channels a window follows. */
export const channelsFollowParamsSchema = EffectSchema.Struct({ workspaceId: workspaceIdSchema });

export type ChannelsFollowParams = typeof channelsFollowParamsSchema.Type;

/** The reader's look at a channel stamped. */
export const channelLookParamsSchema = channelLookRequestSchema;

export type ChannelLookParams = typeof channelLookParamsSchema.Type;

/** The channel whose threads are read, and the thread an older page is read before. */
export const channelThreadsParamsSchema = channelThreadsQuerySchema;

export type ChannelThreadsParams = typeof channelThreadsParamsSchema.Type;

/** The workspace's channels as they stand, the read's answer and every write's, or why there are none. */
export const channelsViewSchema = EffectSchema.Union([channelsAnswerSchema, failed]);

export type ChannelsView = typeof channelsViewSchema.Type;

/** A page of one channel's threads, oldest first, or why there are none. */
export const channelThreadsViewSchema = EffectSchema.Union([channelThreadsAnswerSchema, failed]);

export type ChannelThreadsView = typeof channelThreadsViewSchema.Type;

/** The workspace's archived channels, or why there are none. */
export const archivedChannelsViewSchema = EffectSchema.Union([
  archivedChannelsAnswerSchema,
  failed,
]);

export type ArchivedChannelsView = typeof archivedChannelsViewSchema.Type;

/** The thread as a move left it, or why it did not move. */
export const channelMoveViewSchema = EffectSchema.Union([channelMoveAnswerSchema, failed]);

export type ChannelMoveView = typeof channelMoveViewSchema.Type;

/**
 * What a window following a workspace's channels hears: the channels that
 * moved, by id, each time any does, every one on the first, since the read
 * it opened with may have missed what it says; or why it hears nothing more
 * until it follows again.
 */
export const channelsMovedSchema = EffectSchema.Union([
  EffectSchema.Struct({ moved: EffectSchema.Array(EffectSchema.String) }),
  failed,
]);

export type ChannelsMoved = typeof channelsMovedSchema.Type;

/** A followed workspace's channels moved, as the host tells every window: the workspace, and what its followers hear. */
export const channelsChangedSchema = EffectSchema.Struct({
  workspaceId: EffectSchema.String,
  heard: channelsMovedSchema,
});

export type ChannelsChanged = typeof channelsChangedSchema.Type;
