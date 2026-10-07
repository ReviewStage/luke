import assert from "node:assert/strict";
import { test } from "vitest";
import { matchRanges } from "./search-tokens";

test("match ranges are found case-blind and merged where words overlap", () => {
  // Two words landing on one stretch read as one mark, not nested ones.
  assert.deepEqual(matchRanges("Feat/LUKE-123-parser", ["luke", "ke-123"]), [
    { start: 5, end: 13 },
  ]);
  // Every occurrence is marked, not only the first.
  assert.deepEqual(matchRanges("alpha alpha", ["alpha"]), [
    { start: 0, end: 5 },
    { start: 6, end: 11 },
  ]);
  // A line the words did not land on yields nothing to mark.
  assert.deepEqual(matchRanges("nothing here", ["zeta"]), []);
});
