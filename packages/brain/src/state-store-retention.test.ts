import assert from "node:assert/strict";
import test from "node:test";
import { FakeClock } from "@sidecar/runtime/testing";
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
  assert.ok(repository.words().includes(EXPIRED_SECRET));
  assert.equal(reports.length, 0);
  assert.equal(clock.timers.size, 0);
  // Nothing was armed, so advancing past the deadline fires nothing and the
  // generation stands: only a store with automatic reset has a clock to keep.
  await clock.advance(NOW + BRAIN_GENERATION_LIFETIME_MS);
  assert.equal(store.generationId(), "gen-old");
  generationClock.stop();
});
