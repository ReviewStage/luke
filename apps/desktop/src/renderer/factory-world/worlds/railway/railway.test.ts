import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { FACTORY_WORLD_BOUNDS, type FactoryWorld } from "@luke/features/factory-world-wire";
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
  uuidOf,
} from "@luke/ui/testing";
import { Color, InstancedMesh, type Object3D, PerspectiveCamera, Scene } from "three";
import { test } from "vitest";
import { world } from "./index";

/**
 * railway.test.ts -- the Model Railway built against a stand-in host, as the scene host would see it: what it registers to be picked, what of that it draws, and in which colours, for builder snapshots of a small repository and of one at the contract's bounds.
 *
 * No WebGL is needed: the world only builds a scene graph, which is what the
 * host renders and picks over.
 */

/** One registration the world made: an object as one target, or an instanced mesh's instances. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

/** A host that records what the world registers to be picked. */
function standIn() {
  const registrations: Registration[] = [];
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
        return () => undefined;
      },
      addInstances: (object, targetOf) => {
        registrations.push({ object, targetOf });
        return () => undefined;
      },
    },
    invalidate: () => undefined,
  };
  return { host, registrations };
}

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (!at.visible) return false;
  return true;
}

/** Every target drawn and registered: its kind, its id, and the mesh and instance it is drawn as. */
function drawn(
  registrations: readonly Registration[],
): { target: PickTarget; mesh: Object3D; instance: number }[] {
  return registrations.flatMap((registration) => {
    if (!shown(registration.object)) return [];
    if ("target" in registration)
      return [{ target: registration.target, mesh: registration.object, instance: -1 }];
    const mesh = registration.object;
    return Array.from({ length: mesh.count }, (_, instance) => ({
      target: registration.targetOf(instance),
      mesh,
      instance,
    })).flatMap((found) =>
      found.target === undefined ? [] : [{ ...found, target: found.target }],
    );
  });
}

/** The ids drawn of one kind. */
function idsOf(registrations: readonly Registration[], kind: PickKind): Set<string> {
  return new Set(
    drawn(registrations)
      .filter(({ target }) => target.kind === kind)
      .map(({ target }) => target.id),
  );
}

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

/** The state a world draws for `snapshot`, every layer on, nothing chosen, unless `fields` says otherwise. */
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
    dark: false,
    ...fields,
  };
}

const WORKING = uuidOf(1);
const STUCK = uuidOf(2);
const FAILED = uuidOf(3);
const WAITING = uuidOf(4);
const EARLIER = factoryShippedOf(3400, FACTORY_NOW - 2 * DAY_MS, {
  areas: [areaOf("packages/core", 40)],
});
const LATER = factoryShippedOf(3450, FACTORY_NOW - HOUR_MS, {
  areas: [areaOf("apps/desktop/src", 300)],
});

/** A core two apps depend on through a service, a tools directory, an agent in each state, two merges, two issues, and three defects. */
const SNAPSHOT = factoryWorldOf({
  zones: [
    factoryZoneOf("packages/core", [], { bytes: 90_000 }),
    factoryZoneOf("packages/service", ["packages/core"], { bytes: 60_000 }),
    factoryZoneOf("apps/web", ["packages/service", "packages/core"], { bytes: 40_000 }),
    factoryZoneOf("apps/desktop", ["packages/service", "packages/core"], { bytes: 120_000 }),
    factoryZoneOf("tools", [], { bytes: 8_000 }),
  ],
  agents: [
    factoryAgentOf(1, {
      pullRequest: factoryPullRequestOf({
        number: 3501,
        areas: [areaOf("apps/web", 900), areaOf("packages/service", 100)],
      }),
    }),
    factoryAgentOf(2, {
      status: CODING_AGENT_STATUS.COMPLETED,
      pullRequest: factoryPullRequestOf({
        number: 3502,
        state: PULL_REQUEST_STATE.DRAFT,
        areas: [areaOf("apps/desktop", 40)],
      }),
    }),
    factoryAgentOf(3, {
      status: CODING_AGENT_STATUS.FAILED,
      pullRequest: factoryPullRequestOf({
        number: 3503,
        areas: [areaOf("packages/service", 2400)],
      }),
    }),
    factoryAgentOf(4, {
      status: CODING_AGENT_STATUS.COMPLETED,
      pullRequest: factoryPullRequestOf({ number: 3504, areas: [areaOf("packages/core", 12)] }),
    }),
  ],
  shipped: [EARLIER, LATER],
  planned: [factoryPlannedOf(1, { zonePaths: ["apps/web"], priority: 1 }), factoryPlannedOf(2)],
  defects: [
    factoryDefectOf(1, { events: 40, zonePaths: ["packages/service"] }),
    factoryDefectOf(2, { events: 3, zonePaths: ["apps/desktop"] }),
    factoryDefectOf(3),
  ],
});

test("every zone, agent, shipped pull request, planned issue, and defect is drawn where it can be picked", () => {
  const { host, registrations } = standIn();
  world.create(host).update(stateOf(SNAPSHOT));
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.ZONE),
    new Set(SNAPSHOT.zones.map((zone) => zone.path)),
  );
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.AGENT),
    new Set([WORKING, STUCK, FAILED, WAITING]),
  );
  assert.deepEqual(idsOf(registrations, PICK_KIND.SHIPPED), new Set([EARLIER.url, LATER.url]));
  assert.deepEqual(idsOf(registrations, PICK_KIND.PLANNED), new Set(["ENG-1", "ENG-2"]));
  assert.deepEqual(idsOf(registrations, PICK_KIND.DEFECT), new Set(["1", "2", "3"]));
});

test("each layer switched off leaves out what it names, and only that; a failed agent stands with the building layer off", () => {
  const cases = [
    { layer: "planned", kind: PICK_KIND.PLANNED, left: [] },
    { layer: "building", kind: PICK_KIND.AGENT, left: [FAILED] },
    { layer: "shipped", kind: PICK_KIND.SHIPPED, left: [] },
    { layer: "defects", kind: PICK_KIND.DEFECT, left: [] },
  ] as const;
  for (const { layer, kind, left } of cases) {
    const { host, registrations } = standIn();
    const created = world.create(host);
    created.update(stateOf(SNAPSHOT));
    created.update(stateOf(SNAPSHOT, { layers: { ...ALL_LAYERS, [layer]: false } }));
    assert.deepEqual(idsOf(registrations, kind), new Set(left), `${layer} off`);
    for (const other of cases.filter(
      (each) => each.layer !== layer && each.kind !== PICK_KIND.AGENT,
    )) {
      assert.ok(
        idsOf(registrations, other.kind).size > 0,
        `${other.layer} stays with ${layer} off`,
      );
    }
    assert.equal(
      idsOf(registrations, PICK_KIND.ZONE).size,
      SNAPSHOT.zones.length,
      `the zones stay with ${layer} off`,
    );
  }
});

test("scrubbing back draws only what had merged by then, and forward again draws it back", () => {
  const { host, registrations } = standIn();
  const created = world.create(host);
  const earlier = factoryWorldAsOf(SNAPSHOT, FACTORY_NOW - DAY_MS);
  created.update(stateOf(earlier, { live: false }));
  assert.deepEqual(idsOf(registrations, PICK_KIND.SHIPPED), new Set([EARLIER.url]));
  created.update(stateOf(SNAPSHOT));
  assert.deepEqual(idsOf(registrations, PICK_KIND.SHIPPED), new Set([EARLIER.url, LATER.url]));
});

test("the selected agent is drawn in selection's colour, and its blast radius in the blast's", () => {
  const { host, registrations } = standIn();
  const view = factoryWorldViewOf(SNAPSHOT);
  const blast = new Map(blastRadiusOf(view, WORKING).map((zone) => [zone.path, zone.distance]));
  world
    .create(host)
    .update(stateOf(SNAPSHOT, { selected: { kind: PICK_KIND.AGENT, id: WORKING }, blast }));
  const colorOf = (mesh: InstancedMesh, instance: number) => {
    const color = new Color();
    mesh.getColorAt(instance, color);
    return `#${color.getHexString()}`;
  };
  const painted = drawn(registrations).flatMap(({ target, mesh, instance }) =>
    mesh instanceof InstancedMesh &&
    mesh.instanceColor !== null &&
    target.kind === PICK_KIND.AGENT &&
    target.id === WORKING
      ? [colorOf(mesh, instance)]
      : [],
  );
  assert.ok(
    painted.includes(SIGNAL_COLOR.SELECTION),
    "the agent's engine is painted in selection's colour",
  );
  const blastColored = new Set<Object3D>();
  host.scene.traverse((object) => {
    if (!(object instanceof InstancedMesh) || object.instanceColor === null) return;
    const opacity = object.geometry.getAttribute("aOpacity");
    for (let instance = 0; instance < object.count; instance += 1) {
      if (
        colorOf(object, instance) === SIGNAL_COLOR.BLAST_RADIUS &&
        (opacity?.getX(instance) ?? 1) > 0
      )
        blastColored.add(object);
    }
  });
  assert.ok(
    blast.size > 0 && blastColored.size > 0,
    "the zones its work ripples to are marked in the blast's colour",
  );
});

test("a repository at the contract's bounds draws every item it holds", () => {
  const { host, registrations } = standIn();
  const zones = Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_ZONES }, (_, index) =>
    factoryZoneOf(`packages/p${index}`, index === 0 ? [] : [`packages/p${index % 7}`], {
      bytes: 2_000 + index * 997,
    }),
  );
  const big = factoryWorldOf({
    zones,
    agents: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_AGENTS }, (_, index) =>
      factoryAgentOf(index + 1, {
        pullRequest: factoryPullRequestOf({
          number: 4000 + index,
          areas: [
            areaOf(`packages/p${index % 50}`, 50 + index * 40),
            areaOf(`packages/p${(index * 7) % 200}`, 30),
          ],
        }),
      }),
    ),
    shipped: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_SHIPPED }, (_, index) =>
      factoryShippedOf(5000 + index, FACTORY_NOW - index * HOUR_MS, {
        areas: [areaOf(`packages/p${index % 9}`, 20 + index)],
      }),
    ),
    planned: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_PLANNED }, (_, index) =>
      factoryPlannedOf(index + 1, { zonePaths: [`packages/p${index * 3}`] }),
    ),
    defects: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_DEFECTS }, (_, index) =>
      factoryDefectOf(index + 1, { events: index * 3, zonePaths: [`packages/p${index * 2}`] }),
    ),
  });
  world.create(host).update(stateOf(big));
  assert.equal(idsOf(registrations, PICK_KIND.ZONE).size, FACTORY_WORLD_BOUNDS.MAX_ZONES);
  assert.equal(idsOf(registrations, PICK_KIND.AGENT).size, FACTORY_WORLD_BOUNDS.MAX_AGENTS);
  assert.equal(idsOf(registrations, PICK_KIND.SHIPPED).size, FACTORY_WORLD_BOUNDS.MAX_SHIPPED);
  assert.equal(idsOf(registrations, PICK_KIND.PLANNED).size, FACTORY_WORLD_BOUNDS.MAX_PLANNED);
  assert.equal(idsOf(registrations, PICK_KIND.DEFECT).size, FACTORY_WORLD_BOUNDS.MAX_DEFECTS);
});
