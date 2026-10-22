import type { CallCredential } from "@luke/features";
import type { AccountPreferencesAnswerWire } from "@luke/features/account-wire";
import { askHosted, type HostedClient, hostedClient } from "@luke/features/hosted-link";
import {
  type AccountPreferences,
  accountPreferencesFromParts,
  accountPreferencesParts,
  type ExperimentChoices,
  experimentChoicesFrom,
  NO_EXPERIMENTS,
} from "@luke/settings";
import {
  isRecord,
  isWireNumber,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { Effect, type Layer } from "effect";
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
  // Note that the link choice is joined from its own part, which a service that predates it answers none of.
  const preferences = accountPreferencesFromParts(value);
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

/**
 * The snapshot the link read, through the settings vocabulary's own reader,
 * which stays the one parser for its shape: the wire knows each part only as
 * far as it is JSON (`@luke/features/account-wire`).
 */
function answerOf(answer: AccountPreferencesAnswerWire): AccountPreferencesAnswer | undefined {
  // SAFETY: the link read the snapshot out of the response's JSON text, so every part is a JSON value.
  return accountPreferencesAnswerFromWire(unparsedWire(answer as WireBoundaryInput));
}

/**
 * Reads and writes the account preference snapshot. The local store decides
 * which settings are eligible to travel; this client validates the service's
 * answer, and the account call behind it is the same one every hosted client
 * makes its requests through.
 */
export class AccountPreferencesClient {
  readonly #hosted: HostedClient;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: AccountPreferencesClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  readPreferences(): Effect.Effect<AccountPreferencesAnswer | undefined> {
    return this.#over(askHosted(this.#hosted.account.preferences, undefined));
  }

  writePreferences(
    preferences: AccountPreferences,
  ): Effect.Effect<AccountPreferencesAnswer | undefined> {
    // Note that the link choice is sent as its own part only where this device holds one, so a device that never chose clears no other's.
    return this.#over(
      askHosted(this.#hosted.account.writePreferences, accountPreferencesParts(preferences)),
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
    return this.#over(askHosted(this.#hosted.account.writePreferences, { experiments }));
  }

  /** One ask over the client this one was handed: the snapshot as it reads, or nothing for any failure. */
  #over<E>(
    asked: Effect.Effect<AccountPreferencesAnswerWire, E, HttpClient.HttpClient>,
  ): Effect.Effect<AccountPreferencesAnswer | undefined> {
    return asked.pipe(
      Effect.map(answerOf),
      Effect.orElseSucceed(() => undefined),
      Effect.provide(this.#client),
    );
  }
}
