import assert from "node:assert/strict";
import test from "node:test";
import { AccountClientFailure } from "@sidecar/core/effect-errors";
import { accessTokenNeedsRefresh, accountFailureAction } from "../src/account-gate";

test("invalid_grant is the only OAuth refusal that signs the account out", () => {
  assert.equal(
    accountFailureAction(new AccountClientFailure({ oauthError: "invalid_grant" })),
    "sign-out",
  );
  assert.equal(accountFailureAction(new AccountClientFailure({ status: 503 })), "keep-account");
});

test("account gate stays closed in fixture mode and opens when a stored account exists", async () => {
  const { accountGateOpen } = await import("../src/account-gate");
  assert.equal(accountGateOpen({ requiresAccount: true }, false), false);
  assert.equal(accountGateOpen({ requiresAccount: true }, true), true);
  assert.equal(accountGateOpen({ requiresAccount: false }, false), true);
});

test("401 and invalid_scope mean refresh; other refusals do not", () => {
  assert.equal(
    accessTokenNeedsRefresh(new AccountClientFailure({ oauthError: "invalid_scope" })),
    true,
  );
  assert.equal(accessTokenNeedsRefresh(new AccountClientFailure({ status: 401 })), true);
  assert.equal(accessTokenNeedsRefresh(new AccountClientFailure({ status: 503 })), false);
});
