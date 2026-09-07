import assert from "node:assert/strict";
import test from "node:test";
import { rememberedFactsFromStored } from "./facts.js";

test("remembered entries read back from the legacy file, and nothing retires them by a clock", () => {
  const facts = [{ id: "fact-one", words: "prefers concise answers" }];
  assert.deepEqual(rememberedFactsFromStored(JSON.stringify({ facts })), facts);
  assert.deepEqual(rememberedFactsFromStored(undefined), []);
  assert.deepEqual(rememberedFactsFromStored("{not json"), []);
});

test("the legacy facts reader drops noncanonical and duplicate entries", () => {
  const stored = JSON.stringify({
    facts: [
      { id: "one", words: "prefers concise answers" },
      { id: "one", words: "another wording" },
      { id: "two", words: "prefers concise answers" },
      { id: "three", words: "  padded  " },
      { id: "", words: "no id" },
      { id: "four", words: "works mornings" },
    ],
  });
  assert.deepEqual(rememberedFactsFromStored(stored), [
    { id: "one", words: "prefers concise answers" },
    { id: "four", words: "works mornings" },
  ]);
});
