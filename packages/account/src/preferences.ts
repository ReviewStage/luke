import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { type AccountPreferences, accountPreferencesFromWire } from "@sidecar/settings";
import {
  isRecord,
  isWireNumber,
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";
import type { FetchLike } from "./client.js";

const PREFERENCES_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;

export interface AccountPreferencesAnswer {
  preferences: AccountPreferences;
  hasStoredSnapshot: boolean;
}

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
 * answer and refreshes the bearer once on expiry, matching the hosted vault.
 */
export class AccountPreferencesClient {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #readAccountKey?: () => Promise<string | undefined>;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(options: AccountPreferencesClientOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#baseUrl = withoutTrailingSlash(baseUrl);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    if (options.readAccountKey) this.#readAccountKey = options.readAccountKey;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      PREFERENCES_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  readPreferences(): Promise<AccountPreferencesAnswer | undefined> {
    return this.#ask({ method: "GET", path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES });
  }

  writePreferences(preferences: AccountPreferences): Promise<AccountPreferencesAnswer | undefined> {
    // SAFETY: AccountPreferences is JSON-compatible; the strict parser protects this runtime boundary.
    const parsed = accountPreferencesFromWire(preferences as UnparsedWireValue);
    if (parsed === undefined) return Promise.resolve(undefined);
    return this.#ask({
      method: "PUT",
      path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
      // SAFETY: The strict parser accepted this as a wire-shaped account preference object.
      body: { preferences: parsed as UnparsedWireValue },
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
