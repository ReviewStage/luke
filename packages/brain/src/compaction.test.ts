import assert from "node:assert/strict";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import { ESTIMATED_CHARS_PER_TOKEN } from "@sidecar/memory";
import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  MAIN_SESSION_KEY,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilities,
  type ModelRequestOptions,
  type ModelResponse,
  promiseAgentRuntime,
  TRANSCRIPT_EVENT_KIND,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { test } from "vitest";
import { BrainAgent, LOOK_SUBJECT } from "./agent.js";
import {
  assessCompaction,
  COMPACTION_NEED,
  COMPACTION_POLICY,
  compactContext,
  keepRecentTokens,
  SUMMARY_MARKER,
} from "./compaction.js";
import { ResponsesContextEngine } from "./context-engine.js";
import type { BrainPersistedState } from "./envelope.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
} from "./requests.js";
import {
  assistantMessageItem,
  isUserMessageItem,
  responsesModelAnswer,
  userMessageItem,
} from "./responses-api.js";
import { BRAIN_RUN_EVENT, type BrainRunEvent } from "./run-events.js";
import { ToolLoopAgentRuntime } from "./runtime.js";
import { BrainStateStore } from "./state-store.js";
import {
  type FakeBrainStateRepository,
  fakeActionPerformer,
  fakeBrainStateRepository,
} from "./testing.js";
import { RecordingContextEngine } from "./transcript-recorder.js";

/**
 * The desktop's fold: the assessment that decides it, the cut that keeps
 * every answer whole, the summary that stands in for what went, the
 * transport admission, and how the host schedules and cancels it. Every word
 * here is synthetic.
 */

const NOW = 1_800_000_000_000;
const TOOL_LOOP_RUNTIME_IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };
const CHECKPOINT = {
  runtime: TOOL_LOOP_RUNTIME.ID,
  runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
  format: RESPONSES_ITEM_FORMAT.format,
  formatVersion: RESPONSES_ITEM_FORMAT.version,
} as const;

function reasoning(id: string): WireRecord {
  return { type: RESPONSES_INPUT_ITEM_TYPE.REASONING, id, summary: [], encrypted_content: "o" };
}
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

/**
 * The array cut into the exchanges it is made of: each begins at a user
 * message and runs to the next, so an answer's reasoning, its calls, and their
 * outputs are all inside one group. A fold that keeps groups whole is a fold
 * that parts nothing.
 */
function exchanges(items: readonly WireRecord[]): WireRecord[][] {
  const groups: WireRecord[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (isUserMessageItem(item) || !last) groups.push([item]);
    else last.push(item);
  }
  return groups;
}

/** The items' weight as the cut measures it, item by item. */
function tokensOf(items: readonly WireRecord[]): number {
  return items.reduce(
    (sum, item) => sum + Math.ceil(JSON.stringify(item).length / ESTIMATED_CHARS_PER_TOKEN),
    0,
  );
}

test("the fold keeps at most the reserve's worth of tail, and the assessment names the transport bound before the window", () => {
  assert.equal(keepRecentTokens(400_000), COMPACTION_POLICY.KEEP_RECENT_TOKENS);
  assert.equal(keepRecentTokens(2_000), 500);
  assert.equal(keepRecentTokens(undefined), COMPACTION_POLICY.KEEP_RECENT_TOKENS);
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

test("the fold cuts at a user message, so every exchange is kept whole or folded whole, and the summary stands first as an assistant message", async () => {
  const engine = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  engine.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  const items: WireRecord[] = [
    userMessageItem("first ask"),
    reasoning("rs1"),
    call("c1"),
    output("c1"),
    reasoning("rs2"),
    assistantMessageItem("a1"),
    userMessageItem("second ask"),
    reasoning("rs3"),
    call("c2"),
    output("c2"),
    assistantMessageItem("a2"),
    userMessageItem("third ask"),
    reasoning("rs4"),
    assistantMessageItem("a3 ".repeat(40)),
  ];
  for (const item of items) engine.ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: [item] });
  const recorder = new RecordingContextEngine(engine, () => NOW);
  const groups = exchanges(items);
  assert.equal(groups.length, 3);
  // A budget the last two exchanges fill exactly: the walk back reaches the
  // second exchange's opening ask, and the cut may land only there.
  let handed: readonly WireRecord[] = [];
  const dropped = await recorder.foldBehindSummary(
    async (older) => {
      handed = older;
      return `${SUMMARY_MARKER}\nsummary`;
    },
    tokensOf([...(groups[1] ?? []), ...(groups[2] ?? [])]),
  );
  assert.equal(dropped, groups[0]?.length);
  assert.deepEqual(handed, groups[0]);
  const kept = engine.checkpoint().items;
  assert.deepEqual(kept[0], assistantMessageItem(`${SUMMARY_MARKER}\nsummary`));
  assert.deepEqual(exchanges(kept.slice(1)), groups.slice(1));
  // Every call kept has its output kept, every reasoning item kept has its
  // call kept, and the folded half holds the rest: the two halves partition
  // the array by call id and reasoning id.
  const ids = (half: readonly WireRecord[]) =>
    half.map((item) => item.call_id ?? item.id).filter((id) => id !== undefined);
  assert.deepEqual(ids(handed).sort(), ["c1", "c1", "rs1", "rs2"]);
  assert.deepEqual(ids(kept).sort(), ["c2", "c2", "rs3", "rs4"]);
  const [event] = recorder.pending();
  assert.equal(event?.kind, TRANSCRIPT_EVENT_KIND.COMPACTION);
  if (event?.kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
    assert.equal(event.boundary.source, COMPACTION_SOURCE.LOCAL_SUMMARY);
    assert.equal(event.boundary.dropped, groups[0]?.length);
  }
  // A second fold cuts again at a user message: the earlier summary is
  // folded into the next one rather than stacking, and the newest exchange
  // is kept whole under a budget it fills by itself.
  const again = await engine.foldBehindSummary(
    async (older) => {
      handed = older;
      return `${SUMMARY_MARKER}\nsummary two`;
    },
    tokensOf(groups[2] ?? []),
  );
  assert.equal(again, 1 + (groups[1]?.length ?? 0));
  assert.deepEqual(handed[0], assistantMessageItem(`${SUMMARY_MARKER}\nsummary`));
  assert.deepEqual(engine.checkpoint().items.slice(1), groups[2]);
  // Nothing to fold — one exchange — folds nothing and asks no summary.
  const small = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  small.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  small.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "only" });
  assert.equal(
    await small.foldBehindSummary(async () => {
      throw new Error("must not be asked");
    }, 10),
    0,
  );
  // A summary that does not come leaves the items exactly as they were.
  const before = engine.checkpoint().items;
  assert.equal(await engine.foldBehindSummary(async () => undefined, 1), 0);
  assert.deepEqual(engine.checkpoint().items, before);
});

function adapter(overrides: Partial<ModelAdapter> = {}): ModelAdapter {
  const capabilities: ModelCapabilities = {
    adapter: "fake",
    checkpoint: CHECKPOINT,
    countsInputTokens: false,
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
    quietUntil: () => undefined,
    ...overrides,
  };
}

test("the summary is asked of the model with no tools over the older items alone, and a summary that fails or comes back empty changes nothing", async () => {
  const engine = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  engine.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  const recorder = new RecordingContextEngine(engine, () => NOW);
  // The last exchange alone fills the recent-tail budget, so the two before it fold.
  for (const text of ["a", "b", "c".repeat(100_000)]) {
    await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text });
  }
  recorder.retained(3);
  const asked: { items: readonly WireRecord[]; options: ModelRequestOptions }[] = [];
  let reply = "folded words";
  const model = adapter({
    respond: async (items, options): Promise<ModelResponse> => {
      asked.push({ items, options });
      const answer = responsesModelAnswer({ output: [assistantMessageItem(reply)] });
      assert.ok(answer);
      return answer;
    },
  });
  const request = { prompt: "p", signal: new AbortController().signal };
  const known = await model.capabilities();
  assert.ok(known.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  const folded = await compactContext(recorder, model, {
    ...request,
    capabilities: known.capabilities,
  });
  assert.deepEqual(folded, {
    compacted: true,
    source: COMPACTION_SOURCE.LOCAL_SUMMARY,
    dropped: 2,
    summary: `${SUMMARY_MARKER}\nfolded words`,
  });
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0]?.items, [userMessageItem("a"), userMessageItem("b")]);
  assert.equal(asked[0]?.options.tools.length, 0);
  assert.equal(asked[0]?.options.maximumOutputTokens, COMPACTION_POLICY.SUMMARY_OUTPUT_TOKENS);
  const kept = recorder.checkpoint().items;
  assert.deepEqual(kept[0], assistantMessageItem(`${SUMMARY_MARKER}\nfolded words`));
  assert.equal(kept.length, 2);
  const [boundary] = recorder.pending();
  assert.equal(boundary?.kind, TRANSCRIPT_EVENT_KIND.COMPACTION);
  // An empty summary, a failed one, and a context with nothing to fold each leave the window as it was.
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "d".repeat(100_000) });
  const standing = recorder.checkpoint().items;
  reply = "   ";
  const empty = await compactContext(recorder, model, {
    ...request,
    capabilities: known.capabilities,
  });
  assert.deepEqual(empty, { compacted: false, reason: "the summary came back empty" });
  assert.deepEqual(recorder.checkpoint().items, standing);
  const refused = await compactContext(recorder, adapter(), {
    ...request,
    capabilities: known.capabilities,
  });
  assert.deepEqual(refused, { compacted: false, reason: "upstream: not asked" });
  assert.deepEqual(recorder.checkpoint().items, standing);
  const bare = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  bare.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  assert.deepEqual(
    await compactContext(bare, model, { ...request, capabilities: known.capabilities }),
    { compacted: false, reason: "nothing to compact" },
  );
});

test("the recorder keeps every ingested input and fold as transcript events, rolled back with the mark and drained as checkpoints land", async () => {
  const engine = new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY);
  engine.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  const recorder = new RecordingContextEngine(engine, () => NOW);
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "ask" });
  const mark = recorder.mark();
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.MODEL_OUTPUT, items: [call("c1")] });
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.TOOL_RESULT, callId: "c1", outputJson: "{}" });
  assert.equal(recorder.pending().length, 3);
  recorder.rollback(mark);
  assert.equal(recorder.pending().length, 1);
  assert.deepEqual(engine.checkpoint().items, [userMessageItem("ask")]);
  await recorder.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "x".repeat(400) });
  assert.equal(await recorder.foldBehindSummary(async () => "summary", 10), 1);
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
  const runtime = promiseAgentRuntime(
    new ToolLoopAgentRuntime({
      model,
      itemFormat: RESPONSES_ITEM_FORMAT,
      createContext: () => new ResponsesContextEngine(TOOL_LOOP_RUNTIME_IDENTITY),
    }),
  );
  const reports: string[] = [];
  const agent = new BrainAgent({
    conversationId: MAIN_SESSION_KEY,
    runtime,
    observes: { kind: LOOK_SUBJECT.NONE },
    prepareTurn: () => ({ prompt: "instructions", layers: {} }),
    actions: fakeActionPerformer().actions,
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
    now: () => NOW,
    schedule: (callback) => {
      const handle = {};
      setImmediate(callback);
      return handle;
    },
    cancel: () => undefined,
  });
  return { agent, store, reports };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** A generation standing before the turn: an earlier exchange the fold can let go of. */
function plantedState(items: WireRecord[]): BrainPersistedState {
  return {
    version: 2,
    generationId: "gen-0",
    createdAt: NOW,
    expiresAt: NOW + 14 * 24 * 60 * 60 * 1000,
    checkpointFormat: "tool-loop@1:openai-responses-input/1",
    items,
    compactionCount: 0,
    cursors: {},
    captureCursors: {},
    inbox: [],
    requests: [],
    journal: [],
  };
}

test("a turn's inputs travel into the transcript with the checkpoint, and optional maintenance folds once the reply is persisted", async () => {
  const earlier = [userMessageItem("earlier ask"), assistantMessageItem("earlier reply")];
  const repository = fakeBrainStateRepository(plantedState(earlier));
  let summaries = 0;
  const model = adapter({
    respond: async (_items, options) => {
      const summarizing = options.tools.length === 0;
      if (summarizing) summaries += 1;
      const answer = responsesModelAnswer({
        // The reply alone fills the recent-tail budget, so the earlier exchange folds behind the summary.
        output: [assistantMessageItem(summarizing ? "what came before" : "r".repeat(100_000))],
        // The usage says the window is nearly spent, so maintenance follows the turn.
        usage: { input_tokens: 395_000 },
      });
      assert.ok(answer);
      return answer;
    },
  });
  const { agent } = agentOver(model, repository);
  const events: BrainRunEvent[] = [];
  agent.onRunEvent((event) => events.push(event));
  const accepted = await agent.submitAsk({
    submissionId: "s1",
    question: "hello",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await settle();
  const record = agent.requests()[0];
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  assert.equal(summaries, 1);
  // The maintenance fold is told to the turn that queued it, after that
  // turn's own end and its record's, in the same numbered sequence, with the
  // summary it folded behind.
  const turnEnded = events.findIndex((event) => event.kind === BRAIN_RUN_EVENT.TURN_ENDED);
  const folded = events.findIndex((event) => event.kind === BRAIN_RUN_EVENT.COMPACTION_COMPLETED);
  assert.ok(turnEnded >= 0 && folded > turnEnded);
  const fold = events[folded];
  assert.ok(fold?.kind === BRAIN_RUN_EVENT.COMPACTION_COMPLETED);
  assert.equal(fold.turnId, record?.runId);
  assert.equal(fold.sequence, events.length);
  assert.deepEqual(fold.compaction, {
    source: COMPACTION_SOURCE.LOCAL_SUMMARY,
    dropped: 2,
    summary: `${SUMMARY_MARKER}\nwhat came before`,
  });
  const kinds = repository.transcripts.flat().map((event) => event.kind);
  assert.deepEqual(kinds, [
    TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT,
    TRANSCRIPT_EVENT_KIND.COMPACTION,
  ]);
  const items = repository.state?.items ?? [];
  assert.deepEqual(items[0], assistantMessageItem(`${SUMMARY_MARKER}\nwhat came before`));
  // The summary, then the turn whole: its ask and the reply that filled the tail.
  assert.equal(items.length, 3);
  assert.deepEqual(items.slice(1).map(isUserMessageItem), [true, false]);
  assert.equal(repository.state?.compactionCount, 1);
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
        maximumOutputTokens: 16_000,
        contextWindowTokens: 400_000,
        // A transport bound the standing context already crosses at 75%.
        maximumRequestBytes: 400,
      },
    }),
    respond: async () => {
      responded += 1;
      const answer = responsesModelAnswer({ output: [assistantMessageItem("reply")] });
      assert.ok(answer);
      return answer;
    },
  });
  // A generation whose checkpoint is already past the bound, and one exchange that cannot be cut.
  const planted = plantedState([userMessageItem("x".repeat(500))]);
  const repository = fakeBrainStateRepository(planted);
  const before = planted.items;
  const { agent } = agentOver(model, repository);
  const accepted = await agent.submitAsk({
    submissionId: "s1",
    question: "hello",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
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
