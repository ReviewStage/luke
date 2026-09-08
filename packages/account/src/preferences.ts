import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  type AccountPreferences,
  type AccountPreferencesAnswer,
  accountPreferencesAnswerFromWire,
  accountPreferencesFromWire,
  accountPreferencesToWire,
} from "@sidecar/settings";
import { positiveInteger, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";

const PREFERENCES_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AccountPreferencesClientOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  readAccountKey?: () => Promise<string | undefined>;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
}

interface AccountPreferencesRequest {
  method: "GET" | "PUT";
  path: string;
  body?: Record<string, UnparsedWireValue>;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function accountPreferencesInput(preferences: AccountPreferences): UnparsedWireValue {
  // SAFETY: AccountPreferences is the parsed subset of stored app settings whose values are JSON-compatible.
  return preferences as UnparsedWireValue;
}

/**
 * Reads and writes the account preference snapshot. The local store decides
 * which settings are eligible to travel; this client enforces the same schema
 * before a write leaves the machine and validates the service's answer on the
 * way back.
 */
export class AccountPreferencesClient {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #readAccountKey?: () => Promise<string | undefined>;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(options: AccountPreferencesClientOptions) {
    if (!options.serviceBaseUrl.trim()) {
      throw new Error("Hosted service base URL must not be empty");
    }
    this.#baseUrl = withoutTrailingSlash(options.serviceBaseUrl.trim());
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    if (options.readAccountKey) this.#readAccountKey = options.readAccountKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      PREFERENCES_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  async readPreferences(): Promise<AccountPreferencesAnswer | undefined> {
    return this.#ask({ method: "GET", path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES });
  }

  async writePreferences(
    preferences: AccountPreferences,
  ): Promise<AccountPreferencesAnswer | undefined> {
    const parsed = accountPreferencesFromWire(accountPreferencesInput(preferences));
    if (parsed === undefined) return undefined;
    const wire = accountPreferencesToWire(parsed);
    return this.#ask({
      method: "PUT",
      path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
      body: { preferences: wire },
    });
  }

  async #ask(request: AccountPreferencesRequest): Promise<AccountPreferencesAnswer | undefined> {
    const account = await this.#readAccountKey?.();
    const token = await this.#readAccessToken();
    if (!token) return undefined;

    let response = await this.#request(request, token);
    if (response?.status === UNAUTHORIZED_STATUS) {
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      const sameAccount =
        this.#readAccountKey === undefined || (await this.#readAccountKey()) === account;
      if (refreshed && refreshed !== token && sameAccount) {
        response = await this.#request(request, refreshed);
      }
    }
    if (!response?.ok) return undefined;

    const payload = await response.json().catch(() => undefined);
    return payload === undefined
      ? undefined
      : accountPreferencesAnswerFromWire(unparsedWire(payload));
  }

  async #request(request: AccountPreferencesRequest, token: string): Promise<Response | undefined> {
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
