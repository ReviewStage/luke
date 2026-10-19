import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import {
  FACTORY_WORLD_CALL_FAILURE,
  type FactoryWorldParams,
  type FactoryWorldView,
  factoryWorldParamsSchema,
} from "./factory-world-view.js";
import { factoryWorldAnswerSchema } from "./factory-world-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { HOSTED_API_ERROR, hostedErrorSchema, readServiceAnswer } from "./service-wire.js";

/**
 * factory-world-client.ts -- the window's side of a workspace's Factory world, as the host asks the service for it.
 *
 * The one call is the account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. It answers what the service said or
 * why there is no answer, never a failure, because its caller does the same
 * with either: says why, and offers to try again. A request the service would
 * refuse by shape is answered unanswered here without traveling.
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

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}

/** The window's read of a workspace's world. */
export class HostedFactoryWorldClient {
  readonly #call: AccountCallEffects;

  constructor(options: HostedFactoryWorldClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** The workspace's world as it stands now; null where it has no repository to draw. */
  world(params: FactoryWorldParams): Effect.Effect<FactoryWorldView, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(factoryWorldParamsSchema)(params));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.FACTORY_WORLD,
        body: JSON.stringify(admitted),
      });
      if (!callAnswered(answer)) return UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) {
        const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
        return refusal === HOSTED_API_ERROR.NOT_FOUND ? NOT_FOUND : UNANSWERED;
      }
      return (
        Result.getOrUndefined(readServiceAnswer(factoryWorldAnswerSchema)(payload)) ?? UNANSWERED
      );
    });
  }
}
