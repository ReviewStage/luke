import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, askLive, type HostedClient, hostedClient } from "./hosted-link.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY, type MacCommandsLiveAnswer } from "./live-wire.js";
import {
  type MacCommand,
  type MacCommandKind,
  type MacCommandResult,
  macCommandKindsQuery,
} from "./mac-command-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

export const MAC_COMMAND_NOT_CLAIMED = { claimed: false } as const;

export interface HostedMacCommandClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
}

export class HostedMacCommandClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedMacCommandClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
  }

  settle(
    id: string,
    result: MacCommandResult,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.settle, { id, result }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  live(
    kinds: readonly MacCommandKind[],
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    MacCommandsLiveAnswer | { readonly failure: string },
    never,
    HttpClient.HttpClient
  > {
    return askLive(
      this.#hosted.live.macCommands,
      { kinds: macCommandKindsQuery(kinds), [LIVE_USER_QUERY]: userId },
      poll,
      after,
    ).pipe(
      Effect.catch((failed) =>
        Effect.succeed(
          failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.INVALID_TOKEN
            ? LIVE_SIGNED_OUT
            : { failure: "unanswered" },
        ),
      ),
    );
  }

  claim(
    id: string,
  ): Effect.Effect<
    MacCommand | typeof MAC_COMMAND_NOT_CLAIMED | undefined,
    never,
    HttpClient.HttpClient
  > {
    return askHosted(this.#hosted.macCommands.claim, { id }).pipe(
      Effect.map((answer): MacCommand => answer.command),
      Effect.catch((failed) =>
        Effect.succeed(failed._tag === "HostedRefused" ? MAC_COMMAND_NOT_CLAIMED : undefined),
      ),
    );
  }

  listening(
    kinds: readonly MacCommandKind[],
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.listening, {
      kinds: macCommandKindsQuery(kinds),
    }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }
}
