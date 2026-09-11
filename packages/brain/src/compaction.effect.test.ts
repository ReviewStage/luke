import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelCapabilities,
} from "@sidecar/runtime/vocabulary";
import { Effect } from "effect";
import { CompactionDeclined, compactContextEffect } from "./compaction.effect.js";
import { ResponsesContextEngine } from "./context-engine.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";
import { assistantMessageItem, responsesModelAnswer } from "./responses-api.js";

const RUNTIME_IDENTITY = { id: "tool-loop", version: 1 };

const CAPABILITIES: ModelCapabilities = {
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
};

function adapter(overrides: Partial<ModelAdapter> = {}): ModelAdapter {
  return {
    capabilities: async () => ({
      outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
      capabilities: CAPABILITIES,
    }),
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

/** An ask small enough to fold, followed by one so large it fills the recent-tail budget on its own. */
function engineNeedingFold(): ResponsesContextEngine {
  const engine = new ResponsesContextEngine(RUNTIME_IDENTITY);
  engine.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
  engine.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "a" });
  engine.ingest({ kind: CONTEXT_INPUT_KIND.USER_TEXT, text: "b".repeat(100_000) });
  return engine;
}

const request = { prompt: "p", signal: new AbortController().signal, capabilities: CAPABILITIES };

describe("compactContextEffect", () => {
  it.effect("succeeds with the folded outcome when the model answers", () =>
    Effect.gen(function* () {
      const engine = engineNeedingFold();
      const model = adapter({
        respond: async () => {
          const answer = responsesModelAnswer({ output: [assistantMessageItem("folded words")] });
          assert.ok(answer);
          return answer;
        },
      });
      const folded = yield* compactContextEffect(engine, model, request);

      assert.equal(folded.compacted, true);
      assert.equal(folded.source, COMPACTION_SOURCE.LOCAL_SUMMARY);
      assert.equal(folded.dropped, 1);
    }),
  );

  it.effect("fails with the port's own reason when there is nothing to compact", () =>
    Effect.gen(function* () {
      const engine = new ResponsesContextEngine(RUNTIME_IDENTITY);
      engine.bootstrap(undefined, UNKNOWN_ACTION_RESULT);
      const refusal = yield* Effect.flip(compactContextEffect(engine, adapter(), request));

      assert.ok(refusal instanceof CompactionDeclined);
      assert.equal(refusal.reason, "nothing to compact");
    }),
  );

  it.effect("fails naming the model's own failure when the summary is refused", () =>
    Effect.gen(function* () {
      const engine = engineNeedingFold();
      const refusal = yield* Effect.flip(compactContextEffect(engine, adapter(), request));

      assert.equal(refusal.reason, "upstream: not asked");
    }),
  );
});
