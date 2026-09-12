import assert from "node:assert/strict";
import type { StoredAccount } from "@sidecar/credentials";
import { test } from "vitest";
import { vaultStepBearer } from "./vault-step-bearer.js";

const FIRST: StoredAccount = {
  accessToken: "first-access-token",
  refreshToken: "first-refresh-token",
  email: "first@example.com",
  provider: "github",
};

const SECOND: StoredAccount = {
  accessToken: "second-access-token",
  refreshToken: "second-refresh-token",
  email: "second@example.com",
  provider: "github",
};

test("a call carries the bearer of the account its step began under", () => {
  assert.equal(vaultStepBearer(FIRST, FIRST.email), FIRST.accessToken);
});

test("a call reached after another account signed in carries no bearer at all", () => {
  assert.equal(vaultStepBearer(SECOND, FIRST.email), undefined);
});

test("a call with no account signed in, or outside any step, carries no bearer", () => {
  assert.equal(vaultStepBearer(undefined, FIRST.email), undefined);
  assert.equal(vaultStepBearer(FIRST, undefined), undefined);
  assert.equal(vaultStepBearer(undefined, undefined), undefined);
});
