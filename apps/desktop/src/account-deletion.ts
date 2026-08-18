import { HOSTED_SERVICE_PATH } from "@sidecar/core";
import { AccountClientError, type FetchLike } from "./account-client";

const DELETE_TIMEOUT_MS = 15_000;

export interface AccountDeletionOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The signed-in account's current access token. */
  accessToken: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Asks the hosted service to erase the signed-in account. The bearer token is
 * the whole request — the service resolves who to delete from it, so nothing
 * here can name a different account. A refusal throws an `AccountClientError`
 * carrying the status, which is what lets the caller tell an expired access
 * token (refresh and retry) from a service that actually said no.
 */
export async function deleteHostedAccount(options: AccountDeletionOptions): Promise<void> {
  const fetchLike = options.fetch ?? fetch;
  const response = await fetchLike(
    `${options.serviceBaseUrl.replace(/\/$/, "")}${HOSTED_SERVICE_PATH.ACCOUNT_DELETE}`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${options.accessToken}` },
      signal: AbortSignal.timeout(options.timeoutMs ?? DELETE_TIMEOUT_MS),
    },
  );
  if (!response.ok) {
    throw new AccountClientError(`Account service returned ${response.status}`, {
      status: response.status,
    });
  }
}
