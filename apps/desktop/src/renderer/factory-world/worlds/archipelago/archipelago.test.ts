import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { FactoryWorld } from "@luke/features/factory-world-wire";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldHost,
  type WorldLayers,
  type WorldPoint,
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
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import { test } from "vitest";
import { world } from "./index";

/**
 * archipelago.test.ts -- the Sky Archipelago as the scene host sees it without WebGL: what it registers to be picked and leaves shown, under each layer switch and at a scrubbed instant, where those targets stand, and the establishing shot it frames.
 *
 * The host is a stand-in recording the world's camera calls and picking
 * registrations over a real Three.js scene; a target counts as drawn when
 * its registered object and every parent of it is visible, as the host's
 * picking reads it. The snapshots are synthetic.
 */

/** One picking registration, as the world made it. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

/** The stand-in host, and what the world told it. */
interface StandIn {
  readonly host: WorldHost;
  readonly registrations: Registration[];
  readonly homes: { position: WorldPoint; target: WorldPoint }[];
}

function standIn(): StandIn {
  const registrations: Registration[] = [];
  const homes: StandIn["homes"] = [];
  const host: WorldHost = {
    scene: new Scene(),
    camera: {
      camera: new PerspectiveCamera(),
      setHome: (position, target) => homes.push({ position, target }),
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
  return { host, registrations, homes };
}

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) if (!at.visible) return false;
  return true;
}

/** Every target drawn and registered, with where it stands. */
function drawn(registrations: readonly Registration[]): { target: PickTarget; at: Vector3 }[] {
  const matrix = new Matrix4();
  return registrations.flatMap((registration) => {
    if (!shown(registration.object)) return [];
    if ("target" in registration)
      return [{ target: registration.target, at: registration.object.position.clone() }];
    const mesh = registration.object;
    return Array.from({ length: mesh.count }, (_, instanceId) => {
      const target = registration.targetOf(instanceId);
      mesh.getMatrixAt(instanceId, matrix);
      return target === undefined
        ? []
        : [{ target, at: new Vector3().setFromMatrixPosition(matrix) }];
    }).flat();
  });
}

/** The ids drawn of `kind`, sorted. */
function idsOf(registrations: readonly Registration[], kind: PickKind): string[] {
  return [
    ...new Set(
      drawn(registrations)
        .filter(({ target }) => target.kind === kind)
        .map(({ target }) => target.id),
    ),
  ].sort();
}

const ALL_LAYERS: WorldLayers = { planned: true, building: true, shipped: true, defects: true };

/** A world state over `snapshot` as of `instant`, everything shown, nothing chosen. */
function stateOf(
  snapshot: FactoryWorld,
  fields: Partial<WorldState> = {},
  instant = snapshot.snapshotAt,
): WorldState {
  const asOf = factoryWorldAsOf(snapshot, instant);
  return {
    view: factoryWorldViewOf(asOf),
    snapshot: asOf,
    live: instant >= snapshot.snapshotAt,
    selected: undefined,
    hovered: undefined,
    blast: new Map(),
    layers: ALL_LAYERS,
    still: true,
    dark: false,
    ...fields,
  };
}

const EARLY_MERGE = factoryShippedOf(3400, FACTORY_NOW - 3 * DAY_MS, {
  areas: [areaOf("packages/core", 40)],
});
const LATE_MERGE = factoryShippedOf(3450, FACTORY_NOW - HOUR_MS, {
  areas: [areaOf("apps/web", 300)],
});

/** A core two apps and a tool depend on; agents working, failed, idle, and placed nowhere; two merges; two issues; and two defects. */
const SNAPSHOT = factoryWorldOf({
  zones: [
    factoryZoneOf("packages/core", [], { bytes: 40_000 }),
    factoryZoneOf("packages/wire", ["packages/core"]),
    factoryZoneOf("apps/web", ["packages/core", "packages/wire"], { bytes: 20_000 }),
    factoryZoneOf("apps/desktop", ["packages/core", "packages/wire"]),
    factoryZoneOf("scripts", ["packages/core"]),
  ],
  agents: [
    factoryAgentOf(1, {
      pullRequest: factoryPullRequestOf({
        number: 3501,
        areas: [areaOf("apps/web", 900), areaOf("packages/core", 40)],
      }),
    }),
    factoryAgentOf(2, {
      pullRequest: factoryPullRequestOf({
        number: 3502,
        title: "refactor(desktop): tidy it",
        areas: [areaOf("apps/desktop", 60)],
      }),
    }),
    factoryAgentOf(3, {
      status: CODING_AGENT_STATUS.FAILED,
      pullRequest: factoryPullRequestOf({ number: 3503, areas: [areaOf("packages/wire", 12)] }),
    }),
    factoryAgentOf(4, {
      status: CODING_AGENT_STATUS.CANCELLED,
      pullRequest: factoryPullRequestOf({ number: 3504, areas: [areaOf("apps/web", 5)] }),
    }),
    factoryAgentOf(5),
  ],
  shipped: [LATE_MERGE, EARLY_MERGE],
  planned: [factoryPlannedOf(1, { zonePaths: ["apps/web"] }), factoryPlannedOf(2)],
  defects: [
    factoryDefectOf(1, { events: 80, zonePaths: ["packages/core", "apps/web"] }),
    factoryDefectOf(2),
  ],
});

function created(snapshot: FactoryWorld = SNAPSHOT, fields: Partial<WorldState> = {}) {
  const stand = standIn();
  const instance = world.create(stand.host);
  const state = stateOf(snapshot, fields);
  instance.update(state);
  return { ...stand, instance, state };
}

test("every zone, agent, merged pull request, planned issue, and defect is drawn and pickable", () => {
  const { registrations, state } = created();
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.ZONE),
    state.view.zones.map((zone) => zone.path).sort(),
  );
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.AGENT),
    SNAPSHOT.agents.map((agent) => agent.id).sort(),
  );
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.SHIPPED),
    [EARLY_MERGE.url, LATE_MERGE.url].sort(),
  );
  assert.deepEqual(idsOf(registrations, PICK_KIND.PLANNED), ["ENG-1", "ENG-2"]);
  assert.deepEqual(idsOf(registrations, PICK_KIND.DEFECT), ["1", "2"]);
});

test("each layer switched off leaves out what it names and nothing else", () => {
  const { registrations, instance, state } = created();
  const kinds = [
    PICK_KIND.ZONE,
    PICK_KIND.AGENT,
    PICK_KIND.SHIPPED,
    PICK_KIND.PLANNED,
    PICK_KIND.DEFECT,
  ];
  const everything = new Map(kinds.map((kind) => [kind, idsOf(registrations, kind)]));
  const failed = SNAPSHOT.agents.find((agent) => agent.status === CODING_AGENT_STATUS.FAILED)?.id;
  const expectations = [
    { layer: "planned", gone: PICK_KIND.PLANNED, kept: [] },
    { layer: "shipped", gone: PICK_KIND.SHIPPED, kept: [] },
    { layer: "defects", gone: PICK_KIND.DEFECT, kept: [] },
    { layer: "building", gone: PICK_KIND.AGENT, kept: failed === undefined ? [] : [failed] },
  ] as const;
  for (const { layer, gone, kept } of expectations) {
    instance.update({ ...state, layers: { ...ALL_LAYERS, [layer]: false } });
    assert.deepEqual(idsOf(registrations, gone), [...kept], `${layer} off leaves out its own`);
    for (const kind of kinds.filter((other) => other !== gone)) {
      assert.deepEqual(
        idsOf(registrations, kind),
        everything.get(kind),
        `${layer} off keeps ${kind}`,
      );
    }
  }
  instance.update({ ...state, layers: { ...ALL_LAYERS, building: false, defects: false } });
  assert.deepEqual(
    idsOf(registrations, PICK_KIND.AGENT),
    [],
    "a failed agent goes too once defects are off",
  );
});

test("scrubbed back, a pull request merged after the instant is not on the lane, and one merged before it is", () => {
  const { registrations, instance } = created();
  instance.update(stateOf(SNAPSHOT, {}, FACTORY_NOW - DAY_MS));
  assert.deepEqual(idsOf(registrations, PICK_KIND.SHIPPED), [EARLY_MERGE.url]);
});

test("a zone stands where it stood through hovers, selections, and the blast radius, and again in a world built anew", () => {
  const { registrations, instance, state } = created();
  const zonesAt = (from: readonly Registration[]) =>
    new Map(
      drawn(from)
        .filter(({ target }) => target.kind === PICK_KIND.ZONE)
        .map(({ target, at }) => [target.id, at.toArray()]),
    );
  const before = zonesAt(registrations);
  const agent = SNAPSHOT.agents[0]?.id ?? "";
  instance.update({
    ...state,
    still: false,
    selected: { kind: PICK_KIND.AGENT, id: agent },
    hovered: { kind: PICK_KIND.ZONE, id: "apps/web" },
    blast: new Map(blastRadiusOf(state.view, agent).map((zone) => [zone.path, zone.distance])),
  });
  instance.frame?.(0.016, 3);
  assert.deepEqual(zonesAt(registrations), before);
  assert.deepEqual(zonesAt(created().registrations), before);
});

test("no two zones' islands stand on top of each other, however crowded their layout", () => {
  const crowded = factoryWorldOf({
    zones: [
      factoryZoneOf("packages/core"),
      ...Array.from({ length: 60 }, (_, n) =>
        factoryZoneOf(`packages/core/part-${n}`, ["packages/core"]),
      ),
    ],
  });
  const { registrations } = created(crowded);
  const zones = drawn(registrations).filter(({ target }) => target.kind === PICK_KIND.ZONE);
  for (const [i, a] of zones.entries()) {
    for (const b of zones.slice(i + 1)) {
      assert.ok(
        Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z) > 2,
        `${a.target.id} and ${b.target.id} stand apart`,
      );
    }
  }
});

test("the establishing shot stands farther out over a larger archipelago", () => {
  const distance = (homes: StandIn["homes"]) => {
    const home = homes.at(-1);
    assert.ok(home, "a home is set");
    return new Vector3(home.position.x, home.position.y, home.position.z).distanceTo(
      new Vector3(home.target.x, home.target.y, home.target.z),
    );
  };
  const small = created(factoryWorldOf({ zones: [factoryZoneOf("packages/core")] }));
  const large = created(
    factoryWorldOf({
      zones: [
        factoryZoneOf("packages/core", [], { bytes: 400_000 }),
        ...Array.from({ length: 120 }, (_, n) =>
          factoryZoneOf(`apps/app-${n}`, ["packages/core"], { bytes: 2_000 + n * 50 }),
        ),
      ],
    }),
  );
  assert.ok(distance(large.homes) > distance(small.homes));
});

test("a builder keeps its place while the scrubber takes another off its island", () => {
  const big = { bytes: 400_000 };
  const snapshot = factoryWorldOf({
    zones: [factoryZoneOf("apps/web", [], big)],
    agents: [
      factoryAgentOf(1, {
        pullRequest: factoryPullRequestOf({
          number: 1,
          openedAt: FACTORY_NOW - HOUR_MS,
          areas: [areaOf("apps/web", 50)],
        }),
      }),
      factoryAgentOf(2, {
        pullRequest: factoryPullRequestOf({
          number: 2,
          openedAt: FACTORY_NOW - 3 * DAY_MS,
          areas: [areaOf("apps/web", 50)],
        }),
      }),
    ],
  });
  const stays = snapshot.agents[1]?.id ?? "";
  const placeOf = (registrations: readonly Registration[]) =>
    drawn(registrations)
      .find(({ target }) => target.kind === PICK_KIND.AGENT && target.id === stays)
      ?.at.toArray();
  const { registrations, instance } = created(snapshot);
  const now = placeOf(registrations);
  instance.update(stateOf(snapshot, {}, FACTORY_NOW - DAY_MS));
  assert.ok(now !== undefined);
  assert.deepEqual(placeOf(registrations), now);
});

test("a core zone is tied to the zone outside the core it depends on", () => {
  const snapshot = factoryWorldOf({
    zones: [
      factoryZoneOf("packages/core", ["tools/generate"]),
      factoryZoneOf("packages/a", ["packages/core"]),
      factoryZoneOf("packages/b", ["packages/core"]),
      factoryZoneOf("packages/c", ["packages/core"]),
      factoryZoneOf("tools/generate"),
    ],
  });
  const { host, state } = created(snapshot);
  const index = (path: string) => state.view.zones.findIndex((zone) => zone.path === path);
  assert.equal(state.view.zoneByPath.get("packages/core")?.layer, "core");
  const ties = new Set<string>();
  host.scene.traverse((object) => {
    // SAFETY: a scene object holds a geometry only where it is drawn; the bridges' glow is the one that carries `zones`.
    const zones = (
      object as {
        geometry?: {
          getAttribute?: (
            name: string,
          ) =>
            | { count: number; getX: (i: number) => number; getY: (i: number) => number }
            | undefined;
        };
      }
    ).geometry?.getAttribute?.("zones");
    for (let i = 0; i < (zones?.count ?? 0); i += 1)
      ties.add([zones?.getX(i), zones?.getY(i)].sort().join(" "));
  });
  assert.ok(
    ties.has([index("packages/core"), index("tools/generate")].sort().join(" ")),
    "the core is tied to the tool",
  );
});

test("lightning goes with the defects layer, mid-strike", () => {
  const visibleMeshes = (scene: Scene) => {
    let count = 0;
    scene.traverseVisible(() => {
      count += 1;
    });
    return count;
  };
  const struck = created(SNAPSHOT, { still: false });
  for (let step = 1; step <= 40; step += 1) struck.instance.frame?.(0.05, step * 0.05);
  struck.instance.update({ ...struck.state, layers: { ...ALL_LAYERS, defects: false } });
  const calm = created(SNAPSHOT, { still: false, layers: { ...ALL_LAYERS, defects: false } });
  assert.equal(visibleMeshes(struck.host.scene), visibleMeshes(calm.host.scene));
});
