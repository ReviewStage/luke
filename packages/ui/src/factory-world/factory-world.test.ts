import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { FACTORY_WORLD_BOUNDS, type FactoryZone } from "@luke/features/factory-world-wire";
import { AREA_PATH } from "@luke/features/pull-request-area";
import { test } from "vitest";
import {
  areaOf,
  DAY_MS,
  FACTORY_NOW,
  factoryAgentOf,
  factoryDefectOf,
  factoryPlannedOf,
  factoryPullRequestOf,
  factoryShippedOf,
  factoryWorldOf,
  factoryZoneOf,
  HOUR_MS,
  uuidOf,
} from "../testing/index.js";
import {
  AGENT_KIND,
  AGENT_STATE,
  AGENT_STUCK_AFTER_MS,
  BUILD_FULL_LINES,
  blastRadiusOf,
  type FactoryWorldView,
  factoryWorldAsOf,
  factoryWorldViewOf,
  ZONE_EDGE_KIND,
  ZONE_LAYER,
  ZONE_LAYOUT,
  type ZoneView,
} from "./factory-world.js";

/**
 * A small product graph, named nothing like this repository's: `libs/base`
 * under everything, `libs/model` under most, two middles, two edges.
 */
const PRODUCT_ZONES = [
  factoryZoneOf("libs/base"),
  factoryZoneOf("libs/model", ["libs/base"]),
  factoryZoneOf("services/api", ["libs/model", "libs/base"]),
  factoryZoneOf("kits/widgets", ["libs/model", "libs/base"]),
  factoryZoneOf("apps/desk", ["kits/widgets", "libs/model", "libs/base"]),
  factoryZoneOf("apps/site", ["services/api", "libs/base"]),
];

function zoneOf(view: FactoryWorldView, path: string): ZoneView {
  const zone = view.zoneByPath.get(path);
  assert.ok(zone, `no zone at ${path}`);
  return zone;
}

function layersOf(view: FactoryWorldView): Record<string, string> {
  return Object.fromEntries(view.zones.map((zone) => [zone.path, zone.layer]));
}

function circularGap(left: number, right: number): number {
  const gap = Math.abs(left - right) % (2 * Math.PI);
  return Math.min(gap, 2 * Math.PI - gap);
}

/* ----- Layers ----- */

test("zones many others depend on stand in the core, those nothing depends on at the surface, and the rest in the domain", () => {
  const view = factoryWorldViewOf(factoryWorldOf({ zones: PRODUCT_ZONES }));

  assert.deepEqual(layersOf(view), {
    "apps/desk": ZONE_LAYER.SURFACE,
    "apps/site": ZONE_LAYER.SURFACE,
    "kits/widgets": ZONE_LAYER.DOMAIN,
    "libs/base": ZONE_LAYER.CORE,
    "libs/model": ZONE_LAYER.CORE,
    "services/api": ZONE_LAYER.DOMAIN,
  });
});

test("the root, a dot-directory, and a tools directory stand as tooling, and a tool depending on a zone pulls it no nearer the core", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: [
        factoryZoneOf(AREA_PATH.ROOT),
        factoryZoneOf(".github"),
        factoryZoneOf("scripts"),
        factoryZoneOf("tools/lint", ["libs/core"]),
        factoryZoneOf("libs/core"),
        factoryZoneOf("apps/one", ["libs/core"]),
      ],
    }),
  );

  assert.deepEqual(layersOf(view), {
    ".": ZONE_LAYER.TOOLING,
    ".github": ZONE_LAYER.TOOLING,
    "apps/one": ZONE_LAYER.SURFACE,
    "libs/core": ZONE_LAYER.DOMAIN,
    scripts: ZONE_LAYER.TOOLING,
    "tools/lint": ZONE_LAYER.TOOLING,
  });
});

test("a zone's depth is its longest chain of dependencies, and a cycle still reads", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: [
        ...PRODUCT_ZONES,
        factoryZoneOf("loop/one", ["loop/two"]),
        factoryZoneOf("loop/two", ["loop/one"]),
      ],
    }),
  );

  assert.equal(zoneOf(view, "libs/base").depth, 0);
  assert.equal(zoneOf(view, "libs/model").depth, 1);
  assert.equal(zoneOf(view, "apps/desk").depth, 3);
  assert.deepEqual([zoneOf(view, "loop/one").depth, zoneOf(view, "loop/two").depth].sort(), [0, 1]);
});

test("every zone stands inside its layer's ring, the core innermost and tooling outermost", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({ zones: [...PRODUCT_ZONES, factoryZoneOf("scripts")] }),
  );
  const ringOf = (layer: string) => view.zones.find((zone) => zone.layer === layer)?.ring ?? -1;

  assert.ok(ringOf(ZONE_LAYER.CORE) < ringOf(ZONE_LAYER.DOMAIN));
  assert.ok(ringOf(ZONE_LAYER.DOMAIN) < ringOf(ZONE_LAYER.SURFACE));
  assert.ok(ringOf(ZONE_LAYER.SURFACE) < ringOf(ZONE_LAYER.TOOLING));
  for (const zone of view.zones) {
    assert.ok(zone.radius >= zone.ring + ZONE_LAYOUT.BAND_INSET, zone.path);
    assert.ok(zone.radius <= zone.ring + 1 - ZONE_LAYOUT.BAND_INSET, zone.path);
    assert.ok(Math.abs(Math.hypot(zone.x, zone.y) - zone.radius) < 1e-9, zone.path);
  }
});

test("edges join only zones the snapshot names, once each, marking a zone's dependency on the one it sits inside", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: [
        factoryZoneOf("libs"),
        factoryZoneOf("libs/base", ["libs", "libs", "gone/zone", "libs/base"]),
        factoryZoneOf("apps/one", ["libs/base"]),
      ],
    }),
  );

  assert.deepEqual(view.edges, [
    { from: "apps/one", to: "libs/base", kind: ZONE_EDGE_KIND.DEPENDS },
    { from: "libs/base", to: "libs", kind: ZONE_EDGE_KIND.INSIDE },
  ]);
});

/* ----- Layout ----- */

/** The zones standing on `ring`, in the order they go round it. */
function ringOf(view: FactoryWorldView, ring: number): ZoneView[] {
  return view.zones
    .filter((zone) => zone.ring === ring)
    .sort((left, right) => left.angle - right.angle);
}

/** Each zone on `ring` beside the next one round, the last beside the first. */
function neighboursOn(view: FactoryWorldView, ring: number): (readonly [ZoneView, ZoneView])[] {
  const zones = ringOf(view, ring);
  return zones.flatMap((zone, index) => {
    const next = zones[(index + 1) % zones.length];
    return next === undefined ? [] : [[zone, next] as const];
  });
}

/** `count` zones named `<directory>/<name>-<n>`, depending on nothing, so all stand at the surface. */
function zonesUnder(directory: string, count: number): FactoryZone[] {
  return Array.from({ length: count }, (_, index) => factoryZoneOf(`${directory}/zone-${index}`));
}

test("a ring holding two directories is filled all the way round, no gap wider than twice an even share", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({ zones: [...zonesUnder("apps", 4), ...zonesUnder("packages", 9)] }),
  );
  const surface = ringOf(view, zoneOf(view, "apps/zone-0").ring);
  const evenShare = (2 * Math.PI) / surface.length;

  assert.equal(surface.length, 13);
  for (const [left, right] of neighboursOn(view, surface[0]?.ring ?? -1)) {
    const gap = (right.angle - left.angle + 2 * Math.PI) % (2 * Math.PI);
    assert.ok(gap <= 2 * evenShare, `${left.path} to ${right.path}: ${gap}`);
  }
});

test("a directory's zones hold one unbroken arc of their ring", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: [...zonesUnder("apps", 5), ...zonesUnder("libs", 7), ...zonesUnder("kits", 3)],
    }),
  );
  const directories = ringOf(view, zoneOf(view, "apps/zone-0").ring).map(
    (zone) => zone.path.split("/")[0],
  );
  const changes = directories.filter(
    (directory, index) => directory !== directories.at(index - 1),
  ).length;

  // Note that going round once, three unbroken arcs change directory exactly three times.
  assert.equal(changes, 3);
});

test("a directory coming or going moves every other zone on its ring less than one even share, and none on another ring", () => {
  const scripts = factoryZoneOf("scripts", [], { bytes: 3000 });
  const before = factoryWorldViewOf(
    factoryWorldOf({ zones: [...zonesUnder("apps", 4), ...zonesUnder("packages", 9), scripts] }),
  );
  const after = factoryWorldViewOf(
    factoryWorldOf({
      zones: [
        ...zonesUnder("apps", 4),
        ...zonesUnder("packages", 9),
        factoryZoneOf("docs/guide"),
        scripts,
      ],
    }),
  );
  const evenShare = (2 * Math.PI) / ringOf(after, zoneOf(after, "docs/guide").ring).length;

  for (const zone of before.zones) {
    if (zone.path === "scripts") continue;
    const moved = circularGap(zone.angle, zoneOf(after, zone.path).angle);
    assert.ok(moved < evenShare, `${zone.path} moved ${moved}`);
  }
  assert.deepEqual(zoneOf(after, "scripts"), zoneOf(before, "scripts"));
});

test("zones on one ring stand apart by their footprints, a larger zone given more of the ring", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: [
        factoryZoneOf("apps/huge", [], { bytes: 90_000 }),
        factoryZoneOf("apps/small", [], { bytes: 1_000 }),
        factoryZoneOf("libs/large", [], { bytes: 40_000 }),
        factoryZoneOf("libs/tiny", [], { bytes: 10 }),
        factoryZoneOf("kits/medium", [], { bytes: 10_000 }),
      ],
    }),
  );
  const ring = zoneOf(view, "apps/huge").ring;
  const footprints = ringOf(view, ring).reduce((sum, zone) => sum + zone.footprint, 0);

  // Note that a zone covering its footprint's share of the turn either side of its middle meets its neighbour's and no more.
  for (const [left, right] of neighboursOn(view, ring)) {
    const gap = (right.angle - left.angle + 2 * Math.PI) % (2 * Math.PI);
    const covered = (Math.PI * (left.footprint + right.footprint)) / footprints;
    assert.ok(gap >= covered - 1e-9, `${left.path} overlaps ${right.path}`);
  }
});

test("a zone's footprint grows with the square root of its bytes and never falls under the floor", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: [
        factoryZoneOf("big", [], { bytes: 40_000 }),
        factoryZoneOf("quarter", [], { bytes: 10_000 }),
        factoryZoneOf("tiny", [], { bytes: 4 }),
        factoryZoneOf("empty", [], { bytes: 0 }),
      ],
    }),
  );

  assert.equal(zoneOf(view, "big").footprint, 1);
  assert.equal(zoneOf(view, "quarter").footprint, 0.5);
  assert.equal(zoneOf(view, "tiny").footprint, ZONE_LAYOUT.FOOTPRINT_FLOOR);
  assert.equal(zoneOf(view, "empty").footprint, ZONE_LAYOUT.FOOTPRINT_FLOOR);
});

/* ----- Agents ----- */

test("an agent reads as working, stuck, waiting on the developer, failed, or idle", () => {
  const stale = FACTORY_NOW - AGENT_STUCK_AFTER_MS - HOUR_MS;
  const cases = [
    { status: CODING_AGENT_STATUS.STARTING, pr: null, at: FACTORY_NOW, state: AGENT_STATE.WORKING },
    {
      status: CODING_AGENT_STATUS.RUNNING,
      pr: PULL_REQUEST_STATE.DRAFT,
      at: stale,
      state: AGENT_STATE.WORKING,
    },
    { status: CODING_AGENT_STATUS.FAILED, pr: null, at: FACTORY_NOW, state: AGENT_STATE.FAILED },
    { status: CODING_AGENT_STATUS.CANCELLED, pr: null, at: FACTORY_NOW, state: AGENT_STATE.IDLE },
    { status: CODING_AGENT_STATUS.COMPLETED, pr: null, at: stale, state: AGENT_STATE.WAITING },
    {
      status: CODING_AGENT_STATUS.COMPLETED,
      pr: PULL_REQUEST_STATE.DRAFT,
      at: FACTORY_NOW,
      state: AGENT_STATE.STUCK,
    },
    {
      status: CODING_AGENT_STATUS.COMPLETED,
      pr: PULL_REQUEST_STATE.OPEN,
      at: FACTORY_NOW - HOUR_MS,
      state: AGENT_STATE.WAITING,
    },
    {
      status: CODING_AGENT_STATUS.COMPLETED,
      pr: PULL_REQUEST_STATE.OPEN,
      at: stale,
      state: AGENT_STATE.STUCK,
    },
    {
      status: CODING_AGENT_STATUS.COMPLETED,
      pr: PULL_REQUEST_STATE.MERGED,
      at: stale,
      state: AGENT_STATE.IDLE,
    },
    {
      status: CODING_AGENT_STATUS.COMPLETED,
      pr: PULL_REQUEST_STATE.CLOSED,
      at: FACTORY_NOW,
      state: AGENT_STATE.IDLE,
    },
  ];
  const view = factoryWorldViewOf(
    factoryWorldOf({
      agents: cases.map((each, index) =>
        factoryAgentOf(index, {
          status: each.status,
          activityAt: each.at,
          pullRequest: each.pr === null ? null : factoryPullRequestOf({ state: each.pr }),
        }),
      ),
    }),
  );

  assert.deepEqual(
    view.agents.map((agent) => agent.state),
    cases.map((each) => each.state),
  );
});

test("an agent touches its pull request's zones weighted by lines, builds in the largest, and drops the remainder", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: PRODUCT_ZONES,
      agents: [
        factoryAgentOf(1, {
          pullRequest: factoryPullRequestOf({
            areas: [
              areaOf("libs/model/src/parts", 30),
              areaOf("apps/desk", 10),
              areaOf(AREA_PATH.REST, 5),
            ],
          }),
        }),
      ],
    }),
  );

  const [agent] = view.agents;
  assert.equal(agent?.primaryZone, "libs/model");
  assert.deepEqual(agent?.touched, [
    { path: "libs/model", lines: 30, weight: 0.75 },
    { path: "apps/desk", lines: 10, weight: 0.25 },
  ]);
});

test("an agent with no pull request builds in its task's zone, where the task's other work landed most", () => {
  const taskId = uuidOf(99);
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: PRODUCT_ZONES,
      agents: [
        factoryAgentOf(1, { taskId }),
        factoryAgentOf(2, {
          taskId,
          pullRequest: factoryPullRequestOf({ areas: [areaOf("apps/site", 20)] }),
        }),
        factoryAgentOf(3, {
          pullRequest: factoryPullRequestOf({ areas: [areaOf("libs/base", 500)] }),
        }),
      ],
      shipped: [
        factoryShippedOf(7, FACTORY_NOW - DAY_MS, {
          taskId,
          areas: [areaOf("apps/site", 5), areaOf("services/api", 15)],
        }),
      ],
    }),
  );

  const lone = view.agentById.get(uuidOf(1));
  assert.equal(lone?.primaryZone, "apps/site");
  assert.deepEqual(lone?.touched, []);
  assert.equal(lone?.buildSize, 0);
});

test("a task's pull request an agent merged counts once toward the task's zone", () => {
  const taskId = uuidOf(99);
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: PRODUCT_ZONES,
      agents: [
        factoryAgentOf(1, { taskId }),
        factoryAgentOf(2, {
          taskId,
          status: CODING_AGENT_STATUS.COMPLETED,
          pullRequest: factoryPullRequestOf({
            number: 10,
            state: PULL_REQUEST_STATE.MERGED,
            areas: [areaOf("apps/desk", 10)],
          }),
        }),
      ],
      shipped: [
        factoryShippedOf(10, FACTORY_NOW - DAY_MS, {
          taskId,
          agentId: uuidOf(2),
          areas: [areaOf("apps/desk", 10)],
        }),
        factoryShippedOf(11, FACTORY_NOW - DAY_MS, { taskId, areas: [areaOf("apps/site", 15)] }),
      ],
    }),
  );

  assert.equal(view.agentById.get(uuidOf(1))?.primaryZone, "apps/site");
});

test("an agent's kind is its title's Conventional Commits type, else unknown", () => {
  const titles = [
    "fix(ui)!: stop the flicker",
    "refactor: fold the reader",
    "FEAT(web): shout",
    "wip: something",
    "Make it work",
  ];
  const view = factoryWorldViewOf(
    factoryWorldOf({
      agents: [
        ...titles.map((title, index) =>
          factoryAgentOf(index, { pullRequest: factoryPullRequestOf({ title }) }),
        ),
        factoryAgentOf(titles.length, { title: "docs: before the pull request" }),
      ],
    }),
  );

  assert.deepEqual(
    view.agents.map((agent) => agent.kind),
    [
      AGENT_KIND.FIX,
      AGENT_KIND.REFACTOR,
      AGENT_KIND.FEAT,
      AGENT_KIND.UNKNOWN,
      AGENT_KIND.UNKNOWN,
      AGENT_KIND.DOCS,
    ],
  );
});

test("a build grows with its pull request's lines on a log scale and stops at full size", () => {
  const lines = [10, 100, 1000, BUILD_FULL_LINES, BUILD_FULL_LINES * 4];
  const view = factoryWorldViewOf(
    factoryWorldOf({
      agents: lines.map((count, index) =>
        factoryAgentOf(index, {
          pullRequest: factoryPullRequestOf({ additions: count, deletions: 0 }),
        }),
      ),
    }),
  );
  const [ten, hundred, thousand, full, past] = view.agents.map((agent) => agent.buildSize);

  assert.ok(ten !== undefined && hundred !== undefined && thousand !== undefined);
  assert.ok(ten > 0 && ten < hundred && hundred < thousand && thousand < 1);
  assert.ok(thousand / hundred < 2, "a tenfold pull request is not drawn tenfold");
  assert.equal(full, 1);
  assert.equal(past, 1);
});

/* ----- Blast radius ----- */

test("a selected agent's blast radius is what it touched, then every zone depending on that, by its fewest steps away", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: PRODUCT_ZONES,
      agents: [
        factoryAgentOf(1, {
          pullRequest: factoryPullRequestOf({ areas: [areaOf("kits/widgets", 8)] }),
        }),
        factoryAgentOf(2, {
          pullRequest: factoryPullRequestOf({ areas: [areaOf("libs/model", 8)] }),
        }),
      ],
    }),
  );

  assert.deepEqual(blastRadiusOf(view, uuidOf(1)), [
    { path: "kits/widgets", distance: 0 },
    { path: "apps/desk", distance: 1 },
  ]);
  assert.deepEqual(blastRadiusOf(view, uuidOf(2)), [
    { path: "libs/model", distance: 0 },
    { path: "apps/desk", distance: 1 },
    { path: "kits/widgets", distance: 1 },
    { path: "services/api", distance: 1 },
    { path: "apps/site", distance: 2 },
  ]);
});

test("an agent with no zone of its own, or one the view does not hold, has no blast radius", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({ zones: PRODUCT_ZONES, agents: [factoryAgentOf(1)] }),
  );

  assert.deepEqual(blastRadiusOf(view, uuidOf(1)), []);
  assert.deepEqual(blastRadiusOf(view, uuidOf(2)), []);
});

/* ----- Shipped and the timeline ----- */

test("a zone glows brighter for a recent merge than an old one, brighter still for more, and never fully", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: PRODUCT_ZONES,
      shipped: [
        factoryShippedOf(1, FACTORY_NOW - HOUR_MS, { areas: [areaOf("apps/desk", 5)] }),
        factoryShippedOf(2, FACTORY_NOW - 7 * DAY_MS, { areas: [areaOf("apps/site", 5)] }),
        factoryShippedOf(3, FACTORY_NOW - HOUR_MS, { areas: [areaOf("libs/base", 5)] }),
        factoryShippedOf(4, FACTORY_NOW - HOUR_MS, { areas: [areaOf("libs/base", 5)] }),
      ],
    }),
  );
  const alive = (path: string) => zoneOf(view, path).alive;

  assert.ok(alive("apps/desk") > alive("apps/site"));
  assert.ok(alive("apps/site") > 0);
  assert.ok(alive("libs/base") > alive("apps/desk"));
  assert.ok(alive("libs/base") < 1);
  assert.equal(alive("services/api"), 0);
});

test("the timeline runs in merge order, equal instants by number, each with the zones it landed in", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      zones: PRODUCT_ZONES,
      shipped: [
        factoryShippedOf(30, FACTORY_NOW - HOUR_MS, { areas: [areaOf("apps/desk", 1)] }),
        factoryShippedOf(12, FACTORY_NOW - DAY_MS, {
          areas: [areaOf("libs/base/src", 3), areaOf("apps/site", 1), areaOf("elsewhere", 2)],
        }),
        factoryShippedOf(11, FACTORY_NOW - DAY_MS),
      ],
    }),
  );

  assert.deepEqual(
    view.timeline.map((entry) => [entry.number, entry.zonePaths]),
    [
      [11, []],
      [12, ["apps/site", "libs/base"]],
      [30, ["apps/desk"]],
    ],
  );
});

/* ----- Pipeline ----- */

test("the pipeline counts planned issues, agents building with the stuck apart, merges, and defects", () => {
  const view = factoryWorldViewOf(
    factoryWorldOf({
      agents: [
        factoryAgentOf(1),
        factoryAgentOf(2, {
          status: CODING_AGENT_STATUS.COMPLETED,
          pullRequest: factoryPullRequestOf(),
        }),
        factoryAgentOf(3, {
          status: CODING_AGENT_STATUS.COMPLETED,
          pullRequest: factoryPullRequestOf({ state: PULL_REQUEST_STATE.DRAFT }),
        }),
        factoryAgentOf(4, { status: CODING_AGENT_STATUS.FAILED }),
        factoryAgentOf(5, { status: CODING_AGENT_STATUS.CANCELLED }),
      ],
      shipped: [
        factoryShippedOf(1, FACTORY_NOW - DAY_MS),
        factoryShippedOf(2, FACTORY_NOW - DAY_MS),
      ],
      planned: [factoryPlannedOf(1), factoryPlannedOf(2), factoryPlannedOf(3)],
      defects: [factoryDefectOf(1)],
    }),
  );

  assert.deepEqual(view.pipeline, { planned: 3, building: 2, stuck: 1, shipped: 2, defects: 1 });
});

/* ----- Time ----- */

test("wound back to an instant, a world holds only the merges by then, and a pull request merged later is still open", () => {
  const instant = FACTORY_NOW - 2 * DAY_MS;
  const world = factoryWorldOf({
    zones: PRODUCT_ZONES,
    agents: [
      factoryAgentOf(1, {
        status: CODING_AGENT_STATUS.COMPLETED,
        activityAt: FACTORY_NOW - HOUR_MS,
        pullRequest: factoryPullRequestOf({
          number: 40,
          state: PULL_REQUEST_STATE.MERGED,
          openedAt: FACTORY_NOW - 3 * DAY_MS,
          areas: [areaOf("apps/desk", 9)],
        }),
      }),
      factoryAgentOf(2, {
        pullRequest: factoryPullRequestOf({ number: 41, openedAt: FACTORY_NOW - DAY_MS }),
      }),
    ],
    shipped: [
      factoryShippedOf(39, FACTORY_NOW - 5 * DAY_MS, { areas: [areaOf("apps/site", 1)] }),
      factoryShippedOf(40, FACTORY_NOW - HOUR_MS, {
        agentId: uuidOf(1),
        areas: [areaOf("apps/desk", 9)],
      }),
    ],
  });

  const view = factoryWorldViewOf(factoryWorldAsOf(world, instant));

  assert.equal(view.snapshotAt, instant);
  assert.deepEqual(
    view.timeline.map((entry) => entry.number),
    [39],
  );
  assert.equal(view.pipeline.shipped, 1);
  assert.equal(view.agentById.get(uuidOf(1))?.state, AGENT_STATE.WAITING);
  assert.equal(view.agentById.get(uuidOf(2))?.agent.pullRequest, null);
  assert.equal(zoneOf(view, "apps/desk").alive, 0);
  assert.ok(zoneOf(view, "apps/site").alive > 0);
});

test("an instant outside the window is held to its nearer end", () => {
  const world = factoryWorldOf({
    shipped: [factoryShippedOf(1, FACTORY_NOW - DAY_MS)],
  });

  assert.equal(factoryWorldAsOf(world, FACTORY_NOW + DAY_MS).snapshotAt, FACTORY_NOW);
  assert.equal(factoryWorldAsOf(world, FACTORY_NOW + DAY_MS).shipped.length, 1);
  assert.equal(factoryWorldAsOf(world, 0).snapshotAt, world.shippedSince);
  assert.equal(factoryWorldAsOf(world, 0).shipped.length, 0);
});

test("a snapshot naming as many merges as it may opens its window at the oldest, before which it cannot say what merged", () => {
  const oldest = FACTORY_NOW - 3 * DAY_MS;
  const world = factoryWorldOf({
    shipped: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_SHIPPED }, (_, index) =>
      factoryShippedOf(index + 1, oldest + index * 60_000),
    ),
  });

  const wound = factoryWorldAsOf(world, FACTORY_NOW - 10 * DAY_MS);

  assert.equal(factoryWorldViewOf(world).shippedSince, oldest);
  assert.equal(wound.snapshotAt, oldest);
  assert.equal(factoryWorldViewOf(wound).shippedSince, oldest);
  assert.equal(wound.shipped.length, 1);
});
