import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { type FactoryWorld, LINEAR_PRIORITY } from "@luke/features/factory-world-wire";
import { factoryWorldViewOf, SCENE_GROUND, SIGNAL_COLOR } from "@luke/ui/factory-world";
import {
  areaOf,
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
} from "@luke/ui/testing";
import {
  type InstancedMesh,
  Matrix4,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Points,
  Scene,
} from "three";
import { test } from "vitest";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldHost,
  type WorldInstance,
  type WorldLayers,
  type WorldState,
} from "../../world";
import { world } from "./index";

/**
 * station.test.ts -- the Orbital Station as picking and the renderer see it, with no WebGL: every zone, agent, shipped pull request, planned issue and defect it draws is there to pick, each layer switched off takes what it names out of reach, the station follows its zones and their dependencies as they change, a still frame is the same on every redraw, and its idle traffic keeps its own pace through hovers and scrubs.
 *
 * The host is a stand-in that keeps what the world registers, and asks of
 * it what the scene host's picking would: whether the object stands shown,
 * and, for an instanced mesh, which of its drawn instances stand for what.
 * Where a signal is drawn but not picked, the conduits and the streaks of
 * light, the test reads the scene the renderer would draw.
 */

/** A repository of a core everything depends on, a domain between, a surface at the edge, and its scripts. */
const ZONES = [
  factoryZoneOf("packages/core", [], { bytes: 40_000 }),
  factoryZoneOf("packages/service", ["packages/core"], { bytes: 30_000 }),
  factoryZoneOf("packages/voice", ["packages/core"], { bytes: 9_000 }),
  factoryZoneOf("apps/web", ["packages/service", "packages/core"], { bytes: 20_000 }),
  factoryZoneOf("apps/desktop", ["packages/service", "packages/voice", "packages/core"], {
    bytes: 50_000,
  }),
  factoryZoneOf("scripts", [], { bytes: 2_000 }),
];

/** One agent of each state that draws differently, and one placed nowhere. */
const AGENTS = [
  factoryAgentOf(1, {
    pullRequest: factoryPullRequestOf({
      number: 11,
      areas: [areaOf("apps/web/src", 400), areaOf("packages/core/src", 60)],
    }),
  }),
  factoryAgentOf(2, {
    status: CODING_AGENT_STATUS.COMPLETED,
    pullRequest: factoryPullRequestOf({
      number: 12,
      state: PULL_REQUEST_STATE.DRAFT,
      areas: [areaOf("apps/desktop/src", 90)],
    }),
  }),
  factoryAgentOf(3, {
    status: CODING_AGENT_STATUS.FAILED,
    pullRequest: factoryPullRequestOf({ number: 13, areas: [areaOf("packages/voice/src", 5_000)] }),
  }),
  factoryAgentOf(4),
];

const WORLD: FactoryWorld = factoryWorldOf({
  zones: ZONES,
  agents: AGENTS,
  shipped: [
    factoryShippedOf(21, FACTORY_NOW - 2 * HOUR_MS, { areas: [areaOf("apps/web/src", 30)] }),
    factoryShippedOf(22, FACTORY_NOW - 30 * HOUR_MS, {
      areas: [areaOf("packages/service/src", 300), areaOf("scripts/build.mjs", 4)],
    }),
  ],
  planned: [
    factoryPlannedOf(31, {
      zonePaths: ["apps/desktop", "packages/voice"],
      priority: LINEAR_PRIORITY.URGENT,
    }),
    factoryPlannedOf(32),
  ],
  defects: [
    factoryDefectOf(41, { events: 120, zonePaths: ["packages/service"] }),
    factoryDefectOf(42, { events: 3 }),
  ],
});

const EVERY_LAYER: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

/** What the world registered to be picked. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instance: number) => PickTarget | undefined;
    };

/** A host whose picking keeps the world's registrations, and lets go of one when the world takes it back. */
function stubHost() {
  const registrations = new Set<Registration>();
  const keep = (registration: Registration) => {
    registrations.add(registration);
    return () => {
      registrations.delete(registration);
    };
  };
  const host: WorldHost = {
    scene: new Scene(),
    camera: {
      camera: new PerspectiveCamera(),
      setHome: () => undefined,
      setReach: () => undefined,
    },
    palette: { signal: SIGNAL_COLOR, ground: SCENE_GROUND },
    picking: {
      add: (object, target) => keep({ object, target }),
      addInstances: (object, targetOf) => keep({ object, targetOf }),
    },
    invalidate: () => undefined,
  };
  return { host, registrations };
}

function stateOf(snapshot: FactoryWorld, fields: Partial<WorldState> = {}): WorldState {
  return {
    view: factoryWorldViewOf(snapshot),
    snapshot,
    live: true,
    selected: undefined,
    hovered: undefined,
    blast: new Map(),
    layers: EVERY_LAYER,
    still: false,
    dark: true,
    ...fields,
  };
}

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

/** Every target the developer could pick: each shown registration's, and each drawn instance's. */
function pickable(registrations: ReadonlySet<Registration>): PickTarget[] {
  return [...registrations].flatMap((registration) => {
    if (!shown(registration.object)) return [];
    if ("target" in registration) return [registration.target];
    return Array.from(
      { length: registration.object.count },
      (_, instance) => registration.targetOf(instance) ?? [],
    ).flat();
  });
}

/** The ids of `kind` among `targets`, once each, sorted. */
function idsOf(targets: readonly PickTarget[], kind: PickKind): string[] {
  return [
    ...new Set(targets.filter((target) => target.kind === kind).map((target) => target.id)),
  ].sort();
}

function created(snapshot: FactoryWorld, fields: Partial<WorldState> = {}) {
  const { host, registrations } = stubHost();
  const instance = world.create(host);
  instance.update(stateOf(snapshot, fields));
  return { instance, registrations };
}

test("every zone, agent, shipped pull request, planned issue and defect stands to be picked", () => {
  const { registrations } = created(WORLD);
  const targets = pickable(registrations);

  assert.deepEqual(idsOf(targets, PICK_KIND.ZONE), ZONES.map((zone) => zone.path).sort());
  assert.deepEqual(idsOf(targets, PICK_KIND.AGENT), AGENTS.map((agent) => agent.id).sort());
  assert.deepEqual(
    idsOf(targets, PICK_KIND.SHIPPED),
    WORLD.shipped.map((merged) => merged.url).sort(),
  );
  assert.deepEqual(idsOf(targets, PICK_KIND.PLANNED), ["ENG-31", "ENG-32"]);
  assert.deepEqual(idsOf(targets, PICK_KIND.DEFECT), ["41", "42"]);
});

test("each layer switched off takes what it names out of reach, and leaves the rest", () => {
  const off = (layer: keyof WorldLayers) =>
    pickable(created(WORLD, { layers: { ...EVERY_LAYER, [layer]: false } }).registrations);

  const unplanned = off("planned");
  assert.deepEqual(idsOf(unplanned, PICK_KIND.PLANNED), []);
  assert.deepEqual(idsOf(unplanned, PICK_KIND.DEFECT), ["41", "42"]);

  // Note that a failed agent is no building, so it stands with the building switched off.
  const unbuilt = off("building");
  assert.deepEqual(idsOf(unbuilt, PICK_KIND.AGENT), [uuidOf(3)]);
  assert.equal(idsOf(unbuilt, PICK_KIND.SHIPPED).length, 2);

  const unshipped = off("shipped");
  assert.deepEqual(idsOf(unshipped, PICK_KIND.SHIPPED), []);
  assert.equal(idsOf(unshipped, PICK_KIND.AGENT).length, 4);

  const undamaged = off("defects");
  assert.deepEqual(idsOf(undamaged, PICK_KIND.DEFECT), []);
  assert.deepEqual(idsOf(undamaged, PICK_KIND.PLANNED), ["ENG-31", "ENG-32"]);
  assert.equal(idsOf(undamaged, PICK_KIND.ZONE).length, ZONES.length);
});

test("the station follows its zones: one that comes stands to be picked, and one that goes no longer does", () => {
  const { host, registrations } = stubHost();
  const instance = world.create(host);
  instance.update(stateOf(WORLD));
  const grown = factoryWorldOf({
    ...WORLD,
    zones: [
      ...ZONES.filter((zone) => zone.path !== "packages/voice"),
      factoryZoneOf("apps/docs", ["packages/core"]),
    ],
  });

  instance.update(stateOf(grown));

  const zones = idsOf(pickable(registrations), PICK_KIND.ZONE);
  assert.ok(zones.includes("apps/docs"));
  assert.ok(!zones.includes("packages/voice"));
  instance.dispose();
  assert.deepEqual(idsOf(pickable(registrations), PICK_KIND.ZONE), []);
});

test("held still, the crew stands in the same place on every redraw, and in every world drawn of the same snapshot", () => {
  const placesOf = (registrations: ReadonlySet<Registration>) =>
    [...registrations].flatMap((registration) => {
      if ("target" in registration || registration.targetOf(0)?.kind !== PICK_KIND.AGENT) return [];
      const matrix = new Matrix4();
      return Array.from({ length: registration.object.count }, (_, instance) => {
        registration.object.getMatrixAt(instance, matrix);
        return matrix.elements.map((value) => Math.round(value * 1e4) / 1e4);
      });
    });
  const first = created(WORLD, { still: true });
  const before = placesOf(first.registrations);
  first.instance.update(
    stateOf(WORLD, { still: true, hovered: { kind: PICK_KIND.ZONE, id: "apps/web" } }),
  );

  assert.equal(before.length, AGENTS.length);
  assert.deepEqual(placesOf(first.registrations), before);
  assert.deepEqual(placesOf(created(WORLD, { still: true }).registrations), before);
});

/** Steps `instance` through `seconds` of motion at thirty frames a second from `from`, calling `between` before each frame; answers where it stopped. */
function run(
  instance: WorldInstance,
  from: number,
  seconds: number,
  between: (at: number) => void = () => undefined,
): number {
  let at = from;
  for (; at < from + seconds; at += 1 / 30) {
    between(at);
    instance.frame?.(1 / 30, at);
  }
  return at;
}

/** Each dependency the conduits join, as the paths of the zone depending and the zone depended on. */
function conduitsDrawn(scene: Scene, zones: readonly { path: string }[]): string[][] {
  const pairs = new Map<number, Set<number>>();
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    if (!object.geometry.hasAttribute("aFrom") || !object.geometry.hasAttribute("aTo")) return;
    const from = object.geometry.getAttribute("aFrom");
    const to = object.geometry.getAttribute("aTo");
    for (let vertex = 0; vertex < from.count; vertex += 1) {
      const joined = pairs.get(from.getX(vertex)) ?? new Set<number>();
      joined.add(to.getX(vertex));
      pairs.set(from.getX(vertex), joined);
    }
  });
  return [...pairs]
    .flatMap(([from, tos]) =>
      [...tos].map((to) => [zones[from]?.path ?? "", zones[to]?.path ?? ""]),
    )
    .sort((left, right) => left.join().localeCompare(right.join()));
}

/** How many points of light the scene draws: every point within a cloud's range not shrunk to nothing. */
function pointsLit(scene: Scene): number {
  let lit = 0;
  scene.traverse((object) => {
    if (!(object instanceof Points) || !shown(object)) return;
    const size = object.geometry.getAttribute("size");
    if (size === undefined) return;
    const end = Math.min(
      size.count,
      object.geometry.drawRange.start + object.geometry.drawRange.count,
    );
    for (let point = object.geometry.drawRange.start; point < end; point += 1) {
      if (size.getX(point) > 0) lit += 1;
    }
  });
  return lit;
}

test("the conduits follow the dependencies: one dropped while the zones stand as they were is no longer drawn", () => {
  const { host } = stubHost();
  const instance = world.create(host);
  instance.update(stateOf(WORLD));
  const before = conduitsDrawn(host.scene, factoryWorldViewOf(WORLD).zones);
  assert.ok(before.some(([from, to]) => from === "apps/desktop" && to === "packages/core"));

  // Note that the desktop still reaches the core through the service, so every zone stands where it stood.
  const loosened = factoryWorldOf({
    ...WORLD,
    zones: ZONES.map((zone) =>
      zone.path === "apps/desktop"
        ? { ...zone, dependsOn: ["packages/service", "packages/voice"] }
        : zone,
    ),
  });
  instance.update(stateOf(loosened));

  const after = conduitsDrawn(host.scene, factoryWorldViewOf(loosened).zones);
  assert.ok(!after.some(([from, to]) => from === "apps/desktop" && to === "packages/core"));
  assert.ok(after.some(([from, to]) => from === "apps/desktop" && to === "packages/service"));
});

test("a planned ship sends its blueprint down while the developer's pointer moves over the station", () => {
  const planned = factoryWorldOf({
    zones: ZONES,
    planned: [
      factoryPlannedOf(31, { zonePaths: ["apps/desktop"], priority: LINEAR_PRIORITY.URGENT }),
    ],
  });
  const { host } = stubHost();
  const instance = world.create(host);
  instance.update(stateOf(planned));
  const resting = pointsLit(host.scene);
  let brightest = resting;

  run(instance, 0, 10, (at) => {
    // Note that the pointer crosses a new zone every quarter second, and each crossing redraws the world.
    if (Math.round(at * 30) % 8 === 0) {
      const zone = ZONES[Math.round(at * 4) % ZONES.length]?.path ?? "apps/web";
      instance.update(stateOf(planned, { hovered: { kind: PICK_KIND.ZONE, id: zone } }));
    }
    brightest = Math.max(brightest, pointsLit(host.scene));
  });

  assert.ok(brightest > resting, "a blueprint's streak of light was drawn");
});

test("back at now after a scrub, the cargo pods launch again from the oldest merge", () => {
  const merges = [
    factoryShippedOf(51, FACTORY_NOW - 30 * HOUR_MS, { areas: [areaOf("apps/web/src", 10)] }),
    factoryShippedOf(52, FACTORY_NOW - 20 * HOUR_MS, { areas: [areaOf("apps/desktop/src", 10)] }),
    factoryShippedOf(53, FACTORY_NOW - 2 * HOUR_MS, {
      areas: [areaOf("packages/service/src", 10)],
    }),
  ];
  const shipped = factoryWorldOf({ zones: ZONES, shipped: merges });
  const { host, registrations } = stubHost();
  const instance = world.create(host);
  /** How many things stand to be picked for each merge: its light, and its pod while one flies. */
  const picksOf = () =>
    merges.map(
      (merged) => pickable(registrations).filter((target) => target.id === merged.url).length,
    );
  instance.update(stateOf(shipped));
  const stopped = run(instance, 0, 0.6);
  assert.deepEqual(picksOf(), [2, 1, 1]);

  instance.update(stateOf(shipped, { live: false }));
  assert.deepEqual(picksOf(), [1, 1, 1]);
  instance.update(stateOf(shipped));
  run(instance, stopped, 0.6);

  assert.deepEqual(picksOf(), [2, 1, 1]);
});
