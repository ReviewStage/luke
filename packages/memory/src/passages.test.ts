import assert from "node:assert/strict";
import { test } from "vitest";
import { cutPassages, hashText, PASSAGE_BOUNDS } from "./passages.js";

/** Synthetic notebook text throughout: no real note, name, or path. */

test("a short file is one passage spanning every line, hashed by its words alone", () => {
  const content = "# MEMORY.md\n\n- prefers espresso\n- ships on Fridays";
  const passages = cutPassages(content);
  assert.equal(passages.length, 1);
  assert.deepEqual(passages[0], {
    startLine: 1,
    endLine: 4,
    text: content,
    hash: hashText(content),
  });
  assert.deepEqual(cutPassages(content), passages, "the cut is deterministic");
});

test("a long file is cut into whole-line passages under the budget, each tail carried into the next as overlap", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1} ${"x".repeat(60)}`);
  const passages = cutPassages(lines.join("\n"), { tokens: 100, overlapTokens: 20 });
  assert.ok(passages.length > 1);
  for (const passage of passages) {
    assert.ok(passage.text.length <= 100 * 4, "under the budget");
    assert.ok(passage.startLine <= passage.endLine);
    for (const line of passage.text.split("\n")) {
      assert.ok(lines.includes(line), "every line is whole");
    }
  }
  for (let i = 1; i < passages.length; i += 1) {
    const previous = passages[i - 1];
    const next = passages[i];
    assert.ok(previous && next);
    assert.ok(next.startLine <= previous.endLine, "the overlap repeats the previous tail");
    assert.ok(next.startLine > previous.startLine, "and still moves forward");
  }
  assert.equal(passages[passages.length - 1]?.endLine, 40);
});

test("a line wider than a passage is cut into pieces that each keep the line's number", () => {
  const wide = "w".repeat(1000);
  const passages = cutPassages(`first\n${wide}\nlast`, { tokens: 50, overlapTokens: 0 });
  const middle = passages.filter((passage) => passage.startLine === 2 && passage.endLine === 2);
  assert.ok(middle.length >= 5);
  assert.equal(middle.map((passage) => passage.text).join(""), wide);
});

test("blank-only content cuts to nothing, and the default bounds are the pinned 400 and 80 tokens", () => {
  assert.deepEqual(cutPassages(""), []);
  assert.deepEqual(cutPassages("\n\n  \n"), []);
  assert.deepEqual(PASSAGE_BOUNDS, { tokens: 400, overlapTokens: 80 });
});
