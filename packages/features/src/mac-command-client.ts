import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { askHosted, HOSTED_DEADLINE, type HostedClient, hostedClient } from "./hosted-link.js";
import type { MacCommand, MacCommandResult } from "./mac-command-wire.js";

/**
 * mac-command-client.ts -- the Mac's side of the commands the account's agents queue for it: the held read that takes them, and each result posted back.
 *
 * Both are procedures of the hosted contract (`contract/mac-commands.ts`)
 * over the one account call, so the bearer is read fresh per attempt and a
 * 401 is renewed and retried once. The read is held by the service while
 * nothing waits, so it is asked under the held deadline, which outlasts the
 * hold. Neither call fails: a read the service did not answer is nothing,
 * which the caller rests after, and a result it did not take is false,
 * since its call has already given up on it.
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

  /** The commands claimed for this Mac, once one waits or the service's hold ends; nothing where the read was not answered. */
  waiting(): Effect.Effect<readonly MacCommand[] | undefined, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.waiting, undefined, HOSTED_DEADLINE.HELD).pipe(
      Effect.map((answer): readonly MacCommand[] | undefined => answer.commands),
      Effect.orElseSucceed(() => undefined),
    );
  }

  /** One command's result posted back; whether the service took it. */
  settle(
    id: string,
    result: MacCommandResult,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return askHosted(this.#hosted.macCommands.settle, { id, result }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  }
}
