import assert from "node:assert/strict";
import { setImmediate as immediate } from "node:timers/promises";
import { test } from "vitest";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  type BrainPersistedState,
  freshBrainState,
} from "./envelope.js";
import { BrainGenerationClock } from "./generation-clock.js";
import type { ScheduledTimer } from "./seam.js";
import { BrainStateStore } from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";

/** A clock this test drives by hand: nothing is due until it advances or fires. */
class FakeClock {
  now: number;
  readonly timers = new Map<ScheduledTimer, { callback: () => void; at: number }>();

  constructor(now: number) {
    this.now = now;
  }

  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.timers.set(handle, { callback, at: this.now + delayMs });
    return handle;
  };

  cancel = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };

  /** Runs every timer due at or before `untilMs`, in due order, draining between each. */
  async advance(untilMs: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      for (let turn = 0; turn < 20; turn += 1) await immediate();
    }
    this.now = Math.max(this.now, untilMs);
  }
}

/**
 * Retention as the shipped policy has it: the store and its clock stand from
 * launch in a live run, whether or not any capability builds an agent, and
 * with no automatic reset an old checkpoint is loaded whole, past its stamped
 * deadline, while the clock arms nothing.
 */

const NOW = 1_800_000_000_000;
const EXPIRED_SECRET = "EXPIRED_SECRET_MARKER";

function launch(repository: FakeBrainStateRepository, clock: FakeClock) {
  const reports: string[] = [];
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: false,
    repository,
    createGenerationId: () => `gen-${++generations}`,
    now: () => clock.now,
    report: (message) => reports.push(message),
  });
  const generationClock = new BrainGenerationClock({
    store,
    now: () => clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
  });
  return { store, generationClock, reports };
}

test("a launch under the default policy keeps a checkpoint past its stamped deadline and arms no clock", async () => {
  const stale: BrainPersistedState = {
    ...freshBrainState("gen-old", NOW - BRAIN_GENERATION_LIFETIME_MS - 1),
    items: [{ type: "message", role: "user", content: EXPIRED_SECRET }],
  };
  const repository = fakeBrainStateRepository(stale);
  const clock = new FakeClock(NOW);
  const { store, generationClock, reports } = launch(repository, clock);
  await generationClock.start();
  assert.equal(store.generationId(), "gen-old");
  assert.deepEqual(store.current()?.items, stale.items);
  assert.equal(reports.length, 0);
  assert.equal(clock.timers.size, 0);
  // Nothing was armed, so advancing past the deadline fires nothing and the
  // generation stands: only a store with automatic reset has a clock to keep.
  await clock.advance(NOW + BRAIN_GENERATION_LIFETIME_MS);
  assert.equal(store.generationId(), "gen-old");
  generationClock.stop();
});
