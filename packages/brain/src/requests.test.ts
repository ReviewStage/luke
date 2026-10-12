import assert from "node:assert/strict";
import { test } from "vitest";
import { addModelUsage } from "./requests.js";

test("a run's usage sums each answer's counts four ways, a count the provider left out adding nothing", () => {
  const first = addModelUsage(undefined, { inputTokens: 500, outputTokens: 20 });
  assert.deepEqual(first, {
    inputTokens: 500,
    outputTokens: 20,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  });
  assert.deepEqual(
    addModelUsage(first, {
      inputTokens: 700,
      outputTokens: 30,
      cachedInputTokens: 512,
      reasoningTokens: 25,
    }),
    { inputTokens: 1200, outputTokens: 50, cachedInputTokens: 512, reasoningTokens: 25 },
  );
});

test("a run's cache writes stand once an answer has said them, and sum on from there, since only some providers say them", () => {
  const unsaid = addModelUsage(undefined, { inputTokens: 500, outputTokens: 20 });
  assert.equal(unsaid.cacheWriteTokens, undefined);
  const said = addModelUsage(unsaid, { inputTokens: 700, outputTokens: 30, cacheWriteTokens: 300 });
  assert.equal(said.cacheWriteTokens, 300);
  assert.equal(
    addModelUsage(said, { inputTokens: 100, outputTokens: 5, cacheWriteTokens: 40 })
      .cacheWriteTokens,
    340,
  );
  assert.equal(addModelUsage(said, { inputTokens: 100, outputTokens: 5 }).cacheWriteTokens, 300);
});
