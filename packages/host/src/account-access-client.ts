import type { CallCredential } from "@repo/features";
import type { SupportAccessAnswerWire } from "@repo/features/account-wire";
import {
  askHosted,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "@repo/features/hosted-link";
import { Effect, type Layer } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import type * as HttpClient from "effect/http/HttpClient";
import { type AppAccessSlice, NO_ACCESS } from "./app-state.js";

interface AccountAccessClientOptions {
  credential: CallCredential;
  sessionCredential: CallCredential;
  serviceBaseUrl: string;
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
}

export class AccountAccessClient {
  readonly #hosted: HostedClient;
  readonly #inSession: HostedClient;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: AccountAccessClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
    this.#inSession = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.sessionCredential,
      inSession: true,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  readAccess(): Effect.Effect<AppAccessSlice> {
    return askHosted(this.#hosted.account.access, undefined).pipe(
      Effect.map(
        (answer): AppAccessSlice => ({
          admin: answer.admin,
          ...(typeof answer.supportAccessUntil === "number"
            ? { supportAccessUntil: answer.supportAccessUntil }
            : undefined),
        }),
      ),
      Effect.orElseSucceed((): AppAccessSlice => ({ admin: false })),
      Effect.provide(this.#client),
    );
  }

  writeSupportAccess(grant: boolean): Effect.Effect<SupportAccessAnswerWire, HostedFailure> {
    const write = grant
      ? this.#inSession.supportAccess.grant
      : this.#inSession.supportAccess.revoke;
    return askHosted(write, undefined).pipe(Effect.provide(this.#client));
  }
}

interface AccountAccessHolderOptions {
  readonly client: Pick<AccountAccessClient, "readAccess">;
  readonly accountKey: () => string | undefined;
  readonly publish: (access: AppAccessSlice) => void;
}

export interface AccountAccessHolder {
  readonly current: () => AppAccessSlice;
  readonly refresh: Effect.Effect<void>;
  readonly accountChanged: Effect.Effect<void>;
  readonly forget: Effect.Effect<void>;
}

export function accountAccessHolder(options: AccountAccessHolderOptions): AccountAccessHolder {
  const { client, accountKey, publish } = options;
  let held: { readonly accountKey: string; readonly access: AppAccessSlice } | undefined;
  let generation = 0;

  const current = (): AppAccessSlice => {
    const key = accountKey();
    return key !== undefined && held?.accountKey === key ? held.access : NO_ACCESS;
  };

  const refresh = Effect.gen(function* () {
    const key = accountKey();
    if (key === undefined) return;
    const asked = generation;
    const access = yield* client.readAccess();
    if (generation !== asked || accountKey() !== key) return;
    held = { accountKey: key, access };
    publish(current());
  });

  const accountChanged = Effect.sync(() => publish(current()));

  const forget = Effect.sync(() => {
    generation += 1;
    held = undefined;
    publish(current());
  });

  return { current, refresh, accountChanged, forget };
}
