import assert from "node:assert/strict";
import { CODING_AGENT_BRIEF, type CodingAgentContext } from "@luke/features/coding-agent-wire";
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
} from "./agent-context-model";

/**
 * What the agent box's context ring and its popover say of a page's
 * context: the share in words, the ring's colour by how near eve's
 * compaction the last step read, the parts the read divides into with a
 * "~" on every estimate, and the lines under them. Synthetic counts
 * throughout.
 */

const NOW = 1_800_000_600_000;

/** A step that read 620k of a 1M window whose compaction is at 900k, on an agent handed the plan. */
const CONTEXT: CodingAgentContext = {
  windowTokens: 1_000_000,
  compactionThresholdTokens: 900_000,
  inputTokens: 620_000,
  outputTokens: 2_400,
  cachedInputTokens: 600_000,
  cacheWriteTokens: 18_000,
  estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800, briefTokens: 600 },
  measuredAt: NOW - 60_000,
};

/** The context with the last step reading this many tokens. */
function reading(inputTokens: number): CodingAgentContext {
  return { ...CONTEXT, inputTokens };
}

test("the ring says the share of the window the last step read, and the popover heads with it and the total, the window rounded where whole", () => {
  assert.equal(contextHint(CONTEXT), "62% of context used");
  assert.equal(contextFullLine(CONTEXT), "62% full");
  assert.equal(contextTotalLine(CONTEXT), "~620.0k / 1M tokens");
  // A read past the window says so rather than stopping at a hundred.
  assert.equal(contextFullLine(reading(1_470_000)), "147% full");
  assert.equal(
    contextTotalLine({ ...CONTEXT, windowTokens: 200_000, inputTokens: 812 }),
    "~812 / 200k tokens",
  );
});

test("the ring has room short of a tenth of the window below eve's compaction, turns amber from there, and red at the compaction and past it", () => {
  assert.equal(contextLevel(reading(799_999)), "room");
  assert.equal(contextLevel(reading(800_000)), "near");
  assert.equal(contextLevel(reading(899_999)), "near");
  assert.equal(contextLevel(reading(900_000)), "over");
  assert.equal(contextLevel(reading(1_200_000)), "over");
});

test("the popover divides the read into the instructions, the tools, the plan, and the conversation left over, every count an estimate marked with ~", () => {
  const rows = contextRows(CONTEXT, undefined);
  assert.deepEqual(
    rows.map((row) => [row.label, rowCount(row)]),
    [
      ["System prompt", "~1.2k"],
      ["Tool definitions", "~2.8k"],
      ["Plan", "~600"],
      ["Conversation", "~615.4k"],
    ],
  );
  // The bar's stretches are shares of the window, so together they fill what the step read.
  const filled = rows.reduce((sum, row) => sum + rowWidth(row, CONTEXT), 0);
  assert.ok(Math.abs(filled - 62) < 1e-9);
});

test("an agent handed a prompt names its brief so; once eve compacted, the brief is folded into the conversation; estimates that outrun the read are scaled down to it", () => {
  assert.deepEqual(
    contextRows(CONTEXT, CODING_AGENT_BRIEF.PROMPT).map((row) => row.label),
    ["System prompt", "Tool definitions", "Prompt", "Conversation"],
  );
  const compacted: CodingAgentContext = {
    ...CONTEXT,
    estimated: { systemPromptTokens: 1_200, toolDefinitionTokens: 2_800 },
    compactedAt: NOW - 120_000,
  };
  assert.deepEqual(
    contextRows(compacted, CODING_AGENT_BRIEF.PLAN).map((row) => [row.label, rowCount(row)]),
    [
      ["System prompt", "~1.2k"],
      ["Tool definitions", "~2.8k"],
      ["Conversation", "~616.0k"],
    ],
  );
  // A read the estimates outrun scales them down to it: the parts add up to the count and the
  // bar fills what the step read, with no conversation left rather than less than none.
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
    { label: "Read from cache", value: "600.0k" },
    { label: "Written to cache", value: "18.0k" },
    { label: "Last step's output", value: "2.4k" },
    { label: "Compacts at", value: "900k (90%)" },
  ]);
  const { cachedInputTokens: _read, cacheWriteTokens: _written, ...uncached } = CONTEXT;
  assert.deepEqual(contextStats({ ...uncached, compactedAt: NOW - 120_000 }, NOW), [
    { label: "Last step's output", value: "2.4k" },
    { label: "Compacts at", value: "900k (90%)" },
    { label: "Last compacted", value: "2m ago" },
  ]);
});
