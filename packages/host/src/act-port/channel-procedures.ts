import type {
  ChannelArchiveParams,
  ChannelCreateParams,
  ChannelEditParams,
  ChannelLookParams,
  ChannelMoveParams,
  ChannelMoveView,
  ChannelsFollowParams,
  ChannelsView,
  ChannelThreadsParams,
  ChannelThreadsView,
  ChannelUnarchiveParams,
} from "@luke/features/channel-view";
import { Effect, MutableHashMap, Option, Stream } from "effect";
import { CHANNEL_ACT_KIND } from "../contract/index.js";
import { type ActSender, actPort } from "./base.js";
import { followedStream, type OpenFollows, streamed } from "./followed-stream.js";

/**
 * channel-procedures.ts -- the Channels view's asks of the host about a workspace's channels.
 *
 * The one check these procedures make is who asked: only a panel draws the
 * Channels view, so every one refuses the takeover, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. A workspace's channels are
 * held followed while a panel holds a stream of them open: the host holds
 * them on the first stream and lets them go with the last, and what they
 * hold reaches every panel on app state, never down the stream, which
 * carries nothing. How many streams stand open of each is all that is held
 * here.
 */
export interface ChannelProceduresDependencies {
  host: {
    channelsCreate(params: ChannelCreateParams): Effect.Effect<ChannelsView>;
    channelsEdit(params: ChannelEditParams): Effect.Effect<ChannelsView>;
    channelsArchive(params: ChannelArchiveParams): Effect.Effect<ChannelsView>;
    channelsUnarchive(params: ChannelUnarchiveParams): Effect.Effect<ChannelsView>;
    channelsLook(params: ChannelLookParams): Effect.Effect<ChannelsView>;
    channelsThreads(params: ChannelThreadsParams): Effect.Effect<ChannelThreadsView>;
    channelsMove(params: ChannelMoveParams): Effect.Effect<ChannelMoveView>;
    /** A workspace's channels held followed at the host while any stream of them stands; what they hold reaches the panel on app state. */
    channelsFollow(params: ChannelsFollowParams): Effect.Effect<void>;
    channelsUnfollow(params: ChannelsFollowParams): Effect.Effect<void>;
    /** A held workspace's channels read again at once, as Try again asks. */
    channelsRetry(params: ChannelsFollowParams): Effect.Effect<void>;
  };
}

/** The refusal a window that draws no Channels view hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function channelProcedures(dependencies: ChannelProceduresDependencies) {
  const { host } = dependencies;
  /** Every workspace a window holds a stream of channels open of, so the host lets one go only with the last. */
  const openChannels: OpenFollows<never> = MutableHashMap.empty();
  return {
    [CHANNEL_ACT_KIND.CHANNELS_CREATE]: actPort[CHANNEL_ACT_KIND.CHANNELS_CREATE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsCreate(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_EDIT]: actPort[CHANNEL_ACT_KIND.CHANNELS_EDIT].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.channelsEdit(input);
    }),
    [CHANNEL_ACT_KIND.CHANNELS_UNARCHIVE]: actPort[CHANNEL_ACT_KIND.CHANNELS_UNARCHIVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsUnarchive(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_MOVE]: actPort[CHANNEL_ACT_KIND.CHANNELS_MOVE].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.channelsMove(input);
    }),
    [CHANNEL_ACT_KIND.CHANNELS_FOLLOW]: actPort[CHANNEL_ACT_KIND.CHANNELS_FOLLOW].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        // Note that nothing is heard down the hold, since the held channels reach the panel on app state.
        const hold = followedStream(
          {
            keyOf: (params: ChannelsFollowParams) => params.workspaceId,
            follow: host.channelsFollow,
            unfollow: host.channelsUnfollow,
            onChanged: () => () => undefined,
            valueOf: () => Option.none<never>(),
          },
          openChannels,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(hold));
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_RETRY]: actPort[CHANNEL_ACT_KIND.CHANNELS_RETRY].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      yield* host.channelsRetry(input);
    }),
    [CHANNEL_ACT_KIND.CHANNELS_ARCHIVE]: actPort[CHANNEL_ACT_KIND.CHANNELS_ARCHIVE].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsArchive(input);
      },
    ),
    [CHANNEL_ACT_KIND.CHANNELS_LOOK]: actPort[CHANNEL_ACT_KIND.CHANNELS_LOOK].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.channelsLook(input);
    }),
    [CHANNEL_ACT_KIND.CHANNELS_THREADS]: actPort[CHANNEL_ACT_KIND.CHANNELS_THREADS].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsThreads(input);
      },
    ),
  };
}
