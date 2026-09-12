import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  type ContextEngine,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
  RUN_END_REASON,
  RUNTIME_EVENT,
  type RuntimeEvent,
  type RuntimeRunEffect,
  type RuntimeRunEnd,
  type RuntimeRunRequestEffect,
  type ToolExecutionContext,
  type ToolExecutor,
  type ToolInvocation,
} from "@sidecar/runtime/vocabulary";
import type { WireRecord } from "@sidecar/wire";
import { Effect, Either, Fiber } from "effect";
import { test } from "vitest";
import { COMPACTION_POLICY } from "./compaction.js";
import { ResponsesContextEngine } from "./context-engine.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import { ToolLoopAgentRuntime } from "./runtime.js";

const TOOL_LOOP_IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };

function answered(
  overrides: Partial<Extract<ModelResponse, { outcome: "answered" }>> = {},
): ModelResponse {
  return {
    outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
    items: [],
    text: "",
    toolCalls: [],
    ...overrides,
  };
}

function toolCall(callId: string, name: string, args: WireRecord = {}): ToolInvocation {
  return { callId, name, argumentsJson: JSON.stringify(args) };
}

class FakeModel implements ModelAdapter {
  readonly model = "fake";
  readonly requests: { items: readonly WireRecord[]; options: ModelRequestOptions }[] = [];
  readonly answers: ModelResponse[] = [];
  fallback: ModelResponse = answered({ text: "done" });
  held: ((response: ModelResponse) => void) | undefined;
  hold = false;

  async capabilities() {
    return {
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        model: "fake",
        checkpoint: {
          runtime: TOOL_LOOP_RUNTIME.ID,
          runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
          format: RESPONSES_ITEM_FORMAT.format,
          formatVersion: RESPONSES_ITEM_FORMAT.version,
        },
        countsInputTokens: false,
        maximumOutputTokens: 16_000,
      },
    } as const;
  }

  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push({ items: [...items], options });
    if (this.hold) {
      return new Promise((resolve) => {
        this.held = resolve;
      });
    }
    return Promise.resolve(this.answers.shift() ?? this.fallback);
  }

  countInputTokens(): never {
    throw new Error("not counted here");
  }

  quietUntil(): number | undefined {
    return undefined;
  }
}

function toolLoop(model: FakeModel, loopGuard?: { enabled: boolean }): ToolLoopAgentRuntime {
  return new ToolLoopAgentRuntime({
    model,
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: () => new ResponsesContextEngine(TOOL_LOOP_IDENTITY),
    ...(loopGuard ? { loopGuard } : undefined),
  });
}

/** One execution as this suite still asks for it, before it becomes the loop's own effects. */
type RuntimeRunRequest = Omit<RuntimeRunRequestEffect, "onEvent"> & {
  onEvent: (event: RuntimeEvent) => void | Promise<void>;
};

/** A run under way, as this suite awaits one. */
interface RuntimeRun extends Omit<RuntimeRunEffect, "done"> {
  readonly done: Promise<RuntimeRunEnd>;
}

/**
 * The loop's effects as the promises most of this suite reads them in. The
 * seam itself answers effects throughout, and the tests that turn on a
 * fiber's own interruption run them as fibers; the rest read a run's end,
 * an open, or a fold as the one value it is, which is what this carries.
 */
function runtime(model: FakeModel, loopGuard?: { enabled: boolean }) {
  const inner = toolLoop(model, loopGuard);
  const started = (run: RuntimeRunEffect): RuntimeRun => ({
    runId: run.runId,
    steer: (input) => run.steer(input),
    cancel: (reason) => run.cancel(reason),
    done: Effect.runPromise(run.done),
  });
  const listener =
    (onEvent: RuntimeRunRequest["onEvent"]): RuntimeRunRequestEffect["onEvent"] =>
    (event) =>
      Effect.promise(async () => {
        await onEvent(event);
      });
  return {
    descriptor: inner.descriptor,
    capabilities: () => Effect.runPromise(inner.capabilities()),
    compact: (context: ContextEngine, options: { prompt: string; signal: AbortSignal }) =>
      Effect.runPromise(inner.compact(context, options)),
    openContext: (...args: Parameters<typeof inner.openContext>) =>
      Effect.runPromise(inner.openContext(...args)),
    start: (request: RuntimeRunRequest) =>
      started(inner.start({ ...request, onEvent: listener(request.onEvent) })),
    resume: (
      checkpoint: Parameters<typeof inner.resume>[0],
      request: Omit<RuntimeRunRequest, "context">,
      lostResult: Parameters<typeof inner.resume>[2],
    ): Promise<RuntimeRun | { readonly refused: string }> =>
      Effect.runPromise(
        Effect.either(
          inner.resume(checkpoint, { ...request, onEvent: listener(request.onEvent) }, lostResult),
        ),
      ).then((resumed) =>
        Either.isLeft(resumed) ? { refused: resumed.left.reason } : started(resumed.right),
      ),
  };
}

interface Harness {
  model: FakeModel;
  events: RuntimeEvent[];
  executed: ToolInvocation[];
  context: ContextEngine;
  request: (overrides?: Partial<RuntimeRunRequest>) => RuntimeRunRequest;
  abort: AbortController;
}

function harness(tools?: Partial<ToolExecutor>): Harness {
  const model = new FakeModel();
  const events: RuntimeEvent[] = [];
  const executed: ToolInvocation[] = [];
  const context = new ResponsesContextEngine(TOOL_LOOP_IDENTITY);
  context.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  const abort = new AbortController();
  const executor: ToolExecutor = {
    execute: (invocation) =>
      Effect.sync(() => {
        executed.push(invocation);
        return { outputJson: JSON.stringify({ status: "accepted", call: invocation.callId }) };
      }),
    ...tools,
  };
  return {
    model,
    events,
    executed,
    context,
    abort,
    request: (overrides = {}) => ({
      runId: "run-1",
      context,
      tools: executor,
      toolSchemas: [{ name: "act", description: "an action", parameters: { type: "object" } }],
      prompt: "instructions",
      input: [{ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "[developer ask] hello" }],
      ephemeral: () => ["[standing context] roster"],
      maximumOutputTokens: 16_000,
      signal: abort.signal,
      onEvent: (event) => {
        events.push(event);
      },
      ...overrides,
    }),
  };
}

function kinds(events: readonly RuntimeEvent[]): string[] {
  return events.map((event) => event.kind);
}

test("a run with no tool calls completes with the model's text, having shown the ephemeral text last and kept none of it", async () => {
  const h = harness();
  h.model.answers.push(answered({ text: "hi there", usage: { inputTokens: 12 } }));
  const end = await runtime(h.model).start(h.request()).done;
  assert.deepEqual(end, { reason: RUN_END_REASON.COMPLETED, text: "hi there" });
  assert.deepEqual(kinds(h.events), [
    RUNTIME_EVENT.ANSWERED,
    RUNTIME_EVENT.USAGE,
    RUNTIME_EVENT.TEXT,
    RUNTIME_EVENT.ENDED,
  ]);
  const shown = h.model.requests[0]?.items ?? [];
  assert.equal(shown.length, 2);
  assert.equal(h.context.checkpoint().items.length, 1);
  assert.equal(h.model.requests[0]?.options.prompt, "instructions");
  assert.deepEqual(
    h.model.requests[0]?.options.tools.map((tool) => tool.name),
    ["act"],
  );
});

test("tool calls run one at a time in order, each result is ingested and awaited before the next inference, and there is no iteration cap", async () => {
  const h = harness();
  const rounds = 12;
  for (let index = 0; index < rounds; index += 1) {
    h.model.answers.push(
      answered({
        items: [
          {
            type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
            call_id: `c${index}a`,
            name: "act",
            arguments: "{}",
          },
          {
            type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
            call_id: `c${index}b`,
            name: "act",
            arguments: '{"x":1}',
          },
        ],
        toolCalls: [toolCall(`c${index}a`, "act"), toolCall(`c${index}b`, "act", { x: 1 })],
      }),
    );
  }
  h.model.answers.push(answered({ text: "finished" }));
  let awaitedResults = 0;
  const end = await runtime(h.model).start(
    h.request({
      onEvent: async (event) => {
        h.events.push(event);
        if (event.kind === RUNTIME_EVENT.TOOL_RESULT) {
          await new Promise((resolve) => setImmediate(resolve));
          awaitedResults += 1;
        }
      },
    }),
  ).done;
  assert.deepEqual(end, { reason: RUN_END_REASON.COMPLETED, text: "finished" });
  assert.equal(h.executed.length, rounds * 2);
  assert.equal(awaitedResults, rounds * 2);
  assert.equal(h.model.requests.length, rounds + 1);
  // Every call in the context has its output, paired in order.
  const items = h.context.checkpoint().items;
  const calls = items.filter((item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL);
  const outputs = items.filter(
    (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  );
  assert.equal(calls.length, rounds * 2);
  assert.equal(outputs.length, rounds * 2);
  assert.equal(
    h.events.filter((event) => event.kind === RUNTIME_EVENT.TOOL_CALL).length,
    rounds * 2,
  );
  assert.equal(
    h.events.filter(
      (event) => event.kind === RUNTIME_EVENT.TOOL_RESULT && event.result.status === "accepted",
    ).length,
    rounds * 2,
  );
});

test("a throttle, a provider failure, and an answer that stopped short each end the run in their own words", async () => {
  const throttled = harness();
  throttled.model.answers.push({ outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until: 5_000 });
  assert.deepEqual(await runtime(throttled.model).start(throttled.request()).done, {
    reason: RUN_END_REASON.THROTTLED,
    until: 5_000,
  });
  assert.deepEqual(kinds(throttled.events), [RUNTIME_EVENT.THROTTLED, RUNTIME_EVENT.ENDED]);
  assert.ok(!throttled.events.some((event) => event.kind === RUNTIME_EVENT.ANSWERED));

  const failed = harness();
  failed.model.answers.push({
    outcome: MODEL_RESPONSE_OUTCOME.FAILED,
    failure: MODEL_FAILURE.UPSTREAM,
    reason: "status 500",
  });
  assert.deepEqual(await runtime(failed.model).start(failed.request()).done, {
    reason: RUN_END_REASON.PROVIDER_FAILURE,
    failure: MODEL_FAILURE.UPSTREAM,
    detail: "status 500",
  });

  const incomplete = harness();
  incomplete.model.answers.push(
    answered({ text: "", incomplete: { status: "incomplete", reason: "max_output_tokens" } }),
  );
  assert.deepEqual(await runtime(incomplete.model).start(incomplete.request()).done, {
    reason: RUN_END_REASON.INCOMPLETE,
    detail: "incomplete: max_output_tokens",
  });
  assert.ok(incomplete.events.some((event) => event.kind === RUNTIME_EVENT.INCOMPLETE));
});

test("a cancel while the model is thinking ends the run cancelled; a deadline says so", async () => {
  const cancelled = harness();
  cancelled.model.hold = true;
  const run = runtime(cancelled.model).start(cancelled.request());
  await new Promise((resolve) => setImmediate(resolve));
  run.cancel();
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.CANCELLED });
  assert.deepEqual(kinds(cancelled.events), [RUNTIME_EVENT.CANCELLED, RUNTIME_EVENT.ENDED]);
  cancelled.model.held?.(answered({ text: "late" }));

  const deadline = harness();
  deadline.model.hold = true;
  const timed = runtime(deadline.model).start(deadline.request());
  await new Promise((resolve) => setImmediate(resolve));
  timed.cancel({ deadline: true });
  assert.deepEqual(await timed.done, { reason: RUN_END_REASON.DEADLINE });

  const host = harness();
  host.model.hold = true;
  const revoked = runtime(host.model).start(host.request());
  await new Promise((resolve) => setImmediate(resolve));
  host.abort.abort();
  assert.deepEqual(await revoked.done, { reason: RUN_END_REASON.CANCELLED });
});

test("a cancel between two calls still reaches the executor for the second, which pairs it, and the run ends cancelled", async () => {
  const h = harness();
  let run: RuntimeRun | undefined;
  const executor: ToolExecutor = {
    execute: (invocation, context) =>
      Effect.sync(() => {
        h.executed.push(invocation);
        const status = context.isRevoked() ? "rejected" : "accepted";
        if (invocation.callId === "c1") run?.cancel();
        return { outputJson: JSON.stringify({ status }) };
      }),
  };
  h.model.answers.push(
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c2",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act"), toolCall("c2", "act")],
    }),
  );
  run = runtime(h.model).start(h.request({ tools: executor }));
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.CANCELLED });
  assert.deepEqual(
    h.executed.map((call) => call.callId),
    ["c1", "c2"],
  );
  const results = h.events.filter((event) => event.kind === RUNTIME_EVENT.TOOL_RESULT);
  assert.deepEqual(
    results.map((event) => (event.kind === RUNTIME_EVENT.TOOL_RESULT ? event.result.status : "")),
    ["accepted", "rejected"],
  );
  assert.equal(h.model.requests.length, 1);
});

test("steered words are read at the next safe boundary: after the tool that was running, before the next inference", async () => {
  const h = harness();
  let run: RuntimeRun | undefined;
  const steering: ToolExecutor = {
    execute: (invocation) =>
      Effect.sync(() => {
        assert.equal(run?.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "also this" }), true);
        return { outputJson: JSON.stringify({ status: "accepted", call: invocation.callId }) };
      }),
  };
  h.model.answers.push(
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act")],
    }),
  );
  run = runtime(h.model).start(h.request({ tools: steering }));
  await run.done;
  assert.equal(h.model.requests.length, 2);
  const second = h.model.requests[1]?.items ?? [];
  const steeredIndex = second.findIndex((item) => JSON.stringify(item).includes("also this"));
  const outputIndex = second.findIndex(
    (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  );
  assert.ok(steeredIndex > outputIndex);
  assert.equal(steeredIndex, second.length - 2);
});

test("an executor that throws leaves an unknown answer paired to the call rather than a dangling call", async () => {
  const h = harness({
    execute: () =>
      Effect.sync(() => {
        throw new Error("boom");
      }),
  });
  h.model.answers.push(
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act")],
    }),
  );
  await runtime(h.model).start(h.request()).done;
});

test("with the guard enabled, a critical verdict pairs every remaining call and ends the run as the guard's", async () => {
  const h = harness();
  const repeated = () =>
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c", "act")],
    });
  for (let index = 0; index < 40; index += 1) h.model.answers.push(repeated());
  const executor: ToolExecutor = {
    execute: () => Effect.succeed({ outputJson: '{"status":"running"}' }),
  };
  const end = await runtime(h.model, { enabled: true }).start(h.request({ tools: executor })).done;
  assert.equal(end.reason, RUN_END_REASON.LOOP_GUARD);
  assert.ok(h.events.some((event) => event.kind === RUNTIME_EVENT.LOOP_GUARD));
  const items = h.context.checkpoint().items;
  const calls = items.filter(
    (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
  ).length;
  const outputs = items.filter(
    (item) => item.type === RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  ).length;
  assert.equal(calls, outputs);
  assert.ok(h.model.requests.length < 40);
});

test("resume loads a compatible checkpoint and refuses a foreign one without touching it", async () => {
  const h = harness();
  const items = [{ type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE, role: "user", content: "earlier" }];
  const r = runtime(h.model);
  const refused = await r.resume(
    { format: { ...r.descriptor.checkpoint, runtime: "other" }, items },
    h.request(),
    UNKNOWN_ACTION_RESULT,
  );
  assert.ok("refused" in refused);
  h.model.answers.push(answered({ text: "resumed" }));
  const resumed = await r.resume(
    { format: r.descriptor.checkpoint, items },
    h.request(),
    UNKNOWN_ACTION_RESULT,
  );
  assert.ok(!("refused" in resumed));
  if (!("refused" in resumed)) {
    assert.deepEqual(await resumed.done, { reason: RUN_END_REASON.COMPLETED, text: "resumed" });
    assert.deepEqual(h.model.requests[0]?.items[0], items[0]);
  }
});

test("every context handed to an executor is revoked once the run ends, on completion, on a thrown listener, and on cancel, and late words are refused", async () => {
  const completed = harness();
  const contexts: ToolExecutionContext[] = [];
  const capturing: ToolExecutor = {
    execute: (invocation, context) =>
      Effect.sync(() => {
        contexts.push(context);
        return { outputJson: JSON.stringify({ status: "accepted", call: invocation.callId }) };
      }),
  };
  const oneCall = () =>
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act")],
    });
  completed.model.answers.push(oneCall(), answered({ text: "done" }));
  const run = runtime(completed.model).start(completed.request({ tools: capturing }));
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.COMPLETED, text: "done" });
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.isRevoked(), true);
  assert.equal(run.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "too late" }), false);

  const thrown = harness();
  thrown.model.answers.push(oneCall(), answered({ text: "never" }));
  const failing = runtime(thrown.model).start(
    thrown.request({
      tools: capturing,
      onEvent: (event) => {
        if (event.kind === RUNTIME_EVENT.TOOL_RESULT) throw new Error("listener broke");
      },
    }),
  );
  await assert.rejects(failing.done, /listener broke/u);
  assert.equal(contexts[1]?.isRevoked(), true);
  assert.equal(failing.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "late" }), false);

  const cancelled = harness();
  cancelled.model.answers.push(oneCall());
  cancelled.model.fallback = answered({ text: "still" });
  const stopping = runtime(cancelled.model).start(cancelled.request({ tools: capturing }));
  await new Promise((resolve) => setImmediate(resolve));
  stopping.cancel();
  await stopping.done;
  assert.equal(contexts[2]?.isRevoked(), true);
});

test("an engine whose lifecycle hooks are asynchronous is awaited at every step", async () => {
  const h = harness();
  const log: string[] = [];
  const inner = new ResponsesContextEngine(TOOL_LOOP_IDENTITY);
  const later = <Value>(value: Value): Promise<Value> =>
    new Promise((resolve) => setImmediate(() => resolve(value)));
  const asyncEngine: ContextEngine = {
    checkpointFormat: inner.checkpointFormat,
    bootstrap: async (checkpoint, lost) => later(inner.bootstrap(checkpoint, lost)),
    ingest: async (input) => {
      log.push(`ingest:${input.kind}`);
      await later(undefined);
      inner.ingest(input);
    },
    assemble: async (assembly) => {
      log.push("assemble");
      return later(inner.assemble(assembly));
    },
    adopt: async (items) => later(inner.adopt(items)),
    afterTurn: async () => later(undefined),
    mark: () => inner.mark(),
    rollback: (mark) => inner.rollback(mark),
    checkpoint: () => inner.checkpoint(),
    dispose: async () => later(inner.dispose()),
  };
  h.model.answers.push(
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act")],
    }),
    answered({ text: "ok" }),
  );
  const r = runtime(h.model);
  const opened = await r.openContext(undefined, UNKNOWN_ACTION_RESULT);
  assert.equal(opened.bootstrap.loaded, true);
  const end = await r.start(h.request({ context: asyncEngine })).done;
  assert.deepEqual(end, { reason: RUN_END_REASON.COMPLETED, text: "ok" });
  assert.deepEqual(log, [
    "ingest:user_text",
    "assemble",
    "ingest:model_output",
    "ingest:tool_result",
    "assemble",
    "ingest:model_output",
  ]);
  const inherited = [
    { type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE, role: "user", content: "a requester's ask" },
  ];
  await asyncEngine.adopt(inherited);
  assert.deepEqual(asyncEngine.checkpoint().items, inherited);
});

test("an answer that stopped short while still carrying words ends completed with the shortfall beside the words, and every answer's text is reported, the empty one included", async () => {
  const partial = harness();
  partial.model.answers.push(
    answered({
      text: "Half an answer",
      incomplete: { status: "incomplete", reason: "max_output_tokens" },
    }),
  );
  const end = await runtime(partial.model).start(partial.request()).done;
  assert.deepEqual(end, {
    reason: RUN_END_REASON.COMPLETED,
    text: "Half an answer",
    incomplete: { status: "incomplete", reason: "max_output_tokens" },
  });
  assert.deepEqual(kinds(partial.events), [
    RUNTIME_EVENT.ANSWERED,
    RUNTIME_EVENT.TEXT,
    RUNTIME_EVENT.INCOMPLETE,
    RUNTIME_EVENT.ENDED,
  ]);

  const preface = harness();
  preface.model.answers.push(
    answered({
      text: "Let me check.",
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act")],
    }),
    answered({ text: "" }),
  );
  const ended = await runtime(preface.model).start(preface.request()).done;
  assert.deepEqual(ended, { reason: RUN_END_REASON.COMPLETED, text: "" });
  const texts = preface.events.flatMap((event) =>
    event.kind === RUNTIME_EVENT.TEXT ? [event.text] : [],
  );
  assert.deepEqual(texts, ["Let me check.", ""]);
});

test("a cancel inside a batch parts no call from the result its host records, and the end is told once", async () => {
  const h = harness();
  let run: RuntimeRun | undefined;
  const recorded: string[] = [];
  const executor: ToolExecutor = {
    execute: (invocation) =>
      Effect.sync(() => {
        h.executed.push(invocation);
        if (invocation.callId === "c1") run?.cancel();
        return { outputJson: JSON.stringify({ status: "accepted" }) };
      }),
  };
  h.model.answers.push(
    answered({
      items: [
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c1",
          name: "act",
          arguments: "{}",
        },
        {
          type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
          call_id: "c2",
          name: "act",
          arguments: "{}",
        },
      ],
      toolCalls: [toolCall("c1", "act"), toolCall("c2", "act")],
    }),
  );
  run = runtime(h.model).start(
    h.request({
      tools: executor,
      // The host's own recording of a result is asynchronous, as the
      // checkpoint behind it is: a cancel that cut the run between an
      // action and the record of what it did would leave this short.
      onEvent: async (event) => {
        h.events.push(event);
        if (event.kind === RUNTIME_EVENT.TOOL_RESULT) {
          await new Promise((resolve) => setImmediate(resolve));
          recorded.push(event.invocation.callId);
        }
      },
    }),
  );
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.CANCELLED });
  assert.deepEqual(recorded, ["c1", "c2"]);
  assert.deepEqual(
    h.executed.map((call) => call.callId),
    ["c1", "c2"],
  );
  assert.equal(kinds(h.events).filter((kind) => kind === RUNTIME_EVENT.CANCELLED).length, 1);
  assert.equal(kinds(h.events).filter((kind) => kind === RUNTIME_EVENT.ENDED).length, 1);
  assert.equal(h.model.requests.length, 1);
});

test("a run whose signal fired before it opened ingests nothing, asks no model, and ends cancelled", async () => {
  const h = harness();
  h.abort.abort();
  const run = runtime(h.model).start(h.request());
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.CANCELLED });
  assert.deepEqual(kinds(h.events), [RUNTIME_EVENT.CANCELLED, RUNTIME_EVENT.ENDED]);
  assert.equal(h.model.requests.length, 0);
  assert.equal(h.context.checkpoint().items.length, 0);
});

test("a cancel while the model is thinking settles the wait at once and the late answer reaches nothing", async () => {
  const h = harness();
  h.model.hold = true;
  const run = runtime(h.model).start(h.request());
  await new Promise((resolve) => setImmediate(resolve));
  run.cancel();
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.CANCELLED });
  const told = h.events.length;
  const carried = h.context.checkpoint().items.length;
  h.model.held?.(answered({ text: "late" }));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.events.length, told);
  assert.equal(h.context.checkpoint().items.length, carried);
});

test("a cancel that lands while the run is telling its end leaves that end standing and tells no second one", async () => {
  const h = harness();
  h.model.answers.push(answered({ text: "done" }));
  let run: RuntimeRun | undefined;
  run = runtime(h.model).start(
    h.request({
      onEvent: async (event) => {
        h.events.push(event);
        if (event.kind !== RUNTIME_EVENT.ENDED) return;
        run?.cancel();
        await new Promise((resolve) => setImmediate(resolve));
      },
    }),
  );
  assert.deepEqual(await run.done, { reason: RUN_END_REASON.COMPLETED, text: "done" });
  assert.equal(kinds(h.events).filter((kind) => kind === RUNTIME_EVENT.ENDED).length, 1);
  assert.equal(kinds(h.events).filter((kind) => kind === RUNTIME_EVENT.CANCELLED).length, 0);
});

/** The same request, with the listener as the effect the runtime's own seam takes. */
function effectRequest(
  request: RuntimeRunRequest,
  events: RuntimeEvent[],
): RuntimeRunRequestEffect {
  return {
    ...request,
    onEvent: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
  };
}

/** An engine that holds its `ingest` until the test releases it, over a real one behind it. */
function heldIngestEngine(inner: ResponsesContextEngine) {
  let reached: (() => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release: (() => void) | undefined;
  let applied = 0;
  const engine: ContextEngine = {
    checkpointFormat: inner.checkpointFormat,
    bootstrap: (checkpoint, lost) => inner.bootstrap(checkpoint, lost),
    ingest: (input) =>
      new Promise<void>((resolve) => {
        reached?.();
        release = () => {
          applied += 1;
          inner.ingest(input);
          resolve();
        };
      }),
    assemble: (assembly) => inner.assemble(assembly),
    adopt: (items) => inner.adopt(items),
    afterTurn: () => inner.afterTurn(),
    mark: () => inner.mark(),
    rollback: (mark) => inner.rollback(mark),
    checkpoint: () => inner.checkpoint(),
    dispose: () => inner.dispose(),
  };
  return { engine, entered, release: () => release?.(), applied: () => applied };
}

it.effect(
  "an engine hook still waiting when the run is cancelled is abandoned: the run answers cancelled, and what the hook applies afterwards tells no end of its own",
  () =>
    Effect.gen(function* () {
      const h = harness();
      const held = heldIngestEngine(new ResponsesContextEngine(TOOL_LOOP_IDENTITY));
      const events: RuntimeEvent[] = [];
      const run = toolLoop(h.model).start(
        effectRequest(h.request({ context: held.engine }), events),
      );
      const running = yield* Effect.fork(run.done);
      yield* Effect.promise(() => held.entered);

      run.cancel();

      assert.deepEqual(yield* Fiber.join(running), { reason: RUN_END_REASON.CANCELLED });
      // The model was never asked: the run ended inside the hook it was waiting on.
      assert.equal(h.model.requests.length, 0);
      assert.equal(held.applied(), 0);
      assert.deepEqual(kinds(events), [RUNTIME_EVENT.CANCELLED, RUNTIME_EVENT.ENDED]);

      held.release();
      yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));

      assert.equal(held.applied(), 1);
      assert.deepEqual(kinds(events), [RUNTIME_EVENT.CANCELLED, RUNTIME_EVENT.ENDED]);
    }),
);

it.effect(
  "a host that interrupts the fiber the run is on ends it as a cancel: the loop stops and the end is told once",
  () =>
    Effect.gen(function* () {
      const h = harness();
      h.model.hold = true;
      const events: RuntimeEvent[] = [];
      const run = toolLoop(h.model).start(effectRequest(h.request(), events));
      const carrying = yield* Effect.fork(run.done);
      while (h.model.requests.length === 0) {
        yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
      }

      yield* Fiber.interrupt(carrying);

      assert.deepEqual(kinds(events).slice(-2), [RUNTIME_EVENT.CANCELLED, RUNTIME_EVENT.ENDED]);
      assert.equal(
        events.filter((event) => event.kind === RUNTIME_EVENT.ENDED).length,
        1,
        "the end is told once",
      );
    }),
);

test("the runtime's compact is the only fold there is: a run never folds the context, and the seam that does asks the model with no tools", async () => {
  const h = harness();
  let folds = 0;
  const inner = new ResponsesContextEngine(TOOL_LOOP_IDENTITY);
  inner.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  const engine: ContextEngine = {
    checkpointFormat: inner.checkpointFormat,
    bootstrap: (checkpoint, lost) => inner.bootstrap(checkpoint, lost),
    ingest: (input) => inner.ingest(input),
    assemble: (assembly) => inner.assemble(assembly),
    adopt: (items) => inner.adopt(items),
    afterTurn: () => inner.afterTurn(),
    mark: () => inner.mark(),
    rollback: (mark) => inner.rollback(mark),
    checkpoint: () => inner.checkpoint(),
    dispose: () => inner.dispose(),
    foldBehindSummary: async (summarize) => {
      folds += 1;
      const summary = await summarize(inner.checkpoint().items);
      return summary === undefined ? 0 : 3;
    },
  };
  const r = runtime(h.model);
  h.model.answers.push(answered({ text: "hi" }));

  const end = await r.start(h.request({ context: engine })).done;

  assert.deepEqual(end, { reason: RUN_END_REASON.COMPLETED, text: "hi" });
  assert.equal(folds, 0);

  h.model.answers.push(answered({ text: "a checkpoint summary" }));
  const outcome = await r.compact(engine, {
    prompt: "instructions",
    signal: new AbortController().signal,
  });

  assert.equal(folds, 1);
  assert.ok(outcome.compacted);
  if (outcome.compacted) {
    assert.equal(outcome.source, COMPACTION_SOURCE.LOCAL_SUMMARY);
    assert.equal(outcome.dropped, 3);
  }
  // The summary is asked for with no tools and its own output budget, so a fold
  // can never carry an action the run could not.
  assert.deepEqual(h.model.requests.at(-1)?.options.tools, []);
  assert.equal(
    h.model.requests.at(-1)?.options.maximumOutputTokens,
    COMPACTION_POLICY.SUMMARY_OUTPUT_TOKENS,
  );
});
