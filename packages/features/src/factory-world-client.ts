import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { CallCredential } from "./account-call.js";
import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldParams,
  type FactoryWorldView,
  factoryWorldParamsSchema,
} from "./factory-world-view.js";
import { askHosted, type HostedClient, hostedClient } from "./hosted-link.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * factory-world-client.ts -- the window's side of a workspace's Factory world, as the host asks the service for it.
 *
 * The one call is the hosted contract's procedure over the account call
 * (`hosted-link.ts`), so the bearer is read fresh per attempt and a 401 is
 * renewed and retried once. It answers what the service said or why there is
 * no answer, never a failure, because its caller does the same with either:
 * says why, and offers to try again. A request the service would refuse by
 * shape is answered unanswered here without traveling.
 */

export interface HostedFactoryWorldClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { failure: FACTORY_WORLD_CALL_FAILURE.UNANSWERED } as const;

const NOT_FOUND = { failure: FACTORY_WORLD_CALL_FAILURE.NOT_FOUND } as const;

/** The window's read of a workspace's world. */
export class HostedFactoryWorldClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedFactoryWorldClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The workspace's world as it stands now; null where it has no repository to draw. */
  world(params: FactoryWorldParams): Effect.Effect<FactoryWorldView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(factoryWorldParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return Effect.catch(askHosted(this.#hosted.factory.world, admitted), (failed) =>
      Effect.succeed(
        failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.NOT_FOUND
          ? NOT_FOUND
          : UNANSWERED,
      ),
    );
  }
}
