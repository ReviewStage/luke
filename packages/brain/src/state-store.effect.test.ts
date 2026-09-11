import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { RESPONSES_ITEM_FORMAT } from "@sidecar/runtime";
import { MODEL_RESPONSE_OUTCOME, type ModelAdapter } from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { ResponsesContextEngine } from "./context-engine.js";
import { CONTEXT_OPENING, type Generation, generationFrom } from "./generation.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import { BRAIN_REQUEST_ORIGIN, BRAIN_REQUEST_STATUS } from "./requests.js";
import { ToolLoopAgentRuntime } from "./runtime.js";
import {
  BrainStateWriteRefused,
  clearBrainState,
  flushBrainState,
  loadBrainState,
  replaceBrainState,
  resetBrainState,
  saveCaptureState,
  saveRecordState,
  saveWholeState,
  saveWorkingState,
  writeBrainState,
} from "./state-store.effect.js";
import { BrainStateStore } from "./state-store.js";
import { fakeBrainStateRepository } from "./testing.js";
import type { RecordingContextEngine } from "./transcript-recorder.js";

const NOW = 1_800_000_000_000;
const RUNTIME_IDENTITY = { id: "tool-loop", version: 1 };

function openStore(repository = fakeBrainStateRepository()) {
  let ids = 0;
  const store = new BrainStateStore({
    repository,
    createGenerationId: () => `gen-${++ids}`,
    now: () => NOW,
  });
  return { store, repository };
}

function fakeModel(): ModelAdapter {
  return {
    capabilities: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: {
        adapter: "fake",
        checkpoint: {
          runtime: RUNTIME_IDENTITY.id,
          runtimeVersion: RUNTIME_IDENTITY.version,
          format: "openai-responses-input",
          formatVersion: 1,
        },
        countsInputTokens: false,
        maximumOutputTokens: 16_000,
        contextWindowTokens: 400_000,
      },
    }),
    respond: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: "upstream",
      reason: "n",
    }),
    countInputTokens: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.FAILED,
      failure: "upstream",
      reason: "n",
    }),
    quietUntil: () => undefined,
  };
}

/** A generation opened over a freshly loaded state, with the context its opening claimed. */
async function openGeneration(
  store: BrainStateStore,
): Promise<{ generation: Generation; context: RecordingContextEngine }> {
  const state = await store.load();
  const runtime = new ToolLoopAgentRuntime({
    model: fakeModel(),
    itemFormat: RESPONSES_ITEM_FORMAT,
    createContext: () => new ResponsesContextEngine(RUNTIME_IDENTITY),
  });
  const generation = generationFrom(state, runtime, UNKNOWN_ACTION_RESULT, () => NOW);
  const opened = await generation.opened;
  assert.equal(opened.kind, CONTEXT_OPENING.LOADED);
  if (opened.kind !== CONTEXT_OPENING.LOADED) throw new Error("unreachable");
  return { generation, context: opened.context };
}

describe("loadBrainState", () => {
  it.effect("answers a fresh generation for a repository with nothing stored", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const state = yield* loadBrainState(store);

      assert.equal(state.items.length, 0);
      assert.ok(state.generationId);
    }),
  );
});

describe("writeBrainState", () => {
  it.effect("succeeds when the generation named is the one that stands", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const state = yield* loadBrainState(store);
      const lease = store.lease();

      yield* writeBrainState(store, lease, state.generationId, (mutable) => mutable);

      assert.equal(store.current()?.generationId, state.generationId);
    }),
  );

  it.effect("fails naming the generation when it no longer stands", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const state = yield* loadBrainState(store);
      const lease = store.lease();
      yield* Effect.promise(() => store.clear());

      const refusal = yield* Effect.flip(
        writeBrainState(store, lease, state.generationId, (mutable) => mutable),
      );

      assert.ok(refusal instanceof BrainStateWriteRefused);
      assert.equal(refusal.generationId, state.generationId);
    }),
  );
});

describe("replaceBrainState", () => {
  it.effect("fails naming the replacement's own generation when storage refuses it", () =>
    Effect.gen(function* () {
      const repository = fakeBrainStateRepository();
      const { store } = openStore(repository);
      const state = yield* loadBrainState(store);
      repository.refuse();

      const refusal = yield* Effect.flip(replaceBrainState(store, state));

      assert.equal(refusal.generationId, state.generationId);
    }),
  );

  it.effect("succeeds once storage accepts the replacement", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const state = yield* loadBrainState(store);

      yield* replaceBrainState(store, state);

      assert.equal(store.current()?.generationId, state.generationId);
    }),
  );
});

describe("clearBrainState and resetBrainState", () => {
  it.effect("names the successor's own generation, never the one it replaced, on a refusal", () =>
    Effect.gen(function* () {
      const repository = fakeBrainStateRepository();
      const { store } = openStore(repository);
      const before = yield* loadBrainState(store);
      repository.refuse();

      const refusal = yield* Effect.flip(clearBrainState(store));

      assert.notEqual(refusal.generationId, before.generationId);
      assert.equal(refusal.generationId, store.current()?.generationId);
    }),
  );

  it.effect("succeeds once storage accepts the reset", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      yield* loadBrainState(store);

      yield* resetBrainState(store);

      assert.ok(store.current());
    }),
  );
});

describe("saveWorkingState, saveRecordState, saveWholeState, and saveCaptureState", () => {
  it.effect("saveWorkingState succeeds and carries the checkpoint into the store", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const { generation, context } = yield* Effect.promise(() => openGeneration(store));
      const lease = store.lease();

      const result = yield* saveWorkingState(store, lease, generation, { context });

      assert.equal(result.saved, true);
      assert.equal(store.current()?.generationId, generation.id);
    }),
  );

  it.effect("saveWorkingState fails naming the generation once it no longer stands", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const { generation, context } = yield* Effect.promise(() => openGeneration(store));
      const lease = store.lease();
      yield* Effect.promise(() => store.clear());

      const refusal = yield* Effect.flip(saveWorkingState(store, lease, generation, { context }));

      assert.ok(refusal instanceof BrainStateWriteRefused);
      assert.equal(refusal.generationId, generation.id);
    }),
  );

  it.effect("saveRecordState succeeds staging fields onto a record the store already holds", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const { generation } = yield* Effect.promise(() => openGeneration(store));
      const lease = store.lease();

      const result = yield* saveRecordState(store, lease, generation, {
        runId: "run-1",
        changes: {},
        insert: {
          runId: "run-1",
          submissionId: "submission-1",
          origin: BRAIN_REQUEST_ORIGIN.SPOKEN,
          question: "hello",
          status: BRAIN_REQUEST_STATUS.QUEUED,
          revision: 0,
          acceptedAt: NOW,
          performedActions: 0,
          unknownActions: 0,
        },
      });

      assert.equal(result.saved, true);
    }),
  );

  it.effect("saveWholeState succeeds carrying the restore's own record list", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const { generation, context } = yield* Effect.promise(() => openGeneration(store));
      const lease = store.lease();

      const result = yield* saveWholeState(store, lease, generation, context);

      assert.equal(result.saved, true);
    }),
  );

  it.effect("saveCaptureState succeeds appending observations to the inbox", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const { generation } = yield* Effect.promise(() => openGeneration(store));
      const lease = store.lease();

      const result = yield* saveCaptureState(store, lease, generation, []);

      assert.equal(result.saved, true);
    }),
  );
});

describe("flushBrainState", () => {
  it.effect("settles once every write queued so far has landed", () =>
    Effect.gen(function* () {
      const { store } = openStore();
      const state = yield* loadBrainState(store);
      const lease = store.lease();
      void writeBrainState(store, lease, state.generationId, (mutable) => mutable);

      yield* flushBrainState(store);

      assert.equal(store.current()?.generationId, state.generationId);
    }),
  );
});
