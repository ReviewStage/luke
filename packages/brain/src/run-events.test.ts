import assert from "node:assert/strict";
import { it, test } from "@effect/vitest";
import {
  ACTION_OUTPUT_STATUS,
  ACTION_TOOL,
  refusedActionOutput,
  unknownActionOutput,
} from "@sidecar/actions";
import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { TOOL_PART_STATE } from "@sidecar/session";
import { readStoredUIMessages } from "@sidecar/session/ui-messages";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  OBSERVATION_SOURCE,
  type UnparsedWireValue,
  valueFromJsonText,
} from "@sidecar/wire";
import { type ToolSet, tool, type UIMessage } from "ai";
import { Effect, Schema } from "effect";
import { advanceHarness, effectHarness } from "./effect/harness.js";
import {
  ABC,
  acceptedRunId,
  answered,
  answeredUnder,
  ask,
  type BrainClientAnswer,
  call,
  edge,
  FakeClient,
  gatedClient,
  type Harness,
  message,
  NOW,
  PLAIN_PREPARATION,
  performerWith,
  settle,
  submit,
} from "./harness.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "./requests.js";
import {
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  type BrainRunEvent,
  type BrainRunEventKind,
  isToolRefusalStatus,
  replySentences,
  SLOW_STEP_KIND,
  slowStepOf,
  TOOL_CALL_SETTLEMENT,
  toolCallSettlementOf,
  turnOriginOf,
} from "./run-events.js";
import { TOOL_RESULT_STATUS } from "./runtime.js";
import { BRAIN_TOOL, brainToolCatalog, resolveTurnToolPolicy } from "./tools.js";
import { BRAIN_TURN_KIND, BRAIN_TURN_TRIGGER, type BrainTurnDescription } from "./turn.js";
import { TurnEvents } from "./turn-events.js";
import {
  AssistantMessageBuilder,
  HOSTED_WORDS_METADATA,
  REASONING_PROVIDER_KEY,
  STEP_START_PART,
  toolPartType,
  UI_PART_STATE,
  UI_PART_TYPE,
  userMetadataOf,
} from "./ui-messages.js";

function listen(h: Harness): BrainRunEvent[] {
  const events: BrainRunEvent[] = [];
  h.agent.onRunEvent((event) => events.push(event));
  return events;
}

/** The four moments a live relay reads, and nothing the record's writer reads beside them. */
const RELAY_KINDS: ReadonlySet<BrainRunEventKind> = new Set([
  BRAIN_RUN_EVENT.SLOW_STEP,
  BRAIN_RUN_EVENT.ACTIONS_SETTLED,
  BRAIN_RUN_EVENT.REPLY_SENTENCE,
  BRAIN_RUN_EVENT.ENDED,
]);

/** An event as the relay of #910 reads it: its own fields, without the turn stamp every event now carries. */
function bare(event: BrainRunEvent | undefined) {
  if (!event) return undefined;
  const { conversationId: _conversation, turnId: _turn, sequence: _sequence, ...own } = event;
  return own;
}

function relayed(events: readonly BrainRunEvent[]) {
  return events.filter((event) => RELAY_KINDS.has(event.kind)).map(bare);
}

function kinds(events: readonly BrainRunEvent[]): BrainRunEventKind[] {
  return events.map((event) => event.kind);
}

/** Every event of one turn: stamped with the conversation and that turn, and numbered from one without a gap. */
function assertOneTurn(events: readonly BrainRunEvent[], turnId: string): void {
  assert.deepEqual(
    events.map((event) => event.conversationId),
    events.map(() => MAIN_SESSION_KEY),
  );
  assert.deepEqual(
    events.map((event) => event.turnId),
    events.map(() => turnId),
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index + 1),
  );
}

function ofKind<Kind extends BrainRunEventKind>(
  events: readonly BrainRunEvent[],
  kind: Kind,
): Extract<BrainRunEvent, { kind: Kind }>[] {
  return events.filter(
    (event): event is Extract<BrainRunEvent, { kind: Kind }> => event.kind === kind,
  );
}

const readAbc = call("read_1", BRAIN_TOOL.READ_TRANSCRIPT, {
  provider_id: ABC.providerId,
  provider_session_id: ABC.providerSessionId,
});

const messageAbc = (callId: string) =>
  call(callId, ACTION_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: ABC.providerId,
    provider_session_id: ABC.providerSessionId,
    text: "run the tests",
  });

/** The tools the turns below call, as the storage reader is registered with them. */
const STORED_TOOLS: ToolSet = {
  [BRAIN_TOOL.READ_TRANSCRIPT]: tool({
    inputSchema: Schema.standardSchemaV1(
      Schema.Struct({ provider_id: Schema.String, provider_session_id: Schema.String }),
    ),
  }),
  [ACTION_TOOL.SEND_SESSION_MESSAGE]: tool({
    inputSchema: Schema.standardSchemaV1(
      Schema.Struct({
        provider_id: Schema.String,
        provider_session_id: Schema.String,
        text: Schema.String,
      }),
    ),
  }),
};

/** The messages as a store would hold them: serialized and read back, which is what the reader is handed. */
function stored(messages: readonly (UIMessage | undefined)[]): UnparsedWireValue {
  // SAFETY: a JSON round trip of UIMessages answers a wire value; the reader validates its shape.
  return JSON.parse(JSON.stringify(messages)) as UnparsedWireValue;
}

const SPOKEN_ASK = { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE };
const BRAIN_AUTHORED = { author: MESSAGE_AUTHOR.BRAIN };

const SUMMARIZED_REASONING = {
  type: "reasoning",
  id: "rs_1",
  summary: [{ type: "summary_text", text: "Only abc is waiting." }],
  encrypted_content: "opaque",
};

it.effect(
  "a run that reads a transcript tells its slow step once, then its actions settling, then each sentence, then its end",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      h.client.answers.push(
        answered([readAbc]),
        answered([message("The tests pass. Nothing needs you!")]),
      );
      const record = yield* Effect.promise(() => ask(h, "how is it going?"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      const runId = record?.runId ?? "";
      assert.deepEqual(relayed(events), [
        { kind: BRAIN_RUN_EVENT.SLOW_STEP, runId, step: SLOW_STEP_KIND.TRANSCRIPT_READ },
        { kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId },
        { kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence: "The tests pass." },
        { kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence: "Nothing needs you!" },
        {
          kind: BRAIN_RUN_EVENT.ENDED,
          runId,
          status: BRAIN_REQUEST_STATUS.SUCCEEDED,
          text: "The tests pass. Nothing needs you!",
          usage: { inputTokens: 200, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0 },
        },
      ]);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a developer turn tells the documented sequence, every event stamped with the conversation and the turn and numbered without a gap",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      h.client.answers.push(
        answeredUnder("resp_1", [readAbc], { input: 900, output: 40, cached: 768, reasoning: 30 }),
        answeredUnder("resp_2", [message("The tests pass. Nothing needs you!")], {
          input: 1000,
          output: 10,
          cached: 896,
          reasoning: 0,
        }),
      );
      const record = yield* Effect.promise(() => ask(h, "how is it going?"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      const runId = record?.runId ?? "";
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
        BRAIN_RUN_EVENT.SLOW_STEP,
        BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      assertOneTurn(events, runId);

      const [started] = ofKind(events, BRAIN_RUN_EVENT.TURN_STARTED);
      assert.deepEqual(bare(started), {
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        origin: BRAIN_TURN_ORIGIN.SPOKEN,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: NOW,
      });

      // The call is told with its parsed input before it runs, and its output after.
      const [callStarted] = ofKind(events, BRAIN_RUN_EVENT.TOOL_CALL_STARTED);
      assert.deepEqual(bare(callStarted), {
        kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
        callId: "read_1",
        name: BRAIN_TOOL.READ_TRANSCRIPT,
        input: { provider_id: ABC.providerId, provider_session_id: ABC.providerSessionId },
      });
      const [callSettled] = ofKind(events, BRAIN_RUN_EVENT.TOOL_CALL_SETTLED);
      assert.equal(callSettled?.callId, "read_1");
      assert.equal(callSettled?.name, BRAIN_TOOL.READ_TRANSCRIPT);
      assert.equal(callSettled?.settlement.state, TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE);
      assert.equal(callSettled?.settlement.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.ok(isRecord(callSettled?.settlement.output));
      assert.equal(callSettled?.settlement.output.status, ACTION_RESULT_STATUS.ACCEPTED);

      // The turn's messages: the developer's words first, the model's answer once
      // it is on record, each saying what the storage vocabulary lets it say.
      const [opening, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      assert.equal(opening?.message.role, MESSAGE_ROLE.USER);
      assert.deepEqual(opening?.message.metadata, SPOKEN_ASK);
      assert.deepEqual(
        opening?.message.parts.map((part) => part.type),
        [UI_PART_TYPE.TEXT],
      );
      assert.equal(answer?.message.role, MESSAGE_ROLE.ASSISTANT);
      assert.deepEqual(answer?.message.metadata, BRAIN_AUTHORED);
      // Each inference's parts stand behind their own step boundary: the call the
      // first answered with, then the words the second did.
      assert.deepEqual(answer?.message.parts, [
        STEP_START_PART,
        {
          type: toolPartType(BRAIN_TOOL.READ_TRANSCRIPT),
          toolCallId: "read_1",
          state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
          input: { provider_id: ABC.providerId, provider_session_id: ABC.providerSessionId },
          output: callSettled?.settlement.output,
        },
        STEP_START_PART,
        {
          type: UI_PART_TYPE.TEXT,
          text: "The tests pass. Nothing needs you!",
          state: UI_PART_STATE.DONE,
        },
      ]);
      assert.notEqual(opening?.message.id, answer?.message.id);
      // Both rows read back under the storage vocabulary exactly as they were told.
      const messages = [opening?.message, answer?.message];
      assert.deepEqual(
        yield* Effect.promise(() => readStoredUIMessages(stored(messages), STORED_TOOLS)),
        {
          ok: true,
          value: messages,
        },
      );

      // The turn's end carries what the run kept: the same accounting its record ends with.
      const [turnEnded] = ofKind(events, BRAIN_RUN_EVENT.TURN_ENDED);
      const [ended] = ofKind(events, BRAIN_RUN_EVENT.ENDED);
      assert.deepEqual(bare(turnEnded), {
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        status: BRAIN_REQUEST_STATUS.SUCCEEDED,
        usage: {
          inputTokens: 1900,
          outputTokens: 50,
          cachedInputTokens: 1664,
          reasoningTokens: 30,
        },
        responseIds: ["resp_1", "resp_2"],
        at: NOW,
      });
      assert.deepEqual(ended?.usage, turnEnded?.usage);
      assert.deepEqual(ended?.responseIds, turnEnded?.responseIds);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a run keeps every response id and the four counts summed over its answers, on its record and on its end",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      h.client.answers.push(
        answeredUnder("resp_1", [messageAbc("send_1")], {
          input: 900,
          output: 40,
          cached: 768,
          reasoning: 30,
        }),
        answeredUnder("resp_2", [message("Sent.")], {
          input: 1000,
          output: 10,
          cached: 896,
          reasoning: 0,
        }),
      );
      const record = yield* Effect.promise(() => ask(h, "tell abc to run the tests"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      const usage = {
        inputTokens: 1900,
        outputTokens: 50,
        cachedInputTokens: 1664,
        reasoningTokens: 30,
      };
      assert.deepEqual(record?.responseIds, ["resp_1", "resp_2"]);
      assert.deepEqual(record?.usage, usage);
      // The record on disk says the same, so a relaunch reads what the run cost.
      const stored = h.repository.state?.requests.find((entry) => entry.runId === record?.runId);
      assert.deepEqual(stored?.responseIds, ["resp_1", "resp_2"]);
      assert.deepEqual(stored?.usage, usage);
      const ended = events.find((event) => event.kind === BRAIN_RUN_EVENT.ENDED);
      assert.ok(ended?.kind === BRAIN_RUN_EVENT.ENDED);
      assert.deepEqual(ended.responseIds, ["resp_1", "resp_2"]);
      assert.deepEqual(ended.usage, usage);
      assert.equal(events.filter((event) => event.kind === BRAIN_RUN_EVENT.ENDED).length, 1);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "two provider writes are one slow step, and the reply streams only after both are journaled",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      h.client.answers.push(
        answered([message("Sending."), messageAbc("send_1")]),
        answered([messageAbc("send_2")]),
        answered([message("Both sent.")]),
      );
      const record = yield* Effect.promise(() => ask(h, "tell them to run the tests, twice"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.equal(h.performed.length, 2);
      assert.deepEqual(kinds(events.filter((event) => RELAY_KINDS.has(event.kind))), [
        BRAIN_RUN_EVENT.SLOW_STEP,
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
      ]);
      const [slow] = ofKind(events, BRAIN_RUN_EVENT.SLOW_STEP);
      assert.equal(slow?.step, SLOW_STEP_KIND.PROVIDER_WRITE);
      // Every sentence follows the settle, and the words said before the action
      // are part of the reply as much as the words after.
      assert.deepEqual(
        ofKind(events, BRAIN_RUN_EVENT.REPLY_SENTENCE).map((event) => event.sentence),
        ["Sending.", "Both sent."],
      );
      // Both calls are told started before settled, each under its own id, and the
      // finished message holds both settled.
      assert.deepEqual(
        ofKind(events, BRAIN_RUN_EVENT.TOOL_CALL_STARTED).map((event) => event.callId),
        ["send_1", "send_2"],
      );
      assert.deepEqual(
        ofKind(events, BRAIN_RUN_EVENT.TOOL_CALL_SETTLED).map((event) => event.settlement.state),
        [TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE, TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE],
      );
      const [, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      const sent = toolPartType(ACTION_TOOL.SEND_SESSION_MESSAGE);
      assert.deepEqual(
        answer?.message.parts.map((part) => part.type),
        [
          UI_PART_TYPE.STEP_START,
          UI_PART_TYPE.TEXT,
          sent,
          UI_PART_TYPE.STEP_START,
          sent,
          UI_PART_TYPE.STEP_START,
          UI_PART_TYPE.TEXT,
        ],
      );
      yield* Effect.promise(() => h.agent.stop());
    }),
);

/** A model that answers what it is given and then never answers again. */
class HangingClient extends FakeClient {
  hang = false;

  override respond(...args: Parameters<FakeClient["respond"]>): Promise<BrainClientAnswer> {
    if (this.hang) return new Promise(() => {});
    return super.respond(...args);
  }
}

it.effect(
  "a run with no slow step still settles its actions before its sentences, and a cancelled queued run ends with its end alone, as a turn of its own",
  () =>
    Effect.gen(function* () {
      const client = new HangingClient();
      const h = yield* effectHarness({ client });
      const events = listen(h);
      client.answers.push(answered([message("Hello there.")]));
      const first = yield* Effect.promise(() => ask(h, "hello"));
      assert.equal(first?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.deepEqual(kinds(events.filter((event) => RELAY_KINDS.has(event.kind))), [
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
      ]);
      events.length = 0;

      client.hang = true;
      const accepted = yield* Effect.promise(() => submit(h, "wait forever"));
      const runId = acceptedRunId(accepted);
      yield* Effect.promise(() => settle());
      yield* Effect.promise(() => h.agent.cancelAsk(runId));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(runId)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      // The run opened its turn before hanging, so the turn's start and its
      // opening words precede the record's end, and the turn's end is the last word.
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      assertOneTurn(events, runId);
      assert.deepEqual(bare(events[2]), {
        kind: BRAIN_RUN_EVENT.ENDED,
        runId,
        status: BRAIN_REQUEST_STATUS.CANCELLED,
      });
      const [turnEnded] = ofKind(events, BRAIN_RUN_EVENT.TURN_ENDED);
      assert.equal(turnEnded?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      assert.equal(turnEnded?.usage, undefined);
      assert.deepEqual(turnEnded?.responseIds, []);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "an ask cancelled while it waits behind another turn ends alone, at sequence one of a turn named by its own id",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      inner.answers.push(answered([message("")]));
      yield* advanceHarness(NOW + 3_000);
      const events = listen(h);
      // An observation turn takes no steered words, so the ask waits in the queue.
      const waiting = acceptedRunId(yield* Effect.promise(() => submit(h, "later")));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(waiting)?.status, BRAIN_REQUEST_STATUS.QUEUED);
      yield* Effect.promise(() => h.agent.cancelAsk(waiting));
      assert.deepEqual(events, [
        {
          kind: BRAIN_RUN_EVENT.ENDED,
          runId: waiting,
          status: BRAIN_REQUEST_STATUS.CANCELLED,
          conversationId: MAIN_SESSION_KEY,
          turnId: waiting,
          sequence: 1,
        },
      ]);
      gated.open();
      yield* Effect.promise(() => settle());
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "an observation turn tells its start, its words, its calls, its answer, and its end, and none of the relay's moments",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      yield* Effect.promise(() => h.agent.wake([edge(ABC)]));
      h.client.answers.push(answered([readAbc]), answered([message("")]));
      yield* advanceHarness(NOW + 3_000);
      assert.equal(h.wholeReads.length, 1);
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
        BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      assert.deepEqual(relayed(events), []);
      const turnId = events[0]?.turnId ?? "";
      assertOneTurn(events, turnId);
      // The turn is not a recorded run's, so its id is its own and no record ends it.
      assert.equal(h.agent.requests().length, 0);
      const [started] = ofKind(events, BRAIN_RUN_EVENT.TURN_STARTED);
      assert.equal(started?.origin, BRAIN_TURN_ORIGIN.OBSERVATION);
      assert.equal(started?.trigger, BRAIN_TURN_TRIGGER.WAKE);
      const [observation, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      assert.equal(observation?.message.role, MESSAGE_ROLE.USER);
      assert.deepEqual(observation?.message.metadata, {
        author: MESSAGE_AUTHOR.BRAIN,
        source: OBSERVATION_SOURCE.HOOK,
      });
      assert.equal(answer?.message.role, MESSAGE_ROLE.ASSISTANT);
      // An answer that said nothing adds no text part: the call is the whole of
      // its step, and the silent second inference leaves its boundary alone.
      assert.deepEqual(
        answer?.message.parts.map((part) => part.type),
        [
          UI_PART_TYPE.STEP_START,
          toolPartType(BRAIN_TOOL.READ_TRANSCRIPT),
          UI_PART_TYPE.STEP_START,
        ],
      );
      const messages = [observation?.message, answer?.message];
      assert.deepEqual(
        yield* Effect.promise(() => readStoredUIMessages(stored(messages), STORED_TOOLS)),
        {
          ok: true,
          value: messages,
        },
      );
      const [turnEnded] = ofKind(events, BRAIN_RUN_EVENT.TURN_ENDED);
      assert.equal(turnEnded?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a child's task turn is told as a child's, with the task as its words and its record's end in its sequence",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      h.client.answers.push(answered([message("Looked into it.")]));
      const run = yield* Effect.promise(() => h.agent.runChildTask("look into it", "child-run-1"));
      assert.ok(run);
      yield* Effect.promise(() => run.done);
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      assertOneTurn(events, run.runId);
      const [started] = ofKind(events, BRAIN_RUN_EVENT.TURN_STARTED);
      assert.equal(started?.origin, BRAIN_TURN_ORIGIN.CHILD);
      assert.equal(started?.trigger, BRAIN_TURN_TRIGGER.CHILD_TASK);
      const [task, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      assert.equal(task?.message.role, MESSAGE_ROLE.USER);
      assert.deepEqual(task?.message.metadata, {
        author: MESSAGE_AUTHOR.BRAIN,
        source: OBSERVATION_SOURCE.CHILD,
      });
      assert.deepEqual(answer?.message.metadata, BRAIN_AUTHORED);
      assert.deepEqual(answer?.message.parts, [
        STEP_START_PART,
        { type: UI_PART_TYPE.TEXT, text: "Looked into it.", state: UI_PART_STATE.DONE },
      ]);
      const [ended] = ofKind(events, BRAIN_RUN_EVENT.ENDED);
      assert.equal(ended?.runId, run.runId);
      assert.equal(ended?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect("a hold's release is told under its own origin", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    const events = listen(h);
    h.client.answers.push(answered([message("")]));
    h.agent.releaseHeld([{ briefing: "held", decidedAt: NOW }]);
    yield* Effect.promise(() => settle());
    while (h.agent.busy()) yield* Effect.promise(() => settle());
    const [started] = ofKind(events, BRAIN_RUN_EVENT.TURN_STARTED);
    assert.equal(started?.origin, BRAIN_TURN_ORIGIN.HOLD_RELEASE);
    assert.equal(started?.trigger, BRAIN_TURN_TRIGGER.HOLD_RELEASED);
    const [released] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
    assert.deepEqual(released?.message.metadata, {
      author: MESSAGE_AUTHOR.BRAIN,
      source: OBSERVATION_SOURCE.HOLD_RELEASE,
    });
    assert.deepEqual(kinds(events).at(-1), BRAIN_RUN_EVENT.TURN_ENDED);
    yield* Effect.promise(() => h.agent.stop());
  }),
);

it.effect(
  "a reasoning item is told with its summary and the opaque item, and the message keeps the summary beside the provider's replay data",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness();
      const events = listen(h);
      h.client.answers.push(answered([SUMMARIZED_REASONING, message("Only abc.")]));
      const record = yield* Effect.promise(() => ask(h, "who is waiting?"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.REASONING_COMPLETED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      const [reasoned] = ofKind(events, BRAIN_RUN_EVENT.REASONING_COMPLETED);
      assert.deepEqual(bare(reasoned), {
        kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
        summary: "Only abc is waiting.",
        item: SUMMARIZED_REASONING,
      });
      const [, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      assert.deepEqual(answer?.message.parts, [
        STEP_START_PART,
        {
          type: UI_PART_TYPE.REASONING,
          id: "rs_1",
          text: "Only abc is waiting.",
          state: UI_PART_STATE.DONE,
          providerMetadata: {
            [REASONING_PROVIDER_KEY]: { itemId: "rs_1", reasoningEncryptedContent: "opaque" },
          },
        },
        { type: UI_PART_TYPE.TEXT, text: "Only abc.", state: UI_PART_STATE.DONE },
      ]);
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a refused call settles as an error carrying the refusal's own reason, and the message's tool part says so",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness({
        actions: performerWith(async () => refusedActionOutput("not now")).actions,
      });
      const events = listen(h);
      h.client.answers.push(answered([messageAbc("send_x")]), answered([message("It refused.")]));
      const record = yield* Effect.promise(() => ask(h, "tell abc to run the tests"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      const [settled] = ofKind(events, BRAIN_RUN_EVENT.TOOL_CALL_SETTLED);
      assert.deepEqual(settled?.settlement, {
        state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
        output: { status: ACTION_OUTPUT_STATUS.REFUSED, reason: "not now" },
        errorText: "not now",
        status: ACTION_OUTPUT_STATUS.REFUSED,
      });
      const [, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      assert.deepEqual(answer?.message.parts[0], STEP_START_PART);
      assert.deepEqual(answer?.message.parts[1], {
        type: toolPartType(ACTION_TOOL.SEND_SESSION_MESSAGE),
        toolCallId: "send_x",
        state: TOOL_PART_STATE.OUTPUT_ERROR,
        input: {
          provider_id: ABC.providerId,
          provider_session_id: ABC.providerSessionId,
          text: "run the tests",
        },
        errorText: "not now",
      });
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "an action dispatched whose effect is uncertain settles as an answer carrying the envelope, never as an error, and the message's tool part keeps the envelope",
  () =>
    Effect.gen(function* () {
      const h = yield* effectHarness({
        actions: performerWith(async () => unknownActionOutput("the node closed first")).actions,
      });
      const events = listen(h);
      h.client.answers.push(answered([messageAbc("send_u")]), answered([message("Unsure.")]));
      const record = yield* Effect.promise(() => ask(h, "tell abc to run the tests"));
      assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
      const [settled] = ofKind(events, BRAIN_RUN_EVENT.TOOL_CALL_SETTLED);
      assert.deepEqual(settled?.settlement, {
        state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
        output: { status: ACTION_OUTPUT_STATUS.UNKNOWN, reason: "the node closed first" },
        status: ACTION_OUTPUT_STATUS.UNKNOWN,
      });
      const [, answer] = ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
      assert.deepEqual(answer?.message.parts[0], STEP_START_PART);
      assert.deepEqual(answer?.message.parts[1], {
        type: toolPartType(ACTION_TOOL.SEND_SESSION_MESSAGE),
        toolCallId: "send_u",
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        input: {
          provider_id: ABC.providerId,
          provider_session_id: ABC.providerSessionId,
          text: "run the tests",
        },
        output: { status: ACTION_OUTPUT_STATUS.UNKNOWN, reason: "the node closed first" },
      });
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "an ask steered into a running turn is a message of that turn, and its record's end is numbered in that turn before the turn's own end",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      const events = listen(h);
      inner.answers.push(
        answered([message("First alone.")]),
        answered([message("Both answered.")]),
      );
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.RUNNING);
      gated.open();
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(second, 1)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      assertOneTurn(events, first);
      // The steered words are told as they are taken, before the inference that
      // was running answers, so the two steps' boundaries follow both asks.
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      assert.deepEqual(
        ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED).map((event) => event.message.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(
        ofKind(events, BRAIN_RUN_EVENT.ENDED).map((event) => event.runId),
        [second, first],
      );
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect(
  "a rider withdrawn mid-turn ends where it was withdrawn, numbered in the turn it left, and the turn still ends last",
  () =>
    Effect.gen(function* () {
      const inner = new FakeClient();
      const gated = gatedClient(inner);
      const h = yield* effectHarness({ client: gated.client });
      const events = listen(h);
      inner.answers.push(answered([message("Alone again.")]));
      const first = acceptedRunId(yield* Effect.promise(() => submit(h, "first?")));
      yield* Effect.promise(() => settle());
      const second = acceptedRunId(yield* Effect.promise(() => submit(h, "second?")));
      yield* Effect.promise(() => settle());
      yield* Effect.promise(() => h.agent.cancelAsk(second));
      assert.equal(h.agent.request(second)?.status, BRAIN_REQUEST_STATUS.CANCELLED);
      gated.open();
      yield* Effect.promise(() => settle());
      assert.equal(
        (yield* Effect.promise(() => h.agent.waitAsk(first, 1)))?.status,
        BRAIN_REQUEST_STATUS.SUCCEEDED,
      );
      assertOneTurn(events, first);
      assert.deepEqual(kinds(events), [
        BRAIN_RUN_EVENT.TURN_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.STEP_STARTED,
        BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        BRAIN_RUN_EVENT.REPLY_SENTENCE,
        BRAIN_RUN_EVENT.ENDED,
        BRAIN_RUN_EVENT.TURN_ENDED,
      ]);
      assert.deepEqual(
        ofKind(events, BRAIN_RUN_EVENT.ENDED).map((event) => [event.runId, event.status]),
        [
          [second, BRAIN_REQUEST_STATUS.CANCELLED],
          [first, BRAIN_REQUEST_STATUS.SUCCEEDED],
        ],
      );
      yield* Effect.promise(() => h.agent.stop());
    }),
);

it.effect("every ask's turn is prepared with the spoken origin and told under it", () =>
  Effect.gen(function* () {
    const prepared: BrainTurnDescription[] = [];
    const h = yield* effectHarness({
      prepareTurn: (turn) => {
        prepared.push(turn);
        return PLAIN_PREPARATION(turn);
      },
    });
    const events = listen(h);
    h.client.answers.push(answered([message("Yes.")]), answered([message("No.")]));
    const spoken = yield* Effect.promise(() =>
      h.agent.submitAsk({
        submissionId: "spoken-1",
        question: "is it done?",
        origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
      }),
    );
    yield* Effect.promise(() => h.agent.waitAsk(acceptedRunId(spoken), 60_000));
    assert.equal(
      (yield* Effect.promise(() => ask(h, "and now?")))?.status,
      BRAIN_REQUEST_STATUS.SUCCEEDED,
    );
    // The turn each ask opens, in order; the maintenance queued behind either
    // one runs on its own schedule and is no part of what an ask's turn is
    // prepared with.
    assert.deepEqual(
      prepared.filter((turn) => turn.kind === BRAIN_TURN_KIND.TURN),
      [
        {
          kind: BRAIN_TURN_KIND.TURN,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          askOrigin: BRAIN_REQUEST_ORIGIN.SPOKEN,
        },
        {
          kind: BRAIN_TURN_KIND.TURN,
          trigger: BRAIN_TURN_TRIGGER.ASK,
          askOrigin: BRAIN_REQUEST_ORIGIN.SPOKEN,
        },
      ],
    );
    assert.deepEqual(
      ofKind(events, BRAIN_RUN_EVENT.TURN_STARTED).map((event) => event.origin),
      [BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_ORIGIN.SPOKEN],
    );
    assert.deepEqual(
      ofKind(events, BRAIN_RUN_EVENT.MESSAGE_COMPLETED)
        .filter((event) => event.message.role === MESSAGE_ROLE.USER)
        .map((event) => event.message.metadata),
      [SPOKEN_ASK, SPOKEN_ASK],
    );
    yield* Effect.promise(() => h.agent.stop());
  }),
);

it.effect("a listener that throws ends no run", () =>
  Effect.gen(function* () {
    const h = yield* effectHarness();
    h.agent.onRunEvent(() => {
      throw new Error("listener");
    });
    h.client.answers.push(answered([message("Fine.")]));
    const record = yield* Effect.promise(() => ask(h, "hello"));
    assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
    assert.equal(record?.text, "Fine.");
    yield* Effect.promise(() => h.agent.stop());
  }),
);

test("every trigger has one origin: an ask is the developer's spoken one, the rest by the trigger alone", () => {
  assert.deepEqual(
    [
      turnOriginOf(BRAIN_TURN_TRIGGER.ASK),
      turnOriginOf(BRAIN_TURN_TRIGGER.CHILD_TASK),
      turnOriginOf(BRAIN_TURN_TRIGGER.CHILD_COMPLETION),
      turnOriginOf(BRAIN_TURN_TRIGGER.HOLD_RELEASED),
      turnOriginOf(BRAIN_TURN_TRIGGER.WAKE),
      turnOriginOf(BRAIN_TURN_TRIGGER.ROSTER),
    ],
    [
      BRAIN_TURN_ORIGIN.SPOKEN,
      BRAIN_TURN_ORIGIN.CHILD,
      BRAIN_TURN_ORIGIN.CHILD_COMPLETION,
      BRAIN_TURN_ORIGIN.HOLD_RELEASE,
      BRAIN_TURN_ORIGIN.OBSERVATION,
      BRAIN_TURN_ORIGIN.OBSERVATION,
    ],
  );
});

test("a user row's metadata follows the trigger: a spoken ask on the voice channel, an ask with no origin on the hosted host's typed one, everything the brain writes for itself by source", () => {
  assert.deepEqual(
    [
      userMetadataOf(BRAIN_TURN_TRIGGER.ASK, BRAIN_REQUEST_ORIGIN.SPOKEN),
      userMetadataOf(BRAIN_TURN_TRIGGER.ASK, undefined),
      userMetadataOf(BRAIN_TURN_TRIGGER.WAKE, undefined),
      userMetadataOf(BRAIN_TURN_TRIGGER.ROSTER, undefined),
      userMetadataOf(BRAIN_TURN_TRIGGER.HOLD_RELEASED, undefined),
      userMetadataOf(BRAIN_TURN_TRIGGER.CHILD_TASK, BRAIN_REQUEST_ORIGIN.CHILD),
      userMetadataOf(BRAIN_TURN_TRIGGER.CHILD_COMPLETION, undefined),
    ],
    [
      { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.VOICE },
      { author: MESSAGE_AUTHOR.DEVELOPER, channel: MESSAGE_CHANNEL.TYPED },
      { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOOK },
      { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.ROSTER_LOOK },
      { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.HOLD_RELEASE },
      { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.CHILD },
      { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.CHILD_COMPLETION },
    ],
  );
  assert.deepEqual(Object.values(HOSTED_WORDS_METADATA), [
    { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.RECALLED_NOTES },
    { author: MESSAGE_AUTHOR.BRAIN, source: OBSERVATION_SOURCE.ACTIVITY_NOTICES },
  ]);
});

test("a tool's result settles as an answer unless its status is a refusal, an unknown outcome among the answers, and an error carries the output's reason or the text itself", () => {
  const accepted = JSON.stringify({ status: ACTION_RESULT_STATUS.ACCEPTED, sent: true });
  assert.deepEqual(toolCallSettlementOf(accepted, ACTION_RESULT_STATUS.ACCEPTED), {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
    output: { status: ACTION_RESULT_STATUS.ACCEPTED, sent: true },
    status: ACTION_RESULT_STATUS.ACCEPTED,
  });
  assert.deepEqual(toolCallSettlementOf(JSON.stringify({ sessions: [] }), undefined), {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
    output: { sessions: [] },
  });
  const rejected = JSON.stringify({ status: ACTION_RESULT_STATUS.REJECTED, reason: "not here" });
  assert.deepEqual(toolCallSettlementOf(rejected, ACTION_RESULT_STATUS.REJECTED), {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
    output: { status: ACTION_RESULT_STATUS.REJECTED, reason: "not here" },
    errorText: "not here",
    status: ACTION_RESULT_STATUS.REJECTED,
  });
  const uncertain = JSON.stringify(unknownActionOutput("the node closed first"));
  assert.deepEqual(toolCallSettlementOf(uncertain, ACTION_OUTPUT_STATUS.UNKNOWN), {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
    output: { status: ACTION_OUTPUT_STATUS.UNKNOWN, reason: "the node closed first" },
    status: ACTION_OUTPUT_STATUS.UNKNOWN,
  });
  assert.equal(isToolRefusalStatus(TOOL_RESULT_STATUS.UNKNOWN), false);
  assert.equal(isToolRefusalStatus(ACTION_OUTPUT_STATUS.UNKNOWN), false);
  assert.equal(isToolRefusalStatus(ACTION_RESULT_STATUS.ACCEPTED), false);
  const refused = JSON.stringify(refusedActionOutput("not here either"));
  assert.equal(
    toolCallSettlementOf(refused, ACTION_OUTPUT_STATUS.REFUSED).state,
    TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
  );
  assert.deepEqual(toolCallSettlementOf("not json", ACTION_RESULT_STATUS.UNSUPPORTED), {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
    output: "not json",
    errorText: "not json",
    status: ACTION_RESULT_STATUS.UNSUPPORTED,
  });
  assert.deepEqual(valueFromJsonText('{"text":"hi"}'), { text: "hi" });
  assert.equal(valueFromJsonText("{broken"), "{broken");
});

test("a turn's teller numbers its events from one, knows once its start was told, and registers the runs it adopts", () => {
  const fired: BrainRunEvent[] = [];
  const registry = new Map<string, TurnEvents>();
  let minted = 0;
  const events = new TurnEvents({
    conversationId: MAIN_SESSION_KEY,
    turnId: "turn-1",
    fire: (event) => fired.push(event),
    createMessageId: () => `m-${++minted}`,
    now: () => NOW,
    registry,
  });
  assert.equal(events.opened, false);
  events.actionsSettled("turn-1");
  assert.equal(events.opened, false);
  events.started(BRAIN_TURN_ORIGIN.SPOKEN, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(events.opened, true);
  events.words("hello", SPOKEN_ASK);
  events.adopt("rider-1");
  assert.equal(registry.get("rider-1"), events);
  assert.deepEqual(
    fired.map((event) => [event.kind, event.conversationId, event.turnId, event.sequence]),
    [
      [BRAIN_RUN_EVENT.ACTIONS_SETTLED, MAIN_SESSION_KEY, "turn-1", 1],
      [BRAIN_RUN_EVENT.TURN_STARTED, MAIN_SESSION_KEY, "turn-1", 2],
      [BRAIN_RUN_EVENT.MESSAGE_COMPLETED, MAIN_SESSION_KEY, "turn-1", 3],
    ],
  );
  const [, , words] = fired;
  assert.ok(words?.kind === BRAIN_RUN_EVENT.MESSAGE_COMPLETED);
  assert.equal(words.message.id, "m-1");
  assert.equal(words.message.role, MESSAGE_ROLE.USER);
  assert.deepEqual(words.message.metadata, SPOKEN_ASK);
});

test("the assistant message gathers reasoning, text, and tool parts in order, settling each call in place and adding no part for silence", () => {
  const builder = new AssistantMessageBuilder();
  builder.reasoning({ itemId: "rs_1", summary: "Thinking.", item: { type: "reasoning" } });
  builder.text("");
  builder.toolCall({ callId: "c_1", name: "list_sessions", argumentsJson: "{}" }, {});
  builder.toolCall({ callId: "c_2", name: "open_session", argumentsJson: "{}" }, { id: "abc" });
  builder.toolResult("c_1", {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE,
    output: { sessions: [] },
  });
  builder.toolResult("c_2", {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
    output: { status: ACTION_RESULT_STATUS.REJECTED },
    errorText: "no",
    status: ACTION_RESULT_STATUS.REJECTED,
  });
  builder.toolResult("c_3", { state: TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE, output: 1 });
  builder.text("Done.");
  assert.deepEqual(builder.finish("m_1"), {
    id: "m_1",
    role: MESSAGE_ROLE.ASSISTANT,
    metadata: BRAIN_AUTHORED,
    parts: [
      {
        type: UI_PART_TYPE.REASONING,
        id: "rs_1",
        text: "Thinking.",
        state: UI_PART_STATE.DONE,
        providerMetadata: { [REASONING_PROVIDER_KEY]: { itemId: "rs_1" } },
      },
      {
        type: toolPartType("list_sessions"),
        toolCallId: "c_1",
        state: TOOL_PART_STATE.OUTPUT_AVAILABLE,
        input: {},
        output: { sessions: [] },
      },
      {
        type: toolPartType("open_session"),
        toolCallId: "c_2",
        state: TOOL_PART_STATE.OUTPUT_ERROR,
        input: { id: "abc" },
        errorText: "no",
      },
      { type: UI_PART_TYPE.TEXT, text: "Done.", state: UI_PART_STATE.DONE },
    ],
  });
});

test("the slow steps are the whole-transcript read and the performer's writes, only when the policy offers them", () => {
  const full = resolveTurnToolPolicy(brainToolCatalog(), {}, BRAIN_TURN_TRIGGER.ASK);
  assert.equal(slowStepOf(full, BRAIN_TOOL.READ_TRANSCRIPT), SLOW_STEP_KIND.TRANSCRIPT_READ);
  assert.equal(slowStepOf(full, ACTION_TOOL.SEND_SESSION_MESSAGE), SLOW_STEP_KIND.PROVIDER_WRITE);
  assert.equal(slowStepOf(full, BRAIN_TOOL.LIST_SESSIONS), undefined);
  assert.equal(slowStepOf(full, BRAIN_TOOL.WRITE_WORKSPACE_FILE), undefined);
  assert.equal(slowStepOf(full, "no_such_tool"), undefined);
  const noActions = resolveTurnToolPolicy(
    brainToolCatalog(),
    { agent: { deny: [ACTION_TOOL.SEND_SESSION_MESSAGE] } },
    BRAIN_TURN_TRIGGER.ASK,
  );
  assert.equal(slowStepOf(noActions, ACTION_TOOL.SEND_SESSION_MESSAGE), undefined);
});

test("a reply splits into its sentences at sentence ends and line breaks, trimmed, none empty", () => {
  assert.deepEqual(replySentences("One. Two!  Three?\nFour…\n\n  Five (done.) Six"), [
    "One.",
    "Two!",
    "Three?",
    "Four…",
    "Five (done.)",
    "Six",
  ]);
  assert.deepEqual(replySentences("Version 2.5 is out. e.g. now"), [
    "Version 2.5 is out.",
    "e.g.",
    "now",
  ]);
  assert.deepEqual(replySentences(""), []);
  assert.deepEqual(replySentences("   \n  "), []);
});
