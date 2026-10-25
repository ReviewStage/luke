import type {
  ChannelArchiveParams,
  ChannelCreateParams,
  ChannelLookParams,
  ChannelRenameParams,
  ChannelsListParams,
  ChannelsView,
  ChannelThreadsParams,
  ChannelThreadsView,
} from "@luke/features/channel-view";
import { Effect } from "effect";
import { CHANNEL_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";

/**
 * channel-procedures.ts -- the Channels view's asks of the host about a workspace's channels.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Channels view, so every one refuses the takeover and the hidden voice
 * window, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. Nothing is held here.
 */
export interface ChannelProceduresDependencies {
  host: {
    channelsList(params: ChannelsListParams): Effect.Effect<ChannelsView>;
    channelsCreate(params: ChannelCreateParams): Effect.Effect<ChannelsView>;
    channelsRename(params: ChannelRenameParams): Effect.Effect<ChannelsView>;
    channelsArchive(params: ChannelArchiveParams): Effect.Effect<ChannelsView>;
    channelsLook(params: ChannelLookParams): Effect.Effect<ChannelsView>;
    channelsThreads(params: ChannelThreadsParams): Effect.Effect<ChannelThreadsView>;
  };
}

/** The refusal a window that draws no Channels view hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function channelProcedures(dependencies: ChannelProceduresDependencies) {
  const { host } = dependencies;
  return {
    [CHANNEL_ACT_KIND.CHANNELS_LIST]: actPort[CHANNEL_ACT_KIND.CHANNELS_LIST].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsList(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_CREATE]: actPort[CHANNEL_ACT_KIND.CHANNELS_CREATE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsCreate(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_RENAME]: actPort[CHANNEL_ACT_KIND.CHANNELS_RENAME].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsRename(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]: actPort[CHANNEL_ACT_KIND.CHANNELS_ARCHIVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsArchive(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_LOOK]: actPort[CHANNEL_ACT_KIND.CHANNELS_LOOK].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsLook(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_THREADS]: actPort[CHANNEL_ACT_KIND.CHANNELS_THREADS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsThreads(input);
      },
    ),
  };
}
