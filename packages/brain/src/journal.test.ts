import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { ACTION_TOOL, refusedActionOutput } from "@sidecar/actions";
import { ACTION_RESULT_STATUS, isWireString } from "@sidecar/wire";
import { Effect } from "effect";
import { advanceHarness, effectHarness } from "./effect/harness.js";
import { freshBrainState } from "./envelope.js";
import {
  ABC,
  answered,
  ask,
  edge,
  failedAnswer,
  heldPerformer,
  message,
  messageAction,
  NOW,
  OBSERVATION_ACTIONS,
  performerWith,
  settle,
  submit,
} from "./harness.js";
import { BRAIN_REQUEST_FAILURE, BRAIN_REQUEST_STATUS } from "./requests.js";
import { fakeBrainStateRepository } from "./testing.js";

/**
 * The action journal across a turn's life and a relaunch: an action dispatched and
 * never answered is unknown and never called again, an unrecorded turn's rows
 * go once its actions have settled, and an orphaned row is dropped rather than
 * answered as a later turn's own.
 */

it.effect(
  "an observation turn's run id never repeats across a rebuild, and a journal row a crashed observation left behind is dropped rather than answered as this turn's act",
  () =>
    Effect.gen(function* () {
      // The last launch died mid-action in its first wake turn: the journal holds a
      // settled row under the id a counter would mint again, with no record.
      const [messageAction] = OBSERVATION_ACTIONS;
      assert.ok(
        messageAction &&
          isWireString(messageAction.call_id) &&
          isWireString(messageAction.arguments),
      );
      const repository = fakeBrainStateRepository({
        ...freshBrainState("gen-prior", NOW - 1),
        journal: [
          {
            runId: "wake-1",
            callId: messageAction.call_id,
            name: ACTION_TOOL.SEND_SESSION_MESSAGE,
            argumentsJson: messageAction.arguments,
            startedAt: NOW - 10,
            outputJson: JSON.stringify({ status: ACTION_RESULT_STATUS.ACCEPTED }),
            settledAt: NOW - 9,
          },
        ],
      });
      const h = yield* effectHarness({}, repository);
      yield* Effect.promise(() => h.agent.ready());
      assert.deepEqual(h.repository.state?.journal, [], "the orphaned row went with the restore");
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      h.client.answers.push(answered([messageAction]), answered([message("")]));
      yield* advanceHarness(NOW + 3_000);
      // The action ran: the stale row was not mistaken for this turn's own result.
      assert.equal(h.performed.length, 1);
      const first = h.executions[0]?.runId;
      // A second agent over the same store mints a different id for its first wake.
      yield* Effect.promise(() => h.agent.stop());
      const successor = yield* effectHarness({}, repository);
      yield* Effect.promise(() => successor.agent.wake([edge(ABC)]));
      successor.client.answers.push(answered([messageAction]), answered([message("")]));
      yield* advanceHarness(NOW + 3_000);
      assert.equal(successor.performed.length, 1);
      assert.notEqual(successor.executions[0]?.runId, first);
      yield* Effect.promise(() => successor.agent.stop());
    }),
);

it.effect(
  "a performer that throws after dispatch leaves an unknown action, kept through a later model failure and a restart",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness({
        actions: performerWith(() => Promise.reject(new Error("socket closed after send"))).actions,
      });
      h.client.answers.push(answered([messageAction("call_1")]), failedAnswer("network"));
      const record = yield* Effect.promise(() => ask(h, "send it"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.MODEL);
      assert.equal(record?.performedActions, 0);
      assert.equal(record?.unknownActions, 1);

      const relaunched = yield* effectHarness({}, fakeBrainStateRepository(h.repository.state));
      yield* Effect.promise(() => relaunched.agent.ready());
      assert.equal(relaunched.agent.requests()[0]?.unknownActions, 1);

      // A confirmed refusal, by contrast, is a refusal: nothing unknown about it.
      const refusing = yield* effectHarness({
        actions: performerWith(async () => refusedActionOutput("not observed")).actions,
      });
      refusing.client.answers.push(
        answered([messageAction("call_1")]),
        answered([message("Refused.")]),
      );
      const refused = yield* Effect.promise(() => ask(refusing, "send it"));
      assert.equal(refused?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(refused?.unknownActions, 0);
      assert.equal(refused?.performedActions, 0);
    }),
);

it.effect("an interrupted run's started actions are counted unknown at the next launch", () =>
  Effect.gen(function* () {
    const held = heldPerformer();
    const h = yield* effectHarness({ actions: held.actions });
    h.client.answers.push(answered([messageAction("call_1")]));
    yield* Effect.promise(() => submit(h, "send"));
    yield* Effect.promise(() => settle());
    const relaunched = yield* effectHarness({}, fakeBrainStateRepository(h.repository.state));
    yield* Effect.promise(() => relaunched.agent.ready());
    const record = relaunched.agent.requests()[0];
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
    assert.equal(record?.unknownActions, 1);
    assert.equal(record?.performedActions, 0);
  }),
);
