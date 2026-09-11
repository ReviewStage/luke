import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { CHILD_RUN_STATUS } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { effectHarness } from "./effect/harness.js";
import {
  acceptedRunId,
  answered,
  ask,
  call,
  childCompletion,
  FakeClient,
  failedAnswer,
  functionOutputs,
  gatedClient,
  itemsOfType,
  itemText,
  message,
  messageAction,
  settle,
  submit,
} from "./harness.js";
import { BRAIN_INPUT_MARKER } from "./input-items.js";
import { BRAIN_REQUEST_STATUS } from "./requests.js";
import { BRAIN_TOOL } from "./tools.js";

/**
 * The child runs a conversation holds: a delegated task's end as its
 * requester's service reads it, and a completion delivered exactly once,
 * steered into a run under way or opening a turn of its own.
 */

it.effect(
  "a child's completion steers into the requester's run under way, is taken once, and opens its own turn when nothing is under way",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      inner.answers.push(answered([messageAction("act-1")]), answered([message("done")]));
      const { client, open } = gatedClient(inner);
      const h = yield* effectHarness({ client });
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "keep going")));
      yield* Effect.promise(() => settle());
      const completion = childCompletion({
        completionId: "completion:child-1",
        childId: "child-1",
        resultText: "the child's report",
      });
      // The run is waiting on its first inference: the completion is steered in,
      // and a retry that arrives while it is still being decided joins it.
      const steered = h.agent.deliverChildCompletion(...completion);
      yield* Effect.promise(() => settle());
      const again = h.agent.deliverChildCompletion(...completion);
      open();
      assert.deepEqual(yield* Effect.promise(() => steered), { delivered: true });
      assert.deepEqual(yield* Effect.promise(() => again), { delivered: true });
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(runId, 1)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      // Two inferences: the action's, then the one that read the steered completion
      // beside the action's result, and never a third for the duplicate.
      assert.equal(inner.inputs.length, 2);
      const second = inner.inputs[1] ?? [];
      const steeredItems = second.filter((item) =>
        itemsOfType([item], RESPONSES_INPUT_ITEM_TYPE.MESSAGE).some(() =>
          itemText(item).includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION),
        ),
      );
      assert.equal(steeredItems.length, 1);
      assert.equal(h.performed.length, 1);
      // With nothing under way, a new completion opens a turn of its own, offered announce.
      inner.answers.push(
        answered([call("c-announce", BRAIN_TOOL.ANNOUNCE, { briefing: "child done" })]),
      );
      inner.answers.push(answered([message("")]));
      const opened = yield* Effect.promise(() =>
        h.agent.deliverChildCompletion(
          ...childCompletion({
            completionId: "completion:child-2",
            childId: "child-2",
            resultText: "the child's report",
          }),
        ),
      );
      assert.deepEqual(opened, { delivered: true });
      assert.equal(inner.inputs.length, 4);
      assert.deepEqual(
        h.deliveries.map((delivery) => delivery.briefing),
        ["child done"],
      );
      assert.equal(h.agent.requests().length, 1);
    }),
);

it.effect(
  "a child task's end is decided in the brain: a run its generation forgot before it ended is the unknown end, never nothing",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const { client, open } = gatedClient(inner);
      const h = yield* effectHarness({ client });
      const run = yield* Effect.promise(() => h.agent.runChildTask("look into it", "child-run-1"));
      assert.ok(run);
      yield* Effect.promise(() => settle());
      // The generation is replaced while the child's inference is still out: the
      // run's record goes with it, and the requester's service is still owed an end.
      h.store.reset();
      inner.answers.push(answered([message("too late")]));
      open();
      const end = yield* Effect.promise(() => run.done);
      assert.equal(end.status, CHILD_RUN_STATUS.UNKNOWN);
      assert.equal(
        end.failureDetail,
        "the child's run was forgotten by its generation before it ended",
      );
      assert.equal(h.agent.request(run.runId), undefined);
    }),
);

it.effect(
  "without delegation wired, the session tools are offered and refused, and nothing is spawned",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      h.client.answers.push(
        answered([call("c-spawn", BRAIN_TOOL.SESSIONS_SPAWN, { task: "do a thing" })]),
        answered([message("could not")]),
      );
      const record = yield* Effect.promise(() => ask(h, "delegate this"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      const outputs = functionOutputs(h.client.inputs[1] ?? []);
      assert.equal(outputs.length, 1);
      assert.equal(h.performed.length, 0);
    }),
);

it.effect(
  "a steered completion is delivered only once a checkpoint carries it: a run that fails first leaves it owed, and the retry lands",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      inner.answers.push(failedAnswer("upstream down"));
      const { client, open } = gatedClient(inner);
      const h = yield* effectHarness({ client });
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "keep going")));
      yield* Effect.promise(() => settle());
      const completion = childCompletion({
        completionId: "completion:child-1",
        childId: "child-1",
        resultText: "the child's report",
      });
      const pending = h.agent.deliverChildCompletion(...completion);
      open();
      const steered = yield* Effect.promise(() => pending);
      assert.equal(steered.delivered, false);
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(runId, 1)))?.status,
        BRAIN_REQUEST_STATUS.FAILED,
      );
      // The retry opens its own turn and lands.
      inner.answers.push(answered([message("")]));
      const retried = yield* Effect.promise(() => h.agent.deliverChildCompletion(...completion));
      assert.deepEqual(retried, { delivered: true });
      const completionTurns = inner.inputs.filter((input) =>
        input.some(
          (item) =>
            item.type === RESPONSES_INPUT_ITEM_TYPE.MESSAGE &&
            itemText(item).includes(BRAIN_INPUT_MARKER.CHILD_COMPLETION),
        ),
      );
      assert.equal(completionTurns.length, 1);
    }),
);

it.effect(
  "a steered completion carried by an action's checkpoint is delivered even though the run then fails",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      inner.answers.push(
        answered([messageAction("act-1")]),
        answered([messageAction("act-2")]),
        failedAnswer("upstream down"),
      );
      const { client, open } = gatedClient(inner);
      const h = yield* effectHarness({ client });
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "keep going")));
      yield* Effect.promise(() => settle());
      const pending = h.agent.deliverChildCompletion(
        ...childCompletion({
          completionId: "completion:child-2",
          childId: "child-2",
          resultText: "carried by the action",
        }),
      );
      open();
      assert.deepEqual(yield* Effect.promise(() => pending), { delivered: true });
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(runId, 1)))?.status,
        BRAIN_REQUEST_STATUS.FAILED,
      );
      assert.equal(h.performed.length, 2);
    }),
);

it.effect(
  "a completion turn whose checkpoint the store refuses is not delivered, and one whose model fails leaves the context untouched",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const before = JSON.stringify(h.repository.state?.items ?? []);
      h.client.answers.push(failedAnswer("upstream down"));
      const failed = yield* Effect.promise(() =>
        h.agent.deliverChildCompletion(
          ...childCompletion({
            completionId: "completion:child-3",
            childId: "child-3",
            resultText: "never kept",
          }),
        ),
      );
      assert.equal(failed.delivered, false);
      assert.equal(JSON.stringify(h.repository.state?.items ?? []), before);
      h.client.answers.push(answered([message("noted")]));
      h.repository.refuse();
      const refused = yield* Effect.promise(() =>
        h.agent.deliverChildCompletion(
          ...childCompletion({
            completionId: "completion:child-4",
            childId: "child-4",
            resultText: "answered but not kept",
          }),
        ),
      );
      assert.equal(refused.delivered, false);
      h.repository.accept();
    }),
);
