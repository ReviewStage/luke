import assert from "node:assert/strict";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { test } from "vitest";
import { usageOfTurns } from "../server/hosted/coder-host/usage";
import type { OfferedModel } from "../server/hosted/model-catalog";

/**
 * What a coding agent's turns cost, summed and priced: a pure decision over
 * the rows the store answers and the catalog as read, so the arithmetic is
 * held here and the route's test holds only that the page carries it.
 */

const OPUS = "anthropic/claude-opus-5.5";
const OPUS_FAST = "anthropic/claude-opus-5.5-fast";
const SOL = "openai/gpt-6.1-sol";

/** Two models with prices, and one the catalog lists without any. */
const OFFERED: readonly OfferedModel[] = [
  {
    id: OPUS,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
    pricing: {
      inputUsd: 0.000004,
      outputUsd: 0.00002,
      cachedInputUsd: 0.0000002,
      cacheWriteUsd: 0.000005,
    },
  },
  {
    id: OPUS_FAST,
    name: "Claude Opus 5.5 (Fast)",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["high"],
    pricing: {
      inputUsd: 0.000008,
      outputUsd: 0.00004,
      cachedInputUsd: 0.0000004,
      cacheWriteUsd: 0.00001,
    },
  },
  {
    id: SOL,
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["high"],
    pricing: { inputUsd: 0.000002, outputUsd: 0.00001, cachedInputUsd: 0.000001 },
  },
  { id: "openai/gpt-5", name: "GPT-5", provider: MODEL_PROVIDER.OPENAI, efforts: ["high"] },
];

test("the totals run over every turn, and each step is priced at the model it ran on: a row from before the breakdown at its own model, a split row share by share", () => {
  const usage = usageOfTurns(
    [
      // 600 uncached at $4/M, 400 cached at $0.2/M, 100 out at $20/M: $0.00448.
      {
        model: OPUS,
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          cachedInputTokens: 400,
          reasoningTokens: 20,
        },
      },
      // Opus 2000 in and 200 out ($0.012), then Sol 400 uncached, 100 cached, 50 out ($0.0014).
      {
        model: OPUS,
        usage: {
          inputTokens: 2500,
          outputTokens: 250,
          cachedInputTokens: 100,
          reasoningTokens: 0,
          byModel: [
            {
              model: OPUS,
              inputTokens: 2000,
              outputTokens: 200,
              cachedInputTokens: 0,
              reasoningTokens: 0,
            },
            {
              model: SOL,
              inputTokens: 500,
              outputTokens: 50,
              cachedInputTokens: 100,
              reasoningTokens: 0,
            },
          ],
        },
      },
    ],
    OFFERED,
  );
  assert.deepEqual(usage, {
    inputTokens: 3500,
    outputTokens: 350,
    cachedInputTokens: 500,
    costUsd: 0.01788,
  });
});

test("a step on a model the catalog prices not, or lists no more, leaves the tokens to tell alone; no settled turn is nothing at all", () => {
  const priced = {
    model: OPUS,
    usage: { inputTokens: 10, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 0 },
  };
  const unpriced = {
    model: "openai/gpt-5",
    usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 0 },
  };
  const unlisted = {
    model: "xai/grok-5",
    usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0, reasoningTokens: 0 },
  };
  const tokens = { inputTokens: 15, outputTokens: 2, cachedInputTokens: 0 };
  assert.deepEqual(usageOfTurns([priced, unpriced], OFFERED), tokens);
  assert.deepEqual(usageOfTurns([priced, unlisted], OFFERED), tokens);
  assert.equal(usageOfTurns([], OFFERED), undefined);
});

test("the input a provider wrote to its prompt cache is priced at the cache's write price, and only once, out of the input it is counted in", () => {
  // 400 uncached at $4/M, 400 cached at $0.2/M, 200 written at $5/M, 100 out at $20/M: $0.00468.
  const usage = usageOfTurns(
    [
      {
        model: OPUS,
        usage: {
          inputTokens: 1000,
          outputTokens: 100,
          cachedInputTokens: 400,
          cacheWriteTokens: 200,
          reasoningTokens: 0,
        },
      },
    ],
    OFFERED,
  );
  assert.equal(usage?.costUsd, 0.00468);
});

test("a turn on a fast version is priced at the fast version's own catalog prices, never its base model's", () => {
  // The turn row names the agent's catalog id, the fast slug, though the step ran at the provider as the base model.
  const tokens = {
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 400,
    cacheWriteTokens: 200,
    reasoningTokens: 0,
  };
  // 400 uncached at $8/M, 400 cached at $0.4/M, 200 written at $10/M, 100 out at $40/M: $0.00936.
  assert.equal(usageOfTurns([{ model: OPUS_FAST, usage: tokens }], OFFERED)?.costUsd, 0.00936);
  assert.equal(usageOfTurns([{ model: OPUS, usage: tokens }], OFFERED)?.costUsd, 0.00468);
});
