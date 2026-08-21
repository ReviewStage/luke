import assert from "node:assert/strict";
import test from "node:test";
import { accountInitials } from "../src/account-initials";

test("a provider's own name for the account gives its first and last initials", () => {
  assert.equal(accountInitials("Dean Stratakos", "dean@example.com"), "DS");
  assert.equal(accountInitials("dean", "dean@example.com"), "D");
  assert.equal(accountInitials("Ada B. Lovelace", "ada@example.com"), "AL");
});

test("an account with no name falls back to the address's local part", () => {
  assert.equal(accountInitials("", "dean.stratakos@example.com"), "DS");
  assert.equal(accountInitials("   ", "dean@example.com"), "D");
  assert.equal(accountInitials("", "ada_b_lovelace@example.com"), "AL");
});

test("an account with nothing to be named by draws no letters", () => {
  assert.equal(accountInitials("", ""), undefined);
  assert.equal(accountInitials("", "@example.com"), undefined);
});

test("a name opening on an astral character keeps that whole character", () => {
  assert.equal(accountInitials("𝒜da Lovelace", "ada@example.com"), "𝒜L");
});
