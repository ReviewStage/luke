import assert from "node:assert/strict";
import { test } from "vitest";
import { fileMatches, matchFrom } from "./file-find.js";

/**
 * file-find.test.ts -- a find over a whole file: the matches on its lines and
 * in its notes, in the order the tab draws them, and where a find starts.
 */

const LINES = ["const seat = 1;", "// Seats, seats", "return seat;"];

test("a query matches on every line without regard to case, and a note's matches follow its line's own", () => {
  const notes = [{ key: "call-1", line: 2, matches: 1 }];
  assert.deepEqual(fileMatches(LINES, notes, "SEAT"), [
    { line: 1, note: undefined, nth: 0 },
    { line: 2, note: undefined, nth: 0 },
    { line: 2, note: undefined, nth: 1 },
    { line: 2, note: "call-1", nth: 0 },
    { line: 3, note: undefined, nth: 0 },
  ]);
});

test("a query is matched as typed, its punctuation no pattern, and an empty one matches nothing", () => {
  assert.deepEqual(fileMatches(["a.b", "axb"], [], "a.b"), [{ line: 1, note: undefined, nth: 0 }]);
  assert.deepEqual(fileMatches(LINES, [], ""), []);
});

test("a find starts at the first match on or after a line, or the first of all past the last", () => {
  const matches = fileMatches(LINES, [], "seat");
  assert.equal(matchFrom(matches, 3), 3);
  assert.equal(matchFrom(matches, 9), 0);
  assert.equal(matchFrom([], 1), -1);
});
