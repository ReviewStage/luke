import assert from "node:assert/strict";
import { TURN_ENDING } from "@sidecar/hosted/coding-agent-wire";
import { test } from "vitest";
import { BRAIN_REQUEST_FAILURE, TURN_STATUS } from "../server/core";
import { type RecordedTurn, turnRecordOf } from "../server/hosted/turn-record";

/**
 * What a turn's footer card is told of it, read off its row: a pure
 * decision over the row, so the wording of each ending and the counts a
 * row may or may not hold are held here, and the reads' own tests hold
 * only that their pages carry it.
 */

const SETTLED: RecordedTurn = {
  status: TURN_STATUS.SETTLED,
  model: "anthropic/claude-opus-5-5",
  reasoningEffort: "high",
  usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 6, reasoningTokens: 1 },
  failure: null,
};

test("a turn the sweep gave up on says it was abandoned, and any other failure that it failed", () => {
  const failed = { ...SETTLED, status: TURN_STATUS.FAILED };
  assert.equal(
    turnRecordOf({ ...failed, failure: BRAIN_REQUEST_FAILURE.ABANDONED }).ending,
    TURN_ENDING.ABANDONED,
  );
  assert.equal(
    turnRecordOf({ ...failed, failure: BRAIN_REQUEST_FAILURE.MODEL }).ending,
    TURN_ENDING.FAILED,
  );
  assert.equal(turnRecordOf(SETTLED).ending, undefined);
});

test("a row with no counts, or counts this build cannot read, says no tokens rather than guessing any", () => {
  assert.equal(turnRecordOf({ ...SETTLED, usage: null }).tokens, undefined);
  assert.equal(turnRecordOf({ ...SETTLED, usage: { inputTokens: "many" } }).tokens, undefined);
  assert.deepEqual(turnRecordOf(SETTLED).tokens, {
    inputTokens: 10,
    outputTokens: 2,
    cachedInputTokens: 6,
  });
});

test("a row that named no effort, or an empty one, says none", () => {
  assert.equal(turnRecordOf({ ...SETTLED, reasoningEffort: null }).effort, undefined);
  assert.equal(turnRecordOf({ ...SETTLED, reasoningEffort: "" }).effort, undefined);
});
