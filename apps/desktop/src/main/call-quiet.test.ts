import assert from "node:assert/strict";
import test from "node:test";
import { CALL_QUIET_ONSET_MS, CALL_QUIET_RELEASE_MS, CallQuietGate } from "./call-quiet";

type Timer = ReturnType<typeof setTimeout>;

interface Harness {
  gate: CallQuietGate;
  changes: boolean[];
  clock: { advance(ms: number): void };
}

function harness(): Harness {
  const changes: boolean[] = [];
  let now = 0;
  // Real handles, never fired: they are only keys, and the clock below fires
  // and clears them itself, so the test decides the order and the moment.
  const timers = new Map<Timer, { at: number; callback: () => void }>();
  const gate = new CallQuietGate({
    onChange: (holding) => changes.push(holding),
    schedule: (callback, delayMs) => {
      const handle = setTimeout(() => undefined, 0);
      clearTimeout(handle);
      timers.set(handle, { at: now + delayMs, callback });
      return handle;
    },
    cancel: (timer) => {
      timers.delete(timer);
    },
  });
  return {
    gate,
    changes,
    clock: {
      advance(ms) {
        const target = now + ms;
        for (;;) {
          const due = [...timers.entries()]
            .filter(([, timer]) => timer.at <= target)
            .sort((a, b) => a[1].at - b[1].at)[0];
          if (!due) break;
          timers.delete(due[0]);
          now = due[1].at;
          due[1].callback();
        }
        now = target;
      },
    },
  };
}

test("a foreign capture holds only once it outlasts the onset", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS - 1);
  assert.equal(gate.holding, false);
  clock.advance(1);
  assert.equal(gate.holding, true);
  assert.deepEqual(changes, [true]);
});

test("a capture that ends before the onset never holds", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS - 1);
  gate.setCapturing(false);
  clock.advance(CALL_QUIET_RELEASE_MS);
  assert.equal(gate.holding, false);
  assert.deepEqual(changes, []);
});

test("a capture during Luke's own exchange is not a call", () => {
  const { gate, changes, clock } = harness();
  gate.setExchangeActive(true);
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS * 5);
  assert.equal(gate.holding, false);
  // The device outlives the exchange edge by a moment, and that moment is
  // not a call either.
  gate.setExchangeActive(false);
  clock.advance(CALL_QUIET_ONSET_MS - 1);
  gate.setCapturing(false);
  clock.advance(CALL_QUIET_RELEASE_MS);
  assert.deepEqual(changes, []);
});

test("a capture that lapses inside the grace keeps the hold", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS);
  gate.setCapturing(false);
  clock.advance(CALL_QUIET_RELEASE_MS - 1);
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_RELEASE_MS);
  assert.equal(gate.holding, true);
  assert.deepEqual(changes, [true]);
});

test("speaking to Luke mid-call keeps the hold", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS);
  gate.setExchangeActive(true);
  clock.advance(CALL_QUIET_RELEASE_MS - 1);
  gate.setExchangeActive(false);
  clock.advance(CALL_QUIET_RELEASE_MS);
  assert.equal(gate.holding, true);
  assert.deepEqual(changes, [true]);
});

test("the hold releases once the capture has been gone for the grace", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS);
  gate.setCapturing(false);
  clock.advance(CALL_QUIET_RELEASE_MS - 1);
  assert.equal(gate.holding, true);
  clock.advance(1);
  assert.equal(gate.holding, false);
  assert.deepEqual(changes, [true, false]);
});

test("an unreadable input is not a capture", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(undefined);
  clock.advance(CALL_QUIET_ONSET_MS * 2);
  assert.equal(gate.holding, false);
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS);
  gate.setCapturing(undefined);
  clock.advance(CALL_QUIET_RELEASE_MS);
  assert.deepEqual(changes, [true, false]);
});

test("stop drops the hold and every timer", () => {
  const { gate, changes, clock } = harness();
  gate.setCapturing(true);
  clock.advance(CALL_QUIET_ONSET_MS);
  gate.stop();
  assert.equal(gate.holding, false);
  assert.deepEqual(changes, [true, false]);
  clock.advance(CALL_QUIET_RELEASE_MS);
  assert.deepEqual(changes, [true, false]);
});
