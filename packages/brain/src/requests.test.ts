import assert from "node:assert/strict";
import { test } from "vitest";
import {
  addModelUsage,
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  type BrainRequestRecord,
  brainReplyWords,
  brainRequestRecordFromWire,
  brainRequestRecordToWire,
  STOPPED_ASK_NARRATION,
  stoppedAskNarration,
} from "./requests.js";

const NOW = 1_800_000_000_000;

test("a request record survives the wire whole, with every optional field present or absent", () => {
  const full: BrainRequestRecord = {
    runId: "run-1",
    submissionId: "sub-1",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.FAILED,
    revision: 4,
    acceptedAt: NOW,
    startedAt: NOW + 1,
    settledAt: NOW + 2,
    text: "Two agents are waiting.",
    failure: BRAIN_REQUEST_FAILURE.MODEL,
    performedActions: 1,
    unknownActions: 0,
    usage: { inputTokens: 1200, outputTokens: 80, cachedInputTokens: 1024, reasoningTokens: 40 },
    responseIds: ["resp_1", "resp_2"],
    askRecordedAt: NOW,
    conversationRecordedAt: NOW + 2,
  };
  const bare: BrainRequestRecord = {
    runId: "run-2",
    submissionId: "sub-2",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
    question: "and now?",
    status: BRAIN_REQUEST_STATUS.QUEUED,
    revision: 1,
    acceptedAt: NOW,
    performedActions: 0,
    unknownActions: 0,
  };
  for (const record of [full, bare]) {
    const wire = JSON.parse(JSON.stringify(brainRequestRecordToWire(record)));
    assert.deepEqual(brainRequestRecordFromWire(wire), record);
    assert.deepEqual(Object.keys(wire).sort(), Object.keys(record).sort());
  }
  // A usage missing one of its four counts, or a response id that is not a
  // non-empty string, is a record this build cannot vouch for, not a partial one.
  const wire = brainRequestRecordToWire(full);
  assert.equal(
    brainRequestRecordFromWire({
      ...wire,
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 1 },
    }),
    undefined,
  );
  assert.equal(brainRequestRecordFromWire({ ...wire, responseIds: ["resp_1", ""] }), undefined);
  assert.equal(brainRequestRecordFromWire({ ...wire, responseIds: "resp_1" }), undefined);
});

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

test("a plain stop has no reply words and leaves the quiet line; one that had acted keeps its account", () => {
  const stopped: BrainRequestRecord = {
    runId: "run-3",
    submissionId: "sub-3",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
    question: "what needs me?",
    status: BRAIN_REQUEST_STATUS.CANCELLED,
    revision: 2,
    acceptedAt: NOW,
    settledAt: NOW + 3,
    performedActions: 0,
    unknownActions: 0,
  };
  assert.equal(brainReplyWords(stopped), undefined);
  assert.equal(stoppedAskNarration(stopped), STOPPED_ASK_NARRATION);
  // An action already carried is news the stop must not swallow, so it is a reply after all.
  const acted = { ...stopped, performedActions: 1 };
  assert.equal(stoppedAskNarration(acted), undefined);
  // Any other end is worded as itself and is never the quiet line.
  assert.equal(
    stoppedAskNarration({ ...stopped, status: BRAIN_REQUEST_STATUS.TIMED_OUT }),
    undefined,
  );
  assert.equal(
    stoppedAskNarration({ ...stopped, status: BRAIN_REQUEST_STATUS.RUNNING }),
    undefined,
  );
});
