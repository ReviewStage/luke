import assert from "node:assert/strict";
import { test } from "vitest";
import { parsePixels } from "./motion-tokens";

test("a distance reads as pixels, and an unset token as none", () => {
  assert.equal(parsePixels("7px"), 7);
  assert.equal(parsePixels(""), 0);
});
