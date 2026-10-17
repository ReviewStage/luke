import { HTTP_METHOD } from "@luke/wire";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountBearer,
  accountCall,
  callAnswered,
} from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { type MacCommandsLiveAnswer, macCommandsLiveAnswerSchema } from "./live-wire.js";
import {
  type MacCommand,
  type MacCommandResult,
  macCommandClaimAnswerSchema,
  macCommandsAnswerSchema,
} from "./mac-command-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

/**
 * mac-command-client.ts -- the Mac's side of the commands the account's agents queue for it: the held read that takes them, and each result posted back.
 *
 * Every call is the one account call, so the bearer is read fresh per
 * attempt and a 401 is renewed and retried once. The read is held by the
 * service while nothing waits, so it travels under a deadline that outlasts
 * the hold. The live side asks at once: the unclaimed commands sealed for
 * following over Neon Realtime, one command claimed by its id, and that the
 * Mac listens. No call fails: a read the service did not answer is nothing,
 * which the caller rests after, a claim it did not grant is nothing, and a
 * result or a presence it did not take is false.
 */

/** The service's hold, and room for the answer to travel after it. */
const HELD_READ_TIMEOUT_MS = 35_000;

export interface HostedMacCommandClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedMacCommandClient {
  readonly #call: AccountCallEffects;
  readonly #held: AccountCallEffects;

  constructor(options: HostedMacCommandClientOptions) {
    const credential = accountBearer(options);
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

  /**
   * The commands no Mac of the account has claimed, sealed for following over
   * Neon Realtime, answered at once; nothing where the deployment has no
   * Realtime, or for anything else, which the caller answers by holding its
   * read open as before.
   */
  live(): Effect.Effect<MacCommandsLiveAnswer | undefined, never, HttpClient.HttpClient> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LIVE_MAC_COMMANDS },
      macCommandsLiveAnswerSchema,
    );
  }

  /** One command heard of over Realtime, claimed for this Mac; nothing where another took it, it waited too long, or the claim was not answered. */
  claim(id: string): Effect.Effect<MacCommand | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.MAC_COMMAND_CLAIM,
          body: JSON.stringify({ id }),
        },
        macCommandClaimAnswerSchema,
      ),
      (answer) => answer?.command,
    );
  }

  /** That this Mac listens for the account's commands now; whether the service took it. */
  listening(): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.map(
      this.#call.send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.MAC_COMMANDS_LISTENING,
      }),
      (answer) => callAnswered(answer) && answer.response.ok,
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
