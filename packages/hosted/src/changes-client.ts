import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import type * as HttpClient from "@effect/platform/HttpClient";
import type { WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Either, type Layer } from "effect";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import {
  type ChangesAnswer,
  type ChangesRequest,
  changesAnswerSchema,
  changesRequestSchema,
} from "./reads-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";

export interface HostedChangesClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  requestTimeoutMs?: number;
}

/** The change-signal poll is one method on its path. */
const CHANGES_METHOD = "POST";

/**
 * The request as the record that travels, field by field: the device, and
 * each instant exactly as the caller stated it — a number, `null` to clear,
 * or left out to leave — so what is sent is what the schema admitted and
 * never a field the schema did not name.
 */
function changesRecord(request: ChangesRequest): WireRecord {
  return {
    deviceId: request.deviceId,
    ...(request.activeUntil !== undefined ? { activeUntil: request.activeUntil } : undefined),
    ...(request.quietUntil !== undefined ? { quietUntil: request.quietUntil } : undefined),
  };
}

/**
 * A device's side of the change signal: one poll that carries the device's
 * own presence and quiet instants and answers where every resource's read
 * stands. It is the shared account call — the token read fresh per attempt, a
 * 401 refreshed and retried once, the answer validated by the shared wire
 * contract — and a failure resolves to nothing, because the next poll asks
 * again. A request the service would refuse by shape is refused here without
 * traveling at all.
 */
export class HostedChangesClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedChangesClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  poll(request: ChangesRequest): Promise<ChangesAnswer | undefined> {
    const admitted = Either.getOrUndefined(
      readEither(changesRequestSchema)(changesRecord(request)),
    );
    if (admitted === undefined) return Promise.resolve(undefined);
    return this.#run(
      this.#call.ask(
        {
          method: CHANGES_METHOD,
          path: HOSTED_SERVICE_PATH.CHANGES,
          body: JSON.stringify(changesRecord(admitted)),
        },
        changesAnswerSchema,
      ),
    );
  }

  #run<Answer>(effect: Effect.Effect<Answer, never, HttpClient.HttpClient>): Promise<Answer> {
    return Effect.runPromise(Effect.provide(effect, this.#client));
  }
}
