import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { Effect } from "effect";
import { effectHarness } from "./effect/harness.js";
import {
  ABC,
  adapterOf,
  answered,
  ask,
  call,
  DEF,
  FakeClient,
  itemsOfType,
  message,
  session,
  settle,
} from "./harness.js";
import { PLAN_READS_TOOL_NAME, PREFETCH_READ_KIND } from "./tools/prefetch-tool.js";
import { BRAIN_TOOL } from "./tools.js";
import { BRAIN_PREFETCH_TAKE, type BrainPrefetchTraceRecord } from "./trace.js";

/**
 * The prefetch as a spoken turn meets it: an anticipation planned on the small
 * model, and the reads it made entering the turn's opening input as the call
 * and answer they stand for, ahead of the first inference.
 */

const plan = () =>
  answered([
    call("plan_1", PLAN_READS_TOOL_NAME, {
      reads: [{ kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 1 }],
    }),
  ]);

const anticipation = { id: "1", partialAsk: "what is abc", recentTurns: "Developer: what is abc" };

/** The harness roster with the sessions the planner numbers, since a plan names a session by position. */
const roster = () => ({
  text: "Currently observed sessions:\n- abc\n- def",
  identities: [ABC, DEF],
  sessions: [session(ABC.providerSessionId), session(DEF.providerSessionId)],
});

it.effect(
  "a spoken ask's turn opens with the ask, then the prefetched call and its answer paired by id, ahead of the standing context; the trace marks the read as prefetched",
  () =>
    Effect.gen(function* () {
      const planner = new FakeClient();
      const prefetchTraces: BrainPrefetchTraceRecord[] = [];
      const h = yield* effectHarness({
        roster,
        prefetch: { model: adapterOf(planner), trace: (record) => prefetchTraces.push(record) },
      });
      planner.answers.push(plan(), answered([message("abc read whole.")]));
      h.agent.anticipateAsk(anticipation);
      yield* Effect.promise(() => settle());
      assert.deepEqual(h.wholeReads, [ABC]);
      h.client.answers.push(answered([message("abc is running the tests.")]));
      const record = yield* Effect.promise(() => ask(h, "what is abc doing"));
      assert.equal(record?.text, "abc is running the tests.");
      const input = h.client.inputs[0];
      assert.ok(input);
      const kinds = input.map((item) => item.type);
      assert.deepEqual(kinds.slice(0, 3), [
        RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
        RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
        RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
      ]);
      const [, functionCall, output] = input;
      assert.ok(functionCall && output);
      assert.equal(functionCall.name, BRAIN_TOOL.READ_TRANSCRIPT);
      assert.equal(functionCall.call_id, output.call_id);
      assert.deepEqual(Object.keys(functionCall), ["type", "call_id", "name", "arguments"]);
      // Only the one read entered the context: the model asked for nothing more.
      assert.equal(itemsOfType(input, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 1);
      assert.equal(h.wholeReads.length, 1);
      const trace = h.traces.find((turn) => turn.toolCalls.length > 0);
      assert.ok(trace);
      assert.deepEqual(
        trace.toolCalls.map((toolCall) => [toolCall.name, toolCall.prefetched]),
        [[BRAIN_TOOL.READ_TRANSCRIPT, true]],
      );
      assert.deepEqual(
        prefetchTraces.filter((record) => record.take !== undefined).map((record) => record.take),
        [BRAIN_PREFETCH_TAKE.HIT],
      );
    }),
);

it.effect(
  "an observation turn never takes the slot, which stands for the spoken ask that follows; an ask with nothing anticipated opens with its words alone",
  () =>
    Effect.gen(function* () {
      const planner = new FakeClient();
      const prefetchTraces: BrainPrefetchTraceRecord[] = [];
      const h = yield* effectHarness({
        roster,
        prefetch: { model: adapterOf(planner), trace: (record) => prefetchTraces.push(record) },
      });
      planner.answers.push(plan(), answered([message("abc read whole.")]));
      h.agent.anticipateAsk(anticipation);
      yield* Effect.promise(() => settle());
      h.client.answers.push(answered([message("nothing to announce")]));
      yield* Effect.promise(() => h.agent.rosterLook());
      yield* Effect.promise(() => settle());
      while (h.agent.busy()) yield* Effect.promise(() => settle());
      const look = h.client.inputs[0];
      assert.ok(look);
      assert.equal(itemsOfType(look, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 0);
      assert.equal(prefetchTraces.filter((record) => record.take !== undefined).length, 0);
      h.client.answers.push(answered([message("abc is running the tests.")]));
      yield* Effect.promise(() => ask(h, "what is abc doing"));
      const spoken = h.client.inputs[1];
      assert.ok(spoken);
      assert.equal(itemsOfType(spoken, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 1);
      h.client.answers.push(answered([message("Nothing yet.")]));
      yield* Effect.promise(() => ask(h, "anything need me"));
      const plain = h.client.inputs[2];
      assert.ok(plain);
      // The context keeps the earlier turn's read; this turn added no call of its own.
      assert.equal(
        itemsOfType(plain, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length,
        itemsOfType(spoken, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length,
      );
      assert.deepEqual(
        prefetchTraces.filter((record) => record.take !== undefined).map((record) => record.take),
        [BRAIN_PREFETCH_TAKE.HIT, BRAIN_PREFETCH_TAKE.MISS_NONE],
      );
    }),
);

it.effect(
  "a drop forgets what was read ahead, so the spoken ask reads for itself, and a stopped agent anticipates nothing",
  () =>
    Effect.gen(function* () {
      const planner = new FakeClient();
      const h = yield* effectHarness({ roster, prefetch: { model: adapterOf(planner) } });
      planner.answers.push(plan(), answered([message("abc read whole.")]));
      h.agent.anticipateAsk(anticipation);
      yield* Effect.promise(() => settle());
      assert.equal(h.wholeReads.length, 1);
      h.agent.dropAnticipation();
      h.client.answers.push(answered([message("Nothing yet.")]));
      yield* Effect.promise(() => ask(h, "what is abc doing"));
      const input = h.client.inputs[0];
      assert.ok(input);
      assert.equal(itemsOfType(input, RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL).length, 0);
      yield* Effect.promise(() => h.agent.stop());
      h.agent.anticipateAsk(anticipation);
      yield* Effect.promise(() => settle());
      assert.equal(planner.inputs.length, 1);
    }),
);
