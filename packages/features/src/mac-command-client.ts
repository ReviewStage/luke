import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, askLive, type HostedClient, hostedClient } from "./hosted-link.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY, type MacCommandsLiveAnswer } from "./live-wire.js";
import {
  type MacBrowserResult,
  type MacCommand,
  type MacCommandKind,
  type MacCommandSettleResult,
  macCommandKindsQuery,
} from "./mac-command-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * mac-command-client.ts -- the Mac's side of the commands the account's agents queue for it: the unclaimed ones of its kinds followed live, each claimed by its id, that the Mac listens, and each result posted back.
 *
 * Each is a procedure of the hosted contract (`contract/live.ts`,
 * `contract/mac-commands.ts`) over the one account call, so the bearer is
 * read fresh per attempt and a 401 is renewed and retried once. The Mac
 * asks for the unclaimed commands of its kinds sealed (or, polling, inline
 * and held until they move) for the account it started for, claims each it
 * hears of by its id, and says it listens. No call fails: a read refused as
 * signed out is `LIVE_SIGNED_OUT` and any other unanswered a failure the
 * caller asks again, a claim not granted is nothing, and a presence or a
 * result not taken is false, its call having given up on it. A browser
 * command's result, which may carry an image, is posted to its own route.
 */

export interface HostedMacCommandClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
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

  /** One command's result posted back; whether the service took it. */
  settle(
    id: string,
    result: MacCommandSettleResult,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.settle, { id, result }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /** One browser command's result, image and all, posted back; whether the service took it. */
  settleBrowser(
    id: string,
    result: MacBrowserResult,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.settleBrowser, { id, result }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }

  /**
   * The commands of the kinds named that no Mac of the account has claimed,
   * sealed for following, or with `poll` their rows inline, held past
   * `after` until they move, for the account `userId` names: signed out
   * where the session is no longer that account's, a failure where the
   * service answered none.
   */
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

  /** One command heard of live, claimed for this Mac; nothing where another took it, it waited too long, or the claim was not answered. */
  claim(id: string): Effect.Effect<MacCommand | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.claim, { id }).pipe(
      Effect.map((answer): MacCommand | undefined => answer.command),
      Effect.orElseSucceed(() => undefined),
    );
  }

  /** That this Mac listens now for the kinds named; whether the service took it. */
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
