import assert from "node:assert/strict";
import test from "node:test";
import type { ScheduledTimer } from "@sidecar/runtime/vocabulary";
import { BrainGenerationClock } from "./generation-clock.js";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  type BrainPersistedState,
  BrainStateStore,
  freshBrainState,
} from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";

/**
 * Retention as the shipped policy has it: the store and its clock stand from
 * launch in a live run, whether or not any capability builds an agent, and
 * with no automatic reset an old checkpoint is loaded whole, past its stamped
 * deadline, while the clock arms nothing.
 */

const NOW = 1_800_000_000_000;
const EXPIRED_SECRET = "EXPIRED_SECRET_MARKER";

/** Enough of a clock for the generation clock: it records what was armed and never fires. */
function fakeClock() {
  const timers = new Map<ScheduledTimer, { callback: () => void; at: number }>();
  let now = NOW;
  return {
    get now() {
      return now;
    },
    timers,
    advanceTo: (at: number) => {
      now = at;
    },
    schedule: (callback: () => void, delayMs: number): ScheduledTimer => {
      const handle: ScheduledTimer = {};
      timers.set(handle, { callback, at: now + delayMs });
      return handle;
    },
    cancel: (timer: ScheduledTimer): void => {
      timers.delete(timer);
    },
  };
}

function launch(repository: FakeBrainStateRepository, clock: ReturnType<typeof fakeClock>) {
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
  const clock = fakeClock();
  const { store, generationClock, reports } = launch(repository, clock);
  await generationClock.start();
  assert.equal(store.generationId(), "gen-old");
  assert.deepEqual(store.current()?.items, stale.items);
  assert.ok(repository.words().includes(EXPIRED_SECRET));
  assert.equal(reports.length, 0);
  assert.equal(clock.timers.size, 0);
  clock.advanceTo(NOW + BRAIN_GENERATION_LIFETIME_MS);
  assert.equal(store.generationId(), "gen-old");
  generationClock.stop();
});
