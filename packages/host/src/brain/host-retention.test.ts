import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BrainGenerationClock,
  BrainStateStore,
  brainStateRecord,
  freshBrainState,
} from "@sidecar/brain";
import { FakeClock } from "@sidecar/fixtures/testing";
import { MemoryBrainStorage, BRAIN_HARNESS_NOW as NOW } from "../testing/index.js";

/**
 * Retention as the main process owns it: the store and its clock stand from
 * launch in a live run, whether or not any capability builds an agent. Under
 * the shipped policy of no automatic reset an old checkpoint is loaded whole,
 * past its stamped deadline, and the clock arms nothing.
 */

const EXPIRED_SECRET = "EXPIRED_SECRET_MARKER";

function launch(storage: MemoryBrainStorage, clock: FakeClock) {
  const reports: string[] = [];
  let generations = 0;
  const store = new BrainStateStore({
    automaticReset: false,
    storage,
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
  const storage = new MemoryBrainStorage();
  const stale = {
    ...freshBrainState("gen-old", NOW - BRAIN_GENERATION_LIFETIME_MS - 1),
    items: [{ type: "message", role: "user", content: EXPIRED_SECRET }],
  };
  storage.file = brainStateRecord(stale);
  const clock = new FakeClock();
  const { store, generationClock, reports } = launch(storage, clock);
  await generationClock.start();
  assert.equal(store.generationId(), "gen-old");
  assert.deepEqual(store.current()?.items, stale.items);
  assert.ok(String(storage.file).includes(EXPIRED_SECRET));
  assert.equal(reports.length, 0);
  assert.equal(clock.timers.size, 0);
  await clock.advance(NOW + BRAIN_GENERATION_LIFETIME_MS);
  assert.equal(store.generationId(), "gen-old");
  generationClock.stop();
});
