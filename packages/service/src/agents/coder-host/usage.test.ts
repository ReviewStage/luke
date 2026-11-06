import assert from "node:assert/strict";
import { test } from "vitest";
import type { OfferedModel } from "../../providers/model-catalog.js";
import { usageOfTurns } from "./usage.js";

const PRICED: readonly OfferedModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    efforts: ["high"],
    pricing: { inputUsd: 0.000004, outputUsd: 0.00002 },
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 Fast",
    provider: "anthropic",
    efforts: ["high"],
    pricing: { inputUsd: 0.000008, outputUsd: 0.00004 },
  },
];

test("a fast turn is priced at Fast's rate, and one Anthropic refused Fast at the base model's standard rate", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  const turn = { model: "anthropic/claude-opus-5.5-fast", usage };

  assert.equal(usageOfTurns([{ ...turn, fastRefused: false }], PRICED)?.costUsd, 12);
  assert.equal(usageOfTurns([{ ...turn, fastRefused: true }], PRICED)?.costUsd, 6);
});
