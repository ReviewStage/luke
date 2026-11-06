import type { CallCredential } from "@repo/features";
import type { AccountPreferencesAnswerWire } from "@repo/features/account-wire";
import { askHosted, type HostedClient, hostedClient } from "@repo/features/hosted-link";
import {
  type AccountPreferences,
  accountPreferencesFromParts,
  accountPreferencesParts,
  type ExperimentChoices,
  experimentChoicesFrom,
  NO_EXPERIMENTS,
} from "@repo/settings";
import {
  isRecord,
  isWireNumber,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@repo/wire";
import { Effect, type Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";

export interface AccountPreferencesAnswer {
  preferences: AccountPreferences;
  hasStoredSnapshot: boolean;
  experiments: ExperimentChoices;
}

interface AccountPreferencesClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  requestTimeoutMs?: number;
}

function accountPreferencesAnswerFromWire(
  value: UnparsedWireValue,
): AccountPreferencesAnswer | undefined {
  if (!isRecord(value)) return undefined;
  const preferences = accountPreferencesFromParts(value);
  if (preferences === undefined) return undefined;
  if (value.updatedAt !== undefined && !isWireNumber(value.updatedAt)) return undefined;
  const experiments =
    value.experiments === undefined ? NO_EXPERIMENTS : experimentChoicesFrom(value.experiments);
  if (experiments === undefined) return undefined;
  return {
    preferences,
    hasStoredSnapshot: value.updatedAt !== undefined,
    experiments,
  };
}

function answerOf(answer: AccountPreferencesAnswerWire): AccountPreferencesAnswer | undefined {
  return accountPreferencesAnswerFromWire(unparsedWire(answer as WireBoundaryInput));
}

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
    return this.#over(
      askHosted(this.#hosted.account.writePreferences, accountPreferencesParts(preferences)),
    );
  }

  writeExperiments(
    experiments: ExperimentChoices,
  ): Effect.Effect<AccountPreferencesAnswer | undefined> {
    return this.#over(askHosted(this.#hosted.account.writePreferences, { experiments }));
  }

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
