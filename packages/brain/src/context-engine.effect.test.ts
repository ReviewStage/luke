import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { bootstrapEffect, CheckpointRefused } from "./context-engine.effect.js";
import { ResponsesContextEngine } from "./context-engine.js";
import { UNKNOWN_ACTION_RESULT } from "./journal.js";

const RUNTIME_IDENTITY = { id: "tool-loop", version: 1 };

describe("bootstrapEffect", () => {
  it.effect("succeeds with the repaired count for an empty checkpoint", () =>
    Effect.gen(function* () {
      const engine = new ResponsesContextEngine(RUNTIME_IDENTITY);
      const result = yield* bootstrapEffect(engine, undefined, UNKNOWN_ACTION_RESULT);

      assert.deepEqual(result, { repaired: 0 });
    }),
  );

  it.effect("fails naming the mismatched stamp when the checkpoint is another runtime's", () =>
    Effect.gen(function* () {
      const engine = new ResponsesContextEngine(RUNTIME_IDENTITY);
      const foreign = {
        format: {
          runtime: "another-runtime",
          runtimeVersion: 1,
          format: "openai-responses-input",
          formatVersion: 1,
        },
        items: [],
      };
      const refusal = yield* Effect.flip(bootstrapEffect(engine, foreign, UNKNOWN_ACTION_RESULT));

      assert.ok(refusal instanceof CheckpointRefused);
      assert.deepEqual(engine.checkpoint().items, []);
    }),
  );
});
