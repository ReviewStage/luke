import {
  archivedChannelsViewSchema,
  type ChannelsMoved,
  channelArchiveParamsSchema,
  channelCreateParamsSchema,
  channelEditParamsSchema,
  channelLookParamsSchema,
  channelMoveParamsSchema,
  channelMoveViewSchema,
  channelsArchivedParamsSchema,
  channelsFollowParamsSchema,
  channelsListParamsSchema,
  channelsViewSchema,
  channelThreadsParamsSchema,
  channelThreadsViewSchema,
  channelUnarchiveParamsSchema,
} from "@luke/features/channel-view";
import { eventIterator, type } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CHANNEL_ACT_KIND } from "./kinds.js";

/**
 * channels.ts -- the Channels view's asks of the host about a workspace's channels, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * answer into what crosses the port, but a thread read's and a move's, which
 * carry items as the Inbox's own acts do, as the type they were read as; and
 * the follow's, a stream of which channels moved.
 */
export const channelActsContract = {
  [CHANNEL_ACT_KIND.CHANNELS_LIST]: actProcedure("Could not read the channels on this system.")
    .input(exactInput(channelsListParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_CREATE]: actProcedure("Could not make the channel on this system.")
    .input(exactInput(channelCreateParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_EDIT]: actProcedure("Could not edit the channel on this system.")
    .input(exactInput(channelEditParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]: actProcedure("Could not archive the channel on this system.")
    .input(exactInput(channelArchiveParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_UNARCHIVE]: actProcedure(
    "Could not unarchive the channel on this system.",
  )
    .input(exactInput(channelUnarchiveParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_ARCHIVED]: actProcedure(
    "Could not read the archived channels on this system.",
  )
    .input(exactInput(channelsArchivedParamsSchema))
    .output(EffectSchema.flip(archivedChannelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_LOOK]: actProcedure("Could not mark the channel seen on this system.")
    .input(exactInput(channelLookParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_THREADS]: actProcedure(
    "Could not read the channel's threads on this system.",
  )
    .input(exactInput(channelThreadsParamsSchema))
    .output(EffectSchema.toType(channelThreadsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_MOVE]: actProcedure("Could not move the thread on this system.")
    .input(exactInput(channelMoveParamsSchema))
    .output(EffectSchema.toType(channelMoveViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_FOLLOW]: actProcedure("Could not follow the channels on this system.")
    .input(exactInput(channelsFollowParamsSchema))
    .output(eventIterator(type<ChannelsMoved>())),
};
