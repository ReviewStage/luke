import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_CLIENT_OUTCOME,
  type BrainClient,
  type BrainClientAnswer,
  type ResponsesInputItem,
  userMessageItem,
} from "@sidecar/brain";
import { tracedBrainClient } from "./brain-trace.js";
import type { BrainRequestTraceRecord } from "./trace-writer.js";

const INPUT: readonly ResponsesInputItem[] = [
  userMessageItem("checkout-service is waiting on you"),
  { type: "function_call_output", call_id: "call_1", output: "{}" },
];
const INPUT_CHARS = JSON.stringify(INPUT).length;
const OPTIONS = { maximumOutputTokens: 400 };

const ANSWERED: BrainClientAnswer = {
  outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
  payload: {
    output: [
      { type: "reasoning", summary: [] },
      { type: "function_call", name: "announce", arguments: '{"briefing":"..."}' },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Done." }] },
    ],
    usage: { input_tokens: 1_200, output_tokens: 80 },
  },
};

function clientAnswering(answer: BrainClientAnswer, model?: string): BrainClient {
  return {
    respond: async () => answer,
    quietUntil: () => undefined,
    ...(model ? { model } : undefined),
  };
}

function steppingClock(step: number): () => number {
  let clock = 1_000;
  return () => {
    clock += step;
    return clock;
  };
}

test("an answered request returns unchanged and records counts, kinds, and usage", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const client = tracedBrainClient(
    clientAnswering(ANSWERED),
    (record) => records.push(record),
    steppingClock(40),
  );
  const answer = await client.respond(INPUT, OPTIONS);
  assert.equal(answer, ANSWERED);
  assert.deepEqual(records, [
    {
      inputItems: 2,
      inputChars: INPUT_CHARS,
      outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
      elapsedMs: 40,
      outputItemKinds: ["reasoning", "function_call", "message"],
      inputTokens: 1_200,
      outputTokens: 80,
    },
  ]);
});

test("the record never carries the input's text, only its size", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const client = tracedBrainClient(clientAnswering(ANSWERED), (record) => records.push(record));
  await client.respond(INPUT, OPTIONS);
  assert.doesNotMatch(JSON.stringify(records), /checkout-service/u);
});

test("a payload without output or usage records empty kinds and no counts", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const client = tracedBrainClient(
    clientAnswering({ outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, payload: "not an object" }),
    (record) => records.push(record),
    () => 0,
  );
  await client.respond(INPUT, OPTIONS);
  assert.deepEqual(records[0]?.outputItemKinds, []);
  assert.ok(records[0] && !("inputTokens" in records[0]) && !("outputTokens" in records[0]));
});

test("a quiet answer records its outcome and nothing of a payload", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const client = tracedBrainClient(
    clientAnswering({ outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: 5_000 }),
    (record) => records.push(record),
    () => 7,
  );
  await client.respond([], OPTIONS);
  assert.deepEqual(records, [
    { inputItems: 0, inputChars: 2, outcome: BRAIN_CLIENT_OUTCOME.QUIET, elapsedMs: 0 },
  ]);
});

test("a failed answer keeps the client's reason as the error", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const client = tracedBrainClient(
    clientAnswering({ outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason: "status 500" }),
    (record) => records.push(record),
    () => 7,
  );
  await client.respond(INPUT, OPTIONS);
  assert.equal(records[0]?.outcome, BRAIN_CLIENT_OUTCOME.FAILED);
  assert.equal(records[0]?.error, "status 500");
});

test("a thrown request still throws, and the trace keeps the failure", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const client = tracedBrainClient(
    {
      respond: async () => {
        throw new Error("rate limited");
      },
      quietUntil: () => undefined,
    },
    (record) => records.push(record),
    () => 7,
  );
  await assert.rejects(() => client.respond(INPUT, OPTIONS), /rate limited/u);
  assert.deepEqual(records, [
    {
      inputItems: 2,
      inputChars: INPUT_CHARS,
      outcome: BRAIN_CLIENT_OUTCOME.FAILED,
      elapsedMs: 0,
      error: "rate limited",
    },
  ]);
});

test("a recorder that throws costs the trace line, never the request", async () => {
  const client = tracedBrainClient(clientAnswering(ANSWERED), () => {
    throw new Error("disk full");
  });
  assert.equal(await client.respond(INPUT, OPTIONS), ANSWERED);
});

test("the model is recorded and forwarded only when the client names one", async () => {
  const records: BrainRequestTraceRecord[] = [];
  const keyed = tracedBrainClient(
    clientAnswering(ANSWERED, "gpt-5.6-sol"),
    (record) => records.push(record),
    () => 0,
  );
  assert.equal(keyed.model, "gpt-5.6-sol");
  await keyed.respond(INPUT, OPTIONS);
  assert.equal(records[0]?.model, "gpt-5.6-sol");

  const hosted = tracedBrainClient(
    clientAnswering(ANSWERED),
    (record) => records.push(record),
    () => 0,
  );
  assert.equal(hosted.model, undefined);
  await hosted.respond(INPUT, OPTIONS);
  assert.ok(records[1] && !("model" in records[1]));
});

test("quietUntil answers with the wrapped client's own reading", () => {
  const client = tracedBrainClient(
    { respond: async () => ANSWERED, quietUntil: () => 42 },
    () => undefined,
  );
  assert.equal(client.quietUntil(), 42);
});
