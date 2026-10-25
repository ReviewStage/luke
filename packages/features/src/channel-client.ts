import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  CHANNEL_CALL_FAILURE,
  type ChannelArchiveParams,
  type ChannelCallFailure,
  type ChannelCreateParams,
  type ChannelLookParams,
  type ChannelRenameParams,
  type ChannelsListParams,
  type ChannelsView,
  type ChannelThreadsParams,
  type ChannelThreadsView,
} from "./channel-view.js";
import { askHosted, type HostedClient, type HostedFailure, hostedClient } from "./hosted-link.js";
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

  /** A channel renamed, answering the workspace's channels as they then stand. */
  rename(params: ChannelRenameParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.rename, params));
  }

  /** A channel archived, answering the workspace's channels as they then stand. */
  archive(params: ChannelArchiveParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.archive, params));
  }

  /** The reader's look at a channel stamped, answering the workspace's channels as they then stand. */
  look(params: ChannelLookParams): Effect.Effect<ChannelsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.look, params));
  }

  /** A channel's latest threads the reader may read, oldest first. */
  threads(
    params: ChannelThreadsParams,
  ): Effect.Effect<ChannelThreadsView, never, HttpClient.HttpClient> {
    return answered(askHosted(this.#hosted.channels.threads, params));
  }
}
