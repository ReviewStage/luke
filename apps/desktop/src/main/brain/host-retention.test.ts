import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  BrainAgent,
  BrainGenerationClock,
  type BrainStateStorage,
  BrainStateStore,
  brainStateFromStored,
  brainStateRecord,
  freshBrainState,
} from "@sidecar/brain";
import type { ScheduledTimer } from "@sidecar/realtime";
import { ACT_RESULT_STATUS } from "@sidecar/wire";
import { BrainHost } from "./host";

/**
 * Retention as the main process owns it: the store and its clock stand from
 * launch in a live run, whether or not any capability builds an agent, so an
 * expired, unreadable, or oversized file is replaced at launch and a
 * generation whose agent was retired still dies on time.
 */

const NOW = 1_800_000_000_000;
const EXPIRED_SECRET = "EXPIRED_SECRET_MARKER";
const RETIRED_SECRET = "RETIRED_SECRET_MARKER";

class MemoryStorage implements BrainStateStorage {
  file: string | undefined;
  refuse = false;
  read() {
    return this.file;
  }
  write(contents: string) {
    if (this.refuse) return false;
    this.file = contents;
    return true;
  }
  remove() {
    this.file = undefined;
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

test("a launch with no key or account replaces an expired file at once, without an agent or an inference", async () => {
  const storage = new MemoryStorage();
  const stale = {
    ...freshBrainState("gen-old", NOW - BRAIN_GENERATION_LIFETIME_MS - 1),
    items: [{ type: "message", role: "user", content: EXPIRED_SECRET }],
  };
  storage.file = brainStateRecord(stale);
  const clock = new FakeClock();
  const { store, generationClock, reports } = launch(storage, clock);
  await generationClock.start();
  assert.notEqual(store.generationId(), "gen-old");
  assert.ok(!String(storage.file).includes(EXPIRED_SECRET));
  assert.equal(brainStateFromStored(storage.file)?.generationId, store.generationId());
  assert.ok(reports.some((message) => message.includes("expired generation")));
  // The clock now stands for the fresh generation.
  assert.equal(clock.timers.size, 1);
  generationClock.stop();
  assert.equal(clock.timers.size, 0);

  // A disk that refuses the replacement is reported, and memory still holds the fresh one.
  const refusing = new MemoryStorage();
  refusing.file = brainStateRecord(stale);
  refusing.refuse = true;
  const held = launch(refusing, clock);
  await held.generationClock.start();
  assert.notEqual(held.store.generationId(), "gen-old");
  assert.ok(held.reports.some((message) => message.includes("could not replace")));
  held.generationClock.stop();
});

test("a generation whose agent was retired before its expiry still dies on the host's clock, and the file is replaced", async () => {
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const { store, generationClock } = launch(storage, clock);
  await generationClock.start();
  const host = new BrainHost({
    follow: () => async () => undefined,
    publishEmpty: () => undefined,
  });
  await host.replace(
    () =>
      new BrainAgent({
        client: {
          respond: async () => ({
            outcome: "answered",
            payload: {
              output: [
                {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: RETIRED_SECRET }],
                },
              ],
            },
          }),
          quietUntil: () => undefined,
        },
        acts: { perform: async () => ({ status: ACT_RESULT_STATUS.ACCEPTED }) },
        roster: () => ({ text: "", identities: [] }),
        standingContext: () => "",
        readTranscriptSince: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
        readTranscript: async () => ({ status: ACT_RESULT_STATUS.REJECTED, reason: "no" }),
        deliver: () => undefined,
        store,
        createRunId: () => "run-1",
        report: () => {},
        now: () => clock.now,
        schedule: clock.schedule,
        cancel: clock.cancel,
      }),
  );
  const agent = host.current();
  assert.ok(agent);
  const accepted = await agent.submitAsk({ submissionId: "s", question: "hi", origin: "typed" });
  assert.equal(accepted.outcome, "accepted");
  await settle();
  const born = store.current();
  assert.ok(born);
  assert.ok(String(storage.file).includes(RETIRED_SECRET));
  // The key goes: the agent is retired, and only the host's clock stands.
  await host.replace(() => undefined);
  assert.equal(host.current(), undefined);
  assert.equal(clock.timers.size, 1);
  await clock.advance(born.expiresAt - 1);
  assert.equal(store.generationId(), born.generationId);
  await clock.advance(born.expiresAt);
  assert.notEqual(store.generationId(), born.generationId);
  assert.ok(!String(storage.file).includes(RETIRED_SECRET));
  assert.equal(brainStateFromStored(storage.file)?.generationId, store.generationId());
  generationClock.stop();
});
