import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
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
import { type InstancedMesh, type Object3D, PerspectiveCamera, Scene } from "three";
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
  return { host, pickable };
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

test("every zone, agent at work, merged pull request, planned issue, and defect is offered to be picked", () => {
  const { host, pickable } = standInHost();
  const planet = world.create(host);
  planet.update(stateOf(snapshot()));

  assert.deepEqual(pickable(PICK_KIND.ZONE), ZONES.map((zone) => zone.path).sort());
  assert.deepEqual(pickable(PICK_KIND.AGENT), [uuidOf(1), uuidOf(2), uuidOf(3)]);
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
  assert.equal(pickable(PICK_KIND.AGENT).length, 3);
  assert.equal(pickable(PICK_KIND.SHIPPED).length, 2);
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

  assert.equal(pickable(PICK_KIND.AGENT).length, 3);
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
