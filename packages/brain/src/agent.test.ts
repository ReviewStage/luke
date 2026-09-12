import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  ACTION_KIND,
  ACTION_TOOL,
  type ActionOutputEnvelope,
  acceptedActionOutput,
  refusedActionOutput,
  type ValidatedAction,
} from "@sidecar/actions";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  checkpointFormatTag,
  DEFAULT_AGENT_ID,
  MEMORY_SCOPE_KIND,
  RUN_ORIGIN,
} from "@sidecar/runtime/vocabulary";
import {
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  SESSION_STATUS,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { Effect, TestClock } from "effect";
import { advanceHarness, ambientTimers, effectHarness, effectReviewing } from "./effect/harness.js";
import { type BrainPersistedState, freshBrainState } from "./envelope.js";
import { BrainGenerationClock } from "./generation-clock.js";
import {
  ABC,
  acceptedRunId,
  actionsOffered,
  adapterOf,
  agentOn,
  answered,
  ask,
  assertNoActionReached,
  type BrainClient,
  type BrainClientAnswer,
  CHECKPOINT,
  call,
  claude,
  DEF,
  edge,
  FakeClient,
  failedAnswer,
  functionOutputs,
  gatedClient,
  heldOpenRuntime,
  heldPerformer,
  INSTRUCTION_IN_DATA,
  itemsOfType,
  itemText,
  LIFETIME,
  message,
  messageAction,
  NO_ACTS_POLICY,
  NOW,
  OBSERVATION_ACTIONS,
  OLD_SECRET,
  performerWith,
  quietAnswer,
  reasoning,
  session,
  settle,
  submit,
} from "./harness.js";
import type { BrainActionExecution } from "./performer.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
  isTerminalBrainRequestStatus,
} from "./requests.js";
import { responsesModelAnswer } from "./responses-api.js";
import { fakeBrainStateRepository } from "./testing.js";
import { BRAIN_TOOL } from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

it.effect("an announce is delivered trimmed, and every output item is remembered", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    h.client.answers.push(
      answered([
        reasoning("rs_1"),
        call("call_1", BRAIN_TOOL.ANNOUNCE, { briefing: "  Checkout agent wants a decision. " }),
      ]),
      answered([reasoning("rs_2"), message("said it")]),
    );
    yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
    yield* advanceHarness(NOW + 3_000);

    assert.equal(h.client.inputs.length, 2);
    assert.deepEqual(h.deliveries, [
      {
        briefing: "Checkout agent wants a decision.",
        decidedAt: NOW + 3_000,
      },
    ]);
    const second = h.client.inputs[1] ?? [];
    const outputs = itemsOfType(second, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
    assert.equal(outputs.length, 1);
    assert.equal(outputs[0]?.call_id, "call_1");
    assert.equal(itemsOfType(second, RESPONSES_INPUT_ITEM_TYPE.REASONING).length, 1);
    assert.equal(itemsOfType(second, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 1);
    const remembered = h.persisted.at(-1)?.items ?? [];
    assert.deepEqual(
      remembered.map((item) => item.type),
      ["message", "reasoning", "function_call", "function_call_output", "reasoning", "message"],
    );
    assert.deepEqual(h.traces[0]?.toolCalls, [
      {
        name: BRAIN_TOOL.ANNOUNCE,
        argumentsChars: JSON.stringify({ briefing: "  Checkout agent wants a decision. " }).length,
        outcomeStatus: "accepted",
      },
    ]);
    assert.deepEqual(h.traces[0]?.deliveries, [{ briefingChars: 32 }]);
  }),
);

it.effect("an ask returns the final text, carries pending wakes, and refuses announce", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    yield* Effect.promise(() => h.agent.wake([edge(DEF)]));
    h.client.answers.push(
      answered([
        call("call_a", BRAIN_TOOL.ANNOUNCE, { briefing: "nope" }),
        call("call_b", "send_session_message", {
          provider_id: ABC.providerId,
          provider_session_id: ABC.providerSessionId,
          text: "run the tests",
        }),
      ]),
      answered([message("Sent.")]),
    );
    const answer = yield* Effect.promise(() => ask(h, "tell the checkout agent to run the tests"));

    assert.equal(answer?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
    assert.equal(answer?.text, "Sent.");
    assert.equal(answer?.performedActions, 1);
    assert.deepEqual(h.deliveries, []);
    assert.deepEqual(h.performed, [
      { kind: ACTION_KIND.MESSAGE, identity: ABC, text: "run the tests", origin: RUN_ORIGIN.USER },
    ]);
    assert.equal(h.agent.pendingWakes(), 0);
    // Nothing is left standing: the wake's own coalesce timer, the turn's
    // execution deadline, and the ask's own wait timeout are all settled or
    // cancelled, so running the clock far past every one of them opens no
    // further turn.
    const inputsBefore = h.client.inputs.length;
    yield* advanceHarness(NOW + 11 * 24 * 60 * 60 * 1000);
    assert.equal(h.client.inputs.length, inputsBefore);
    assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ASK);
    assert.equal(h.traces[0]?.origin, RUN_ORIGIN.USER);
    assert.equal(h.traces[0]?.outputText, "Sent.");
    assert.ok(h.traces[0]?.tools.includes(ACTION_TOOL.SEND_SESSION_MESSAGE));
    assert.ok(!h.traces[0]?.tools.includes(BRAIN_TOOL.ANNOUNCE));
    assert.deepEqual(h.client.actionsOffered, [true, true]);
    // The action arrived attributed to the developer's ask, live while the turn
    // ran, and revoked once the turn was over.
    assert.equal(h.executions[0]?.origin, RUN_ORIGIN.USER);
    assert.equal(h.executions[0]?.isRevoked(), true);
  }),
);

it.effect(
  "a wait that runs out answers the run still pending, and the same run finishes once",
  () =>
    Effect.gen(function* () {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const inner = new FakeClient();
      inner.answers.push(answered([message("Done at last.")]));
      const slow: BrainClient = {
        respond: async (input, options) => {
          await gate;
          return inner.respond(input, options);
        },
        quietUntil: () => undefined,
      };
      const h = yield* effectHarness({ client: slow });
      const accepted = yield* Effect.promise(() => submit(h, "anything?", "sub-1"));
      const runId = acceptedRunId(accepted);
      yield* Effect.promise(() => settle());
      // The transport retries the same submission: the same run, no second turn.
      assert.deepEqual(yield* Effect.promise(() => submit(h, "anything?", "sub-1")), accepted);
      const firstWait = h.agent.waitAsk(runId, 30_000);
      yield* Effect.promise(() => settle());
      yield* advanceHarness(NOW + 30_000);
      const pending = yield* Effect.promise(() => firstWait);
      assert.equal(pending?.status, BRAIN_REQUEST_STATUS.RUNNING);
      assert.equal(pending?.runId, runId);
      // A second wait, well past the old 45-second deadline: still the one run.
      const secondWait = h.agent.waitAsk(runId, 30_000);
      yield* Effect.promise(() => settle());
      yield* advanceHarness(NOW + 60_000);
      assert.equal((yield* Effect.promise(() => secondWait))?.status, BRAIN_REQUEST_STATUS.RUNNING);
      release?.();
      yield* Effect.promise(() => settle());
      const done = yield* Effect.promise(() => h.agent.waitAsk(runId, 1));
      assert.equal(done?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(done?.text, "Done at last.");
      assert.equal(inner.inputs.length, 1);
      assert.equal(h.agent.requests().length, 1);
      const stored = h.repository.state;
      assert.equal(stored?.requests[0]?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      // The record's own history: queued, running, and succeeded each checkpointed.
      const statuses = h.persisted.map((state) => state.requests[0]?.status);
      assert.deepEqual(
        statuses.filter((status, index) => status !== statuses[index - 1]),
        [BRAIN_REQUEST_STATUS.QUEUED, BRAIN_REQUEST_STATUS.RUNNING, BRAIN_REQUEST_STATUS.SUCCEEDED],
      );
    }),
);

it.effect(
  "the tool loop has no iteration cap: it runs until the model answers without calls, every call paired",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const rounds = 12;
      for (let index = 0; index < rounds; index += 1) {
        h.client.answers.push(answered([call(`loop-${index}`, BRAIN_TOOL.LIST_SESSIONS, {})]));
      }
      h.client.answers.push(answered([message("")]));
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      yield* advanceHarness(NOW + 3_000);

      assert.equal(h.client.inputs.length, rounds + 1);
      const remembered = h.persisted.at(-1)?.items ?? [];
      const calls = itemsOfType(remembered, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL);
      const outputs = itemsOfType(remembered, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
      assert.equal(calls.length, rounds);
      assert.equal(outputs.length, rounds);
      assert.equal(h.traces[0]?.iterations, rounds);
      assert.equal(h.traces[0]?.error, undefined);
      assert.equal(h.traces[0]?.runtime, TOOL_LOOP_RUNTIME.ID);
    }),
);

it.effect("a failed turn rolls the memory and cursors back and persists nothing", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    h.client.answers.push(failedAnswer("boom"));
    yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
    yield* advanceHarness(NOW + 3_000);
    // The capture stands on disk; the failed inference left it unconsumed.
    assert.equal(h.persisted.length, 1);
    assert.equal(h.repository.state?.inbox.length, 1);
    assert.deepEqual(h.repository.state?.cursors, {});
    assert.equal(h.traces[0]?.error, "boom");

    // The same edge again is one observation, read once: the standing entry is
    // tried again rather than the transcript read twice.
    yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
    yield* advanceHarness(NOW + 6_000);
    assert.equal(h.client.inputs[1]?.length, 2);
    assert.deepEqual(
      h.sinceReads.map((read) => read.cursor),
      [undefined],
    );
    assert.equal(h.persisted.length, 2);
    assert.equal(h.repository.state?.inbox.length, 0);
    assert.deepEqual(h.repository.state?.cursors, { [claude.id]: { abc: "abc-cursor" } });
  }),
);

it.effect("a call that fails mid-loop rolls back the whole turn, calls and all", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    h.client.answers.push(
      answered([call("call_1", BRAIN_TOOL.LIST_SESSIONS, {})]),
      failedAnswer("network"),
    );
    yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
    yield* advanceHarness(NOW + 3_000);
    assert.equal(h.persisted.length, 1);
    yield* Effect.promise(() => h.agent.wake([edge(DEF)]));
    yield* advanceHarness(NOW + 6_000);
    assert.equal(
      itemsOfType(h.client.inputs[2] ?? [], RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length,
      0,
    );
  }),
);

it.effect(
  "restored memory opens the next turn, and held briefings are re-decided from their own item",
  () =>
    Effect.gen(function* () {
      const prior = [message("the conversation so far, summarized"), message("earlier")];
      const repository = fakeBrainStateRepository({
        ...freshBrainState("gen-prior", NOW - 1),
        checkpointFormat: checkpointFormatTag(CHECKPOINT),
        items: prior,
        cursors: { "claude-code": { abc: "old" } },
      });
      const h = yield* effectHarness({}, repository);
      h.client.answers.push(
        answered([call("call_1", BRAIN_TOOL.ANNOUNCE, { briefing: "Still waiting on you." })]),
        answered([message("")]),
      );
      h.agent.releaseHeld([{ briefing: "Checkout wants a decision.", decidedAt: NOW - 1 }]);
      yield* Effect.promise(() => settle());
      const input = h.client.inputs[0] ?? [];
      assert.deepEqual(input.slice(0, 2), prior);
      assert.equal(h.deliveries[0]?.briefing, "Still waiting on you.");
      assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.HOLD_RELEASED);
      assert.equal(h.sinceReads.length, 0);
    }),
);

it.effect(
  "a wake turn runs the actions the policy allows, journaled and attributed as Luke's own",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness({
        standingContext: () => `Durable facts:\n- ${INSTRUCTION_IN_DATA}`,
        readTranscriptSince: async (): Promise<ProviderTranscriptSinceResult> => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          text: INSTRUCTION_IN_DATA,
          cursor: "c1",
          truncated: false,
        }),
      });
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      h.client.answers.push(
        answered([
          ...OBSERVATION_ACTIONS,
          call("brief", BRAIN_TOOL.ANNOUNCE, { briefing: "Tests asked." }),
        ]),
        answered([message("")]),
      );
      yield* advanceHarness(NOW + 3_000);

      assert.equal(h.performed.length, OBSERVATION_ACTIONS.length);
      assert.ok(h.executions.every((execution) => execution.origin === RUN_ORIGIN.OBSERVATION));
      assert.deepEqual(
        h.deliveries.map((delivery) => delivery.briefing),
        ["Tests asked."],
      );
      assert.deepEqual(h.client.actionsOffered, [true, true]);
      // The observation turn's actions were journaled while they ran and let go of
      // once the turn committed: the file carries no record and no journal for a
      // run Conversation never lists.
      assert.deepEqual(h.repository.state?.journal, []);
      assert.deepEqual(h.repository.state?.requests, []);
      assert.equal(h.traces[0]?.origin, RUN_ORIGIN.OBSERVATION);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "an observation turn whose model never answers ends at the execution deadline, and the queue moves on",
  () =>
    Effect.gen(function* () {
      // The first inference never answers; every later one answers at once.
      let calls = 0;
      const hung: BrainClient = {
        respond: () =>
          ++calls === 1
            ? new Promise<never>(() => undefined)
            : Promise.resolve(answered([message("")])),
        quietUntil: () => undefined,
      };
      const h = yield* effectHarness({ client: hung, executionDeadlineMs: 60_000 });
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      yield* advanceHarness(NOW + 3_000);
      yield* Effect.promise(() => settle());
      assert.equal(h.traces.length, 0, "the turn is still holding the model");
      yield* advanceHarness(NOW + 3_000 + 60_000);
      yield* Effect.promise(() => settle());
      assert.equal(h.traces.length, 1);
      assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.WAKE);
      assert.equal(h.traces[0]?.error, "execution deadline passed");
      // The next turn is not stuck behind the dead one.
      h.agent.rosterLook();
      yield* Effect.promise(() => settle());
      assert.equal(h.traces.length, 2);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a wake turn under a policy denying actions runs none, however the transcript, standing context, or a tool's answer is worded",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness({
        prepareTurn: NO_ACTS_POLICY,
        standingContext: () => `Durable facts:\n- ${INSTRUCTION_IN_DATA}`,
        readTranscriptSince: async (): Promise<ProviderTranscriptSinceResult> => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          text: INSTRUCTION_IN_DATA,
          cursor: "c1",
          truncated: false,
        }),
        readTranscript: async (): Promise<ProviderTranscriptResult> => ({
          status: ACTION_RESULT_STATUS.ACCEPTED,
          transcript: INSTRUCTION_IN_DATA,
        }),
      });
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      h.client.answers.push(
        // The model reads the whole transcript first, and its answer carries the
        // same instruction; the next emission is every action plus a briefing.
        answered([
          call("read", BRAIN_TOOL.READ_TRANSCRIPT, {
            provider_id: ABC.providerId,
            provider_session_id: ABC.providerSessionId,
          }),
        ]),
        answered([
          ...OBSERVATION_ACTIONS,
          call("brief", BRAIN_TOOL.ANNOUNCE, { briefing: "Tests asked." }),
        ]),
        answered([message("")]),
      );
      yield* advanceHarness(NOW + 3_000);

      assert.deepEqual(h.performed, []);
      assert.deepEqual(h.executions, []);
      assert.deepEqual(
        h.deliveries.map((delivery) => delivery.briefing),
        ["Tests asked."],
      );
      assert.deepEqual(h.client.actionsOffered, [false, false, false]);
    }),
);

it.effect("a roster look under a policy denying actions runs none", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness({
      prepareTurn: NO_ACTS_POLICY,
      roster: () => ({
        text: "roster",
        identities: [ABC],
        sessions: [session("abc", { status: SESSION_STATUS.WORKING })],
      }),
    });
    h.client.answers.push(answered(OBSERVATION_ACTIONS), answered([message("")]));
    h.agent.rosterLook();
    yield* Effect.promise(() => settle());
    assertNoActionReached(h);
    assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.ROSTER);
  }),
);

it.effect("a hold release under a policy denying actions runs none", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness({ prepareTurn: NO_ACTS_POLICY });
    h.client.answers.push(answered(OBSERVATION_ACTIONS), answered([message("")]));
    h.agent.releaseHeld([{ briefing: INSTRUCTION_IN_DATA, decidedAt: NOW - 1 }]);
    yield* Effect.promise(() => settle());
    assertNoActionReached(h);
    assert.equal(h.traces[0]?.trigger, BRAIN_TURN_TRIGGER.HOLD_RELEASED);
  }),
);

it.effect(
  "a developer ask carries every action with a live execution, revoked once the agent stops",
  () =>
    Effect.gen(function* () {
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const h = yield* effectHarness({
        actions: performerWith(async (action, execution): Promise<ActionOutputEnvelope> => {
          performedLate.push({ action, execution });
          await held;
          return execution.isRevoked() ? refusedActionOutput("turn over") : acceptedActionOutput();
        }).actions,
      });
      const performedLate: { action: ValidatedAction; execution: BrainActionExecution }[] = [];
      const [messageAction] = OBSERVATION_ACTIONS;
      assert.ok(messageAction);
      h.client.answers.push(answered([messageAction]), answered([message("Done.")]));
      const asked = ask(h, "send it");
      yield* Effect.promise(() => settle());
      assert.equal(performedLate.length, 1);
      const [late] = performedLate;
      assert.ok(late);
      assert.equal(late.execution.origin, RUN_ORIGIN.USER);
      assert.equal(late.execution.isRevoked(), false);
      // The host stops the agent while the action is still preparing: the standing
      // is withdrawn before the effect, and the performer refuses on it.
      const stopping = h.agent.stop();
      assert.equal(late.execution.isRevoked(), true);
      release?.();
      yield* Effect.promise(() => stopping);
      const answer = yield* Effect.promise(() => asked);
      // The agent stopped under the run: the record says interrupted, and the
      // refused action's output is paired in memory rather than a second call made.
      assert.equal(answer?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
      assert.equal(h.client.inputs.length, 1);
    }),
);

it.effect(
  "a queued ask cancelled before its turn never starts, and its record says cancelled",
  () =>
    Effect.gen(function* () {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const inner = new FakeClient();
      inner.answers.push(answered([message("first")]), answered([message("second")]));
      const h = yield* effectHarness({
        client: {
          respond: async (input, options) => {
            await gate;
            return inner.respond(input, options);
          },
          quietUntil: () => undefined,
        },
      });
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      const cancelled = yield* Effect.promise(() => h.agent.cancelAsk(second));
      assert.equal(cancelled?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      release?.();
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      assert.equal(inner.inputs.length, 1);
      assert.equal(h.repository.state?.requests[1]?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      // Cancelling a finished run changes nothing.
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(first)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      assert.equal(yield* Effect.promise(() => h.agent.cancelAsk("no-such-run")), undefined);
    }),
);

it.effect(
  "a cancel while the model is thinking aborts the request and settles the run cancelled",
  () =>
    Effect.gen(function* () {
      const signals: (AbortSignal | undefined)[] = [];
      let reject: ((error: Error) => void) | undefined;
      const h = yield* effectHarness({
        client: {
          respond: (_input, options) => {
            signals.push(options.signal);
            return new Promise((_resolve, rejectRespond) => {
              reject = rejectRespond;
              options.signal?.addEventListener("abort", () => rejectRespond(new Error("aborted")));
            });
          },
          quietUntil: () => undefined,
        },
      });
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "slow?")));
      yield* Effect.promise(() => settle());
      assert.equal(signals[0]?.aborted, false);
      const cancelled = yield* Effect.promise(() => h.agent.cancelAsk(runId));
      assert.equal(signals[0]?.aborted, true);
      assert.equal(cancelled?.status, BRAIN_REQUEST_STATUS.RUNNING);
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(runId)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(h.repository.state?.requests[0]?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(h.repository.state?.items.length, 0);
      assert.ok(reject);
    }),
);

it.effect(
  "a cancel between two actions keeps the first's result and refuses the second, never undoing the first",
  () =>
    Effect.gen(function* () {
      const held = heldPerformer();
      const performed = held.performed;
      const h = yield* effectHarness({ actions: held.actions });
      h.client.answers.push(
        answered([messageAction("call_1", "one"), messageAction("call_2", "two")]),
        answered([message("Both sent.")]),
      );
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "send both")));
      yield* Effect.promise(() => settle());
      assert.equal(performed.length, 1);
      held.releases[0]?.();
      yield* Effect.promise(() => settle());
      // The first action's result is journaled and checkpointed before the second starts.
      const journaled = h.repository.state?.journal ?? [];
      assert.equal(journaled.length, 2);
      assert.equal(journaled[1]?.outputJson, undefined);
      yield* Effect.promise(() => h.agent.cancelAsk(runId));
      held.releases[1]?.();
      yield* Effect.promise(() => settle());
      const record = h.agent.request(runId);
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(record?.performedActions, 1);
      const outputs = functionOutputs(h.repository.state?.items ?? []);
      assert.equal(outputs.length, 2);
      // No follow-up inference ran for a cancelled run.
      assert.equal(h.client.inputs.length, 1);
    }),
);

it.effect(
  "an action that succeeded survives the follow-up model failing, in the record and in memory",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      h.client.answers.push(answered([messageAction("call_1")]), failedAnswer("network"));
      const record = yield* Effect.promise(() => ask(h, "send it"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.MODEL);
      assert.equal(record?.performedActions, 1);
      assert.equal(record?.text, undefined);
      assert.equal(h.performed.length, 1);
      // The call and its output stand in the stored memory, paired, so the next
      // turn's model sees what was done rather than doing it again.
      const items = h.repository.state?.items ?? [];
      assert.equal(itemsOfType(items, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 1);
      assert.equal(functionOutputs(items).length, 1);
      h.client.answers.push(answered([message("As I said, sent.")]));
      yield* Effect.promise(() => ask(h, "did you?"));
      const next = h.client.inputs[2] ?? [];
      assert.equal(itemsOfType(next, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 1);
      assert.equal(h.performed.length, 1);
    }),
);

it.effect(
  "a repeated call id answers the recorded result once; the same id with other arguments is refused",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      h.client.answers.push(
        answered([messageAction("call_1", "one")]),
        answered([
          messageAction("call_1", "one"),
          messageAction("call_1", "changed"),
          messageAction("call_2", "two"),
        ]),
        answered([message("Done.")]),
      );
      const record = yield* Effect.promise(() => ask(h, "send"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.deepEqual(
        h.performed.map((action) =>
          action.kind === ACTION_KIND.MESSAGE ? action.text : action.kind,
        ),
        ["one", "two"],
      );
      const outputs = functionOutputs(h.client.inputs[2] ?? []);
      const repeated = outputs.filter((output) => output.callId === "call_1");
      assert.equal(repeated.length, 3);
      assert.equal(record?.performedActions, 2);
    }),
);

it.effect("actions run one at a time in the order the model emitted them", () =>
  Effect.gen(function* () {
    const held = heldPerformer();
    const order: string[] = [];
    const h = yield* effectHarness({
      actions: performerWith(async (action, execution) => {
        const words = action.kind === ACTION_KIND.MESSAGE ? action.text : action.kind;
        order.push(`start ${words}`);
        const output = await held.actions.carry(action, execution);
        order.push(`end ${words}`);
        return output;
      }).actions,
    });
    h.client.answers.push(
      answered([messageAction("c1", "a"), messageAction("c2", "b"), messageAction("c3", "c")]),
      answered([message("Three sent.")]),
    );
    const asked = ask(h, "send three");
    yield* Effect.promise(() => settle());
    assert.deepEqual(order, ["start a"]);
    held.releases[0]?.();
    yield* Effect.promise(() => settle());
    assert.deepEqual(order, ["start a", "end a", "start b"]);
    held.releases[1]?.();
    yield* Effect.promise(() => settle());
    held.releases[2]?.();
    const record = yield* Effect.promise(() => asked);
    assert.deepEqual(order, ["start a", "end a", "start b", "end b", "start c", "end c"]);
    assert.equal(record?.performedActions, 3);
  }),
);

it.effect(
  "a memory recall that never answers is ended by the turn's own deadline: the model is never asked, and the turn still settles",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness({
        executionDeadlineMs: 60_000,
        memory: {
          scope: { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: DEFAULT_AGENT_ID },
          provider: {
            recall: () => new Promise<never>(() => undefined),
            tools: [],
          },
        },
      });
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "remember?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.client.inputs.length, 0, "the turn is still inside its recall");

      yield* advanceHarness(NOW + 60_000);
      yield* Effect.promise(() => settle());

      const record = h.agent.request(runId);
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.TIMED_OUT);
      assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.DEADLINE);
      assert.equal(h.client.inputs.length, 0);
      assert.equal(h.traces.length, 1);
      assert.equal(h.traces[0]?.error, "execution deadline passed");
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect("a run past its execution deadline is timed out and its action refused", () =>
  Effect.gen(function* () {
    const held = heldPerformer();
    const h = yield* effectHarness({ actions: held.actions, executionDeadlineMs: 60_000 });
    h.client.answers.push(answered([messageAction("call_1")]), answered([message("Sent.")]));
    const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "send")));
    yield* Effect.promise(() => settle());
    yield* advanceHarness(NOW + 60_000);
    held.releases[0]?.();
    yield* Effect.promise(() => settle());
    const record = h.agent.request(runId);
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.TIMED_OUT);
    assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.DEADLINE);
    assert.equal(record?.performedActions, 0);
    assert.equal(h.client.inputs.length, 1);
  }),
);

it.effect(
  "the store's generation changing under a run revokes it and fences its late checkpoints",
  () =>
    Effect.gen(function* () {
      const held = heldPerformer();
      const h = yield* effectHarness({ actions: held.actions });
      // Only the action is answered: a revoked run asks the model for no follow-up.
      h.client.answers.push(answered([messageAction("call_1")]));
      const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "send")));
      yield* Effect.promise(() => settle());
      const execution = held.executions[0];
      assert.equal(execution?.isRevoked(), false);
      assert.equal(yield* Effect.promise(() => h.store.clear()), true);
      assert.equal(execution?.isRevoked(), true);
      assert.equal(h.agent.requests().length, 0);
      held.releases[0]?.();
      yield* Effect.promise(() => settle());
      // Nothing of the old generation reached the new envelope.
      const fresh = h.store.current();
      assert.equal(fresh?.requests.length, 0);
      assert.equal(fresh?.items.length, 0);
      assert.equal(fresh?.journal.length, 0);
      assert.equal(h.agent.request(runId), undefined);
      // The new generation takes asks as before.
      h.client.answers.push(answered([message("Fresh start.")]));
      assert.equal((yield* Effect.promise(() => ask(h, "hello")))?.text, "Fresh start.");
    }),
);

it.effect(
  "a spoken submission keeps its origin, and an empty ask is refused without a record",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      assert.deepEqual(
        yield* Effect.promise(() =>
          h.agent.submitAsk({
            submissionId: "s",
            question: "   ",
            origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
          }),
        ),
        { outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED, reason: BRAIN_SUBMISSION_REJECTION.EMPTY },
      );
      assert.equal(h.agent.requests().length, 0);
      h.client.answers.push(answered([message("Hi.")]));
      const accepted = yield* Effect.promise(() =>
        h.agent.submitAsk({
          submissionId: "s",
          question: "hello there",
          origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
        }),
      );
      const runId = acceptedRunId(accepted);
      const heard: (readonly BrainRequestRecord[])[] = [];
      const unsubscribe = h.agent.subscribe((records) => heard.push(records));
      const record = yield* Effect.promise(() => h.agent.waitAsk(runId, 60_000));
      unsubscribe();
      assert.equal(record?.origin, BRAIN_REQUEST_ORIGIN.SPOKEN);
      assert.equal(record?.question, "hello there");
      assert.ok(heard.length > 0);
      assert.ok(heard.every((records) => records[0]?.runId === runId));
      assert.ok((heard.at(-1)?.[0]?.revision ?? 0) > 0);
    }),
);

it.effect(
  "a reset while the model is thinking cannot roll old memory into the new generation",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      inner.answers.push(answered([message(`noted: ${OLD_SECRET}`)]));
      const h = yield* effectHarness({ client: inner });
      assert.equal(
        (yield* Effect.promise(() => ask(h, `remember ${OLD_SECRET}`)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );

      // A second ask holds its model answer open across the reset.
      let release: ((answer: BrainClientAnswer) => void) | undefined;
      inner.respond = (input, options) => {
        inner.inputs.push([...input]);
        inner.actionsOffered.push(actionsOffered(options));
        return new Promise((resolve) => {
          release = resolve;
        });
      };
      const held = acceptedRunId(yield* Effect.promise(() => submit(h, "and now?")));
      yield* Effect.promise(() => settle());
      assert.equal(yield* Effect.promise(() => h.store.clear()), true);
      release?.(answered([message(`late answer about ${OLD_SECRET}`)]));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(held), undefined);

      // The new generation's first ask sees nothing of the old one anywhere.
      inner.respond = FakeClient.prototype.respond;
      inner.answers.push(answered([message("fresh")]));
      assert.equal((yield* Effect.promise(() => ask(h, "NEW_ASK")))?.text, "fresh");
      assert.equal(h.repository.state?.requests.length, 1);
      assert.equal(h.repository.state?.requests[0]?.question, "NEW_ASK");
    }),
);

it.effect(
  "a reset during a transcript read or an action's result cannot write into the new generation",
  () =>
    Effect.gen(function* () {
      // Held delta read on an observation turn.
      let releaseRead: ((result: ProviderTranscriptSinceResult) => void) | undefined;
      const h = yield* effectHarness({
        readTranscriptSince: () =>
          new Promise((resolve) => {
            releaseRead = resolve;
          }),
      });
      h.client.answers.push(answered([message("seen")]));
      const capture = h.agent.wake([edge(ABC)]);
      yield* Effect.promise(() => settle());
      assert.ok(releaseRead);
      assert.equal(yield* Effect.promise(() => h.store.clear()), true);
      releaseRead({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        text: OLD_SECRET,
        cursor: "old-cursor",
        truncated: false,
      });
      yield* Effect.promise(() => capture);
      yield* advanceHarness(NOW + 3_000);
      // The late read captures nothing into the new generation: no entry, no
      // cursor of either kind, no inference, no briefing.
      assert.equal(h.client.inputs.length, 0);
      assert.deepEqual(h.store.current()?.cursors, {});
      assert.deepEqual(h.store.current()?.captureCursors, {});
      assert.deepEqual(h.store.current()?.inbox, []);
      assert.deepEqual(h.deliveries, []);

      // Held act result on a developer run, then a new ask in the new generation.
      const held = heldPerformer();
      const acting = yield* effectHarness({ actions: held.actions });
      acting.client.answers.push(answered([messageAction("call_1", OLD_SECRET)]));
      const runId = acceptedRunId(
        yield* Effect.promise(() => submit(acting, `send ${OLD_SECRET}`)),
      );
      yield* Effect.promise(() => settle());
      assert.equal(yield* Effect.promise(() => acting.store.clear()), true);
      held.releases[0]?.();
      yield* Effect.promise(() => settle());
      acting.client.answers.push(answered([message("fresh")]));
      assert.equal((yield* Effect.promise(() => ask(acting, "NEW_ASK")))?.text, "fresh");
      assert.equal(acting.store.current()?.journal.length, 0);
      assert.equal(acting.agent.request(runId), undefined);
      assert.equal(acting.client.inputs.length, 2);
    }),
);

it.effect(
  "a cancel, a deadline, or a stop settles a held read at once, and the next ask proceeds",
  () =>
    Effect.gen(function* () {
      const reads: ((result: ProviderTranscriptResult) => void)[] = [];
      const deltas: ((result: ProviderTranscriptSinceResult) => void)[] = [];
      const h = yield* effectHarness({
        executionDeadlineMs: 60_000,
        readTranscript: () =>
          new Promise((resolve) => {
            reads.push(resolve);
          }),
        readTranscriptSince: () =>
          new Promise((resolve) => {
            deltas.push(resolve);
          }),
      });
      // Cancel while a full read is out: the run settles without waiting on it.
      h.client.answers.push(
        answered([
          call("read_1", BRAIN_TOOL.READ_TRANSCRIPT, {
            provider_id: ABC.providerId,
            provider_session_id: ABC.providerSessionId,
          }),
        ]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "read it")));
      yield* Effect.promise(() => settle());
      assert.equal(reads.length, 1);
      yield* Effect.promise(() => h.agent.cancelAsk(first));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(first)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(h.client.inputs.length, 1);

      // A capture whose delta read is held blocks no ask: the capture is not the
      // run's, so the ask opens on the inbox as it stands and answers.
      const capture = h.agent.wake([edge(DEF)]);
      h.client.answers.push(answered([message("proceeding")]));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "and this?")));
      assert.equal(deltas.length, 1);
      yield* Effect.promise(() => settle());
      assert.equal((yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.text, "proceeding");
      assert.equal(h.client.inputs.length, 2);
      // The late read lands as a capture — an inbox entry and a capture cursor,
      // never a consumed cursor — and the turn it arms reads it from there.
      deltas[0]?.({
        status: ACTION_RESULT_STATUS.ACCEPTED,
        text: "late",
        cursor: "c",
        truncated: false,
      });
      reads[0]?.({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "late" });
      yield* Effect.promise(() => capture);
      assert.deepEqual(h.repository.state?.captureCursors, { [claude.id]: { def: "c" } });
      assert.equal(h.repository.state?.inbox.length, 1);
      assert.deepEqual(h.repository.state?.cursors, {});
      h.client.answers.push(answered([message("")]));
      yield* advanceHarness(NOW + 3_000);
      assert.equal(h.client.inputs.length, 3);
      assert.deepEqual(h.repository.state?.cursors, { [claude.id]: { def: "c" } });
      assert.equal(h.repository.state?.inbox.length, 0);

      // A stop settles a held capture read too: nothing is captured, and the queue drains behind it.
      const held = h.agent.wake([edge(ABC)]);
      yield* Effect.promise(() => settle());
      assert.equal(deltas.length, 2);
      yield* Effect.promise(() => h.agent.stop());
      yield* Effect.promise(() => held);
      assert.equal(h.repository.state?.inbox.length, 0);
    }),
);

it.effect("an incomplete reply and a failed final checkpoint are not reported as success", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    const incompleteAnswer = responsesModelAnswer({
      output: [],
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
    assert.ok(incompleteAnswer);
    h.client.answers.push(incompleteAnswer);
    const incomplete = yield* Effect.promise(() => ask(h, "explain"));
    assert.equal(incomplete?.status, BRAIN_REQUEST_STATUS.FAILED);
    assert.equal(incomplete?.failure, BRAIN_REQUEST_FAILURE.INCOMPLETE);

    // Only the final checkpoint fails: the reply travels, but not as a success.
    const late = yield* effectHarness();
    late.client.answers.push(answered([message("Done.")]));
    const landed = late.repository.save;
    let writes = 0;
    late.repository.save = (state, transcript) => {
      writes += 1;
      // Acceptance, running, and the turn's end land; the settle does not.
      return writes >= 4 ? false : landed(state, transcript);
    };
    const record = yield* Effect.promise(() => ask(late, "hello"));
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
    assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
    assert.equal(record?.text, "Done.");
  }),
);

it.effect(
  "work queued behind a held act opens nothing once the generation it was queued in is reset",
  () =>
    Effect.gen(function* () {
      const held = heldPerformer();
      const h = yield* effectHarness({ actions: held.actions });
      h.client.answers.push(answered([messageAction("call_1")]));
      yield* Effect.promise(() => submit(h, "send"));
      yield* Effect.promise(() => settle());
      // Every observation kind queues behind the held act: a hold release with an
      // old briefing, a roster look, a coalesced wake, and a quiet retry's wakes.
      h.agent.releaseHeld([{ briefing: "OLD_SECRET_QUEUED_BRIEFING", decidedAt: NOW }]);
      yield* Effect.promise(() => h.agent.wake([edge(DEF)]));
      h.agent.rosterLook();
      yield* advanceHarness(NOW + 3_000);
      assert.equal(yield* Effect.promise(() => h.store.clear()), true);
      assert.equal(h.agent.pendingWakes(), 0);
      held.releases[0]?.();
      yield* Effect.promise(() => settle());
      yield* advanceHarness(NOW + 10_000);
      // The only inference was the held ask's own, in the old generation.
      assert.equal(h.client.inputs.length, 1);
      assert.deepEqual(h.store.current()?.cursors, {});
      assert.deepEqual(h.deliveries, []);
      // The new generation still takes fresh work.
      h.client.answers.push(answered([message("fresh")]));
      assert.equal((yield* Effect.promise(() => ask(h, "NEW_ASK")))?.text, "fresh");
    }),
);

it.effect(
  "a briefing is not delivered after a stop or reset that lands during the turn's final write or an earlier delivery",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      yield* Effect.promise(() => h.agent.ready());
      h.client.answers.push(
        answered([
          call("a1", BRAIN_TOOL.ANNOUNCE, { briefing: "OLD_STALE_ANNOUNCEMENT" }),
          call("a2", BRAIN_TOOL.ANNOUNCE, { briefing: "SECOND_STALE_ANNOUNCEMENT" }),
        ]),
        answered([message("")]),
      );
      // The capture lands first; it is the turn's final write that is held.
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      const releasing = h.repository.hold();
      yield* advanceHarness(NOW + 3_000);
      assert.ok(h.repository.holding, "the turn is in its final write");
      const stopping = h.agent.stop();
      releasing(true);
      yield* Effect.promise(() => stopping);
      yield* Effect.promise(() => settle());
      assert.deepEqual(h.deliveries, []);

      // A reset between two deliveries withdraws the second.
      const later = yield* effectHarness({
        deliver: async (delivery) => {
          later.deliveries.push(delivery);
          await later.store.clear();
        },
      });
      later.client.answers.push(
        answered([
          call("b1", BRAIN_TOOL.ANNOUNCE, { briefing: "first" }),
          call("b2", BRAIN_TOOL.ANNOUNCE, { briefing: "second" }),
        ]),
        answered([message("")]),
      );
      yield* Effect.promise(() => later.agent.wake([edge(ABC)]));
      yield* advanceHarness(NOW + 3_000);
      assert.deepEqual(
        later.deliveries.map((delivery) => delivery.briefing),
        ["first"],
      );
    }),
);

it.effect(
  "a generation dies exactly one lifetime after its birth, on the host's clock, revoking the turn it dies under",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const h = yield* effectHarness({ client: inner });
      const generationClock = new BrainGenerationClock({
        store: h.store,
        ...(yield* ambientTimers),
      });
      yield* Effect.promise(() => generationClock.start());
      inner.answers.push(answered([message(`noted ${OLD_SECRET}`)]));
      assert.equal(
        (yield* Effect.promise(() => ask(h, `remember ${OLD_SECRET}`)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      const born = h.store.current();
      assert.ok(born);
      assert.equal(born.expiresAt, NOW + LIFETIME);

      // Held mid-turn one millisecond before the end: still the same generation.
      let release: ((answer: BrainClientAnswer) => void) | undefined;
      inner.respond = (input, options) => {
        inner.inputs.push([...input]);
        inner.actionsOffered.push(actionsOffered(options));
        return new Promise((resolve) => {
          release = resolve;
        });
      };
      yield* advanceHarness(born.expiresAt - 1);
      const held = acceptedRunId(yield* Effect.promise(() => submit(h, "and now?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.store.generationId(), born.generationId);
      assert.ok(release, "the model holds the turn open");

      // The expiry timer fires at the instant itself, under the held turn.
      yield* advanceHarness(born.expiresAt);
      assert.notEqual(h.store.generationId(), born.generationId);
      assert.equal(h.store.current()?.createdAt, born.expiresAt);
      assert.equal(h.agent.request(held), undefined);
      release?.(answered([message(`late ${OLD_SECRET}`)]));
      yield* Effect.promise(() => settle());

      inner.respond = FakeClient.prototype.respond;
      inner.answers.push(answered([message("fresh")]));
      assert.equal((yield* Effect.promise(() => ask(h, "NEW_ASK")))?.text, "fresh");
      assert.equal(h.repository.state?.generationId, h.store.generationId());
      assert.equal(h.repository.state?.requests.length, 1);
      generationClock.stop();
    }),
);

it.effect(
  "an expiry is enforced at the door of a turn and a submission even when no timer fired",
  () =>
    Effect.gen(function* () {
      // A stored generation past its time, found by a launch whose timers are
      // never advanced: the ask is accepted into a fresh generation regardless.
      const stale: BrainPersistedState = {
        ...freshBrainState("gen-stale", NOW - LIFETIME - 1),
        items: [
          { type: RESPONSES_INPUT_ITEM_TYPE.COMPACTION, id: "cmp", encrypted_content: OLD_SECRET },
          message(`after compaction ${OLD_SECRET}`),
        ],
        cursors: { [claude.id]: { abc: "old-cursor" } },
      };
      const h = yield* effectHarness({}, fakeBrainStateRepository(stale));
      h.client.answers.push(answered([message("fresh")]));
      const answer = yield* Effect.promise(() => ask(h, "NEW_ASK"));
      assert.equal(answer?.text, "fresh");
      assert.notEqual(h.store.generationId(), "gen-stale");
      // The cursor died with the generation: the next look reads from the start.
      h.client.answers.push(answered([message("")]));
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      yield* advanceHarness(NOW + 3_000);
      assert.equal(h.sinceReads.at(-1)?.cursor, undefined);

      // A generation that reaches its end while the app sits idle, with the
      // clock advanced but the timer lost, still dies at the next turn's door.
      const idle = yield* effectHarness();
      idle.client.answers.push(answered([message("first")]));
      assert.equal((yield* Effect.promise(() => ask(idle, "first")))?.text, "first");
      const born = idle.store.current();
      assert.ok(born);
      // Jumps the agent's perceived time straight to the generation's expiry,
      // as `TestClock.setTime` alone, rather than through `advanceHarness`:
      // nothing here scheduled a timer to lose, so the point is that no timer
      // fires along the way either.
      yield* TestClock.setTime(born.expiresAt);
      idle.client.answers.push(answered([message("")]));
      yield* Effect.promise(() => idle.agent.wake([edge(ABC)]));
      yield* advanceHarness((yield* TestClock.currentTimeMillis) + 3_000);
      assert.notEqual(idle.store.generationId(), born.generationId);
      assert.equal(idle.store.current()?.requests.length, 0);
    }),
);

it.effect("a fortnight of writes never extends a generation's life", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    const generationClock = new BrainGenerationClock({
      store: h.store,
      ...(yield* ambientTimers),
    });
    yield* Effect.promise(() => generationClock.start());
    h.client.answers.push(answered([message("one")]));
    yield* Effect.promise(() => ask(h, "one"));
    const born = h.store.current();
    assert.ok(born);
    yield* advanceHarness(NOW + 7 * 24 * 60 * 60 * 1000);
    h.client.answers.push(answered([message("two")]));
    yield* Effect.promise(() => ask(h, "two"));
    assert.equal(h.store.current()?.expiresAt, born.expiresAt);
    assert.equal(h.store.current()?.createdAt, born.createdAt);
    assert.equal(h.repository.state?.expiresAt, born.expiresAt);
    yield* advanceHarness(born.expiresAt - 1);
    assert.equal(h.store.generationId(), born.generationId);
    yield* advanceHarness(born.expiresAt);
    assert.notEqual(h.store.generationId(), born.generationId);
    generationClock.stop();
  }),
);

it.effect(
  "a Clear or expiry asked for while a write is out on disk revokes a held action's preparation before the disk answers, and no effect dispatches",
  () =>
    Effect.gen(function* () {
      for (const ending of ["clear", "expiry"] as const) {
        let releasePreparation: (() => void) | undefined;
        let effects = 0;
        const { actions } = performerWith(
          async (_action, execution): Promise<ActionOutputEnvelope> => {
            await new Promise<void>((resolve) => {
              releasePreparation = resolve;
            });
            if (execution.isRevoked()) return refusedActionOutput("revoked before the effect");
            effects += 1;
            return acceptedActionOutput();
          },
        );
        const h = yield* effectHarness({ actions });
        const generationClock = new BrainGenerationClock({
          store: h.store,
          ...(yield* ambientTimers),
        });
        yield* Effect.promise(() => generationClock.start());
        h.client.answers.push(answered([message("first")]));
        yield* Effect.promise(() => ask(h, "first"));
        const born = h.store.current();
        assert.ok(born);
        // The action's start is durable; its preparation is held.
        h.client.answers.push(answered([messageAction("call_1")]));
        const runId = acceptedRunId(yield* Effect.promise(() => submit(h, "send")));
        yield* Effect.promise(() => settle());
        assert.ok(releasePreparation, "the performer holds the action");
        assert.equal(h.repository.state?.journal.length, 1);
        // A metadata write of another run is out on disk when the end is asked for.
        const release = h.repository.hold();
        const marking = h.agent.markConversationRecorded(runId, NOW);
        yield* Effect.promise(() => settle());
        assert.ok(h.repository.holding, "a write is on disk");
        if (ending === "clear") {
          void h.store.clear(NOW + 1);
        } else {
          yield* advanceHarness(born.expiresAt);
        }
        // Fenced before the disk answered.
        assert.equal(h.store.holdsGeneration(born.generationId), false);
        assert.equal(h.agent.request(runId), undefined);
        releasePreparation();
        yield* Effect.promise(() => settle());
        release(true);
        yield* Effect.promise(() => marking);
        yield* Effect.promise(() => settle());
        yield* Effect.promise(() => h.store.flush());
        assert.equal(effects, 0, `${ending}: an effect dispatched after the fence`);
        assert.equal(h.store.current()?.journal.length, 0);
        assert.equal(h.repository.state?.generationId, h.store.generationId());
        assert.equal(h.repository.state?.requests.length, 0);
        generationClock.stop();
      }
    }),
);

it.effect(
  "a Clear pressed while a starting agent's load is still reading the file leaves the fresh generation standing, never the file's",
  () =>
    Effect.gen(function* () {
      const old: BrainPersistedState = {
        ...freshBrainState("gen-old", NOW - 1000),
        items: [message(`kept ${OLD_SECRET}`)],
      };
      const repository = fakeBrainStateRepository(old);
      // Only the load's read is held; the Clear's own look at the file answers at once.
      const releaseRead = repository.holdRead();
      const h = yield* effectHarness({}, repository);
      const readying = h.agent.ready();
      yield* Effect.promise(() => settle());
      assert.ok(repository.holding, "the load is reading the file");
      const clearing = h.store.clear(NOW);
      const fresh = h.store.generationId();
      assert.notEqual(fresh, "gen-old");
      releaseRead();
      yield* Effect.promise(() => readying);
      assert.equal(yield* Effect.promise(() => clearing), true);
      // Store, agent, and disk agree on the successor; the file's memory is gone.
      assert.equal(h.store.generationId(), fresh);
      assert.deepEqual(h.agent.requests(), []);
      h.client.answers.push(answered([message("fresh")]));
      assert.equal((yield* Effect.promise(() => ask(h, "NEW_ASK")))?.text, "fresh");
      assert.equal(h.repository.state?.generationId, fresh);
      assert.deepEqual(h.repository.state?.reset, { clearedAt: NOW, generationId: "gen-old" });
    }),
);

it.effect(
  "an ask during a client quiet ends as an honest failure with no effects, and its id stays spent",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      yield* Effect.promise(() => h.agent.ready());
      h.client.quiet = NOW + 60_000;
      h.client.answers.push(quietAnswer(NOW + 60_000));
      const first = yield* Effect.promise(() => submit(h, "hello", "sub-quiet"));
      const runId = acceptedRunId(first);
      yield* Effect.promise(() => settle());
      // The run is not held for the quiet to end: it settles as a failed call,
      // with nothing performed and nothing delivered.
      const record = h.agent.request(runId);
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.MODEL);
      assert.equal(record?.text, undefined);
      assert.equal(record?.performedActions, 0);
      assert.equal(h.performed.length, 0);
      assert.deepEqual(h.deliveries, []);
      assert.equal(h.repository.state?.requests[0]?.status, BRAIN_REQUEST_STATUS.FAILED);
      // The same submission id is idempotent: it answers with the spent run,
      // never a second one.
      assert.deepEqual(yield* Effect.promise(() => submit(h, "hello", "sub-quiet")), first);
      assert.equal(h.agent.requests().length, 1);
      // The quiet ending replays nothing: no delayed call opens for the ask.
      const calls = h.client.inputs.length;
      h.client.quiet = undefined;
      yield* advanceHarness(NOW + 61_000);
      assert.equal(h.client.inputs.length, calls);
      assert.equal(h.agent.request(runId)?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(h.performed.length, 0);
    }),
);

it.effect(
  "the reply is everything the model said across the run: a preface before a tool call survives an empty final answer, joins a spoken one as its own paragraph, and a shortfall with words is kept beside them",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      h.client.answers.push(
        answered([message("Let me look."), call("c1", BRAIN_TOOL.LIST_SESSIONS, {})]),
        answered([message("")]),
      );
      const silent = yield* Effect.promise(() => ask(h, "look"));
      assert.equal(silent?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(silent?.text, "Let me look.");
      assert.equal(h.traces[0]?.outputText, "Let me look.");

      h.client.answers.push(
        answered([message("Looking now."), call("c2", BRAIN_TOOL.LIST_SESSIONS, {})]),
        answered([message("Two agents are waiting.")]),
      );
      const spoken = yield* Effect.promise(() => ask(h, "look again"));
      assert.equal(spoken?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(spoken?.text, "Looking now.\n\nTwo agents are waiting.");

      const partial = responsesModelAnswer({
        output: [message("Half of")],
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      });
      assert.ok(partial);
      h.client.answers.push(partial);
      const short = yield* Effect.promise(() => ask(h, "explain at length"));
      assert.equal(short?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(short?.text, "Half of");
      assert.equal(h.traces[2]?.outputText, "Half of");
      assert.equal(h.traces[2]?.incomplete, "incomplete: max_output_tokens");
    }),
);

it.effect(
  "a stop during a held initial bootstrap settles at once; the open finishing afterwards is retired exactly once, and a dispose that never settles holds nothing",
  () =>
    Effect.gen(function* () {
      for (const disposeHangs of [false, true]) {
        const model = adapterOf(new FakeClient());
        const held = heldOpenRuntime(model, disposeHangs);
        const h = yield* effectHarness();
        const agent = agentOn(held.runtime, h);
        const ready = agent.ready();
        const pending = agent.submitAsk({
          submissionId: "held-boot",
          question: "hello",
          origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
        });
        yield* Effect.promise(() => settle());
        let stopped = false;
        const stopping = agent.stop().then(() => {
          stopped = true;
        });
        yield* Effect.promise(() => settle());
        assert.equal(stopped, true, "stop settled while the bootstrap was still held");
        yield* Effect.promise(() => stopping);
        yield* Effect.promise(() => ready);
        assert.equal(
          (yield* Effect.promise(() => pending)).outcome,
          BRAIN_SUBMISSION_OUTCOME.REJECTED,
        );
        assert.equal(held.disposed(), 0);
        // The open finishes after everything settled: the context is let go of,
        // once, and never installed.
        held.release();
        yield* Effect.promise(() => settle());
        assert.equal(held.disposed(), 1);
        yield* Effect.promise(() => settle());
        assert.equal(held.disposed(), 1);
      }
    }),
);

it.effect(
  "a reopen the runtime refuses re-admits nothing: the generation refuses turns as incompatible and the stored checkpoint stands as committed",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      h.client.answers.push(answered([message("first")]), failedAnswer("boom"));
      assert.equal(
        (yield* Effect.promise(() => ask(h, "one")))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      const committed = h.repository.state;
      assert.ok(committed && committed.items.length > 0);
      // The runtime's own reopen refuses from here on.
      const original = h.runtime.openContext.bind(h.runtime);
      Object.defineProperty(h.runtime, "openContext", {
        configurable: true,
        value: (...args: Parameters<typeof original>) =>
          Effect.map(original(...args), (opened) => ({
            context: opened.context,
            bootstrap: { loaded: false, reason: "refused reopen", repaired: 0 },
          })),
      });
      const failed = yield* Effect.promise(() => ask(h, "two"));
      assert.equal(failed?.status, BRAIN_REQUEST_STATUS.FAILED);
      const refused = yield* Effect.promise(() => submit(h, "three"));
      assert.deepEqual(refused, {
        outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
        reason: BRAIN_SUBMISSION_REJECTION.INCOMPATIBLE,
      });
      assert.deepEqual(h.repository.state?.items, committed.items);
      assert.equal(h.repository.state?.checkpointFormat, committed.checkpointFormat);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a reopen claimed just before a stop installs nothing: the stop's signal is checked after the wait, and the claimed context is retired",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      let disposed = 0;
      let releaseReopen: (() => void) | undefined;
      const original = h.runtime.openContext.bind(h.runtime);
      let opens = 0;
      Object.defineProperty(h.runtime, "openContext", {
        configurable: true,
        value: (...args: Parameters<typeof original>) =>
          Effect.flatMap(original(...args), (opened) => {
            opens += 1;
            if (opens === 1) return Effect.succeed(opened);
            Object.defineProperty(opened.context, "dispose", {
              value: () => {
                disposed += 1;
              },
            });
            // The reopen's value is ready, but it is handed over only after the
            // test has stopped the agent, so the claim lands before the signal and
            // the host's continuation after it.
            return Effect.async<typeof opened>((resume) => {
              releaseReopen = () => resume(Effect.succeed(opened));
            });
          }),
      });
      h.client.answers.push(failedAnswer("boom"));
      const accepted = yield* Effect.promise(() => submit(h, "fail"));
      assert.ok(accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
      yield* Effect.promise(() => settle());
      assert.ok(releaseReopen, "the failed turn is reopening its context");
      const stopping = h.agent.stop();
      releaseReopen?.();
      yield* Effect.promise(() => stopping);
      yield* Effect.promise(() => settle());
      assert.equal(disposed, 1);
    }),
);

it.effect(
  "an ask arriving while the model is thinking is steered into that run and answered by its reply",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      inner.answers.push(
        answered([message("First alone.")]),
        answered([message("Both answered.")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      // The second ask is running inside the first's execution, not queued behind it.
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
      gated.open();
      yield* Effect.promise(() => settle());
      // Words steered in after the model had already answered are not lost: the
      // run asks once more with them, and the run's reply is everything it said,
      // the answer it had already given and the one that took both in.
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.text,
        "First alone.\n\nBoth answered.",
      );
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      assert.equal(h.agent.request(second)?.text, "First alone.\n\nBoth answered.");
      assert.equal(inner.inputs.length, 2);
      const asks = (inner.inputs[1] ?? []).filter(
        (item) =>
          item.type === RESPONSES_INPUT_ITEM_TYPE.MESSAGE &&
          itemText(item).includes("[developer ask]"),
      );
      assert.equal(asks.length, 2);
      assert.equal(h.repository.state?.requests.length, 2);
    }),
);

it.effect(
  "steering lands between tool calls: every emitted call is answered before the steered words are read",
  () =>
    Effect.gen(function* () {
      const held = heldPerformer();
      const h = yield* effectHarness({ actions: held.actions });
      h.client.answers.push(answered([messageAction("call_1")]), answered([message("Done both.")]));
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "send")));
      yield* Effect.promise(() => settle());
      assert.equal(held.performed.length, 1);
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "and this?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
      held.releases[0]?.();
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      assert.equal((yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.text, "Done both.");
      const secondInput = h.client.inputs[1] ?? [];
      const callIndex = secondInput.findIndex(
        (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
      );
      const outputIndex = secondInput.findIndex(
        (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
      );
      const steeredIndex = secondInput.findIndex(
        (item) =>
          item.type === RESPONSES_INPUT_ITEM_TYPE.MESSAGE && itemText(item).includes("and this?"),
      );
      assert.ok(callIndex >= 0 && outputIndex > callIndex && steeredIndex > outputIndex);
      assert.equal(functionOutputs(h.repository.state?.items ?? []).length, 1);
    }),
);

it.effect(
  "a steered ask cancelled before the run ends is settled cancelled and takes no reply",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      // The steered words were already said to the model, so the run still reads
      // them once more before it ends; cancelling withdraws only the second
      // record's claim on the reply.
      inner.answers.push(answered([message("First.")]), answered([message("Reply.")]));
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(second)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      gated.open();
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.text,
        "First.\n\nReply.",
      );
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(h.agent.request(second)?.text, undefined);
    }),
);

it.effect(
  "cancelling the run under way pairs its pending call, and the ask behind it opens next",
  () =>
    Effect.gen(function* () {
      const held = heldPerformer();
      const h = yield* effectHarness({ actions: held.actions });
      h.client.answers.push(
        answered([messageAction("call_1")]),
        answered([message("Second reply.")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "send")));
      yield* Effect.promise(() => settle());
      assert.equal(held.performed.length, 1);
      // The run is still at its held act, so the record settles cancelled only
      // once that action returns; what the cancel does now is revoke the run.
      yield* Effect.promise(() => h.agent.cancelAsk(first));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "stop, do this instead")));
      yield* Effect.promise(() => settle());
      held.releases[0]?.();
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.text,
        "Second reply.",
      );
      // The interrupted run's call left no dangling function_call in what the next turn read or kept.
      const items = h.repository.state?.items ?? [];
      const calls = itemsOfType(items, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL);
      const outputs = functionOutputs(items);
      assert.equal(calls.length, outputs.length);
      for (const input of h.client.inputs) {
        const callIds = itemsOfType(input, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).map(
          (item) => item.call_id,
        );
        const answeredIds = new Set(functionOutputs(input).map((item) => item.callId));
        assert.ok(callIds.every((id) => answeredIds.has(id)));
      }
    }),
);

it.effect(
  "asks that arrive while a review runs open one turn together, each settled with its reply",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing(
        answered([message("One reply for both.")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      assert.equal(inner.inputs.length, 0);
      yield* release();
      assert.equal(inner.inputs.length, 2);
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.text,
        "One reply for both.",
      );
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.text,
        "One reply for both.",
      );
    }),
);

it.effect("opening notes are read once by the next turn and handed back when that turn fails", () =>
  Effect.gen(function* () {
    const note: import("./wake-events.js").BrainTurnNotice = {
      trigger: BRAIN_TURN_TRIGGER.WAKE,
      identities: [ABC],
      briefings: ["abc is done."],
      performedActions: 0,
      at: NOW,
      label: "Claude Code: abc",
    };
    let held = [note];
    const h = yield* effectHarness({
      openingNotes: {
        take: () => {
          const taken = held;
          held = [];
          return taken;
        },
        restore: (notes) => {
          held = [...notes, ...held];
        },
      },
    });
    h.client.answers.push(failedAnswer("down"));
    yield* Effect.promise(() => ask(h, "what happened?"));
    assert.deepEqual(held, [note]);
    h.client.answers.push(answered([message("abc finished.")]));
    yield* Effect.promise(() => ask(h, "and now?"));
    assert.deepEqual(held, []);
    h.client.answers.push(answered([message("ok")]));
    yield* Effect.promise(() => ask(h, "again?"));
  }),
);

it.effect(
  "a steered companion shares the run's persistence failure: a final write that failed is no success for it",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      // The steered words make the run ask once more; the second answer is the run's reply.
      inner.answers.push(
        answered([message("First alone.")]),
        answered([message("Reply for both.")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
      // The disk refuses from here: the run's final checkpoint cannot land.
      h.repository.refuse();
      gated.open();
      yield* Effect.promise(() => settle());
      const primary = h.agent.request(first);
      const companion = h.agent.request(second);
      assert.equal(primary?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(primary?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
      assert.equal(companion?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(companion?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
      // The reply that formed still travels on both, as the record's own words.
      assert.equal(primary?.text, "First alone.\n\nReply for both.");
      assert.equal(companion?.text, "First alone.\n\nReply for both.");
    }),
);

it.effect(
  "a rider settles when the shared turn dies to a thrown hook after its checkpoint, and none is left running",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      let rosterReads = 0;
      const h = yield* effectHarness({
        client: gated.client,
        // The roster is read after the final checkpoint, outside the model loop's
        // own guard: a throw there is the kind of failure a hook can raise.
        roster: () => {
          rosterReads += 1;
          if (rosterReads >= 3) throw new Error("hook failed after the checkpoint");
          return { text: "roster", identities: [ABC, DEF] };
        },
      });
      inner.answers.push(answered([message("First alone.")]), answered([message("Both.")]));
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
      gated.open();
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(first)?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.ok(
        h.agent.requests().every((record) => record.status !== BRAIN_REQUEST_STATUS.RUNNING),
      );
      assert.equal(h.agent.busy(), false);
    }),
);

it.effect(
  "riders committed running before a turn refused at its door are settled with it, never left running",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing();
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      // The generation is replaced the instant the primary is marked running, so
      // the drained turn reaches its door over a memory that no longer stands.
      let reset = false;
      h.agent.subscribe((records) => {
        if (reset) return;
        if (
          records.some(
            (record) => record.runId === first && record.status === BRAIN_REQUEST_STATUS.RUNNING,
          )
        ) {
          reset = true;
          h.store.reset();
        }
      });
      yield* release();
      assert.ok(reset);
      assert.equal(inner.inputs.length, 1);
      assert.ok(
        h.agent.requests().every((record) => record.status !== BRAIN_REQUEST_STATUS.RUNNING),
      );
      assert.notEqual(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
      assert.equal(h.agent.busy(), false);
    }),
);

it.effect(
  "asks queued behind a primary that is cancelled or whose start the store refuses still open their own turn",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing(answered([message("second answered")]));
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      // The primary is cancelled while the queue still holds them both.
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(first)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      yield* release();
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.text,
        "second answered",
      );
      assert.equal(inner.inputs.length, 2);

      // A primary whose start write the store refuses: it fails, and the ask queued behind it still runs.
      const refused = yield* effectReviewing(answered([message("fourth answered")]));
      const refusing = refused.h;
      const third = acceptedRunId(yield* Effect.promise(() => submit(refusing, "third?")));
      const fourth = acceptedRunId(yield* Effect.promise(() => submit(refusing, "fourth?")));
      yield* Effect.promise(() => settle());
      refusing.repository.refuse();
      yield* refused.release();
      assert.equal(refusing.agent.request(third)?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(refusing.agent.request(third)?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
      // The fourth's own start write is refused too, so it fails the same way rather than waiting forever.
      const fourthRecord = yield* Effect.promise(() => refusing.agent.waitAsk(fourth, 1));
      assert.ok(fourthRecord && isTerminalBrainRequestStatus(fourthRecord.status));
      assert.equal(fourthRecord.status, BRAIN_REQUEST_STATUS.FAILED);
    }),
);

it.effect(
  "past the queue's capacity the oldest ask is folded into the drained turn's summary and ends with it",
  () =>
    Effect.gen(function* () {
      const { QUEUE_DEFAULTS } = yield* Effect.promise(() => import("@sidecar/runtime"));
      const { h, inner, release } = yield* effectReviewing(
        answered([message("one reply for all of them")]),
      );
      const runIdsInOrder: string[] = [];
      for (let index = 0; index <= QUEUE_DEFAULTS.CAPACITY; index += 1) {
        runIdsInOrder.push(acceptedRunId(yield* Effect.promise(() => submit(h, `ask ${index}?`))));
      }
      assert.equal(inner.inputs.length, 0);
      yield* release();
      // One turn for them all, opening with what the overflow folded and then
      // the asks the queue still held.
      assert.equal(inner.inputs.length, 2);
      // The summarized ask settles with the turn that carried its summary, like
      // every other ask in the batch.
      for (const runId of runIdsInOrder) {
        assert.equal(
          (yield* Effect.promise(() => h.agent.waitAsk(runId, 1)))?.text,
          "one reply for all of them",
        );
      }
      // What the developer actually asked is still on the record, uncut: the
      // summary bounds what the model read and rewrites no history.
      assert.equal(h.agent.request(runIdsInOrder[0] ?? "")?.question, "ask 0?");
    }),
);

it.effect(
  "an idle ask pays no debounce, and one that arrives during a turn opens the moment that turn ends",
  () =>
    Effect.gen(function* () {
      const idle = yield* effectHarness();
      idle.client.answers.push(answered([message("at once")]));
      // Resolving with no clock advance at all is the proof of no debounce:
      // a debounced ask would still be waiting on its own delay.
      assert.equal((yield* Effect.promise(() => ask(idle, "now?")))?.text, "at once");
      assert.equal(idle.client.inputs.length, 1);
      const idleInputsBefore = idle.client.inputs.length;
      yield* advanceHarness(NOW + 11 * 24 * 60 * 60 * 1000);
      assert.equal(idle.client.inputs.length, idleInputsBefore);

      const { h, inner, release } = yield* effectReviewing(answered([message("answered")]));
      const queued = acceptedRunId(yield* Effect.promise(() => submit(h, "queued?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(queued)?.status, BRAIN_REQUEST_STATUS.QUEUED);
      yield* release();
      // Nothing advanced the clock: the run ending is what drained the queue.
      assert.equal(inner.inputs.length, 2);
      assert.equal((yield* Effect.promise(() => h.agent.waitAsk(queued, 1)))?.text, "answered");
    }),
);

it.effect(
  "a queued ask cancelled before its turn opens settles cancelled and the drained turn still opens for the rest",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing(
        answered([message("answered for both")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      const third = acceptedRunId(yield* Effect.promise(() => submit(h, "third?")));
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(second)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      yield* release();
      assert.equal(inner.inputs.length, 2);
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.text,
        "answered for both",
      );
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(third, 1)))?.text,
        "answered for both",
      );
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(h.agent.request(second)?.text, undefined);
    }),
);

it.effect(
  "a queued ask cancelled before its turn opens leaves no trace of its words in the model's input",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing(
        answered([message("answered for the rest")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first, kept")));
      const second = acceptedRunId(
        yield* Effect.promise(() => submit(h, "second, withdrawn-marker-7f3a")),
      );
      const third = acceptedRunId(yield* Effect.promise(() => submit(h, "third, kept")));
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(second)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      yield* release();
      assert.equal(inner.inputs.length, 2);
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.text,
        "answered for the rest",
      );
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(third, 1)))?.text,
        "answered for the rest",
      );
      // The cancellation withdrew unsent model input and nothing else: the ask
      // stands on its own record as accepted, with the words the developer typed.
      const cancelled = h.agent.request(second);
      assert.equal(cancelled?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(cancelled?.question, "second, withdrawn-marker-7f3a");
      assert.equal(cancelled?.text, undefined);

      // The same cancel with the primary alone left: the drained turn opens for
      // the one ask still standing, with only its words.
      const solo = yield* effectReviewing(answered([message("just the one")]));
      const alone = solo.h;
      const kept = acceptedRunId(yield* Effect.promise(() => submit(alone, "kept alone")));
      const gone = acceptedRunId(yield* Effect.promise(() => submit(alone, "gone-marker-9c1d")));
      yield* Effect.promise(() => alone.agent.cancelAsk(gone));
      yield* solo.release();
      assert.equal(solo.inner.inputs.length, 2);
      assert.equal(
        (yield* Effect.promise(() => alone.agent.waitAsk(kept, 1)))?.text,
        "just the one",
      );
    }),
);

it.effect(
  "an overflow-summarized ask cancelled before the drain leaves the summary without its line, and no summary at all when it was the only one folded",
  () =>
    Effect.gen(function* () {
      const { QUEUE_DEFAULTS } = yield* Effect.promise(() => import("@sidecar/runtime"));
      const { h, inner, release } = yield* effectReviewing(
        answered([message("one reply for the rest")]),
      );
      const folded = acceptedRunId(
        yield* Effect.promise(() => submit(h, "folded-marker-2b8e, the oldest")),
      );
      const kept: string[] = [];
      for (let index = 1; index <= QUEUE_DEFAULTS.CAPACITY; index += 1) {
        kept.push(acceptedRunId(yield* Effect.promise(() => submit(h, `ask ${index}?`))));
      }
      // The oldest is already folded into the summary when the developer cancels it.
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(folded)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      yield* release();
      assert.equal(inner.inputs.length, 2);
      for (const runId of kept) {
        assert.equal(
          (yield* Effect.promise(() => h.agent.waitAsk(runId, 1)))?.text,
          "one reply for the rest",
        );
      }
      assert.equal(h.agent.request(folded)?.question, "folded-marker-2b8e, the oldest");
      assert.equal(h.agent.request(folded)?.text, undefined);

      // With two folded and one of them cancelled, the summary still opens the
      // turn, counting and naming only the ask that stands.
      const pair = yield* effectReviewing(answered([message("reply")]));
      const two = pair.h;
      const standing = acceptedRunId(
        yield* Effect.promise(() => submit(two, "standing-fold-4d0f")),
      );
      const withdrawn = acceptedRunId(
        yield* Effect.promise(() => submit(two, "withdrawn-fold-6a2c")),
      );
      for (let index = 0; index < QUEUE_DEFAULTS.CAPACITY; index += 1) {
        acceptedRunId(yield* Effect.promise(() => submit(two, `later ${index}`)));
      }
      yield* Effect.promise(() => two.agent.cancelAsk(withdrawn));
      yield* pair.release();
      assert.equal((yield* Effect.promise(() => two.agent.waitAsk(standing, 1)))?.text, "reply");
      assert.equal(two.agent.request(withdrawn)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
    }),
);

it.effect(
  "an ask already drained but waiting behind another turn takes its words with it when cancelled",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing(answered([message("for the kept one")]));
      // The review is at the model behind the gate; two asks queue behind it and
      // the debounce drains them into a turn that waits behind it too.
      const keptRun = acceptedRunId(yield* Effect.promise(() => submit(h, "kept-behind-1e9b")));
      const cancelledRun = acceptedRunId(
        yield* Effect.promise(() => submit(h, "cancelled-behind-5c7d")),
      );
      yield* advanceHarness(NOW + 500);
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(cancelledRun)?.status, BRAIN_REQUEST_STATUS.QUEUED);
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(cancelledRun)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
      yield* release();
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(keptRun, 1)))?.text,
        "for the kept one",
      );
      assert.equal(inner.inputs.length, 2);
      assert.equal(h.agent.request(cancelledRun)?.question, "cancelled-behind-5c7d");
    }),
);

it.effect("folded asks left alone by cancelling every ordinary one still open their turn", () =>
  Effect.gen(function* () {
    const { QUEUE_DEFAULTS } = yield* Effect.promise(() => import("@sidecar/runtime"));
    const { h, inner, release } = yield* effectReviewing(answered([message("for the folded one")]));
    // The queue fills behind the running turn; the oldest waiting ask folds into the summary.
    const folded = acceptedRunId(yield* Effect.promise(() => submit(h, "folded-survivor-3e1a")));
    const ordinary: string[] = [];
    for (let index = 0; index < QUEUE_DEFAULTS.CAPACITY; index += 1) {
      ordinary.push(
        acceptedRunId(yield* Effect.promise(() => submit(h, `ordinary ${index} marker-0d4c`))),
      );
    }
    yield* Effect.promise(() => settle());
    for (const runId of ordinary) {
      assert.equal(
        (yield* Effect.promise(() => h.agent.cancelAsk(runId)))?.status,
        BRAIN_REQUEST_STATUS.CANCELLED,
      );
    }
    assert.equal(h.agent.request(folded)?.status, BRAIN_REQUEST_STATUS.QUEUED);
    assert.equal(h.agent.busy(), true);
    yield* release();
    // The folded ask is not left queued forever: the summary alone opens its turn.
    assert.equal(
      (yield* Effect.promise(() => h.agent.waitAsk(folded, 1)))?.text,
      "for the folded one",
    );
    assert.equal(inner.inputs.length, 2);
    assert.equal(h.agent.busy(), false);
  }),
);

it.effect(
  "cancelling every waiting ask, folded ones included, leaves nothing queued, no turn to open, and the conversation idle",
  () =>
    Effect.gen(function* () {
      const { QUEUE_DEFAULTS } = yield* Effect.promise(() => import("@sidecar/runtime"));
      const { h, inner, release } = yield* effectReviewing(answered([message("fresh")]));
      const all: string[] = [];
      for (let index = 0; index <= QUEUE_DEFAULTS.CAPACITY + 1; index += 1) {
        all.push(acceptedRunId(yield* Effect.promise(() => submit(h, `ask ${index}`))));
      }
      // The two oldest are folded; cancel them first, then everything the queue still holds.
      for (const runId of all) {
        assert.equal(
          (yield* Effect.promise(() => h.agent.cancelAsk(runId)))?.status,
          BRAIN_REQUEST_STATUS.CANCELLED,
        );
      }
      yield* release();
      // Only the review ran: no turn opened for words the developer took back.
      assert.equal(inner.inputs.length, 1);
      assert.equal(h.agent.busy(), false);
      // Nothing is left standing to open a turn later: every cancelled ask's
      // own debounce is gone too, not merely quiet until the next one arrives.
      const cancelledInputsBefore = inner.inputs.length;
      yield* advanceHarness((yield* TestClock.currentTimeMillis) + 60_000);
      assert.equal(inner.inputs.length, cancelledInputsBefore);
      // Stale summary metadata does not hold the conversation: the next ask opens its own turn at once.
      const next = acceptedRunId(yield* Effect.promise(() => submit(h, "after all of them")));
      yield* Effect.promise(() => settle());
      assert.equal((yield* Effect.promise(() => h.agent.waitAsk(next, 1)))?.text, "fresh");
    }),
);

it.effect("a refused final checkpoint fails a drained batch's primary and its riders alike", () =>
  Effect.gen(function* () {
    const { h, release } = yield* effectReviewing(answered([message("reply for both")]));
    const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
    const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
    yield* Effect.promise(() => settle());
    // The disk refuses from the moment the drained turn starts, so what cannot
    // land is its final checkpoint rather than its opening record.
    h.agent.subscribe((records) => {
      if (
        records.some(
          (record) => record.runId === first && record.status === BRAIN_REQUEST_STATUS.RUNNING,
        )
      ) {
        h.repository.refuse();
      }
    });
    yield* release();
    for (const runId of [first, second]) {
      const record = h.agent.request(runId);
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
      assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.PERSISTENCE);
      assert.equal(record?.text, "reply for both");
    }
  }),
);

it.effect(
  "a Clear with an ask still queued opens nothing for it and leaves no timer standing",
  () =>
    Effect.gen(function* () {
      const { h, inner, release } = yield* effectReviewing();
      const queued = acceptedRunId(yield* Effect.promise(() => submit(h, "queued?")));
      yield* Effect.promise(() => settle());
      assert.equal(yield* Effect.promise(() => h.store.clear()), true);
      yield* release();
      // The queued ask belonged to the memory the Clear replaced: no turn opens
      // for it, and the debounce that would have opened one is gone.
      assert.equal(inner.inputs.length, 1);
      assert.equal(h.agent.request(queued), undefined);
      const clearedInputsBefore = inner.inputs.length;
      yield* advanceHarness((yield* TestClock.currentTimeMillis) + 60_000);
      assert.equal(inner.inputs.length, clearedInputsBefore);
    }),
);

it.effect("a stop with an ask still queued records it interrupted and opens nothing", () =>
  Effect.gen(function* () {
    const { h, inner, release } = yield* effectReviewing();
    const queued = acceptedRunId(yield* Effect.promise(() => submit(h, "queued?")));
    yield* Effect.promise(() => settle());
    const stopping = h.agent.stop();
    yield* release();
    yield* Effect.promise(() => stopping);
    yield* Effect.promise(() => settle());
    assert.equal(inner.inputs.length, 1);
    assert.equal(h.agent.request(queued)?.status, BRAIN_REQUEST_STATUS.INTERRUPTED);
  }),
);
