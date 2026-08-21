import assert from "node:assert/strict";
import test from "node:test";
import { accountLabel } from "../src/account-label";

test("a named account is labeled by the provider's own name", () => {
  assert.equal(
    accountLabel({ name: "Dean Stratakos", email: "dean@example.com" }),
    "Dean Stratakos",
  );
});

test("an account with no name is labeled by its address", () => {
  assert.equal(accountLabel({ name: "", email: "dean@example.com" }), "dean@example.com");
});

test("an account named by its own address labels as that address once", () => {
  assert.equal(
    accountLabel({ name: "dean@example.com", email: "dean@example.com" }),
    "dean@example.com",
  );
});
