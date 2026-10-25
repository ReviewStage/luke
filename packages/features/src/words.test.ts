import assert from "node:assert/strict";
import { test } from "vitest";
import {
  andList,
  countWords,
  noMatchWords,
  noneYetWords,
  orList,
  pasteCutWords,
  readFailedWords,
  readingWords,
  TERM,
} from "./words.js";

/**
 * words.test.ts -- a count takes its noun's one form at 1 alone, a list joins
 * with the Oxford comma from three names on, and each read phrase names its
 * thing in its one grammar.
 */

test("a count says its noun's one form at 1 and the many form at 0, 2, and a fraction", () => {
  assert.deepEqual(
    [0, 1, 2, 1.5].map((count) => countWords(count, TERM.RESULT)),
    ["0 results", "1 result", "2 results", "1.5 results"],
  );
});

test("names join as a sentence says them, with the Oxford comma from three on", () => {
  assert.deepEqual(
    [[], ["Linear"], ["Linear", "Notion"], ["Linear", "Notion", "Sentry"]].map(andList),
    ["", "Linear", "Linear and Notion", "Linear, Notion, and Sentry"],
  );
});

test("names offered as a choice join with or, and the Oxford comma from three on", () => {
  assert.deepEqual([["main"], ["main", "dev"], ["main", "dev", "release"]].map(orList), [
    "main",
    "main or dev",
    "main, dev, or release",
  ]);
});

test("a read is said reading, matching nothing, empty, or failed, by its thing alone", () => {
  assert.deepEqual(
    [
      readingWords("tasks"),
      noMatchWords(TERM.AGENT),
      noneYetWords(TERM.TASK),
      readFailedWords("your tasks"),
    ],
    ["Reading tasks", "No agents match", "No tasks yet", "Your tasks could not be read."],
  );
});

test("a cut paste names the limit it was cut to, grouped by thousands", () => {
  assert.equal(pasteCutWords(16_000), "Your paste was cut to fit the 16,000-character limit.");
  assert.equal(pasteCutWords(800), "Your paste was cut to fit the 800-character limit.");
});
