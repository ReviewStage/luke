import { HOSTED_SERVICE_PATH } from "@sidecar/core";
import { AccountClientFailure, type CloudFailure } from "@sidecar/core/effect-errors";
import { Effect } from "effect";
import { Http } from "./services/http";

const DELETE_TIMEOUT_MS = 15_000;

export interface AccountDeletionOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The signed-in account's current access token. */
  accessToken: string;
  timeoutMs?: number;
}

/**
 * Asks the hosted service to erase the signed-in account. The bearer token is
 * the whole request — the service resolves who to delete from it, so nothing
 * here can name a different account. A refusal throws an `AccountClientFailure`
 * carrying the status, which is what lets the caller tell an expired access
 * token (refresh and retry) from a service that actually said no.
 */
export function deleteHostedAccount(
  options: AccountDeletionOptions,
): Effect.Effect<void, AccountClientFailure | CloudFailure, Http> {
  return Effect.gen(function* () {
    const http = yield* Http;
    const response = yield* http.request(
      `${options.serviceBaseUrl.replace(/\/$/, "")}${HOSTED_SERVICE_PATH.ACCOUNT_DELETE}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${options.accessToken}` },
        signal: AbortSignal.timeout(options.timeoutMs ?? DELETE_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      return yield* Effect.fail(new AccountClientFailure({ status: response.status }));
    }
  });
}
