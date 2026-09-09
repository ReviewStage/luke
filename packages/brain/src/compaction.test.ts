import assert from "node:assert/strict";
import test from "node:test";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilities,
  type ModelResponse,
  TRANSCRIPT_EVENT_KIND,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, toDisposable, type WireRecord } from "@sidecar/wire";
import { BrainAgent } from "./agent.js";
import {
  assessCompaction,
  COMPACTION_NEED,
  COMPACTION_POLICY,
  compactContext,
  LOCAL_SUMMARY_MARKER,
  reserveTokens,
  shouldCompact,
} from "./compaction.js";
import { ResponsesContextEngine } from "./context-engine.js";
import type { BrainPersistedState } from "./envelope.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
} from "./requests.js";
import { responsesModelAnswer, userMessageItem } from "./responses-api.js";
import { ToolLoopAgentRuntime } from "./runtime.js";
import { BrainStateStore } from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";
import { RecordingContextEngine } from "./transcript-recorder.js";

/**
 * The one compaction owner: its policy, the explicit adoption, the local fold,
 * the transport admission, and how the host schedules and cancels it. Every
 * word here is synthetic.
 */

const NOW = 1_800_000_000_000;
const TOOL_LOOP_RUNTIME_IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };
const CHECKPOINT = {
  runtime: TOOL_LOOP_RUNTIME.ID,
  runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
  format: RESPONSES_ITEM_FORMAT.format,
  formatVersion: RESPONSES_ITEM_FORMAT.version,
} as const;

function call(callId: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL,
    call_id: callId,
    name: "t",
    arguments: "{}",
  };
}
function output(callId: string): WireRecord {
  return { type: RESPONSES_INPUT_ITEM_TYPE.FUNCTION_CALL_OUTPUT, call_id: callId, output: "{}" };
}
function assistant(text: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

test("the reserve is 20,000 tokens capped at a quarter of the window, and the threshold is the window less it", () => {
  assert.equal(reserveTokens(400_000), 20_000);
  assert.equal(reserveTokens(64_000), 16_000);
  assert.equal(reserveTokens(8_000), 2_000);
  assert.equal(shouldCompact(380_000, 400_000), false);
  assert.equal(shouldCompact(380_001, 400_000), true);
  assert.equal(shouldCompact(1, 0), false);
  assert.equal(COMPACTION_POLICY.KEEP_RECENT_TOKENS, 20_000);
});

test("the assessment names the transport bound before the window, and neither below both", () => {
  const items = [userMessageItem("x".repeat(1_000))];
  const capabilities: Pick<ModelCapabilities, "contextWindowTokens" | "maximumRequestBytes"> = {
    contextWindowTokens: 400_000,
    maximumRequestBytes: 1_200,
  };
  assert.equal(assessCompaction(items, "p", capabilities).need, COMPACTION_NEED.TRANSPORT);
  assert.equal(
    assessCompaction(items, "p", { contextWindowTokens: 400_000 }).need,
    COMPACTION_NEED.NONE,
  );
  // A counted total from the model's own usage outranks the estimate.
  assert.equal(
    assessCompaction(items, "p", { contextWindowTokens: 400_000 }, 390_000).need,
    COMPACTION_NEED.WINDOW,
  );
  assert.equal(assessCompaction(items, "p", undefined).contextWindowTokens, 400_000);
});

test("the local fold cuts at a user message so a call stays beside its output, and records the boundary", async () => {
  const engine = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  engine.bootstrap(undefined, "{}");
  const items: WireRecord[] = [
    userMessageItem("first ask"),
    assistant("a1"),
    userMessageItem("second ask"),
    call("c1"),
    output("c1"),
    assistant("a2 ".repeat(40)),
  ];
  for (const item of items) engine.ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: [item] });
  const recorder = new RecordingContextEngine(engine, () => NOW);
  // A budget that the tail alone exceeds only once it reaches the second ask:
  // the cut may not land between the call and its output.
  let handed: readonly WireRecord[] = [];
  const dropped = await recorder.foldBehindSummary(async (older) => {
    handed = older;
    return `${LOCAL_SUMMARY_MARKER}\nsummary`;
  }, 60);
  assert.equal(dropped, 2);
  assert.deepEqual(handed, items.slice(0, 2));
  const kept = engine.checkpoint().items;
  assert.deepEqual(kept[0], userMessageItem(`${LOCAL_SUMMARY_MARKER}\nsummary`));
  assert.deepEqual(kept.slice(1), items.slice(2));
  const [event] = recorder.pending();
  assert.equal(event?.kind, TRANSCRIPT_EVENT_KIND.COMPACTION);
  if (event?.kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
    assert.equal(event.boundary.source, COMPACTION_SOURCE.LOCAL_SUMMARY);
    assert.equal(event.boundary.dropped, 2);
  }
  // Nothing to fold — one user message and its tail — folds nothing and asks no summary.
  const small = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  small.bootstrap(undefined, "{}");
  small.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "only" });
  assert.equal(
    await small.foldBehindSummary(async () => {
      throw new Error("must not be asked");
    }, 10),
    0,
  );
  // A summary that does not come leaves the items exactly as they were.
  assert.equal(await engine.foldBehindSummary(async () => undefined, 1), 0);
  assert.deepEqual(engine.checkpoint().items, kept);
});

function adapter(overrides: Partial<ModelAdapter> & { compacts?: boolean }): ModelAdapter {
  const capabilities: ModelCapabilities = {
    adapter: "fake",
    checkpoint: CHECKPOINT,
    countsInputTokens: false,
    compacts: overrides.compacts ?? true,
    maximumOutputTokens: 16_000,
    contextWindowTokens: 400_000,
  };
  return {
    capabilities: async () => ({ outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, capabilities }),
    respond: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: "upstream",
      reason: "not asked",
    }),
    countInputTokens: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: "upstream",
      reason: "not counted",
    }),
    compact: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: "upstream",
      reason: "not compacted",
    }),
    quietUntil: () => undefined,
    ...overrides,
  };
}

test("an explicit compaction is asked over the retained items alone, adopted whole, and recorded; a failure changes nothing", async () => {
  const engine = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  engine.bootstrap(undefined, "{}");
  const recorder = new RecordingContextEngine(engine, () => NOW);
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "one" });
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "two" });
  recorder.retained(2);
  const window = [
    userMessageItem("kept"),
    { type: RESPONSES_INPUT_ITEM_TYPE.COMPACTION, encrypted_content: "e" },
  ];
  let asked: readonly WireRecord[] = [];
  const model = adapter({
    compact: async (items) => {
      asked = items;
      return { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, items: window };
    },
  });
  const capabilities = await model.capabilities();
  assert.ok(capabilities.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  const outcome = await compactContext(recorder, model, {
    prompt: "p",
    signal: new AbortController().signal,
    capabilities: capabilities.capabilities,
  });
  assert.deepEqual(outcome, {
    compacted: true,
    source: COMPACTION_SOURCE.PROVIDER_EXPLICIT,
    dropped: 2,
  });
  assert.deepEqual(asked, [userMessageItem("one"), userMessageItem("two")]);
  assert.deepEqual(recorder.checkpoint().items, window);
  const [boundary] = recorder.pending();
  assert.equal(boundary?.kind, TRANSCRIPT_EVENT_KIND.COMPACTION);
  // A refused compaction leaves the window as it was and says why.
  const refused = await compactContext(recorder, adapter({}), {
    prompt: "p",
    signal: new AbortController().signal,
    capabilities: capabilities.capabilities,
  });
  assert.deepEqual(refused, { compacted: false, reason: "upstream: not compacted" });
  assert.deepEqual(recorder.checkpoint().items, window);
  // A transport that cannot compact falls to the local fold, whose summary is a tool-free respond.
  let toolsOffered: number | undefined;
  const local = adapter({
    compacts: false,
    respond: async (_items, options): Promise<ModelResponse> => {
      toolsOffered = options.tools.length;
      const answer = responsesModelAnswer({ output: [assistant("folded words")] });
      assert.ok(answer);
      return answer;
    },
  });
  const big = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  big.bootstrap(undefined, "{}");
  const bigRecorder = new RecordingContextEngine(big, () => NOW);
  // The last message alone fills the recent-tail budget, so the two before it fold.
  for (const text of ["a", "b", "c".repeat(100_000)]) {
    await bigRecorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text });
  }
  const folded = await compactContext(bigRecorder, local, {
    prompt: "p",
    signal: new AbortController().signal,
    capabilities: { ...capabilities.capabilities, compacts: false },
  });
  assert.deepEqual(folded, {
    compacted: true,
    source: COMPACTION_SOURCE.LOCAL_SUMMARY,
    dropped: 2,
  });
  assert.equal(toolsOffered, 0);
  assert.deepEqual(
    bigRecorder.checkpoint().items[0],
    userMessageItem(`${LOCAL_SUMMARY_MARKER}\nfolded words`),
  );
});

test("the recorder keeps every ingested input and fold as transcript events, rolled back with the mark and drained as checkpoints land", async () => {
  const engine = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  engine.bootstrap(undefined, "{}");
  const recorder = new RecordingContextEngine(engine, () => NOW);
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "ask" });
  const mark = recorder.mark();
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: [call("c1")] });
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.TOOL_RESULT, callId: "c1", outputJson: "{}" });
  assert.equal(recorder.pending().length, 3);
  recorder.rollback(mark);
  assert.equal(recorder.pending().length, 1);
  assert.deepEqual(engine.checkpoint().items, [userMessageItem("ask")]);
  await recorder.ingest({
    kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT,
    items: [{ type: RESPONSES_INPUT_ITEM_TYPE.COMPACTION, encrypted_content: "x" }],
  });
  assert.equal(await recorder.compact(), 1);
  const kinds = recorder.pending().map((event) => event.kind);
  assert.deepEqual(kinds, [
    TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    TRANSCRIPT_EVENT_KIND.COMPACTION,
  ]);
  recorder.retained(2);
  assert.equal(recorder.pending().length, 1);
});

function agentOver(model: ModelAdapter, repository: FakeBrainStateRepository) {
  let ids = 0;
  const store = new BrainStateStore({
    repository,
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  const runtime = new ToolLoopAgentRuntime({
    model,
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: () => new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY),
  });
  const reports: string[] = [];
  const agent = new BrainAgent({
    runtime,
    prepareTurn: () => ({ prompt: "instructions", layers: {} }),
    actions: { perform: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED }) },
    roster: () => ({ text: "none", identities: [] }),
    standingContext: () => "",
    readTranscriptSince: async () => ({ status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: "n" }),
    readTranscript: async () => ({ status: ACTION_RESULT_STATUS.UNSUPPORTED, reason: "n" }),
    deliver: () => undefined,
    store,
    createRunId: () => `run-${++ids}`,
    report: (message) => {
      reports.push(message);
    },
    clock: {
      now: () => NOW,
      schedule: (_delayMs, run) => {
        const immediate = setImmediate(run);
        return toDisposable(() => clearImmediate(immediate));
      },
    },
  });
  return { agent, store, reports };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

test("a turn's inputs travel into the transcript with the checkpoint, and optional maintenance compacts once the reply is persisted", async () => {
  const repository = fakeBrainStateRepository();
  let compacted = 0;
  const model = adapter({
    respond: async () => {
      const answer = responsesModelAnswer({
        output: [assistant("reply")],
        // The usage says the window is nearly spent, so maintenance follows the turn.
        usage: { input_tokens: 395_000 },
      });
      assert.ok(answer);
      return answer;
    },
    compact: async (items) => {
      compacted += 1;
      return {
        outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
        items: [
          {
            type: RESPONSES_INPUT_ITEM_TYPE.COMPACTION,
            encrypted_content: `folded ${items.length}`,
          },
        ],
      };
    },
  });
  const { agent } = agentOver(model, repository);
  const accepted = await agent.submitAsk({
    submissionId: "s1",
    question: "hello",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await settle();
  const record = agent.requests()[0];
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(compacted, 1);
  const kinds = repository.transcripts.flat().map((event) => event.kind);
  assert.deepEqual(kinds, [
    TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    TRANSCRIPT_EVENT_KIND.COMPACTION,
  ]);
  assert.deepEqual(repository.state?.items, [
    { type: RESPONSES_INPUT_ITEM_TYPE.COMPACTION, encrypted_content: "folded 2" },
  ]);
  await agent.stop();
});

test("a required compaction that fails ends the run recoverably and leaves the context exactly as it was", async () => {
  let responded = 0;
  const model = adapter({
    capabilities: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        checkpoint: CHECKPOINT,
        countsInputTokens: false,
        compacts: true,
        maximumOutputTokens: 16_000,
        contextWindowTokens: 400_000,
        // A transport bound the standing context already crosses at 75%.
        maximumRequestBytes: 400,
      },
    }),
    respond: async () => {
      responded += 1;
      const answer = responsesModelAnswer({ output: [assistant("reply")] });
      assert.ok(answer);
      return answer;
    },
  });
  // A generation whose checkpoint is already past the bound.
  const planted: BrainPersistedState = {
    version: 2,
    generationId: "gen-0",
    createdAt: NOW,
    expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
    items: [userMessageItem("x".repeat(500))],
    compactionCount: 0,
    cursors: {},
    captureCursors: {},
    inbox: [],
    requests: [],
    journal: [],
  };
  const repository = fakeBrainStateRepository(planted);
  const before = planted.items;
  const { agent } = agentOver(model, repository);
  const accepted = await agent.submitAsk({
    submissionId: "s1",
    question: "hello",
    origin: BRAIN_REQUEST_ORIGIN.TYPED,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await settle();
  const record = agent.requests()[0];
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.FAILED);
  assert.equal(record?.failure, BRAIN_REQUEST_FAILURE.COMPACTION);
  // Nothing was sent, nothing was cut, and the stored checkpoint is untouched.
  assert.equal(responded, 0);
  assert.deepEqual(repository.state?.items, before);
  assert.deepEqual(repository.transcripts, []);
  await agent.stop();
});
