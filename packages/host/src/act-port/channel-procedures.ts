import type {
  ArchivedChannelsView,
  ChannelArchiveParams,
  ChannelCreateParams,
  ChannelEditParams,
  ChannelLookParams,
  ChannelMoveParams,
  ChannelMoveView,
  ChannelsArchivedParams,
  ChannelsChanged,
  ChannelsFollowParams,
  ChannelsListParams,
  ChannelsMoved,
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
 * Channels view, so every one refuses the takeover and the hidden voice
 * window, in its own sentence. What the service answers comes back as the
 * panel's own answer, or why there is none. A workspace's channels are
 * followed while a panel holds a stream of them open: the host follows them
 * on the first stream and lets them go with the last, and every move it
 * tells reaches every stream of them. How many streams stand open of each
 * is all that is held here.
 */
export interface ChannelProceduresDependencies {
  host: {
    channelsList(params: ChannelsListParams): Effect.Effect<ChannelsView>;
    channelsCreate(params: ChannelCreateParams): Effect.Effect<ChannelsView>;
    channelsEdit(params: ChannelEditParams): Effect.Effect<ChannelsView>;
    channelsArchive(params: ChannelArchiveParams): Effect.Effect<ChannelsView>;
    channelsUnarchive(params: ChannelUnarchiveParams): Effect.Effect<ChannelsView>;
    channelsArchived(params: ChannelsArchivedParams): Effect.Effect<ArchivedChannelsView>;
    channelsLook(params: ChannelLookParams): Effect.Effect<ChannelsView>;
    channelsThreads(params: ChannelThreadsParams): Effect.Effect<ChannelThreadsView>;
    channelsMove(params: ChannelMoveParams): Effect.Effect<ChannelMoveView>;
    /** A workspace's channels followed at the host, heard through `onChannelsChanged`; following again starts over. */
    channelsFollow(params: ChannelsFollowParams): Effect.Effect<void>;
    channelsUnfollow(params: ChannelsFollowParams): Effect.Effect<void>;
    onChannelsChanged(listener: (changed: ChannelsChanged) => void): () => void;
  };
}

/** The refusal a window that draws no Channels view hears, or nothing for a panel. */
function refuseUnlessPanel<E>(actor: ActSender, refused: () => E): Effect.Effect<void, E> {
  return actor.panel ? Effect.void : Effect.fail(refused());
}

export function channelProcedures(dependencies: ChannelProceduresDependencies) {
  const { host } = dependencies;
  /** Every workspace a window holds a stream of channels open of, so the host lets one go only with the last. */
  const openChannels: OpenFollows<ChannelsMoved> = MutableHashMap.empty();
  return {
    [CHANNEL_ACT_KIND.CHANNELS_LIST]: actPort[CHANNEL_ACT_KIND.CHANNELS_LIST].effect(function* ({
      input,
      context,
      errors,
    }) {
      yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
      return yield* host.channelsList(input);
    }),
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
    [CHANNEL_ACT_KIND.CHANNELS_ARCHIVED]: actPort[CHANNEL_ACT_KIND.CHANNELS_ARCHIVED].effect(
      function* ({ input, context, errors }) {
        yield* refuseUnlessPanel(context.actor, () => errors.REFUSED());
        return yield* host.channelsArchived(input);
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
        const moves = followedStream(
          {
            keyOf: (params: ChannelsFollowParams) => params.workspaceId,
            follow: host.channelsFollow,
            unfollow: host.channelsUnfollow,
            onChanged: host.onChannelsChanged,
            valueOf: (changed: ChannelsChanged, params: ChannelsFollowParams) =>
              changed.workspaceId === params.workspaceId
                ? Option.some(changed.heard)
                : Option.none(),
          },
          openChannels,
          input,
        );
        return streamed(yield* Stream.toAsyncIterableEffect(moves));
      },
    ),
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
