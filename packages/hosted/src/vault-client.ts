import * as FetchHttpClient from "@effect/platform/FetchHttpClient";
import type * as HttpClient from "@effect/platform/HttpClient";
import type { CloudAgentProviderId } from "@sidecar/session";
import { HTTP_METHOD } from "@sidecar/wire";
import { Effect, type Layer } from "effect";
import { type AccountCallEffects, accountBearer, accountCall } from "./account-call.js";
import type { AccountToken } from "./account-token.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import {
  type VaultKeyDeleteAnswer,
  type VaultKeyListEntry,
  type VaultKeyStoreAnswer,
  vaultKeyDeleteAnswerSchema,
  vaultKeyIsStorable,
  vaultKeyStoreAnswerSchema,
  vaultKeysListAnswerSchema,
} from "./vault-wire.js";

export interface HostedVaultClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The `HttpClient` a test hands over in place of the ambient fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  requestTimeoutMs?: number;
}

/**
 * The desktop's side of the provider-key vault: store a key, list what is
 * stored (ids and timestamps — the service holds no endpoint that reads a
 * key back, and stores no fragment for display), and delete one. Every ask
 * goes out on the one account call, and a failure resolves to nothing,
 * leaving the wording to the settings row that asked. Every call here is the
 * direct product of a press on that row; nothing reads the vault on a timer.
 */
export class HostedVaultClient {
  readonly #call: AccountCallEffects;
  readonly #client: Layer.Layer<HttpClient.HttpClient>;

  constructor(options: HostedVaultClientOptions) {
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#client = options.httpClient ?? FetchHttpClient.layer;
  }

  /**
   * Stores or replaces one provider's key. A key the service would refuse by
   * shape is refused here without traveling at all.
   */
  storeKey(
    providerId: CloudAgentProviderId,
    key: string,
  ): Promise<VaultKeyStoreAnswer | undefined> {
    if (!vaultKeyIsStorable(key)) return Promise.resolve(undefined);
    return this.#run(
      this.#call.ask(
        {
          method: HTTP_METHOD.POST,
          path: HOSTED_SERVICE_PATH.VAULT_KEY,
          body: JSON.stringify({ providerId, key }),
        },
        vaultKeyStoreAnswerSchema,
      ),
    );
  }

  /** Lists what is stored — provider ids and timestamps, never keys. */
  async listKeys(): Promise<readonly VaultKeyListEntry[] | undefined> {
    const answer = await this.#run(
      this.#call.ask(
        { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.VAULT_KEYS },
        vaultKeysListAnswerSchema,
      ),
    );
    return answer?.keys;
  }

  /** Deletes one provider's key; `deleted: false` means none was stored. */
  deleteKey(providerId: CloudAgentProviderId): Promise<VaultKeyDeleteAnswer | undefined> {
    return this.#run(
      this.#call.ask(
        {
          method: HTTP_METHOD.DELETE,
          path: HOSTED_SERVICE_PATH.VAULT_KEY,
          body: JSON.stringify({ providerId }),
        },
        vaultKeyDeleteAnswerSchema,
      ),
    );
  }

  #run<Answer>(effect: Effect.Effect<Answer, never, HttpClient.HttpClient>): Promise<Answer> {
    return Effect.runPromise(Effect.provide(effect, this.#client));
  }
}
