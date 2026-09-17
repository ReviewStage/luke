import assert from "node:assert/strict";
import { test } from "vitest";
import {
  appendedDailyNote,
  BOOTSTRAP_BOUNDS,
  boundBootstrapFiles,
  CURATED_FILE_BUDGET,
  dailyNotePath,
  isDailyNotePath,
  WORKSPACE_FILE,
} from "./workspace.js";

const NOW = Date.UTC(2026, 8, 8, 12);

test("bootstrap files are bounded per file and in total, in order, with what the bounds did recorded", () => {
  const perFile = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
  const files = boundBootstrapFiles([
    { name: WORKSPACE_FILE.AGENTS, path: "a", content: "a".repeat(perFile + 10_000) },
    { name: WORKSPACE_FILE.IDENTITY, path: "i", content: "i".repeat(10_000) },
    { name: WORKSPACE_FILE.BOOTSTRAP, path: "b", content: undefined },
    { name: WORKSPACE_FILE.USER, path: "u", content: "u".repeat(perFile) },
    { name: WORKSPACE_FILE.MEMORY, path: "m", content: "m".repeat(15_000) },
  ]);
  assert.deepEqual(
    files.map((file) => [file.name, file.content.length, file.truncated, file.missing]),
    [
      [WORKSPACE_FILE.AGENTS, perFile, true, false],
      [WORKSPACE_FILE.IDENTITY, 10_000, false, false],
      [WORKSPACE_FILE.BOOTSTRAP, 0, false, true],
      [WORKSPACE_FILE.USER, CURATED_FILE_BUDGET[WORKSPACE_FILE.USER], true, false],
      [WORKSPACE_FILE.MEMORY, CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY], true, false],
    ],
  );
  assert.equal(files[0]?.originalChars, perFile + 10_000);
  assert.equal(files[3]?.originalChars, perFile);
  assert.equal(files[4]?.originalChars, 15_000);
});

test("the running total still cuts a curated file below its own budget, and one within both bounds is uncut", () => {
  const perFile = BOOTSTRAP_BOUNDS.MAXIMUM_CHARS_PER_FILE;
  const budget = CURATED_FILE_BUDGET[WORKSPACE_FILE.MEMORY];
  const leftForMemory = BOOTSTRAP_BOUNDS.MAXIMUM_TOTAL_CHARS - perFile - perFile - perFile + 1_000;
  assert.ok(leftForMemory < budget);
  const files = boundBootstrapFiles([
    { name: WORKSPACE_FILE.AGENTS, path: "a", content: "a".repeat(perFile) },
    { name: WORKSPACE_FILE.IDENTITY, path: "i", content: "i".repeat(perFile) },
    { name: WORKSPACE_FILE.USER, path: "u", content: "u".repeat(budget) },
    { name: WORKSPACE_FILE.BOOTSTRAP, path: "b", content: "b".repeat(perFile - budget - 1_000) },
    { name: WORKSPACE_FILE.MEMORY, path: "m", content: "m".repeat(budget) },
  ]);
  assert.deepEqual(
    files.map((file) => [file.name, file.content.length, file.truncated]),
    [
      [WORKSPACE_FILE.AGENTS, perFile, false],
      [WORKSPACE_FILE.IDENTITY, perFile, false],
      [WORKSPACE_FILE.USER, budget, false],
      [WORKSPACE_FILE.BOOTSTRAP, perFile - budget - 1_000, false],
      [WORKSPACE_FILE.MEMORY, leftForMemory, true],
    ],
  );
  assert.equal(files[4]?.originalChars, budget);
});

test("today's note is named by the instant's UTC day, a dated note is told from every other name, and an appended entry lands after a blank line", () => {
  assert.equal(dailyNotePath(NOW), "memory/2026-09-08.md");
  // A minute before midnight UTC is still the day's note; the next minute is the next day's.
  assert.equal(dailyNotePath(Date.UTC(2026, 8, 8, 23, 59)), "memory/2026-09-08.md");
  assert.equal(dailyNotePath(Date.UTC(2026, 8, 9, 0, 0)), "memory/2026-09-09.md");
  assert.equal(isDailyNotePath("memory/2026-09-08.md"), true);
  assert.equal(isDailyNotePath("memory/2026-09-08-standup.md"), true);
  assert.equal(isDailyNotePath(WORKSPACE_FILE.MEMORY), false);
  assert.equal(isDailyNotePath("memory/notes.md"), false);
  assert.equal(isDailyNotePath("2026-09-08.md"), false);
  assert.equal(isDailyNotePath("memory/../MEMORY.md"), false);

  assert.equal(appendedDailyNote(undefined, "- one"), "- one");
  assert.equal(appendedDailyNote("", "- one"), "- one");
  assert.equal(appendedDailyNote("  \n\n", "- one"), "- one");
  assert.equal(appendedDailyNote("- one", "- two"), "- one\n\n- two");
  assert.equal(appendedDailyNote("- one\n", "- two"), "- one\n\n- two");
  assert.equal(appendedDailyNote("- one\n\n\n", "- two"), "- one\n\n- two");
  // What stood is kept to the character: only the trailing whitespace goes.
  assert.equal(appendedDailyNote("# Day\n\n- one", "- two"), "# Day\n\n- one\n\n- two");
});
