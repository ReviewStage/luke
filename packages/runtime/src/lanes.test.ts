import assert from "node:assert/strict";
import test from "node:test";
import {
  agentLaneWidth,
  CRON_HOOK_GROUP,
  LANE,
  LANE_DEFAULTS,
  LaneScheduler,
  laneConfiguration,
} from "./lanes.js";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((done) => setImmediate(done));

test("the agent lane's width follows the machine's parallelism between the pinned bounds", () => {
  assert.equal(agentLaneWidth(1), 8);
  assert.equal(agentLaneWidth(8), 8);
  assert.equal(agentLaneWidth(12), 12);
  assert.equal(agentLaneWidth(16), 16);
  assert.equal(agentLaneWidth(64), 16);
  assert.equal(agentLaneWidth(Number.NaN), 8);
  const actual = agentLaneWidth();
  assert.ok(actual >= 8 && actual <= 16);
});

test("the default configuration carries OpenClaw's lane widths and the hook group only when hooks stand", () => {
  const on = laneConfiguration({ parallelism: 10, hooksEnabled: true });
  assert.deepEqual(on.widths, {
    agent: 10,
    child: 8,
    cron: 8,
    "cron-nested": 8,
    "hook-dispatch": 8,
    nested: 1,
    background: 3,
  });
  assert.deepEqual(on.groups[CRON_HOOK_GROUP], {
    budget: 8,
    members: [LANE.CRON_NESTED, LANE.HOOK_DISPATCH],
    reservations: { [LANE.HOOK_DISPATCH]: LANE_DEFAULTS.HOOK_RESERVATION },
  });
  const off = laneConfiguration({ parallelism: 10, hooksEnabled: false });
  assert.equal(off.widths[LANE.HOOK_DISPATCH], 0);
  assert.deepEqual(off.groups, {});
  const draining = laneConfiguration({ parallelism: 10, hooksEnabled: false, activeHooks: 2 });
  assert.equal(draining.widths[LANE.HOOK_DISPATCH], 0);
  assert.deepEqual(draining.groups[CRON_HOOK_GROUP], {
    budget: 8,
    members: [LANE.CRON_NESTED, LANE.HOOK_DISPATCH],
  });
});

test("a lane admits its width and queues the rest in order, apart from every other lane", async () => {
  const scheduler = new LaneScheduler(laneConfiguration({ parallelism: 8, hooksEnabled: true }));
  const gates = Array.from({ length: 3 }, () => deferred());
  const started: number[] = [];
  const runs = gates.map((gate, index) =>
    scheduler.run(LANE.NESTED, async () => {
      started.push(index);
      await gate.promise;
      return index;
    }),
  );
  const background = scheduler.run(LANE.BACKGROUND, async () => "background");
  await tick();
  assert.deepEqual(started, [0]);
  assert.equal(await background, "background");
  assert.deepEqual(scheduler.snapshot(LANE.NESTED), { width: 1, active: 1, queued: 2 });
  gates[0]?.resolve();
  await tick();
  assert.deepEqual(started, [0, 1]);
  gates[1]?.resolve();
  gates[2]?.resolve();
  assert.deepEqual(await Promise.all(runs), [0, 1, 2]);
});

test("cron inner work cannot take the slot the hook reservation holds, and hooks may use the free budget", async () => {
  const scheduler = new LaneScheduler(laneConfiguration({ parallelism: 8, hooksEnabled: true }));
  const gate = deferred();
  const cronStarted: number[] = [];
  const cronRuns = Array.from({ length: 8 }, (_, index) =>
    scheduler.run(LANE.CRON_NESTED, async () => {
      cronStarted.push(index);
      await gate.promise;
    }),
  );
  await tick();
  assert.equal(cronStarted.length, 7);
  let hookRan = false;
  const hook = scheduler.run(LANE.HOOK_DISPATCH, async () => {
    hookRan = true;
    await gate.promise;
  });
  await tick();
  assert.ok(hookRan);
  const second = scheduler.run(LANE.HOOK_DISPATCH, async () => "second");
  await tick();
  assert.deepEqual(scheduler.snapshot(LANE.HOOK_DISPATCH), { width: 8, active: 1, queued: 1 });
  gate.resolve();
  await Promise.all([...cronRuns, hook]);
  assert.equal(await second, "second");
});

test("reconfiguring applies every width and group at once, and running hook work stays inside the budget", async () => {
  const scheduler = new LaneScheduler(laneConfiguration({ parallelism: 8, hooksEnabled: true }));
  const gate = deferred();
  const hooks = Array.from({ length: 3 }, () =>
    scheduler.run(LANE.HOOK_DISPATCH, async () => {
      await gate.promise;
    }),
  );
  await tick();
  scheduler.configure(
    laneConfiguration({
      parallelism: 8,
      hooksEnabled: false,
      activeHooks: scheduler.snapshot(LANE.HOOK_DISPATCH).active,
    }),
  );
  const cronStarted: number[] = [];
  const cron = Array.from({ length: 8 }, (_, index) =>
    scheduler.run(LANE.CRON_NESTED, async () => {
      cronStarted.push(index);
      await gate.promise;
    }),
  );
  await tick();
  // Three hooks still count against the shared budget of eight.
  assert.equal(cronStarted.length, 5);
  assert.equal(scheduler.run(LANE.HOOK_DISPATCH, async () => "never") instanceof Promise, true);
  await tick();
  assert.equal(scheduler.snapshot(LANE.HOOK_DISPATCH).queued, 1);
  gate.resolve();
  await Promise.all([...hooks, ...cron]);
  scheduler.configure(laneConfiguration({ parallelism: 8, hooksEnabled: false }));
  assert.equal(scheduler.snapshot(LANE.HOOK_DISPATCH).queued, 1);
});
