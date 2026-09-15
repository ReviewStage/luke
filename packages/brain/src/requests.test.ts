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
