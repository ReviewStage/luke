import type { CloudAgentProviderId } from "@sidecar/session";
import { type CloudFetch, HTTP_METHOD } from "@sidecar/wire";
import { type AccountCall, accountBearer, createAccountCall } from "./account-call.js";
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
  fetch?: CloudFetch;
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
  readonly #call: AccountCall;

  constructor(options: HostedVaultClientOptions) {
    this.#call = createAccountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      fetch: options.fetch,
      requestTimeoutMs: options.requestTimeoutMs,
    });
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
    return this.#call.ask(
      {
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.VAULT_KEY,
        body: JSON.stringify({ providerId, key }),
      },
      (payload) => vaultKeyStoreAnswerSchema.parse(payload),
    );
  }

  /** Lists what is stored — provider ids and timestamps, never keys. */
  async listKeys(): Promise<readonly VaultKeyListEntry[] | undefined> {
    const answer = await this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.VAULT_KEYS },
      (payload) => vaultKeysListAnswerSchema.parse(payload),
    );
    return answer?.keys;
  }

  /** Deletes one provider's key; `deleted: false` means none was stored. */
  deleteKey(providerId: CloudAgentProviderId): Promise<VaultKeyDeleteAnswer | undefined> {
    return this.#call.ask(
      {
        method: HTTP_METHOD.DELETE,
        path: HOSTED_SERVICE_PATH.VAULT_KEY,
        body: JSON.stringify({ providerId }),
      },
      (payload) => vaultKeyDeleteAnswerSchema.parse(payload),
    );
  }
}
