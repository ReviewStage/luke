import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { FACTORY_WORLD_BOUNDS, type FactoryWorld } from "@luke/features/factory-world-wire";
import { AREA_PATH } from "@luke/features/pull-request-area";
import {
  blastRadiusOf,
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
import {
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { test } from "vitest";
import { type ScenePicking, scenePicking } from "../../scene/picking";
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
 * citadel.test.ts -- the Citadel built on a stand-in host, without WebGL: every item of the reading drawn where it can be picked, at the snapshot's bounds too, each layer switch hiding what it names and nothing else, and the scrubber's instant redrawn from the view alone.
 *
 * The host is the real picking (`scene/picking.ts`) over a plain scene and
 * camera; what a world registers with it is recorded beside it, so a test
 * reads what the pointer could land on as the host does: a shown object, or
 * an instance within its mesh's count.
 */

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

/** What the world registered to be picked: one object as one target, or an instanced mesh's instances. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly mesh: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

/** A host over a plain scene and the real picking, recording each registration. */
/** A stand-in host, and what the world registered with it. */
interface StandIn {
  readonly host: WorldHost;
  readonly picking: ScenePicking;
  readonly registrations: Registration[];
}

function standInHost(): StandIn {
  const registrations: Registration[] = [];
  const picking = scenePicking();
  const host: WorldHost = {
    scene: new Scene(),
    camera: {
      camera: new PerspectiveCamera(),
      setHome: () => undefined,
      setReach: () => undefined,
    },
    palette: { signal: SIGNAL_COLOR, ground: SCENE_GROUND },
    picking: {
      add: (object, target) => {
        registrations.push({ object, target });
        return picking.add(object, target);
      },
      addInstances: (mesh, targetOf) => {
        registrations.push({ mesh, targetOf });
        return picking.addInstances(mesh, targetOf);
      },
    },
    invalidate: () => undefined,
  };
  return { host, picking, registrations };
}

/** Every target the pointer could land on now, as `kind:id`. */
function pickable(registrations: readonly Registration[]): Set<string> {
  const found = new Set<string>();
  for (const registration of registrations) {
    if ("target" in registration) {
      if (shown(registration.object))
        found.add(`${registration.target.kind}:${registration.target.id}`);
      continue;
    }
    if (!shown(registration.mesh)) continue;
    for (let instanceId = 0; instanceId < registration.mesh.count; instanceId += 1) {
      const target = registration.targetOf(instanceId);
      if (target !== undefined) found.add(`${target.kind}:${target.id}`);
    }
  }
  return found;
}

function stateOf(snapshot: FactoryWorld, patch: Partial<WorldState> = {}): WorldState {
  return {
    view: factoryWorldViewOf(snapshot),
    snapshot,
    live: true,
    selected: undefined,
    hovered: undefined,
    blast: new Map(),
    layers: ALL_LAYERS,
    still: true,
    dark: false,
    ...patch,
  };
}

/** The Citadel created on a stand-in host and drawn once. */
/** A world as drawn on a stand-in host, and what it registered there. */
interface Drawn {
  readonly instance: WorldInstance;
  readonly scene: Scene;
  readonly picking: ScenePicking;
  readonly registrations: Registration[];
}

function drawn(state: WorldState): Drawn {
  const { host, picking, registrations } = standInHost();
  const instance = world.create(host);
  instance.update(state);
  return { instance, scene: host.scene, picking, registrations };
}

function idsOf(found: ReadonlySet<string>, kind: PickKind): string[] {
  return [...found]
    .filter((key) => key.startsWith(`${kind}:`))
    .map((key) => key.slice(kind.length + 1))
    .sort();
}

/** How many instances the scene draws, among the shown instanced meshes `drawnIn` picks. */
function instancesDrawn(scene: Scene, drawnIn: (mesh: InstancedMesh) => boolean): number {
  let count = 0;
  scene.traverse((object) => {
    if (object instanceof InstancedMesh && shown(object) && drawnIn(object)) count += object.count;
  });
  return count;
}

/** Whether a mesh's own material is the colour `hex`, as a ring drawn in a signal's colour is. */
function paintedIn(hex: string): (mesh: InstancedMesh) => boolean {
  const wanted = new Color(hex).getHex();
  return (mesh) =>
    (mesh.material instanceof MeshBasicMaterial || mesh.material instanceof MeshStandardMaterial) &&
    mesh.material.color.getHex() === wanted;
}

/** Whether a mesh's own material glows `hex`, as a broken crown's embers do. */
function glowingIn(hex: string): (mesh: InstancedMesh) => boolean {
  const wanted = new Color(hex).getHex();
  return (mesh) =>
    mesh.material instanceof MeshStandardMaterial && mesh.material.emissive.getHex() === wanted;
}

/** How many road segments carry the blast. */
function blastRoads(scene: Scene): number {
  let lit = 0;
  scene.traverse((object) => {
    const road =
      object instanceof InstancedMesh ? object.geometry.getAttribute("aRoad") : undefined;
    if (!(object instanceof InstancedMesh) || road === undefined) return;
    for (let segment = 0; segment < object.count; segment += 1)
      if (road.getZ(segment) > 0) lit += 1;
  });
  return lit;
}

const MERGED_EARLY = FACTORY_NOW - 2 * DAY_MS;
const MERGED_LATE = FACTORY_NOW - HOUR_MS;

/**
 * A repository with a zone on every terrace: a core two packages lean on, a
 * domain package, two apps at the edge, and the root's tooling; agents in
 * every state, one with no zone; merges early and late, one landing in no
 * zone; an issue placed and one not; and defects on a wall and in the keep.
 */
const SNAPSHOT = factoryWorldOf({
  zones: [
    factoryZoneOf(AREA_PATH.ROOT, [], { bytes: 4000 }),
    factoryZoneOf("packages/core", [], { bytes: 9000 }),
    factoryZoneOf("packages/service", ["packages/core"], { bytes: 6000 }),
    factoryZoneOf("apps/web", ["packages/service", "packages/core"], { bytes: 5000 }),
    factoryZoneOf("apps/desktop", ["packages/service", "packages/core"], { bytes: 7000 }),
    factoryZoneOf("scripts", [], { bytes: 800 }),
  ],
  agents: [
    factoryAgentOf(1, {
      pullRequest: factoryPullRequestOf({
        number: 11,
        areas: [areaOf("apps/web", 400), areaOf("packages/service", 120)],
      }),
    }),
    factoryAgentOf(2, {
      status: CODING_AGENT_STATUS.COMPLETED,
      pullRequest: factoryPullRequestOf({ number: 12, areas: [areaOf("packages/core", 30)] }),
    }),
    factoryAgentOf(3, {
      status: CODING_AGENT_STATUS.COMPLETED,
      pullRequest: factoryPullRequestOf({
        number: 13,
        state: PULL_REQUEST_STATE.DRAFT,
        title: "fix(service): mend it",
        areas: [areaOf("packages/service", 60)],
      }),
    }),
    factoryAgentOf(4, {
      status: CODING_AGENT_STATUS.FAILED,
      pullRequest: factoryPullRequestOf({
        number: 14,
        title: "refactor(desktop): rebuild it",
        areas: [areaOf("apps/desktop", 2400)],
      }),
    }),
    factoryAgentOf(5, { status: CODING_AGENT_STATUS.CANCELLED }),
    factoryAgentOf(6),
  ],
  shipped: [
    factoryShippedOf(21, MERGED_EARLY, { areas: [areaOf("packages/core", 80)] }),
    factoryShippedOf(22, MERGED_LATE, {
      areas: [areaOf("apps/web", 300), areaOf("apps/desktop", 40)],
    }),
    factoryShippedOf(23, MERGED_LATE, { areas: [] }),
  ],
  planned: [factoryPlannedOf(1, { zonePaths: ["apps/web"], priority: 1 }), factoryPlannedOf(2)],
  defects: [
    factoryDefectOf(1, { events: 40, zonePaths: ["apps/desktop"] }),
    factoryDefectOf(2, { events: 3, zonePaths: ["packages/core"] }),
    factoryDefectOf(3),
  ],
});

test("every zone, agent, merged pull request, planned issue, and defect is drawn where the pointer can pick it", () => {
  const { registrations } = drawn(stateOf(SNAPSHOT));
  const found = pickable(registrations);
  assert.deepEqual(idsOf(found, PICK_KIND.ZONE), SNAPSHOT.zones.map((zone) => zone.path).sort());
  assert.deepEqual(idsOf(found, PICK_KIND.AGENT), SNAPSHOT.agents.map((agent) => agent.id).sort());
  assert.deepEqual(
    idsOf(found, PICK_KIND.SHIPPED),
    SNAPSHOT.shipped.map((merged) => merged.url).sort(),
  );
  assert.deepEqual(idsOf(found, PICK_KIND.PLANNED), ["ENG-1", "ENG-2"]);
  assert.deepEqual(idsOf(found, PICK_KIND.DEFECT), ["1", "2", "3"]);
});

test("each layer switched off hides what it names, and nothing else; a failed agent stands with its building hidden, as a defect", () => {
  const all = pickable(drawn(stateOf(SNAPSHOT)).registrations);
  const cases: readonly { readonly layer: keyof WorldLayers; readonly hides: PickKind }[] = [
    { layer: "planned", hides: PICK_KIND.PLANNED },
    { layer: "building", hides: PICK_KIND.AGENT },
    { layer: "shipped", hides: PICK_KIND.SHIPPED },
    { layer: "defects", hides: PICK_KIND.DEFECT },
  ];
  for (const { layer, hides } of cases) {
    const found = pickable(
      drawn(stateOf(SNAPSHOT, { layers: { ...ALL_LAYERS, [layer]: false } })).registrations,
    );
    for (const kind of Object.values(PICK_KIND)) {
      const expected =
        kind === hides ? (kind === PICK_KIND.AGENT ? [uuidOf(4)] : []) : idsOf(all, kind);
      assert.deepEqual(idsOf(found, kind), expected, `${layer} off: ${kind}`);
    }
  }
});

test("with one layer drawn alone, a failed agent stands under Defects and not under Planned, on the same world with no defect reported", () => {
  const quiet = { ...SNAPSHOT, defects: [] };
  const alone = (layer: keyof WorldLayers): WorldLayers => ({
    planned: layer === "planned",
    building: layer === "building",
    shipped: layer === "shipped",
    defects: layer === "defects",
  });
  const { instance, registrations } = drawn(stateOf(quiet, { layers: alone("planned") }));
  assert.deepEqual(idsOf(pickable(registrations), PICK_KIND.AGENT), []);
  instance.update(stateOf(quiet, { layers: alone("defects") }));
  assert.deepEqual(idsOf(pickable(registrations), PICK_KIND.AGENT), [uuidOf(4)]);
  instance.update(stateOf(quiet, { layers: alone("shipped") }));
  assert.deepEqual(idsOf(pickable(registrations), PICK_KIND.AGENT), []);
});

test("a layer switched back on draws what it hid again, on the same world", () => {
  const { instance, registrations } = drawn(
    stateOf(SNAPSHOT, { layers: { ...ALL_LAYERS, shipped: false, planned: false } }),
  );
  instance.update(stateOf(SNAPSHOT));
  assert.deepEqual(pickable(registrations), pickable(drawn(stateOf(SNAPSHOT)).registrations));
});

test("scrubbed back, the world draws what the view holds then: no torch for a later merge, and the later merges' torches back at the end", () => {
  const { instance, registrations } = drawn(stateOf(SNAPSHOT));
  instance.update(stateOf(factoryWorldAsOf(SNAPSHOT, MERGED_EARLY + HOUR_MS), { live: false }));
  assert.deepEqual(idsOf(pickable(registrations), PICK_KIND.SHIPPED), [SNAPSHOT.shipped[0]?.url]);
  instance.update(stateOf(SNAPSHOT));
  assert.equal(idsOf(pickable(registrations), PICK_KIND.SHIPPED).length, 3);
});

test("a selected agent's blast, a hover, and the dark appearance redraw without losing a pickable item", () => {
  const view = factoryWorldViewOf(SNAPSHOT);
  const blast = new Map(blastRadiusOf(view, uuidOf(1)).map((zone) => [zone.path, zone.distance]));
  const { instance, registrations } = drawn(stateOf(SNAPSHOT));
  const before = pickable(registrations);
  instance.update(
    stateOf(SNAPSHOT, {
      selected: { kind: PICK_KIND.AGENT, id: uuidOf(1) },
      hovered: { kind: PICK_KIND.ZONE, id: "packages/core" },
      blast,
      dark: true,
      still: false,
    }),
  );
  instance.frame?.(0.016, 1.5);
  assert.deepEqual(pickable(registrations), before);
});

test("at the snapshot's bounds, every zone, agent, merge, issue, and defect is still drawn where it can be picked", () => {
  const packages = Array.from({ length: 60 }, (_, index) => `packages/p${index}`);
  const apps = Array.from({ length: 120 }, (_, index) => `apps/a${index}`);
  const tools = Array.from({ length: 19 }, (_, index) => `.tools/t${index}`);
  const zones = [
    factoryZoneOf("packages/core", [], { bytes: 90_000 }),
    ...packages.map((path, index) =>
      factoryZoneOf(path, ["packages/core"], { bytes: 1000 + index * 400 }),
    ),
    ...apps.map((path, index) =>
      factoryZoneOf(path, [packages[index % packages.length] ?? "packages/core"], {
        bytes: 500 + index * 300,
      }),
    ),
    ...tools.map((path) => factoryZoneOf(path)),
  ];
  const snapshot = factoryWorldOf({
    zones,
    agents: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_AGENTS }, (_, index) =>
      factoryAgentOf(index + 1, {
        pullRequest: factoryPullRequestOf({
          number: index + 1,
          areas: [
            areaOf(apps[index % apps.length] ?? "apps/a0", 50 + index * 40),
            areaOf(packages[index % packages.length] ?? "packages/core", 30),
          ],
        }),
      }),
    ),
    shipped: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_SHIPPED }, (_, index) =>
      factoryShippedOf(1000 + index, FACTORY_NOW - index * HOUR_MS, {
        areas: [
          areaOf(apps[index % apps.length] ?? "apps/a0", 20),
          areaOf(packages[index % packages.length] ?? "packages/core", 10),
        ],
      }),
    ),
    planned: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_PLANNED }, (_, index) =>
      factoryPlannedOf(index + 1, {
        zonePaths: index % 3 === 0 ? [] : [zones[index * 3]?.path ?? "packages/core"],
      }),
    ),
    defects: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_DEFECTS }, (_, index) =>
      factoryDefectOf(index + 1, {
        events: 1 + index,
        zonePaths: [zones[(index * 7) % zones.length]?.path ?? "packages/core"],
      }),
    ),
  });
  const found = pickable(drawn(stateOf(snapshot)).registrations);
  assert.equal(idsOf(found, PICK_KIND.ZONE).length, FACTORY_WORLD_BOUNDS.MAX_ZONES);
  assert.equal(idsOf(found, PICK_KIND.AGENT).length, FACTORY_WORLD_BOUNDS.MAX_AGENTS);
  assert.equal(idsOf(found, PICK_KIND.SHIPPED).length, FACTORY_WORLD_BOUNDS.MAX_SHIPPED);
  assert.equal(idsOf(found, PICK_KIND.PLANNED).length, FACTORY_WORLD_BOUNDS.MAX_PLANNED);
  assert.equal(idsOf(found, PICK_KIND.DEFECT).length, FACTORY_WORLD_BOUNDS.MAX_DEFECTS);
});

test("the keep's donjon moves to the core zone that now leads, when a tie between two of them turns on their bytes alone", () => {
  const snapshotWith = (first: number, second: number) =>
    factoryWorldOf({
      zones: [
        factoryZoneOf("packages/first", [], { bytes: first }),
        factoryZoneOf("packages/second", [], { bytes: second }),
        factoryZoneOf("apps/web", ["packages/first", "packages/second"], { bytes: 1_000_000 }),
        factoryZoneOf("apps/desktop", ["packages/first", "packages/second"], { bytes: 1_000_000 }),
      ],
    });
  const atHeart = (picking: ScenePicking, path: string) => {
    const anchor = picking.anchorOf({ kind: PICK_KIND.ZONE, id: path });
    return anchor !== undefined && Math.hypot(anchor.x, anchor.z) < 1;
  };
  const { instance, picking } = drawn(stateOf(snapshotWith(100, 110)));
  assert.ok(atHeart(picking, "packages/second"));
  instance.update(stateOf(snapshotWith(120, 110)));
  assert.ok(atHeart(picking, "packages/first"));
  assert.ok(!atHeart(picking, "packages/second"));
});

test("a defect burning in the keep's donjon breaks its crown, as it would any tower's", () => {
  const keep = factoryWorldOf({ ...SNAPSHOT, defects: [] });
  const burning = factoryWorldOf({
    ...SNAPSHOT,
    defects: [factoryDefectOf(1, { events: 9, zonePaths: ["packages/core"] })],
  });
  const embers = glowingIn(SIGNAL_COLOR.DEFECT);
  assert.equal(instancesDrawn(drawn(stateOf(keep)).scene, embers), 0);
  assert.ok(instancesDrawn(drawn(stateOf(burning)).scene, embers) > 0);
});

test("a selected merge's ring goes with its torch when the shipped layer is switched off", () => {
  const selected = { kind: PICK_KIND.SHIPPED, id: SNAPSHOT.shipped[0]?.url ?? "" };
  const { instance, scene } = drawn(stateOf(SNAPSHOT, { selected }));
  const ring = paintedIn(SIGNAL_COLOR.SELECTION);
  assert.equal(instancesDrawn(scene, ring), 1);
  instance.update(stateOf(SNAPSHOT, { selected, layers: { ...ALL_LAYERS, shipped: false } }));
  assert.equal(instancesDrawn(scene, ring), 0);
});

test("the blast still runs down the dependency roads after the town is rebuilt round a new plan", () => {
  const view = factoryWorldViewOf(SNAPSHOT);
  const blast = new Map(blastRadiusOf(view, uuidOf(1)).map((zone) => [zone.path, zone.distance]));
  const selected = { kind: PICK_KIND.AGENT, id: uuidOf(1) };
  const { instance, scene } = drawn(stateOf(SNAPSHOT, { selected, blast }));
  const lit = blastRoads(scene);
  assert.ok(lit > 0);
  const replanned = factoryWorldOf({
    ...SNAPSHOT,
    planned: [...SNAPSHOT.planned, factoryPlannedOf(3, { zonePaths: ["apps/desktop"] })],
  });
  instance.update(stateOf(replanned, { selected, blast }));
  assert.equal(blastRoads(scene), lit);
});
