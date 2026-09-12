import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import type * as HttpClient from "@effect/platform/HttpClient";
import {
  type AccountCallEffects,
  type AccountToken,
  accountBearer,
  accountCall,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { type AccountPreferences, accountPreferencesFromWire } from "@sidecar/settings";
import { HTTP_METHOD, isRecord, isWireNumber, type UnparsedWireValue } from "@sidecar/wire";
import { Effect, type Layer } from "effect";

export interface AccountPreferencesAnswer {
  preferences: AccountPreferences;
  hasStoredSnapshot: boolean;
}

export interface AccountPreferencesClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  requestTimeoutMs?: number;
}

function accountPreferencesAnswerFromWire(
  value: UnparsedWireValue,
): AccountPreferencesAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const preferences = accountPreferencesFromWire(value.preferences);
  if (preferences === undefined) return undefined;
  if (value.updatedAt !== undefined && !isWireNumber(value.updatedAt)) return undefined;
  return {
    preferences,
    hasStoredSnapshot: value.updatedAt !== undefined,
  };
}

/**
 * Reads and writes the account preference snapshot. The local store decides
 * which settings are eligible to travel; this client validates the service's
 * answer, and the account call behind it is the same one every hosted client
 * makes its requests through.
 */
export class AccountPreferencesClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: AccountPreferencesClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  readPreferences(): Effect.Effect<AccountPreferencesAnswer | undefined> {
    return this.#over(
      this.#call.read(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES },
        accountPreferencesAnswerFromWire,
      ),
    );
  }

  writePreferences(
    preferences: AccountPreferences,
  ): Effect.Effect<AccountPreferencesAnswer | undefined> {
    // SAFETY: AccountPreferences is JSON-compatible; the strict parser protects this runtime boundary.
    const parsed = accountPreferencesFromWire(preferences as UnparsedWireValue);
    if (parsed === undefined) return Effect.succeed(undefined);
    return this.#over(
      this.#call.read(
        {
          method: HTTP_METHOD.PUT,
          path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
          body: JSON.stringify({ preferences: parsed }),
        },
        accountPreferencesAnswerFromWire,
      ),
    );
  }

  #over<Answer>(
    effect: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer> {
    return Effect.provide(effect, this.#client);
  }
}
