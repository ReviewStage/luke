import assert from "node:assert/strict";
import { test } from "vitest";
import { notebookFileNote, notebookOmittedNote } from "./memory-view";

const UPDATED_AT = Date.parse("2026-09-14T15:04:00.000Z");

test("a file shown whole says only when it changed", () => {
  const note = notebookFileNote({
    path: "MEMORY.md",
    content: "# Memory\n",
    chars: 9,
    updatedAt: UPDATED_AT,
  });
  assert.match(note, /^Updated /u);
  assert.doesNotMatch(note, /showing/u);
});

test("a file the service cut says how much of it travelled, so the head is never mistaken for the whole", () => {
  const note = notebookFileNote({
    path: "memory/2026-09-14.md",
    content: "x".repeat(20_000),
    chars: 24_500,
    updatedAt: UPDATED_AT,
  });
  assert.match(note, /showing the first 20,000 of 24,500 characters$/u);
});

test("older notes are counted rather than drawn, and none is silent", () => {
  assert.equal(notebookOmittedNote(0), undefined);
  assert.equal(notebookOmittedNote(1), "1 older note is not shown.");
  assert.equal(notebookOmittedNote(12), "12 older notes are not shown.");
});
