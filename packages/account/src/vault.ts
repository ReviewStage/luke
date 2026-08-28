import {
  HOSTED_SERVICE_PATH,
  type VaultKeyDeleteAnswer,
  type VaultKeyListEntry,
  type VaultKeyStoreAnswer,
  type VaultProviderId,
  vaultKeyDeleteAnswerFromWire,
  vaultKeyIsStorable,
  vaultKeyStoreAnswerFromWire,
  vaultKeysListAnswerFromWire,
} from "@sidecar/hosted";
import { positiveInteger, text, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";

const VAULT_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HostedVaultClientOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
}

interface VaultRequest {
  method: "POST" | "GET" | "DELETE";
  path: string;
  body?: Record<string, string>;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * The desktop's side of the provider-key vault: store a key, list what is
 * stored (ids and display hints — the service holds no endpoint that reads a
 * key back), and delete one. The shape follows the hosted usage reader —
 * token read fresh per ask, a 401 refreshed and retried once, every answer
 * validated by the shared wire contract — and a failure resolves to nothing,
 * leaving the wording to the settings row that asked. Every call here is the
 * direct product of a press on that row; nothing reads the vault on a timer.
 */
export class HostedVaultClient {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(options: HostedVaultClientOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#baseUrl = withoutTrailingSlash(baseUrl);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      VAULT_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  /**
   * Stores or replaces one provider's key. A key the service would refuse by
   * shape is refused here without traveling at all.
   */
  async storeKey(
    providerId: VaultProviderId,
    key: string,
  ): Promise<VaultKeyStoreAnswer | undefined> {
    if (!vaultKeyIsStorable(key)) return undefined;
    return this.#ask(
      { method: "POST", path: HOSTED_SERVICE_PATH.VAULT_KEY, body: { providerId, key } },
      vaultKeyStoreAnswerFromWire,
    );
  }

  /** Lists what is stored — provider ids, hints, and timestamps, never keys. */
  async listKeys(): Promise<readonly VaultKeyListEntry[] | undefined> {
    const answer = await this.#ask(
      { method: "GET", path: HOSTED_SERVICE_PATH.VAULT_KEYS },
      vaultKeysListAnswerFromWire,
    );
    return answer?.keys;
  }

  /** Deletes one provider's key; `deleted: false` means none was stored. */
  async deleteKey(providerId: VaultProviderId): Promise<VaultKeyDeleteAnswer | undefined> {
    return this.#ask(
      { method: "DELETE", path: HOSTED_SERVICE_PATH.VAULT_KEY, body: { providerId } },
      vaultKeyDeleteAnswerFromWire,
    );
  }

  async #ask<Answer>(
    request: VaultRequest,
    read: (payload: UnparsedWireValue) => Answer | undefined,
  ): Promise<Answer | undefined> {
    const token = await this.#readAccessToken();
    if (!token) return undefined;

    let response = await this.#request(request, token);
    if (response?.status === UNAUTHORIZED_STATUS) {
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.#request(request, refreshed);
      }
    }
    if (!response?.ok) return undefined;

    const payload = await response.json().catch(() => undefined);
    return payload === undefined ? undefined : read(unparsedWire(payload));
  }

  async #request(request: VaultRequest, token: string): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(request.body ? { "content-type": "application/json" } : undefined),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : undefined),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      return undefined;
    }
  }
}
