import assert from "node:assert/strict";
import test from "node:test";
import {
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
  assert.match(brainReplyWords(acted) ?? "", /^Cancelled, though /);
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
