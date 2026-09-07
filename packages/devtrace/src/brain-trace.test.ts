import assert from "node:assert/strict";
import test from "node:test";
import {
  type BareResponsesModel,
  bareModelAdapter,
  type ResponsesInputItem,
  responsesModelAnswer,
  userMessageItem,
} from "@sidecar/brain";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelRequestOptions,
  type ModelResponse,
} from "@sidecar/runtime-contracts";
import { tracedModelAdapter } from "./brain-trace.js";
import type { BrainRequestTraceRecord } from "./trace-writer.js";

const INPUT: readonly ResponsesInputItem[] = [
  userMessageItem("checkout-service is waiting on you"),
  { type: "function_call_output", call_id: "call_1", output: "{}" },
];
const INPUT_CHARS = JSON.stringify(INPUT).length;
const OPTIONS: ModelRequestOptions = {
  prompt: "instructions",
  tools: [],
  maximumOutputTokens: 400,
};

const answeredPayload = responsesModelAnswer({
  output: [
    { type: "reasoning", summary: [] },
    { type: "function_call", call_id: "c1", name: "announce", arguments: '{"briefing":"..."}' },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
  ],
  usage: { input_tokens: 1_200, output_tokens: 80 },
});
assert.ok(answeredPayload);
const ANSWERED: ModelResponse = answeredPayload;

function adapterAnswering(answer: ModelResponse, model?: string) {
  const bare: BareResponsesModel = {
    respond: async () => answer,
    quietUntil: () => undefined,
    ...(model ? { model } : undefined),
  };
  return bareModelAdapter(bare);
}

function steppingClock(step: number): () => number {
  let clock = 1_000;
  return () => {
    clock += step;
    return clock;
  };
}

test("an answered inference returns unchanged and records counts, kinds, and usage", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const adapter = tracedModelAdapter(
    adapterAnswering(ANSWERED),
    (record) => records.push(record),
    steppingClock(40),
  );
  const answer = await adapter.respond(INPUT, OPTIONS);
  assert.equal(answer, ANSWERED);
  assert.deepEqual(records, [
    {
      inputItems: 2,
      inputChars: INPUT_CHARS,
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      elapsedMs: 40,
      outputItemKinds: ["reasoning", "function_call", "message"],
      inputTokens: 1_200,
      outputTokens: 80,
    },
  ]);
});

test("the model travels on the record when the adapter names one", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const keyed = tracedModelAdapter(adapterAnswering(ANSWERED, "gpt-test"), (record) =>
    records.push(record),
  );
  await keyed.respond(INPUT, OPTIONS);
  assert.equal(records[0]?.model, "gpt-test");
  assert.equal(keyed.model, "gpt-test");
  const hosted = tracedModelAdapter(adapterAnswering(ANSWERED), (record) => records.push(record));
  await hosted.respond(INPUT, OPTIONS);
  assert.ok(records[1] && !("model" in records[1]));
});

test("a throttled answer records its outcome and nothing of a payload", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const adapter = tracedModelAdapter(
    adapterAnswering({ outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until: 5_000 }),
    (record) => records.push(record),
    () => 7,
  );
  await adapter.respond([], OPTIONS);
  assert.deepEqual(records, [
    { inputItems: 0, inputChars: 2, outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, elapsedMs: 0 },
  ]);
});

test("a failed answer keeps the adapter's reason as the error", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const adapter = tracedModelAdapter(
    adapterAnswering({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: "status 500",
    }),
    (record) => records.push(record),
    () => 7,
  );
  await adapter.respond(INPUT, OPTIONS);
  assert.equal(records[0]?.outcome, MODEL_RESPONSE_OUTCOME.FAILED);
  assert.equal(records[0]?.error, "status 500");
});

test("a thrown request still throws, and the trace keeps the failure", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const adapter = tracedModelAdapter(
    bareModelAdapter({
      respond: async () => {
        throw new Error("rate limited");
      },
      quietUntil: () => undefined,
    }),
    (record) => records.push(record),
    () => 7,
  );
  await assert.rejects(() => adapter.respond(INPUT, OPTIONS), /rate limited/u);
  assert.deepEqual(records, [
    {
      inputItems: 2,
      inputChars: INPUT_CHARS,
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      elapsedMs: 0,
      error: "rate limited",
    },
  ]);
});

test("a recorder that throws costs the trace line, never the request", async () => {
  const adapter = tracedModelAdapter(adapterAnswering(ANSWERED), () => {
    throw new Error("disk full");
  });
  assert.equal(await adapter.respond(INPUT, OPTIONS), ANSWERED);
});

test("quiet, capabilities, counting, and compaction pass through the wrapped adapter untouched", async () => {
  const inner = bareModelAdapter({ respond: async () => ANSWERED, quietUntil: () => 42 });
  const adapter = tracedModelAdapter(inner, () => undefined);
  assert.equal(adapter.quietUntil(), 42);
  assert.deepEqual(await adapter.capabilities(), await inner.capabilities());
  assert.deepEqual(
    await adapter.countInputTokens(INPUT, OPTIONS),
    await inner.countInputTokens(INPUT, OPTIONS),
  );
  assert.deepEqual(await adapter.compact(INPUT, OPTIONS), await inner.compact(INPUT, OPTIONS));
});
