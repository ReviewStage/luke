import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BrainGenerationClock,
  type BrainStateStorage,
  BrainStateStore,
  brainStateRecord,
  freshBrainState,
} from "@sidecar/brain";
import type { ScheduledTimer } from "@sidecar/realtime";

/**
 * Retention as the main process owns it: the store and its clock stand from
 * launch in a live run, whether or not any capability builds an agent. Under
 * the shipped policy of no automatic reset an old checkpoint is loaded whole,
 * past its stamped deadline, and the clock arms nothing.
 */

const NOW = 1_800_000_000_000;
const EXPIRED_SECRET = "EXPIRED_SECRET_MARKER";

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  read() {
    return this.file;
  }
  write(contents: string) {
    this.file = contents;
    return true;
  }
}

class FakeClock {
  now = NOW;
  readonly timers = new Map<ScheduledTimer, { callback: () => void; at: number }>();
  schedule = (callback: () => void, delayMs: number): ScheduledTimer => {
    const handle: ScheduledTimer = {};
    this.timers.set(handle, { callback, at: this.now + delayMs });
    return handle;
  };
  cancel = (timer: ScheduledTimer): void => {
    this.timers.delete(timer);
  };
  async advance(untilMs: number): Promise<void> {
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= untilMs)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = Math.max(this.now, due[1].at);
      due[1].callback();
      await settle();
    }
    this.now = Math.max(this.now, untilMs);
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => {
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      if (ticks > 20) resolve();
      else setImmediate(tick);
    };
    tick();
  });
}

function launch(storage: MemoryStorage, clock: FakeClock) {
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
  const storage = new MemoryStorage();
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
