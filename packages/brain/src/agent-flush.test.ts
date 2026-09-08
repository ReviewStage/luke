import assert from "node:assert/strict";
import test from "node:test";
import { MEMORY_HOUSEKEEPING_OUTCOME, type MemoryHousekeepingResult } from "@sidecar/memory";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
} from "@sidecar/runtime-contracts";
import { ACT_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { BrainAgent, type BrainFlushInput } from "./agent.js";
import { ResponsesContextEngine } from "./context-engine.js";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
} from "./requests.js";
import {
  RESPONSES_ITEM_FORMAT,
  RESPONSES_ITEM_TYPE,
  type ResponsesInputItem,
  responsesModelAnswer,
} from "./responses-api.js";
import { TOOL_LOOP_RUNTIME, ToolLoopAgentRuntime } from "./runtime.js";
import { type BrainStateStorage, BrainStateStore } from "./state-store.js";

/**
 * The flush before compaction, at the host: a small window makes the soft
 * margin reachable, so a turn that leaves the context over the flush
 * threshold runs the hook in maintenance, once per cycle, over a copy of the
 * items and never the engine.
 */

const IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };
const NOW = 1_800_000_000_000;
/** Reserve is a quarter of this, 500; compaction at 1,500 tokens; the flush at 750. */
const WINDOW_TOKENS = 2_000;

function message(text: string): WireRecord {
  return {
    type: RESPONSES_ITEM_TYPE.MESSAGE,
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

/** An answer whose usage counts the input as the model would, four characters to a token. */
function answered(
  output: readonly WireRecord[],
  input: readonly ResponsesInputItem[],
): ModelResponse {
  const answer = responsesModelAnswer({
    output,
    usage: { input_tokens: Math.ceil(JSON.stringify(input).length / 4) },
  });
  assert.ok(answer);
  return answer;
}

class FakeModel {
  readonly inputs: ResponsesInputItem[][] = [];
  respond(input: readonly ResponsesInputItem[], _options: ModelRequestOptions) {
    this.inputs.push([...input]);
    return Promise.resolve(answered([message("ok")], input));
  }
}

function adapterOf(model: FakeModel): ModelAdapter {
  return {
    capabilities: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        checkpoint: {
          runtime: TOOL_LOOP_RUNTIME.ID,
          runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
          format: RESPONSES_ITEM_FORMAT.FORMAT,
          formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
        },
        contextWindowTokens: WINDOW_TOKENS,
        countsInputTokens: false,
        compacts: false,
        maximumOutputTokens: 16_000,
      },
    }),
    respond: (input, options) => model.respond(input, options),
    countInputTokens: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: "not counted",
    }),
    compact: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: "not compacted",
    }),
    quietUntil: () => undefined,
  };
}

class FakeStorage implements BrainStateStorage {
  #record: string | undefined;
  read() {
    return this.#record;
  }
  write(contents: string) {
    this.#record = contents;
    return true;
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

function agentWith(hook: (input: BrainFlushInput) => Promise<MemoryHousekeepingResult>) {
  const model = new FakeModel();
  const runtime = new ToolLoopAgentRuntime({
    model: adapterOf(model),
    itemFormat: { format: RESPONSES_ITEM_FORMAT.FORMAT, version: RESPONSES_ITEM_FORMAT.VERSION },
    createContext: () => new ResponsesContextEngine(IDENTITY),
  });
  let ids = 0;
  const reports: string[] = [];
  const store = new BrainStateStore({
    storage: new FakeStorage(),
    createGenerationId: () => `gen-${ids++}`,
    now: () => NOW,
  });
  const agent = new BrainAgent({
    runtime,
    prepareTurn: () => ({ prompt: "flush test", layers: {} }),
    acts: { perform: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) },
    roster: () => ({ text: "", identities: [] }),
    standingContext: () => "",
    readTranscriptSince: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
    readTranscript: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
    deliver: () => undefined,
    store,
    createRunId: () => `run-${ids++}`,
    report: (line) => {
      reports.push(line);
    },
    now: () => NOW,
    beforeCompaction: hook,
  });
  return { agent, model, reports };
}

async function ask(agent: BrainAgent, question: string) {
  const accepted = await agent.submitAsk({
    submissionId: `s-${question.length}-${Math.random()}`,
    question,
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
  const record = await agent.waitAsk(runId, 60_000);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await settle();
}

test("a turn that leaves the context over the flush threshold runs the flush once, over a copy of the items, and not again in the same cycle", async () => {
  const calls: BrainFlushInput[] = [];
  const h = agentWith(async (input) => {
    calls.push(input);
    return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 };
  });
  await ask(h.agent, "short");
  assert.equal(calls.length, 0, "a small context flushes nothing");
  // Around 3,400 characters of items: past the 750-token flush threshold, under the 1,500-token compaction threshold.
  await ask(h.agent, "x".repeat(3_000));
  assert.equal(calls.length, 1);
  const [flush] = calls;
  assert.ok(flush);
  assert.equal(flush.contextWindowTokens, WINDOW_TOKENS);
  assert.ok(flush.contextTokens >= 750 && flush.contextTokens < 1_500, `${flush.contextTokens}`);
  assert.equal(flush.compactionCount, 0);
  assert.ok(flush.items.length >= 2, "the copy carries the conversation so far");
  const snapshot = await h.agent.contextSnapshot();
  assert.ok(snapshot);
  assert.notEqual(snapshot, flush.items, "a copy, never the engine's own array");
  await ask(h.agent, "another small ask");
  assert.equal(calls.length, 1, "already flushed in this compaction cycle");
  assert.deepEqual(h.agent.flushCycle(), { compactionCount: 0, lastFlushCompactionCount: 0 });
  await h.agent.stop();
});

test("an interrupted or failed flush is reported and runs again at the next assessment; a completed one marks the cycle", async () => {
  let outcome: MemoryHousekeepingResult = {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
    writes: 1,
    reason: "cancelled",
  };
  let calls = 0;
  const h = agentWith(async () => {
    calls += 1;
    return outcome;
  });
  await ask(h.agent, "y".repeat(3_000));
  assert.equal(calls, 1);
  assert.ok(
    h.reports.some((line) =>
      /Memory flush did not complete \(interrupted: cancelled\)/u.test(line),
    ),
  );
  assert.deepEqual(h.agent.flushCycle(), { compactionCount: 0 });
  outcome = { outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE, writes: 0 };
  await ask(h.agent, "again");
  assert.equal(calls, 2, "the unflushed cycle is assessed again");
  assert.deepEqual(h.agent.flushCycle(), { compactionCount: 0, lastFlushCompactionCount: 0 });
  await ask(h.agent, "once more");
  assert.equal(calls, 2);
  await h.agent.stop();
});
