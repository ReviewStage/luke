import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Layer } from "effect";
import type { HostedServices } from "../server/services/tags.js";

process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";

const { disposeHostedRuntime, getHostedRuntime, makeHostedRuntime } = await import(
  "../server/runtime.js"
);
const { HostedClock } = await import("../server/services/tags.js");

test("getHostedRuntime returns one warm-isolate runtime", () => {
  disposeHostedRuntime();
  const first = getHostedRuntime();
  const second = getHostedRuntime();
  assert.equal(first, second);
  disposeHostedRuntime();
});

test("makeHostedRuntime is disposed independently in tests", async () => {
  const NOW = 1_700_000_000_000;
  const layer = Layer.succeed(HostedClock, { now: () => NOW });
  const runtime = makeHostedRuntime(layer as Layer.Layer<HostedServices, never, never>);
  const read = await runtime.runPromise(
    Effect.gen(function* () {
      const clock = yield* HostedClock;
      return clock.now();
    }),
  );
  assert.equal(read, NOW);
  runtime.dispose();
});

test("disposeHostedRuntime clears the module runtime", () => {
  disposeHostedRuntime();
  const before = getHostedRuntime();
  disposeHostedRuntime();
  const after = getHostedRuntime();
  assert.notEqual(before, after);
  disposeHostedRuntime();
});
