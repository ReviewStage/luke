import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_SHUTDOWN_DEFAULTS,
  type GatewayShutdownSteps,
  shutdownGatewayEffect,
} from "@sidecar/gateway";
import { Deferred, Effect, Fiber, TestClock } from "effect";
import { test } from "vitest";
import {
  seedWorkspaceThenStartMemory,
  shutdownStepsClosingLiveSession,
  shutdownStepsFlushingEvents,
} from "./lifecycle.js";

/** Waits for a real condition to become true, ticking Effect's own scheduler rather than a fixed drain. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

test("a workspace seed that fails is reported and the memory index still starts, after the seed and not before", async () => {
  const order: string[] = [];
  const reports: string[] = [];
  await seedWorkspaceThenStartMemory({
    seedWorkspace: async () => {
      order.push("seed");
      throw new Error("read-only volume");
    },
    startMemory: async () => {
      order.push("memory");
    },
    report: (message) => reports.push(message),
  });
  assert.deepEqual(order, ["seed", "memory"]);
  assert.deepEqual(reports, ["Brain workspace could not be seeded: read-only volume"]);
});

test("a seed that succeeds reports nothing, and the start does not wait on the index settling", async () => {
  const reports: string[] = [];
  let settleMemory: (() => void) | undefined;
  let started = false;
  await seedWorkspaceThenStartMemory({
    seedWorkspace: async () => undefined,
    startMemory: () =>
      new Promise<void>((resolve) => {
        started = true;
        settleMemory = resolve;
      }),
    report: (message) => reports.push(message),
  });
  assert.equal(started, true);
  assert.deepEqual(reports, []);
  settleMemory?.();
});

function baseSteps(order: string[]): GatewayShutdownSteps {
  return {
    closeAdmissions: Effect.sync(() => {
      order.push("close");
    }),
    cancelActive: Effect.sync((): readonly string[] => {
      order.push("cancel");
      return ["run-1"];
    }),
    awaitSettled: Effect.sync(() => {
      order.push("settled");
    }),
    persistUnresolved: Effect.sync(() => {
      order.push("persist");
      return 0;
    }),
  };
}

/** Work that announces both ends and settles only when the test lets it. */
function heldWork(order: string[], deferred: Deferred.Deferred<void>, name: string) {
  return Effect.gen(function* () {
    order.push(`${name}:start`);
    yield* Deferred.await(deferred);
    order.push(`${name}:end`);
  });
}

it.effect(
  "the flush begins as admissions close and is waited for before the unresolved count, so the install's count leaves with the drain",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const settleFlush = yield* Deferred.make<void>();
      const steps = yield* shutdownStepsFlushingEvents(
        baseSteps(order),
        heldWork(order, settleFlush, "flush"),
      );
      const fiber = yield* Effect.fork(
        shutdownGatewayEffect(steps, { deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS }),
      );
      yield* waitFor(() => order.includes("settled"));
      assert.deepEqual(order, ["close", "flush:start", "cancel", "settled"]);
      yield* Deferred.succeed(settleFlush, undefined);
      const outcome = yield* Fiber.join(fiber);
      assert.deepEqual(order, [
        "close",
        "flush:start",
        "cancel",
        "settled",
        "flush:end",
        "persist",
      ]);
      assert.equal(outcome.settled, true);
      assert.deepEqual(outcome.cancelled, ["run-1"]);
    }),
);

it.effect(
  "a flush that never answers ends the shutdown at the deadline with the runs' own outcome intact",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const steps = yield* shutdownStepsFlushingEvents(baseSteps(order), Effect.never);
      const fiber = yield* Effect.fork(shutdownGatewayEffect(steps, { deadlineMs: 20 }));
      yield* TestClock.adjust(20);
      const outcome = yield* Fiber.join(fiber);
      assert.equal(outcome.settled, false);
      assert.deepEqual(outcome.cancelled, ["run-1"]);
      assert.equal(outcome.unresolved, 0);
      assert.ok(order.includes("persist"));
    }),
);

it.effect("a flush that dies is a count nobody has, not a failed quit", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const steps = yield* shutdownStepsFlushingEvents(
      baseSteps(order),
      Effect.die(new Error("offline")),
    );
    const outcome = yield* shutdownGatewayEffect(steps, {
      deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS,
    });
    assert.equal(outcome.settled, true);
    assert.deepEqual(order, ["close", "cancel", "settled", "persist"]);
  }),
);

it.effect("closing admissions twice flushes once", () =>
  Effect.gen(function* () {
    let flushes = 0;
    const steps = yield* shutdownStepsFlushingEvents(
      baseSteps([]),
      Effect.sync(() => {
        flushes += 1;
      }),
    );
    yield* steps.closeAdmissions;
    yield* steps.closeAdmissions;
    assert.equal(flushes, 1);
  }),
);

it.effect(
  "the live session's close begins with the cancellations and is waited for beside the runs, inside the one deadline",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const settleClose = yield* Deferred.make<void>();
      const steps = yield* shutdownStepsClosingLiveSession(
        baseSteps(order),
        heldWork(order, settleClose, "live"),
      );
      const fiber = yield* Effect.fork(
        shutdownGatewayEffect(steps, { deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS }),
      );
      yield* waitFor(() => order.includes("settled"));
      assert.deepEqual(order, ["close", "live:start", "cancel", "settled"]);
      yield* Deferred.succeed(settleClose, undefined);
      const outcome = yield* Fiber.join(fiber);
      assert.deepEqual(order, ["close", "live:start", "cancel", "settled", "live:end", "persist"]);
      assert.equal(outcome.settled, true);
    }),
);

it.effect(
  "a session whose final event never comes ends the shutdown at the deadline, and a close that dies ends nothing",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const settleClose = yield* Deferred.make<void>();
      const hanging = yield* shutdownStepsClosingLiveSession(
        baseSteps(order),
        heldWork(order, settleClose, "live"),
      );
      const hangingFiber = yield* Effect.fork(shutdownGatewayEffect(hanging, { deadlineMs: 20 }));
      yield* TestClock.adjust(20);
      const outcome = yield* Fiber.join(hangingFiber);
      assert.equal(outcome.settled, false);
      assert.deepEqual(outcome.cancelled, ["run-1"]);
      // The deadline stopped waiting on the close; it did not cut it, so the
      // session still reaches its own end exactly as the drain's own report
      // says it may.
      yield* Deferred.succeed(settleClose, undefined);
      yield* waitFor(() => order.includes("live:end"));

      const throwing = yield* shutdownStepsClosingLiveSession(
        baseSteps([]),
        Effect.die(new Error("socket gone")),
      );
      const settled = yield* shutdownGatewayEffect(throwing, { deadlineMs: 20 });
      assert.equal(settled.settled, true);
    }),
);
