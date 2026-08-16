import { AccountClientError } from "./account-client";
import type { RunMode } from "./run-mode";

export const ACCOUNT_FAILURE_ACTION = {
  KEEP_ACCOUNT: "keep-account",
  SIGN_OUT: "sign-out",
} as const;

export type AccountFailureAction =
  (typeof ACCOUNT_FAILURE_ACTION)[keyof typeof ACCOUNT_FAILURE_ACTION];

/** Only the OAuth server's definitive revocation answer removes a stored account. */
export function accountFailureAction(error: unknown): AccountFailureAction {
  return error instanceof AccountClientError && error.oauthError === "invalid_grant"
    ? ACCOUNT_FAILURE_ACTION.SIGN_OUT
    : ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT;
}

/** Fixture and capture modes remain deterministic and never need an account. */
export function accountGateOpen(
  runMode: Pick<RunMode, "requiresAccount">,
  signedIn: boolean,
): boolean {
  return !runMode.requiresAccount || signedIn;
}
