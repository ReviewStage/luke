import assert from "node:assert/strict";
import { GATEWAY_SHUTDOWN_DEFAULTS, shutdownGatewayEffect } from "@sidecar/gateway";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { Effect } from "effect";
import { test } from "vitest";
import {
  seedWorkspaceThenStartMemory,
  shutdownStepsClosingLiveSession,
  shutdownStepsFlushingEvents,
} from "./lifecycle.js";

/** The shutdown as a promise, since these bodies are plain tests rather than fibers. */
const runShutdown = (
  steps: Parameters<typeof shutdownGatewayEffect>[0],
  options: Parameters<typeof shutdownGatewayEffect>[1],
) => Effect.runPromise(shutdownGatewayEffect(steps, options));

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

function baseSteps(order: string[]) {
  return {
    closeAdmissions: () => {
      order.push("close");
    },
    cancelActive: async () => {
      order.push("cancel");
      return ["run-1"];
    },
    awaitSettled: async () => {
      order.push("settled");
    },
    persistUnresolved: async () => {
      order.push("persist");
      return 0;
    },
  };
}

test("the flush begins as admissions close and is waited for before the unresolved count, so the install's count leaves with the drain", async () => {
  const order: string[] = [];
  let settleFlush: (() => void) | undefined;
  const steps = shutdownStepsFlushingEvents(baseSteps(order), () => {
    order.push("flush:start");
    return new Promise<void>((resolve) => {
      settleFlush = () => {
        order.push("flush:end");
        resolve();
      };
    });
  });
  const report = runShutdown(steps, { deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS });
  await drainMicrotasks(1);
  assert.deepEqual(order, ["close", "flush:start", "cancel", "settled"]);
  settleFlush?.();
  const outcome = await report;
  assert.deepEqual(order, ["close", "flush:start", "cancel", "settled", "flush:end", "persist"]);
  assert.equal(outcome.settled, true);
  assert.deepEqual(outcome.cancelled, ["run-1"]);
});

test("a flush that never answers ends the shutdown at the deadline with the runs' own outcome intact", async () => {
  const order: string[] = [];
  const steps = shutdownStepsFlushingEvents(
    baseSteps(order),
    () => new Promise<void>(() => undefined),
  );
  const outcome = await runShutdown(steps, { deadlineMs: 20 });
  assert.equal(outcome.settled, false);
  assert.deepEqual(outcome.cancelled, ["run-1"]);
  assert.equal(outcome.unresolved, 0);
  assert.ok(order.includes("persist"));
});

test("a flush that rejects is a count nobody has, not a failed quit", async () => {
  const order: string[] = [];
  const steps = shutdownStepsFlushingEvents(baseSteps(order), () =>
    Promise.reject(new Error("offline")),
  );
  const outcome = await runShutdown(steps, {
    deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS,
  });
  assert.equal(outcome.settled, true);
  assert.deepEqual(order, ["close", "cancel", "settled", "persist"]);
});

test("closing admissions twice flushes once", () => {
  let flushes = 0;
  const steps = shutdownStepsFlushingEvents(baseSteps([]), async () => {
    flushes += 1;
  });
  steps.closeAdmissions();
  steps.closeAdmissions();
  assert.equal(flushes, 1);
});

test("the live session's close begins with the cancellations and is waited for beside the runs, inside the one deadline", async () => {
  const order: string[] = [];
  let settleClose: (() => void) | undefined;
  const steps = shutdownStepsClosingLiveSession(baseSteps(order), () => {
    order.push("live:close");
    return new Promise<void>((resolve) => {
      settleClose = () => {
        order.push("live:closed");
        resolve();
      };
    });
  });
  const report = runShutdown(steps, { deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS });
  await drainMicrotasks(1);
  assert.deepEqual(order, ["close", "live:close", "cancel", "settled"]);
  settleClose?.();
  const outcome = await report;
  assert.deepEqual(order, ["close", "live:close", "cancel", "settled", "live:closed", "persist"]);
  assert.equal(outcome.settled, true);
});

test("a session whose final event never comes ends the shutdown at the deadline, and a close that throws ends nothing", async () => {
  const order: string[] = [];
  const hanging = shutdownStepsClosingLiveSession(
    baseSteps(order),
    () => new Promise<void>(() => undefined),
  );
  const outcome = await runShutdown(hanging, { deadlineMs: 20 });
  assert.equal(outcome.settled, false);
  assert.deepEqual(outcome.cancelled, ["run-1"]);

  const throwing = shutdownStepsClosingLiveSession(baseSteps([]), async () => {
    throw new Error("socket gone");
  });
  const settled = await runShutdown(throwing, { deadlineMs: 20 });
  assert.equal(settled.settled, true);
});
