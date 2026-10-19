import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  HOSTED_SERVICE_PATH,
} from "@luke/features";
import {
  type AccountPreferences,
  accountPreferencesFromWire,
  type ExperimentChoices,
  experimentChoicesFrom,
  NO_EXPERIMENTS,
} from "@luke/settings";
import {
  HTTP_METHOD,
  isRecord,
  isWireNumber,
  type UnparsedWireValue,
  unparsedWire,
  type WireValue,
  WireValueSchema,
} from "@luke/wire";
import { Effect, Schema as EffectSchema, type Layer, SchemaGetter, SchemaIssue } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";

export interface AccountPreferencesAnswer {
  preferences: AccountPreferences;
  hasStoredSnapshot: boolean;
  /**
   * The experiments the account turned on or back off. A service that
   * answers no such part predates it, and every experiment is off there.
   */
  experiments: ExperimentChoices;
}

interface AccountPreferencesClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
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
  // Note that experiments are read on their own reader, which passes over a key it does not know,
  // because a newer service's experiment must not cost this Mac the voice beside it.
  const experiments =
    value.experiments === undefined ? NO_EXPERIMENTS : experimentChoicesFrom(value.experiments);
  if (experiments === undefined) return undefined;
  return {
    preferences,
    hasStoredSnapshot: value.updatedAt !== undefined,
    experiments,
  };
}

/** A value admitted by its declaration alone, never re-validated once decoded. */
const carried = <A>(): EffectSchema.Codec<A, A> =>
  EffectSchema.declare((_value): _value is A => true);

/**
 * The account preferences answer, decoded through `AccountCallEffects.ask`.
 * The settings vocabulary's own reader stays the one parser for the
 * snapshot's shape; this schema is the boundary that reader now decodes
 * through, in place of the caller's hand-written reader `AccountCallEffects.read`
 * used to take.
 */
const accountPreferencesAnswerSchema: EffectSchema.Codec<AccountPreferencesAnswer, WireValue> =
  WireValueSchema.pipe(
    EffectSchema.decodeTo(carried<AccountPreferencesAnswer>(), {
      decode: SchemaGetter.transformEffect((value: WireValue) => {
        const answer = accountPreferencesAnswerFromWire(unparsedWire(value));
        return answer === undefined
          ? Effect.fail(new SchemaIssue.InvalidValue(undefined, value))
          : Effect.succeed(answer);
      }),
      encode: SchemaGetter.transformEffect((answer: AccountPreferencesAnswer) =>
        Effect.fail(new SchemaIssue.Forbidden({ message: "encoding is not supported" }, answer)),
      ),
    }),
  );

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
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  readPreferences(): Effect.Effect<AccountPreferencesAnswer | undefined> {
    return this.#over(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES },
        accountPreferencesAnswerSchema,
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
      this.#call.ask(
        {
          method: HTTP_METHOD.PUT,
          path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
          body: JSON.stringify({ preferences: parsed }),
        },
        accountPreferencesAnswerSchema,
      ),
    );
  }

  /**
   * Writes the experiments named, each on or off, over what the account
   * holds, and answers the snapshot as it then stands: the service merges a
   * patch rather than replacing the part, so a Mac that knows fewer
   * experiments never erases another's.
   */
  writeExperiments(
    experiments: ExperimentChoices,
  ): Effect.Effect<AccountPreferencesAnswer | undefined> {
    return this.#over(
      this.#call.ask(
        {
          method: HTTP_METHOD.PUT,
          path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
          body: JSON.stringify({ experiments }),
        },
        accountPreferencesAnswerSchema,
      ),
    );
  }

  #over<Answer>(
    effect: Effect.Effect<Answer, never, HttpClient.HttpClient>,
  ): Effect.Effect<Answer> {
    return Effect.provide(effect, this.#client);
  }
}
