import assert from "node:assert/strict";
import { test } from "vitest";
import { parseMilliseconds, parsePixels } from "./motion-tokens";

test("durations are read in either unit the tokens use", () => {
  assert.equal(parseMilliseconds("460ms"), 460);
  assert.equal(parseMilliseconds("0.46s"), 460);
  assert.equal(parseMilliseconds(" 0s "), 0);
  // An unset token computes to the empty string, which must read as stillness.
  assert.equal(parseMilliseconds(""), 0);
});

test("a distance reads as pixels, and an unset token as none", () => {
  assert.equal(parsePixels("7px"), 7);
  assert.equal(parsePixels(""), 0);
});
