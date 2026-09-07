import assert from "node:assert/strict";
import test from "node:test";
import {
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
  type RuntimeRun,
  type RuntimeRunRequest,
  type ToolExecutor,
  type ToolInvocation,
} from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import { ResponsesContextEngine } from "./context-engine.js";
import { RESPONSES_ITEM_FORMAT, RESPONSES_ITEM_TYPE } from "./responses-api.js";
import { TOOL_LOOP_RUNTIME, TOOL_LOOP_RUNTIME_IDENTITY, ToolLoopAgentRuntime } from "./runtime.js";

function answered(
  overrides: Partial<Extract<ModelResponse, { outcome: "answered" }>> = {},
): ModelResponse {
  return {
    outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
    items: [],
    text: "",
    toolCalls: [],
    compacted: false,
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
          format: RESPONSES_ITEM_FORMAT.FORMAT,
          formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
        },
        countsInputTokens: false,
        compacts: false,
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

  compact(): never {
    throw new Error("not compacted here");
  }

  quietUntil(): number | undefined {
    return undefined;
  }
}

function runtime(model: FakeModel, loopGuard?: { enabled: boolean }) {
  return new ToolLoopAgentRuntime({
    model,
    itemFormat: { format: RESPONSES_ITEM_FORMAT.FORMAT, version: RESPONSES_ITEM_FORMAT.VERSION },
    createContext: () => new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY),
    ...(loopGuard ? { loopGuard } : undefined),
  });
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
  const context = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  context.bootstrap(undefined, '{"status":"unknown"}');
  const abort = new AbortController();
  const executor: ToolExecutor = {
    execute: async (invocation) => {
      executed.push(invocation);
      return { outputJson: JSON.stringify({ status: "accepted", call: invocation.callId }) };
    },
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
      toolSchemas: [{ name: "act", description: "an act", parameters: { type: "object" } }],
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
  assert.deepEqual(kinds(h.events), [RUNTIME_EVENT.USAGE, RUNTIME_EVENT.TEXT, RUNTIME_EVENT.ENDED]);
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
            type: RESPONSES_ITEM_TYPE.FUNCTION_CALL,
            call_id: `c${index}a`,
            name: "act",
            arguments: "{}",
          },
          {
            type: RESPONSES_ITEM_TYPE.FUNCTION_CALL,
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
  const calls = items.filter((item) => item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL);
  const outputs = items.filter((item) => item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
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

test("a compaction item in the answer folds the context and is reported", async () => {
  const h = harness();
  const folded = { type: RESPONSES_ITEM_TYPE.COMPACTION, id: "cmp", encrypted_content: "x" };
  h.model.answers.push(answered({ items: [folded], text: "ok", compacted: true }));
  await runtime(h.model).start(h.request()).done;
  assert.deepEqual(h.events[0], { kind: RUNTIME_EVENT.COMPACTED, dropped: 1 });
  assert.deepEqual(h.context.checkpoint().items, [folded]);
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
    execute: async (invocation, context) => {
      h.executed.push(invocation);
      const status = context.isRevoked() ? "rejected" : "accepted";
      if (invocation.callId === "c1") run?.cancel();
      return { outputJson: JSON.stringify({ status }) };
    },
  };
  h.model.answers.push(
    answered({
      items: [
        { type: RESPONSES_ITEM_TYPE.FUNCTION_CALL, call_id: "c1", name: "act", arguments: "{}" },
        { type: RESPONSES_ITEM_TYPE.FUNCTION_CALL, call_id: "c2", name: "act", arguments: "{}" },
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

test("steered words are read at the next safe boundary, before the next inference", async () => {
  const h = harness();
  h.model.answers.push(
    answered({
      items: [
        { type: RESPONSES_ITEM_TYPE.FUNCTION_CALL, call_id: "c1", name: "act", arguments: "{}" },
      ],
      toolCalls: [toolCall("c1", "act")],
    }),
  );
  const run = runtime(h.model).start(h.request());
  run.steer({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "also this" });
  await run.done;
  assert.equal(h.model.requests.length, 2);
  const second = h.model.requests[1]?.items ?? [];
  const steeredIndex = second.findIndex((item) => JSON.stringify(item).includes("also this"));
  const outputIndex = second.findIndex(
    (item) => item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  );
  assert.ok(steeredIndex > outputIndex && steeredIndex === second.length - 2);
});

test("an executor that throws leaves an unknown answer paired to the call rather than a dangling call", async () => {
  const h = harness({
    execute: async () => {
      throw new Error("boom");
    },
  });
  h.model.answers.push(
    answered({
      items: [
        { type: RESPONSES_ITEM_TYPE.FUNCTION_CALL, call_id: "c1", name: "act", arguments: "{}" },
      ],
      toolCalls: [toolCall("c1", "act")],
    }),
  );
  await runtime(h.model).start(h.request()).done;
  const output = h.context
    .checkpoint()
    .items.find((item) => item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT);
  assert.ok(output && typeof output.output === "string" && output.output.includes('"unknown"'));
});

test("with the guard enabled, a critical verdict pairs every remaining call and ends the run as the guard's", async () => {
  const h = harness();
  const repeated = () =>
    answered({
      items: [
        { type: RESPONSES_ITEM_TYPE.FUNCTION_CALL, call_id: "c", name: "act", arguments: "{}" },
      ],
      toolCalls: [toolCall("c", "act")],
    });
  for (let index = 0; index < 40; index += 1) h.model.answers.push(repeated());
  const executor: ToolExecutor = {
    execute: async () => ({ outputJson: '{"status":"running"}' }),
  };
  const end = await runtime(h.model, { enabled: true }).start(h.request({ tools: executor })).done;
  assert.equal(end.reason, RUN_END_REASON.LOOP_GUARD);
  assert.ok(h.events.some((event) => event.kind === RUNTIME_EVENT.LOOP_GUARD));
  const items = h.context.checkpoint().items;
  const calls = items.filter((item) => item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL).length;
  const outputs = items.filter(
    (item) => item.type === RESPONSES_ITEM_TYPE.FUNCTION_CALL_OUTPUT,
  ).length;
  assert.equal(calls, outputs);
  assert.ok(h.model.requests.length < 40);
});

test("resume loads a compatible checkpoint and refuses a foreign one without touching it", async () => {
  const h = harness();
  const items = [{ type: RESPONSES_ITEM_TYPE.MESSAGE, role: "user", content: "earlier" }];
  const r = runtime(h.model);
  const refused = r.resume(
    { format: { ...r.descriptor.checkpoint, runtime: "other" }, items },
    h.request(),
    "{}",
  );
  assert.ok("refused" in refused);
  h.model.answers.push(answered({ text: "resumed" }));
  const resumed = r.resume({ format: r.descriptor.checkpoint, items }, h.request(), "{}");
  assert.ok(!("refused" in resumed));
  if (!("refused" in resumed)) {
    assert.deepEqual(await resumed.done, { reason: RUN_END_REASON.COMPLETED, text: "resumed" });
    assert.deepEqual(h.model.requests[0]?.items[0], items[0]);
  }
});
