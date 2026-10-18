import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { FACTORY_WORLD_BOUNDS, type FactoryWorld } from "@luke/features/factory-world-wire";
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
import { type InstancedMesh, type Object3D, PerspectiveCamera, Scene } from "three";
import { test } from "vitest";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  WORLD_LAYER,
  type WorldHost,
  type WorldLayer,
  type WorldLayers,
  type WorldState,
} from "../../world";
import { world } from "./index";

/**
 * index.test.ts -- the Ant Colony as the scene host sees it, with no WebGL: what it offers to be picked for a snapshot, for each layer switched off, at the scrubber's earlier instants, and at the contract's bounds.
 *
 * The host is a stand-in recording what the world registers for picking;
 * a registration counts only while what it registered stands in the scene
 * and is shown, as the host's own picking reads it.
 */

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

const WORKING = uuidOf(1);
const STUCK = uuidOf(2);
const FAILED = uuidOf(3);
const LATE_MERGE = factoryShippedOf(3450, FACTORY_NOW - HOUR_MS, {
  areas: [areaOf("apps/web", 300)],
});
const EARLY_MERGE = factoryShippedOf(3400, FACTORY_NOW - 2 * DAY_MS, {
  areas: [areaOf("packages/core", 40)],
});

/** A core two apps reach through a domain package, a tooling directory, three agents, two merges, two issues, and two defects. */
const SNAPSHOT: FactoryWorld = factoryWorldOf({
  zones: [
    factoryZoneOf("packages/core", [], { bytes: 9000 }),
    factoryZoneOf("packages/billing", ["packages/core"], { bytes: 4000 }),
    factoryZoneOf("apps/web", ["packages/billing", "packages/core"]),
    factoryZoneOf("apps/desktop", ["packages/core"]),
    factoryZoneOf("tools", []),
  ],
  agents: [
    factoryAgentOf(1, {
      pullRequest: factoryPullRequestOf({
        number: 3501,
        areas: [areaOf("apps/web", 120), areaOf("packages/billing", 40)],
      }),
    }),
    factoryAgentOf(2, {
      status: CODING_AGENT_STATUS.COMPLETED,
      pullRequest: factoryPullRequestOf({
        number: 3502,
        state: PULL_REQUEST_STATE.DRAFT,
        areas: [areaOf("packages/core", 900)],
      }),
    }),
    factoryAgentOf(3, {
      status: CODING_AGENT_STATUS.FAILED,
      pullRequest: factoryPullRequestOf({ number: 3503, areas: [areaOf("apps/desktop", 12)] }),
    }),
  ],
  shipped: [LATE_MERGE, EARLY_MERGE],
  planned: [
    factoryPlannedOf(1, { zonePaths: ["packages/billing", "apps/web"] }),
    factoryPlannedOf(2),
  ],
  defects: [
    factoryDefectOf(1, { events: 40, zonePaths: ["packages/core", "apps/web"] }),
    factoryDefectOf(2),
  ],
});

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

/** One registration the world made, as the host keeps it. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

/** Whether `object` stands in `scene` and it and every parent are shown, as the host's picking asks. */
function shownIn(scene: Scene, object: Object3D): boolean {
  let at: Object3D | null = object;
  for (; at !== null; at = at.parent) {
    if (!at.visible) return false;
    if (at === scene) return true;
  }
  return false;
}

/** A host that records what is registered, and answers what of it can be picked now, by kind. */
function standInHost() {
  const scene = new Scene();
  const registrations: Registration[] = [];
  const host: WorldHost = {
    scene,
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
  const pickable = (kind: PickKind) => {
    const found = new Set<string>();
    for (const registration of registrations) {
      if (!shownIn(scene, registration.object)) continue;
      const targets =
        "target" in registration
          ? [registration.target]
          : Array.from({ length: registration.object.count }, (_, index) =>
              registration.targetOf(index),
            );
      for (const target of targets) if (target?.kind === kind) found.add(target.id);
    }
    return found;
  };
  return { host, pickable };
}

function drawn(state: WorldState): (kind: PickKind) => Set<string> {
  const { host, pickable } = standInHost();
  world.create(host).update(state);
  return pickable;
}

test("every zone, agent, shipped pull request, planned issue, and defect can be picked, those placed on no zone too", () => {
  const pickable = drawn(stateOf(SNAPSHOT));
  assert.deepEqual(pickable(PICK_KIND.ZONE), new Set(SNAPSHOT.zones.map((zone) => zone.path)));
  assert.deepEqual(pickable(PICK_KIND.AGENT), new Set([WORKING, STUCK, FAILED]));
  assert.deepEqual(pickable(PICK_KIND.SHIPPED), new Set([LATE_MERGE.url, EARLY_MERGE.url]));
  assert.deepEqual(pickable(PICK_KIND.PLANNED), new Set(["ENG-1", "ENG-2"]));
  assert.deepEqual(pickable(PICK_KIND.DEFECT), new Set(["1", "2"]));
});

test("each layer switched off leaves out what it names and nothing else; a failed agent stays, as a defect of its own", () => {
  const off = (layer: WorldLayer) =>
    drawn(stateOf(SNAPSHOT, { layers: { ...ALL_LAYERS, [layer]: false } }));
  const kinds = [
    PICK_KIND.ZONE,
    PICK_KIND.AGENT,
    PICK_KIND.SHIPPED,
    PICK_KIND.PLANNED,
    PICK_KIND.DEFECT,
  ];
  const all = drawn(stateOf(SNAPSHOT));
  const leftOut = [
    { layer: WORLD_LAYER.BUILDING, kind: PICK_KIND.AGENT, kept: [FAILED] },
    { layer: WORLD_LAYER.SHIPPED, kind: PICK_KIND.SHIPPED, kept: [] },
    { layer: WORLD_LAYER.PLANNED, kind: PICK_KIND.PLANNED, kept: [] },
    { layer: WORLD_LAYER.DEFECTS, kind: PICK_KIND.DEFECT, kept: [] },
  ] as const;
  for (const { layer, kind, kept } of leftOut) {
    const pickable = off(layer);
    assert.deepEqual(pickable(kind), new Set(kept), `${layer} off leaves out its own`);
    for (const other of kinds.filter((each) => each !== kind)) {
      assert.deepEqual(pickable(other), all(other), `${layer} off keeps every ${other}`);
    }
  }
});

test("scrubbed back, a merge after the instant is not drawn, and switching back to now draws it again", () => {
  const { host, pickable } = standInHost();
  const colony = world.create(host);
  const earlier = factoryWorldAsOf(SNAPSHOT, FACTORY_NOW - DAY_MS);
  colony.update(stateOf(earlier, { live: false }));
  assert.deepEqual(pickable(PICK_KIND.SHIPPED), new Set([EARLY_MERGE.url]));
  colony.update(stateOf(SNAPSHOT));
  assert.deepEqual(pickable(PICK_KIND.SHIPPED), new Set([LATE_MERGE.url, EARLY_MERGE.url]));
});

test("a snapshot at the contract's bounds draws every item it names", () => {
  const { MAX_ZONES, MAX_AGENTS, MAX_SHIPPED, MAX_PLANNED, MAX_DEFECTS } = FACTORY_WORLD_BOUNDS;
  const pathOf = (index: number) => (index % 4 === 0 ? `apps/app${index}` : `packages/p${index}`);
  const zones = Array.from({ length: MAX_ZONES }, (_, index) =>
    factoryZoneOf(pathOf(index), index > 0 ? [pathOf(Math.floor(index / 2))] : [], {
      bytes: 500 + index * 97,
    }),
  );
  const snapshot = factoryWorldOf({
    zones,
    agents: Array.from({ length: MAX_AGENTS }, (_, index) =>
      factoryAgentOf(index + 1, {
        pullRequest: factoryPullRequestOf({
          number: 5000 + index,
          areas: [areaOf(pathOf(index), 50 + index * 40)],
        }),
      }),
    ),
    shipped: Array.from({ length: MAX_SHIPPED }, (_, index) =>
      factoryShippedOf(4000 + index, FACTORY_NOW - index * HOUR_MS, {
        areas: [areaOf(pathOf(index), 30), areaOf(pathOf(index + 1), 20)],
      }),
    ),
    planned: Array.from({ length: MAX_PLANNED }, (_, index) =>
      factoryPlannedOf(index + 1, { zonePaths: [pathOf(index)] }),
    ),
    defects: Array.from({ length: MAX_DEFECTS }, (_, index) =>
      factoryDefectOf(index + 1, { events: index * 3, zonePaths: [pathOf(index)] }),
    ),
  });
  const pickable = drawn(stateOf(snapshot));
  assert.equal(pickable(PICK_KIND.ZONE).size, MAX_ZONES);
  assert.equal(pickable(PICK_KIND.AGENT).size, MAX_AGENTS);
  assert.equal(pickable(PICK_KIND.SHIPPED).size, MAX_SHIPPED);
  assert.equal(pickable(PICK_KIND.PLANNED).size, MAX_PLANNED);
  assert.equal(pickable(PICK_KIND.DEFECT).size, MAX_DEFECTS);
});
