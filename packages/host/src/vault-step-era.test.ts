import assert from "node:assert/strict";
import { test } from "vitest";
import { type VaultStepEra, vaultStepEraStands } from "./vault-step-era.js";

const PRESSED: VaultStepEra = { generation: 3, accountKey: "first@example.com" };

test("a step begins when the generation and the account of its press still stand", () => {
  assert.equal(vaultStepEraStands(PRESSED, 3, "first@example.com"), true);
});

test("a step pressed before a sign-out does not begin, whoever signed in since", () => {
  assert.equal(vaultStepEraStands(PRESSED, 4, "first@example.com"), false);
  assert.equal(vaultStepEraStands(PRESSED, 4, "second@example.com"), false);
  assert.equal(vaultStepEraStands(PRESSED, 4, undefined), false);
});

test("a step pressed under one account does not begin under another in the same generation", () => {
  assert.equal(vaultStepEraStands(PRESSED, 3, "second@example.com"), false);
  assert.equal(vaultStepEraStands(PRESSED, 3, undefined), false);
});
