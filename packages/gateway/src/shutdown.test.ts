import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Fiber, TestClock } from "effect";
import {
  GATEWAY_SHUTDOWN_DEFAULTS,
  type GatewayShutdownSteps,
  shutdownGatewayEffect,
} from "./shutdown.js";

it.effect("every step settles before the deadline, and persistUnresolved always runs last", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const steps: GatewayShutdownSteps = {
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
    const outcome = yield* shutdownGatewayEffect(steps, {
      deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS,
    });
    assert.deepEqual(order, ["close", "cancel", "settled", "persist"]);
    assert.equal(outcome.settled, true);
    assert.deepEqual(outcome.cancelled, ["run-1"]);
    assert.equal(outcome.unresolved, 0);
  }),
);

it.effect(
  "an awaitSettled that hangs past the deadline is counted as unsettled, and what cancelActive already produced stands",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const steps: GatewayShutdownSteps = {
        closeAdmissions: Effect.sync(() => {
          order.push("close");
        }),
        cancelActive: Effect.sync((): readonly string[] => {
          order.push("cancel");
          return ["run-1"];
        }),
        awaitSettled: Effect.never,
        persistUnresolved: Effect.sync(() => {
          order.push("persist");
          return 1;
        }),
      };
      const fiber = yield* Effect.fork(shutdownGatewayEffect(steps, { deadlineMs: 1_000 }));
      yield* TestClock.adjust(1_000);
      const outcome = yield* Fiber.join(fiber);
      assert.equal(outcome.settled, false);
      assert.deepEqual(outcome.cancelled, ["run-1"]);
      assert.equal(outcome.unresolved, 1);
      assert.deepEqual(order, ["close", "cancel", "persist"]);
    }),
);

it.effect(
  "a cancelActive that hangs past the deadline leaves nothing settled, and never calls awaitSettled",
  () =>
    Effect.gen(function* () {
      const order: string[] = [];
      const steps: GatewayShutdownSteps = {
        closeAdmissions: Effect.sync(() => {
          order.push("close");
        }),
        cancelActive: Effect.never,
        awaitSettled: Effect.sync(() => {
          order.push("settled");
        }),
        persistUnresolved: Effect.sync(() => {
          order.push("persist");
          return 2;
        }),
      };
      const fiber = yield* Effect.fork(shutdownGatewayEffect(steps, { deadlineMs: 1_000 }));
      yield* TestClock.adjust(1_000);
      const outcome = yield* Fiber.join(fiber);
      assert.equal(outcome.settled, false);
      assert.deepEqual(outcome.cancelled, []);
      assert.equal(outcome.unresolved, 2);
      assert.deepEqual(order, ["close", "persist"]);
    }),
);

it.effect("a cancelActive that dies is a count nobody has, not a failed shutdown", () =>
  Effect.gen(function* () {
    const order: string[] = [];
    const steps: GatewayShutdownSteps = {
      closeAdmissions: Effect.sync(() => {
        order.push("close");
      }),
      cancelActive: Effect.promise(() => Promise.reject(new Error("offline"))),
      awaitSettled: Effect.sync(() => {
        order.push("settled");
      }),
      persistUnresolved: Effect.sync(() => {
        order.push("persist");
        return 0;
      }),
    };
    const outcome = yield* shutdownGatewayEffect(steps, {
      deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS,
    });
    assert.equal(outcome.settled, true);
    assert.deepEqual(outcome.cancelled, []);
    assert.deepEqual(order, ["close", "settled", "persist"]);
  }),
);
