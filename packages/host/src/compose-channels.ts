import type { HostedChannelClient } from "@luke/features";
import {
  CHANNEL_CALL_FAILURE,
  type ChannelsView,
  type ChannelThreadsView,
  channelArchiveParamsSchema,
  channelCreateParamsSchema,
  channelLookParamsSchema,
  channelRenameParamsSchema,
  channelsListParamsSchema,
  channelThreadsParamsSchema,
} from "@luke/features/channel-view";
import { carried, GATEWAY_METHOD, type GatewayMethodTable, readParams } from "@luke/gateway";
import { Effect, type Scope } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-channels.ts -- a workspace's channels, asked of the service on the window's behalf: listed, made, renamed, archived, looked at, and one's threads read.
 *
 * Nothing is held here. Every ask is one call of the service answered whole,
 * every write answering the workspace's channels as they then stand, so a
 * window draws the service's word rather than its own guess. Behind a closed
 * account gate, or on a run that sends nothing, every ask answers
 * unanswered.
 */

/** The service's side of the channels, as this concern asks it. */
export type ChannelsClient = Pick<
  HostedChannelClient,
  "list" | "create" | "rename" | "archive" | "look" | "threads"
>;

export interface ChannelsDependencies {
  kernel: { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: ChannelsClient;
}

export type ChannelsComposer = Composer;

const UNANSWERED = { failure: CHANNEL_CALL_FAILURE.UNANSWERED } as const;

export function composeChannels(
  dependencies: ChannelsDependencies,
): Effect.Effect<ChannelsComposer, never, Scope.Scope | HttpClient.HttpClient> {
  return Effect.gen(function* () {
    return composed(dependencies, yield* HttpClient.HttpClient);
  });
}

/** The composer's one table, built from its seams; nothing here starts anything. */
function composed(dependencies: ChannelsDependencies, http: HttpClient.HttpClient): ChannelsComposer {
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
        const read = yield* readParams(channelsListParamsSchema, params, "a list names a workspace");
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
    [GATEWAY_METHOD.CHANNELS_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          channelRenameParamsSchema,
          params,
          "a rename names a workspace's channel and its new name",
        );
        return carried<ChannelsView>(yield* asked(client.rename(read)));
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
        const read = yield* readParams(channelThreadsParamsSchema, params, "a read names a channel");
        return carried<ChannelThreadsView>(yield* asked(client.threads(read)));
      }),
  };

  return { methods, lifetime: Effect.void };
}
