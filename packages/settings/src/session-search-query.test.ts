import assert from "node:assert/strict";
import test from "node:test";
import { APP_SETTING_SCHEMA } from "./schema.js";

const guard = APP_SETTING_SCHEMA.sessionSearchQuery.guard;

test("an absent query is valid and reads as nothing searched", () => {
  assert.deepEqual(guard(undefined), { valid: true, value: undefined });
});

test("held words come back exactly as typed", () => {
  assert.deepEqual(guard("Fix CI  on main"), { valid: true, value: "Fix CI  on main" });
  assert.deepEqual(guard(" trailing space "), { valid: true, value: " trailing space " });
});

test("words that are all whitespace read as unset, because they narrow nothing", () => {
  assert.deepEqual(guard(""), { valid: true, value: undefined });
  assert.deepEqual(guard("   \t"), { valid: true, value: undefined });
});

test("a value past any typeable length reads as unset rather than refilled", () => {
  assert.deepEqual(guard("q".repeat(501)), { valid: true, value: undefined });
  assert.deepEqual(guard("q".repeat(500)), { valid: true, value: "q".repeat(500) });
});

test("a query that is not text is invalid rather than guessed at", () => {
  assert.deepEqual(guard(7), { valid: false, value: undefined });
  assert.deepEqual(guard(["build"]), { valid: false, value: undefined });
  assert.deepEqual(guard({ query: "build" }), { valid: false, value: undefined });
});
