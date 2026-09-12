import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { notebookMemoryProvider } from "@sidecar/memory";
import { TOOL_EFFECT } from "@sidecar/runtime";
import {
  DEFAULT_AGENT_ID,
  MAIN_SESSION_KEY,
  MEMORY_SCOPE_KIND,
  type MemoryDefinition,
  type MemoryProvider,
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
  REASONING_EFFORT,
} from "@sidecar/runtime/vocabulary";
import type { SessionIdentity } from "@sidecar/session";
import { ACTION_RESULT_STATUS, RECORD_EXTRA_KEYS, s, type WireRecord } from "@sidecar/wire";
import { Effect, TestClock } from "effect";
import { ambientTimers } from "./effect/harness.js";
import {
  ABC,
  answered,
  CHECKPOINT,
  call,
  DEF,
  failedAnswer,
  message,
  NOW,
  session,
  settle,
} from "./harness.js";
import {
  type BrainAnticipation,
  type BrainAnticipationFacts,
  PREFETCH_BOUNDS,
  PREFETCH_PLANNER_PROMPT,
  PREFETCH_SUMMARY_PROMPT,
  ReadPrefetch,
} from "./read-prefetch.js";
import { BRAIN_TOOL } from "./tools/names.js";
import { PLAN_READS_TOOL_NAME, PREFETCH_READ_KIND } from "./tools/prefetch-tool.js";
import { brainToolCatalog, planReadsToolSchema, resolveTurnToolPolicy } from "./tools.js";
import {
  BRAIN_PREFETCH_OUTCOME,
  BRAIN_PREFETCH_TAKE,
  type BrainPrefetchTraceRecord,
} from "./trace.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

/** A model whose every answer the test releases by hand, so nothing here resolves on time. */
class DeferredModel implements ModelAdapter {
  readonly model = "fake-small";
  readonly requests: { input: readonly WireRecord[]; options: ModelRequestOptions }[] = [];
  readonly #pending: ((answer: ModelResponse) => void)[] = [];

  capabilities() {
    return Promise.resolve({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        model: this.model,
        checkpoint: CHECKPOINT,
        countsInputTokens: false,
        maximumOutputTokens: 600,
      },
    } as const);
  }

  respond(input: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse> {
    this.requests.push({ input, options });
    return new Promise((resolve) => {
      this.#pending.push(resolve);
    });
  }

  countInputTokens(): Promise<never> {
    return Promise.reject(new Error("not counted"));
  }

  quietUntil(): number | undefined {
    return undefined;
  }

  /** Releases the oldest request still waiting with the answer given. */
  answer(answer: ModelResponse): void {
    const resolve = this.#pending.shift();
    assert.ok(resolve, "a request is waiting");
    resolve(answer);
  }

  get waiting(): number {
    return this.#pending.length;
  }
}

const ASK_POLICY = resolveTurnToolPolicy(brainToolCatalog(), {}, BRAIN_TURN_TRIGGER.ASK);

const NO_TRANSCRIPT_POLICY = resolveTurnToolPolicy(
  brainToolCatalog(),
  { agent: { deny: [BRAIN_TOOL.READ_TRANSCRIPT] } },
  BRAIN_TURN_TRIGGER.ASK,
);

function plan(...reads: readonly WireRecord[]): ModelResponse {
  return answered([call("plan_1", PLAN_READS_TOOL_NAME, { reads })]);
}

const TRANSCRIPT_OF_ABC = { kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 1 };
const MEMORY_SEARCH = { kind: PREFETCH_READ_KIND.MEMORY, query: "release plan" };

function anticipation(partialAsk: string, id = "1"): BrainAnticipation {
  return { id, partialAsk, recentTurns: `Developer: ${partialAsk}` };
}

/** A notebook whose search answers, standing in for an index that holds something. */
function answeringMemory(searches: WireRecord[]): MemoryDefinition {
  const scope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: DEFAULT_AGENT_ID };
  const provider: MemoryProvider = {
    recall: async () => ({ messages: [] }),
    tools: [
      {
        name: PREFETCH_READ_KIND.MEMORY,
        description: "search",
        inputSchema: s.record({}, { extraKeys: RECORD_EXTRA_KEYS.IGNORE }),
        effect: TOOL_EFFECT.READ,
        execute: async (input) => {
          searches.push(input);
          return { status: ACTION_RESULT_STATUS.ACCEPTED, results: [] };
        },
      },
    ],
  };
  return { scope, provider };
}

function emptyNotebook(): MemoryDefinition {
  const scope = { kind: MEMORY_SCOPE_KIND.ACCOUNT, key: DEFAULT_AGENT_ID };
  return {
    scope,
    provider: notebookMemoryProvider({
      scope,
      access: undefined,
      facts: () => [],
      recentNotes: async () => [],
    }),
  };
}

interface Rig {
  prefetch: ReadPrefetch;
  model: DeferredModel;
  transcriptReads: SessionIdentity[];
  searches: WireRecord[];
  facts: BrainAnticipationFacts[];
  traces: BrainPrefetchTraceRecord[];
  transcriptStatus: { value: string };
}

const rig = (options: { memory?: MemoryDefinition; listen?: boolean } = {}): Effect.Effect<Rig> =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW);
    const timers = yield* ambientTimers;
    const model = new DeferredModel();
    const transcriptReads: SessionIdentity[] = [];
    const searches: WireRecord[] = [];
    const facts: BrainAnticipationFacts[] = [];
    const traces: BrainPrefetchTraceRecord[] = [];
    const transcriptStatus: Rig["transcriptStatus"] = { value: ACTION_RESULT_STATUS.ACCEPTED };
    let ids = 0;
    const prefetch = new ReadPrefetch(
      {
        model,
        conversationId: MAIN_SESSION_KEY,
        roster: () => ({
          text: "Currently observed sessions:\n- abc\n- def",
          identities: [ABC, DEF],
          sessions: [session(ABC.providerSessionId), session(DEF.providerSessionId)],
        }),
        readTranscript: async (identity) => {
          transcriptReads.push(identity);
          return transcriptStatus.value === ACTION_RESULT_STATUS.ACCEPTED
            ? { status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "whole", truncated: false }
            : { status: transcriptStatus.value, reason: "no read" };
        },
        memory: options.memory ?? answeringMemory(searches),
        now: timers.now,
        schedule: timers.schedule,
        cancel: timers.cancel,
        createId: () => `id-${++ids}`,
        report: () => undefined,
        trace: (record) => traces.push(record),
      },
      planReadsToolSchema(),
    );
    if (options.listen !== false) prefetch.onFacts((heard) => facts.push(heard));
    return { prefetch, model, transcriptReads, searches, facts, traces, transcriptStatus };
  });

const drained = Effect.promise(() => settle());

it.effect("a take with nothing anticipated is a miss, and reads nothing", () =>
  Effect.gen(function* () {
    const r = yield* rig();
    const taken = yield* Effect.promise(() =>
      r.prefetch.take(ASK_POLICY, new AbortController().signal),
    );
    assert.deepEqual(taken, { take: BRAIN_PREFETCH_TAKE.MISS_NONE, reads: [], waitedMs: 0 });
    assert.equal(r.model.requests.length, 0);
  }),
);

it.effect(
  "an anticipation asks the planner once, forced onto its one tool at low effort with no cache key, runs the reads it named, and a take hands them over as the calls they stand for",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      assert.equal(r.model.requests.length, 1);
      const planner = r.model.requests[0];
      assert.ok(planner);
      assert.equal(planner.options.prompt, PREFETCH_PLANNER_PROMPT);
      assert.equal(planner.options.toolChoice, PLAN_READS_TOOL_NAME);
      assert.deepEqual(
        planner.options.tools.map((tool) => tool.name),
        [PLAN_READS_TOOL_NAME],
      );
      assert.equal(planner.options.reasoningEffort, REASONING_EFFORT.LOW);
      assert.equal(planner.options.maximumOutputTokens, PREFETCH_BOUNDS.PLAN_OUTPUT_TOKENS);
      assert.equal(planner.options.promptCacheKey, undefined);
      assert.equal(planner.input.length, 1);
      r.model.answer(plan(TRANSCRIPT_OF_ABC, MEMORY_SEARCH));
      yield* drained;
      assert.deepEqual(r.transcriptReads, [ABC]);
      assert.equal(r.searches.length, 1);
      assert.equal(r.searches[0]?.query, MEMORY_SEARCH.query);
      assert.equal(r.searches[0]?.max_results, PREFETCH_BOUNDS.MEMORY_RESULTS);
      const taken = yield* Effect.promise(() =>
        r.prefetch.take(ASK_POLICY, new AbortController().signal),
      );
      assert.equal(taken.take, BRAIN_PREFETCH_TAKE.HIT);
      assert.deepEqual(
        taken.reads.map((read) => read.name),
        [BRAIN_TOOL.READ_TRANSCRIPT, PREFETCH_READ_KIND.MEMORY],
      );
      const transcript = taken.reads[0];
      assert.ok(transcript);
      assert.deepEqual(JSON.parse(transcript.argumentsJson), {
        provider_id: ABC.providerId,
        provider_session_id: ABC.providerSessionId,
      });
      assert.equal(JSON.parse(transcript.outputJson).status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.equal(transcript.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.equal(new Set(taken.reads.map((read) => read.callId)).size, 2);
      // The slot is spent: a second take finds nothing.
      const again = yield* Effect.promise(() =>
        r.prefetch.take(ASK_POLICY, new AbortController().signal),
      );
      assert.equal(again.take, BRAIN_PREFETCH_TAKE.MISS_NONE);
      assert.deepEqual(
        r.traces.filter((trace) => trace.outcome !== undefined).map((trace) => trace.outcome),
        [BRAIN_PREFETCH_OUTCOME.PLANNED],
      );
      assert.equal(r.traces.find((trace) => trace.outcome !== undefined)?.reads, 2);
    }),
);

it.effect(
  "once the reads are ready the summary runs tool-free within its budget and reaches the listener under the anticipation's key; no listener, no summary call",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is abc doing", "row-4"));
      yield* drained;
      r.model.answer(plan(TRANSCRIPT_OF_ABC));
      yield* drained;
      assert.equal(r.model.requests.length, 2);
      const summary = r.model.requests[1];
      assert.ok(summary);
      assert.equal(summary.options.prompt, PREFETCH_SUMMARY_PROMPT);
      assert.deepEqual(summary.options.tools, []);
      assert.equal(summary.options.toolChoice, undefined);
      assert.equal(summary.options.maximumOutputTokens, PREFETCH_BOUNDS.SUMMARY_TOKENS);
      assert.equal(summary.input.length, 1);
      r.model.answer(answered([message("abc finished the tests.")]));
      yield* drained;
      assert.deepEqual(r.facts, [{ id: "row-4", text: "abc finished the tests." }]);
      assert.equal(r.traces.filter((trace) => trace.summaryChars !== undefined).length, 1);

      const silent = yield* rig({ listen: false });
      silent.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      silent.model.answer(plan(TRANSCRIPT_OF_ABC));
      yield* drained;
      assert.equal(silent.model.requests.length, 1);
    }),
);

it.effect(
  "a take during planning waits, and reads that finish inside the wait are handed over as a waited hit",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      const taking = r.prefetch.take(ASK_POLICY, new AbortController().signal);
      yield* TestClock.adjust(PREFETCH_BOUNDS.TAKE_WAIT_MS - 1);
      r.model.answer(plan(TRANSCRIPT_OF_ABC));
      yield* drained;
      const taken = yield* Effect.promise(() => taking);
      assert.equal(taken.take, BRAIN_PREFETCH_TAKE.HIT_WAITED);
      assert.equal(taken.reads.length, 1);
      assert.equal(taken.waitedMs, PREFETCH_BOUNDS.TAKE_WAIT_MS - 1);
    }),
);

it.effect(
  "a take that outlasts its wait abandons the slot: the planner's request is aborted, nothing is handed over, and nothing of it is spent later",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      const taking = r.prefetch.take(ASK_POLICY, new AbortController().signal);
      yield* TestClock.adjust(PREFETCH_BOUNDS.TAKE_WAIT_MS);
      const taken = yield* Effect.promise(() => taking);
      assert.equal(taken.take, BRAIN_PREFETCH_TAKE.MISS_TIMEOUT);
      assert.equal(r.model.requests[0]?.options.signal?.aborted, true);
      r.model.answer(plan(TRANSCRIPT_OF_ABC));
      yield* drained;
      assert.deepEqual(r.transcriptReads, []);
      assert.equal(r.model.requests.length, 1);
    }),
);

it.effect("a ready slot older than its life is an expired miss", () =>
  Effect.gen(function* () {
    const r = yield* rig();
    r.prefetch.anticipate(anticipation("what is abc doing"));
    yield* drained;
    r.model.answer(plan(TRANSCRIPT_OF_ABC));
    yield* drained;
    yield* TestClock.adjust(PREFETCH_BOUNDS.TTL_MS + 1);
    const taken = yield* Effect.promise(() =>
      r.prefetch.take(ASK_POLICY, new AbortController().signal),
    );
    assert.equal(taken.take, BRAIN_PREFETCH_TAKE.MISS_EXPIRED);
    assert.deepEqual(taken.reads, []);
  }),
);

it.effect("a take under a signal already fired, or fired while it waits, is a revoked miss", () =>
  Effect.gen(function* () {
    const r = yield* rig();
    r.prefetch.anticipate(anticipation("what is abc doing"));
    yield* drained;
    const fired = new AbortController();
    fired.abort();
    const atOnce = yield* Effect.promise(() => r.prefetch.take(ASK_POLICY, fired.signal));
    assert.equal(atOnce.take, BRAIN_PREFETCH_TAKE.MISS_REVOKED);
    const later = new AbortController();
    const taking = r.prefetch.take(ASK_POLICY, later.signal);
    later.abort();
    const revoked = yield* Effect.promise(() => taking);
    assert.equal(revoked.take, BRAIN_PREFETCH_TAKE.MISS_REVOKED);
    // The slot stands for the turn that follows.
    r.model.answer(plan(TRANSCRIPT_OF_ABC));
    yield* drained;
    const taken = yield* Effect.promise(() =>
      r.prefetch.take(ASK_POLICY, new AbortController().signal),
    );
    assert.equal(taken.take, BRAIN_PREFETCH_TAKE.HIT);
  }),
);

it.effect(
  "more words supersede the plan under way, whose request is aborted while its read finishes into the memo, so a re-plan naming the same transcript reads it once; the same words plan nothing new",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is"));
      yield* drained;
      r.model.answer(plan(TRANSCRIPT_OF_ABC));
      yield* drained;
      assert.deepEqual(r.transcriptReads, [ABC]);
      // The summary of the first plan is still waiting; more words supersede the slot before it lands.
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      assert.equal(r.model.requests[1]?.options.signal?.aborted, true);
      r.model.answer(answered([message("stale summary")]));
      yield* drained;
      assert.deepEqual(r.facts, []);
      const replanned = r.model.requests[2];
      assert.ok(replanned);
      assert.equal(replanned.options.signal?.aborted, false);
      r.model.answer(plan(TRANSCRIPT_OF_ABC));
      yield* drained;
      assert.deepEqual(r.transcriptReads, [ABC]);
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      assert.equal(r.model.requests.length, 4);
      const taken = yield* Effect.promise(() =>
        r.prefetch.take(ASK_POLICY, new AbortController().signal),
      );
      assert.equal(taken.take, BRAIN_PREFETCH_TAKE.HIT);
      assert.equal(taken.reads.length, 1);
    }),
);

it.effect(
  "a read the turn's policy does not offer is dropped at the take, and a read that answered a refusal is never held at all",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      r.model.answer(plan(TRANSCRIPT_OF_ABC, MEMORY_SEARCH));
      yield* drained;
      const taken = yield* Effect.promise(() =>
        r.prefetch.take(NO_TRANSCRIPT_POLICY, new AbortController().signal),
      );
      assert.equal(taken.take, BRAIN_PREFETCH_TAKE.HIT);
      assert.deepEqual(
        taken.reads.map((read) => read.name),
        [PREFETCH_READ_KIND.MEMORY],
      );

      const refused = yield* rig({ memory: emptyNotebook() });
      refused.transcriptStatus.value = ACTION_RESULT_STATUS.REJECTED;
      refused.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      refused.model.answer(plan(TRANSCRIPT_OF_ABC, MEMORY_SEARCH));
      yield* drained;
      const empty = yield* Effect.promise(() =>
        refused.prefetch.take(ASK_POLICY, new AbortController().signal),
      );
      assert.equal(empty.take, BRAIN_PREFETCH_TAKE.HIT);
      assert.deepEqual(empty.reads, []);
      // Nothing to summarize: no second call.
      assert.equal(refused.model.requests.length, 1);
    }),
);

it.effect(
  "a planner that fails, answers no plan, or names a session past the roster plans nothing; a transport that does not offer the prefetch stands the planner down for good",
  () =>
    Effect.gen(function* () {
      const r = yield* rig();
      r.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      r.model.answer(failedAnswer("upstream"));
      yield* drained;
      const failed = yield* Effect.promise(() =>
        r.prefetch.take(ASK_POLICY, new AbortController().signal),
      );
      assert.equal(failed.take, BRAIN_PREFETCH_TAKE.MISS_NONE);
      r.prefetch.anticipate(anticipation("what is def doing"));
      yield* drained;
      r.model.answer(answered([message("no call")]));
      yield* drained;
      r.prefetch.anticipate(anticipation("what is ghi doing"));
      yield* drained;
      r.model.answer(plan({ kind: PREFETCH_READ_KIND.TRANSCRIPT, session: 3 }));
      yield* drained;
      assert.deepEqual(r.transcriptReads, []);
      assert.deepEqual(
        r.traces.filter((trace) => trace.outcome !== undefined).map((trace) => trace.outcome),
        [
          BRAIN_PREFETCH_OUTCOME.FAILED,
          BRAIN_PREFETCH_OUTCOME.FAILED,
          BRAIN_PREFETCH_OUTCOME.FAILED,
        ],
      );

      const unavailable = yield* rig();
      unavailable.prefetch.anticipate(anticipation("what is abc doing"));
      yield* drained;
      unavailable.model.answer({
        outcome: MODEL_RESPONSE_OUTCOME.FAILED,
        failure: MODEL_FAILURE.COMPATIBILITY,
        reason: "no prefetch",
      });
      yield* drained;
      unavailable.prefetch.anticipate(anticipation("what is def doing"));
      yield* drained;
      assert.equal(unavailable.model.requests.length, 1);
      assert.deepEqual(
        unavailable.traces.map((trace) => trace.outcome),
        [BRAIN_PREFETCH_OUTCOME.UNAVAILABLE],
      );
    }),
);

it.effect("a drop abandons the plan under way and its reads, and forgets what was held", () =>
  Effect.gen(function* () {
    const r = yield* rig();
    r.prefetch.anticipate(anticipation("what is abc doing"));
    yield* drained;
    r.prefetch.drop();
    assert.equal(r.model.requests[0]?.options.signal?.aborted, true);
    const taken = yield* Effect.promise(() =>
      r.prefetch.take(ASK_POLICY, new AbortController().signal),
    );
    assert.equal(taken.take, BRAIN_PREFETCH_TAKE.MISS_NONE);
    r.prefetch.anticipate(anticipation("what is abc doing"));
    yield* drained;
    r.model.answer(plan(TRANSCRIPT_OF_ABC));
    yield* drained;
    r.prefetch.drop();
    const dropped = yield* Effect.promise(() =>
      r.prefetch.take(ASK_POLICY, new AbortController().signal),
    );
    assert.equal(dropped.take, BRAIN_PREFETCH_TAKE.MISS_NONE);
  }),
);
