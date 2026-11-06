import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import { macCommandsContract } from "./contract/mac-commands.js";
import { hostedCall } from "./hosted-call.js";
import { failureSetOf } from "./hosted-failure.js";
import { askLive, type HostedClient, hostedClient } from "./hosted-link.js";
import { LIVE_SIGNED_OUT, LIVE_USER_QUERY, type MacCommandsLiveAnswer } from "./live-wire.js";
import {
  type MacCommandKind,
  type MacCommandResult,
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
 * caller asks again, and a claim, a presence, and a result answer what the
 * service said or how the call failed (`hostedCall`): a claim or a result
 * for a command the account does not hold is not found
 * (`MAC_COMMAND_NOT_CLAIMED`), and anything else unanswered.
 */

/** Why a claim, a presence, or a result has no answer: a command the account does not hold, or none at all. */
export const MAC_COMMAND_CALL_FAILURE = failureSetOf(macCommandsContract);

export type MacCommandCallFailure =
  (typeof MAC_COMMAND_CALL_FAILURE)[keyof typeof MAC_COMMAND_CALL_FAILURE];

/** What a claim the service refused answers: another Mac took the command, or it waited past the claim window. */
export const MAC_COMMAND_NOT_CLAIMED = { failure: MAC_COMMAND_CALL_FAILURE.NOT_FOUND } as const;

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

  /** One command's result posted back. */
  settle(id: string, result: MacCommandResult) {
    return hostedCall(this.#hosted.macCommands.settle, { id, result });
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

  /**
   * One command heard of live, claimed for this Mac: the command, not found
   * where the service refused it (another took it, or it waited too long),
   * or unanswered, which the caller may ask again.
   */
  claim(id: string) {
    return hostedCall(this.#hosted.macCommands.claim, { id });
  }

  /** That this Mac listens now for the kinds named. */
  listening(kinds: readonly MacCommandKind[]) {
    return hostedCall(this.#hosted.macCommands.listening, { kinds: macCommandKindsQuery(kinds) });
  }
}
