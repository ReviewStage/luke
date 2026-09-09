import assert from "node:assert/strict";
import test from "node:test";
import {
  CRON_SCHEDULE_KIND,
  CronScheduler,
  HEARTBEAT_DEFAULTS,
  heartbeatJob,
  jobDue,
  memoryScheduledJobStore,
  nextRunAt,
  type ScheduledJob,
  type ScheduledJobStore,
  scheduledJobFromWire,
  validCronExpression,
} from "./cron.js";
import { MAIN_SESSION_KEY } from "./identifiers.js";

const T0 = Date.UTC(2026, 8, 8, 12, 0, 0);
const MINUTE = 60_000;

function memoryStore(initial: readonly ScheduledJob[] = [], refuse = () => false) {
  const jobs = new Map(initial.map((job) => [job.id, job]));
  const store: ScheduledJobStore = {
    list: async () => [...jobs.values()],
    put: async (job) => {
      if (refuse()) return false;
      jobs.set(job.id, job);
      return true;
    },
    delete: async (id) => jobs.delete(id),
  };
  return { store, jobs };
}

test("the in-memory job store round-trips a job and forgets a deleted one", async () => {
  const store = memoryScheduledJobStore();
  const job = heartbeatJob(T0);
  assert.equal(await store.put(job), true);
  assert.deepEqual(await store.list(), [job]);
  assert.equal(await store.delete(job.id), true);
  assert.deepEqual(await store.list(), []);
});

test("the heartbeat is main's every-thirty-minutes job", () => {
  const job = heartbeatJob(T0);
  assert.equal(HEARTBEAT_DEFAULTS.INTERVAL_MS, 30 * MINUTE);
  assert.equal(job.sessionKey, MAIN_SESSION_KEY);
  assert.deepEqual(job.schedule, { kind: CRON_SCHEDULE_KIND.EVERY, everyMs: 30 * MINUTE });
  assert.equal(nextRunAt(job, T0), T0 + 30 * MINUTE);
  assert.equal(jobDue(job, T0 + 29 * MINUTE), false);
  assert.equal(jobDue(job, T0 + 30 * MINUTE), true);
  assert.equal(jobDue({ ...job, lastRunAt: T0 + 30 * MINUTE }, T0 + 45 * MINUTE), false);
  assert.equal(jobDue({ ...job, enabled: false }, T0 + 60 * MINUTE), false);
});

test("cron expressions parse through the pinned croner, in the job's timezone", () => {
  assert.equal(validCronExpression("0 3 * * *"), true);
  assert.equal(validCronExpression("not a schedule"), false);
  const job: ScheduledJob = {
    id: "nightly",
    name: "Nightly",
    sessionKey: MAIN_SESSION_KEY,
    schedule: { kind: CRON_SCHEDULE_KIND.CRON, expression: "0 3 * * *", timezone: "UTC" },
    enabled: true,
    createdAt: T0,
  };
  assert.equal(nextRunAt(job, T0), Date.UTC(2026, 8, 9, 3, 0, 0));
  assert.equal(jobDue(job, Date.UTC(2026, 8, 9, 2, 59, 0)), false);
  assert.equal(jobDue(job, Date.UTC(2026, 8, 9, 3, 0, 0)), true);
  const once: ScheduledJob = {
    ...job,
    id: "once",
    schedule: { kind: CRON_SCHEDULE_KIND.AT, atMs: T0 + MINUTE },
  };
  assert.equal(nextRunAt(once, T0), T0 + MINUTE);
  assert.equal(nextRunAt({ ...once, lastRunAt: T0 + MINUTE }, T0 + MINUTE), undefined);
});

test("a stored job reads back only in the shapes the scheduler writes", () => {
  const job = heartbeatJob(T0);
  assert.deepEqual(scheduledJobFromWire(JSON.parse(JSON.stringify(job))), job);
  assert.equal(
    scheduledJobFromWire({ ...job, schedule: { kind: "every", everyMs: 10 } }),
    undefined,
  );
  assert.equal(
    scheduledJobFromWire({ ...job, schedule: { kind: "cron", expression: "bogus" } }),
    undefined,
  );
  assert.equal(scheduledJobFromWire({ ...job, enabled: "yes" }), undefined);
});

interface Clock {
  now: number;
  timers: Map<number, { at: number; callback: () => void }>;
  next: number;
}

function scheduler(clock: Clock, store: ScheduledJobStore, ran: string[]) {
  return new CronScheduler({
    store,
    run: async (job) => {
      ran.push(`${job.id}@${clock.now}`);
    },
    now: () => clock.now,
    schedule: (callback, delayMs) => {
      const id = clock.next++;
      clock.timers.set(id, { at: clock.now + delayMs, callback });
      return id;
    },
    cancel: (timer) => {
      // SAFETY: every timer this test's clock hands out is the number it minted above.
      clock.timers.delete(timer as number);
    },
  });
}

async function advance(clock: Clock, toMs: number) {
  clock.now = toMs;
  const due = [...clock.timers.entries()].filter(([, timer]) => timer.at <= toMs);
  for (const [id, timer] of due) {
    clock.timers.delete(id);
    timer.callback();
  }
  await new Promise<void>((done) => setImmediate(done));
  await new Promise<void>((done) => setImmediate(done));
}

test("a due job runs once, is recorded before it runs, and several missed occurrences run once", async () => {
  const clock: Clock = { now: T0, timers: new Map(), next: 1 };
  const { store, jobs } = memoryStore();
  const ran: string[] = [];
  const cron = scheduler(clock, store, ran);
  await cron.start();
  await cron.ensure(heartbeatJob(T0));
  assert.equal(clock.timers.size, 1);
  await advance(clock, T0 + 30 * MINUTE);
  assert.deepEqual(ran, [`heartbeat@${T0 + 30 * MINUTE}`]);
  assert.equal(jobs.get("heartbeat")?.lastRunAt, T0 + 30 * MINUTE);
  // The app slept through three occurrences; the job runs once, now.
  await advance(clock, T0 + 150 * MINUTE);
  assert.deepEqual(ran.length, 2);
  assert.equal(jobs.get("heartbeat")?.lastRunAt, T0 + 150 * MINUTE);
});

test("a restart with the job already recorded as run does not run it again until its next interval", async () => {
  const clock: Clock = { now: T0 + 10 * MINUTE, timers: new Map(), next: 1 };
  const { store } = memoryStore([{ ...heartbeatJob(T0), lastRunAt: T0 }]);
  const ran: string[] = [];
  const cron = scheduler(clock, store, ran);
  await cron.start();
  // The stored job stands as stored; the default is not written over it.
  const ensured = await cron.ensure(heartbeatJob(T0 + 10 * MINUTE));
  assert.equal(ensured?.lastRunAt, T0);
  await cron.tick();
  assert.deepEqual(ran, []);
  assert.equal(cron.nextDueAt(), T0 + 30 * MINUTE);
  await advance(clock, T0 + 30 * MINUTE);
  assert.equal(ran.length, 1);
});

test("a store that refuses the run record leaves the job unrun for the next tick", async () => {
  const clock: Clock = { now: T0 + 30 * MINUTE, timers: new Map(), next: 1 };
  let refuse = false;
  const { store } = memoryStore([heartbeatJob(T0)], () => refuse);
  const ran: string[] = [];
  const reports: string[] = [];
  const cron = new CronScheduler({
    store,
    run: async (job) => {
      ran.push(job.id);
    },
    now: () => clock.now,
    schedule: () => 1,
    cancel: () => undefined,
    report: (message) => reports.push(message),
  });
  await cron.start();
  refuse = true;
  await cron.tick();
  assert.deepEqual(ran, []);
  assert.equal(reports.length, 1);
  refuse = false;
  await cron.tick();
  assert.deepEqual(ran, ["heartbeat"]);
});
