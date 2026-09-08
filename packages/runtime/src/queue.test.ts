import assert from "node:assert/strict";
import test from "node:test";
import {
  admitToQueue,
  DEFAULT_QUEUE_SETTINGS,
  drainQueue,
  EMPTY_QUEUE,
  PendingInputQueue,
  type PendingQueueState,
  QUEUE_DEFAULTS,
  QUEUE_MODE,
  QUEUE_OVERFLOW,
  type QueuedInput,
  type QueueMode,
  queueSummaryText,
} from "./queue.js";

const input = (id: string, text = `words ${id}`): QueuedInput => ({ id, text, atMs: 1 });

test("the defaults are OpenClaw's: steer, 500 ms, twenty deep, summarize", () => {
  assert.deepEqual(DEFAULT_QUEUE_SETTINGS, {
    mode: "steer",
    debounceMs: 500,
    capacity: 20,
    overflow: "summarize",
  });
  assert.equal(QUEUE_DEFAULTS.CAPACITY, 20);
});

test("admission is idempotent on the input's id, so a duplicated hook queues one entry", () => {
  const once = admitToQueue(EMPTY_QUEUE, input("a"));
  const twice = admitToQueue(once.state, input("a"));
  assert.equal(once.admitted, true);
  assert.equal(twice.admitted, false);
  assert.equal(twice.state.entries.length, 1);
});

test("past capacity, summarize folds the oldest into a summary that rides ahead of the drain", () => {
  let state: PendingQueueState = EMPTY_QUEUE;
  for (let index = 0; index < 22; index += 1) {
    state = admitToQueue(
      state,
      input(`i${index}`, `input number ${index} ${"x".repeat(100)}`),
    ).state;
  }
  assert.equal(state.entries.length, 20);
  assert.equal(state.summarizedCount, 2);
  assert.equal(state.entries[0]?.id, "i2");
  const summary = queueSummaryText(state);
  assert.ok(summary?.startsWith("2 earlier inputs were summarized"));
  assert.ok(summary?.includes("input number 0"));
  assert.ok(summary?.includes("…"));
  const collected = drainQueue(state, QUEUE_MODE.COLLECT);
  assert.equal(collected.length, 1);
  assert.equal(collected[0]?.inputs.length, 20);
  assert.equal(collected[0]?.summary, summary);
  const followups = drainQueue(state, QUEUE_MODE.FOLLOWUP);
  assert.equal(followups.length, 20);
  assert.equal(followups[0]?.summary, summary);
  assert.equal(followups[1]?.summary, undefined);
});

test("the other overflow policies drop the oldest or refuse the newest", () => {
  let state: PendingQueueState = EMPTY_QUEUE;
  const settings = { capacity: 2, overflow: QUEUE_OVERFLOW.DROP_OLDEST };
  for (const id of ["a", "b", "c"]) state = admitToQueue(state, input(id), settings).state;
  assert.deepEqual(
    state.entries.map((entry) => entry.id),
    ["b", "c"],
  );
  const refused = admitToQueue(state, input("d"), {
    capacity: 2,
    overflow: QUEUE_OVERFLOW.DROP_NEWEST,
  });
  assert.equal(refused.admitted, false);
  assert.deepEqual(refused.evicted, [input("d")]);
});

interface FakeClock {
  timers: Map<number, () => void>;
  next: number;
  fire(): void;
}

function fakeClock(): FakeClock {
  const clock: FakeClock = {
    timers: new Map(),
    next: 1,
    fire() {
      const pending = [...clock.timers.values()];
      clock.timers.clear();
      for (const callback of pending) callback();
    },
  };
  return clock;
}

function queueWith(
  clock: FakeClock,
  steer: (input: QueuedInput) => boolean,
  mode: QueueMode = QUEUE_MODE.STEER,
) {
  const flushed: string[][] = [];
  let interrupted = 0;
  const queue = new PendingInputQueue({
    settings: { mode },
    steer,
    interrupt: () => {
      interrupted += 1;
    },
    flush: (batches) => {
      for (const batch of batches) flushed.push(batch.inputs.map((entry) => entry.id));
    },
    schedule: (callback) => {
      const id = clock.next++;
      clock.timers.set(id, callback);
      return id;
    },
    cancel: (timer) => {
      // SAFETY: every timer this test's clock hands out is the number it minted above.
      clock.timers.delete(timer as number);
    },
  });
  return { queue, flushed, interrupted: () => interrupted };
}

test("steer hands input to the run under way and falls back to a follow-up when nothing can take it", () => {
  const clock = fakeClock();
  const steered: string[] = [];
  let active = true;
  const { queue, flushed } = queueWith(clock, (entry) => {
    if (!active) return false;
    steered.push(entry.id);
    return true;
  });
  assert.equal(queue.push(input("a")), true);
  assert.deepEqual(steered, ["a"]);
  active = false;
  assert.equal(queue.push(input("b")), true);
  assert.equal(queue.size, 1);
  // Once something waits, later input waits behind it rather than jumping ahead by steering.
  active = true;
  assert.equal(queue.push(input("c")), true);
  assert.deepEqual(steered, ["a"]);
  assert.equal(queue.push(input("c")), false);
  clock.fire();
  assert.deepEqual(flushed, [["b", "c"]]);
  assert.equal(queue.size, 0);
});

test("follow-up opens one turn per input, collect opens one turn for all, interrupt cancels and opens now", () => {
  const clock = fakeClock();
  const followup = queueWith(clock, () => false, QUEUE_MODE.FOLLOWUP);
  followup.queue.push(input("a"));
  followup.queue.push(input("b"));
  clock.fire();
  assert.deepEqual(followup.flushed, [["a"], ["b"]]);
  const collect = queueWith(clock, () => false, QUEUE_MODE.COLLECT);
  collect.queue.push(input("a"));
  collect.queue.push(input("b"));
  assert.deepEqual(collect.flushed, []);
  clock.fire();
  assert.deepEqual(collect.flushed, [["a", "b"]]);
  const interrupt = queueWith(clock, () => true, QUEUE_MODE.INTERRUPT);
  interrupt.queue.push(input("a"));
  assert.equal(interrupt.interrupted(), 1);
  assert.deepEqual(interrupt.flushed, [["a"]]);
  assert.equal(clock.timers.size, 0);
});

test("clear forgets the queue and its timer", () => {
  const clock = fakeClock();
  const { queue, flushed } = queueWith(clock, () => false);
  queue.push(input("a"));
  assert.equal(clock.timers.size, 1);
  queue.clear();
  assert.equal(clock.timers.size, 0);
  clock.fire();
  assert.deepEqual(flushed, []);
});

test("withdraw takes one queued input back before the drain, and disarms the timer when nothing is left", () => {
  const clock = fakeClock();
  const { queue, flushed } = queueWith(clock, () => false, QUEUE_MODE.COLLECT);
  queue.push(input("a"));
  queue.push(input("b"));
  assert.equal(queue.withdraw("a"), true);
  assert.equal(queue.withdraw("a"), false);
  assert.equal(queue.withdraw("never-queued"), false);
  assert.equal(clock.timers.size, 1);
  clock.fire();
  assert.deepEqual(flushed, [["b"]]);
  queue.push(input("c"));
  assert.equal(clock.timers.size, 1);
  assert.equal(queue.withdraw("c"), true);
  assert.equal(clock.timers.size, 0);
  assert.deepEqual(flushed, [["b"]]);
});

test("a queue holding only folded asks still drains one turn for them, in follow-up as in collect", () => {
  let state: PendingQueueState = EMPTY_QUEUE;
  const settings = { capacity: 1, overflow: QUEUE_OVERFLOW.SUMMARIZE };
  state = admitToQueue(state, input("a"), settings).state;
  state = admitToQueue(state, input("b"), settings).state;
  state = { ...state, entries: [] };
  assert.equal(state.summarizedCount, 1);
  for (const mode of [QUEUE_MODE.FOLLOWUP, QUEUE_MODE.COLLECT, QUEUE_MODE.STEER]) {
    const batches = drainQueue(state, mode);
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0]?.inputs, []);
    assert.ok(batches[0]?.summary?.includes("1 earlier input was summarized"));
  }
});

test("withdrawing a folded ask by its place in the summary leaves the queue empty and disarmed when nothing else waits", () => {
  const clock = fakeClock();
  const flushed: string[][] = [];
  const full = new PendingInputQueue({
    settings: { mode: QUEUE_MODE.COLLECT, capacity: 1, overflow: QUEUE_OVERFLOW.SUMMARIZE },
    steer: () => false,
    interrupt: () => undefined,
    flush: (batches) => {
      for (const batch of batches) flushed.push(batch.inputs.map((entry) => entry.id));
    },
    schedule: (callback) => {
      const id = clock.next++;
      clock.timers.set(id, callback);
      return id;
    },
    // SAFETY: every timer this test's clock hands out is the number it minted above.
    cancel: (timer) => void clock.timers.delete(timer as number),
  });
  full.push(input("a"));
  full.push(input("b"));
  full.push(input("c"));
  assert.equal(full.size, 3);
  assert.equal(full.state.summaryLines.length, 2);
  // The one entry withdrawn: the two folded asks still hold the turn and count as waiting.
  assert.equal(full.withdraw("c"), true);
  assert.equal(full.size, 2);
  assert.equal(clock.timers.size, 1);
  assert.equal(full.withdrawSummarized(5), false);
  assert.equal(full.withdrawSummarized(0), true);
  assert.equal(full.state.summarizedCount, 1);
  assert.equal(full.withdrawSummarized(0), true);
  assert.equal(full.size, 0);
  assert.equal(clock.timers.size, 0);
  assert.equal(full.withdrawSummarized(0), false);
  clock.fire();
  assert.deepEqual(flushed, []);
});
