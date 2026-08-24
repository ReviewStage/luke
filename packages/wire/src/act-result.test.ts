import assert from "node:assert/strict";
import test from "node:test";
import { isActResult } from "./act-result.js";

test("the act result guard accepts exactly the canonical status shapes", () => {
  assert.equal(isActResult({ status: "accepted" }), true);
  assert.equal(isActResult({ status: "rejected", reason: "Not now." }), true);
  assert.equal(isActResult({ status: "unsupported", reason: "Not here." }), true);

  assert.equal(isActResult({ status: "accepted", reason: "contradiction" }), false);
  assert.equal(isActResult({ status: "rejected" }), false);
  assert.equal(isActResult({ status: "unsupported" }), false);
  assert.equal(isActResult({ status: "sent" }), false);
  assert.equal(isActResult({ ok: false }), false);
});
