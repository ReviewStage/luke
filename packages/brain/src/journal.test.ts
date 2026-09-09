import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_TOOL } from "@sidecar/acts";
import { ACT_RESULT_STATUS, isWireString } from "@sidecar/wire";
import { freshBrainState } from "./envelope.js";
import {
  ABC,
  answered,
  ask,
  edge,
  failedAnswer,
  functionOutputs,
  harness,
  heldPerformer,
  message,
  messageAct,
  NOW,
  OBSERVATION_ACTS,
  settle,
  submit,
} from "./harness.js";
import { UNKNOWN_ACT_RESULT } from "./journal.js";
import { BRAIN_REQUEST_FAILURE, BRAIN_REQUEST_STATUS } from "./requests.js";
import { fakeBrainStateRepository } from "./testing.js";

/**
 * The act journal across a turn's life and a relaunch: an act dispatched and
 * never answered is unknown and never called again, an unrecorded turn's rows
 * go once its acts have settled, and an orphaned row is dropped rather than
 * answered as a later turn's own.
 */

test("an observation turn's run id never repeats across a rebuild, and a journal row a crashed observation left behind is dropped rather than answered as this turn's act", async () => {
  // The last launch died mid-act in its first wake turn: the journal holds a
  // settled row under the id a counter would mint again, with no record.
  const [messageAct] = OBSERVATION_ACTS;
  assert.ok(messageAct && isWireString(messageAct.call_id) && isWireString(messageAct.arguments));
  const repository = fakeBrainStateRepository({
    ...freshBrainState("gen-prior", NOW - 1),
    journal: [
      {
        runId: "wake-1",
        callId: messageAct.call_id,
        name: REALTIME_TOOL.SEND_SESSION_MESSAGE,
        argumentsJson: messageAct.arguments,
        startedAt: NOW - 10,
        outputJson: JSON.stringify({ status: ACT_RESULT_STATUS.ACCEPTED }),
        settledAt: NOW - 9,
      },
    ],
  });
  const h = harness({}, repository);
  await h.agent.ready();
  assert.deepEqual(h.repository.state?.journal, [], "the orphaned row went with the restore");
  await h.agent.wake([edge(ABC)]);
  h.client.answers.push(answered([messageAct]), answered([message("")]));
  await h.clock.advance(NOW + 3_000);
  // The act ran: the stale row was not mistaken for this turn's own result.
  assert.equal(h.performed.length, 1);
  const first = h.executions[0]?.runId;
  assert.ok(first && !first.startsWith("wake-1"));
  // A second agent over the same store mints a different id for its first wake.
  await h.agent.stop();
  const successor = harness({}, repository);
  await successor.agent.wake([edge(ABC)]);
  successor.client.answers.push(answered([messageAct]), answered([message("")]));
  await successor.clock.advance(NOW + 3_000);
  assert.equal(successor.performed.length, 1);
  assert.notEqual(successor.executions[0]?.runId, first);
  await successor.agent.stop();
});

test("a performer that throws after dispatch leaves an unknown act, kept through a later model failure and a restart", async () => {
  const h = harness({
    acts: {
      perform: () => Promise.reject(new Error("socket closed after send")),
    },
  });
  h.client.answers.push(answered([messageAct("call_1")]), failedAnswer("network"));
  const record = await ask(h, "send it");
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.MODEL);
  assert.equal(record?.performedActs, 0);
  assert.equal(record?.unknownActs, 1);
  const journaled = h.repository.state?.journal[0];
  assert.ok(journaled?.outputJson?.includes(UNKNOWN_ACT_RESULT.status));
  assert.ok(!journaled?.outputJson?.includes(ACT_RESULT_STATUS.REJECTED));
  // The model reads the unknown, not a refusal, and the journal answers the
  // same call id with it rather than dispatching again.
  const outputs = functionOutputs(h.repository.state?.items ?? []);
  assert.ok(outputs[0]?.output.includes("may have happened"));

  const relaunched = harness({}, fakeBrainStateRepository(h.repository.state));
  await relaunched.agent.ready();
  assert.equal(relaunched.agent.requests()[0]?.unknownActs, 1);

  // A confirmed refusal, by contrast, is a refusal: nothing unknown about it.
  const refusing = harness({
    acts: {
      perform: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "not observed" }),
    },
  });
  refusing.client.answers.push(answered([messageAct("call_1")]), answered([message("Refused.")]));
  const refused = await ask(refusing, "send it");
  assert.equal(refused?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(refused?.unknownActs, 0);
  assert.equal(refused?.performedActs, 0);
});

test("an interrupted run's started acts are counted unknown at the next launch", async () => {
  const held = heldPerformer();
  const h = harness({ acts: held.acts });
  h.client.answers.push(answered([messageAct("call_1")]));
  await submit(h, "send");
  await settle();
  const relaunched = harness({}, fakeBrainStateRepository(h.repository.state));
  await relaunched.agent.ready();
  const record = relaunched.agent.requests()[0];
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  assert.equal(record?.unknownActs, 1);
  assert.equal(record?.performedActs, 0);
});
