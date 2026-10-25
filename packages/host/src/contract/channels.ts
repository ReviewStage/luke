import {
  channelArchiveParamsSchema,
  channelCreateParamsSchema,
  channelLookParamsSchema,
  channelRenameParamsSchema,
  channelsListParamsSchema,
  channelsViewSchema,
  channelThreadsParamsSchema,
  channelThreadsViewSchema,
} from "@luke/features/channel-view";
import { Schema as EffectSchema } from "effect";
import { actProcedure, exactInput } from "./base.js";
import { CHANNEL_ACT_KIND } from "./kinds.js";

/**
 * channels.ts -- the Channels view's asks of the host about a workspace's channels, as procedures.
 *
 * Each output is its view schema flipped, so oRPC's output check encodes the
 * answer into what crosses the port, but a thread read's, which carries its
 * items as the Inbox's own acts do, as the type they were read as.
 */
export const channelActsContract = {
  [CHANNEL_ACT_KIND.CHANNELS_LIST]: actProcedure("Could not read the channels on this system.")
    .input(exactInput(channelsListParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_CREATE]: actProcedure("Could not make the channel on this system.")
    .input(exactInput(channelCreateParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_RENAME]: actProcedure("Could not rename the channel on this system.")
    .input(exactInput(channelRenameParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]: actProcedure("Could not archive the channel on this system.")
    .input(exactInput(channelArchiveParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_LOOK]: actProcedure("Could not mark the channel seen on this system.")
    .input(exactInput(channelLookParamsSchema))
    .output(EffectSchema.flip(channelsViewSchema)),
  [CHANNEL_ACT_KIND.CHANNELS_THREADS]: actProcedure(
    "Could not read the channel's threads on this system.",
  )
    .input(exactInput(channelThreadsParamsSchema))
    .output(EffectSchema.toType(channelThreadsViewSchema)),
};
