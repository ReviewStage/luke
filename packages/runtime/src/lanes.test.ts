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

test("the default configuration carries OpenClaw's lane widths and the hook group", () => {
  const lanes = laneConfiguration(10);
  assert.deepEqual(lanes.widths, {
    agent: 10,
    child: 8,
    cron: 8,
    "cron-nested": 8,
    "hook-dispatch": 8,
    background: 3,
  });
  assert.deepEqual(lanes.groups[CRON_HOOK_GROUP], {
    budget: 8,
    members: [LANE.CRON_NESTED, LANE.HOOK_DISPATCH],
    reservations: { [LANE.HOOK_DISPATCH]: LANE_DEFAULTS.HOOK_RESERVATION },
  });
});

test("a lane admits its width and queues the rest in order, apart from every other lane", async () => {
  const scheduler = new LaneScheduler(laneConfiguration(8));
  const gates = Array.from({ length: 4 }, () => deferred());
  const started: number[] = [];
  const runs = gates.map((gate, index) =>
    scheduler.run(LANE.BACKGROUND, async () => {
      started.push(index);
      await gate.promise;
      return index;
    }),
  );
  const child = scheduler.run(LANE.CHILD, async () => "child");
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(await child, "child");
  assert.deepEqual(scheduler.snapshot(LANE.BACKGROUND), { width: 3, active: 3, queued: 1 });
  gates[0]?.resolve();
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3]);
  for (const gate of gates) gate.resolve();
  assert.deepEqual(await Promise.all(runs), [0, 1, 2, 3]);
});

test("cron inner work cannot take the slot the hook reservation holds, and hooks may use the free budget", async () => {
  const scheduler = new LaneScheduler(laneConfiguration(8));
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
