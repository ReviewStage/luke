import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Fiber } from "effect";
import {
  BoundedProcess,
  BoundedProcessLive,
  INVOCATION_FAILURE,
  invocationPath,
  runBoundedInvocation,
} from "./index.js";

test("arguments are passed directly without shell interpretation", async () => {
  const marker = "$(printf should-not-run)";
  const result = await runBoundedInvocation({
    binary: process.execPath,
    arguments: ["-e", "process.stdout.write(process.argv[1])", marker],
    timeoutMs: 2_000,
    maximumOutputBytes: 1024,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, marker);
});

test("a non-zero exit is a bounded answer", async () => {
  const result = await runBoundedInvocation({
    binary: process.execPath,
    arguments: ["-e", "process.stderr.write('no'); process.exit(7)"],
    timeoutMs: 2_000,
    maximumOutputBytes: 1024,
  });
  assert.deepEqual(result, { exitCode: 7, stdout: "", stderr: "no" });
});

test("a process terminated by a signal is a failure, never a successful exit", async () => {
  await assert.rejects(
    runBoundedInvocation({
      binary: process.execPath,
      arguments: ["-e", "process.kill(process.pid, 'SIGTERM')"],
      timeoutMs: 2_000,
      maximumOutputBytes: 1024,
    }),
    { name: "InvocationError", failure: INVOCATION_FAILURE.FAILED },
  );
});

test("an absent binary is a typed unavailable failure", async () => {
  await assert.rejects(
    runBoundedInvocation({
      binary: "/definitely/not/a/binary",
      arguments: [],
      timeoutMs: 2_000,
      maximumOutputBytes: 1024,
    }),
    { name: "InvocationError", failure: INVOCATION_FAILURE.UNAVAILABLE },
  );
});

test("PATH augmentation preserves inherited entries and removes duplicates", () => {
  const inherited = [...new Set((process.env.PATH ?? "").split(":").filter(Boolean))];
  const added = "/a/sidecar-test-bin";
  const entries = invocationPath([added, added]).split(":");
  assert.deepEqual(entries.slice(0, inherited.length), inherited);
  assert.equal(entries.filter((entry) => entry === added).length, 1);
});

test("output beyond the cap is a typed output-limit failure", async () => {
  await assert.rejects(
    runBoundedInvocation({
      binary: process.execPath,
      arguments: ["-e", "process.stdout.write('x'.repeat(2048))"],
      timeoutMs: 2_000,
      maximumOutputBytes: 512,
    }),
    { name: "InvocationError", failure: INVOCATION_FAILURE.OUTPUT_LIMIT },
  );
});

test("a timed-out invocation is a typed timed-out failure", async () => {
  await assert.rejects(
    runBoundedInvocation({
      binary: process.execPath,
      arguments: ["-e", "setTimeout(() => {}, 60_000)"],
      timeoutMs: 50,
      maximumOutputBytes: 1024,
    }),
    { name: "InvocationError", failure: INVOCATION_FAILURE.TIMED_OUT },
  );
});

test("fiber interruption kills only the bounded child", async () => {
  const program = Effect.gen(function* () {
    const processService = yield* BoundedProcess;
    const fiber = yield* Effect.fork(
      processService.invoke({
        binary: process.execPath,
        arguments: ["-e", "setTimeout(() => {}, 60_000)"],
        timeoutMs: 60_000,
        maximumOutputBytes: 1024,
      }),
    );
    yield* Effect.sleep(100);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    assert.equal(exit._tag, "Failure");
  }).pipe(Effect.provide(BoundedProcessLive));

  await Effect.runPromise(program);
});
