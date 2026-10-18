import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  PICK_KIND,
  type PickTarget,
  type WorldPalette,
  type WorldPicking,
  type WorldPoint,
} from "@luke/panel/factory-world/world";
import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentKind,
  type AgentState,
  type AgentView,
  ZONE_LAYER,
} from "@luke/ui/factory-world";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import type { ZoneSite } from "./layout";
import type { CitadelMaterials } from "./materials";
import { easeInOut, facingOut, hash2, placed, polar, seeded, seedOf, TAU } from "./math";
import { along, type Route, routeOf } from "./roads";
import { groundAt, HILL, WIND } from "./terrain";

/**
 * masons.ts -- the coding agents as masons at their worksites: a scaffold as tall as the pull request is large, the work rising inside it by its kind, a crane over the largest, a flag in the building signal, and the mason, hammering, climbing, or hauling stone to the next zone it touches.
 *
 * Each agent works beside its primary zone, the zone's agents in a fixed
 * order around it, so the same agent stands in the same place each time;
 * one with no zone camps outside the main gate. Its state reads in a still
 * frame as well as a moving one: at work it swings its hammer, waiting it
 * stands at the foot with an arm raised to the developer, stuck it sits
 * slumped under a half-masted flag, failed its scaffold leans and its flag
 * is the defect's colour, and idle it stands by finished stone with no
 * scaffold at all.
 *
 * Every part is an instanced mesh allocated at `MAX_AGENTS` (beams at
 * `BEAMS_PER_AGENT` each), filled in draw order: the agents the layers
 * show, so an agent the building layer hides is simply not drawn and not
 * pickable.
 */

const MAX_AGENTS = FACTORY_WORLD_BOUNDS.MAX_AGENTS;
const BEAMS_PER_AGENT = 96;
const BLOCKS_PER_MASON = 8;

/** A mason's height, of the unit its parts are measured in. */
const MASON_SCALE = 1.22;

/** The scaffolding's woods. */
const TIMBER = {
  POST: "#5c3f27",
  LEDGER: "#8a6440",
  PLANK: "#b08552",
  RUNG: "#7c5836",
} as const;

/** The tunic each kind of work is dressed in, and its hat. */
const DRESS = {
  [AGENT_KIND.FEAT]: { tunic: "#c9a25a", hat: "#3b2a1e" },
  [AGENT_KIND.FIX]: { tunic: "#8796ab", hat: "#c9ced8" },
  [AGENT_KIND.REFACTOR]: { tunic: "#94789e", hat: "#4a2f5e" },
  [AGENT_KIND.PERF]: { tunic: "#94789e", hat: "#4a2f5e" },
} as const;
const PLAIN_DRESS = { tunic: "#8a9a7a", hat: "#3b2a1e" } as const;

/** What a mason wears. */
interface Dress {
  readonly tunic: string;
  readonly hat: string;
}

function dressOf(kind: AgentKind): Dress {
  switch (kind) {
    case AGENT_KIND.FEAT:
    case AGENT_KIND.FIX:
    case AGENT_KIND.REFACTOR:
    case AGENT_KIND.PERF:
      return DRESS[kind];
    default:
      return PLAIN_DRESS;
  }
}

/** What the work rising in a scaffold looks like, by its kind: a new tower, a patched wall, a wall rebuilt, or plain stone. */
const WORK = { NEW: "new", PATCH: "patch", REBUILD: "rebuild", PLAIN: "plain" } as const;
type Work = (typeof WORK)[keyof typeof WORK];

function workOf(kind: AgentKind): Work {
  if (kind === AGENT_KIND.FEAT) return WORK.NEW;
  if (kind === AGENT_KIND.FIX || kind === AGENT_KIND.REVERT) return WORK.PATCH;
  if (kind === AGENT_KIND.REFACTOR || kind === AGENT_KIND.PERF) return WORK.REBUILD;
  return WORK.PLAIN;
}

/** How a mason is posed: what it does, where, facing which way, and how far into its motion. */
const POSE = {
  HAMMER: "hammer",
  WALK: "walk",
  CARRY: "carry",
  KNEEL: "kneel",
  CLIMB: "climb",
  WAVE: "wave",
  SIT: "sit",
  STAND: "stand",
} as const;
type PoseMode = (typeof POSE)[keyof typeof POSE];

interface Pose {
  mode: PoseMode;
  x: number;
  y: number;
  z: number;
  yaw: number;
  phase: number;
}

/** One agent's worksite as drawn: where, how large, and how its mason moves. */
interface Worksite {
  readonly agent: AgentView;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly ground: number;
  readonly height: number;
  readonly width: number;
  readonly levels: number;
  readonly levelHeight: number;
  readonly crane: boolean;
  readonly scaffolded: boolean;
  readonly frame: Matrix4;
  readonly work: { readonly x: number; readonly z: number };
  readonly offset: number;
  readonly haul: { readonly route: Route; readonly travel: number } | undefined;
  readonly cycle: number;
  readonly climb: number;
}

/** Where a worksite stands and which way it faces: its front outward. */
interface Spot {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** The side of the worksite's own frame a point stands at, as floor x and z. */
function local(
  site: { x: number; z: number; yaw: number },
  lx: number,
  lz: number,
): readonly [number, number] {
  const cos = Math.cos(site.yaw);
  const sin = Math.sin(site.yaw);
  return [site.x + lx * cos + lz * sin, site.z - lx * sin + lz * cos];
}

/** Where the `k`th of `n` agents at a zone works: in the yard outside its stretch of curtain, round its tower or hall, or round its field. */
function worksiteSpot(site: ZoneSite, k: number, n: number, gates: readonly number[]): Spot {
  let angle: number;
  let reach: number;
  let x = site.x;
  let z = site.z;
  if (site.layer === ZONE_LAYER.SURFACE) {
    const span = site.to - site.from;
    angle = site.from + (n <= 1 ? 0.5 : 0.08 + 0.84 * (k / (n - 1))) * span;
    if (gates.some((gate) => Math.abs(gate - angle) * HILL.OUTER_RADIUS < 3.6))
      angle += 4.2 / HILL.OUTER_RADIUS;
    reach = HILL.OUTER_RADIUS + 2.8 + (k % 2) * 3.6;
    [x, z] = polar(reach, angle);
    return { x, z, yaw: facingOut(angle) };
  }
  if (site.layer === ZONE_LAYER.TOOLING) {
    angle = site.angle + Math.PI + (k - (n - 1) / 2) * 0.7;
    reach = site.size + 2.6;
  } else if (site.layer === ZONE_LAYER.CORE) {
    angle = (site.heart ? Math.PI / 2 + 0.62 : site.angle) + (k - (n - 1) / 2) * 0.95;
    reach = site.heart ? 5.6 : site.size + 1.9;
  } else {
    angle = site.angle + (k - (n - 1) / 2) * Math.min(0.95, TAU / Math.max(n, 1));
    reach = site.size * 1.32 + 1.8;
  }
  const [dx, dz] = polar(reach, angle);
  return { x: x + dx, z: z + dz, yaw: facingOut(angle) };
}

/** Where the `k`th of `n` agents with no zone camps: in the yard outside the main gate. */
function campSpot(k: number, n: number, gates: readonly number[]): Spot {
  const gate = gates[0] ?? Math.PI / 2;
  const angle = gate + ((k - (n - 1) / 2) * 4.4) / 52;
  const [x, z] = polar(51.2 + (k % 2) * 3.4, angle);
  return { x, z, yaw: facingOut(angle) };
}

/** Where a hauler sets down its stone at the second zone its work touches. */
function visitOf(site: ZoneSite, seed: number): readonly [number, number] {
  const random = seeded(seed);
  if (site.layer === ZONE_LAYER.SURFACE)
    return polar(
      HILL.OUTER_RADIUS - 2.4 - random() * 1.2,
      site.from + (0.2 + random() * 0.6) * (site.to - site.from),
    );
  if (site.layer === ZONE_LAYER.CORE)
    return polar(11.8 + random() * 1.5, site.angle + (random() - 0.5) * 0.5);
  const [dx, dz] = polar(site.size * 1.3 + 1.2, site.angle + (random() - 0.5) * 0.8);
  return [site.x + dx, site.z + dz];
}

/** The worksites of the agents shown, in draw order. */
function worksitesOf(
  agents: readonly AgentView[],
  sites: ReadonlyMap<string, ZoneSite>,
  gates: readonly number[],
): Worksite[] {
  const byZone = new Map<ZoneSite | undefined, AgentView[]>();
  for (const agent of agents) {
    const site = agent.primaryZone === null ? undefined : sites.get(agent.primaryZone);
    byZone.set(site, [...(byZone.get(site) ?? []), agent]);
  }
  const spots = new Map<AgentView, Spot>();
  for (const [site, group] of byZone) {
    const ordered = [...group].sort(
      (left, right) => right.buildSize - left.buildSize || (left.id < right.id ? -1 : 1),
    );
    ordered.forEach((agent, k) => {
      spots.set(
        agent,
        site === undefined
          ? campSpot(k, ordered.length, gates)
          : worksiteSpot(site, k, ordered.length, gates),
      );
    });
  }
  return agents.map((agent) => {
    const spot = spots.get(agent) ?? campSpot(0, 1, gates);
    const height = 2.6 + agent.buildSize * 8.6;
    const width = 2.15 + agent.buildSize * 0.6;
    const levels = Math.max(1, Math.round(height / 1.75));
    const random = seeded(seedOf(agent.id));
    const offset = random() * 100;
    const scaffolded = agent.state !== AGENT_STATE.IDLE;
    const lean = agent.state === AGENT_STATE.FAILED ? 0.2 : 0;
    const ground = groundAt(spot.x, spot.z);
    const frame = placed(new Matrix4(), spot.x, ground, spot.z, spot.yaw, 1, 1, 1, 0, lean);
    const [workX, workZ] = local(spot, -0.45, width / 2 + 0.95);
    const second = agent.touched.find((zone) => zone.path !== agent.primaryZone);
    const visitSite = second === undefined ? undefined : sites.get(second.path);
    const hauls = agent.state === AGENT_STATE.WORKING && visitSite !== undefined && random() < 0.72;
    const climb = (levels * (height / levels)) / 0.85;
    let haul: Worksite["haul"];
    if (hauls && visitSite !== undefined) {
      const [vx, vz] = visitOf(visitSite, seedOf(agent.id) ^ 0x2c1b3c6d);
      const route = routeOf(workX, workZ, vx, vz, gates);
      haul = { route, travel: route.length / 2.5 };
    }
    return {
      agent,
      ...spot,
      ground,
      height,
      width,
      levels,
      levelHeight: height / levels,
      crane:
        scaffolded &&
        workOf(agent.kind) !== WORK.PATCH &&
        workOf(agent.kind) !== WORK.PLAIN &&
        agent.buildSize > 0.65,
      scaffolded,
      frame,
      work: { x: workX, z: workZ },
      offset,
      haul,
      cycle: haul === undefined ? 17 + climb * 2 : 16 + haul.travel * 2,
      climb,
    };
  });
}

/** Where a mason stands and what it does at `elapsed` seconds: a pure function of time, so a still frame and a moving one agree. */
function poseOf(site: Worksite, elapsed: number, still: boolean): Pose {
  const pose: Pose = {
    mode: POSE.HAMMER,
    x: site.work.x,
    y: site.ground,
    z: site.work.z,
    yaw: site.yaw + Math.PI,
    phase: elapsed * 1.3 + site.offset,
  };
  const state: AgentState = site.agent.state;
  if (state === AGENT_STATE.IDLE) return { ...pose, mode: POSE.STAND, phase: 0 };
  if (state === AGENT_STATE.WAITING) return { ...pose, mode: POSE.WAVE, yaw: site.yaw };
  if (state === AGENT_STATE.STUCK) return { ...pose, mode: POSE.SIT, yaw: site.yaw };
  if (state === AGENT_STATE.FAILED) return { ...pose, mode: POSE.KNEEL, phase: 0 };
  const topY = site.levels * site.levelHeight + 0.09;
  const [standX, standZ] = local(
    site,
    (hash2(seedOf(site.agent.id), 4) - 0.5) * 0.8,
    site.width / 2 - 0.27,
  );
  if (still)
    return site.haul === undefined
      ? { ...pose, x: standX, z: standZ, y: site.ground + topY, phase: 0.55 }
      : { ...pose, phase: 0.55 };
  const u = (((elapsed + site.offset) % site.cycle) + site.cycle) % site.cycle;
  if (site.haul !== undefined) return hauling(site.haul, u, pose);
  const [ladderX, ladderZ] = local(site, site.width / 2 - 0.3, site.width / 2 + 0.62);
  if (u < 11) return { ...pose, x: standX, z: standZ, y: site.ground + topY };
  if (u < 11 + site.climb)
    return {
      ...pose,
      mode: POSE.CLIMB,
      x: ladderX,
      z: ladderZ,
      y: site.ground + topY * (1 - (u - 11) / site.climb),
      phase: u * 2.2,
    };
  if (u < 17 + site.climb) return pose;
  return {
    ...pose,
    mode: POSE.CLIMB,
    x: ladderX,
    z: ladderZ,
    y: site.ground + topY * ((u - 17 - site.climb) / site.climb),
    phase: u * 2.2,
  };
}

/** A hauler's round: hammering at its scaffold's foot, walking the road to the next zone, setting stone down, and carrying more back. */
function hauling(haul: NonNullable<Worksite["haul"]>, u: number, pose: Pose): Pose {
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  if (u < 10) return pose;
  if (u < 10 + haul.travel) {
    along(haul.route, (u - 10) * 2.5, at);
    return {
      mode: POSE.WALK,
      x: at.x,
      z: at.z,
      y: groundAt(at.x, at.z),
      yaw: Math.atan2(at.dx, at.dz),
      phase: (u - 10) * 1.55,
    };
  }
  if (u < 13 + haul.travel) {
    along(haul.route, haul.route.length, at);
    return {
      mode: POSE.KNEEL,
      x: at.x,
      z: at.z,
      y: groundAt(at.x, at.z),
      yaw: Math.atan2(at.dx, at.dz) + Math.PI,
      phase: u,
    };
  }
  along(haul.route, haul.route.length - (u - 13 - haul.travel) * 2.5, at);
  return {
    mode: POSE.CARRY,
    x: at.x,
    z: at.z,
    y: groundAt(at.x, at.z),
    yaw: Math.atan2(-at.dx, -at.dz),
    phase: (u - 13 - haul.travel) * 1.55,
  };
}

/** The masons and their worksites as the world draws them. */
export interface Masons {
  readonly meshes: readonly InstancedMesh[];
  /** Stands up the worksites of the agents shown: rebuilt when the agents or the town change. */
  readonly raise: (
    agents: readonly AgentView[],
    sites: ReadonlyMap<string, ZoneSite>,
    gates: readonly number[],
  ) => void;
  /** Colours each worksite's flag and each mason's pennant: its signal, or the selection's where chosen. */
  readonly mark: (chosen: (target: PickTarget) => boolean) => void;
  /** Poses every mason and swings every crane for `elapsed` seconds. */
  readonly pose: (
    elapsed: number,
    still: boolean,
    cheering: (target: PickTarget) => boolean,
  ) => void;
  /** Where an agent's mason stands now, for the selection's ring. */
  readonly spotOf: (id: string) => (WorldPoint & { readonly size: number }) | undefined;
  /** The floor its worksites stand on, which the forest gives way to. */
  readonly clearings: () => { x: number; z: number; radius: number }[];
}

/** A colour parsed once, however often a mason is dressed in it. */
const PAINTS = new Map<string, Color>();
function paint(hex: string): Color {
  const known = PAINTS.get(hex);
  if (known !== undefined) return known;
  const made = new Color(hex);
  PAINTS.set(hex, made);
  return made;
}

/** A matrix that draws a part at no size. */
const GONE = new Matrix4().makeScale(0, 0, 0);

/** One instanced mesh, allocated at `capacity`, dynamic, starting with nothing drawn. */
function instanced(
  geometry: BufferGeometry,
  material: Material,
  capacity: number,
  shadow = true,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.setColorAt(0, new Color("#ffffff"));
  return mesh;
}

/** The masons' meshes, allocated at the snapshot's bound, and registered for picking. */
export function buildMasons(
  materials: CitadelMaterials,
  palette: WorldPalette,
  picking: WorldPicking,
): Masons {
  const box = new BoxGeometry(1, 1, 1);
  const beams = instanced(box, materials.plain, MAX_AGENTS * BEAMS_PER_AGENT);
  const freshDrums = instanced(new CylinderGeometry(1, 1, 1, 20, 1), materials.fresh, MAX_AGENTS);
  const freshBlocks = instanced(box, materials.fresh, MAX_AGENTS * 7);
  const oldBlocks = instanced(box, materials.stone, MAX_AGENTS * 2);
  const patches = instanced(
    box,
    new MeshStandardMaterial({
      color: "#f6f1e6",
      emissive: palette.signal.BUILDING,
      emissiveIntensity: 1.1,
    }),
    MAX_AGENTS,
  );
  const rubble = instanced(new DodecahedronGeometry(1, 0), materials.rock, MAX_AGENTS * 9);
  const blocks = instanced(box, materials.plain, MAX_AGENTS * BLOCKS_PER_MASON);
  const torsos = instanced(
    new CylinderGeometry(0.2, 0.29, 0.62, 10).translate(0, 0.31, 0),
    materials.plain,
    MAX_AGENTS,
  );
  const heads = instanced(
    new SphereGeometry(0.165, 14, 10),
    new MeshStandardMaterial({ color: "#e7b590", roughness: 0.7 }),
    MAX_AGENTS,
  );
  const hats = instanced(
    new SphereGeometry(0.182, 12, 8, 0, TAU, 0, Math.PI * 0.55).translate(0, 0.02, -0.01),
    materials.plain,
    MAX_AGENTS,
  );
  const pennantGeometry = new BufferGeometry();
  pennantGeometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0, 0, -0.34, 0, 0, -0.17, -0.5], 3),
  );
  pennantGeometry.computeVertexNormals();
  const pennants = instanced(
    pennantGeometry,
    new MeshBasicMaterial({ side: DoubleSide }),
    MAX_AGENTS,
    false,
  );
  const cranes = instanced(
    box,
    new MeshStandardMaterial({ color: "#6a4a2e", roughness: 0.9 }),
    MAX_AGENTS * 3,
  );
  const loads = instanced(box, materials.fresh, MAX_AGENTS);
  const flagTime = { value: 0 };
  const flagMaterial = new MeshBasicMaterial({ side: DoubleSide, toneMapped: false });
  flagMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = flagTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nfloat phase = float(gl_InstanceID) * 2.3; float fly = position.x / 1.5;\ntransformed.z += sin(position.x * 3.5 - uTime * 7.0 + phase) * 0.2 * fly;",
      );
  };
  const flags = instanced(
    new PlaneGeometry(1.5, 0.9, 8, 2).translate(0.75, -0.45, 0),
    flagMaterial,
    MAX_AGENTS,
    false,
  );
  // Note that the pick proxies are drawn by no one: their material is invisible, but a ray still meets them.
  const unseen = new MeshBasicMaterial({ visible: false });
  const siteProxies = instanced(new BoxGeometry(1, 1, 1), unseen, MAX_AGENTS, false);
  const masonProxies = instanced(
    new BoxGeometry(1.4, 2.6, 1.4).translate(0, 1.3, 0),
    unseen,
    MAX_AGENTS,
    false,
  );

  let worksites: Worksite[] = [];
  const targetOf = (instanceId: number): PickTarget | undefined => {
    const site = worksites[instanceId];
    return site === undefined ? undefined : { kind: PICK_KIND.AGENT, id: site.agent.id };
  };
  picking.addInstances(siteProxies, targetOf);
  picking.addInstances(masonProxies, targetOf);

  const matrix = new Matrix4();
  const part = new Matrix4();
  const bones = {
    root: new Matrix4(),
    hip: new Matrix4(),
    limb: new Matrix4(),
    torso: new Matrix4(),
    head: new Matrix4(),
    rightArm: new Matrix4(),
    leftArm: new Matrix4(),
  } as const;
  const tint = new Color();
  const counts = new Map<InstancedMesh, number>();
  const put = (
    mesh: InstancedMesh,
    site: Worksite,
    lx: number,
    ly: number,
    lz: number,
    sx: number,
    sy: number,
    sz: number,
    color?: string,
    yaw = 0,
    pitch = 0,
    roll = 0,
  ) => {
    const count = counts.get(mesh) ?? 0;
    if (count >= mesh.instanceMatrix.count) return;
    mesh.setMatrixAt(
      count,
      matrix.copy(site.frame).multiply(placed(part, lx, ly, lz, yaw, sx, sy, sz, pitch, roll)),
    );
    if (color !== undefined) mesh.setColorAt(count, tint.set(color));
    counts.set(mesh, count + 1);
  };
  const finish = (meshes: readonly InstancedMesh[]) => {
    for (const mesh of meshes) {
      mesh.count = counts.get(mesh) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };
  const statics = [
    beams,
    freshDrums,
    freshBlocks,
    oldBlocks,
    patches,
    rubble,
    flags,
    siteProxies,
  ] as const;

  /** A scaffold: four posts, a ledger, plank, and brace at each level, and a ladder up its outer face. */
  const scaffold = (site: Worksite) => {
    const half = site.width / 2;
    const top = site.height + 0.7;
    for (const [px, pz] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const)
      put(beams, site, px * half, top / 2, pz * half, 0.11, top, 0.11, TIMBER.POST);
    for (let level = 1; level <= site.levels; level += 1) {
      const y = level * site.levelHeight;
      put(beams, site, 0, y, half, site.width + 0.24, 0.08, 0.08, TIMBER.LEDGER);
      put(beams, site, 0, y, -half, site.width + 0.24, 0.08, 0.08, TIMBER.LEDGER);
      put(beams, site, half, y, 0, 0.08, 0.08, site.width + 0.24, TIMBER.LEDGER);
      put(beams, site, -half, y, 0, 0.08, 0.08, site.width + 0.24, TIMBER.LEDGER);
      put(beams, site, 0, y + 0.06, half - 0.27, site.width + 0.1, 0.06, 0.54, TIMBER.PLANK);
      if (level % 2 === 0)
        put(beams, site, 0, y + 0.06, -half + 0.27, site.width + 0.1, 0.06, 0.54, TIMBER.PLANK);
      const brace = Math.atan2(site.width, site.levelHeight) * (level % 2 === 1 ? 1 : -1);
      put(
        beams,
        site,
        0,
        y - site.levelHeight / 2,
        half + 0.07,
        0.06,
        Math.hypot(site.width, site.levelHeight),
        0.06,
        TIMBER.LEDGER,
        0,
        0,
        brace,
      );
    }
    const ladder = half - 0.3;
    put(
      beams,
      site,
      ladder - 0.2,
      site.height / 2 + 0.25,
      half + 0.32,
      0.06,
      site.height + 0.5,
      0.06,
      TIMBER.RUNG,
    );
    put(
      beams,
      site,
      ladder + 0.2,
      site.height / 2 + 0.25,
      half + 0.32,
      0.06,
      site.height + 0.5,
      0.06,
      TIMBER.RUNG,
    );
    for (let y = 0.35; y < site.height + 0.3; y += 0.42)
      put(beams, site, ladder, y, half + 0.32, 0.42, 0.045, 0.05, TIMBER.RUNG);
    if (site.crane) {
      put(
        beams,
        site,
        half + 1.3,
        (site.height + 2.6) / 2,
        -half + 0.2,
        0.26,
        site.height + 2.6,
        0.26,
        TIMBER.POST,
      );
      put(beams, site, half + 1.3, 0.12, -half + 0.2, 1.4, 0.24, 1.4, TIMBER.POST);
      put(
        beams,
        site,
        half + 0.85,
        (site.height + 2.6) * 0.25,
        -half + 0.2,
        0.08,
        (site.height + 2.6) * 0.52,
        0.08,
        TIMBER.LEDGER,
        0,
        0,
        -0.35,
      );
    }
    // Note that a stuck agent's flag hangs at half mast, so a still frame says it as well as a moving one.
    const mast = site.agent.state === AGENT_STATE.STUCK ? 0.55 : 1;
    const flagSize = 0.55 + site.agent.buildSize * 0.3;
    put(
      beams,
      site,
      half,
      top + flagSize * 0.8 - 0.1,
      -half,
      0.1,
      flagSize * 1.6,
      0.1,
      TIMBER.POST,
    );
    const wind = Math.atan2(WIND.x, WIND.z) - Math.PI / 2 - site.yaw;
    put(
      flags,
      site,
      half,
      top - 0.1 + flagSize * 1.5 * mast,
      -half,
      flagSize,
      flagSize,
      flagSize,
      undefined,
      wind,
    );
  };

  /** The work inside a scaffold, by its kind: a new drum of fresh stone, an old wall with a glowing patch, a wall half rebuilt among its rubble, or plain stone. */
  const workings = (site: Worksite) => {
    const random = seeded(seedOf(site.agent.id) * 7);
    const half = site.width / 2;
    const height = site.scaffolded ? site.height : site.height * 0.9;
    switch (workOf(site.agent.kind)) {
      case WORK.NEW: {
        const radius = 0.52 + 0.22 * site.agent.buildSize;
        const rise = height * 0.84;
        put(freshDrums, site, 0, rise / 2, 0, radius, rise, radius);
        for (let k = 0; k < 5; k += 1) {
          const angle = (k / 5) * TAU + random();
          if (random() < 0.7)
            put(
              freshBlocks,
              site,
              Math.cos(angle) * radius * 0.85,
              rise + 0.18,
              Math.sin(angle) * radius * 0.85,
              0.36,
              0.36,
              0.26,
              undefined,
              -angle,
            );
        }
        put(freshBlocks, site, -0.35, 0.18, half + 0.95, 0.5, 0.36, 0.4, undefined, 0.3);
        break;
      }
      case WORK.PATCH: {
        const rise = height * 0.74;
        put(oldBlocks, site, 0, rise / 2, -0.15, site.width * 0.62, rise, 0.95, "#a8957a");
        put(patches, site, 0.1, rise * 0.55, 0.35, 0.78, 0.66, 0.12);
        put(freshBlocks, site, -0.4, 0.15, half + 0.9, 0.36, 0.3, 0.3);
        break;
      }
      case WORK.REBUILD: {
        const low = height * 0.4;
        const high = height * 0.3;
        put(oldBlocks, site, 0, low / 2, 0, site.width * 0.58, low, site.width * 0.58, "#a8957a");
        put(
          freshBlocks,
          site,
          0.05,
          low + high / 2 + 0.03,
          0.04,
          site.width * 0.52,
          high,
          site.width * 0.52,
          undefined,
          0.08,
        );
        for (let k = 0; k < 9; k += 1) {
          const angle = random() * TAU;
          const out = site.width * 0.55 + random() * 1.2;
          put(
            rubble,
            site,
            Math.cos(angle) * out,
            0.12,
            Math.sin(angle) * out,
            0.18 + random() * 0.26,
            0.15 + random() * 0.2,
            0.2 + random() * 0.25,
            "#a8957a",
            random() * 6,
            random(),
          );
        }
        put(
          oldBlocks,
          site,
          -site.width * 0.7,
          0.3,
          -site.width * 0.2,
          0.9,
          0.6,
          0.7,
          "#a8957a",
          0.6,
          0.35,
        );
        break;
      }
      case WORK.PLAIN:
        put(
          oldBlocks,
          site,
          0,
          height * 0.3,
          0,
          site.width * 0.5,
          height * 0.6,
          site.width * 0.5,
          "#a8957a",
        );
        break;
    }
  };

  const signalOf = (site: Worksite) =>
    site.agent.state === AGENT_STATE.FAILED ? palette.signal.DEFECT : palette.signal.BUILDING;
  let lastElapsed = 0;
  let lastStill = false;
  const nobody = () => false;

  /** One mason's parts for its pose: legs, tunic, head, hat, arms, its tool or stone, its pennant pole and pennant, its pick box, and its crane. */
  const posePart = (
    site: Worksite,
    index: number,
    pose: Pose,
    elapsed: number,
    cheering: boolean,
  ) => {
    const dress = dressOf(site.agent.kind);
    let bob = 0;
    let lean = 0;
    let legs = 0;
    let left = 0;
    let right = 0;
    let crouch = 0;
    switch (pose.mode) {
      case POSE.WALK:
      case POSE.CARRY: {
        const swing = Math.sin(pose.phase * TAU * 0.62);
        legs = swing * 0.62;
        bob = Math.abs(Math.cos(pose.phase * TAU * 0.62)) * 0.06;
        left = pose.mode === POSE.CARRY ? -1.15 : -swing * 0.5;
        right = pose.mode === POSE.CARRY ? -1.15 : swing * 0.5;
        lean = pose.mode === POSE.CARRY ? -0.08 : 0;
        break;
      }
      case POSE.HAMMER: {
        const f = (pose.phase * 0.9) % 1;
        const swing = f < 0.68 ? easeInOut(f / 0.68) : 1 - ((f - 0.68) / 0.32) ** 2.2;
        right = -0.35 - 2.15 * swing;
        left = -0.85;
        lean = 0.12 + 0.12 * (1 - swing);
        break;
      }
      case POSE.CLIMB: {
        const s = Math.sin(pose.phase * Math.PI);
        left = -2.5 + s * 0.35;
        right = -2.5 - s * 0.35;
        legs = s * 0.45;
        break;
      }
      case POSE.KNEEL:
        crouch = 0.22;
        lean = 0.55;
        left = -1.1;
        right = -1.1;
        break;
      case POSE.WAVE:
        right = -2.75 + Math.sin(pose.phase * 3) * 0.3;
        left = -0.2;
        break;
      case POSE.SIT:
        crouch = 0.42;
        lean = 0.42;
        legs = -1.35;
        left = -0.5;
        right = -0.5;
        break;
      case POSE.STAND:
        left = -0.1;
        right = -0.1;
        break;
    }
    // Note that a hovered or chosen mason hops and waves back.
    if (cheering && pose.mode !== POSE.SIT) {
      bob += Math.abs(Math.sin(elapsed * 9)) * 0.22;
      left = -2.85 + Math.sin(elapsed * 13) * 0.4;
      lean = 0;
    }
    const { root, hip, limb, torso, head, rightArm, leftArm } = bones;
    placed(
      root,
      pose.x,
      pose.y + (bob - crouch) * MASON_SCALE,
      pose.z,
      pose.yaw,
      MASON_SCALE,
      MASON_SCALE,
      MASON_SCALE,
    );
    const joint = (
      out: Matrix4,
      parent: Matrix4,
      x: number,
      y: number,
      z: number,
      pitch = 0,
      roll = 0,
    ) => out.copy(parent).multiply(placed(part, x, y, z, 0, 1, 1, 1, pitch, roll));
    const block = (
      slot: number,
      parent: Matrix4,
      x: number,
      y: number,
      z: number,
      sx: number,
      sy: number,
      sz: number,
      color: string,
    ) => {
      blocks.setMatrixAt(
        index * BLOCKS_PER_MASON + slot,
        matrix.copy(parent).multiply(placed(part, x, y, z, 0, sx, sy, sz)),
      );
      blocks.setColorAt(index * BLOCKS_PER_MASON + slot, paint(color));
    };
    joint(hip, root, 0, 0.5, 0);
    block(0, joint(limb, hip, -0.1, 0, 0, legs), 0, -0.25, 0, 0.15, 0.5, 0.17, "#4a3527");
    block(
      1,
      joint(limb, hip, 0.1, 0, 0, pose.mode === POSE.SIT ? legs : -legs),
      0,
      -0.25,
      0,
      0.15,
      0.5,
      0.17,
      "#4a3527",
    );
    joint(torso, root, 0, 0.5, 0, lean);
    torsos.setMatrixAt(index, torso);
    torsos.setColorAt(index, paint(dress.tunic));
    joint(head, torso, 0, 0.78, 0.01, pose.mode === POSE.SIT ? 0.4 : 0);
    heads.setMatrixAt(index, head);
    hats.setMatrixAt(index, joint(limb, head, 0, 0.03, 0));
    hats.setColorAt(index, paint(dress.hat));
    joint(rightArm, torso, 0.28, 0.55, 0, right, -0.08);
    joint(leftArm, torso, -0.28, 0.55, 0, left, 0.08);
    block(2, rightArm, 0, -0.21, 0, 0.11, 0.46, 0.12, dress.tunic);
    block(3, leftArm, 0, -0.21, 0, 0.11, 0.46, 0.12, dress.tunic);
    // Note that a part a pose does without is drawn at no size, so every mason keeps its slots.
    const tool = pose.mode === POSE.HAMMER || pose.mode === POSE.KNEEL ? 1 : 0;
    block(4, rightArm, 0, -0.44, 0.2, 0.05 * tool, 0.05 * tool, 0.5 * tool, "#6d6f78");
    block(5, rightArm, 0, -0.44, 0.44, 0.2 * tool, 0.11 * tool, 0.11 * tool, "#6d6f78");
    const carrying = pose.mode === POSE.CARRY ? 1 : 0;
    block(6, torso, 0, 0.42, 0.36, 0.38 * carrying, 0.26 * carrying, 0.3 * carrying, "#fff6e4");
    block(7, torso, 0, 0.825, -0.3, 0.03, 1.15, 0.03, "#7a5434");
    pennants.setMatrixAt(index, joint(limb, torso, 0, 1.36, -0.38, -0.12));
    masonProxies.setMatrixAt(index, root);
    if (!site.crane) return;
    const swing =
      pose.mode === POSE.HAMMER ||
      pose.mode === POSE.WALK ||
      pose.mode === POSE.CARRY ||
      pose.mode === POSE.CLIMB
        ? Math.sin(elapsed * 0.21 + site.offset) * 0.9
        : 0;
    const [baseX, baseZ] = local(site, site.width / 2 + 1.3, -site.width / 2 + 0.2);
    const reach = 3 + 1.7 * site.agent.buildSize;
    const mastTop = site.ground + site.height + 2.6;
    const jibYaw = site.yaw + Math.PI / 2 + 0.9 + swing;
    const sx = Math.sin(jibYaw);
    const cz = Math.cos(jibYaw);
    const lift = 0.5 + 0.5 * Math.sin(elapsed * 0.33 + site.offset * 2);
    const rope = 0.6 + lift * (site.height + 1.2);
    cranes.setMatrixAt(
      index * 3,
      placed(
        matrix,
        baseX + sx * reach * 0.42,
        mastTop,
        baseZ + cz * reach * 0.42,
        jibYaw,
        0.2,
        0.2,
        reach * 1.35,
      ),
    );
    cranes.setMatrixAt(
      index * 3 + 1,
      placed(matrix, baseX - sx * 0.9, mastTop - 0.25, baseZ - cz * 0.9, jibYaw, 0.6, 0.6, 0.6),
    );
    cranes.setMatrixAt(
      index * 3 + 2,
      placed(
        matrix,
        baseX + sx * reach,
        mastTop - rope / 2,
        baseZ + cz * reach,
        0,
        0.03,
        rope,
        0.03,
      ),
    );
    loads.setMatrixAt(
      index,
      placed(
        matrix,
        baseX + sx * reach,
        mastTop - rope - 0.2,
        baseZ + cz * reach,
        elapsed * 0.2,
        0.55,
        0.4,
        0.45,
      ),
    );
  };

  const poseAll = (elapsed: number, still: boolean, cheering: (target: PickTarget) => boolean) => {
    lastElapsed = elapsed;
    lastStill = still;
    worksites.forEach((site, index) => {
      if (site.crane) return;
      for (let slot = 0; slot < 3; slot += 1) cranes.setMatrixAt(index * 3 + slot, GONE);
      loads.setMatrixAt(index, GONE);
    });
    worksites.forEach((site, index) => {
      posePart(
        site,
        index,
        poseOf(site, elapsed, still),
        elapsed,
        cheering({ kind: PICK_KIND.AGENT, id: site.agent.id }),
      );
    });
    const drawn = worksites.length;
    for (const mesh of [torsos, heads, hats, pennants, masonProxies, loads]) mesh.count = drawn;
    blocks.count = drawn * BLOCKS_PER_MASON;
    cranes.count = drawn * 3;
    for (const mesh of [blocks, torsos, heads, hats, pennants, masonProxies, cranes, loads]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    meshes: [
      beams,
      freshDrums,
      freshBlocks,
      oldBlocks,
      patches,
      rubble,
      blocks,
      torsos,
      heads,
      hats,
      pennants,
      cranes,
      loads,
      flags,
      siteProxies,
      masonProxies,
    ],
    raise: (agents, sites, gates) => {
      worksites = worksitesOf(agents.slice(0, MAX_AGENTS), sites, gates);
      counts.clear();
      for (const site of worksites) {
        if (site.scaffolded) scaffold(site);
        workings(site);
        put(
          siteProxies,
          site,
          0,
          (site.height + 0.8) / 2,
          0,
          site.width + 0.6,
          site.height + 0.8,
          site.width + 0.6,
        );
      }
      // Note that an idle agent has no flag, so its slot stays empty and the flags keep to their worksites.
      finish(statics);
      poseAll(lastElapsed, lastStill, nobody);
    },
    mark: (chosen) => {
      let flag = 0;
      worksites.forEach((site, index) => {
        const color = chosen({ kind: PICK_KIND.AGENT, id: site.agent.id })
          ? palette.signal.SELECTION
          : signalOf(site);
        tint.set(color);
        pennants.setColorAt(index, tint);
        if (!site.scaffolded) return;
        flags.setColorAt(flag, tint);
        flag += 1;
      });
      for (const mesh of [pennants, flags])
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    },
    pose: (elapsed, still, cheering) => {
      flagTime.value = elapsed;
      poseAll(elapsed, still, cheering);
    },
    spotOf: (id) => {
      const index = worksites.findIndex((site) => site.agent.id === id);
      const site = worksites[index];
      if (site === undefined) return undefined;
      const at = new Vector3().setFromMatrixPosition(masonProxies.getMatrixAt(index, matrix));
      return { x: at.x, y: at.y + 0.05, z: at.z, size: 1 };
    },
    clearings: () =>
      worksites.map((site) => ({
        x: site.x,
        z: site.z,
        radius: site.width + (site.crane ? 3 : 1.5),
      })),
  };
}
