import assert from "node:assert/strict";
import { AGENT_BRIEF, type AgentContext } from "@repo/features/agent-wire";
import { test } from "vitest";
import {
  contextFullLine,
  contextHint,
  contextLevel,
  contextRows,
  contextStats,
  contextTotalLine,
  rowCount,
  rowWidth,
} from "./agent-context-model.js";

const NOW = 1_800_000_600_000;

const CONTEXT: AgentContext = {
  windowTokens: 1_000_000,
  compactionThresholdTokens: 900_000,
  inputTokens: 620_000,
  outputTokens: 2_400,
  cachedInputTokens: 600_000,
  cacheWriteTokens: 18_000,
  estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800, briefTokens: 600 },
  measuredAt: NOW - 60_000,
};

function reading(inputTokens: number): AgentContext {
  return { ...CONTEXT, inputTokens };
}

test("the ring says the share of the window the last step read, and the popover heads with it and the total, the window rounded where whole", () => {
  assert.equal(contextHint(CONTEXT), "62% of context used");
  assert.equal(contextFullLine(CONTEXT), "62% full");
  assert.equal(contextTotalLine(CONTEXT), "~620K / 1M tokens");
  assert.equal(contextFullLine(reading(1_470_000)), "147% full");
  assert.equal(
    contextTotalLine({ ...CONTEXT, windowTokens: 200_000, inputTokens: 812 }),
    "~812 / 200K tokens",
  );
});

test("the ring's hover says near the limit once the ring is amber or red, and says nothing of it while there is room", () => {
  assert.equal(contextHint(reading(799_999)), "80% of context used");
  assert.equal(contextHint(reading(800_000)), "80% of context used, near the limit");
  assert.equal(contextHint(reading(950_000)), "95% of context used, near the limit");
});

test("the ring has room short of a tenth of the window below eve's compaction, turns amber from there, and red at the compaction and past it", () => {
  assert.equal(contextLevel(reading(799_999)), "room");
  assert.equal(contextLevel(reading(800_000)), "near");
  assert.equal(contextLevel(reading(899_999)), "near");
  assert.equal(contextLevel(reading(900_000)), "over");
  assert.equal(contextLevel(reading(1_200_000)), "over");
});

test("the popover divides the read into the instructions, the tools, the description, and the conversation left over, every count an estimate marked with ~", () => {
  const rows = contextRows(CONTEXT, undefined);
  assert.deepEqual(
    rows.map((row) => [row.label, rowCount(row)]),
    [
      ["System prompt", "~1.2K"],
      ["Tool definitions", "~2.8K"],
      ["Description", "~600"],
      ["Conversation", "~615.4K"],
    ],
  );
  const filled = rows.reduce((sum, row) => sum + rowWidth(row, CONTEXT), 0);
  assert.ok(Math.abs(filled - 62) < 1e-9);
});

test("an agent handed a prompt names its brief so; once eve compacted, the brief is folded into the conversation; estimates that outrun the read are scaled down to it", () => {
  assert.deepEqual(
    contextRows(CONTEXT, AGENT_BRIEF.PROMPT).map((row) => row.label),
    ["System prompt", "Tool definitions", "Prompt", "Conversation"],
  );
  const compacted: AgentContext = {
    ...CONTEXT,
    estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800 },
    compactedAt: NOW - 120_000,
  };
  assert.deepEqual(
    contextRows(compacted, AGENT_BRIEF.DESCRIPTION).map((row) => [row.label, rowCount(row)]),
    [
      ["System prompt", "~1.2K"],
      ["Tool definitions", "~2.8K"],
      ["Conversation", "~616K"],
    ],
  );
  const small = reading(3_000);
  const tiny = contextRows(small, undefined);
  assert.equal(rowCount(tiny[tiny.length - 1] ?? assert.fail("no conversation row")), "~0");
  assert.equal(
    tiny.reduce((sum, row) => sum + row.tokens, 0),
    3_000,
  );
  const filled = tiny.reduce((sum, row) => sum + rowWidth(row, small), 0);
  assert.ok(Math.abs(filled - 0.3) < 1e-9);
});

test("under the legend: what the cache read and wrote, the last step's output, where eve compacts, and when it last did, where it has", () => {
  assert.deepEqual(contextStats(CONTEXT, NOW), [
    { label: "Read from cache", value: "600K" },
    { label: "Written to cache", value: "18K" },
    { label: "Last step's output", value: "2.4K" },
    { label: "Compacts at", value: "900K (90%)" },
  ]);
  const { cachedInputTokens: _read, cacheWriteTokens: _written, ...uncached } = CONTEXT;
  assert.deepEqual(contextStats({ ...uncached, compactedAt: NOW - 120_000 }, NOW), [
    { label: "Last step's output", value: "2.4K" },
    { label: "Compacts at", value: "900K (90%)" },
    { label: "Last compacted", value: "2m ago" },
  ]);
});
