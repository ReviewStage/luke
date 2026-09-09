import assert from "node:assert/strict";
import test from "node:test";
import { agentLaneWidth, LANE, LaneScheduler, laneConfiguration } from "./lanes.js";

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

test("the default configuration carries OpenClaw's lane widths", () => {
  const lanes = laneConfiguration(10);
  assert.deepEqual(lanes.widths, {
    agent: 10,
    child: 8,
    "hook-dispatch": 8,
    background: 3,
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
