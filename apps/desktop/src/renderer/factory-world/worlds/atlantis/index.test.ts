import { CODING_AGENT_STATUS, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  FACTORY_WORLD_BOUNDS,
  type FactoryWorld,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
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
import { InstancedMesh, Matrix4, type Object3D, PerspectiveCamera, Scene, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  WORLD_LAYER,
  type WorldHost,
  type WorldLayers,
  type WorldState,
} from "../../world";
import { world } from "./index";

/**
 * index.test.ts -- Atlantis drawn against a fake host: everything the reading names can be picked, each layer switched off takes away what it names and nothing else, a world at the contract's bounds draws whole, and a scrubbed instant draws only what had merged by then.
 *
 * Nothing here renders: what a caller of a world observes without WebGL is
 * what it registered to be picked and whether that is shown, which is what
 * the host's hover label, card, and flights are built on.
 */

/** One registration the world made, as the host would keep it. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

/** A host with no renderer, and what the world registered with it. */
interface FakeHost {
  readonly host: WorldHost;
  readonly registrations: Set<Registration>;
}

/** A host with no renderer, keeping what the world registers. */
function fakeHost(): FakeHost {
  const registrations = new Set<Registration>();
  const scene = new Scene();
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
        const registration = { object, target };
        registrations.add(registration);
        return () => registrations.delete(registration);
      },
      addInstances: (object, targetOf) => {
        const registration = { object, targetOf };
        registrations.add(registration);
        return () => registrations.delete(registration);
      },
    },
    invalidate: () => undefined,
  };
  return { host, registrations };
}

/** Whether `object` is in `scene` and it and every parent are shown, as the host's picking asks. */
function shown(object: Object3D, scene: Scene): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) {
    if (!at.visible) return false;
    if (at === scene) return true;
  }
  return false;
}

/** Every target the host could pick now, by kind, each id once. */
function pickable(registrations: Set<Registration>, scene: Scene): Map<PickKind, Set<string>> {
  const found = new Map<PickKind, Set<string>>(
    Object.values(PICK_KIND).map((kind) => [kind, new Set<string>()]),
  );
  for (const registration of registrations) {
    if (!shown(registration.object, scene)) continue;
    const targets =
      "target" in registration
        ? [registration.target]
        : Array.from({ length: registration.object.count }, (_, index) =>
            registration.targetOf(index),
          );
    for (const target of targets) if (target !== undefined) found.get(target.kind)?.add(target.id);
  }
  return found;
}

/** Where the instance registered for `target` stands, as the host's flight would aim at it. */
function anchorOf(registrations: Set<Registration>, target: PickTarget): Vector3 | undefined {
  for (const registration of registrations) {
    if ("target" in registration) continue;
    for (let index = 0; index < registration.object.count; index += 1) {
      const found = registration.targetOf(index);
      if (found?.kind !== target.kind || found.id !== target.id) continue;
      const matrix = new Matrix4();
      registration.object.getMatrixAt(index, matrix);
      return new Vector3().setFromMatrixPosition(matrix);
    }
  }
  return undefined;
}

/** The sonar rings standing on the floor: every instanced mesh drawn with a ring's look. */
function ringMeshes(scene: Scene): InstancedMesh[] {
  const rings: InstancedMesh[] = [];
  scene.traverse((object) => {
    if (object instanceof InstancedMesh && object.geometry.getAttribute("aPing") !== undefined) {
      rings.push(object);
    }
  });
  return rings;
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
    dark: true,
    ...fields,
  };
}

/** A small repository with a zone in every layer, agents in every state, and every signal. */
function cityOf(): FactoryWorld {
  const zones = [
    factoryZoneOf("packages/wire", [], { bytes: 40_000 }),
    factoryZoneOf("packages/database", ["packages/wire"], { bytes: 30_000 }),
    factoryZoneOf("packages/voice", ["packages/wire"]),
    factoryZoneOf("apps/voice", ["packages/voice", "packages/database"]),
    ...["web", "desktop", "luke", "dev", "catalog", "docs"].map((app) =>
      factoryZoneOf(`apps/${app}`, ["packages/database"], { bytes: 9_000 }),
    ),
    factoryZoneOf("tools", [], { bytes: 2_000 }),
  ];
  const pullRequest = (number: number, path: string, fields = {}) =>
    factoryPullRequestOf({ number, areas: [areaOf(path, 400)], ...fields });
  return factoryWorldOf({
    zones,
    agents: [
      factoryAgentOf(1, { pullRequest: pullRequest(11, "packages/database") }),
      factoryAgentOf(2, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: pullRequest(12, "apps/web"),
      }),
      factoryAgentOf(3, {
        status: CODING_AGENT_STATUS.COMPLETED,
        pullRequest: pullRequest(13, "packages/voice", { state: PULL_REQUEST_STATE.DRAFT }),
      }),
      factoryAgentOf(4, {
        status: CODING_AGENT_STATUS.FAILED,
        pullRequest: pullRequest(14, "tools"),
      }),
      factoryAgentOf(5, {
        status: CODING_AGENT_STATUS.CANCELLED,
        pullRequest: pullRequest(15, "apps/dev"),
      }),
      factoryAgentOf(6),
      factoryAgentOf(7, {
        pullRequest: factoryPullRequestOf({ number: 17, areas: [areaOf("packages/wire", 9_000)] }),
      }),
    ],
    shipped: [
      factoryShippedOf(21, FACTORY_NOW - 2 * HOUR_MS, { areas: [areaOf("apps/desktop", 120)] }),
      factoryShippedOf(22, FACTORY_NOW - 3 * DAY_MS, {
        areas: [areaOf("packages/wire", 50), areaOf("apps/web", 10)],
      }),
      factoryShippedOf(23, FACTORY_NOW - DAY_MS, { areas: [areaOf("nowhere/at/all", 5)] }),
    ],
    planned: [
      factoryPlannedOf(1, {
        zonePaths: ["packages/voice", "apps/voice"],
        priority: LINEAR_PRIORITY.URGENT,
      }),
      factoryPlannedOf(2, { zonePaths: ["packages/wire"] }),
      factoryPlannedOf(3),
    ],
    defects: [
      factoryDefectOf(1, { events: 84, zonePaths: ["packages/database"] }),
      factoryDefectOf(2, { events: 3, zonePaths: ["packages/voice"] }),
      factoryDefectOf(3, { events: 40, zonePaths: ["apps/web"] }),
      factoryDefectOf(4, { zonePaths: ["tools"] }),
      factoryDefectOf(5),
    ],
  });
}

/** Every id the snapshot names, by the kind it is picked as. */
function everythingIn(snapshot: FactoryWorld): Map<PickKind, Set<string>> {
  return new Map<PickKind, Set<string>>([
    [PICK_KIND.ZONE, new Set(snapshot.zones.map((zone) => zone.path))],
    [PICK_KIND.AGENT, new Set(snapshot.agents.map((agent) => agent.id))],
    [PICK_KIND.SHIPPED, new Set(snapshot.shipped.map((merged) => merged.url))],
    [PICK_KIND.PLANNED, new Set(snapshot.planned.map((issue) => issue.identifier))],
    [PICK_KIND.DEFECT, new Set(snapshot.defects.map((defect) => defect.id))],
    // Note that a task is the campus's to pick; no world draws one.
    [PICK_KIND.TASK, new Set()],
  ]);
}

describe("Atlantis", () => {
  it("makes every zone, agent, shipped pull request, planned issue, and defect pickable, in either appearance, held still or moving", () => {
    const snapshot = cityOf();
    for (const fields of [
      { dark: true, still: true },
      { dark: false, still: false },
    ]) {
      const { host, registrations } = fakeHost();
      const instance = world.create(host);
      instance.update(stateOf(snapshot, fields));
      instance.frame?.(1 / 60, 1);
      expect(pickable(registrations, host.scene)).toEqual(everythingIn(snapshot));
      instance.dispose();
    }
  });

  it("draws an empty repository as open sea, with nothing to pick", () => {
    const { host, registrations } = fakeHost();
    const instance = world.create(host);
    instance.update(stateOf(factoryWorldOf(), { still: false }));
    instance.frame?.(1 / 60, 1);
    expect(pickable(registrations, host.scene)).toEqual(everythingIn(factoryWorldOf()));
  });

  it("hides what each layer names when it is switched off, and nothing else, keeping a failed agent while defects are shown", () => {
    const snapshot = cityOf();
    const everything = everythingIn(snapshot);
    const failed = snapshot.agents
      .filter((agent) => agent.status === CODING_AGENT_STATUS.FAILED)
      .map((agent) => agent.id);
    const hidden = {
      [WORLD_LAYER.PLANNED]: [PICK_KIND.PLANNED],
      [WORLD_LAYER.BUILDING]: [PICK_KIND.AGENT],
      [WORLD_LAYER.SHIPPED]: [PICK_KIND.SHIPPED],
      [WORLD_LAYER.DEFECTS]: [PICK_KIND.DEFECT],
    } as const;
    for (const layer of Object.values(WORLD_LAYER)) {
      const { host, registrations } = fakeHost();
      const instance = world.create(host);
      instance.update(stateOf(snapshot));
      instance.update(stateOf(snapshot, { layers: { ...ALL_LAYERS, [layer]: false } }));
      const expected = new Map(everything);
      for (const kind of hidden[layer]) expected.set(kind, new Set());
      if (layer === WORLD_LAYER.BUILDING) expected.set(PICK_KIND.AGENT, new Set(failed));
      expect(pickable(registrations, host.scene), layer).toEqual(expected);
      instance.dispose();
    }
  });

  it("draws a world at every one of the contract's bounds whole, with an agent selected and its blast radius lit", () => {
    const zones = Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_ZONES }, (_, index) =>
      factoryZoneOf(`packages/zone-${index}`, index === 0 ? [] : ["packages/zone-0"], {
        bytes: 1_000 + index * 997,
      }),
    );
    const pathOf = (index: number) => zones[index % zones.length]?.path ?? "packages/zone-0";
    const places = (index: number) =>
      Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_PLACES }, (_, step) =>
        pathOf(index + step * 7),
      );
    const snapshot = factoryWorldOf({
      zones,
      agents: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_AGENTS }, (_, index) =>
        factoryAgentOf(index + 1, {
          pullRequest: factoryPullRequestOf({
            number: index + 1,
            areas: [areaOf(pathOf(index), 6_000), areaOf(pathOf(index + 1), 10)],
          }),
        }),
      ),
      shipped: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_SHIPPED }, (_, index) =>
        factoryShippedOf(1_000 + index, FACTORY_NOW - index * HOUR_MS, {
          areas: [
            areaOf(pathOf(index), 30),
            areaOf(pathOf(index + 3), 20),
            areaOf(pathOf(index + 5), 10),
            areaOf(pathOf(index + 9), 5),
          ],
        }),
      ),
      planned: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_PLANNED }, (_, index) =>
        factoryPlannedOf(index + 1, { zonePaths: places(index) }),
      ),
      defects: Array.from({ length: FACTORY_WORLD_BOUNDS.MAX_DEFECTS }, (_, index) =>
        factoryDefectOf(index + 1, { events: index * 3, zonePaths: places(index) }),
      ),
    });
    const view = factoryWorldViewOf(snapshot);
    const selected = { kind: PICK_KIND.AGENT, id: snapshot.agents[0]?.id ?? "" };
    const blast = new Map(
      blastRadiusOf(view, selected.id).map((zone) => [zone.path, zone.distance]),
    );
    const { host, registrations } = fakeHost();
    const instance = world.create(host);
    instance.update(stateOf(snapshot, { selected, blast, still: false }));
    instance.frame?.(1 / 60, 2);
    expect(pickable(registrations, host.scene)).toEqual(everythingIn(snapshot));
  });

  it("stands two issues planned on the same zones apart, so each can be picked", () => {
    const snapshot = factoryWorldOf({
      zones: [
        factoryZoneOf("packages/wire"),
        factoryZoneOf("packages/live"),
        ...["a", "b", "c"].map((app) =>
          factoryZoneOf(`apps/${app}`, ["packages/wire", "packages/live"]),
        ),
      ],
      planned: [
        factoryPlannedOf(1, { zonePaths: ["packages/wire", "packages/live"] }),
        factoryPlannedOf(2, { zonePaths: ["packages/wire", "packages/live"] }),
      ],
    });
    const { host, registrations } = fakeHost();
    const instance = world.create(host);
    instance.update(stateOf(snapshot));
    const [first, second] = ["ENG-1", "ENG-2"].map((id) =>
      anchorOf(registrations, { kind: PICK_KIND.PLANNED, id }),
    );
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.distanceTo(second ?? new Vector3()) ?? 0).toBeGreaterThan(5);
  });

  it("keeps the selected agent's sonar ringing when shipped is switched off after work has landed", () => {
    const snapshot = cityOf();
    const view = factoryWorldViewOf(snapshot);
    const selected = { kind: PICK_KIND.AGENT, id: snapshot.agents[0]?.id ?? "" };
    const blast = new Map(
      blastRadiusOf(view, selected.id).map((zone) => [zone.path, zone.distance]),
    );
    const { host } = fakeHost();
    const instance = world.create(host);
    const moving = stateOf(snapshot, { selected, blast, still: false });
    instance.update(moving);
    // Note that the first work lands about three and a half seconds in, while the sonar rings out every 1.6.
    for (let step = 1; step <= 40; step += 1) instance.frame?.(0.1, step * 0.1);
    const ringing = () => ringMeshes(host.scene).reduce((rings, mesh) => rings + mesh.count, 0);
    expect(ringing()).toBeGreaterThanOrEqual(2);
    instance.update({ ...moving, layers: { ...ALL_LAYERS, shipped: false } });
    expect(ringing()).toBeGreaterThanOrEqual(1);
  });

  it("draws a scrubbed instant from its own view: work merged later is not there to pick", () => {
    const snapshot = cityOf();
    const { host, registrations } = fakeHost();
    const instance = world.create(host);
    instance.update(stateOf(snapshot));
    const before = factoryWorldAsOf(snapshot, FACTORY_NOW - 12 * HOUR_MS);
    instance.update(stateOf(before, { live: false }));
    expect(pickable(registrations, host.scene).get(PICK_KIND.SHIPPED)).toEqual(
      new Set(before.shipped.map((merged) => merged.url)),
    );
    expect(before.shipped.length).toBeLessThan(snapshot.shipped.length);
  });
});
