import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import type {
  FactoryAgent,
  FactoryPullRequest,
  FactoryWorld,
} from "@luke/features/factory-world-wire";
import { test } from "vitest";
import {
  areaOf,
  DAY_MS,
  FACTORY_NOW,
  factoryAgentOf,
  factoryPlannedOf,
  factoryPullRequestOf,
  factoryShippedOf,
  factoryWorldOf,
  factoryZoneOf,
  HOUR_MS,
  uuidOf,
} from "../testing/index.js";
import {
  buildingPiecesOf,
  CAMPUS_DETAIL,
  CAMPUS_LAYOUT,
  CAMPUS_OBJECT,
  CAMPUS_SIGNAL,
  type CampusDrawing,
  type CampusPlan,
  type CampusRect,
  type CampusTaskInput,
  CONTAINER,
  CONTAINER_PLACE,
  campusObjectsOf,
  campusPlanOf,
  campusReadingOf,
  campusSeen,
  containerLengthOf,
  GATE_LANE,
  NOT_IN_CODE,
  PIECE,
  SHAPE_MARK,
  smokeRationOf,
  taskBlastRadiusOf,
} from "./campus.js";
import { factoryWorldViewOf } from "./factory-world.js";

/**
 * campus.test.ts -- the campus as the window draws it: what each task's building says, the pull requests at the gate and in the lot, where every plot stands in the town and in districts, the blast radius a task lights, and what a drawing leaves out to stay cheap.
 */

/** A web app and a desktop app over a core. */
const ZONES = [
  factoryZoneOf("libs/core"),
  factoryZoneOf("apps/web", ["libs/core"]),
  factoryZoneOf("apps/desktop", ["libs/core"]),
];

const NEAR: CampusDrawing = { dark: true, detail: CAMPUS_DETAIL.NEAR, big: false, still: false };

function taskOf(n: number, createdAt = FACTORY_NOW - n * HOUR_MS): CampusTaskInput {
  return { id: uuidOf(1000 + n), name: `Task ${n}`, createdAt };
}

function campusOf(world: FactoryWorld, tasks: readonly CampusTaskInput[]) {
  const view = factoryWorldViewOf(world);
  return { view, campus: campusReadingOf(view, world, tasks) };
}

function agentOn(
  n: number,
  task: CampusTaskInput,
  fields: Partial<FactoryAgent> = {},
): FactoryAgent {
  return factoryAgentOf(n, { taskId: task.id, ...fields });
}

function inside(rect: CampusRect, x: number, y: number): boolean {
  return (
    x >= rect.x - 1e-9 &&
    x <= rect.x + rect.w + 1e-9 &&
    y >= rect.y - 1e-9 &&
    y <= rect.y + rect.d + 1e-9
  );
}

function overlaps(left: CampusRect, right: CampusRect): boolean {
  const gap = 1e-9;
  return (
    left.x + gap < right.x + right.w &&
    right.x + gap < left.x + left.w &&
    left.y + gap < right.y + right.d &&
    right.y + gap < left.y + left.d
  );
}

function manyTasks(count: number): CampusTaskInput[] {
  return Array.from({ length: count }, (_, n) => taskOf(n, FACTORY_NOW - (count - n) * HOUR_MS));
}

test("a building says the most pressing of its agents' states: failed, then working, waiting, stuck, shipped, and idle", () => {
  const tasks = [1, 2, 3, 4, 5, 6].map((n) => taskOf(n));
  const [failed, working, waiting, stuck, shipped, idle] = tasks;
  assert.ok(failed && working && waiting && stuck && shipped && idle);
  const openPullRequest = (number: number) =>
    factoryPullRequestOf({ number, areas: [areaOf("apps/web", 40)] });
  const world = factoryWorldOf({
    zones: ZONES,
    agents: [
      agentOn(1, failed, { status: CODING_AGENT_STATUS.FAILED }),
      agentOn(2, failed),
      agentOn(3, working),
      agentOn(4, working, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: openPullRequest(11),
      }),
      agentOn(5, waiting, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: openPullRequest(12),
      }),
      agentOn(6, stuck, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: factoryPullRequestOf({ number: 13, state: PULL_REQUEST_STATE.DRAFT }),
      }),
      agentOn(7, shipped, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: factoryPullRequestOf({ number: 14, state: PULL_REQUEST_STATE.MERGED }),
      }),
    ],
  });
  const { campus } = campusOf(world, tasks);
  assert.deepEqual(
    tasks.map((task) => campus.taskById.get(task.id)?.signal),
    [
      CAMPUS_SIGNAL.FAILED,
      CAMPUS_SIGNAL.WORKING,
      CAMPUS_SIGNAL.WAITING,
      CAMPUS_SIGNAL.STUCK,
      CAMPUS_SIGNAL.SHIPPED,
      CAMPUS_SIGNAL.IDLE,
    ],
  );
  assert.equal(campus.taskById.get(shipped.id)?.shipped, true);
  assert.equal(
    campus.taskById.get(working.id)?.underway,
    false,
    "a task with a pull request open is no longer going up",
  );
});

test("a task whose merge landed in no zone of the snapshot is still shipped", () => {
  const task = taskOf(1);
  const world = factoryWorldOf({
    zones: ZONES,
    shipped: [
      factoryShippedOf(7, FACTORY_NOW - HOUR_MS, {
        taskId: task.id,
        areas: [areaOf("gone/away", 30)],
      }),
    ],
  });
  const { campus } = campusOf(world, [task]);
  assert.equal(campus.taskById.get(task.id)?.signal, CAMPUS_SIGNAL.SHIPPED);
  assert.equal(campus.taskById.get(task.id)?.zone, null);
});

test("a task goes up while an agent works on it with nothing opened or merged yet", () => {
  const task = taskOf(1);
  const { campus } = campusOf(factoryWorldOf({ agents: [agentOn(1, task)] }), [task]);
  assert.equal(campus.taskById.get(task.id)?.underway, true);
  assert.equal(campus.taskById.get(task.id)?.working, true);
});

test("open pull requests wait in lanes by their checks, a draft or a closed one nowhere, and two agents' one pull request is one container", () => {
  const task = taskOf(1);
  const pullRequest = (number: number, fields: Partial<FactoryPullRequest>) =>
    factoryPullRequestOf({ number, ...fields });
  const world = factoryWorldOf({
    agents: [
      agentOn(1, task, { pullRequest: pullRequest(30, { checks: CHECK_SUMMARY.PASSING }) }),
      agentOn(2, task, { pullRequest: pullRequest(21, { checks: CHECK_SUMMARY.FAILING }) }),
      agentOn(3, task, { pullRequest: pullRequest(22, { checks: CHECK_SUMMARY.PENDING }) }),
      agentOn(4, task, { pullRequest: pullRequest(23, { checks: CHECK_SUMMARY.NONE }) }),
      agentOn(5, task, { pullRequest: pullRequest(24, { state: PULL_REQUEST_STATE.DRAFT }) }),
      agentOn(6, task, { pullRequest: pullRequest(25, { state: PULL_REQUEST_STATE.CLOSED }) }),
      agentOn(7, task, { pullRequest: pullRequest(30, { checks: CHECK_SUMMARY.PASSING }) }),
      factoryAgentOf(8, { pullRequest: pullRequest(40, { checks: CHECK_SUMMARY.PASSING }) }),
    ],
  });
  const { campus } = campusOf(world, [task]);
  assert.deepEqual(
    campus.gate.map((container) => [container.number, container.lane]),
    [
      [21, GATE_LANE.FAILING],
      [22, GATE_LANE.RUNNING],
      [23, GATE_LANE.READY],
      [30, GATE_LANE.READY],
      [40, GATE_LANE.READY],
    ],
  );
  assert.equal(
    campus.gate.find((container) => container.number === 40)?.taskId,
    null,
    "no listed task owns an automation's pull request",
  );
});

test("the lot holds what merged as of the view's instant, the newest first, each by its URL", () => {
  const task = taskOf(1);
  const world = factoryWorldOf({
    shipped: [
      factoryShippedOf(3, FACTORY_NOW - HOUR_MS, { taskId: task.id }),
      factoryShippedOf(1, FACTORY_NOW - 3 * DAY_MS),
      factoryShippedOf(2, FACTORY_NOW - DAY_MS),
    ],
  });
  const { campus } = campusOf(world, [task]);
  assert.deepEqual(
    campus.lot.map((container) => [container.number, container.place, container.taskId]),
    [
      [3, CONTAINER_PLACE.LOT, task.id],
      [2, CONTAINER_PLACE.LOT, null],
      [1, CONTAINER_PLACE.LOT, null],
    ],
  );
  assert.equal(campus.lot[0]?.id, "https://github.com/acme/factory/pull/3");
});

test("a container is a tile per 150 lines, never shorter than its least nor longer than a lane", () => {
  assert.equal(containerLengthOf(300), 2);
  assert.equal(containerLengthOf(3), CONTAINER.MIN_TILES);
  assert.equal(containerLengthOf(50_000), CONTAINER.MAX_TILES);
});

test("the town stands its oldest tasks on the master plan's plots and grows into a square of plots that never overlap", () => {
  const tasks = manyTasks(300);
  const { view, campus } = campusOf(factoryWorldOf({ zones: ZONES }), tasks);
  const plan = campusPlanOf(campus, view, CAMPUS_LAYOUT.TOWN);
  const oldest = tasks[0];
  assert.ok(oldest);
  assert.deepEqual(plan.plots.get(oldest.id)?.plot, { x: 1, y: 1, w: 4.2, d: 4.2 });
  const plots = [...plan.plots.values()].map((slot) => slot.plot);
  assert.equal(plots.length, 300);
  for (const [index, plot] of plots.entries()) {
    for (const other of plots.slice(index + 1)) assert.equal(overlaps(plot, other), false);
  }
  const ratio = plan.width / plan.depth;
  assert.ok(
    ratio > 0.7 && ratio < 1.4,
    `a town of 300 is about square, not ${plan.width} by ${plan.depth}`,
  );
});

test("districts stand each task in its zone's district, each issue on the zone it is placed on, and work in no code apart", () => {
  const web = taskOf(1);
  const desktop = taskOf(2);
  const nowhere = taskOf(3);
  const world = factoryWorldOf({
    zones: ZONES,
    agents: [
      agentOn(1, web, {
        pullRequest: factoryPullRequestOf({ number: 1, areas: [areaOf("apps/web/src", 90)] }),
      }),
      agentOn(2, desktop, {
        pullRequest: factoryPullRequestOf({ number: 2, areas: [areaOf("apps/desktop/src", 90)] }),
      }),
      agentOn(3, nowhere),
    ],
    planned: [factoryPlannedOf(1, { zonePaths: ["libs/core"] }), factoryPlannedOf(2)],
  });
  const { view, campus } = campusOf(world, [web, desktop, nowhere]);
  const plan = campusPlanOf(campus, view, CAMPUS_LAYOUT.DISTRICTS);
  const districtOf = (rect: CampusRect | undefined) =>
    rect === undefined
      ? undefined
      : plan.districts.find((district) =>
          inside(district, rect.x + rect.w / 2, rect.y + rect.d / 2),
        )?.path;
  assert.equal(districtOf(plan.plots.get(web.id)?.plot), "apps/web");
  assert.equal(districtOf(plan.plots.get(desktop.id)?.plot), "apps/desktop");
  assert.equal(districtOf(plan.plots.get(nowhere.id)?.plot), NOT_IN_CODE);
  assert.equal(districtOf(plan.blueprints.get("ENG-1")?.plot), "libs/core");
  assert.equal(districtOf(plan.blueprints.get("ENG-2")?.plot), NOT_IN_CODE);
  assert.deepEqual(
    plan.districts.map((district) => district.path).sort(),
    [NOT_IN_CODE, "apps/desktop", "apps/web", "libs/core"].sort(),
  );
  for (const [index, district] of plan.districts.entries()) {
    for (const other of plan.districts.slice(index + 1))
      assert.equal(overlaps(district, other), false);
  }
});

test("every container stands inside its yard: the gate's lanes, stacked once full, or the lot, which widens past three layers", () => {
  const tasks = manyTasks(1);
  const task = tasks[0];
  assert.ok(task);
  const world = factoryWorldOf({
    agents: Array.from({ length: 100 }, (_, n) =>
      agentOn(n + 1, task, {
        pullRequest: factoryPullRequestOf({
          number: n + 1,
          areas: [areaOf("apps/web", 100 + n * 37)],
        }),
      }),
    ),
    shipped: Array.from({ length: 200 }, (_, n) =>
      factoryShippedOf(500 + n, FACTORY_NOW - n * HOUR_MS, {
        areas: [areaOf("apps/web", 50 + n * 13)],
      }),
    ),
  });
  const { view, campus } = campusOf(world, tasks);
  const plan: CampusPlan = campusPlanOf(campus, view, CAMPUS_LAYOUT.TOWN);
  const yard = { x: 12, y: 5.2, w: 6.6, d: 3.7 };
  assert.equal(plan.containers.length, 300);
  for (const placed of plan.containers) {
    const rect = placed.container.place === CONTAINER_PLACE.GATE ? yard : plan.lot;
    assert.ok(
      inside(rect, placed.x - placed.w / 2, placed.y - placed.d / 2) &&
        inside(rect, placed.x + placed.w / 2, placed.y + placed.d / 2),
      `#${placed.container.number} stands outside its yard`,
    );
  }
  assert.ok(plan.lot.w > 6.4, "two hundred merges widen the lot");
  assert.ok(
    plan.containers.every(
      (placed) => placed.container.place === CONTAINER_PLACE.GATE || placed.z <= 2 * CONTAINER.HIGH,
    ),
  );
});

test("a task's blast radius is every zone it touched and every zone that depends on one, by distance", () => {
  const task = taskOf(1);
  const world = factoryWorldOf({
    zones: ZONES,
    agents: [
      agentOn(1, task, {
        pullRequest: factoryPullRequestOf({ number: 1, areas: [areaOf("libs/core/src", 20)] }),
      }),
    ],
  });
  const { view } = campusOf(world, [task]);
  assert.deepEqual(taskBlastRadiusOf(view, task.id), [
    { path: "libs/core", distance: 0 },
    { path: "apps/desktop", distance: 1 },
    { path: "apps/web", distance: 1 },
  ]);
  assert.deepEqual(taskBlastRadiusOf(view, uuidOf(9)), []);
});

test("what stands nearer the viewer is drawn after what stands behind it", () => {
  const tasks = manyTasks(8);
  const { view, campus } = campusOf(factoryWorldOf({}), tasks);
  const plan = campusPlanOf(campus, view, CAMPUS_LAYOUT.TOWN);
  const order = campusObjectsOf(plan, campus.tasks, campus.planned).flatMap((object) =>
    object.kind === CAMPUS_OBJECT.BUILDING ? [object.task.id] : [],
  );
  assert.equal(order[0], tasks[0]?.id, "the tower at the back is drawn first");
  assert.equal(order.at(-1), tasks[7]?.id, "the small hall at the front is drawn last");
});

test("the sawtooth works draws its silos after its roof, so the roof never covers them", () => {
  const tasks = manyTasks(4);
  const { view, campus } = campusOf(factoryWorldOf({}), tasks);
  const plan = campusPlanOf(campus, view, CAMPUS_LAYOUT.TOWN);
  const works = campus.tasks[3];
  const slot = works === undefined ? undefined : plan.plots.get(works.id);
  assert.ok(works && slot);
  const pieces = buildingPiecesOf(works, slot, NEAR, false).map((piece) => piece.kind);
  assert.ok(pieces.lastIndexOf(PIECE.BESIDE) > pieces.lastIndexOf(PIECE.UPPER));
});

test("far out a wall's windows are one band, and a big campus glows its lit windows by a stroke rather than a blur", () => {
  const task = taskOf(1);
  const { view, campus } = campusOf(factoryWorldOf({ agents: [agentOn(1, task)] }), [task]);
  const plan = campusPlanOf(campus, view, CAMPUS_LAYOUT.TOWN);
  const read = campus.tasks[0];
  const slot = read === undefined ? undefined : plan.plots.get(read.id);
  assert.ok(read && slot);
  const lit = (drawing: CampusDrawing) =>
    buildingPiecesOf(read, slot, drawing, false)
      .flatMap((piece) => piece.shapes)
      .filter((shape) => shape.mark === SHAPE_MARK.LIT);
  assert.equal(
    lit({ ...NEAR, detail: CAMPUS_DETAIL.FAR }).length,
    2,
    "the tower's two faces, a band each",
  );
  assert.ok(lit(NEAR).length > 2);
  assert.ok(lit(NEAR).every((shape) => shape.attributes.stroke === undefined));
  assert.ok(lit({ ...NEAR, big: true }).every((shape) => shape.attributes.stroke !== undefined));
});

test("only so many stacks smoke at once, and none far out", () => {
  const tasks = manyTasks(300);
  const world = factoryWorldOf({
    agents: tasks.slice(0, 100).map((task, n) => agentOn(n + 1, task)),
  });
  const { view, campus } = campusOf(world, tasks);
  const plan = campusPlanOf(campus, view, CAMPUS_LAYOUT.TOWN);
  assert.equal(smokeRationOf(campus.tasks, plan.plots, CAMPUS_DETAIL.NEAR).size, 24);
  assert.equal(smokeRationOf(campus.tasks, plan.plots, CAMPUS_DETAIL.FAR).size, 0);
});

/** The furthest each way a building's drawn shapes reach on screen at a scale of one. */
function drawnExtent(pieces: ReturnType<typeof buildingPiecesOf>) {
  const points = pieces.flatMap((piece) =>
    piece.shapes.flatMap((shape) =>
      (shape.attributes.points ?? "")
        .split(" ")
        .filter((pair) => pair !== "")
        .map((pair) => pair.split(",").map(Number)),
    ),
  );
  const xs = points.map(([x = 0]) => x);
  const ys = points.map(([, y = 0]) => y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

test("a culled campus keeps every building whose walls still cross the screen's edge, though its middle has passed it", () => {
  const tasks = manyTasks(30);
  const world = factoryWorldOf({ agents: tasks.map((task, n) => agentOn(n + 1, task)) });
  const { view, campus } = campusOf(world, tasks);
  for (const layout of [CAMPUS_LAYOUT.TOWN, CAMPUS_LAYOUT.DISTRICTS]) {
    const plan = campusPlanOf(campus, view, layout);
    for (const object of campusObjectsOf(plan, campus.tasks, campus.planned)) {
      if (object.kind !== CAMPUS_OBJECT.BUILDING) continue;
      const drawn = drawnExtent(
        buildingPiecesOf(object.task, object.slot, { ...NEAR, big: true }, true),
      );
      const far = 1e6;
      // A screen whose one edge just crosses the building's furthest wall, each way.
      const edges = [
        { x0: drawn.x1 - 1, x1: far, y0: -far, y1: far },
        { x0: -far, x1: drawn.x0 + 1, y0: -far, y1: far },
        { x0: -far, x1: far, y0: drawn.y1 - 1, y1: far },
        { x0: -far, x1: far, y0: -far, y1: drawn.y0 + 1 },
      ];
      for (const edge of edges)
        assert.ok(campusSeen(edge, object.at), `${object.task.name} is culled while it shows`);
      assert.equal(
        campusSeen({ x0: drawn.x1 + 400, x1: far, y0: -far, y1: far }, object.at),
        false,
      );
    }
  }
});
