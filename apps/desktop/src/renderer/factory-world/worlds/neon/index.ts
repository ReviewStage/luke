import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { AGENT_STATE, agentDrawnUnder, type FactoryWorldView } from "@luke/ui/factory-world";
import { Color, Matrix4, Quaternion, Vector3 } from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldModule,
  type WorldState,
} from "../../world";
import { createWorkers, hologramOf, type WorkerPlacement, type WorkSite } from "./agents";
import { createCity, paintStreetLight, writeZoneRow } from "./city";
import { resetZoneState, sharedUniforms, ZONE_ROW, zoneState, zoneTexel } from "./glsl";
import { createHighways } from "./highways";
import {
  type Building,
  CITY,
  type CityLayout,
  cityLayoutOf,
  type District,
  HASH_SALT,
  samePlan,
  siteOf,
  unitHash,
} from "./layout";
import {
  createFlow,
  createGhosts,
  createShipped,
  createStorms,
  type DefectShard,
  FLOW_KIND,
  type FlowArc,
  type GhostTower,
  type ShippedBeam,
  STORM_BOUND,
  type Storm,
} from "./signals";

/**
 * index.ts -- the Neon Megacity: the repository as a rain-soaked cyberpunk city at night, its core the arcologies round the data core at the heart, its domains and surfaces the districts on the rings beyond, and its tooling out past the last ring road.
 *
 * Each zone is a district whose width follows its footprint and whose towers
 * rise with its files (`layout.ts`); its dependencies are light-trail
 * highways arcing to the districts it depends on (`highways.ts`). Luke's
 * agents are hard-hat hover-workers raising the holograms of their pull
 * requests on their districts' roofs, sized by `buildSize` (`agents.ts`).
 * What shipped rises from where it landed as a beam of light into the cloud
 * deck, and a district glows the shipped colour on its trim and windows as
 * it is alive with merges; planned work stands as translucent ghost towers
 * on empty lots, and defects gather as red glitch storms that crack the
 * towers beneath them (`signals.ts`). Selecting an agent dims the city and
 * sends its blast radius rippling out along the highways, a step at a time,
 * into every district that depends on what it touches.
 *
 * Nothing here is drawn as text, and every signal is drawn in the palette's
 * own colour. There is no post-processing pass and no second render of the
 * scene: the mockup's bloom is carried by emissive colour over one,
 * additive halos, and the fog, and its reflections by a painted light map
 * the wet street streaks (`city.ts`).
 */

/** How long the blast radius takes to step one dependency further out, in seconds. */
const BLAST_STEP_SECONDS = 0.6;

/** How long a merge takes to lose half its beam's brightness. */
const BEAM_HALF_LIFE_MS = 90 * 60 * 1000;

/** How far the world dims behind a selected agent's blast radius. */
const FOCUS_DIM = 0.85;

/** Whether the developer chose or hovers the item of `kind` and `id`. */
function chosen(state: WorldState, kind: PickKind, id: string): boolean {
  return [state.selected, state.hovered].some(
    (target) => target?.kind === kind && target.id === id,
  );
}

/** Whether two edge lists join the same zones, in the same order. */
function sameEdges(left: FactoryWorldView["edges"], right: FactoryWorldView["edges"]): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((edge, index) => edge.from === right[index]?.from && edge.to === right[index]?.to))
  );
}

/** The first of `paths` the city has a district for. */
function districtOn(layout: CityLayout, paths: readonly string[]): District | undefined {
  for (const path of paths) {
    const district = layout.districtByPath.get(path);
    if (district !== undefined) return district;
  }
  return undefined;
}

/** A spot on the rim past the last ring road, for what is placed on no zone: `index` of `of`, spread around. */
function rimSpot(layout: CityLayout, index: number, of: number, turn: number) {
  const angle = (index / Math.max(1, of)) * Math.PI * 2 + turn;
  const radius = layout.roads[2] + 18;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function workSiteOf(building: Building): WorkSite {
  return { x: building.x, z: building.z, top: building.h, w: building.w, d: building.d };
}

/** The shipped beams: each merged pull request on a roof in the first district it landed in, brighter the newer it is. */
function beamsOf(state: WorldState, layout: CityLayout): ShippedBeam[] {
  const { view } = state;
  return view.timeline
    .filter((merged) => merged.mergedAt <= view.snapshotAt)
    .slice(-FACTORY_WORLD_BOUNDS.MAX_SHIPPED)
    .map((merged) => {
      const district = districtOn(layout, merged.zonePaths);
      const lines = merged.additions + merged.deletions;
      const intensity =
        0.04 + 0.96 * 0.5 ** ((view.snapshotAt - merged.mergedAt) / BEAM_HALF_LIFE_MS);
      const width = 0.16 + Math.log10(lines + 10) * 0.15;
      const isChosen = chosen(state, PICK_KIND.SHIPPED, merged.url);
      const site =
        district === undefined
          ? undefined
          : siteOf(district, Math.floor(unitHash(merged.url) * 1000));
      if (district === undefined || site === undefined) {
        // Note that a merge placed on no zone rises from the plaza, round the data core.
        const angle = unitHash(merged.url) * Math.PI * 2;
        return {
          x: Math.cos(angle) * 11,
          z: Math.sin(angle) * 11,
          top: 0.2,
          width,
          intensity,
          chosen: isChosen,
          path: undefined,
        };
      }
      return {
        x: site.x + (unitHash(HASH_SALT.X, merged.url) - 0.5) * site.w * 0.5,
        z: site.z + (unitHash(HASH_SALT.Z, merged.url) - 0.5) * site.d * 0.5,
        top: site.h + 0.2,
        width,
        intensity,
        chosen: isChosen,
        path: district.zone.path,
      };
    });
}

/** The ghost towers: each planned issue on an empty lot of the first district it is placed on, or past the last ring road. */
function ghostsOf(state: WorldState, layout: CityLayout): GhostTower[] {
  const used = new Map<District, number>();
  const issues = state.snapshot.planned.slice(0, FACTORY_WORLD_BOUNDS.MAX_PLANNED);
  return issues.map((issue, index) => {
    const district = districtOn(layout, issue.zonePaths);
    const seed = unitHash(issue.identifier);
    const isChosen = chosen(state, PICK_KIND.PLANNED, issue.identifier);
    const w = 4.2 + 2.8 * unitHash(HASH_SALT.WIDTH, issue.identifier);
    if (district === undefined) {
      const { x, z } = rimSpot(layout, index, issues.length, 0.3);
      return { x, z, h: 22 * (0.95 + 0.5 * seed), w, seed, chosen: isChosen };
    }
    const taken = used.get(district) ?? 0;
    used.set(district, taken + 1);
    const lot = district.lots[taken];
    const angle = unitHash(district.zone.path) * Math.PI * 2 + taken * 0.8;
    const spot = lot ?? {
      x: district.x + Math.cos(angle) * (district.r + 5),
      z: district.z + Math.sin(angle) * (district.r + 5),
    };
    return {
      ...spot,
      h: Math.max(district.height, 22) * (0.95 + 0.5 * seed),
      w,
      seed,
      chosen: isChosen,
    };
  });
}

/** Each district's damage: its defects' events, the first zone a defect is placed on counting whole and the rest half. */
function damageOf(state: WorldState, layout: CityLayout): Map<District, number> {
  const events = new Map<District, number>();
  for (const defect of state.snapshot.defects) {
    defect.zonePaths.forEach((path, index) => {
      const district = layout.districtByPath.get(path);
      if (district === undefined) return;
      events.set(district, (events.get(district) ?? 0) + defect.events * (index === 0 ? 1 : 0.5));
    });
  }
  return events;
}

function stormsOf(damage: ReadonlyMap<District, number>): Storm[] {
  const worst = Math.max(0, ...damage.values());
  return [...damage]
    .filter(([, events]) => events > 0)
    .sort(([left, a], [right, b]) => b - a || (left.zone.path < right.zone.path ? -1 : 1))
    .slice(0, STORM_BOUND)
    .map(([district, events]) => ({
      x: district.x,
      z: district.z,
      r: district.r,
      height: district.height,
      strength: worst === 0 ? 0 : events / worst,
      seed: unitHash(district.zone.path),
    }));
}

/** The defect shards: one over the first district each defect is placed on, stacked where several share it, or past the last ring road. */
function shardsOf(state: WorldState, layout: CityLayout): DefectShard[] {
  const stacked = new Map<District, number>();
  const defects = state.snapshot.defects.slice(0, FACTORY_WORLD_BOUNDS.MAX_DEFECTS);
  return defects.map((defect, index) => {
    const district = districtOn(layout, defect.zonePaths);
    const isChosen = chosen(state, PICK_KIND.DEFECT, defect.id);
    if (district === undefined) {
      const { x, z } = rimSpot(layout, index, defects.length, 1.1);
      return { x, y: 12, z, chosen: isChosen };
    }
    const below = stacked.get(district) ?? 0;
    stacked.set(district, below + 1);
    const angle = unitHash(defect.id) * Math.PI * 2;
    return {
      x: district.x + Math.cos(angle) * district.r * 0.35,
      y: district.height * 1.25 + 8 + below * 4.5,
      z: district.z + Math.sin(angle) * district.r * 0.35,
      chosen: isChosen,
    };
  });
}

/** The workers to draw, in order, with what a press on each names. */
function workersOf(state: WorldState, layout: CityLayout) {
  const { view, layers } = state;
  const claims = new Map<District, number>();
  const stacks = new Map<Building, number>();
  const drawn = view.agents
    .filter((agent) => agentDrawnUnder(agent, layers))
    .slice(0, FACTORY_WORLD_BOUNDS.MAX_AGENTS);
  const placed = drawn.map((agent): WorkerPlacement => {
    const district =
      agent.primaryZone === null ? undefined : layout.districtByPath.get(agent.primaryZone);
    const seed = unitHash(agent.id);
    const claim = district === undefined ? 0 : (claims.get(district) ?? 0);
    if (district !== undefined) claims.set(district, claim + 1);
    const roof = district === undefined ? undefined : siteOf(district, claim);
    // Note that an agent building in no zone works a pad on the plaza, round the data core.
    const angle = seed * Math.PI * 2;
    const home =
      roof === undefined
        ? {
            x: Math.cos(angle) * (CITY.PLAZA - 3),
            z: Math.sin(angle) * (CITY.PLAZA - 3),
            top: 0.2,
            w: 3,
            d: 3,
          }
        : workSiteOf(roof);
    const stack = roof === undefined ? 0 : (stacks.get(roof) ?? 0);
    if (roof !== undefined && agent.state !== AGENT_STATE.IDLE) {
      stacks.set(roof, stack + hologramOf(agent.buildSize).h + 0.6);
    }
    const trips = agent.touched.slice(1, 4).flatMap((touched) => {
      const other = layout.districtByPath.get(touched.path);
      if (other === undefined || other === district) return [];
      const site = siteOf(
        other,
        Math.floor(unitHash(HASH_SALT.TRIP, agent.id, touched.path) * 1000),
      );
      return site === undefined ? [] : [workSiteOf(site)];
    });
    return {
      state: agent.state,
      buildSize: agent.buildSize,
      noticed: chosen(state, PICK_KIND.AGENT, agent.id),
      selected: state.selected?.kind === PICK_KIND.AGENT && state.selected.id === agent.id,
      home,
      stack,
      trips,
      path: district?.zone.path,
      seed,
    };
  });
  return {
    placed,
    agents: drawn,
    targets: drawn.map((agent) => ({ kind: PICK_KIND.AGENT, id: agent.id })),
  };
}

/** The factory line's arcs: defects to the planned work they share a zone with, planned work to the agents building there, and agents to what shipped beside them. */
function flowOf(
  state: WorldState,
  storms: readonly Storm[],
  ghosts: readonly GhostTower[],
  workerTops: readonly { top: Vector3; paths: readonly string[]; path: string | undefined }[],
  beams: readonly ShippedBeam[],
): FlowArc[] {
  const nearest = <T>(list: readonly T[], from: Vector3, at: (item: T) => Vector3, count: number) =>
    [...list]
      .sort((left, right) => at(left).distanceTo(from) - at(right).distanceTo(from))
      .slice(0, count);
  const ghostTops = ghosts.map((ghost, index) => ({
    top: new Vector3(ghost.x, ghost.h, ghost.z),
    paths: state.snapshot.planned[index]?.zonePaths ?? [],
  }));
  const arcs: FlowArc[] = [];
  storms.forEach((storm) => {
    const from = new Vector3(storm.x, storm.height * 1.2, storm.z);
    for (const ghost of nearest(ghostTops, from, (item) => item.top, 2)) {
      arcs.push({
        from,
        to: ghost.top,
        kind: FLOW_KIND.DEFECT,
        rate: 0.6 + Math.log1p(storm.strength * 50) * 0.25,
      });
    }
  });
  for (const ghost of ghostTops) {
    const sharing = workerTops.filter((worker) =>
      worker.paths.some((path) => ghost.paths.includes(path)),
    );
    const toward = sharing.length > 0 ? sharing : workerTops;
    for (const worker of nearest(
      toward,
      ghost.top,
      (item) => item.top,
      sharing.length > 0 ? 2 : 1,
    )) {
      arcs.push({ from: ghost.top, to: worker.top, kind: FLOW_KIND.PLAN, rate: 1 });
    }
  }
  const beamTops = beams.map((beam) => ({
    top: new Vector3(beam.x, beam.top + 0.5, beam.z),
    path: beam.path,
  }));
  for (const worker of workerTops) {
    const beside = beamTops.filter((beam) => beam.path !== undefined && beam.path === worker.path);
    const beam = nearest(beside, worker.top, (item) => item.top, 1)[0];
    if (beam !== undefined)
      arcs.push({ from: worker.top, to: beam.top, kind: FLOW_KIND.SHIP, rate: 1 });
  }
  return arcs;
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    const camera = host.camera.camera;
    host.camera.setHome({ x: CITY.HOME_X, y: 125, z: CITY.HOME_Z }, { x: 0, y: 30, z: 0 });
    host.camera.setReach(12, 900);
    const uniforms = sharedUniforms();
    const zones = zoneState();
    const { texture: zoneTexture, data: zoneData } = zones;
    const city = createCity(scene, uniforms, { value: zoneTexture }, palette);
    const highways = createHighways(scene, uniforms, palette.signal.BLAST_RADIUS);
    const shipped = createShipped(scene, uniforms, palette, FACTORY_WORLD_BOUNDS.MAX_SHIPPED);
    const ghosts = createGhosts(scene, uniforms, palette, FACTORY_WORLD_BOUNDS.MAX_PLANNED);
    const storms = createStorms(scene, uniforms, palette, FACTORY_WORLD_BOUNDS.MAX_DEFECTS);
    const flow = createFlow(scene, uniforms, palette);
    const workers = createWorkers(scene, uniforms, palette, FACTORY_WORLD_BOUNDS.MAX_AGENTS);

    let layout: CityLayout | undefined;
    let planFor: FactoryWorldView["zones"] = [];
    let edgesFor: FactoryWorldView["edges"] = [];
    let towerTargets: PickTarget[] = [];
    let plotTargets: PickTarget[] = [];
    let agentTargets: PickTarget[] = [];
    let hologramTargets: (PickTarget | undefined)[] = [];
    let shippedTargets: PickTarget[] = [];
    let plannedTargets: PickTarget[] = [];
    let defectTargets: PickTarget[] = [];
    picking.addInstances(city.towers, (instanceId) => towerTargets[instanceId]);
    picking.addInstances(city.plots, (instanceId) => plotTargets[instanceId]);
    const [torso, head, hologram] = workers.pickable;
    for (const mesh of [torso, head]) {
      if (mesh !== undefined) picking.addInstances(mesh, (instanceId) => agentTargets[instanceId]);
    }
    if (hologram !== undefined)
      picking.addInstances(hologram, (instanceId) => hologramTargets[instanceId]);
    picking.addInstances(shipped.beams, (instanceId) => shippedTargets[instanceId]);
    picking.addInstances(ghosts.towers, (instanceId) => plannedTargets[instanceId]);
    picking.addInstances(storms.shards, (instanceId) => defectTargets[instanceId]);

    let current: WorldState | undefined;
    let elapsed = 0;
    let focus = 0;
    let blastShown: WorldState["blast"] | undefined;
    let blastFrom = 0;
    const blastStart = new Map<string, number>();
    const signal = {
      blast: new Color(palette.signal.BLAST_RADIUS),
      selection: new Color(palette.signal.SELECTION),
      shipped: new Color(palette.signal.SHIPPED),
    };
    const tint = new Color();
    const look = new Vector3();
    const ringScale = new Vector3();
    const ringMatrix = new Matrix4();
    const level = new Quaternion();
    const makeRing = (at: Vector3, radius: number) =>
      ringMatrix.compose(at, level, ringScale.setScalar(radius));

    /** Colours each district's property line and ripple for `t`: selection, blast radius, a ship event's flash, or its own accent. */
    const paintPlots = (t: number, flashOf: (district: District) => number) => {
      if (layout === undefined || current === undefined) return;
      const state = current;
      let ripples = 0;
      layout.districts.forEach((district, index) => {
        const path = district.zone.path;
        const start = blastStart.get(path);
        const distance = state.blast.get(path);
        const arrived =
          start !== undefined && distance !== undefined && (state.still || t >= start);
        const flash = flashOf(district);
        if (chosen(state, PICK_KIND.ZONE, path)) {
          tint
            .copy(signal.selection)
            .multiplyScalar(state.still ? 1.8 : 1.6 + 0.4 * Math.sin(t * 4));
        } else if (arrived) {
          tint
            .copy(signal.blast)
            .multiplyScalar(2.2 * (distance === 0 ? 1 : Math.max(0.35, 0.75 - distance * 0.1)));
        } else if (flash > 0.05) {
          tint.copy(signal.shipped).multiplyScalar(0.5 + flash * 1.5);
        } else {
          tint.copy(district.accent).multiplyScalar(0.22 * (1 - focus * 0.7));
        }
        city.plots.setColorAt(index, tint);
        if (!arrived || start === undefined) return;
        const phase = state.still ? 0.35 : ((t - start) % 2.4) / 2.4;
        look.set(district.x, 0, district.z);
        city.ripples.setMatrixAt(ripples, makeRing(look, district.r * (1 + phase * 1.6)));
        tint.copy(signal.blast).multiplyScalar((1 - phase) * (distance === 0 ? 1 : 0.7) * 1.6);
        city.ripples.setColorAt(ripples, tint);
        ripples += 1;
      });
      city.ripples.count = ripples;
      city.ripples.instanceMatrix.needsUpdate = true;
      for (const mesh of [city.plots, city.ripples]) {
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    };

    /** Steps everything that moves to `t`: the city's life, the ship event loop, lightning, and the workers. */
    const animate = (t: number) => {
      if (current === undefined || layout === undefined) return;
      const state = current;
      uniforms.uTime.value = t;
      camera.getWorldDirection(look);
      city.frame(t, camera, look.multiplyScalar(120).add(camera.position));
      const playing = !state.still && state.live && state.layers.shipped;
      const event = shipped.frame(t, playing);
      const flashing =
        event === undefined ? undefined : layout.districtByPath.get(event.path ?? "");
      const flashLevel = event === undefined ? 0 : Math.max(0, 1 - event.since * 0.7);
      for (const district of layout.districts) {
        writeZoneRow(zoneData, district.slot, ZONE_ROW.FLASH, [
          district === flashing ? flashLevel : 0,
          0,
          0,
          0,
        ]);
      }
      const strike = state.layers.defects && !state.still ? storms.frame(t) : undefined;
      const struck = strike === undefined ? undefined : storms.stormAt(strike.index);
      city.flash.value = strike !== undefined && (struck?.strength ?? 0) > 0.6 ? 0.6 : 0;
      for (const district of layout.districts) {
        const lit =
          struck !== undefined && struck.x === district.x && struck.z === district.z
            ? (strike?.flash ?? 0)
            : 0;
        zoneData[zoneTexel(district.slot, ZONE_ROW.GLOW) + 3] = lit;
      }
      zoneTexture.needsUpdate = true;
      workers.pose(t, camera.position, event);
      paintPlots(t, (district) => (district === flashing ? flashLevel : 0));
    };

    const draw = (state: WorldState) => {
      const { view, layers, blast } = state;
      const fog = city.fogFor(state.dark, palette.ground.LIGHT);
      uniforms.uFogColor.value.copy(fog);
      uniforms.uDay.value = state.dark ? 0 : 1;
      uniforms.uFogDensity.value = state.dark ? 0.0016 : 0.0009;
      uniforms.uHaze.value = state.dark ? 0.55 : 0.22;
      scene.background = uniforms.uFogColor.value;
      const replanned = layout === undefined || !samePlan(planFor, view.zones);
      if (layout === undefined || replanned) {
        layout = cityLayoutOf(view.zones);
        planFor = view.zones;
        city.plan(layout);
        const pathOfSlot = view.zones.map((zone) => zone.path);
        towerTargets = layout.buildings.map((building) => ({
          kind: PICK_KIND.ZONE,
          id: pathOfSlot[building.slot] ?? "",
        }));
        plotTargets = layout.districts.map((district) => ({
          kind: PICK_KIND.ZONE,
          id: district.zone.path,
        }));
        layout.districts.forEach((district, index) => {
          look.set(district.x, 0, district.z);
          city.plots.setMatrixAt(index, makeRing(look, district.r));
        });
        city.plots.count = layout.districts.length;
        city.plots.instanceMatrix.needsUpdate = true;
      }
      const plan = layout;
      // Note that a dependency can change while every zone stays where it stood, so the highways are kept apart from the plan.
      if (replanned || !sameEdges(edgesFor, view.edges)) {
        highways.plan(plan, view.edges);
        edgesFor = view.edges;
      }
      if (blast !== blastShown) {
        blastShown = blast;
        blastFrom = elapsed;
      }
      // Note that the ripple leaves when the selection changes, and held still it has already arrived everywhere.
      const startOf = (distance: number) =>
        state.still ? -1000 : blastFrom + distance * BLAST_STEP_SECONDS;
      blastStart.clear();
      for (const [path, distance] of blast) blastStart.set(path, startOf(distance));
      highways.light(blast, startOf);
      const damage = damageOf(state, plan);
      const worst = Math.max(0, ...damage.values());
      resetZoneState(zones);
      const pools: { x: number; z: number; r: number; color: Color }[] = [];
      for (const district of plan.districts) {
        const path = district.zone.path;
        // Note that a zone a few merges landed in is already most of the way alive, so the glow is eased in.
        const alive = layers.shipped ? district.zone.alive ** 2 * 0.8 : 0;
        const glitch =
          layers.defects && worst > 0 ? Math.sqrt((damage.get(district) ?? 0) / worst) : 0;
        const distance = blast.get(path);
        const level =
          distance === undefined ? 0 : distance === 0 ? 1 : Math.max(0.35, 0.75 - distance * 0.1);
        const start = blastStart.get(path) ?? -1000;
        writeZoneRow(zoneData, district.slot, ZONE_ROW.GLOW, [alive, glitch, 1, 0]);
        writeZoneRow(zoneData, district.slot, ZONE_ROW.BLAST, [
          level,
          start,
          chosen(state, PICK_KIND.ZONE, path) ? 1 : 0,
          distance === 0 ? 1 : 0,
        ]);
        const pool = district.accent.clone().multiplyScalar(0.4);
        if (alive > 0) pool.lerp(signal.shipped.clone(), alive * 0.5);
        if (distance !== undefined) pool.lerp(signal.blast.clone().multiplyScalar(1.4), level);
        if (chosen(state, PICK_KIND.ZONE, path))
          pool.lerp(signal.selection.clone().multiplyScalar(1.4), 0.8);
        pools.push({ x: district.x, z: district.z, r: district.r, color: pool });
      }
      zoneTexture.needsUpdate = true;
      paintStreetLight(city.light, pools);
      city.signals.uShipOn.value = layers.shipped ? 1 : 0;
      city.signals.uGlitchOn.value = layers.defects ? 1 : 0;

      const beams = layers.shipped ? beamsOf(state, plan) : [];
      shipped.draw(beams);
      shippedTargets = layers.shipped
        ? view.timeline
            .filter((merged) => merged.mergedAt <= view.snapshotAt)
            .slice(-FACTORY_WORLD_BOUNDS.MAX_SHIPPED)
            .map((merged) => ({ kind: PICK_KIND.SHIPPED, id: merged.url }))
        : [];
      shipped.group.visible = layers.shipped;

      const towers = layers.planned ? ghostsOf(state, plan) : [];
      ghosts.draw(towers);
      plannedTargets = layers.planned
        ? state.snapshot.planned
            .slice(0, FACTORY_WORLD_BOUNDS.MAX_PLANNED)
            .map((issue) => ({ kind: PICK_KIND.PLANNED, id: issue.identifier }))
        : [];
      ghosts.group.visible = layers.planned;

      const stormsNow = layers.defects ? stormsOf(damage) : [];
      storms.draw(stormsNow, layers.defects ? shardsOf(state, plan) : []);
      defectTargets = layers.defects
        ? state.snapshot.defects
            .slice(0, FACTORY_WORLD_BOUNDS.MAX_DEFECTS)
            .map((defect) => ({ kind: PICK_KIND.DEFECT, id: defect.id }))
        : [];
      storms.group.visible = layers.defects;

      const { placed, agents: drawnAgents, targets } = workersOf(state, plan);
      workers.place(placed);
      agentTargets = targets;
      hologramTargets = placed.map((worker, index) =>
        worker.state === AGENT_STATE.IDLE ? undefined : targets[index],
      );
      const workerTops = placed.flatMap((worker, index) => {
        const top = workers.hologramTopOf(index);
        const agent = drawnAgents[index];
        if (top === undefined || agent === undefined || worker.state === AGENT_STATE.IDLE)
          return [];
        return [{ top, paths: agent.touched.map((touched) => touched.path), path: worker.path }];
      });
      flow.draw(flowOf(state, stormsNow, towers, workerTops, beams));
      flow.on.value.set(
        layers.defects && layers.planned ? 1 : 0,
        layers.planned && layers.building ? 1 : 0,
        layers.building && layers.shipped ? 1 : 0,
      );
      flow.alpha.value = state.live ? 1 : 0;
      if (state.still) {
        focus = blast.size > 0 ? 1 : 0;
        uniforms.uFocus.value = focus * FOCUS_DIM;
      }
    };

    return {
      update: (state) => {
        current = state;
        draw(state);
        animate(elapsed);
      },
      frame: (delta, t) => {
        elapsed = t;
        const goal = current !== undefined && current.blast.size > 0 ? 1 : 0;
        focus += (goal - focus) * (1 - Math.exp(-delta * 4));
        uniforms.uFocus.value = focus * FOCUS_DIM;
        animate(t);
      },
      dispose: () => {
        zoneTexture.dispose();
        city.light.texture.dispose();
        for (const texture of highways.textures) texture.dispose();
      },
    };
  },
};
