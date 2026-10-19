import { HTTP_METHOD } from "@luke/wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import {
  type MacCommand,
  type MacCommandResult,
  macCommandsAnswerSchema,
} from "./mac-command-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * mac-command-client.ts -- the Mac's side of the commands the account's agents queue for it: the held read that takes them, and each result posted back.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. The read is held by the
 * service while nothing waits, so it travels under a deadline that outlasts
 * the hold. Neither call fails: a read the service did not answer is
 * nothing, which the caller rests after, and a result it did not take is
 * false, since its call has already given up on it.
 */

/** The service's hold, and room for the answer to travel after it. */
const HELD_READ_TIMEOUT_MS = 35_000;

export interface HostedMacCommandClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedMacCommandClient {
  readonly #call: AccountCallEffects;
  readonly #held: AccountCallEffects;

  constructor(options: HostedMacCommandClientOptions) {
    const { credential } = options;
    this.#call = accountCall({ baseUrl: options.serviceBaseUrl, credential });
    this.#held = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: HELD_READ_TIMEOUT_MS,
    });
  }

  /** The commands claimed for this Mac, once one waits or the service's hold ends; nothing where the read was not answered. */
  waiting(): Effect.Effect<readonly MacCommand[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#held.ask(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MAC_COMMANDS },
        macCommandsAnswerSchema,
      ),
      (answer) => answer?.commands,
    );
  }

  /** One command's result posted back; whether the service took it. */
  settle(
    id: string,
    result: MacCommandResult,
  ): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.MAC_COMMANDS,
        body: JSON.stringify({ id, result }),
      }),
      (answer) => callAnswered(answer) && answer.response.ok,
    );
  }
}
