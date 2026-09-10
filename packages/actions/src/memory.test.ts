import assert from "node:assert/strict";
import test from "node:test";
import {
  holdsRememberedFact,
  maximumRememberedFactLength,
  rememberedFactsText,
  rememberedFactText,
} from "./memory.js";

const fact = (id: string, words: string) => ({ id, words });

test("a fact is flattened and bounded", () => {
  assert.equal(rememberedFactText("  prefers  short\nanswers "), "prefers short answers");
  assert.equal(rememberedFactText("   "), undefined);
  assert.equal(rememberedFactText(42), undefined);
  assert.equal(
    rememberedFactText("x".repeat(maximumRememberedFactLength + 50))?.length,
    maximumRememberedFactLength,
  );
});

test("holding a fact is decided by its id", () => {
  const facts = [fact("b", "works on macOS"), fact("c", "prefers concise answers")];
  assert.equal(holdsRememberedFact(facts, "c"), true);
  assert.equal(holdsRememberedFact(facts, "a"), false);
});

test("memory renders as non-authoritative context", () => {
  assert.equal(rememberedFactsText([]), undefined);
});
