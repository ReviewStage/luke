import assert from "node:assert/strict";
import test from "node:test";
import { AccountClientError } from "./client.js";
import {
  ACCOUNT_FAILURE_ACTION,
  accessTokenNeedsRefresh,
  accountFailureAction,
  accountGateOpen,
} from "./gate.js";

test("invalid_grant is the only refresh result that signs an account out", () => {
  assert.equal(
    accountFailureAction(new AccountClientError("revoked", { oauthError: "invalid_grant" })),
    ACCOUNT_FAILURE_ACTION.SIGN_OUT,
  );
  assert.equal(
    accountFailureAction(new AccountClientError("service down", { status: 503 })),
    ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT,
  );
  assert.equal(
    accountFailureAction(new TypeError("network failed")),
    ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT,
  );
  assert.equal(
    accountFailureAction(new DOMException("timed out", "TimeoutError")),
    ACCOUNT_FAILURE_ACTION.KEEP_ACCOUNT,
  );
});

test("a rejected or expired access token refreshes without signing out", () => {
  assert.equal(
    accessTokenNeedsRefresh(new AccountClientError("expired", { oauthError: "invalid_scope" })),
    true,
  );
  assert.equal(
    accessTokenNeedsRefresh(new AccountClientError("unauthorized", { status: 401 })),
    true,
  );
  assert.equal(
    accessTokenNeedsRefresh(new AccountClientError("service down", { status: 503 })),
    false,
  );
  assert.equal(accessTokenNeedsRefresh(new TypeError("network failed")), false);
});

test("capture and fixture runs bypass the account wall", () => {
  assert.equal(accountGateOpen({ requiresAccount: false }, false), true);
  assert.equal(accountGateOpen({ requiresAccount: true }, false), false);
  assert.equal(accountGateOpen({ requiresAccount: true }, true), true);
});
