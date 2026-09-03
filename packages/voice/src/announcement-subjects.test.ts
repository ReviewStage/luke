import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_ANNOUNCEMENT_CHANGE, type SessionAnnouncement } from "@sidecar/realtime";
import { withSubjects } from "./announcement-subjects.js";

function announcement(id: string): SessionAnnouncement {
  return {
    providerId: "codex",
    providerSessionId: id,
    change: SESSION_ANNOUNCEMENT_CHANGE.FINISHED,
    decidedAt: 1_000,
  };
}

function fakeTimers() {
  const pending = new Map<ReturnType<typeof setTimeout>, () => void>();
  return {
    schedule: (callback: () => void, delayMs: number) => {
      const timer = setTimeout(() => {}, delayMs);
      clearTimeout(timer);
      pending.set(timer, callback);
      return timer;
    },
    cancel: (timer: ReturnType<typeof setTimeout>) => {
      pending.delete(timer);
    },
    fire: () => {
      for (const [timer, callback] of pending) {
        pending.delete(timer);
        callback();
      }
    },
    get armed() {
      return pending.size;
    },
  };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a subject that settles in time is attached, and the deadline timer is cancelled", async () => {
  const timers = fakeTimers();
  const result = await withSubjects(
    [announcement("a"), announcement("b")],
    async ({ providerSessionId }) =>
      providerSessionId === "a" ? "the billing migration" : undefined,
    6_000,
    timers.schedule,
    timers.cancel,
  );
  assert.deepEqual(result, [
    { ...announcement("a"), subject: "the billing migration" },
    announcement("b"),
  ]);
  assert.equal(timers.armed, 0);
});

test("the deadline releases the batch without the late subject, whose answer is then ignored", async () => {
  const timers = fakeTimers();
  let releaseSlow: ((value: string) => void) | undefined;
  const settled: SessionAnnouncement[][] = [];
  const pending = withSubjects(
    [announcement("slow"), announcement("fast")],
    ({ providerSessionId }) =>
      providerSessionId === "fast"
        ? Promise.resolve("checking the checkout flow")
        : new Promise<string>((resolve) => {
            releaseSlow = resolve;
          }),
    6_000,
    timers.schedule,
    timers.cancel,
  ).then((result) => {
    settled.push([...result]);
    return result;
  });
  await flush();
  assert.equal(settled.length, 0);
  timers.fire();
  const result = await pending;
  assert.deepEqual(result, [
    announcement("slow"),
    { ...announcement("fast"), subject: "checking the checkout flow" },
  ]);
  releaseSlow?.("too late");
  await flush();
  assert.deepEqual(settled, [result]);
});

test("a derivation that rejects leaves its announcement unchanged and its siblings named", async () => {
  const timers = fakeTimers();
  const result = await withSubjects(
    [announcement("a"), announcement("b")],
    async ({ providerSessionId }) => {
      if (providerSessionId === "a") throw new Error("down");
      return "b's work";
    },
    6_000,
    timers.schedule,
    timers.cancel,
  );
  assert.deepEqual(result, [announcement("a"), { ...announcement("b"), subject: "b's work" }]);
});

test("an empty batch arms no timer", async () => {
  const timers = fakeTimers();
  const result = await withSubjects(
    [],
    async () => {
      throw new Error("never asked");
    },
    6_000,
    timers.schedule,
    timers.cancel,
  );
  assert.deepEqual(result, []);
  assert.equal(timers.armed, 0);
});
