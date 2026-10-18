import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldHost,
  type WorldLayers,
  type WorldState,
} from "@luke/panel/factory-world/world";
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
} from "@luke/ui/testing";
import {
  type InstancedMesh,
  Matrix4,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import { test } from "vitest";
import { world } from "./index";

/**
 * neon.test.ts -- the Neon Megacity built against a stand-in host: every agent, zone, shipped pull request, planned issue, and defect it draws can be picked, each layer switched off leaves nothing of its signal to pick, a defect stands over the zone it is placed on, a scrubbed instant draws only what had merged by then, and the same snapshot lays out the same city.
 *
 * There is no WebGL here, so what the tests read is what the host's picking
 * reads: the objects a world registers, which of them stand shown, and
 * where each instance stands.
 */

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

/** One registration, as the stand-in host keeps it. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

/** A picked item and where it stands. */
interface Pickable {
  readonly target: PickTarget;
  readonly at: Vector3;
}

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

/** A host that keeps what the world registers, with no renderer behind it. */
function standInHost() {
  const scene = new Scene();
  const registrations: Registration[] = [];
  const homes: Vector3[] = [];
  const host: WorldHost = {
    scene,
    camera: {
      camera: new PerspectiveCamera(40, 1.6, 0.1, 4000),
      setHome: (position) => homes.push(new Vector3(position.x, position.y, position.z)),
      setReach: () => undefined,
    },
    palette: { signal: SIGNAL_COLOR, ground: SCENE_GROUND },
    picking: {
      add: (object, target) => {
        registrations.push({ object, target });
        return () => undefined;
      },
      addInstances: (object, targetOf) => {
        registrations.push({ object, targetOf });
        return () => undefined;
      },
    },
    invalidate: () => undefined,
  };
  /** Everything the host could pick now: shown, within its mesh's count, and named. */
  const pickable = (): Pickable[] => {
    scene.updateMatrixWorld(true);
    const matrix = new Matrix4();
    return registrations.flatMap((registration) => {
      if (!shown(registration.object)) return [];
      if ("target" in registration)
        return [{ target: registration.target, at: registration.object.position.clone() }];
      const mesh = registration.object;
      return Array.from({ length: mesh.count }, (_, instanceId) => {
        const target = registration.targetOf(instanceId);
        if (target === undefined) return [];
        mesh.getMatrixAt(instanceId, matrix);
        return [
          {
            target,
            at: new Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld),
          },
        ];
      }).flat();
    });
  };
  return { host, scene, homes, pickable };
}

/** Every point of the highways drawn: the merged tube geometry whose vertices name their highway. */
function highwayPoints(scene: Scene): Vector3[] {
  const points: Vector3[] = [];
  scene.traverse((object) => {
    if (!(object instanceof Mesh) || object.geometry.getAttribute("aEdge") === undefined) return;
    const position = object.geometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      points.push(new Vector3(position.getX(index), position.getY(index), position.getZ(index)));
    }
  });
  return points;
}

/** A small monorepo: a shared core, two services over it, an app over those, and its tooling. */
function snapshotOf(fields: Partial<FactoryWorld> = {}): FactoryWorld {
  return factoryWorldOf({
    zones: [
      factoryZoneOf("packages/wire", [], { bytes: 40_000, files: 30 }),
      factoryZoneOf("packages/features", ["packages/wire"], { bytes: 90_000, files: 120 }),
      factoryZoneOf("packages/database", ["packages/features", "packages/wire"], { bytes: 70_000 }),
      factoryZoneOf("packages/service", ["packages/database", "packages/features"], {
        bytes: 60_000,
      }),
      factoryZoneOf("packages/voice", ["packages/features"], { bytes: 20_000 }),
      factoryZoneOf("apps/desktop", ["packages/service", "packages/voice"], { bytes: 120_000 }),
      factoryZoneOf("apps/web", ["packages/service"], { bytes: 50_000 }),
      factoryZoneOf("tools", [], { bytes: 5_000 }),
    ],
    agents: [
      factoryAgentOf(1, {
        pullRequest: factoryPullRequestOf({
          number: 11,
          areas: [areaOf("packages/features", 400), areaOf("apps/web", 80)],
        }),
      }),
      factoryAgentOf(2, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: factoryPullRequestOf({ number: 12, areas: [areaOf("apps/desktop", 1200)] }),
      }),
      factoryAgentOf(3, { status: CODING_AGENT_STATUS.FAILED }),
      factoryAgentOf(4, {
        status: CODING_AGENT_STATUS.CANCELLED,
        pullRequest: factoryPullRequestOf({ number: 14, areas: [areaOf("tools", 5)] }),
      }),
    ],
    shipped: [
      factoryShippedOf(21, FACTORY_NOW - 2 * HOUR_MS, { areas: [areaOf("packages/service", 300)] }),
      factoryShippedOf(22, FACTORY_NOW - 3 * DAY_MS, { areas: [areaOf("apps/desktop", 40)] }),
      factoryShippedOf(23, FACTORY_NOW - 5 * DAY_MS, { areas: [areaOf("somewhere/else", 10)] }),
    ],
    planned: [
      factoryPlannedOf(1, { zonePaths: ["packages/voice"] }),
      factoryPlannedOf(2, { zonePaths: ["packages/voice"] }),
      factoryPlannedOf(3),
    ],
    defects: [
      factoryDefectOf(1, { events: 80, zonePaths: ["packages/database", "apps/web"] }),
      factoryDefectOf(2, { events: 3, zonePaths: ["apps/web"] }),
      factoryDefectOf(3, { events: 1 }),
    ],
    ...fields,
  });
}

function stateOf(snapshot: FactoryWorld, fields: Partial<WorldState> = {}): WorldState {
  return {
    view: factoryWorldViewOf(snapshot),
    snapshot,
    live: true,
    selected: undefined,
    hovered: undefined,
    blast: new Map(),
    layers: ALL_LAYERS,
    still: true,
    dark: true,
    ...fields,
  };
}

/** The ids of `kind` among what can be picked. */
function idsOf(pickable: readonly Pickable[], kind: PickKind): Set<string> {
  return new Set(
    pickable.filter(({ target }) => target.kind === kind).map(({ target }) => target.id),
  );
}

function built(state: WorldState) {
  const { host, homes, pickable } = standInHost();
  const instance = world.create(host);
  instance.update(state);
  return { instance, pickable, homes };
}

test("every agent, zone, shipped pull request, planned issue, and defect can be picked, those placed on no zone among them", () => {
  const snapshot = snapshotOf();
  const { pickable, homes } = built(stateOf(snapshot));
  const items = pickable();
  assert.deepEqual(idsOf(items, PICK_KIND.ZONE), new Set(snapshot.zones.map((zone) => zone.path)));
  assert.deepEqual(
    idsOf(items, PICK_KIND.AGENT),
    new Set(snapshot.agents.map((agent) => agent.id)),
  );
  assert.deepEqual(
    idsOf(items, PICK_KIND.SHIPPED),
    new Set(snapshot.shipped.map((merged) => merged.url)),
  );
  assert.deepEqual(
    idsOf(items, PICK_KIND.PLANNED),
    new Set(snapshot.planned.map((issue) => issue.identifier)),
  );
  assert.deepEqual(
    idsOf(items, PICK_KIND.DEFECT),
    new Set(snapshot.defects.map((defect) => defect.id)),
  );
  assert.equal(homes.length, 1, "the world names its establishing shot");
});

test("each layer switched off leaves nothing of its signal to pick, and the rest standing", () => {
  const snapshot = snapshotOf();
  const switched = [
    { layer: "planned", kind: PICK_KIND.PLANNED },
    { layer: "shipped", kind: PICK_KIND.SHIPPED },
    { layer: "defects", kind: PICK_KIND.DEFECT },
  ] as const;
  for (const { layer, kind } of switched) {
    const { pickable } = built(stateOf(snapshot, { layers: { ...ALL_LAYERS, [layer]: false } }));
    const items = pickable();
    assert.equal(idsOf(items, kind).size, 0, `${layer} off`);
    assert.equal(
      idsOf(items, PICK_KIND.ZONE).size,
      snapshot.zones.length,
      `${layer} off keeps the zones`,
    );
  }
  const failed = snapshot.agents.find((agent) => agent.status === CODING_AGENT_STATUS.FAILED);
  const { pickable } = built(stateOf(snapshot, { layers: { ...ALL_LAYERS, building: false } }));
  assert.deepEqual(
    idsOf(pickable(), PICK_KIND.AGENT),
    new Set([failed?.id]),
    "building off leaves only the failed agent, a defect",
  );
  const { pickable: neither } = built(
    stateOf(snapshot, { layers: { ...ALL_LAYERS, building: false, defects: false } }),
  );
  assert.equal(
    idsOf(neither(), PICK_KIND.AGENT).size,
    0,
    "building and defects off leave no agent",
  );
});

test("switching a layer off and on again on a standing world redraws it", () => {
  const snapshot = snapshotOf();
  const { host, pickable } = standInHost();
  const instance = world.create(host);
  instance.update(stateOf(snapshot, { layers: { ...ALL_LAYERS, shipped: false, planned: false } }));
  assert.equal(idsOf(pickable(), PICK_KIND.SHIPPED).size, 0);
  instance.update(stateOf(snapshot));
  assert.equal(idsOf(pickable(), PICK_KIND.SHIPPED).size, snapshot.shipped.length);
  assert.equal(idsOf(pickable(), PICK_KIND.PLANNED).size, snapshot.planned.length);
});

test("a defect stands over the district of the first zone it is placed on", () => {
  const snapshot = snapshotOf();
  const { pickable } = built(stateOf(snapshot));
  const items = pickable();
  const defect = items.find(({ target }) => target.kind === PICK_KIND.DEFECT && target.id === "1");
  assert.ok(defect !== undefined);
  const district = items.filter(
    ({ target }) => target.kind === PICK_KIND.ZONE && target.id === "packages/database",
  );
  const nearest = Math.min(
    ...district.map(({ at }) => Math.hypot(at.x - defect.at.x, at.z - defect.at.z)),
  );
  const elsewhere = items.filter(
    ({ target }) => target.kind === PICK_KIND.ZONE && target.id === "apps/web",
  );
  const fromWeb = Math.min(
    ...elsewhere.map(({ at }) => Math.hypot(at.x - defect.at.x, at.z - defect.at.z)),
  );
  assert.ok(nearest < fromWeb, `nearer its first zone (${nearest}) than its second (${fromWeb})`);
  assert.ok(defect.at.y > 0, "over it, not on the street");
});

test("a scrubbed instant draws only the pull requests merged by then", () => {
  const snapshot = snapshotOf();
  const { host, pickable } = standInHost();
  const instance = world.create(host);
  instance.update(stateOf(snapshot));
  const earlier = factoryWorldAsOf(snapshot, FACTORY_NOW - 4 * DAY_MS);
  instance.update(stateOf(earlier, { live: false }));
  assert.deepEqual(
    idsOf(pickable(), PICK_KIND.SHIPPED),
    new Set(["https://github.com/acme/factory/pull/23"]),
  );
});

test("a selected agent's blast radius redraws the world without moving it, and the same snapshot lays out the same city", () => {
  const snapshot = snapshotOf();
  const first = built(stateOf(snapshot)).pickable();
  const view = factoryWorldViewOf(snapshot);
  const agent = view.agents[0];
  assert.ok(agent !== undefined);
  const selected = { kind: PICK_KIND.AGENT, id: agent.id };
  const blast = new Map(blastRadiusOf(view, agent.id).map((zone) => [zone.path, zone.distance]));
  assert.ok(blast.size > 1, "the agent's work ripples past the zones it touched");
  const second = built(
    stateOf(snapshot, { selected, blast, still: false, dark: false }),
  ).pickable();
  const zonesOf = (items: readonly Pickable[]) =>
    items
      .filter(({ target }) => target.kind === PICK_KIND.ZONE)
      .map(({ target, at }) => [target.id, at.toArray()]);
  assert.deepEqual(zonesOf(second), zonesOf(first));
});

test("a city past the bounds stays within them: every zone still picked, and at most the agents the contract allows", () => {
  const zones = Array.from({ length: 200 }, (_, index) =>
    factoryZoneOf(`packages/p${index}`, index === 0 ? [] : ["packages/p0"], {
      bytes: 1_000 + index * 500,
    }),
  );
  const agents = Array.from({ length: 100 }, (_, index) =>
    factoryAgentOf(index + 1, {
      pullRequest: factoryPullRequestOf({
        number: index + 1,
        areas: [areaOf(`packages/p${index % 200}`, 50 + index)],
      }),
    }),
  );
  const snapshot = factoryWorldOf({ zones, agents });
  const { pickable } = built(stateOf(snapshot));
  const items = pickable();
  assert.equal(idsOf(items, PICK_KIND.ZONE).size, 200);
  assert.equal(idsOf(items, PICK_KIND.AGENT).size, 100);
});

test("a dependency that moves while every zone stays put moves its highway", () => {
  const zones = (dependsOn: string) => [
    factoryZoneOf("tools/a", [], { bytes: 4_000 }),
    factoryZoneOf("tools/b", [], { bytes: 4_000 }),
    factoryZoneOf("tools/c", [dependsOn], { bytes: 4_000 }),
  ];
  const { host, scene, pickable } = standInHost();
  const instance = world.create(host);
  instance.update(stateOf(factoryWorldOf({ zones: zones("tools/a") })));
  instance.update(stateOf(factoryWorldOf({ zones: zones("tools/b") })));
  const anchors = pickable().filter(({ target }) => target.kind === PICK_KIND.ZONE);
  const centre = (path: string) => anchors.find(({ target }) => target.id === path)?.at;
  const highway = highwayPoints(scene);
  const reach = (path: string) => {
    const at = centre(path);
    assert.ok(at !== undefined);
    return Math.min(...highway.map((point) => Math.hypot(point.x - at.x, point.z - at.z)));
  };
  assert.ok(highway.length > 0, "a highway is drawn");
  assert.ok(reach("tools/b") < 1, `it lands on the new dependency (${reach("tools/b")})`);
  assert.ok(reach("tools/a") > 1, `and no longer on the old one (${reach("tools/a")})`);
});
