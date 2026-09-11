import assert from "node:assert/strict";
import { test } from "vitest";
import { COMPACTION_RESERVE, reserveTokens, shouldCompact } from "./compaction-policy.js";

test("the reserve is 20,000 tokens capped at a quarter of the window, and the threshold is the window less it", () => {
  assert.equal(COMPACTION_RESERVE.TOKENS, 20_000);
  assert.equal(reserveTokens(400_000), 20_000);
  assert.equal(reserveTokens(64_000), 16_000);
  assert.equal(reserveTokens(8_000), 2_000);
  assert.equal(shouldCompact(380_000, 400_000), false);
  assert.equal(shouldCompact(380_001, 400_000), true);
  assert.equal(shouldCompact(6_000, 8_000), false);
  assert.equal(shouldCompact(6_001, 8_000), true);
  assert.equal(shouldCompact(1, 0), false);
  assert.equal(shouldCompact(1, Number.NaN), false);
});
