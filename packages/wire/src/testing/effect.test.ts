import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { runTest } from "./effect.js";

class Answer extends Context.Service<Answer, { readonly value: number }>()(
  "@sidecar/wire/testing/effect.test/Answer",
) {}

describe("runTest", () => {
  it("runs an Effect with no requirements to its resolved value", async () => {
    const result = await runTest(Effect.succeed(42));

    assert.equal(result, 42);
  });

  it("rejects with the Effect's failure", async () => {
    await assert.rejects(() => runTest(Effect.fail(new Error("boom"))));
  });

  it("provides a layer to an Effect that requires it", async () => {
    const value = await runTest(
      Effect.gen(function* () {
        const answer = yield* Answer;
        return answer.value;
      }),
      Layer.succeed(Answer, { value: 42 }),
    );

    assert.equal(value, 42);
  });
});
