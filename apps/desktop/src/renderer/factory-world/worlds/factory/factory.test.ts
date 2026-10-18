import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { FACTORY_WORLD_BOUNDS, type FactoryWorld } from "@luke/features/factory-world-wire";
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
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { test } from "vitest";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldHost,
  type WorldLayers,
  type WorldState,
} from "../../world";
import { world } from "./index";

/**
 * factory.test.ts -- the Factory drawn over a stand-in host: what it registers to be picked, what each layer switch takes away, the colours a selection and a blast radius are drawn in, scrubbing, motion, and the contract's bounds.
 *
 * jsdom has no WebGL, and the world needs none to be built: the host is a
 * real Three.js scene with a recording picker, and what the tests read is
 * what the renderer would be handed, the registered targets still shown and
 * the colours of what is visible. The snapshot is synthetic and names
 * nothing of this repository.
 */

/** A small repository: a base everything stands on, a kit over it, two edges, and a scripts directory. */
const ZONES = [
  factoryZoneOf("libs/base", [], { bytes: 9000 }),
  factoryZoneOf("libs/kit", ["libs/base"], { bytes: 4000 }),
  factoryZoneOf("apps/desk", ["libs/kit", "libs/base"], { bytes: 6000 }),
  factoryZoneOf("apps/site", ["libs/base"], { bytes: 2500 }),
  factoryZoneOf("scripts", [], { bytes: 800 }),
];

const BUILDING = uuidOf(1);
const WAITING = uuidOf(2);
const STUCK = uuidOf(3);
const FAILED = uuidOf(4);
const IDLE = uuidOf(5);
const HOMELESS = uuidOf(6);

/** One agent in every state, one placed on no zone, merges in and out of zones, plans, and defects. */
function snapshotOf(): FactoryWorld {
  return factoryWorldOf({
    zones: ZONES,
    agents: [
      factoryAgentOf(1, {
        pullRequest: factoryPullRequestOf({
          number: 11,
          title: "feat(desk): add a drawer",
          areas: [areaOf("apps/desk/src", 3600), areaOf("libs/kit/src", 400)],
          openedAt: FACTORY_NOW - 6 * HOUR_MS,
        }),
      }),
      factoryAgentOf(2, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: factoryPullRequestOf({
          number: 12,
          title: "fix(kit): a typo",
          areas: [areaOf("libs/kit/src", 12)],
        }),
      }),
      factoryAgentOf(3, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: factoryPullRequestOf({
          number: 13,
          title: "refactor(base): split it",
          state: PULL_REQUEST_STATE.DRAFT,
          areas: [areaOf("libs/base/src", 300)],
        }),
      }),
      factoryAgentOf(4, {
        status: CODING_AGENT_STATUS.FAILED,
        pullRequest: factoryPullRequestOf({ number: 14, areas: [areaOf("apps/site/src", 40)] }),
      }),
      factoryAgentOf(5, {
        status: CODING_AGENT_STATUS.CANCELLED,
        pullRequest: factoryPullRequestOf({ number: 15, areas: [areaOf("apps/desk/src", 20)] }),
      }),
      factoryAgentOf(6),
    ],
    shipped: [
      factoryShippedOf(21, FACTORY_NOW - 2 * HOUR_MS, { areas: [areaOf("apps/desk/src", 120)] }),
      factoryShippedOf(22, FACTORY_NOW - 3 * DAY_MS, {
        areas: [areaOf("libs/base/src", 60), areaOf("libs/kit", 5)],
      }),
      factoryShippedOf(23, FACTORY_NOW - 5 * DAY_MS, { areas: [areaOf("docs", 30)] }),
    ],
    planned: [factoryPlannedOf(31, { zonePaths: ["libs/kit"] }), factoryPlannedOf(32)],
    defects: [
      factoryDefectOf(41, { events: 60, zonePaths: ["libs/base"] }),
      factoryDefectOf(42, { events: 3 }),
    ],
  });
}

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

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

type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (index: number) => PickTarget | undefined;
    };

/** A host over a real scene whose picker records what is registered. */
/** A stand-in host, the scene it draws into, and what has been registered for picking. */
interface StandIn {
  readonly host: WorldHost;
  readonly scene: Scene;
  readonly registrations: Set<Registration>;
}

function hostOf(): StandIn {
  const scene = new Scene();
  const registrations = new Set<Registration>();
  const register = (registration: Registration) => {
    registrations.add(registration);
    return () => {
      registrations.delete(registration);
    };
  };
  const host: WorldHost = {
    scene,
    camera: {
      camera: new PerspectiveCamera(40, 1.6, 0.1, 5000),
      setHome: () => undefined,
      setReach: () => undefined,
    },
    palette: { signal: SIGNAL_COLOR, ground: SCENE_GROUND },
    picking: {
      add: (object, target) => register({ object, target }),
      addInstances: (object, targetOf) => register({ object, targetOf }),
    },
    invalidate: () => undefined,
  };
  return { host, scene, registrations };
}

/** Whether `object` stands in `scene` with it and every parent shown, as the host's picker asks. */
function shownIn(scene: Scene, object: Object3D): boolean {
  let at: Object3D | null = object;
  for (; at !== null; at = at.parent) {
    if (!at.visible) return false;
    if (at === scene) return true;
  }
  return false;
}

/** Every target the picker could land on now, by kind. */
function pickable(
  scene: Scene,
  registrations: ReadonlySet<Registration>,
): Map<PickKind, Set<string>> {
  const found = new Map<PickKind, Set<string>>();
  const note = (target: PickTarget | undefined) => {
    if (target === undefined) return;
    const ids = found.get(target.kind) ?? new Set<string>();
    ids.add(target.id);
    found.set(target.kind, ids);
  };
  for (const registration of registrations) {
    if (!shownIn(scene, registration.object)) continue;
    if ("target" in registration) {
      note(registration.target);
      continue;
    }
    for (let index = 0; index < registration.object.count; index += 1)
      note(registration.targetOf(index));
  }
  return found;
}

function idsOf(found: Map<PickKind, Set<string>>, kind: PickKind): string[] {
  return [...(found.get(kind) ?? [])].sort();
}

/** Whether anything visible is drawn in `hex`'s colour, at any brightness: a material's, or an instance's. */
function drawsColour(scene: Scene, hex: string): boolean {
  const wanted = new Color(hex);
  const top = Math.max(wanted.r, wanted.g, wanted.b);
  const same = (color: Color) => {
    const peak = Math.max(color.r, color.g, color.b);
    if (peak <= 1e-4) return false;
    return (
      Math.abs(color.r / peak - wanted.r / top) < 1e-3 &&
      Math.abs(color.g / peak - wanted.g / top) < 1e-3 &&
      Math.abs(color.b / peak - wanted.b / top) < 1e-3
    );
  };
  let drawn = false;
  const color = new Color();
  scene.traverse((object) => {
    if (drawn || !(object instanceof Mesh) || !shownIn(scene, object)) return;
    if (object instanceof InstancedMesh) {
      if (object.count === 0 || object.instanceColor === null) return;
      for (let index = 0; index < object.count && !drawn; index += 1) {
        object.getColorAt(index, color);
        drawn = same(color);
      }
      return;
    }
    if (object.material instanceof MeshBasicMaterial) drawn = same(object.material.color);
  });
  return drawn;
}

function countObjects(scene: Scene): number {
  let count = 0;
  scene.traverse(() => {
    count += 1;
  });
  return count;
}

test("every agent, zone, shipped pull request, planned issue, and defect is pickable, those placed on no zone too", () => {
  const { host, scene, registrations } = hostOf();
  const snapshot = snapshotOf();
  world.create(host).update(stateOf(snapshot));
  const found = pickable(scene, registrations);
  assert.deepEqual(
    idsOf(found, PICK_KIND.AGENT),
    [BUILDING, WAITING, STUCK, FAILED, IDLE, HOMELESS].sort(),
  );
  assert.deepEqual(idsOf(found, PICK_KIND.ZONE), ZONES.map((zone) => zone.path).sort());
  assert.deepEqual(
    idsOf(found, PICK_KIND.SHIPPED),
    snapshot.shipped.map((merged) => merged.url).sort(),
  );
  assert.deepEqual(idsOf(found, PICK_KIND.PLANNED), ["ENG-31", "ENG-32"]);
  assert.deepEqual(idsOf(found, PICK_KIND.DEFECT), ["41", "42"]);
});

test("each layer switched off takes away what it names and nothing else; a failed agent stands with building off, as a defect", () => {
  const snapshot = snapshotOf();
  const { host, scene, registrations } = hostOf();
  const instance = world.create(host);
  const everything = (() => {
    instance.update(stateOf(snapshot));
    return pickable(scene, registrations);
  })();
  const none: readonly string[] = [];
  const cases = [
    { layer: "planned", gone: PICK_KIND.PLANNED, left: none },
    { layer: "shipped", gone: PICK_KIND.SHIPPED, left: none },
    { layer: "defects", gone: PICK_KIND.DEFECT, left: none },
    { layer: "building", gone: PICK_KIND.AGENT, left: [FAILED] },
  ] as const;
  for (const { layer, gone, left } of cases) {
    instance.update(stateOf(snapshot, { layers: { ...ALL_LAYERS, [layer]: false } }));
    const found = pickable(scene, registrations);
    assert.deepEqual(idsOf(found, gone), [...left], `${layer} off leaves only ${left.join()}`);
    for (const kind of Object.values(PICK_KIND)) {
      if (kind === gone) continue;
      assert.deepEqual(
        idsOf(found, kind),
        idsOf(everything, kind),
        `${layer} off keeps every ${kind}`,
      );
    }
  }
});

test("what is selected or hovered is drawn in the selection colour, the blast radius in its own, and neither while nothing is chosen", () => {
  const snapshot = snapshotOf();
  const { host, scene } = hostOf();
  const instance = world.create(host);
  const plain = stateOf(snapshot);
  instance.update(plain);
  assert.equal(drawsColour(scene, SIGNAL_COLOR.SELECTION), false);
  assert.equal(drawsColour(scene, SIGNAL_COLOR.BLAST_RADIUS), false);

  const blast = new Map(
    blastRadiusOf(plain.view, BUILDING).map((zone) => [zone.path, zone.distance]),
  );
  assert.ok(blast.size > 1, "the building agent ripples past what it touched");
  instance.update({ ...plain, selected: { kind: PICK_KIND.AGENT, id: BUILDING }, blast });
  assert.equal(drawsColour(scene, SIGNAL_COLOR.SELECTION), true);
  assert.equal(drawsColour(scene, SIGNAL_COLOR.BLAST_RADIUS), true);

  for (const hovered of [
    { kind: PICK_KIND.ZONE, id: "apps/site" },
    { kind: PICK_KIND.SHIPPED, id: snapshot.shipped[0]?.url ?? "" },
    { kind: PICK_KIND.PLANNED, id: "ENG-31" },
    { kind: PICK_KIND.DEFECT, id: "41" },
  ]) {
    instance.update({ ...plain, hovered });
    assert.equal(
      drawsColour(scene, SIGNAL_COLOR.SELECTION),
      true,
      `a hovered ${hovered.kind} is marked`,
    );
    instance.update(plain);
    assert.equal(drawsColour(scene, SIGNAL_COLOR.SELECTION), false, `${hovered.kind} let go`);
  }
});

test("scrubbing back redraws the factory as it stood: later merges unlit, an agent's later pull request not yet raised", () => {
  const snapshot = snapshotOf();
  const { host, scene, registrations } = hostOf();
  const instance = world.create(host);
  const earlier = factoryWorldAsOf(snapshot, FACTORY_NOW - DAY_MS);
  instance.update({ ...stateOf(earlier), live: false });
  const found = pickable(scene, registrations);
  assert.deepEqual(
    idsOf(found, PICK_KIND.SHIPPED),
    snapshot.shipped
      .filter((merged) => merged.mergedAt <= FACTORY_NOW - DAY_MS)
      .map((merged) => merged.url)
      .sort(),
  );
  assert.ok(drawsColour(scene, SIGNAL_COLOR.SHIPPED));
  instance.update(stateOf(snapshot));
  assert.equal(
    idsOf(pickable(scene, registrations), PICK_KIND.SHIPPED).length,
    snapshot.shipped.length,
  );
});

test("redrawing builds nothing new, and a repository changed and changed back stands as it did", () => {
  const snapshot = snapshotOf();
  const { host, scene } = hostOf();
  const instance = world.create(host);
  instance.update(stateOf(snapshot));
  const built = countObjects(scene);
  instance.update(stateOf(snapshot, { hovered: { kind: PICK_KIND.ZONE, id: "libs/kit" } }));
  instance.update(stateOf(snapshot, { dark: true }));
  assert.equal(countObjects(scene), built);
  const grown = factoryWorldOf({
    ...snapshot,
    zones: [...ZONES, factoryZoneOf("apps/tool", ["libs/base"])],
  });
  instance.update(stateOf(grown));
  instance.update(stateOf(snapshot));
  assert.equal(countObjects(scene), built);
});

test("motion runs without leaving anything unpickable, and holding still stands every agent where it was placed", () => {
  const snapshot = snapshotOf();
  const { host, scene, registrations } = hostOf();
  const instance = world.create(host);
  const moving = stateOf(snapshot, { still: false });
  instance.update(moving);
  for (let step = 0; step < 600; step += 1) instance.frame?.(1 / 30, step / 30);
  const found = pickable(scene, registrations);
  assert.equal(idsOf(found, PICK_KIND.AGENT).length, 6);
  assert.equal(idsOf(found, PICK_KIND.SHIPPED).length >= snapshot.shipped.length, true);
  instance.update(stateOf(snapshot));
  assert.deepEqual(pickable(scene, registrations).get(PICK_KIND.AGENT), found.get(PICK_KIND.AGENT));
});

test("the contract's bounds build and move: two hundred zones, a hundred agents, and every merge, plan, and defect", () => {
  const bounds = FACTORY_WORLD_BOUNDS;
  const zones = Array.from({ length: bounds.MAX_ZONES }, (_, index) =>
    factoryZoneOf(`group${index % 12}/zone${index}`, index === 0 ? [] : [`group0/zone0`], {
      bytes: 500 + index * 37,
    }),
  );
  const at = (index: number) => zones[index % zones.length]?.path ?? "group0/zone0";
  const snapshot = factoryWorldOf({
    zones,
    agents: Array.from({ length: bounds.MAX_AGENTS }, (_, index) =>
      factoryAgentOf(index + 1, {
        pullRequest: factoryPullRequestOf({
          number: 1000 + index,
          areas: [areaOf(`${at(index * 7)}/src`, 40 + index * 60)],
        }),
      }),
    ),
    shipped: Array.from({ length: bounds.MAX_SHIPPED }, (_, index) =>
      factoryShippedOf(2000 + index, FACTORY_NOW - index * HOUR_MS, {
        areas: [areaOf(`${at(index * 3)}/src`, 50)],
      }),
    ),
    planned: Array.from({ length: bounds.MAX_PLANNED }, (_, index) =>
      factoryPlannedOf(index, { zonePaths: index % 2 ? [at(index)] : [] }),
    ),
    defects: Array.from({ length: bounds.MAX_DEFECTS }, (_, index) =>
      factoryDefectOf(index, { events: index * 3, zonePaths: index % 3 ? [at(index * 5)] : [] }),
    ),
  });
  const { host, scene, registrations } = hostOf();
  const instance = world.create(host);
  instance.update(stateOf(snapshot, { still: false }));
  for (let step = 0; step < 60; step += 1) instance.frame?.(1 / 30, step / 30);
  const found = pickable(scene, registrations);
  assert.equal(idsOf(found, PICK_KIND.ZONE).length, bounds.MAX_ZONES);
  assert.equal(idsOf(found, PICK_KIND.AGENT).length, bounds.MAX_AGENTS);
  assert.equal(idsOf(found, PICK_KIND.SHIPPED).length, bounds.MAX_SHIPPED);
  assert.equal(idsOf(found, PICK_KIND.PLANNED).length, bounds.MAX_PLANNED);
  assert.equal(idsOf(found, PICK_KIND.DEFECT).length, bounds.MAX_DEFECTS);
});
