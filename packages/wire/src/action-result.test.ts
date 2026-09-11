import assert from "node:assert/strict";
import { test } from "vitest";
import { isActionResult } from "./action-result.js";

test("the action result guard accepts exactly the canonical status shapes", () => {
  assert.equal(isActionResult({ status: "accepted" }), true);
  assert.equal(isActionResult({ status: "rejected", reason: "Not now." }), true);
  assert.equal(isActionResult({ status: "unsupported", reason: "Not here." }), true);

  assert.equal(isActionResult({ status: "accepted", reason: "contradiction" }), false);
  assert.equal(isActionResult({ status: "accepted", setting: "Captions" }), false);
  assert.equal(isActionResult({ status: "rejected" }), false);
  assert.equal(isActionResult({ status: "rejected", reason: "Not now.", extra: true }), false);
  assert.equal(isActionResult({ status: "unsupported" }), false);
  assert.equal(isActionResult({ status: "sent" }), false);
  assert.equal(isActionResult({ ok: false }), false);
});
