import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
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
  Box3,
  type EventDispatcher,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
} from "three";
import { test } from "vitest";
import { world } from "./index";

/**
 * planet.test.ts -- the Planet as the host sees it without WebGL: what it offers to be picked, and what each layer switch takes away.
 *
 * The host picks only what a world registers and only while it is shown, so
 * the stand-in host here keeps the registrations and answers, the same way,
 * which targets a press could land on.
 */

/** One registration, as the host's picking keeps it. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instance: number) => PickTarget | undefined;
    };

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (!at.visible) return false;
  return true;
}

/** A host with no renderer, answering every target a press could land on. */
function standInHost() {
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
      camera: new PerspectiveCamera(40, 1, 0.1, 500),
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
  const pickable = (kind: PickKind): string[] => {
    const ids = new Set<string>();
    for (const registration of registrations) {
      if (!shown(registration.object)) continue;
      const targets =
        "target" in registration
          ? [registration.target]
          : Array.from({ length: registration.object.count }, (_, at) => registration.targetOf(at));
      for (const target of targets) if (target?.kind === kind) ids.add(target.id);
    }
    return [...ids].sort();
  };
  /** Where each registered instance of `target` stands in the scene, as the host aims at it. */
  const anchorsOf = (target: PickTarget): Vector3[] => {
    host.scene.updateMatrixWorld(true);
    const found: Vector3[] = [];
    const matrix = new Matrix4();
    for (const registration of registrations) {
      if ("target" in registration) {
        if (registration.target.kind === target.kind && registration.target.id === target.id) {
          found.push(new Box3().setFromObject(registration.object).getCenter(new Vector3()));
        }
        continue;
      }
      const mesh = registration.object;
      for (let at = 0; at < mesh.count; at += 1) {
        const each = registration.targetOf(at);
        if (each?.kind !== target.kind || each.id !== target.id) continue;
        mesh.getMatrixAt(at, matrix);
        found.push(new Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld));
      }
    }
    return found;
  };
  return { host, pickable, anchorsOf };
}

const ZONES = [
  factoryZoneOf("packages/wire"),
  factoryZoneOf("packages/runtime", ["packages/wire"]),
  factoryZoneOf("packages/service", ["packages/runtime", "packages/wire"], { bytes: 9000 }),
  factoryZoneOf("packages/ui", ["packages/wire"]),
  factoryZoneOf("apps/desktop", ["packages/service", "packages/ui"], { bytes: 6000 }),
  factoryZoneOf("apps/web", ["packages/service", "packages/ui"]),
  factoryZoneOf("scripts"),
];

const MERGED_AT = FACTORY_NOW - 2 * HOUR_MS;

/** A snapshot with something of every kind: agents working, waiting, and failed; two merges; issues and defects placed and not. */
function snapshot(): FactoryWorld {
  return factoryWorldOf({
    zones: ZONES,
    agents: [
      factoryAgentOf(1, {
        pullRequest: factoryPullRequestOf({ number: 11, areas: [areaOf("apps/desktop", 400)] }),
      }),
      factoryAgentOf(2, {
        status: CODING_AGENT_STATUS.FAILED,
        pullRequest: factoryPullRequestOf({ number: 12, areas: [areaOf("packages/service", 90)] }),
      }),
      factoryAgentOf(4),
      factoryAgentOf(5, {
        pullRequest: factoryPullRequestOf({
          number: 15,
          areas: [
            areaOf("apps/desktop", 200),
            areaOf("packages/service", 150),
            areaOf("apps/web", 150),
          ],
        }),
      }),
      factoryAgentOf(3, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: factoryPullRequestOf({
          number: 13,
          title: "refactor(wire): tidy it",
          state: PULL_REQUEST_STATE.OPEN,
          areas: [areaOf("packages/wire", 30), areaOf("scripts", 10)],
        }),
      }),
    ],
    shipped: [
      factoryShippedOf(21, MERGED_AT, { areas: [areaOf("apps/web", 120)] }),
      factoryShippedOf(22, FACTORY_NOW - 30 * HOUR_MS, { areas: [areaOf("packages/wire", 40)] }),
    ],
    planned: [factoryPlannedOf(1, { zonePaths: ["apps/desktop"] }), factoryPlannedOf(2)],
    defects: [
      factoryDefectOf(1, { events: 40, zonePaths: ["apps/desktop"] }),
      factoryDefectOf(2, { events: 8, zonePaths: ["packages/service"] }),
      factoryDefectOf(3, { events: 2, zonePaths: ["packages/wire"] }),
      factoryDefectOf(4),
    ],
  });
}

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

function stateOf(world: FactoryWorld, fields: Partial<WorldState> = {}): WorldState {
  return {
    view: factoryWorldViewOf(world),
    snapshot: world,
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

test("every zone, agent (placed in a zone or not), merged pull request, planned issue, and defect is offered to be picked", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(snapshot()));

  assert.deepEqual(pickable(PICK_KIND.ZONE), ZONES.map((zone) => zone.path).sort());
  assert.deepEqual(
    pickable(PICK_KIND.AGENT),
    [1, 2, 3, 4, 5].map((n) => uuidOf(n)),
  );
  assert.deepEqual(pickable(PICK_KIND.SHIPPED), [
    "https://github.com/acme/factory/pull/21",
    "https://github.com/acme/factory/pull/22",
  ]);
  assert.deepEqual(pickable(PICK_KIND.PLANNED), ["ENG-1", "ENG-2"]);
  assert.deepEqual(pickable(PICK_KIND.DEFECT), ["1", "2", "3", "4"]);
  planet.dispose();
});

test("each layer switched off takes what it names out of reach, and leaves the rest", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  const world0 = snapshot();
  planet.update(stateOf(world0));

  planet.update(stateOf(world0, { layers: { ...ALL_LAYERS, building: false } }));
  assert.deepEqual(
    pickable(PICK_KIND.AGENT),
    [uuidOf(2)],
    "a failed agent stands without the building layer",
  );
  planet.update(stateOf(world0, { layers: { ...ALL_LAYERS, shipped: false } }));
  assert.deepEqual(pickable(PICK_KIND.SHIPPED), []);
  planet.update(stateOf(world0, { layers: { ...ALL_LAYERS, planned: false } }));
  assert.deepEqual(pickable(PICK_KIND.PLANNED), []);
  planet.update(stateOf(world0, { layers: { ...ALL_LAYERS, defects: false } }));
  assert.deepEqual(pickable(PICK_KIND.DEFECT), []);
  assert.equal(pickable(PICK_KIND.ZONE).length, ZONES.length, "the zones stand under every layer");

  planet.update(stateOf(world0));
  assert.equal(pickable(PICK_KIND.AGENT).length, 5);
  assert.equal(pickable(PICK_KIND.SHIPPED).length, 2);
  planet.dispose();
});

test("with one layer drawn alone, a failed agent is in reach under Defects and not under Planned", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  const world0 = snapshot();
  const alone = (layer: keyof WorldLayers): WorldLayers => ({
    planned: layer === "planned",
    building: layer === "building",
    shipped: layer === "shipped",
    defects: layer === "defects",
  });
  planet.update(stateOf(world0, { layers: alone("planned") }));
  assert.deepEqual(pickable(PICK_KIND.AGENT), []);
  planet.update(stateOf(world0, { layers: alone("defects") }));
  assert.deepEqual(pickable(PICK_KIND.AGENT), [uuidOf(2)]);
  planet.update(stateOf(world0, { layers: alone("shipped") }));
  assert.deepEqual(pickable(PICK_KIND.AGENT), []);
  planet.dispose();
});

test("scrubbed back before a merge, the merge is not there to pick, and back at now it is", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  const now = snapshot();
  planet.update(stateOf(now));

  const before = factoryWorldAsOf(now, MERGED_AT - HOUR_MS);
  planet.update(stateOf(before, { live: false }));
  assert.deepEqual(pickable(PICK_KIND.SHIPPED), ["https://github.com/acme/factory/pull/22"]);

  planet.update(stateOf(now));
  assert.equal(pickable(PICK_KIND.SHIPPED).length, 2);
  planet.dispose();
});

test("an agent selected, its blast radius drawn, and selection moved on keep every target in reach", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  const world0 = snapshot();
  const view = factoryWorldViewOf(world0);
  const selected = { kind: PICK_KIND.AGENT, id: uuidOf(1) };
  const blast = new Map(blastRadiusOf(view, selected.id).map((zone) => [zone.path, zone.distance]));
  planet.update(stateOf(world0, { selected, blast, still: false }));
  planet.frame?.(0.016, 1);
  planet.update(stateOf(world0, { hovered: { kind: PICK_KIND.ZONE, id: "packages/wire" } }));

  assert.equal(pickable(PICK_KIND.AGENT).length, 5);
  assert.equal(pickable(PICK_KIND.ZONE).length, ZONES.length);
  planet.dispose();
});

test("a world with no zones yet draws nothing to pick, and draws them once they arrive", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(factoryWorldOf()));
  assert.deepEqual(pickable(PICK_KIND.ZONE), []);

  planet.update(stateOf(snapshot()));
  assert.equal(pickable(PICK_KIND.ZONE).length, ZONES.length);
  planet.dispose();
});

test("an agent whose work lands in no zone yet waits at the camp on the cutaway's floor, between the core and the sea", () => {
  const { host, anchorsOf } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(snapshot()));

  const [rig] = anchorsOf({ kind: PICK_KIND.AGENT, id: uuidOf(4) });
  assert.ok(rig, "the unplaced agent stands somewhere");
  const outward = Math.hypot(rig.x, rig.z);
  assert.ok(rig.x > 0 && rig.z > 0 && Math.abs(rig.y) < 1, "on the cutaway's floor");
  assert.ok(outward > 7 && outward < 10, "past the core, short of the sea");
  planet.dispose();
});

test("a defect placed in the core alone vents from its shell, and one placed on nothing circles in orbit", () => {
  const { host, anchorsOf } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(snapshot()));

  const inCore = anchorsOf({ kind: PICK_KIND.DEFECT, id: "3" });
  assert.ok(inCore.length > 0);
  assert.ok(
    inCore.every((at) => at.length() < 7),
    "inside the core, not in orbit",
  );
  const nowhere = anchorsOf({ kind: PICK_KIND.DEFECT, id: "4" });
  assert.ok(nowhere.length > 0 && nowhere.every((at) => at.length() > 10));
  planet.dispose();
});

test("an astronaut working in three zones never leaps: each step of its loop starts where the last one ended", () => {
  const { host, anchorsOf } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(snapshot(), { still: false }));
  const step = 0.02;
  const moves: number[] = [];
  let last: Vector3 | undefined;
  for (let elapsed = step; elapsed < 90; elapsed += step) {
    planet.frame?.(step, elapsed);
    const astronaut = anchorsOf({ kind: PICK_KIND.AGENT, id: uuidOf(5) }).at(-1);
    assert.ok(astronaut);
    if (last !== undefined) moves.push(astronaut.distanceTo(last));
    last = astronaut.clone();
  }
  // Note that a leap is a frame's move far past both its neighbours', where a hop by jetpack eases in and out.
  const leaps = moves.filter(
    (move, at) => move > 0.1 && move > 4 * Math.max(moves[at - 1] ?? 0, moves[at + 1] ?? 0),
  );
  assert.deepEqual(leaps, []);
  planet.dispose();
});

test("a crowded world, its cities asking for more towers than are allocated, draws no instance past its allocation", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  // Note that 60 small and 140 large cities ask for 6,100 towers once each share is rounded.
  const zones = Array.from({ length: 200 }, (_, at) =>
    factoryZoneOf(`apps/city-${String(at).padStart(3, "0")}`, [], {
      bytes: at < 60 ? 400 : 10000,
    }),
  );
  planet.update(stateOf(factoryWorldOf({ zones })));
  assert.equal(pickable(PICK_KIND.ZONE).length, 200);
  const overdrawn: string[] = [];
  host.scene.traverse((object) => {
    if (object instanceof InstancedMesh && object.count > object.instanceMatrix.count) {
      overdrawn.push(`${object.count} of ${object.instanceMatrix.count}`);
    }
  });
  assert.deepEqual(
    overdrawn,
    [],
    "the renderer is never asked for an instance it has no matrix for",
  );
  planet.dispose();
});

test("taken down, the world lets go of what the host's sweep of the scene cannot reach", () => {
  const { host } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(snapshot()));
  const outside = new Set<EventDispatcher<{ dispose: object }>>();
  host.scene.traverse((object) => {
    if (object instanceof Mesh && object.customDepthMaterial !== undefined) {
      outside.add(object.customDepthMaterial);
    }
    const materials: Material[] = object instanceof Mesh ? [object.material].flat() : [];
    for (const material of materials) {
      if (!(material instanceof ShaderMaterial)) continue;
      for (const uniform of Object.values(material.uniforms)) {
        if (uniform.value instanceof Texture) outside.add(uniform.value);
      }
    }
  });
  assert.ok(outside.size > 0);
  const released = new Set<unknown>();
  for (const item of outside) item.addEventListener("dispose", () => released.add(item));
  planet.dispose();
  assert.equal(released.size, outside.size);
});
