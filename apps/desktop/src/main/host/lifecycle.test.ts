import assert from "node:assert/strict";
import test from "node:test";
import { GATEWAY_SHUTDOWN_DEFAULTS, shutdownGateway } from "@sidecar/runtime";
import { seedWorkspaceThenStartMemory, shutdownStepsFlushingEvents } from "./lifecycle";

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
  const report = shutdownGateway(steps, { deadlineMs: GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS });
  await new Promise((resolve) => setImmediate(resolve));
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
  const outcome = await shutdownGateway(steps, { deadlineMs: 20 });
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
  const outcome = await shutdownGateway(steps, {
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
