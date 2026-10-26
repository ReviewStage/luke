import type { HostedChannelClient } from "@luke/features";
import {
  type ArchivedChannelsView,
  CHANNEL_CALL_FAILURE,
  type ChannelMoveView,
  type ChannelsChanged,
  type ChannelsView,
  type ChannelThreadsView,
  channelArchiveParamsSchema,
  channelCreateParamsSchema,
  channelEditParamsSchema,
  channelLookParamsSchema,
  channelMoveParamsSchema,
  channelsArchivedParamsSchema,
  channelsFollowParamsSchema,
  channelsListParamsSchema,
  channelThreadsParamsSchema,
  channelUnarchiveParamsSchema,
} from "@luke/features/channel-view";
import { LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  readParams,
} from "@luke/gateway";
import { Effect, FiberMap, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { followChannels } from "./channel-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import { type LiveClient, openRealtimeClient } from "./live-follow.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-channels.ts -- a workspace's channels, asked of the service on the window's behalf: listed, made, edited, archived, unarchived, looked at, a page of one's threads read, and a thread moved; and followed live while a window draws them.
 *
 * Nothing is held here but the follows. Every ask is one call of the service
 * answered whole, every write on a channel answering the workspace's
 * channels as they then stand, so a window draws the service's word rather
 * than its own guess. A workspace a window follows is followed over Realtime
 * (`channel-follow.ts`), and which of its channels moved is told to every
 * window as `CHANNELS_CHANGED`, which reads them again itself. Behind a
 * closed account gate, or on a run that sends nothing, every ask answers
 * unanswered and nothing is followed; a sign-out lets every follow go.
 */

/** The service's side of the channels, as this concern asks it. */
type ChannelsClient = Pick<
  HostedChannelClient,
  | "list"
  | "create"
  | "edit"
  | "archive"
  | "unarchive"
  | "archived"
  | "look"
  | "threads"
  | "move"
  | "live"
>;

export interface ChannelsDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, which a follow names from its start; none where nobody is. */
  accountId: () => string | undefined;
  client: ChannelsClient;
  /** Realtime's client for a follow's subscription; Realtime's own where none is handed in. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
}

export interface ChannelsComposer extends Composer {
  /** Every follow let go, as a sign-out lets them go. */
  readonly reset: Effect.Effect<void>;
}

const UNANSWERED = { failure: CHANNEL_CALL_FAILURE.UNANSWERED } as const;

export function composeChannels(
  dependencies: ChannelsDependencies,
): Effect.Effect<ChannelsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient;
    const follows = yield* FiberMap.make<string>();
    return composed(dependencies, http, follows);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything but what a window follows. */
function composed(
  dependencies: ChannelsDependencies,
  http: HttpClient.HttpClient,
  follows: FiberMap.FiberMap<string>,
): ChannelsComposer {
  const { kernel, account, client } = dependencies;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The service asked behind the gate, over the host's own HTTP client. */
  const asked = <Answer>(
    call: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer | typeof UNANSWERED> =>
    gate() ? Effect.provideService(call, HttpClient.HttpClient, http) : Effect.succeed(UNANSWERED);

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CHANNELS_LIST]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelsListParamsSchema,
          params,
          "a list names a workspace",
        );
        return carried<ChannelsView>(yield* asked(client.list(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_CREATE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelCreateParamsSchema,
          params,
          "a channel made names its workspace, its name, and its purpose",
        );
        return carried<ChannelsView>(yield* asked(client.create(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelEditParamsSchema,
          params,
          "an edit names a workspace's channel and its new name or purpose",
        );
        return carried<ChannelsView>(yield* asked(client.edit(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_UNARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelUnarchiveParamsSchema,
          params,
          "an unarchive names a workspace's channel",
        );
        return carried<ChannelsView>(yield* asked(client.unarchive(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_ARCHIVED]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelsArchivedParamsSchema,
          params,
          "a read of archived channels names a workspace",
        );
        return carried<ArchivedChannelsView>(yield* asked(client.archived(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_MOVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelMoveParamsSchema,
          params,
          "a move names a thread and the channel it goes to",
        );
        return carried<ChannelMoveView>(yield* asked(client.move(read)));
      }),
    // A window follows a workspace's channels while it draws them; following
    // again starts over, so a window that follows later hears every channel
    // moved, and letting them go ends it.
    [GATEWAY_METHOD.CHANNELS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          channelsFollowParamsSchema,
          params,
          "a follow names a workspace",
        );
        if (!gate()) return {};
        // The account the follow starts for, which every read names, so one under another's session is refused as signed out and ends.
        const userId = dependencies.accountId();
        const follow = followChannels({
          live: (poll, after) =>
            userId === undefined
              ? Effect.succeed(LIVE_SIGNED_OUT)
              : asked(client.live(workspaceId, userId, poll, after)),
          openLive: dependencies.openLive ?? openRealtimeClient,
          now: kernel.now,
          publish: (heard) => {
            const changed: ChannelsChanged = { workspaceId, heard };
            kernel.emit(GATEWAY_EVENT.CHANNELS_CHANGED, carried(changed));
          },
        });
        yield* FiberMap.run(follows, workspaceId, follow);
        return {};
      }),
    [GATEWAY_METHOD.CHANNELS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          channelsFollowParamsSchema,
          params,
          "a follow names a workspace",
        );
        yield* FiberMap.remove(follows, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.CHANNELS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelArchiveParamsSchema,
          params,
          "an archive names a workspace's channel",
        );
        return carried<ChannelsView>(yield* asked(client.archive(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_LOOK]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelLookParamsSchema,
          params,
          "a look names a workspace's channel",
        );
        return carried<ChannelsView>(yield* asked(client.look(read)));
      }),
    [GATEWAY_METHOD.CHANNELS_THREADS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelThreadsParamsSchema,
          params,
          "a read names a channel",
        );
        return carried<ChannelThreadsView>(yield* asked(client.threads(read)));
      }),
  };

  return { methods, lifetime: Effect.void, reset: FiberMap.clear(follows) };
}
