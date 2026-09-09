import assert from "node:assert/strict";
import test from "node:test";
import { retryAttachWhileDetached } from "./attachment";

/** A client stand-in: it announces changes in whether a host stands, never the standing state. */
function client() {
  const listeners = new Set<(attached: boolean) => void>();
  return {
    onAttachedChanged: (listener: (attached: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    announce: (attached: boolean) => {
      for (const listener of [...listeners]) listener(attached);
    },
  };
}

test("a failed attach is tried again after a growing pause until one attaches, and never after the release", async () => {
  const c = client();
  const scheduled: Array<{ work: () => void; delayMs: number }> = [];
  let attaches = 0;
  const release = retryAttachWhileDetached({
    onAttachedChanged: c.onAttachedChanged,
    // The first attach already failed before the retries began: they begin at once.
    attached: () => false,
    attach: async () => {
      attaches += 1;
    },
    setTimeout: (work, delayMs) => {
      scheduled.push({ work, delayMs });
      return undefined;
    },
    initialDelayMs: 100,
    maximumDelayMs: 250,
    report: () => undefined,
  });
  const delays = () => scheduled.map((entry) => entry.delayMs);
  assert.deepEqual(delays(), [100]);
  // A further detachment while a retry already waits schedules nothing new.
  c.announce(false);
  assert.deepEqual(delays(), [100]);
  scheduled[0]?.work();
  assert.equal(attaches, 1);
  c.announce(false);
  c.announce(false);
  assert.deepEqual(delays(), [100, 200]);
  scheduled[1]?.work();
  c.announce(false);
  assert.deepEqual(delays(), [100, 200, 250]);
  // An attachment resets the pause; the release ends the retries.
  c.announce(true);
  scheduled[2]?.work();
  c.announce(false);
  assert.equal(scheduled.at(-1)?.delayMs, 100);
  release();
  const before = attaches;
  scheduled.at(-1)?.work();
  assert.equal(attaches, before);
});
