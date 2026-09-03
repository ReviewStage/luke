import assert from "node:assert/strict";
import test from "node:test";
import { forgetRememberedFact, saveRememberedFact } from "./session-acts";

test("memory writes deduplicate and leave state unchanged when persistence fails", () => {
  const held = [{ id: "fact-one", words: "prefers concise answers" }];
  let writes = 0;
  const write = () => {
    writes += 1;
    return false;
  };

  assert.equal(
    saveRememberedFact(held, "prefers concise answers", undefined, "duplicate", write),
    held,
  );
  assert.equal(writes, 0);
  assert.equal(saveRememberedFact(held, "works on macOS", undefined, "new", write), held);
  assert.equal(forgetRememberedFact(held, "fact-one", write), held);
  assert.equal(writes, 2);
});

test("replacing a fact with existing wording removes the contradicted entry", () => {
  const held = [
    { id: "fact-one", words: "prefers detailed answers" },
    { id: "fact-two", words: "prefers concise answers" },
  ];
  let written: readonly { id: string; words: string }[] | undefined;

  const next = saveRememberedFact(
    held,
    "prefers concise answers",
    "fact-one",
    "replacement",
    (facts) => {
      written = facts;
      return true;
    },
  );

  assert.deepEqual(next, [held[1]]);
  assert.deepEqual(written, next);
});
