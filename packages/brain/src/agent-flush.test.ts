import assert from "node:assert/strict";
import { RESPONSES_INPUT_ITEM_TYPE } from "@sidecar/hosted";
import {
  MEMORY_FLUSH_DEFAULTS,
  MEMORY_HOUSEKEEPING_OUTCOME,
  type MemoryHousekeepingResult,
} from "@sidecar/memory";
import { RESPONSES_ITEM_FORMAT, TOOL_LOOP_RUNTIME } from "@sidecar/runtime";
import {
  MAIN_SESSION_KEY,
  MEMORY_CAPTURE_PHASE,
  MEMORY_SCOPE_KIND,
  type MemoryCaptureTurn,
  type MemoryScope,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
  promiseAgentRuntime,
} from "@sidecar/runtime/vocabulary";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { test } from "vitest";
import { BrainAgent, type BrainFlushMarkerStore, LOOK_SUBJECT } from "./agent.js";
import { ResponsesContextEngine } from "./context-engine.js";
import {
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_SUBMISSION_OUTCOME,
} from "./requests.js";
import { type ResponsesInputItem, responsesModelAnswer } from "./responses-api.js";
import { ToolLoopAgentRuntime } from "./runtime.js";
import { BrainStateStore } from "./state-store.js";
import {
  type FakeBrainStateRepository,
  fakeActionPerformer,
  fakeBrainStateRepository,
} from "./testing.js";

/**
 * The flush before compaction, at the host: a small window makes the soft
 * margin reachable, so a turn that leaves the context over the flush
 * threshold runs the hook in maintenance, once per cycle, over a copy of the
 * items and never the engine.
 */

const IDENTITY = { id: TOOL_LOOP_RUNTIME.ID, version: TOOL_LOOP_RUNTIME.VERSION };
const NOW = 1_800_000_000_000;
const SCOPE: MemoryScope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: "main" };
/** Reserve is a quarter of this, 500; compaction at 1,500 tokens; the flush at 750; a fold keeps the reserve's worth of tail. */
const WINDOW_TOKENS = 2_000;

function message(text: string): WireRecord {
  return {
    type: RESPONSES_INPUT_ITEM_TYPE.MESSAGE,
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

/** The adapter over the fake model, whose one answer also serves as every fold's summary. */
function adapterOf(model: FakeModel): ModelAdapter {
  return {
    capabilities: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        checkpoint: {
          runtime: TOOL_LOOP_RUNTIME.ID,
          runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
          format: RESPONSES_ITEM_FORMAT.format,
          formatVersion: RESPONSES_ITEM_FORMAT.version,
        },
        contextWindowTokens: WINDOW_TOKENS,
        countsInputTokens: false,
        maximumOutputTokens: 16_000,
      },
    }),
    respond: (input, options) => model.respond(input, options),
    countInputTokens: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: MODEL_FAILURE.UPSTREAM,
      reason: "not counted",
    }),
    quietUntil: () => undefined,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** The flush marker as a store keeps it across launches, keyed by generation; its writes can be made to fail. */
class FakeMarkerStore implements BrainFlushMarkerStore {
  readonly markers = new Map<string, number>();
  failWrites = false;
  writes = 0;
  read(generationId: string) {
    return Promise.resolve(this.markers.get(generationId));
  }
  write(generationId: string, compactionCount: number) {
    this.writes += 1;
    if (this.failWrites) return Promise.reject(new Error("disk full"));
    this.markers.set(generationId, compactionCount);
    return Promise.resolve();
  }
}

interface Launch {
  repository?: FakeBrainStateRepository;
  marker?: FakeMarkerStore;
}

/**
 * An agent over the given repository and marker store, as one launch of the
 * app would build it; a second call over the same is a relaunch. The memory
 * provider recalls nothing and offers no tool: the capture is what is under
 * test.
 */
function agentWith(
  capture: (turn: MemoryCaptureTurn) => Promise<MemoryHousekeepingResult>,
  launch: Launch = {},
) {
  const model = new FakeModel();
  const runtime = promiseAgentRuntime(
    new ToolLoopAgentRuntime({
      model: adapterOf(model),
      itemFormat: RESPONSES_ITEM_FORMAT,
      createContext: () => new ResponsesContextEngine(IDENTITY),
    }),
  );
  let ids = 0;
  const reports: string[] = [];
  const repository = launch.repository ?? fakeBrainStateRepository();
  const store = new BrainStateStore({
    repository,
    createGenerationId: () => `gen-${Math.random().toString(36).slice(2)}`,
    now: () => NOW,
  });
  const agent = new BrainAgent({
    conversationId: MAIN_SESSION_KEY,
    runtime,
    observes: { kind: LOOK_SUBJECT.NONE },
    prepareTurn: () => ({ prompt: "flush test", layers: {} }),
    actions: fakeActionPerformer().actions,
    roster: () => ({ text: "", identities: [] }),
    standingContext: () => "",
    readTranscriptSince: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
    readTranscript: async () => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: "no" }),
    deliver: () => undefined,
    store,
    createRunId: () => `run-${ids++}`,
    report: (line) => {
      reports.push(line);
    },
    now: () => NOW,
    memory: {
      scope: SCOPE,
      provider: { recall: async () => ({ messages: [] }), capture, tools: [] },
    },
    ...(launch.marker ? { flushMarker: launch.marker } : undefined),
  });
  return { agent, model, reports, store, repository };
}

async function ask(agent: BrainAgent, question: string) {
  const accepted = await agent.submitAsk({
    submissionId: `s-${question.length}-${Math.random()}`,
    question,
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
  const record = await agent.waitAsk(runId, 60_000);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await settle();
}

test("a turn that leaves the context over the flush threshold runs the flush once, over a copy of the items, and not again in the same cycle", async () => {
  const marker = new FakeMarkerStore();
  const calls: MemoryCaptureTurn[] = [];
  const h = agentWith(
    async (input) => {
      calls.push(input);
      return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 };
    },
    { marker },
  );
  await ask(h.agent, "short");
  assert.equal(calls.length, 0, "a small context flushes nothing");
  await ask(h.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(calls.length, 1);
  const [flush] = calls;
  assert.ok(flush);
  assert.equal(flush.phase, MEMORY_CAPTURE_PHASE.COMPACTION_REQUESTED);
  assert.deepEqual(flush.scope, SCOPE);
  assert.deepEqual(flush.operation, {
    generationId: h.store.generationId(),
    compactionCount: 0,
  });
  assert.ok(flush.items.length >= 2, "the copy carries the conversation so far");
  const snapshot = await h.agent.contextSnapshot();
  assert.ok(snapshot);
  assert.notEqual(snapshot, flush.items, "a copy, never the engine's own array");
  await ask(h.agent, "another small ask");
  assert.equal(calls.length, 1, "already flushed in this compaction cycle");
  assert.equal(marker.markers.get(h.store.generationId() ?? ""), 0, "cycle zero is marked");
  await h.agent.stop();
});

test("an interrupted or failed flush is reported and runs again at the next assessment; a completed one marks the cycle", async () => {
  let outcome: MemoryHousekeepingResult = {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.INTERRUPTED,
    writes: 1,
    reason: "cancelled",
  };
  const marker = new FakeMarkerStore();
  let calls = 0;
  const h = agentWith(
    async () => {
      calls += 1;
      return outcome;
    },
    { marker },
  );
  await ask(h.agent, "y".repeat(3_000));
  assert.equal(calls, 1);
  assert.ok(
    h.reports.some((line) =>
      /Memory flush did not complete \(interrupted: cancelled\)/u.test(line),
    ),
  );
  assert.equal(marker.markers.size, 0, "an interrupted flush marks nothing");
  outcome = { outcome: MEMORY_HOUSEKEEPING_OUTCOME.NOTHING_TO_STORE, writes: 0 };
  await ask(h.agent, "again");
  assert.equal(calls, 2, "the unflushed cycle is assessed again");
  assert.equal(marker.markers.get(h.store.generationId() ?? ""), 0, "the completed flush marks it");
  await ask(h.agent, "once more");
  assert.equal(calls, 2);
  await h.agent.stop();
});

/** Around 3,400 characters of items: past the 750-token flush threshold, under the 1,500-token compaction threshold. */
const OVER_FLUSH_THRESHOLD = "x".repeat(3_000);
/** With the asks before it, past the 1,500-token compaction threshold; on its own, within the tail a fold keeps. */
const OVER_COMPACTION_THRESHOLD = "z".repeat(3_000);

test("restart: a flushed cycle is not flushed again after a relaunch, and a compaction then a relaunch flushes once in the new cycle", async () => {
  const marker = new FakeMarkerStore();
  let calls = 0;
  const hook = async () => {
    calls += 1;
    return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 };
  };
  const first = agentWith(hook, { marker });
  await ask(first.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(calls, 1);
  const generation = first.store.generationId();
  assert.ok(generation);
  assert.equal(marker.markers.get(generation), 0, "the marker names the generation and cycle zero");
  await first.agent.stop();

  // The relaunch: a new store over the same file, a new agent, the same marker table.
  const second = agentWith(hook, { repository: first.repository, marker });
  await ask(second.agent, "still over the threshold");
  assert.equal(calls, 1, "cycle zero was flushed before the relaunch");
  assert.equal(marker.markers.get(generation), 0, "the relaunch read the standing marker");
  // A turn that leaves the context over the reserve folds it in maintenance,
  // behind a summary the model writes; cycle one begins, and the folded
  // context stands over the flush threshold still.
  await ask(second.agent, OVER_COMPACTION_THRESHOLD);
  assert.equal(second.store.current()?.compactionCount, 1, "the compaction was counted");
  assert.equal(calls, 1, "cycle zero flushed once; the fold itself is not a flush");
  const folded = await second.agent.contextSnapshot();
  assert.ok(folded);
  assert.equal(folded[0]?.role, "assistant", "the summary stands first, in Luke's own voice");
  assert.equal(folded.length, 3, "the summary and the most recent exchange");
  await second.agent.stop();

  const third = agentWith(hook, { repository: first.repository, marker });
  assert.equal((await third.store.load()).compactionCount, 1, "the count rode on the envelope");
  await ask(third.agent, "a little more");
  assert.equal(calls, 2, "cycle one is flushed once, after the relaunch");
  assert.equal(marker.markers.get(generation), 1);
  await ask(third.agent, "again");
  assert.equal(calls, 2);
  await third.agent.stop();
});

test("reset: after Start fresh the new generation starts at cycle zero, reads no earlier marker, and flushes on its first due assessment", async () => {
  const marker = new FakeMarkerStore();
  let calls = 0;
  const hook = async () => {
    calls += 1;
    return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 };
  };
  const h = agentWith(hook, { marker });
  await ask(h.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(calls, 1);
  const before = h.store.generationId();
  assert.equal(await h.store.reset(), true);
  const after = h.store.generationId();
  assert.ok(after && after !== before);
  assert.equal(marker.markers.has(after), false, "the fresh generation has no marker of its own");
  await ask(h.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(
    calls,
    2,
    "the fresh generation's cycle zero is unflushed whatever the old marker said",
  );
  assert.equal(marker.markers.get(after), 0);
  assert.equal(
    marker.markers.get(before ?? ""),
    0,
    "the old lifetime's marker is untouched and unread",
  );
  await h.agent.stop();
});

test("failed persistence: a marker write that fails is reported and leaves the cycle unflushed; a housekeeping turn that failed writes no marker", async () => {
  const marker = new FakeMarkerStore();
  marker.failWrites = true;
  let outcome: MemoryHousekeepingResult = {
    outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED,
    writes: 1,
  };
  let calls = 0;
  const h = agentWith(
    async () => {
      calls += 1;
      return outcome;
    },
    { marker },
  );
  await ask(h.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(calls, 1);
  assert.equal(
    marker.writes,
    MEMORY_FLUSH_DEFAULTS.MARKER_WRITE_ATTEMPTS,
    "the write is retried a bounded number of times",
  );
  assert.ok(
    h.reports.some((line) =>
      /Memory flush completed but its marker could not be recorded after 3 attempt\(s\) \(disk full\)/u.test(
        line,
      ),
    ),
  );
  assert.equal(marker.markers.size, 0, "not marked done in the store either");
  marker.failWrites = false;
  await ask(h.agent, "next assessment");
  assert.equal(calls, 2, "the unflushed cycle is flushed again");
  assert.equal(marker.markers.get(h.store.generationId() ?? ""), 0, "the retry marked the cycle");
  await h.agent.stop();

  const failing = new FakeMarkerStore();
  outcome = { outcome: MEMORY_HOUSEKEEPING_OUTCOME.FAILED, writes: 0, reason: "upstream down" };
  const f = agentWith(async () => outcome, { marker: failing });
  await ask(f.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(failing.writes, 0, "a turn that did not run to its end writes no marker");
  assert.equal(failing.markers.size, 0);
  await f.agent.stop();
});

test("a marker write still out when the turn is revoked is waited for at the next assessment: a write that lands late marks the cycle and the hook is not rerun", async () => {
  const marker = new FakeMarkerStore();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = marker.write.bind(marker);
  marker.write = async (generationId, compactionCount) => {
    await gate;
    return write(generationId, compactionCount);
  };
  let calls = 0;
  const h = agentWith(
    async () => {
      calls += 1;
      return { outcome: MEMORY_HOUSEKEEPING_OUTCOME.COMPLETED, writes: 1 };
    },
    { marker },
  );
  await ask(h.agent, OVER_FLUSH_THRESHOLD);
  assert.equal(calls, 1, "the flush ran in maintenance");
  assert.equal(marker.markers.size, 0, "its marker write is still out");
  // A new ask revokes the maintenance holding the write; the write lands only afterwards.
  const accepted = await h.agent.submitAsk({
    submissionId: "after-revoke",
    question: "still over the threshold",
    origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
  });
  assert.equal(accepted.outcome, BRAIN_SUBMISSION_OUTCOME.ACCEPTED);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(release);
  release();
  const runId = accepted.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED ? accepted.runId : "";
  const record = await h.agent.waitAsk(runId, 60_000);
  assert.equal(record?.status, BRAIN_REQUEST_STATUS.SUCCEEDED);
  await settle();
  const generation = h.store.generationId();
  assert.ok(generation);
  assert.equal(marker.markers.get(generation), 0, "the late write landed under the generation");
  assert.equal(marker.writes, 1, "the write was issued once and never retried");
  assert.equal(calls, 1, "the flushed cycle is not run again");
  await ask(h.agent, "another");
  assert.equal(calls, 1);
  await h.agent.stop();
});
