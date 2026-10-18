import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { AGENT_STATE, type FactoryWorldView, type ZoneView } from "@luke/ui/factory-world";
import {
  CircleGeometry,
  Color,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  type Texture,
  Vector3,
} from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldModule,
  type WorldPalette,
  type WorldState,
} from "../../world";
import { createBlast } from "./blast";
import { createCast } from "./cast";
import { createCities, windowMaterial } from "./cities";
import { createCore } from "./core";
import { createDefects } from "./defects";
import {
  createAir,
  createTerrain,
  PLANET_RADIUS,
  type PlanetLayout,
  type PlanetZone,
  planetLayoutOf,
  ZONE_PLACE,
} from "./globe";
import {
  BLAST_SETTLED,
  BLAST_STEP_SECONDS,
  flush,
  type SharedUniforms,
  ZONE_ROW,
  ZONE_TEXELS,
  zoneStateTexture,
} from "./kit";
import { createMoons } from "./moons";
import { createParticles } from "./particles";
import { createPlanned } from "./planned";
import { createShipped } from "./shipped";
import { createSpace } from "./space";

/**
 * index.ts -- the Planet: the repository as a small living planet cut open to its core, its agents at work on the crust, its merges in orbit.
 *
 * The core layer is the planet's molten core, shell inside shell, seen
 * through a cutaway facing the establishing shot (`core.ts`); the domain
 * zones are continents and the surface zones the cities on their coasts
 * (`globe.ts`, `cities.ts`); the tooling zones are moons (`moons.ts`).
 * Agents are astronauts and rovers raising scaffolds as tall as their pull
 * requests (`cast.ts`); merged work lights its city and joins a ring in
 * orbit (`shipped.ts`); planned issues are satellites beaming blueprints to
 * holograms on the ground (`planned.ts`); defects are storms, volcanoes,
 * and craters (`defects.ts`). The blast radius ripples over the crust and
 * raises an aurora over each zone it reaches, one dependency at a time
 * (`blast.ts`).
 *
 * Everything is placed from the view: the zones when they change, which
 * reshapes the crust, and the agents, merges, issues, and defects when
 * theirs do; a hover or a selection only rewrites the zone-state texture
 * and a few colours. `frame` adds the idle motion and nothing else, and a
 * still frame poses every agent so its state reads without it. The mockup
 * this was drawn from used bloom; the glow here is emissive colour, additive
 * light, and tone mapping alone, so the host renders no post-processing pass.
 */

/** The establishing shot: the cutaway's octant turned to the camera, the terminator on the left. */
const HOME = new Vector3(0.5, 0.48, 1).normalize().multiplyScalar(44);

/** How near the camera may come to what it looks at, and how far it may go: at home, just above the air, so a dive in ends at the crust's agents rather than inside it. */
const REACH = { NEAREST: 11.6, FARTHEST: 150 } as const;

/** How long a merge's arrival has the agents in its zones cheer, in seconds. */
const CHEER_SECONDS = 2.2;

function sameZones(left: FactoryWorldView | undefined, right: FactoryWorldView): boolean {
  if (left === undefined || left.zones.length !== right.zones.length) return false;
  return left.zones.every((zone, at) => {
    const other: ZoneView | undefined = right.zones[at];
    return (
      other !== undefined &&
      zone.path === other.path &&
      zone.layer === other.layer &&
      zone.footprint === other.footprint &&
      zone.x === other.x &&
      zone.y === other.y &&
      zone.dependsOn.length === other.dependsOn.length &&
      zone.dependsOn.every((path, step) => other.dependsOn[step] === path)
    );
  });
}

function chosenBy(state: WorldState): (kind: PickKind, id: string) => boolean {
  return (kind, id) =>
    [state.selected, state.hovered].some((target) => target?.kind === kind && target.id === id);
}

function sharedUniforms(signal: WorldPalette["signal"], texture: Texture): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(1, 0.3, 0).normalize() },
    uZones: { value: texture },
    uBlastT: { value: BLAST_SETTLED },
    uPixelRatio: { value: 1 },
    uProjection: { value: 800 },
    uDark: { value: 1 },
    uDefects: { value: 1 },
    uPlanned: { value: new Color(signal.PLANNED) },
    uBuilding: { value: new Color(signal.BUILDING) },
    uShipped: { value: new Color(signal.SHIPPED) },
    uDefect: { value: new Color(signal.DEFECT) },
    uBlast: { value: new Color(signal.BLAST_RADIUS) },
    uChosen: { value: new Color(signal.SELECTION) },
  };
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    host.camera.setHome(HOME, { x: 0, y: 0, z: 0 });
    host.camera.setReach(REACH.NEAREST, REACH.FARTHEST);

    const zones = zoneStateTexture();
    const zoneData = zones.data;
    const shared = sharedUniforms(palette.signal, zones.texture);
    const space = createSpace(shared, host.camera.camera, new Color(palette.ground.DARK));
    const terrain = createTerrain(shared);
    const core = createCore(shared, picking);
    const blast = createBlast(shared);
    const moons = createMoons(shared, picking, {
      blast: shared.uBlast.value,
      chosen: shared.uChosen.value,
    });
    const towers = windowMaterial(shared);
    const cities = createCities(towers);
    const particles = createParticles(shared);
    const cast = createCast(shared, picking, particles);
    let clock = 0;
    const shipped = createShipped(shared, picking, particles, towers, (zones) => {
      for (const zone of zones) cast.cheer(zone, clock + CHEER_SECONDS);
    });
    const planned = createPlanned(shared, picking, particles);
    const defects = createDefects(shared, picking, particles, {
      scorches: terrain.scorches,
      scorchDepths: terrain.scorchDepths,
      cracks: core.cracks,
    });
    // Note that a crust zone is picked through a disc on the chord under its land, drawn by no one and facing outward, so the far side of the planet is never picked through it.
    const crustProxies = new InstancedMesh(
      new CircleGeometry(1, 24).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ visible: false }),
      FACTORY_WORLD_BOUNDS.MAX_ZONES,
    );
    crustProxies.count = 0;
    let crustTargets: PickTarget[] = [];
    picking.addInstances(crustProxies, (instance) => crustTargets[instance]);
    scene.add(
      ...space.objects,
      terrain.mesh,
      ...createAir(shared),
      ...core.objects,
      ...blast.objects,
      ...moons.objects,
      ...cities.objects,
      ...cast.objects,
      particles.points,
      shipped.group,
      planned.group,
      defects.group,
      crustProxies,
    );
    const background = new Color();
    scene.background = background;
    const aimBefore = scene.onBeforeRender;
    scene.onBeforeRender = (renderer) => space.aim(renderer);

    let layout: PlanetLayout | undefined;
    let last: WorldState | undefined;
    let taken = new Map<PlanetZone, Vector3[]>();
    let blastFrom = 0;
    let routes = 0;
    let routesWanted = 0;
    const takenCopy = () => new Map([...taken].map(([zone, sites]) => [zone, [...sites]]));

    const placeCrustProxies = (placed: PlanetLayout) => {
      const placing = new Object3D();
      const up = new Vector3(0, 1, 0);
      placed.crust.forEach((zone, at) => {
        placing.position.copy(zone.centre).multiplyScalar(PLANET_RADIUS * Math.cos(zone.theta));
        placing.quaternion.setFromUnitVectors(up, zone.centre);
        placing.scale.setScalar(PLANET_RADIUS * Math.sin(zone.theta));
        placing.updateMatrix();
        crustProxies.setMatrixAt(at, placing.matrix);
      });
      crustProxies.count = placed.crust.length;
      crustTargets = placed.crust.map((zone) => ({ kind: PICK_KIND.ZONE, id: zone.view.path }));
      flush(crustProxies);
    };

    const writeCentres = (placed: PlanetLayout) => {
      zoneData.fill(0);
      for (const zone of placed.zones) {
        if (zone.place !== ZONE_PLACE.CRUST || zone.index >= ZONE_TEXELS) continue;
        const at = (ZONE_ROW.CENTRE * ZONE_TEXELS + zone.index) * 4;
        zoneData.set([zone.centre.x, zone.centre.y, zone.centre.z, zone.theta], at);
      }
    };

    const reshape = (view: FactoryWorldView) => {
      const placed = planetLayoutOf(view);
      layout = placed;
      terrain.rebuild(placed);
      core.rebuild(placed);
      blast.rebuild(placed);
      moons.rebuild(placed);
      taken = cities.rebuild(placed);
      placeCrustProxies(placed);
      writeCentres(placed);
      return placed;
    };

    const writeZoneStates = (state: WorldState, placed: PlanetLayout) => {
      const chosen = chosenBy(state);
      for (const zone of placed.zones) {
        if (zone.index >= ZONE_TEXELS) continue;
        const distance = state.blast.get(zone.view.path);
        const at = (ZONE_ROW.STATE * ZONE_TEXELS + zone.index) * 4;
        zoneData[at] = distance === undefined ? 0 : distance === 0 ? 1 : 0.6;
        zoneData[at + 1] = (distance ?? 0) * BLAST_STEP_SECONDS;
        zoneData[at + 2] = state.layers.shipped ? zone.view.alive : 0;
        zoneData[at + 3] = chosen(PICK_KIND.ZONE, zone.view.path) ? 1 : 0;
      }
      shared.uZones.value.needsUpdate = true;
      moons.light(
        (moon) =>
          state.blast.has(moon.view.path) ? (state.blast.get(moon.view.path) === 0 ? 1 : 0.6) : 0,
        (moon) => chosen(PICK_KIND.ZONE, moon.view.path),
      );
    };

    const drawnAgents = (state: WorldState) =>
      state.view.agents.filter(
        (agent) => state.layers.building || agent.state === AGENT_STATE.FAILED,
      );

    const recast = (state: WorldState, placed: PlanetLayout, reshaped: boolean) => {
      const before = last;
      const agentsMoved =
        reshaped ||
        before === undefined ||
        before.view.agents !== state.view.agents ||
        before.layers.building !== state.layers.building;
      if (agentsMoved) cast.cast(placed, drawnAgents(state), takenCopy());
      if (reshaped || before === undefined || before.view.timeline !== state.view.timeline) {
        shipped.show(placed, state.view.timeline, state.view.snapshotAt, takenCopy());
      }
      if (reshaped || before === undefined || before.snapshot.planned !== state.snapshot.planned) {
        planned.show(placed, state.snapshot.planned, takenCopy());
      }
      if (reshaped || before === undefined || before.snapshot.defects !== state.snapshot.defects) {
        defects.show(placed, state.snapshot.defects, takenCopy());
      }
    };

    const restyle = (state: WorldState) => {
      const chosen = chosenBy(state);
      cast.choose((agent) => chosen(PICK_KIND.AGENT, agent.id));
      shipped.choose((url) => chosen(PICK_KIND.SHIPPED, url));
      planned.choose((identifier) => chosen(PICK_KIND.PLANNED, identifier));
      defects.choose((id) => chosen(PICK_KIND.DEFECT, id));
      shipped.group.visible = state.layers.shipped;
      planned.group.visible = state.layers.planned;
      defects.group.visible = state.layers.defects;
      shared.uDefects.value = state.layers.defects ? 1 : 0;
      shared.uDark.value = state.dark ? 1 : 0;
      background.set(state.dark ? palette.ground.DARK : palette.ground.LIGHT);
      space.appear(state.dark);
      routesWanted = state.blast.size > 0 ? 1 : 0;
    };

    /** Places everything that moves, at `t`: once per update when still, and on every frame otherwise. */
    const pose = (state: WorldState, t: number, delta: number) => {
      cast.place(t, delta, state.still);
      moons.place(t);
      shipped.step(t, delta, !state.still && state.live && state.layers.shipped);
      planned.place(t, delta, !state.still && state.layers.planned);
      defects.step(t, delta, !state.still && state.layers.defects && state.layers.shipped);
    };

    return {
      update: (state) => {
        const reshaped = layout === undefined || !sameZones(last?.view, state.view);
        const placed = reshaped ? reshape(state.view) : layout;
        if (placed === undefined) return;
        const selectedBefore = last?.selected;
        if (
          state.selected?.kind !== selectedBefore?.kind ||
          state.selected?.id !== selectedBefore?.id
        )
          blastFrom = clock;
        writeZoneStates(state, placed);
        recast(state, placed, reshaped);
        restyle(state);
        last = state;
        if (state.still) {
          particles.clear();
          shipped.ground();
          routes = routesWanted;
          blast.show(routes);
          shared.uBlastT.value = BLAST_SETTLED;
        }
        pose(state, clock, 0);
      },
      frame: (delta, elapsed) => {
        const state = last;
        if (state === undefined) return;
        clock = elapsed;
        shared.uTime.value = elapsed;
        shared.uBlastT.value = elapsed - blastFrom;
        routes += (routesWanted - routes) * Math.min(1, delta * 4);
        blast.show(routes);
        pose(state, elapsed, delta);
        particles.step(delta);
      },
      // Note that the zone-state texture lives in shader uniforms and the crust's shadow material on no object in the scene, so neither is reached by the host's sweep.
      dispose: () => {
        scene.onBeforeRender = aimBefore;
        zones.texture.dispose();
        terrain.mesh.customDepthMaterial?.dispose();
      },
    };
  },
};
