import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { runTest, TestReporter, testReporter } from "./effect.js";

describe("TestReporter", () => {
  it.effect("collects report calls into the order they were made", () =>
    Effect.gen(function* () {
      const reporter = yield* TestReporter;

      yield* reporter.report("first");
      yield* reporter.report("second");

      assert.deepEqual(reporter.messages(), ["first", "second"]);
    }).pipe(Effect.provideServiceEffect(TestReporter, testReporter)),
  );

  it.effect("starts empty", () =>
    Effect.gen(function* () {
      const reporter = yield* TestReporter;

      assert.deepEqual(reporter.messages(), []);
    }).pipe(Effect.provideServiceEffect(TestReporter, testReporter)),
  );

  it.effect("keeps two instances of the collector independent", () =>
    Effect.gen(function* () {
      const first = yield* testReporter;
      const second = yield* testReporter;

      yield* first.report("only first");

      assert.deepEqual(first.messages(), ["only first"]);
      assert.deepEqual(second.messages(), []);
    }),
  );
});

describe("runTest", () => {
  it("runs an Effect with no requirements to its resolved value", async () => {
    const result = await runTest(Effect.succeed(42));

    assert.equal(result, 42);
  });

  it("rejects with the Effect's failure", async () => {
    await assert.rejects(() => runTest(Effect.fail(new Error("boom"))));
  });

  it("provides a layer to an Effect that requires it", async () => {
    const messages = await runTest(
      Effect.gen(function* () {
        const reporter = yield* TestReporter;
        yield* reporter.report("via layer");
        return reporter.messages();
      }),
      Layer.effect(TestReporter, testReporter),
    );

    assert.deepEqual(messages, ["via layer"]);
  });
});
