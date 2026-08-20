import { AccountClientFailure } from "@sidecar/core/effect-errors";
import type { RunMode } from "./run-mode";

export const ACCOUNT_FAILURE_ACTION = {
  KEEP_ACCOUNT: "keep-account",
  SIGN_OUT: "sign-out",
} as const;

export type AccountFailureAction =
  (typeof ACCOUNT_FAILURE_ACTION)[keyof typeof ACCOUNT_FAILURE_ACTION];

/** Only the OAuth server's definitive revocation answer removes a stored account. */
export function accountFailureAction(error: Error): AccountFailureAction {
  return error instanceof AccountClientFailure && error.oauthError === "invalid_grant"
    ? ACCOUNT_FAILURE_ACTION.SIGN_OUT
    : ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT;
}

/** Whether the pinned auth provider has definitively rejected an access token. */
export function accessTokenNeedsRefresh(error: Error): boolean {
  return (
    error instanceof AccountClientFailure &&
    (error.status === 401 || error.oauthError === "invalid_scope")
  );
}

/** Fixture and capture modes remain deterministic and never need an account. */
export function accountGateOpen(
  runMode: Pick<RunMode, "requiresAccount">,
  signedIn: boolean,
): boolean {
  return !runMode.requiresAccount || signedIn;
}
