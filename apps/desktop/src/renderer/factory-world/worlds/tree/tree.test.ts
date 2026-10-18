import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  FACTORY_WORLD_BOUNDS,
  type FactoryWorld,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldHost,
  type WorldLayers,
  type WorldState,
} from "@luke/panel/factory-world/world";
import {
  factoryWorldAsOf,
  factoryWorldViewOf,
  SCENE_GROUND,
  SIGNAL_COLOR,
} from "@luke/ui/factory-world";
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
} from "@luke/ui/testing";
import { type InstancedMesh, Matrix4, type Object3D, PerspectiveCamera, Scene } from "three";
import { test } from "vitest";
import { world } from "./index";

/**
 * tree.test.ts -- the World Tree as picking sees it, with no WebGL: every zone, agent, shipped pull request, planned issue and defect it grows is there to pick, each layer switched off takes what it names out of reach, a scrub leaves every zone where it stood, a zone that comes regrows the tree with it, and a still frame lays every gardener the same way on every redraw.
 *
 * The host is a stand-in that keeps what the world registers and asks of it
 * what the scene host's picking would: whether the object stands shown, and,
 * for an instanced mesh, what each drawn instance stands for and where.
 */

/** A repository of a core both products lean on, a domain package with a feature inside it, an app at the edge, and its scripts. */
const ZONES = [
  factoryZoneOf("packages/core", [], { bytes: 40_000 }),
  factoryZoneOf("packages/service", ["packages/core"], { bytes: 30_000 }),
  factoryZoneOf("packages/service/src/tasks", ["packages/service", "packages/core"], {
    bytes: 12_000,
  }),
  factoryZoneOf("apps/web", ["packages/service", "packages/core"], { bytes: 20_000 }),
  factoryZoneOf("apps/desktop", ["packages/service", "packages/core"], { bytes: 50_000 }),
  factoryZoneOf("scripts", [], { bytes: 2_000 }),
];

/** An agent at work, one stuck on a draft, one failed, and one with no pull request placed on no zone. */
const AGENTS = [
  factoryAgentOf(1, {
    pullRequest: factoryPullRequestOf({
      number: 11,
      title: "feat(web): invite a teammate",
      openedAt: FACTORY_NOW - 3 * DAY_MS,
      areas: [areaOf("apps/web/src", 400), areaOf("packages/core/src", 60)],
    }),
  }),
  factoryAgentOf(2, {
    status: CODING_AGENT_STATUS.COMPLETED,
    pullRequest: factoryPullRequestOf({
      number: 12,
      title: "refactor(desktop): fold the panes",
      state: PULL_REQUEST_STATE.DRAFT,
      areas: [areaOf("apps/desktop/src", 90)],
    }),
  }),
  factoryAgentOf(3, {
    status: CODING_AGENT_STATUS.FAILED,
    pullRequest: factoryPullRequestOf({
      number: 13,
      title: "fix(core): keep the ledger",
      areas: [areaOf("packages/core/src", 5_000)],
    }),
  }),
  factoryAgentOf(4),
];

const WORLD: FactoryWorld = factoryWorldOf({
  zones: ZONES,
  agents: AGENTS,
  shipped: [
    factoryShippedOf(21, FACTORY_NOW - 2 * HOUR_MS, { areas: [areaOf("apps/web/src", 30)] }),
    factoryShippedOf(22, FACTORY_NOW - 5 * DAY_MS, {
      areas: [areaOf("packages/service/src/tasks", 300), areaOf("scripts", 4)],
    }),
  ],
  planned: [
    factoryPlannedOf(31, {
      zonePaths: ["apps/desktop", "packages/core"],
      priority: LINEAR_PRIORITY.URGENT,
    }),
    factoryPlannedOf(32),
  ],
  defects: [
    factoryDefectOf(41, { events: 120, zonePaths: ["packages/core"] }),
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

/** A host whose picking keeps the world's registrations. */
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
    dark: false,
    ...fields,
  };
}

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

/** Every drawn target the developer could pick, with where it stands. */
function placed(registrations: ReadonlySet<Registration>) {
  const matrix = new Matrix4();
  return [...registrations].flatMap((registration) => {
    if (!shown(registration.object)) return [];
    if ("target" in registration) return [{ target: registration.target, at: [0, 0, 0] }];
    return Array.from({ length: registration.object.count }, (_, instance) => {
      const target = registration.targetOf(instance);
      if (target === undefined) return [];
      registration.object.getMatrixAt(instance, matrix);
      const at = [12, 13, 14].map((cell) => Math.round((matrix.elements[cell] ?? 0) * 1e3) / 1e3);
      return [{ target, at }];
    }).flat();
  });
}

/** The ids of `kind` the developer could pick, once each, sorted. */
function idsOf(registrations: ReadonlySet<Registration>, kind: PickKind): string[] {
  const ids = placed(registrations)
    .filter(({ target }) => target.kind === kind)
    .map(({ target }) => target.id);
  return [...new Set(ids)].sort();
}

/** Where each zone first stands to be picked: the spot a flight to it aims at. */
function zoneSpots(registrations: ReadonlySet<Registration>): Map<string, number[]> {
  const spots = new Map<string, number[]>();
  for (const { target, at } of placed(registrations)) {
    if (target.kind === PICK_KIND.ZONE && !spots.has(target.id)) spots.set(target.id, at);
  }
  return spots;
}

function created(snapshot: FactoryWorld, fields: Partial<WorldState> = {}) {
  const { host, registrations } = stubHost();
  const instance = world.create(host);
  instance.update(stateOf(snapshot, fields));
  return { instance, registrations };
}

test("every zone, agent, shipped pull request, planned issue and defect grows somewhere to be picked", () => {
  const { registrations } = created(WORLD);

  assert.deepEqual(idsOf(registrations, PICK_KIND.ZONE), ZONES.map((zone) => zone.path).sort());
  assert.deepEqual(idsOf(registrations, PICK_KIND.AGENT), AGENTS.map((agent) => agent.id).sort());
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.SHIPPED),
    WORLD.shipped.map((merged) => merged.url).sort(),
  );
  assert.deepEqual(idsOf(registrations, PICK_KIND.PLANNED), ["ENG-31", "ENG-32"]);
  assert.deepEqual(idsOf(registrations, PICK_KIND.DEFECT), ["41", "42"]);
});

test("each layer switched off takes what it names out of reach, and leaves the rest", () => {
  const off = (layer: keyof WorldLayers) =>
    created(WORLD, { layers: { ...EVERY_LAYER, [layer]: false } }).registrations;

  const unplanned = off("planned");
  assert.deepEqual(idsOf(unplanned, PICK_KIND.PLANNED), []);
  assert.deepEqual(idsOf(unplanned, PICK_KIND.DEFECT), ["41", "42"]);

  // Note that a failed agent is a defect as much as a builder, so it stands with the building switched off.
  const unbuilt = off("building");
  assert.deepEqual(idsOf(unbuilt, PICK_KIND.AGENT), [uuidOf(3)]);
  assert.equal(idsOf(unbuilt, PICK_KIND.SHIPPED).length, 2);

  const unshipped = off("shipped");
  assert.deepEqual(idsOf(unshipped, PICK_KIND.SHIPPED), []);
  assert.equal(idsOf(unshipped, PICK_KIND.AGENT).length, AGENTS.length);

  const undamaged = off("defects");
  assert.deepEqual(idsOf(undamaged, PICK_KIND.DEFECT), []);
  assert.deepEqual(idsOf(undamaged, PICK_KIND.PLANNED), ["ENG-31", "ENG-32"]);
  assert.equal(idsOf(undamaged, PICK_KIND.ZONE).length, ZONES.length);
});

test("wound back, every zone stands where it stood and only what had merged by then blossoms", () => {
  const { instance, registrations } = created(WORLD);
  const now = zoneSpots(registrations);

  instance.update(stateOf(factoryWorldAsOf(WORLD, FACTORY_NOW - DAY_MS), { live: false }));

  assert.deepEqual(zoneSpots(registrations), now);
  assert.deepEqual(idsOf(registrations, PICK_KIND.SHIPPED), [WORLD.shipped[1]?.url].sort());
});

test("a zone that comes grows a branch of its own, and one that goes takes its branch with it", () => {
  const { instance, registrations } = created(WORLD);
  const grown = factoryWorldOf({
    ...WORLD,
    zones: [
      ...ZONES.filter((zone) => zone.path !== "apps/web"),
      factoryZoneOf("apps/docs", ["packages/service"], { bytes: 8_000 }),
    ],
  });

  instance.update(stateOf(grown));

  const zones = idsOf(registrations, PICK_KIND.ZONE);
  assert.ok(zones.includes("apps/docs"));
  assert.ok(!zones.includes("apps/web"));
});

test("held still, every gardener stands in the same place on every redraw, and in every tree grown of the same snapshot", () => {
  const gardeners = (registrations: ReadonlySet<Registration>) =>
    placed(registrations).filter(({ target }) => target.kind === PICK_KIND.AGENT);
  const first = created(WORLD, { still: true });
  const before = gardeners(first.registrations);

  first.instance.update(
    stateOf(WORLD, { still: true, hovered: { kind: PICK_KIND.ZONE, id: "apps/web" } }),
  );

  assert.ok(before.length >= AGENTS.length);
  assert.deepEqual(gardeners(first.registrations), before);
  assert.deepEqual(gardeners(created(WORLD, { still: true }).registrations), before);
});

test("at the contract's bounds, every planned issue and every defect still grows somewhere to be picked", () => {
  const zones = Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_PLACES }, (_, index) =>
    factoryZoneOf(`packages/zone-${index}`, index === 0 ? [] : ["packages/zone-0"]),
  );
  const paths = zones.map((zone) => zone.path);
  const crowded = factoryWorldOf({
    zones,
    planned: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_PLANNED }, (_, index) =>
      factoryPlannedOf(index, { zonePaths: paths }),
    ),
    defects: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_DEFECTS }, (_, index) =>
      factoryDefectOf(index, { events: 10_000, zonePaths: [paths[index % paths.length] ?? "."] }),
    ),
  });

  const { registrations } = created(crowded);

  assert.equal(idsOf(registrations, PICK_KIND.PLANNED).length, FACTORY_WORLD_BOUNDS.MAX_PLANNED);
  assert.equal(idsOf(registrations, PICK_KIND.DEFECT).length, FACTORY_WORLD_BOUNDS.MAX_DEFECTS);
});
