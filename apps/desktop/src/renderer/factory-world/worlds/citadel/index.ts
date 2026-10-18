import {
  FACTORY_WORLD_BOUNDS,
  type FactoryDefect,
  type FactoryPlanned,
} from "@luke/features/factory-world-wire";
import { AGENT_STATE, type AgentView, ZONE_LAYER, type ZoneView } from "@luke/ui/factory-world";
import {
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  Vector2,
} from "three";
import {
  PICK_KIND,
  type PickTarget,
  type WorldModule,
  type WorldPoint,
  type WorldState,
} from "../../world";
import { breachesOf, buildStonework, outerGatesOf } from "./architecture";
import { buildDamage, type Wound, woundsOf } from "./damage";
import { buildDecor } from "./decor";
import { buildKit } from "./kit";
import { layoutOf, sameZones, type ZoneSite } from "./layout";
import { buildMasons } from "./masons";
import { citadelMaterials } from "./materials";
import { placed } from "./math";
import { type Blueprint, blueprintClearings, blueprintsOf, buildBlueprints } from "./planned";
import { buildRoads } from "./roads";
import { buildSignals } from "./signals";
import { buildLandscape, type Clearing } from "./terrain";

/**
 * index.ts -- the Citadel: the repository as a walled town on a hill at golden hour, the core its keep, the domain its bailey, the surface its outer curtain and the town outside it, and the tooling its mills in the fields; its agents masons at their scaffolds, its merges torches and lanterns, its plans blueprints of light, its defects fires, and the blast radius beacons rising zone by zone.
 *
 * The world builds what it can once, in `create`: the land, the sky, and
 * every mesh at its bound. `update` then decides what the state changed.
 * The town itself is rebuilt only when the zones, the planned issues, or
 * the defects it is built round change; the worksites only when the agents
 * do; everything else, a hover, the blast, the scrubber's instant, only
 * re-colours and re-places instances. `frame` adds the idle life: masons at
 * work, flags and smoke in the wind, water, birds, and fireworks.
 */

/** The establishing shot: the town from the south-west, above the valley mist, looking up at the keep. */
const HOME = { position: { x: -18, y: 37, z: 152 }, target: { x: 0, y: 11, z: 0 } } as const;

/** What the town was last built from, kept to tell whether the next state needs it built again. */
interface Town {
  readonly zones: readonly ZoneView[];
  readonly planned: readonly FactoryPlanned[];
  readonly defects: readonly FactoryDefect[];
  readonly sites: readonly ZoneSite[];
  readonly byPath: ReadonlyMap<string, ZoneSite>;
  readonly gates: readonly number[];
  readonly blueprints: readonly Blueprint[];
  readonly clearings: readonly Clearing[];
}

function samePlanned(left: readonly FactoryPlanned[], right: readonly FactoryPlanned[]): boolean {
  return (
    left.length === right.length &&
    left.every((issue, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.identifier === issue.identifier &&
        other.priority === issue.priority &&
        other.zonePaths.join("\n") === issue.zonePaths.join("\n")
      );
    })
  );
}

function sameDefects(left: readonly FactoryDefect[], right: readonly FactoryDefect[]): boolean {
  return (
    left.length === right.length &&
    left.every((defect, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.id === defect.id &&
        other.events === defect.events &&
        other.zonePaths.join("\n") === defect.zonePaths.join("\n")
      );
    })
  );
}

function sameAgents(left: readonly AgentView[], right: readonly AgentView[]): boolean {
  return (
    left.length === right.length &&
    left.every((agent, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        other.id === agent.id &&
        other.state === agent.state &&
        other.kind === agent.kind &&
        other.primaryZone === agent.primaryZone &&
        other.buildSize === agent.buildSize &&
        other.touched.map((zone) => zone.path).join("\n") ===
          agent.touched.map((zone) => zone.path).join("\n")
      );
    })
  );
}

function sameBlast(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  return (
    left.size === right.size && [...left].every(([path, distance]) => right.get(path) === distance)
  );
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, palette, picking } = host;
    host.camera.setHome(HOME.position, HOME.target);
    host.camera.setReach(5, 340);

    const landscape = buildLandscape(scene);
    const materials = citadelMaterials();
    const ember = new MeshStandardMaterial({
      color: "#2a0d04",
      emissive: palette.signal.DEFECT,
      emissiveIntensity: 1.8,
    });
    const kit = buildKit(materials, ember);
    const decor = buildDecor();
    const roads = buildRoads(palette.signal.BLAST_RADIUS);
    // Note that point sizes are in pixels, so each glow learns the canvas's height from the renderer as it is drawn.
    const pixels = { value: 500 };
    const drawingBuffer = new Vector2();
    const masons = buildMasons(materials, palette, picking);
    const signals = buildSignals(palette, picking, landscape.fog.density, pixels);
    const blueprints = buildBlueprints(palette, picking);
    const damage = buildDamage(palette, picking, landscape.fog, pixels);
    // Note that a zone is picked by an unseen drum round its building, since its stonework is merged into the kit's shared instances.
    const zoneProxies = new InstancedMesh(
      new CylinderGeometry(1, 1, 1, 12),
      new MeshBasicMaterial({ visible: false }),
      FACTORY_WORLD_BOUNDS.MAX_ZONES,
    );
    zoneProxies.count = 0;
    scene.add(
      ...kit.meshes,
      ...decor.meshes,
      roads.mesh,
      ...masons.meshes,
      ...signals.meshes,
      ...blueprints.meshes,
      damage.group,
      zoneProxies,
    );
    scene.traverse((object) => {
      if (!(object instanceof Points)) return;
      object.onBeforeRender = (renderer) => {
        pixels.value = renderer.getDrawingBufferSize(drawingBuffer).y * 0.5;
      };
    });

    let town: Town | undefined;
    let agents: readonly AgentView[] = [];
    let building: boolean | undefined;
    let dark: boolean | undefined;
    let blast: ReadonlyMap<string, number> = new Map();
    let rippleFrom = 0;
    let elapsed = 0;
    let latest: WorldState | undefined;
    let zoneTargets: PickTarget[] = [];
    picking.addInstances(zoneProxies, (instanceId) => zoneTargets[instanceId]);
    const matrix = new Matrix4();

    const chosenIn = (state: WorldState) => (target: PickTarget) =>
      [state.selected, state.hovered].some(
        (one) => one?.kind === target.kind && one.id === target.id,
      );

    /** Builds the town round the state's zones, plans, and the defects shown. */
    const raiseTown = (state: WorldState): Town => {
      const sites = layoutOf(state.view.zones);
      const byPath = new Map(sites.map((site) => [site.zone.path, site]));
      const defects = state.layers.defects ? state.snapshot.defects : [];
      const plans = blueprintsOf(state.snapshot.planned, byPath, outerGatesOf(sites));
      const damaged = new Set(defects.flatMap((defect) => defect.zonePaths.slice(0, 1)));
      const found = buildStonework(
        kit,
        sites,
        breachesOf(defects, byPath),
        damaged,
        blueprintClearings(plans),
      );
      decor.hang(found);
      roads.lay(state.view.edges, byPath, found.gates);
      zoneTargets = sites.map((site) => ({ kind: PICK_KIND.ZONE, id: site.zone.path }));
      sites.forEach((site, index) => {
        const reach = site.heart
          ? 4.6
          : site.layer === ZONE_LAYER.SURFACE
            ? 4
            : site.size * 1.25 + 0.6;
        const height = Math.max(3, site.top - site.base);
        zoneProxies.setMatrixAt(
          index,
          placed(
            matrix,
            site.layer === ZONE_LAYER.SURFACE ? site.crown.x : site.x,
            site.base + height / 2,
            site.layer === ZONE_LAYER.SURFACE ? site.crown.z : site.z,
            0,
            reach,
            height,
            reach,
          ),
        );
      });
      zoneProxies.count = sites.length;
      zoneProxies.instanceMatrix.needsUpdate = true;
      return {
        zones: state.view.zones,
        planned: state.snapshot.planned,
        defects,
        sites,
        byPath,
        gates: found.gates,
        blueprints: plans,
        clearings: [...found.clearings, ...blueprintClearings(plans)],
      };
    };

    /** Where a chosen item stands on the floor, for the selection's ring; a zone has its beacon instead. */
    const spotOf = (target: PickTarget): (WorldPoint & { readonly size: number }) | undefined => {
      switch (target.kind) {
        case PICK_KIND.AGENT:
          return masons.spotOf(target.id);
        case PICK_KIND.SHIPPED:
          return signals.spotOf(target.id);
        case PICK_KIND.PLANNED:
          return blueprints.spotOf(target.id);
        case PICK_KIND.DEFECT:
          return damage.spotOf(target.id);
        case PICK_KIND.ZONE:
          return undefined;
      }
    };
    const spots = (state: WorldState): (WorldPoint & { readonly size: number })[] =>
      [state.selected, state.hovered].flatMap((target) => {
        const spot = target === undefined ? undefined : spotOf(target);
        return spot === undefined ? [] : [spot];
      });

    return {
      update: (state) => {
        latest = state;
        const { view, layers } = state;
        const chosen = chosenIn(state);
        const defects = layers.defects ? state.snapshot.defects : [];
        let rebuilt = false;
        if (
          town === undefined ||
          !sameZones(town.zones, view.zones) ||
          !samePlanned(town.planned, state.snapshot.planned) ||
          !sameDefects(town.defects, defects)
        ) {
          town = raiseTown(state);
          rebuilt = true;
        }
        const current = town;
        current.sites.forEach((site, index) => {
          site.zone = view.zones[index] ?? site.zone;
        });
        if (state.dark !== dark || rebuilt) {
          dark = state.dark;
          landscape.dress(state.dark);
          decor.light(state.dark);
        }
        if (rebuilt || layers.building !== building || !sameAgents(agents, view.agents)) {
          agents = view.agents;
          building = layers.building;
          masons.raise(
            view.agents.filter((agent) => layers.building || agent.state === AGENT_STATE.FAILED),
            current.byPath,
            current.gates,
          );
          landscape.clear([...current.clearings, ...masons.clearings()]);
        }
        masons.mark(chosen);
        const worked = new Set(
          view.agents.flatMap((agent) => (agent.primaryZone === null ? [] : [agent.primaryZone])),
        );
        blueprints.draw(current.blueprints, worked, layers.planned, chosen);
        const wounds: Wound[] = woundsOf(defects, current.byPath, current.gates);
        damage.burn(wounds, layers.defects, chosen);
        signals.ship(
          view.timeline,
          current.byPath,
          view.snapshotAt,
          layers.shipped,
          chosen,
          current.gates,
        );
        if (!sameBlast(blast, state.blast)) {
          blast = state.blast;
          rippleFrom = elapsed;
          roads.light(state.blast);
        }
        signals.beacon(
          current.sites,
          state.blast,
          chosen,
          state.still ? 1000 : elapsed - rippleFrom,
        );
        masons.pose(elapsed, state.still, chosen);
        signals.ring(spots(state));
      },
      frame: (_delta, now) => {
        elapsed = now;
        const state = latest;
        landscape.step(now);
        decor.step(now);
        roads.step(now);
        blueprints.step(now);
        damage.step(now);
        if (state === undefined || town === undefined) return;
        const chosen = chosenIn(state);
        masons.pose(now, false, chosen);
        signals.step(now, state.layers.shipped, now - rippleFrom);
        signals.ring(spots(state));
      },
      dispose: () => undefined,
    };
  },
};
