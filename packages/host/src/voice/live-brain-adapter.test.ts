import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_RUN_EVENT, type BrainRunEvent } from "@sidecar/brain";
import {
  BRAIN_ASK_REFUSAL,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmission,
} from "@sidecar/brain/requests";
import { Emitter } from "@sidecar/wire";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainRunEvent,
} from "./live-brain.js";
import { brainAgentLiveBrain, type LiveBrainAgent } from "./live-brain-adapter.js";

function fakeAgent(options: { reject?: boolean } = {}) {
  const events = new Emitter<BrainRunEvent>();
  const submissions: BrainSubmission[] = [];
  const agent: LiveBrainAgent = {
    onRunEvent: events.event,
    submitAsk: async (submission) => {
      submissions.push(submission);
      if (options.reject) {
        return {
          outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
          reason: BRAIN_SUBMISSION_REJECTION.FULL,
        };
      }
      return { outcome: BRAIN_SUBMISSION_OUTCOME.ACCEPTED, runId: "run-1", acceptedAt: 1 };
    },
  };
  return { agent, events, submissions };
}

test("a spoken ask crosses under the spoken origin with the caller's submission id, and an acceptance names the run", async () => {
  const fake = fakeAgent();
  const brain = brainAgentLiveBrain({ agent: () => fake.agent, rosterView: () => "roster" });
  const result = await brain.submitAsk({ submissionId: "sub-1", question: "Developer: hi" });
  assert.deepEqual(result, { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: "run-1" });
  assert.deepEqual(fake.submissions, [
    { submissionId: "sub-1", question: "Developer: hi", origin: BRAIN_REQUEST_ORIGIN.SPOKEN },
  ]);
  assert.equal(brain.standingRosterView(), "roster");
});

test("a rejection carries the brain's standing refusal for its reason, and no agent at all the absent one", async () => {
  const fake = fakeAgent({ reject: true });
  const brain = brainAgentLiveBrain({ agent: () => fake.agent, rosterView: () => "" });
  assert.deepEqual(await brain.submitAsk({ submissionId: "s", question: "q" }), {
    outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
    refusal: BRAIN_ASK_REFUSAL[BRAIN_SUBMISSION_REJECTION.FULL],
  });
  const absent = brainAgentLiveBrain({ agent: () => undefined, rosterView: () => "" });
  assert.deepEqual(await absent.submitAsk({ submissionId: "s", question: "q" }), {
    outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
    refusal: BRAIN_ASK_REFUSAL[BRAIN_SUBMISSION_REJECTION.ABSENT],
  });
});

test("the run seams are read by name and translated; a kind this build does not know is dropped", async () => {
  const fake = fakeAgent();
  const brain = brainAgentLiveBrain({ agent: () => fake.agent, rosterView: () => "" });
  const heard: LiveBrainRunEvent[] = [];
  brain.onRunEvent((event) => heard.push(event));
  await brain.submitAsk({ submissionId: "s", question: "q" });
  fake.events.fire({ kind: BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "transcript_read" });
  fake.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
  fake.events.fire({ kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Done." });
  // SAFETY: a later brain may fire kinds this adapter has never heard of; the test hands one in as such.
  fake.events.fire({ kind: "tool_call", runId: "run-1" } as unknown as BrainRunEvent);
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-1",
    status: BRAIN_REQUEST_STATUS.SUCCEEDED,
  });
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-2",
    status: BRAIN_REQUEST_STATUS.CANCELLED,
  });
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-3",
    status: BRAIN_REQUEST_STATUS.INTERRUPTED,
  });
  fake.events.fire({
    kind: BRAIN_RUN_EVENT.ENDED,
    runId: "run-4",
    status: BRAIN_REQUEST_STATUS.TIMED_OUT,
  });
  assert.deepEqual(heard, [
    { kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP, runId: "run-1", step: "transcript_read" },
    { kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" },
    { kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence: "Done." },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-1", end: LIVE_BRAIN_RUN_END.COMPLETED },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-2", end: LIVE_BRAIN_RUN_END.CANCELLED },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-3", end: LIVE_BRAIN_RUN_END.CANCELLED },
    { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: "run-4", end: LIVE_BRAIN_RUN_END.FAILED },
  ]);
});

test("an agent rebuilt between asks is followed once each, and a listener let go hears nothing more", async () => {
  const first = fakeAgent();
  const second = fakeAgent();
  let current = first;
  const brain = brainAgentLiveBrain({ agent: () => current.agent, rosterView: () => "" });
  const heard: string[] = [];
  const stop = brain.onRunEvent((event) => heard.push(event.runId));
  await brain.submitAsk({ submissionId: "a", question: "q" });
  await brain.submitAsk({ submissionId: "b", question: "q" });
  current = second;
  await brain.submitAsk({ submissionId: "c", question: "q" });
  first.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "from-first" });
  second.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "from-second" });
  assert.deepEqual(heard, ["from-first", "from-second"]);
  stop();
  second.events.fire({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "unheard" });
  assert.deepEqual(heard, ["from-first", "from-second"]);
});
