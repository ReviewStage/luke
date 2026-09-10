import assert from "node:assert/strict";
import test from "node:test";
import { APPEND_TOKEN_BOUND, chunkForAppend } from "./chunks.js";
import { estimatedTokens } from "./tokens.js";

const SENTENCE = "The migration finished and the tests passed on the checkout branch.";

function sentences(count: number): string {
  return Array.from({ length: count }, () => SENTENCE).join(" ");
}

test("a short text is one chunk, flattened to one line", () => {
  assert.deepEqual(chunkForAppend("Codex finished.\n\nNothing else changed."), [
    "Codex finished. Nothing else changed.",
  ]);
});

test("a blank text builds no append", () => {
  assert.deepEqual(chunkForAppend(""), []);
  assert.deepEqual(chunkForAppend("  \n\t "), []);
});

test("a long text is cut at sentence ends, every chunk under the bound, nothing lost", () => {
  const text = sentences(200);
  const chunks = chunkForAppend(text);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(estimatedTokens(chunk) <= APPEND_TOKEN_BOUND);
    assert.equal((chunk.length + 1) % (SENTENCE.length + 1), 0);
  }
  assert.equal(chunks.join(" "), text);
});

test("a single sentence past the bound is cut between words", () => {
  const word = "word";
  const sentence = Array.from({ length: 1_000 }, () => word).join(" ");
  const chunks = chunkForAppend(sentence);

  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(estimatedTokens(chunk) <= APPEND_TOKEN_BOUND);
    assert.equal(
      chunk.split(" ").every((piece) => piece === word),
      true,
    );
  }
  assert.equal(chunks.join(" "), sentence);
});

test("a single word past the bound is cut by characters rather than refused", () => {
  const word = "x".repeat(APPEND_TOKEN_BOUND * 4 * 2 + 3);
  const chunks = chunkForAppend(word);

  for (const chunk of chunks) assert.ok(estimatedTokens(chunk) <= APPEND_TOKEN_BOUND);
  assert.equal(chunks.join(""), word);
});

test("chunks are filled greedily, so a text just over one bound is two chunks", () => {
  const count = Math.ceil((APPEND_TOKEN_BOUND * 4) / (SENTENCE.length + 1)) + 1;
  const chunks = chunkForAppend(sentences(count));

  assert.equal(chunks.length, 2);
  assert.ok(estimatedTokens(chunks[0] ?? "") > APPEND_TOKEN_BOUND / 2);
});
