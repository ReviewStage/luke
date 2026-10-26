import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import type { ChannelsLiveAnswer } from "./channel-live.js";
import {
  type ArchivedChannelsView,
  CHANNEL_CALL_FAILURE,
  type ChannelArchiveParams,
  type ChannelCallFailure,
  type ChannelCreateParams,
  type ChannelEditParams,
  type ChannelLookParams,
  type ChannelMoveParams,
  type ChannelMoveView,
  type ChannelsArchivedParams,
  type ChannelsListParams,
  type ChannelsView,
  type ChannelThreadsParams,
  type ChannelThreadsView,
  type ChannelUnarchiveParams,
} from "./channel-view.js";
import {
  askHosted,
  askLive,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY } from "./live-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "./service-wire.js";

/**
 * channel-client.ts -- the window's side of a workspace's channels, as the host asks the service for them.
 *
 * Every call is a procedure of the hosted contract (`contract/channels.ts`)
 * carried by the one account call (`hosted-link.ts`), so the bearer is read
 * fresh per attempt and a 401 is renewed and retried once. Each call answers
 * what the service said or why there is no answer, never a failure, because
 * every caller does the same with one: says why, and offers to try again.
 */

export interface HostedChannelClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

type Failed = { readonly failure: ChannelCallFailure };

/** The refusals a channel call may answer with, by the service's own word for each. */
const REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: CHANNEL_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.CHANNEL_NAME_TAKEN]: CHANNEL_CALL_FAILURE.NAME_TAKEN,
  [HOSTED_API_ERROR.NOT_PERMITTED]: CHANNEL_CALL_FAILURE.NOT_PERMITTED,
  [HOSTED_API_ERROR.INVALID_REQUEST]: CHANNEL_CALL_FAILURE.INVALID,
} satisfies Readonly<Partial<Record<HostedApiError, ChannelCallFailure>>>;

/** A procedure's answer, or the refusal it failed with where it is one this client names; unanswered for everything else. */
function answered<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | Failed, never, HttpClient.HttpClient> {
  return Effect.catch(asked, (failed) => {
    const named: Readonly<Partial<Record<HostedApiError, ChannelCallFailure>>> = REFUSALS;
    const failure =
      failed._tag === "HostedRefused" ? named[failed.refusal] : CHANNEL_CALL_FAILURE.UNANSWERED;
    return Effect.succeed({ failure: failure ?? CHANNEL_CALL_FAILURE.UNANSWERED });
  });
}

/** A live read's answer, signed out where the service refused the session as another account's (`LIVE_SIGNED_OUT`), or the refusal it failed with, as `answered` reads one. */
function liveAnswered<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | Failed | typeof LIVE_SIGNED_OUT, never, HttpClient.HttpClient> {
  return answered(
    Effect.catchIf(
      asked,
      (failed) =>
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN,
      () => Effect.succeed(LIVE_SIGNED_OUT),
    ),
  );
}

/** The window's reads and writes of a workspace's channels. */
export class HostedChannelClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedChannelClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The workspace's open channels, each with what waits on the reader there and when they last looked. */
  list(params: ChannelsListParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.list, params));
  }

  /** A channel made, answering the workspace's channels as they then stand. */
  create(params: ChannelCreateParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.create, params));
  }

  /** A channel's name, purpose, or both edited, answering the workspace's channels as they then stand. */
  edit(params: ChannelEditParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.edit, params));
  }

  /** A channel archived, answering the workspace's channels as they then stand. */
  archive(params: ChannelArchiveParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.archive, params));
  }

  /** An archived channel opened again, answering the workspace's channels as they then stand. */
  unarchive(
    params: ChannelUnarchiveParams,
  ): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.unarchive, params));
  }

  /** The workspace's archived channels, the latest archived first. */
  archived(
    params: ChannelsArchivedParams,
  ): Effect.Effect<ArchivedChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.archived, params));
  }

  /** A thread moved into another open channel of its workspace, answering it as it then stands. */
  move(params: ChannelMoveParams): Effect.Effect<ChannelMoveView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.move, params));
  }

  /**
   * A workspace's channels sealed for following over Neon Realtime, to a
   * member of it and for the account named, or with their rows inline where
   * `poll` asks for them, held by the service until they move past `after`;
   * signed out where the session is another account's, or why not.
   */
  live(
    workspaceId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    ChannelsLiveAnswer | Failed | typeof LIVE_SIGNED_OUT,
    never,
    HttpClient.HttpClient
  > {
    return liveAnswered(
      askLive(this.#hosted.live.channels, { workspaceId, [LIVE_USER_QUERY]: userId }, poll, after),
    );
  }

  /** The reader's look at a channel stamped, answering the workspace's channels as they then stand. */
  look(params: ChannelLookParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.look, params));
  }

  /** A page of a channel's threads the reader may read, oldest first, older ones before the thread `before` names. */
  threads(
    params: ChannelThreadsParams,
  ): Effect.Effect<ChannelThreadsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.threads, params));
  }
}
