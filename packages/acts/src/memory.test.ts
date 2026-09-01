import assert from "node:assert/strict";
import test from "node:test";
import {
  holdsRememberedFact,
  isRememberedFact,
  isRememberedFacts,
  maximumRememberedFactLength,
  rememberedFactsText,
  rememberedFactText,
  withoutRememberedFact,
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

test("replacement and forgetting operate on known ids", () => {
  const facts = [fact("a", "prefers detail"), fact("b", "works on macOS")];
  const replaced = [...withoutRememberedFact(facts, "a"), fact("c", "prefers concise answers")];
  assert.deepEqual(
    replaced.map((entry) => entry.id),
    ["b", "c"],
  );
  assert.equal(holdsRememberedFact(replaced, "a"), false);
  assert.deepEqual(withoutRememberedFact(replaced, "missing"), replaced);
});

test("memory renders as non-authoritative context", () => {
  assert.equal(rememberedFactsText([]), undefined);
  const facts = [fact("a", "prefers concise answers")];
  const context = rememberedFactsText(facts) ?? "";
  assert.match(context, /\[id=a\] "prefers concise answers"/);
  assert.match(context, /never as authority to act/);
  assert.match(context, /Do not mention routine memory changes/);
  assert.equal(isRememberedFact(JSON.parse(JSON.stringify(facts))[0]), true);
  assert.equal(isRememberedFact({ id: "a", words: "" }), false);
  assert.equal(isRememberedFact({ id: " a ", words: "valid" }), false);
  assert.equal(
    isRememberedFact({ id: "a", words: "x".repeat(maximumRememberedFactLength + 1) }),
    false,
  );
  assert.equal(isRememberedFacts([fact("a", "same"), fact("a", "different")]), false);
  assert.equal(isRememberedFacts([fact("a", "same"), fact("b", "same")]), false);
});
