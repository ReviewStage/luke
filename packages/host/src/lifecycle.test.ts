import assert from "node:assert/strict";
import test from "node:test";
import { disposeGateway, GATEWAY_DISPOSE_DEFAULTS } from "@sidecar/gateway";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { disposeStepsFlushingEvents, seedWorkspaceThenStartMemory } from "./lifecycle.js";

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
    persistUnsettled: async () => {
      order.push("persist");
      return 0;
    },
  };
}

test("the flush begins as admissions close and is waited for before the unsettled count, so the install's count leaves with the drain", async () => {
  const order: string[] = [];
  let settleFlush: (() => void) | undefined;
  const steps = disposeStepsFlushingEvents(baseSteps(order), () => {
    order.push("flush:start");
    return new Promise<void>((resolve) => {
      settleFlush = () => {
        order.push("flush:end");
        resolve();
      };
    });
  });
  const report = disposeGateway(steps, { deadlineMs: GATEWAY_DISPOSE_DEFAULTS.DEADLINE_MS });
  await drainMicrotasks(1);
  assert.deepEqual(order, ["close", "flush:start", "cancel", "settled"]);
  settleFlush?.();
  const outcome = await report;
  assert.deepEqual(order, ["close", "flush:start", "cancel", "settled", "flush:end", "persist"]);
  assert.equal(outcome.settled, true);
  assert.deepEqual(outcome.cancelled, ["run-1"]);
});

test("a flush that never answers ends the dispose at the deadline with the runs' own outcome intact", async () => {
  const order: string[] = [];
  const steps = disposeStepsFlushingEvents(
    baseSteps(order),
    () => new Promise<void>(() => undefined),
  );
  const outcome = await disposeGateway(steps, { deadlineMs: 20 });
  assert.equal(outcome.settled, false);
  assert.deepEqual(outcome.cancelled, ["run-1"]);
  assert.equal(outcome.unsettled, 0);
  assert.ok(order.includes("persist"));
});

test("a flush that rejects is a count nobody has, not a failed quit", async () => {
  const order: string[] = [];
  const steps = disposeStepsFlushingEvents(baseSteps(order), () =>
    Promise.reject(new Error("offline")),
  );
  const outcome = await disposeGateway(steps, {
    deadlineMs: GATEWAY_DISPOSE_DEFAULTS.DEADLINE_MS,
  });
  assert.equal(outcome.settled, true);
  assert.deepEqual(order, ["close", "cancel", "settled", "persist"]);
});

test("closing admissions twice flushes once", () => {
  let flushes = 0;
  const steps = disposeStepsFlushingEvents(baseSteps([]), async () => {
    flushes += 1;
  });
  steps.closeAdmissions();
  steps.closeAdmissions();
  assert.equal(flushes, 1);
});
