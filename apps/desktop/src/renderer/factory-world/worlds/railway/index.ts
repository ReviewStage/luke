import { AGENT_STATE, type FactoryWorldView } from "@luke/ui/factory-world";
import {
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  type Object3D,
} from "three";
import {
  PICK_KIND,
  type PickKind,
  type PickTarget,
  type WorldLayers,
  type WorldModule,
  type WorldPalette,
  type WorldState,
} from "../../world";
import {
  animateWrecks,
  defectMeshes,
  placeWrecks,
  raiseWrecks,
  restWrecks,
  type Wreck,
} from "./defects";
import { clamp, lerp, smooth } from "./kit";
import { type Layout, layoutOf, sameBoard } from "./layout";
import { Lots } from "./lots";
import { markMeshes, paintMarks, ringChosen } from "./marks";
import { dataTexture, glowMaterial, townMaterials } from "./materials";
import { Glows, Particles } from "./particles";
import {
  type Blueprint,
  paintBlueprints,
  plannedMeshes,
  standBlueprints,
  swayBlueprints,
} from "./planned";
import {
  animate,
  clearMoving,
  type Dressing,
  dressBoard,
  groundOf,
  sceneryMaterials,
  sceneryMeshes,
  setClocks,
} from "./scenery";
import {
  animateShipped,
  Celebration,
  type House,
  raiseShipped,
  type Shipped,
  shippedMeshes,
  siteHouses,
} from "./shipped";
import { animateSites, raiseSites, type Site, siteMeshes, siteSizeOf } from "./sites";
import { paintTextures } from "./textures";
import { buildTown, CELL_ROW, type Town } from "./town";
import { buildTracks, type TrackMeshes, trackMaterials } from "./tracks";
import {
  CAR_KINDS,
  type Express,
  makeUpTrains,
  ownersOf,
  paintTrains,
  runExpress,
  runTrains,
  sendExpress,
  settleCounts,
  type Train,
  trainMeshes,
} from "./trains";

/**
 * index.ts -- the Model Railway: the repository as a tilt-shift model railway on a walnut table, each zone a round district of the town, the dependencies its mainlines, the agents' construction sites and trains, merged work as fresh gold-roofed houses under bunting, planned issues as blueprints on easels, and defects as derailments and fires.
 *
 * A district stands where the view model's layout puts its zone, ringed by
 * its own loop of track; the core stands at the heart and the surface out at
 * the edge (`layout.ts`). The town, its tracks, and the countryside are built
 * once per board, when the repository's zones change (`sameBoard`), never on
 * a scrub or a hover. The work on it (sites, trains, houses, blueprints,
 * wrecks) is laid out again when the reading or the layers change, by
 * rewriting instanced meshes allocated at the contract's bounds as the world
 * is created. The marks (selection, hover, the blast radius) are repainted on
 * every update.
 *
 * Where the mockup bloomed and blurred, this draws with emissive materials
 * and fog alone: a world has no pass of its own over the host's renderer.
 * The look of a lit window, a beacon, or a lamp comes from its own colour
 * and the night's lighting. `dark` is night: the windows and lamps come on.
 */

/** The lighting of day and night, and the room's colour at each, the light room from the host's light ground. */
const LIGHT = {
  KEY_DAY: new Color("#fff1dc"),
  KEY_DUSK: new Color("#ffae6a"),
  KEY_NIGHT: new Color("#7f9cff"),
  FLOOR_DAY: new Color("#cfc7b8"),
  FLOOR_NIGHT: new Color("#1c1714"),
} as const;

/** The scene units a board's establishing shot stands back by, for each unit of the board's longer side. */
const HOME_DISTANCE = 0.8;

/** One board as built: its plan, its town, and the meshes made for it, let go when the next replaces it. */
interface Board {
  readonly view: FactoryWorldView;
  readonly layout: Layout;
  readonly town: Town;
  readonly tracks: TrackMeshes;
  readonly dressing: Dressing;
  readonly group: Group;
}

/** Where a chosen thing is marked: its spot on the board and the ring round it. */
interface Spot {
  readonly x: number;
  readonly z: number;
  readonly r: number;
}

/** The work on a board as laid out for one reading and its layers. */
interface Works {
  readonly lots: Lots;
  readonly sites: readonly Site[];
  readonly trains: readonly Train[];
  readonly houses: readonly House[];
  readonly shipped: Shipped;
  readonly blueprints: readonly Blueprint[];
  readonly wrecks: readonly Wreck[];
  /** Each drawn item's spot, by its kind and then its id. */
  readonly spots: ReadonlyMap<PickKind, ReadonlyMap<string, Spot>>;
  /** The districts that shipped the most, for the fireworks. */
  readonly busiest: readonly { district: Layout["districts"][number]; merges: number }[];
}

/** What each instance of each registered mesh stands for, rewritten as the board and the work on it are laid out. */
interface Targets {
  readonly plots: Map<InstancedMesh, PickTarget[]>;
  agents: PickTarget[];
  locos: (PickTarget | undefined)[];
  readonly cars: Map<InstancedMesh, (PickTarget | undefined)[]>;
  houses: PickTarget[];
  readonly sheets: Map<InstancedMesh, PickTarget[]>;
  wrecks: PickTarget[];
}

function sameLayers(left: WorldLayers, right: WorldLayers): boolean {
  return (
    left.planned === right.planned &&
    left.building === right.building &&
    left.shipped === right.shipped &&
    left.defects === right.defects
  );
}

/** Whether the developer chose or hovers the item of `kind` and `id`. */
function chosenIn(state: WorldState, kind: PickKind): (id: string) => boolean {
  return (id) =>
    [state.selected, state.hovered].some((target) => target?.kind === kind && target.id === id);
}

/** Hides every instanced mesh under `root` with nothing to draw, so it costs no draw call; shows the rest. */
function hideEmpty(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof InstancedMesh) object.visible = object.count > 0;
  });
}

/** Lets go of every geometry under `root`; the materials are the world's, kept for the next board. */
function releaseGeometry(root: Object3D): void {
  root.traverse((object) => {
    if (object instanceof Mesh) object.geometry.dispose();
  });
}

/** Lights the board for `night`, from 0 (day) to 1, and dresses the room around it to match the window's appearance. */
function lightFor(
  night: number,
  lights: { sun: DirectionalLight; hemi: HemisphereLight; fill: DirectionalLight },
  layout: Layout | undefined,
  palette: WorldPalette,
  room: { fog: Fog; background: Color; floor: Color },
): void {
  const dusk = Math.sin(clamp(night, 0, 1) * Math.PI);
  lights.sun.color
    .copy(LIGHT.KEY_DAY)
    .lerp(LIGHT.KEY_DUSK, dusk * 0.9)
    .lerp(LIGHT.KEY_NIGHT, smooth((night - 0.5) * 2));
  lights.sun.intensity = lerp(2.7, 1.0, night);
  lights.hemi.intensity = lerp(1.05, 0.72, night);
  lights.hemi.color.set("#cfe0ff").lerp(new Color("#4a5c9a"), night);
  lights.fill.intensity = lerp(0.6, 0.14, night);
  const elevation = lerp(0.95, 0.5, night);
  const azimuth = -0.7 + night * 0.6;
  const cx = layout === undefined ? 0 : (layout.bounds.x0 + layout.bounds.x1) / 2;
  const cz = layout === undefined ? 0 : (layout.bounds.z0 + layout.bounds.z1) / 2;
  lights.sun.position.set(
    cx + Math.cos(azimuth) * Math.cos(elevation) * 320,
    Math.sin(elevation) * 320,
    cz + Math.sin(azimuth) * Math.cos(elevation) * 320 + 120,
  );
  lights.sun.target.position.set(cx, 0, cz);
  lights.fill.position.set(cx + 200, 160, cz - 220);
  room.background.set(night > 0.5 ? palette.ground.DARK : palette.ground.LIGHT);
  room.fog.color.copy(room.background);
  room.floor.copy(LIGHT.FLOOR_DAY).lerp(LIGHT.FLOOR_NIGHT, night);
}

export const world: WorldModule = {
  create: (host) => {
    const { scene, picking, palette } = host;
    const signal = palette.signal;
    const textures = paintTextures();
    host.camera.setHome({ x: 0, y: 90, z: 140 }, { x: 0, y: 0, z: 0 });
    host.camera.setReach(7, 520);

    const hemi = new HemisphereLight("#cfe0ff", "#6b5a40", 1.25);
    const sun = new DirectionalLight("#fff1dc", 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    const fill = new DirectionalLight("#bcd2ff", 0.6);
    scene.add(hemi, sun, sun.target, fill);
    const background = new Color(palette.ground.LIGHT);
    scene.background = background;
    const fog = new Fog(background.clone(), 320, 900);
    scene.fog = fog;
    scene.environment = textures.room;
    scene.environmentIntensity = 0.55;

    const townUniforms = { uCells: { value: dataTexture(CELL_ROW, 64) }, uLit: { value: 0.35 } };
    const town = townMaterials(townUniforms, CELL_ROW);
    const glows = dataTexture(64, 32);
    const glow = glowMaterial(glows, 64);
    const trackLook = trackMaterials(textures.gravel.clone());
    trackLook.ballast.map?.repeat.set(0.25, 0.25);
    const looks = sceneryMaterials(textures);
    const scenery = sceneryMeshes(textures);
    const sites = siteMeshes();
    const trains = trainMeshes();
    const shipped = shippedMeshes(signal);
    const planned = plannedMeshes(signal);
    const defects = defectMeshes(signal);
    const marks = markMeshes(signal);
    const smoke = new Particles(4000, false, 0.15);
    const sparks = new Particles(4000, true, 0);
    const celebration = new Celebration(shipped, signal);
    const lampGlows = new Glows(1400);
    const work = new Group();
    work.add(
      ...Object.values(sites),
      trains.locos,
      ...Object.values(trains.cars),
      ...Object.values(shipped),
      ...planned.sheets,
      planned.easels,
      ...Object.values(defects),
      marks.halos,
      marks.ripples,
      marks.selected,
      marks.hovered,
      smoke.points,
      sparks.points,
      lampGlows.points,
    );
    scene.add(
      work,
      scenery.crowns,
      scenery.pines,
      scenery.trunks,
      scenery.hay,
      scenery.lampPosts,
      scenery.lampBulbs,
      scenery.hands,
      scenery.beacons,
      scenery.rotors,
      scenery.hulls,
      scenery.cabins,
      ...Object.values(scenery.plots),
    );

    let board: Board | undefined;
    let works: Works | undefined;
    let last: WorldState | undefined;
    let time = 0;
    let night = 0;
    let blastFrom = 0;
    let arrivalIn = 1.5;
    const expresses: Express[] = [];
    const shownAt = new Map<string, number>();
    let emitted = new Map<number, number>();
    const targets: Targets = {
      plots: new Map(),
      agents: [],
      locos: [],
      cars: new Map(),
      houses: [],
      sheets: new Map(),
      wrecks: [],
    };

    for (const mesh of Object.values(scenery.plots))
      picking.addInstances(mesh, (id) => targets.plots.get(mesh)?.[id]);
    picking.addInstances(sites.proxies, (id) => targets.agents[id]);
    picking.addInstances(trains.locos, (id) => targets.locos[id]);
    for (const mesh of Object.values(trains.cars))
      picking.addInstances(mesh, (id) => targets.cars.get(mesh)?.[id]);
    picking.addInstances(shipped.walls, (id) => targets.houses[id]);
    picking.addInstances(shipped.roofs, (id) => targets.houses[id]);
    for (const sheet of planned.sheets)
      picking.addInstances(sheet, (id) => targets.sheets.get(sheet)?.[id]);
    picking.addInstances(defects.scorches, (id) => targets.wrecks[id]);
    picking.addInstances(defects.rings, (id) => targets.wrecks[id]);

    /** Builds the board for a view's zones, letting the last one go. */
    const buildBoard = (view: FactoryWorldView): Board | undefined => {
      if (board !== undefined) {
        scene.remove(board.group);
        releaseGeometry(board.group);
        board.town.buildings.dispose();
        board.town.windows.dispose();
      }
      clearMoving(scenery);
      if (view.zones.length === 0) return undefined;
      const layout = layoutOf(view);
      const built = buildTown(layout);
      const tracks = buildTracks(layout, built.sidings, trackLook, glow);
      const dressing = dressBoard(layout, built, looks, scenery);
      lampGlows.place(
        dressing.lamps.map((lamp) => ({ x: lamp.x, y: lamp.h + 0.08, z: lamp.z })),
        2.2,
      );
      hideEmpty(scene);
      const group = new Group();
      const buildings = new Mesh(built.buildings, town.buildings);
      buildings.castShadow = true;
      buildings.receiveShadow = true;
      buildings.customDepthMaterial = town.shadow;
      const windows = new Mesh(built.windows, town.windows);
      group.add(dressing.group, tracks.group, buildings, windows);
      scene.add(group);
      const { x0, x1, z0, z1 } = layout.bounds;
      const span = Math.max(x1 - x0, z1 - z0);
      const shadowReach = span * 0.62;
      Object.assign(sun.shadow.camera, {
        left: -shadowReach,
        right: shadowReach,
        top: shadowReach,
        bottom: -shadowReach,
        near: 10,
        far: 700,
      });
      sun.shadow.camera.updateProjectionMatrix();
      fog.near = span * 2.2;
      fog.far = span * 6;
      const target = { x: (x0 + x1) / 2 + 6, y: 0, z: (z0 + z1) / 2 + (z1 - z0) * 0.16 };
      const distance = span * HOME_DISTANCE;
      host.camera.setHome(
        { x: target.x, y: target.y + distance * 0.54, z: target.z + distance * 0.84 },
        target,
      );
      host.camera.setReach(7, Math.max(260, span * 2.6));
      targets.plots.clear();
      for (const district of layout.districts) {
        const mesh = scenery.plots[groundOf(district)];
        const list = targets.plots.get(mesh) ?? [];
        list.push({ kind: PICK_KIND.ZONE, id: district.path });
        targets.plots.set(mesh, list);
      }
      return { view, layout, town: built, tracks, dressing, group };
    };

    /** Lays out the work on the board for a reading and its layers. */
    const layOutWorks = (
      state: WorldState,
      built: Board,
      previous: Works | undefined,
      scrubbed: boolean,
    ): Works => {
      const { layout } = built;
      const { x0, x1, z0, z1 } = layout.bounds;
      const lots = new Lots(
        built.town,
        (x, z) => x > layout.shoreAt(z) + 2 && x < x1 - 3 && z > z0 + 3 && z < z1 - 3 && x > x0,
      );
      const claim = lots.claim.bind(lots);
      const shownAgents = state.view.agents.filter(
        (agent) =>
          agent.primaryZone !== null &&
          layout.byPath.has(agent.primaryZone) &&
          (state.layers.building || agent.state === AGENT_STATE.FAILED),
      );
      // Note that the largest builds claim their lots first, so a small one never pushes a large one off its plot.
      const ranked = [...shownAgents].sort(
        (a, b) => b.buildSize - a.buildSize || (a.id < b.id ? -1 : 1),
      );
      const plans = ranked.flatMap((agent) => {
        const district = layout.byPath.get(agent.primaryZone ?? "");
        if (district === undefined || agent.state === AGENT_STATE.IDLE) return [];
        const lot = claim(district, agent.id, siteSizeOf(agent.buildSize).width * 0.72);
        return [{ agent, x: lot.x, z: lot.z }];
      });
      const raised = raiseSites(plans, sites, signal);
      const made = makeUpTrains(shownAgents, layout);
      const wrecks = state.layers.defects ? placeWrecks(state.snapshot.defects, layout, claim) : [];
      const houses = state.layers.shipped
        ? siteHouses(state.view.timeline, layout, state.view.snapshotAt, claim)
        : [];
      const blueprints = state.layers.planned
        ? standBlueprints(state.snapshot.planned, layout, built.dressing.free)
        : [];
      raiseWrecks(wrecks, defects);
      const raisedShipped = raiseShipped(houses, shipped, signal, night);
      settleCounts(made, trains, expresses.length > 0);
      const owners = ownersOf(made);
      targets.agents = raised.map((site) => ({ kind: PICK_KIND.AGENT, id: site.agent.id }));
      targets.locos = owners.locos.map((id) =>
        id === undefined ? undefined : { kind: PICK_KIND.AGENT, id },
      );
      for (const kind of CAR_KINDS) {
        targets.cars.set(
          trains.cars[kind],
          owners.cars[kind].map((id) =>
            id === undefined ? undefined : { kind: PICK_KIND.AGENT, id },
          ),
        );
      }
      targets.houses = houses.map((house) => ({ kind: PICK_KIND.SHIPPED, id: house.entry.url }));
      targets.sheets.clear();
      planned.sheets.forEach((sheet, outline) => {
        const list: PickTarget[] = [];
        for (const print of blueprints)
          if (print.outline === outline)
            list[print.slot] = { kind: PICK_KIND.PLANNED, id: print.issue.identifier };
        targets.sheets.set(sheet, list);
      });
      targets.wrecks = wrecks.map((wreck) => ({ kind: PICK_KIND.DEFECT, id: wreck.defect.id }));
      // Note that a house first drawn while motion runs, after the board's first lay-out, pops up out of the ground.
      if (previous !== undefined && scrubbed && !state.still) {
        const known = new Set(previous.houses.map((house) => house.entry.url));
        const fresh = houses.filter((house) => !known.has(house.entry.url));
        for (const house of fresh) shownAt.set(house.entry.url, time);
        for (const house of fresh.slice(-6)) sendExpress(expresses, house.district);
      }
      writeCells(state, built, lots);
      return {
        lots,
        sites: raised,
        trains: made,
        houses,
        shipped: raisedShipped,
        blueprints,
        wrecks,
        spots: spotsOf(raised, made, houses, blueprints, wrecks),
        busiest: busiestOf(houses),
      };
    };

    /** Writes each town cell's state: whether it stands, and how many of its windows its zone's merges light. */
    const writeCells = (state: WorldState, built: Board, lots: Lots) => {
      const texture = townUniforms.uCells.value;
      const data = texture.image.data;
      if (!(data instanceof Uint8Array)) return;
      const level = (districtIndex: number) => {
        const path = built.layout.districts[districtIndex]?.path ?? "";
        const alive = state.layers.shipped ? (state.view.zoneByPath.get(path)?.alive ?? 0) : 0;
        return Math.round(Math.min(0.97, 0.1 + alive * 0.85) * 255);
      };
      for (const district of built.layout.districts) {
        data[district.index * 4] = 255;
        data[district.index * 4 + 1] = level(district.index);
      }
      for (const cell of built.town.cells) {
        if (cell.id * 4 + 1 >= data.length) break;
        data[cell.id * 4] = lots.cleared.has(cell.id) ? 0 : 255;
        data[cell.id * 4 + 1] = level(cell.district.index);
      }
      texture.needsUpdate = true;
    };

    /** Places everything that moves where it stands at `time`: the frame's pose, or a still frame's. */
    const pose = (state: WorldState, built: Board, laid: Works, moving: boolean, delta: number) => {
      animate(built.layout, built.dressing, scenery, looks, time, night);
      runTrains(laid.trains, trains, time, moving ? smoke : undefined, delta);
      animateSites(
        laid.sites,
        sites,
        signal,
        chosenIn(state, PICK_KIND.AGENT),
        time,
        moving ? sparks : undefined,
      );
      animateShipped(laid.shipped, shipped, shownAt, time);
      swayBlueprints(laid.blueprints, planned, time);
      if (moving) animateWrecks(laid.wrecks, defects, time, delta, night, smoke, sparks);
      else restWrecks(laid.wrecks, defects);
    };

    /** Repaints the signals: the chosen, the hovered, and the blast. */
    const paint = (state: WorldState, built: Board, laid: Works) => {
      paintTrains(laid.trains, trains, signal, chosenIn(state, PICK_KIND.AGENT));
      paintBlueprints(laid.blueprints, planned, signal, chosenIn(state, PICK_KIND.PLANNED), night);
      const zoneOf = (target: PickTarget | undefined) =>
        target?.kind === PICK_KIND.ZONE ? target.id : undefined;
      paintMarks(
        built.layout,
        {
          blast: state.blast,
          blastAge: state.still ? Number.POSITIVE_INFINITY : time - blastFrom,
          hoveredZone: zoneOf(state.hovered),
          selectedZone: zoneOf(state.selected),
          shipped: state.layers.shipped,
          time,
          aliveOf: (path) => state.view.zoneByPath.get(path)?.alive ?? 0,
        },
        marks,
        scenery,
        glows,
        built.tracks.lamps,
        signal,
      );
      built.tracks.glow.visible = state.blast.size > 0;
      const spotOf = (target: PickTarget | undefined) =>
        target === undefined ? undefined : laid.spots.get(target.kind)?.get(target.id);
      const hovered =
        state.hovered !== undefined && state.hovered.id !== state.selected?.id
          ? spotOf(state.hovered)
          : undefined;
      ringChosen(marks, spotOf(state.selected), hovered, state.still ? 0 : time);
    };

    /** Lights the scene for the window's appearance, at once. */
    const lightUp = (state: WorldState, layout: Layout | undefined) => {
      night = state.dark ? 1 : 0;
      const floor = looks.floor.color;
      lightFor(night, { sun, hemi, fill }, layout, palette, { fog, background, floor });
      scene.environmentIntensity = lerp(0.5, 0.2, night);
      townUniforms.uLit.value = lerp(0.35, 3.2, night);
      scenery.lampBulbs.material.color.setRGB(1, 0.86, 0.6).multiplyScalar(lerp(0.9, 4, night));
      looks.beam.opacity = 0.07 * night;
      looks.lighthouse.color.setRGB(0.6 + 3.4 * night, 0.5 + 2.7 * night, 0.3 + 1.3 * night);
      shipped.bulbs.material.color.setRGB(1, 0.85, 0.55).multiplyScalar(lerp(0.8, 4, night));
      lampGlows.setStrength(night);
    };

    return {
      update: (state) => {
        const boardChanged =
          board === undefined ? state.view.zones.length > 0 : !sameBoard(board.view, state.view);
        if (boardChanged) {
          board = buildBoard(state.view);
          works = undefined;
        }
        if (last === undefined || last.dark !== state.dark || boardChanged)
          lightUp(state, board?.layout);
        if (board === undefined) {
          last = state;
          return;
        }
        if (
          works === undefined ||
          last === undefined ||
          last.view !== state.view ||
          last.snapshot !== state.snapshot ||
          !sameLayers(last.layers, state.layers)
        ) {
          const scrubbed =
            last !== undefined && last.view !== state.view && sameLayers(last.layers, state.layers);
          works = layOutWorks(state, board, works, scrubbed);
          setClocks(board.dressing, scenery, state.view.snapshotAt);
        }
        if (last === undefined || last.blast !== state.blast) blastFrom = time;
        if (state.still) {
          smoke.clear();
          sparks.clear();
          celebration.clear();
          expresses.length = 0;
          settleCounts(works.trains, trains, false);
        }
        pose(state, board, works, false, 0);
        paint(state, board, works);
        hideEmpty(work);
        last = state;
      },
      frame: (delta, elapsed) => {
        time = elapsed;
        const state = last;
        if (state === undefined || board === undefined || works === undefined) return;
        pose(state, board, works, true, delta);
        const arrivals = runExpress(expresses, trains, delta);
        settleCounts(works.trains, trains, expresses.length > 0);
        for (const arrival of arrivals) celebration.burst(arrival, 70, smoke, sparks);
        if (state.live && state.layers.shipped && works.houses.length > 0) {
          arrivalIn -= delta;
          if (arrivalIn <= 0) {
            arrivalIn = 2.6 + Math.random() * 2;
            const newest = Math.random() ** 2.2;
            const house = works.houses[Math.floor((1 - newest) * (works.houses.length - 1))];
            if (house !== undefined) sendExpress(expresses, house.district);
          }
          celebration.fireworks(works.busiest, night, delta, sparks);
        }
        emitted = emit(board.town, emitted, delta, night, smoke);
        celebration.step(delta);
        smoke.step(delta);
        sparks.step(delta);
        paint(state, board, works);
        hideEmpty(work);
      },
      dispose: () => {
        // Note that the host lets go of everything in the scene; the textures held only by materials' clones are among them.
        for (const texture of Object.values(textures)) texture.dispose();
      },
    };
  },
};

/** Puffs smoke from the town's chimneys and steam from its cooling towers, each at its own rate. */
function emit(
  town: Town,
  owed: Map<number, number>,
  delta: number,
  night: number,
  smoke: Particles,
): Map<number, number> {
  const lit = lerp(1, 0.35, night);
  town.emitters.forEach((emitter, index) => {
    let due = (owed.get(index) ?? Math.random()) + (emitter.kind === "steam" ? 4 : 2.4) * delta;
    for (; due > 1; due -= 1) {
      const s = emitter.scale;
      if (emitter.kind === "smoke") {
        smoke.emit(
          emitter.x,
          emitter.y,
          emitter.z,
          0.25 + (Math.random() - 0.5) * 0.2,
          0.8 + Math.random() * 0.3,
          0.1 + (Math.random() - 0.5) * 0.2,
          5,
          0.5 * s,
          3.2 * s,
          0.55 * lit,
          0.55 * lit,
          0.57 * lit,
          0.5,
          0.3,
          -0.05,
        );
      } else {
        smoke.emit(
          emitter.x + (Math.random() - 0.5) * 0.6,
          emitter.y,
          emitter.z + (Math.random() - 0.5) * 0.6,
          0.3,
          1 + Math.random() * 0.4,
          0.1,
          4.5,
          0.9 * s,
          3.4 * s,
          0.95 * lit,
          0.95 * lit,
          0.97 * lit,
          0.55,
          0.35,
          -0.05,
        );
      }
    }
    owed.set(index, due);
  });
  return owed;
}

/** Each drawn item's spot and ring, by its kind then its id. */
function spotsOf(
  sites: readonly Site[],
  trains: readonly Train[],
  houses: readonly House[],
  blueprints: readonly Blueprint[],
  wrecks: readonly Wreck[],
): Map<PickKind, Map<string, Spot>> {
  const spots = new Map<PickKind, Map<string, Spot>>(
    Object.values(PICK_KIND).map((kind) => [kind, new Map()]),
  );
  for (const site of sites)
    spots
      .get(PICK_KIND.AGENT)
      ?.set(site.agent.id, { x: site.x, z: site.z, r: site.width * 0.75 + 0.9 });
  for (const train of trains) {
    if (spots.get(PICK_KIND.AGENT)?.has(train.agent.id)) continue;
    spots
      .get(PICK_KIND.AGENT)
      ?.set(train.agent.id, { x: train.route.xs[0] ?? 0, z: train.route.zs[0] ?? 0, r: 1.4 });
  }
  for (const house of houses)
    spots.get(PICK_KIND.SHIPPED)?.set(house.entry.url, { x: house.x, z: house.z, r: 1.1 });
  for (const print of blueprints)
    spots
      .get(PICK_KIND.PLANNED)
      ?.set(print.issue.identifier, { x: print.x, z: print.z, r: print.width * 0.6 + 0.4 });
  for (const wreck of wrecks)
    spots
      .get(PICK_KIND.DEFECT)
      ?.set(wreck.defect.id, { x: wreck.x, z: wreck.z, r: 1.8 + wreck.severity * 0.5 });
  return spots;
}

/** The five districts that shipped the most, and how many. */
function busiestOf(houses: readonly House[]): { district: House["district"]; merges: number }[] {
  const merges = new Map<House["district"], number>();
  for (const house of houses) merges.set(house.district, (merges.get(house.district) ?? 0) + 1);
  return [...merges]
    .map(([district, count]) => ({ district, merges: count }))
    .sort((a, b) => b.merges - a.merges)
    .slice(0, 5);
}
