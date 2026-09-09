import {
  type AccountCall,
  type AccountToken,
  accountBearer,
  createAccountCall,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { type AccountPreferences, accountPreferencesFromWire } from "@sidecar/settings";
import {
  type CloudFetch,
  HTTP_METHOD,
  isRecord,
  isWireNumber,
  type UnparsedWireValue,
} from "@sidecar/wire";

export interface AccountPreferencesAnswer {
  preferences: AccountPreferences;
  hasStoredSnapshot: boolean;
}

export interface AccountPreferencesClientOptions extends AccountToken {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  fetch?: CloudFetch;
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
  readonly #call: AccountCall;

  constructor(options: AccountPreferencesClientOptions) {
    this.#call = createAccountCall({
      baseUrl: options.serviceBaseUrl,
      credential: accountBearer(options),
      fetch: options.fetch,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  readPreferences(): Promise<AccountPreferencesAnswer | undefined> {
    return this.#call.ask(
      { method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES },
      accountPreferencesAnswerFromWire,
    );
  }

  writePreferences(preferences: AccountPreferences): Promise<AccountPreferencesAnswer | undefined> {
    // SAFETY: AccountPreferences is JSON-compatible; the strict parser protects this runtime boundary.
    const parsed = accountPreferencesFromWire(preferences as UnparsedWireValue);
    if (parsed === undefined) return Promise.resolve(undefined);
    return this.#call.ask(
      {
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PREFERENCES,
        body: JSON.stringify({ preferences: parsed }),
      },
      accountPreferencesAnswerFromWire,
    );
  }
}
