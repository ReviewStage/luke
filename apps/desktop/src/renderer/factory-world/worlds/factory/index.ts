import type { FactoryDefect, FactoryPlanned } from "@luke/features/factory-world-wire";
import {
  type AgentView,
  agentDrawnUnder,
  type FactoryWorldView,
  type ZoneEdge,
  type ZoneView,
} from "@luke/ui/factory-world";
import {
  BufferAttribute,
  BufferGeometry,
  type Color,
  DoubleSide,
  Euler,
  type Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldModule,
  type WorldState,
} from "../../world";
import { type AgentPlacement, agentsLayerOf, raisesSite, SITE, siteSizeOf } from "./agents";
import { type Belts, beltsOf, paintCrates, rideBelts } from "./belts";
import { buildingPlanOf } from "./buildings";
import { type DefectPin, type DefectPlacement, defectsLayerOf, wreckSizeOf } from "./defects";
import {
  atmosphereOf,
  PARTICLE_SOURCE,
  type ParticleSource,
  type ParticleSpec,
  Particles,
} from "./effects";
import { clamp, col, rngOf, shade } from "./geo";
import {
  type Layout,
  type Lot,
  layoutOf,
  lotWidthOf,
  packRows,
  type Spot,
  truckRoute,
} from "./layout";
import { worldMaterialsOf } from "./materials";
import { hologramSizeOf, type PlannedPlacement, plannedLayerOf } from "./planned";
import { mainZoneOf, shippedLayerOf } from "./shipped";
import { HAUL, trucksOf } from "./trucks";
import { PUFF, turnYard, type Yard, yardOf } from "./yard";

/**
 * index.ts -- the Factory: the repository as a low-poly factory complex, its zones the plants on a street grid, its dependencies conveyor belts, its agents worker robots raising build sites, its shipped work lamps lit and trucks leaving the gate, its plans blueprint holograms, and its defects wreckage.
 *
 * The yard (`yard.ts`), its buildings (`buildings.ts`), and its belts
 * (`belts.ts`) are built from the zones and rebuilt only when they change,
 * or when an apron must grow to hold what now stands on it; everything else
 * is an instanced mesh allocated in `create` at the contract's bounds and
 * redrawn from `update`'s state alone. The scrubber's instant decides every
 * age, so scrubbing redraws the same factory as it stood then.
 *
 * A zone is lit without a draw of its own: the building and belt shaders
 * read each zone's light from a uniform array (`materials.ts`), and an
 * instanced floor and walls glow round each lit lot: the selection's colour
 * on what is chosen or hovered, the blast radius's on the zones the selected
 * agent's work ripples to, rippling outward one dependency at a time while
 * motion runs, and the rest of the factory dimmed beneath them.
 *
 * Signals use the palette as it is; everything else is dressed as the
 * mockup was. The mockup's bloom and tilt-shift passes are gone: its glow
 * comes from overdriven emissive parts the tone mapping rolls off and from
 * additive glows drawn in the scene, its depth from fog.
 */

/** How long the blast radius's ripple takes to step one dependency outward, and to light a zone once there, in seconds. */
const RIPPLE_STEP = 0.28;
const RIPPLE_RISE = 0.25;

/** The sparks' and smoke's own colours: a welder's arc, a hammer's sparks, embers, and the smoke off a fire; dressing, not signals. */
const WELD = shade("#bfe6ff", 4);
const SPARK = shade("#ffb347", 4);
const EMBER = shade("#ff4a2a", 4);
const FIRE = col("#8e2318");
const SOOT = col("#2f2523");
const ASH = col("#4a403c");

/** How wide the yards outside the gate are: the agents waiting there with no zone, and the drafting and scrap yard for issues and defects placed on none. */
const OUTSIDE_WIDTH = 60;

/** One thing an apron holds. */
const APRON = {
  SITE: "site",
  PARKED: "parked",
  HOLOGRAM: "hologram",
  WRECK: "wreck",
} as const;

type ApronItem =
  | {
      readonly kind: typeof APRON.SITE | typeof APRON.PARKED;
      readonly w: number;
      readonly d: number;
      readonly agent: AgentView;
      readonly size: number;
    }
  | {
      readonly kind: typeof APRON.HOLOGRAM;
      readonly w: number;
      readonly d: number;
      readonly issue: FactoryPlanned;
      readonly size: number;
    }
  | {
      readonly kind: typeof APRON.WRECK;
      readonly w: number;
      readonly d: number;
      readonly defect: FactoryDefect;
      readonly size: number;
    };

/** What every apron, and each yard outside the gate, holds. */
interface Aprons {
  readonly byZone: ReadonlyMap<string, readonly ApronItem[]>;
  readonly gate: readonly ApronItem[];
  readonly drafting: readonly ApronItem[];
}

/** How one lot is lit: by the selection, by the blast radius at some distance, or not at all; and whether it is damaged. */
interface LotLight {
  chosen: boolean;
  distance: number | undefined;
  dimmed: boolean;
  damaged: boolean;
}

function isChosen(state: WorldState, kind: PickKind, id: string): boolean {
  return [state.selected, state.hovered].some(
    (target) => target?.kind === kind && target.id === id,
  );
}

/** Whether an agent is drawn under `state`'s layers, as every world asks it (`agentDrawnUnder`). */
function drawsAgent(state: WorldState, agent: AgentView): boolean {
  return agentDrawnUnder(agent, state.layers);
}

/** Everything every apron holds under `state`, whatever its layers, so a switch never moves a road. */
function apronsOf(view: FactoryWorldView, state: WorldState): Aprons {
  const byZone = new Map<string, ApronItem[]>();
  const gate: ApronItem[] = [];
  const drafting: ApronItem[] = [];
  const onZone = (path: string | null | undefined, item: ApronItem, otherwise: ApronItem[]) => {
    if (path === null || path === undefined || !view.zoneByPath.has(path)) {
      otherwise.push(item);
      return;
    }
    const list = byZone.get(path) ?? [];
    list.push(item);
    byZone.set(path, list);
  };
  const agents = [...view.agents].sort(
    (left, right) => right.buildSize - left.buildSize || (left.id < right.id ? -1 : 1),
  );
  for (const agent of agents) {
    const size = siteSizeOf(agent.buildSize);
    const item: ApronItem = raisesSite(agent.state)
      ? { kind: APRON.SITE, w: size + 3.0, d: size + 2.4, agent, size }
      : { kind: APRON.PARKED, w: 3.4, d: 3.4, agent, size: 1.1 };
    onZone(agent.primaryZone, item, gate);
  }
  for (const issue of state.snapshot.planned) {
    const size = hologramSizeOf(issue);
    onZone(
      issue.zonePaths[0],
      { kind: APRON.HOLOGRAM, w: size + 0.8, d: size + 0.8, issue, size },
      drafting,
    );
  }
  for (const defect of state.snapshot.defects) {
    const size = wreckSizeOf(defect);
    onZone(
      defect.zonePaths[0],
      { kind: APRON.WRECK, w: size + 1.4, d: size + 1.4, defect, size },
      drafting,
    );
  }
  return { byZone, gate, drafting };
}

/** Whether the zones and their edges are the ones a yard was built from. */
function sameGround(
  zones: readonly ZoneView[],
  edges: readonly ZoneEdge[],
  builtZones: readonly ZoneView[],
  builtEdges: readonly ZoneEdge[],
): boolean {
  if (zones === builtZones && edges === builtEdges) return true;
  if (zones.length !== builtZones.length || edges.length !== builtEdges.length) return false;
  const zonesMatch = zones.every((zone, index) => {
    const built = builtZones[index];
    return (
      built !== undefined &&
      built.path === zone.path &&
      built.layer === zone.layer &&
      built.ring === zone.ring &&
      built.footprint === zone.footprint &&
      built.transitiveDependents === zone.transitiveDependents
    );
  });
  return (
    zonesMatch &&
    edges.every((edge, index) => {
      const built = builtEdges[index];
      return (
        built !== undefined &&
        built.from === edge.from &&
        built.to === edge.to &&
        built.kind === edge.kind
      );
    })
  );
}

/** Where each item of `items` lands, packed in rows across `width` from (`x0`, `z0`), centred where `centred`. */
function placeRows<Item extends ApronItem>(
  items: readonly Item[],
  x0: number,
  z0: number,
  width: number,
  centred: boolean,
): { item: Item; x: number; z: number }[] {
  const placed: { item: Item; x: number; z: number }[] = [];
  let z = z0;
  for (const row of packRows(width, items).rows) {
    const pad = centred ? (width - 2 - (row.w - 0.4)) / 2 : 0;
    for (const { item, rx } of row.items) {
      const left = x0 + 1 + pad + rx;
      if (item.kind === APRON.SITE)
        placed.push({ item, x: left + 0.3 + item.size / 2, z: z + 0.2 + item.size / 2 });
      else placed.push({ item, x: left + item.w / 2, z: z + item.d / 2 });
    }
    z += row.d + 0.4;
  }
  return placed;
}

/** Lets go of what a torn-down yard made itself, leaving the shared materials. */
function disposeYard(group: Group, shared: ReadonlySet<Material>): void {
  group.traverse((object) => {
    if (object instanceof InstancedMesh) object.dispose();
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) if (!shared.has(material)) material.dispose();
    }
  });
  group.removeFromParent();
}

/** The birds wheeling over the yard: each wing an instanced mesh, and each bird's circle, height, speed, and wingbeat. */
interface Flock {
  readonly left: InstancedMesh;
  readonly right: InstancedMesh;
  readonly flock: readonly { r: number; phase: number; y: number; speed: number; flap: number }[];
}

function birdsOf(): Flock {
  const wing = new BufferGeometry();
  wing.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([0, 0, 0.3, 0, 0, -0.3, 1.2, 0, 0]), 3),
  );
  wing.computeVertexNormals();
  const material = new MeshBasicMaterial({ color: "#2b2d33", side: DoubleSide });
  const rng = rngOf("birds");
  const flock = Array.from({ length: 16 }, () => ({
    r: 50 + rng() * 40,
    phase: rng() * 6,
    y: 38 + rng() * 14,
    speed: 0.07 + rng() * 0.03,
    flap: rng() * 6,
  }));
  const left = new InstancedMesh(wing, material, flock.length);
  const right = new InstancedMesh(wing, material, flock.length);
  left.frustumCulled = false;
  right.frustumCulled = false;
  return { left, right, flock };
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, palette, picking } = host;
    const camera = host.camera.camera;
    host.camera.setHome({ x: 150, y: 140, z: 180 }, { x: 4, y: 0, z: 14 });
    host.camera.setReach(14, 900);

    const atmosphere = atmosphereOf(scene);
    const materials = worldMaterialsOf(palette);
    const agents = agentsLayerOf(palette, materials);
    const shipped = shippedLayerOf(palette);
    const planned = plannedLayerOf(palette);
    const defects = defectsLayerOf(palette, materials.solid);
    const trucks = trucksOf(palette, materials.solid);
    const smoke = new Particles(3200, true);
    const sparks = new Particles(2600, false);
    const birds = birdsOf();
    scene.add(
      agents.group,
      shipped.group,
      planned.group,
      defects.group,
      trucks.group,
      smoke.mesh,
      sparks.mesh,
      birds.left,
      birds.right,
    );

    const target = (kind: PickKind, id: string | undefined): PickTarget | undefined =>
      id === undefined ? undefined : { kind, id };
    picking.addInstances(agents.proxy, (index) =>
      target(PICK_KIND.AGENT, agents.agentAt(index)?.id),
    );
    for (const site of agents.sites) {
      picking.addInstances(site, (index) =>
        target(PICK_KIND.AGENT, agents.siteAgentAt(site, index)?.id),
      );
    }
    picking.addInstances(shipped.lamps, (index) =>
      target(PICK_KIND.SHIPPED, shipped.lampUrlAt(index)),
    );
    picking.addInstances(shipped.pins, (index) => target(PICK_KIND.ZONE, shipped.pinPathAt(index)));
    for (const body of planned.bodies) {
      picking.addInstances(body, (index) =>
        target(PICK_KIND.PLANNED, planned.issueAt(body, index)),
      );
    }
    picking.addInstances(planned.grids, (index) =>
      target(PICK_KIND.PLANNED, planned.issueAt(planned.grids, index)),
    );
    picking.addInstances(defects.wrecks, (index) =>
      target(PICK_KIND.DEFECT, defects.defectAt(index)),
    );
    picking.addInstances(defects.pins, (index) => target(PICK_KIND.ZONE, defects.pinPathAt(index)));
    picking.addInstances(trucks.boxes, (index) => trucks.targetAt(index));

    const signal = palette.signal;
    const motion = rngOf("motion");
    const reserve = new Map<string, number>();
    const scratch = {
      matrix: new Matrix4(),
      tint: col("#ffffff").clone(),
      forward: new Vector3(),
      euler: new Euler(),
    };
    let yard: Yard | undefined;
    let belts: Belts | undefined;
    let builtZones: readonly ZoneView[] = [];
    let builtEdges: readonly ZoneEdge[] = [];
    let unregister: (() => void)[] = [];
    let lights: LotLight[] = [];
    let current: WorldState | undefined;
    let rippleStart: number | undefined;
    let lastBlast: ReadonlyMap<string, number> = new Map();
    let truckDue = 0;
    let returnDue = 3;
    let fleetSent = false;
    let wasStill = true;
    let warmed = false;
    let trainX = 0;
    let cloudX = 0;

    /** How far the camera stands from where it looks, along its line of sight to the ground. */
    const viewDistance = () => {
      camera.getWorldDirection(scratch.forward);
      const down = -scratch.forward.y;
      return down > 0.05 ? camera.position.y / down : camera.position.length();
    };
    const agentScale = () => clamp(viewDistance() / 150, 1, 1.9);
    const pinScale = () => clamp(viewDistance() / 110, 0.8, 4);

    const build = (zones: readonly ZoneView[], edges: readonly ZoneEdge[]) => {
      for (const take of unregister) take();
      unregister = [];
      if (yard !== undefined) disposeYard(yard.group, materials.all);
      const layout = layoutOf(zones, reserve);
      yard = yardOf(layout, materials);
      belts = beltsOf(layout, yard.buildings, edges, materials.belt, materials.solid);
      yard.group.add(belts.mesh, belts.supports, belts.crates);
      scene.add(yard.group);
      const built = yard;
      const zoneAt = (index: number) => target(PICK_KIND.ZONE, built.layout.lots[index]?.zone.path);
      unregister.push(
        picking.addInstances(built.pickBuildings, zoneAt),
        picking.addInstances(built.pickLots, zoneAt),
      );
      builtZones = zones;
      builtEdges = edges;
      lights = layout.lots.map(() => ({
        chosen: false,
        distance: undefined,
        dimmed: false,
        damaged: false,
      }));
      shipped.settle(layout, yard.buildings, yard.lampSlots);
      atmosphere.fit(layout.span);
      // Note that the mockup framed the yard through a 28° lens; the host's is 40°, so the shot stands nearer to frame the same.
      const span = layout.span;
      host.camera.setHome(
        { x: span * 0.56, y: span * 0.54, z: span * 0.07 + span * 0.66 },
        { x: span * 0.02, y: 0, z: span * 0.07 },
      );
      host.camera.setReach(14, span * 4.5);
      trainX = layout.x0 + 40;
      fleetSent = false;
      trucks.clear();
    };

    /** Lights every zone `time` seconds in, the ripple begun at `start`; a still frame, or one with no start, is lit whole. */
    const light = (time: number, start: number | undefined) => {
      const built = yard;
      if (built === undefined || current === undefined) return;
      const state = current;
      const layout = built.layout;
      let floors = 0;
      layout.lots.forEach((lot, index) => {
        const lit = lights[index];
        const zone = materials.zoneLight[index];
        const reach = materials.zoneReach[index];
        if (lit === undefined || zone === undefined || reach === undefined) return;
        const distance = lit.distance;
        const reveal =
          start === undefined || distance === undefined
            ? 1
            : clamp((time - start - distance * RIPPLE_STEP) / RIPPLE_RISE, 0, 1);
        const pulse = start === undefined ? 1 : 0.7 + 0.3 * Math.sin(time * 5 - (distance ?? 0));
        let tint: Color | undefined;
        let glow = 0;
        let floor = 0;
        let walls = 0;
        if (lit.chosen) {
          tint = col(signal.SELECTION);
          glow = 0.2;
          floor = 0.32;
          walls = 0.14;
        } else if (distance !== undefined) {
          tint = col(signal.BLAST_RADIUS);
          const falloff = 1 / (1 + 0.35 * distance);
          glow = (distance === 0 ? 0.2 : 0.1 * falloff) * reveal * pulse;
          floor = (distance === 0 ? 0.36 : 0.4 * falloff) * reveal;
          walls = (distance === 0 ? 0.16 : 0.12 * falloff) * reveal;
        }
        zone.set(
          (tint?.r ?? 0) * glow,
          (tint?.g ?? 0) * glow,
          (tint?.b ?? 0) * glow,
          lit.dimmed ? 0.55 : 1,
        );
        reach.set(
          distance === undefined ? 0 : reveal,
          lit.damaged && state.layers.defects ? 1 : 0,
          0,
          0,
        );
        if (tint === undefined || floor <= 0) return;
        scratch.matrix.makeScale(lot.W, 1, lot.D).setPosition(lot.cx, 0.4, lot.cz);
        built.highlightFloor.setMatrixAt(floors, scratch.matrix);
        built.highlightFloor.setColorAt(floors, scratch.tint.copy(tint).multiplyScalar(floor));
        scratch.matrix.makeScale(lot.W, 1, lot.D).setPosition(lot.cx, 0.24, lot.cz);
        built.highlightWalls.setMatrixAt(floors, scratch.matrix);
        built.highlightWalls.setColorAt(floors, scratch.tint.copy(tint).multiplyScalar(walls));
        floors += 1;
      });
      for (const mesh of [built.highlightFloor, built.highlightWalls]) {
        mesh.count = floors;
        mesh.visible = floors > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    };

    /** Places every agent, issue, and defect on its apron or outside the gate. */
    const place = (state: WorldState, layout: Layout, aprons: Aprons) => {
      const view = state.view;
      const placedAgents: AgentPlacement[] = [];
      const placedIssues: PlannedPlacement[] = [];
      const placedDefects: DefectPlacement[] = [];
      const take = (
        placed: readonly { item: ApronItem; x: number; z: number }[],
        lot: Lot | undefined,
      ) => {
        for (const { item, x, z } of placed) {
          if (item.kind === APRON.HOLOGRAM) {
            if (state.layers.planned)
              placedIssues.push({ issue: item.issue, x, z, size: item.size });
          } else if (item.kind === APRON.WRECK) {
            if (state.layers.defects)
              placedDefects.push({ defect: item.defect, x, z, size: item.size });
          } else if (drawsAgent(state, item.agent)) {
            const deliveries = item.agent.touched
              .filter((touched) => touched.path !== item.agent.primaryZone)
              .flatMap((touched) => layout.lotByPath.get(touched.path) ?? [])
              .slice(0, 4);
            placedAgents.push({ view: item.agent, x, z, size: item.size, lot, deliveries });
          }
        }
      };
      for (const lot of layout.lots) {
        const items = aprons.byZone.get(lot.zone.path) ?? [];
        take(placeRows(items, lot.x0, lot.apronZ, lot.W, true), lot);
      }
      take(
        placeRows(
          aprons.gate,
          layout.gateX - 14 - OUTSIDE_WIDTH,
          layout.z1 + 10,
          OUTSIDE_WIDTH,
          false,
        ),
        undefined,
      );
      take(
        placeRows(aprons.drafting, layout.gateX + 14, layout.z1 + 10, OUTSIDE_WIDTH, false),
        undefined,
      );

      agents.show(placedAgents, (agent) => isChosen(state, PICK_KIND.AGENT, agent.id), layout);
      planned.show(placedIssues, (identifier) => isChosen(state, PICK_KIND.PLANNED, identifier));
      const events = new Map<string, number>();
      for (const placement of placedDefects) {
        const path = placement.defect.zonePaths[0];
        if (path !== undefined && layout.lotByPath.has(path))
          events.set(path, (events.get(path) ?? 0) + placement.defect.events);
      }
      const pins: DefectPin[] = [...events].flatMap(([path, count]) => {
        const lot = layout.lotByPath.get(path);
        const building = lot === undefined ? undefined : yard?.buildings[lot.index];
        if (lot === undefined || building === undefined) return [];
        return [
          {
            path,
            x: lot.bx + Math.min(3, building.w * 0.2),
            y: 0.24 + building.top + 1.5,
            z: lot.bz,
            events: count,
          },
        ];
      });
      defects.show(placedDefects, pins, (id) => isChosen(state, PICK_KIND.DEFECT, id));
      shipped.show(
        view.timeline,
        view.snapshotAt,
        (path) => view.zoneByPath.get(path)?.alive ?? 0,
        (url) => isChosen(state, PICK_KIND.SHIPPED, url),
        state.layers.shipped,
      );
    };

    /** Stands everything at rest, as a still frame shows it. */
    const rest = () => {
      warmed = false;
      smoke.clear();
      sparks.clear();
      trucks.clear();
      fleetSent = false;
      agents.rest();
      shipped.step(0, pinScale());
      planned.step(0);
      defects.step(0, pinScale());
      materials.time.value = 0;
      if (yard !== undefined) {
        turnYard(yard, 0);
        yard.train.position.x = trainX;
        yard.clouds.position.x = 0;
      }
      flock(0);
    };

    const flock = (time: number) => {
      birds.flock.forEach((bird, index) => {
        const a = time * bird.speed + bird.phase;
        const flap = time === 0 ? 0.3 : Math.sin(time * 9 + bird.flap) * 0.6;
        const y = bird.y + (time === 0 ? 0 : Math.sin(time + bird.flap) * 1.5);
        for (const [mesh, side] of [
          [birds.left, 1],
          [birds.right, -1],
        ] as const) {
          scratch.matrix.makeRotationFromEuler(scratch.euler.set(0, -a, side * flap, "YXZ"));
          scratch.matrix.scale(scratch.forward.set(side, 1, 1));
          scratch.matrix.setPosition(Math.cos(a) * bird.r + 20, y, Math.sin(a) * bird.r * 0.8);
          mesh.setMatrixAt(index, scratch.matrix);
        }
      });
      birds.left.instanceMatrix.needsUpdate = true;
      birds.right.instanceMatrix.needsUpdate = true;
    };

    const puff = (
      into: Particles,
      spec: ParticleSpec,
      source: ParticleSource = PARTICLE_SOURCE.YARD,
    ) => into.emit(spec, source);

    /** Puffs every chimney's smoke and every cooling tower's steam for `delta` seconds. */
    const breathe = (delta: number) => {
      if (yard === undefined) return;
      const j = () => motion() - 0.5;
      for (const vent of yard.emitters) {
        vent.owed += delta * vent.rate;
        while (vent.owed >= 1) {
          vent.owed -= 1;
          if (vent.puff === PUFF.SMOKE) {
            puff(smoke, {
              x: vent.x + j() * 0.4,
              y: vent.y,
              z: vent.z + j() * 0.4,
              vx: j() * 0.4,
              vy: 1.6 + motion() * 0.8,
              vz: j() * 0.4,
              color: col("#efece6"),
              size: vent.size,
              life: 6 + motion() * 2,
              grow: 3.2,
              alpha: 0.42,
              gravity: -0.02,
            });
          } else {
            puff(smoke, {
              x: vent.x + j() * vent.size,
              y: vent.y,
              z: vent.z + j() * vent.size,
              vx: j() * 0.6,
              vy: 2.6 + motion(),
              vz: j() * 0.6,
              color: col("#ffffff"),
              size: vent.size * 2.4,
              life: 5 + motion() * 2,
              grow: 2.2,
              alpha: 0.55,
              gravity: 0.05,
            });
          }
        }
      }
    };

    const emit = (delta: number, time: number, state: WorldState) => {
      const j = () => motion() - 0.5;
      breathe(delta);
      for (const strike of agents.strikes()) {
        if (strike.site === SITE.FEAT) {
          for (let k = 0; k < 2; k += 1) {
            if (motion() < 0.8) {
              puff(
                sparks,
                {
                  x: strike.x,
                  y: strike.y,
                  z: strike.z,
                  vx: j() * 3,
                  vy: motion() * 2.5,
                  vz: j() * 3,
                  color: motion() < 0.5 ? WELD : SPARK,
                  size: 0.13,
                  life: 0.25 + motion() * 0.4,
                  grow: 0,
                  alpha: 1,
                  gravity: 9.8,
                },
                PARTICLE_SOURCE.BUILDING,
              );
            }
          }
        } else if (strike.site !== SITE.FIX) {
          const c = ((time + strike.phase) * 1.5) % 1;
          if (c > 0.6 && c < 0.66) {
            for (let k = 0; k < 4; k += 1) {
              puff(
                sparks,
                {
                  x: strike.x,
                  y: strike.y,
                  z: strike.z,
                  vx: j() * 3.5,
                  vy: 1 + motion() * 2.5,
                  vz: j() * 3.5,
                  color: SPARK,
                  size: 0.1,
                  life: 0.3 + motion() * 0.3,
                  grow: 0,
                  alpha: 1,
                  gravity: 9.8,
                },
                PARTICLE_SOURCE.BUILDING,
              );
            }
          }
        }
      }
      if (state.layers.defects) {
        for (const smoulder of defects.smoulders()) {
          if (motion() > delta * smoulder.rate) continue;
          const burning = smoulder.fire;
          puff(
            smoke,
            {
              x: smoulder.x + j() * 1.2,
              y: smoulder.y,
              z: smoulder.z + j() * 1.2,
              vx: j() * 1.6,
              vy: (burning ? 2.2 : 1.4) + motion() * 1.6,
              vz: j() * 1.6,
              color: motion() < (burning ? 0.5 : 0.3) ? FIRE : burning ? SOOT : ASH,
              size: smoulder.size * (burning ? 2.4 : 2.0),
              life: (burning ? 5 : 3.5) + motion() * 2,
              grow: burning ? 3.4 : 2.8,
              alpha: burning ? 0.7 : 0.6,
              gravity: burning ? -0.12 : -0.05,
            },
            PARTICLE_SOURCE.DEFECTS,
          );
          if (motion() < 0.3)
            puff(
              sparks,
              {
                x: smoulder.x,
                y: smoulder.y,
                z: smoulder.z,
                vx: j() * 5,
                vy: 3 + motion() * 4,
                vz: j() * 5,
                color: EMBER,
                size: 0.16,
                life: 0.6,
                grow: 0,
                alpha: 1,
                gravity: 9.8,
              },
              PARTICLE_SOURCE.DEFECTS,
            );
        }
      }
    };

    /** Fireworks in the shipped signal's colour over `lot`'s building. */
    const celebrate = (lot: Lot) => {
      const building = yard?.buildings[lot.index];
      const y = 0.24 + (building?.top ?? 6) + 2;
      for (let k = 0; k < 70; k += 1) {
        const theta = motion() * Math.PI * 2;
        const phi = Math.acos(motion() * 2 - 1);
        const speed = 5 + motion() * 4;
        puff(
          sparks,
          {
            x: lot.bx,
            y: y + 4,
            z: lot.bz,
            vx: Math.sin(phi) * Math.cos(theta) * speed,
            vy: Math.cos(phi) * speed * 0.8 + 3,
            vz: Math.sin(phi) * Math.sin(theta) * speed,
            color: shippedSpark,
            size: 0.35,
            life: 1.1 + motion() * 0.6,
            grow: 0,
            alpha: 1,
            gravity: 4,
          },
          PARTICLE_SOURCE.SHIPPED,
        );
      }
    };
    const shippedSpark = shade(signal.SHIPPED, 4);

    /** Sends trucks out with the newest merges and back with defects, while motion runs. */
    const traffic = (delta: number, state: WorldState) => {
      if (yard === undefined) return;
      const layout = yard.layout;
      const recent = [...state.view.timeline].reverse().slice(0, 40);
      const routed = recent.flatMap((entry) => {
        const path = mainZoneOf(entry);
        const lot = path === undefined ? undefined : layout.lotByPath.get(path);
        return lot === undefined ? [] : [{ entry, lot }];
      });
      if (!fleetSent && state.layers.shipped && routed.length > 0) {
        fleetSent = true;
        for (let k = 0; k < Math.min(18, routed.length * 2); k += 1) {
          const pick = routed[(k * 7) % routed.length];
          if (pick !== undefined)
            trucks.send(
              HAUL.OUT,
              truckRoute(layout, pick.lot),
              { kind: PICK_KIND.SHIPPED, id: pick.entry.url },
              0.05 + motion() * 0.6,
            );
        }
      }
      truckDue -= delta;
      if (truckDue <= 0 && state.layers.shipped && routed.length > 0) {
        truckDue = 1.2 + motion() * 1.2;
        const pick = routed[Math.floor(motion() * routed.length)];
        if (
          pick !== undefined &&
          trucks.send(HAUL.OUT, truckRoute(layout, pick.lot), {
            kind: PICK_KIND.SHIPPED,
            id: pick.entry.url,
          }) !== undefined
        ) {
          celebrate(pick.lot);
        }
      }
      returnDue -= delta;
      const wrecked = state.snapshot.defects.filter((defect) =>
        layout.lotByPath.has(defect.zonePaths[0] ?? ""),
      );
      if (returnDue <= 0 && state.layers.defects && wrecked.length > 0) {
        returnDue = 4 + motion() * 3;
        const defect = wrecked[Math.floor(motion() * wrecked.length)];
        const lot =
          defect === undefined ? undefined : layout.lotByPath.get(defect.zonePaths[0] ?? "");
        if (defect !== undefined && lot !== undefined) {
          const route: Spot[] = [...truckRoute(layout, lot)].reverse();
          route.push({ x: lot.cx, z: lot.z1 + 0.5 });
          trucks.send(HAUL.BACK, route, { kind: PICK_KIND.DEFECT, id: defect.id });
        }
      }
      const arrived = trucks.drive(delta, (haul) =>
        haul === HAUL.OUT ? state.layers.shipped : state.layers.defects,
      );
      for (const truck of arrived) {
        if (truck.haul !== HAUL.BACK || !state.layers.defects) continue;
        for (let k = 0; k < 30; k += 1) {
          puff(
            sparks,
            {
              x: truck.x,
              y: 1.5,
              z: truck.z,
              vx: (motion() - 0.5) * 6,
              vy: 2 + motion() * 4,
              vz: (motion() - 0.5) * 6,
              color: EMBER,
              size: 0.25,
              life: 0.8,
              grow: 0,
              alpha: 1,
              gravity: 9.8,
            },
            PARTICLE_SOURCE.DEFECTS,
          );
        }
      }
    };

    return {
      update: (state) => {
        current = state;
        const view = state.view;
        const aprons = apronsOf(view, state);
        let grew = false;
        for (const zone of view.zones) {
          const items = aprons.byZone.get(zone.path) ?? [];
          const width = lotWidthOf(buildingPlanOf(zone.path, zone.layer, zone.footprint));
          const depth = packRows(width, items).depth;
          if (depth > (reserve.get(zone.path) ?? 0) + 1e-6) {
            reserve.set(zone.path, depth);
            grew = true;
          }
        }
        if (
          yard === undefined ||
          grew ||
          !sameGround(view.zones, view.edges, builtZones, builtEdges)
        ) {
          build(view.zones, view.edges);
        }
        const built = yard;
        if (built === undefined || belts === undefined) return;
        const layout = built.layout;

        const damaged = new Set(
          state.snapshot.defects.flatMap((defect) => defect.zonePaths.slice(0, 1)),
        );
        layout.lots.forEach((lot, index) => {
          const lit = lights[index];
          if (lit === undefined) return;
          lit.chosen = isChosen(state, PICK_KIND.ZONE, lot.zone.path);
          lit.distance = state.blast.get(lot.zone.path);
          lit.dimmed = state.blast.size > 0 && lit.distance === undefined && !lit.chosen;
          lit.damaged = damaged.has(lot.zone.path);
        });
        materials.dim.value = state.blast.size > 0 ? 1 : 0;
        const blastChanged =
          state.blast.size !== lastBlast.size ||
          [...state.blast].some(([path, distance]) => lastBlast.get(path) !== distance);
        lastBlast = state.blast;
        if (blastChanged) rippleStart = undefined;
        light(0, undefined);
        paintCrates(
          belts,
          (belt) => state.blast.has(belt.source.zone.path) && state.blast.has(belt.sink.zone.path),
          shade(signal.BLAST_RADIUS, 1),
        );

        place(state, layout, aprons);
        // Note that what a switched-off layer or a scrubbed-back instant no longer holds leaves at once: its trucks, its sparks, its smoke.
        const merged = new Set(view.timeline.map((entry) => entry.url));
        const broken = new Set(state.snapshot.defects.map((defect) => defect.id));
        trucks.retain((load) =>
          load.kind === PICK_KIND.SHIPPED ? merged.has(load.id) : broken.has(load.id),
        );
        if (!state.layers.building) sparks.clear(PARTICLE_SOURCE.BUILDING);
        if (!state.layers.shipped) sparks.clear(PARTICLE_SOURCE.SHIPPED);
        if (!state.layers.defects) {
          smoke.clear(PARTICLE_SOURCE.DEFECTS);
          sparks.clear(PARTICLE_SOURCE.DEFECTS);
        }

        const day = atmosphere.apply(state.dark);
        materials.glow.color.setScalar(day.glow);
        materials.lampHead.color.set("#ffd89a").multiplyScalar(day.lamp);
        const pool = materials.lampPool.uniforms.uOpacity;
        if (pool !== undefined) pool.value = day.pool;

        if (state.still) {
          rest();
          if (belts !== undefined) rideBelts(belts, 0, 0, () => false);
        } else if (wasStill) {
          rideBelts(belts, 0, 0, () => false);
          flock(0);
        }
        wasStill = state.still;
      },
      frame: (delta, elapsed) => {
        const state = current;
        if (state === undefined || yard === undefined) return;
        const time = elapsed;
        const scale = agentScale();
        const pins = pinScale();
        materials.time.value = time;
        agents.step(delta, time, scale);
        shipped.step(time, pins);
        planned.step(time);
        defects.step(time, pins);
        turnYard(yard, time);
        const span = yard.layout.span;
        trainX += delta * 16;
        if (trainX > span * 4) trainX = -span * 4;
        yard.train.position.x = trainX;
        cloudX += delta * 3;
        if (cloudX > span * 1.6) cloudX = -span * 1.6;
        yard.clouds.position.x = cloudX;
        flock(time);
        if (belts !== undefined) {
          const reach = materials.zoneReach;
          rideBelts(belts, delta, time, (belt) => (reach[belt.source.index]?.y ?? 0) > 0.5);
        }
        if (!warmed) {
          // Note that the smoke is warmed up before the first frame, as the mockup's was, so the stacks are already puffing.
          warmed = true;
          for (let step = 0; step < 120; step += 1) {
            breathe(1 / 20);
            smoke.step(1 / 20);
          }
        }
        if (rippleStart === undefined) rippleStart = time;
        light(time, rippleStart);
        emit(delta, time, state);
        traffic(delta, state);
        smoke.step(delta);
        sparks.step(delta);
        // Note that the sun's shadow follows where the camera looks, so shadows stay crisp there.
        camera.getWorldDirection(scratch.forward);
        const distance = viewDistance();
        const lookX = camera.position.x + scratch.forward.x * distance;
        const lookZ = camera.position.z + scratch.forward.z * distance;
        atmosphere.aim(lookX * 0.6, lookZ * 0.6, clamp(distance * 0.62, 50, span * 0.9));
      },
      dispose: () => {
        for (const take of unregister) take();
        unregister = [];
      },
    };
  },
};
