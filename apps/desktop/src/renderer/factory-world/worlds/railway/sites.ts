import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentState,
  type AgentView,
  BUILD_FULL_LINES,
  type SIGNAL_COLOR,
} from "@luke/ui/factory-world";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  hashOf,
  hidden,
  lerp,
  pickOf,
  placing,
  seeded,
  shade,
  smooth,
  TAU,
  turned,
  UNIT_GEOMETRY,
} from "./kit";
import type { Particles } from "./particles";

/**
 * sites.ts -- the agents at work: a construction site for each, its build as tall and wide as its pull request is large, ringed by striped fencing, with a crane over the large ones and a crew of figurines who hammer, weld and haul, sit idle when stuck, and wave when it is the developer's move.
 *
 * What a site builds reads its pull request's kind: a new feature's open
 * steel frame, a fix's patched house, a refactor's re-clad block, docs' paper
 * stacks. Its size is the view model's `buildSize`, turned back into lines so
 * the mockup's proportions hold. Every part of every site is an instance of
 * one of two meshes (a box and a gable) allocated at the contract's bound,
 * rewritten only when the agents change, never on a hover. The crew and the
 * cranes move in `animate`; their pose at rest says what the agent is doing
 * on its own, so a still frame reads the same.
 */

/** How many of each part the sites hold at most, for a hundred agents. */
const CAPACITY = { AGENTS: 100, BOXES: 16000, GABLES: 120, WORKERS: 300 } as const;

/** What a site builds, by its pull request's kind. */
const BUILD = {
  /** An open steel frame, floor on floor. */
  FRAME: "frame",
  /** A house whose wall is being patched. */
  HOUSE: "house",
  /** A block being re-clad from the top down. */
  REFIT: "refit",
  /** Stacks of paper as tall as the change. */
  PAPERS: "papers",
} as const;

type Build = (typeof BUILD)[keyof typeof BUILD];

/** What a worker is doing. */
const MOTION = {
  HAMMER: "hammer",
  WELD: "weld",
  CARRY: "carry",
  SIT: "sit",
  WAVE: "wave",
} as const;

type Motion = (typeof MOTION)[keyof typeof MOTION];

const WHITE = new Color("#f6f3ec");
const WOOD = new Color("#8a5a35");
const SLATE = new Color("#55606e");
const SKINS = ["#f1c7a5", "#d9a07a", "#a8714c", "#7a4b2f", "#f5d6bd"] as const;

function buildOf(kind: AgentView["kind"]): Build {
  if (kind === AGENT_KIND.FIX) return BUILD.HOUSE;
  if (kind === AGENT_KIND.REFACTOR) return BUILD.REFIT;
  if (kind === AGENT_KIND.DOCS) return BUILD.PAPERS;
  return BUILD.FRAME;
}

/** A build size turned back into the lines it was read from, so a site keeps the mockup's proportions. */
function linesOf(buildSize: number): number {
  return Math.expm1(buildSize * Math.log1p(BUILD_FULL_LINES));
}

/** A site's footprint and height for an agent's lines. */
export function siteSizeOf(buildSize: number) {
  const lines = linesOf(buildSize);
  return { width: 0.9 + 0.32 * lines ** 0.22, height: 0.5 + 0.36 * lines ** 0.31 };
}

/** A crane over a large build: where its mast stands in the site's frame, how tall, how long its jib, and how it swings. */
interface Crane {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly jib: number;
  readonly phase: number;
}

/** One figurine on a site. */
interface Worker {
  readonly motion: Motion;
  readonly x: number;
  readonly z: number;
  readonly face: number;
  readonly phase: number;
  readonly skin: Color;
  /** Its place round the site, for one who hauls planks round it. */
  readonly angle: number;
  readonly radius: number;
}

/** One agent's site as raised: where it stands, how big, what moves on it. */
export interface Site {
  readonly agent: AgentView;
  readonly x: number;
  readonly z: number;
  readonly ry: number;
  readonly width: number;
  readonly height: number;
  readonly crane: Crane | undefined;
  readonly workers: readonly Worker[];
}

/** The figurine's parts, each an instanced mesh of its own. */
function figureGeometries() {
  return {
    leg: new BoxGeometry(0.085, 0.27, 0.095).translate(0, -0.135, 0),
    torso: new BoxGeometry(0.24, 0.29, 0.15).translate(0, 0.145, 0),
    head: new SphereGeometry(0.083, 10, 8),
    hat: mergeGeometries([
      new SphereGeometry(0.094, 10, 5, 0, TAU, 0, Math.PI / 2).toNonIndexed(),
      new CylinderGeometry(0.12, 0.12, 0.018, 10).toNonIndexed(),
    ]),
    arm: new BoxGeometry(0.068, 0.25, 0.075).translate(0, -0.125, 0),
    tool: mergeGeometries([
      new BoxGeometry(0.025, 0.24, 0.025).translate(0, -0.1, 0).toNonIndexed(),
      new BoxGeometry(0.11, 0.05, 0.04).translate(0.02, -0.22, 0).toNonIndexed(),
    ]),
    plank: new BoxGeometry(0.9, 0.04, 0.1),
  };
}

/** The meshes every site is drawn in, made once at their bounds as the world is created. */
export function siteMeshes() {
  const figure = figureGeometries();
  const skin = new MeshStandardMaterial({ roughness: 0.6 });
  const crane = new MeshStandardMaterial({ color: "#e9b52c", roughness: 0.5, metalness: 0.2 });
  const meshes = {
    boxes: new InstancedMesh(
      UNIT_GEOMETRY.box(),
      new MeshStandardMaterial({ roughness: 0.75 }),
      CAPACITY.BOXES,
    ),
    gables: new InstancedMesh(
      UNIT_GEOMETRY.gable(),
      new MeshStandardMaterial({ roughness: 0.75 }),
      CAPACITY.GABLES,
    ),
    legs: new InstancedMesh(figure.leg, skin, CAPACITY.WORKERS * 2),
    torsos: new InstancedMesh(figure.torso, skin, CAPACITY.WORKERS),
    heads: new InstancedMesh(figure.head, skin, CAPACITY.WORKERS),
    hats: new InstancedMesh(figure.hat, skin, CAPACITY.WORKERS),
    arms: new InstancedMesh(figure.arm, skin, CAPACITY.WORKERS * 2),
    tools: new InstancedMesh(figure.tool, skin, CAPACITY.WORKERS),
    planks: new InstancedMesh(figure.plank, skin, CAPACITY.WORKERS),
    jibs: new InstancedMesh(
      mergeGeometries([
        new BoxGeometry(1, 0.14, 0.14).translate(0.5, 0, 0).toNonIndexed(),
        new BoxGeometry(0.32, 0.12, 0.12).translate(-0.18, 0, 0).toNonIndexed(),
        new BoxGeometry(0.22, 0.24, 0.22).translate(-0.3, -0.04, 0).toNonIndexed(),
        new BoxGeometry(0.18, 0.2, 0.2).translate(0.02, -0.17, 0).toNonIndexed(),
      ]),
      crane,
      CAPACITY.AGENTS,
    ),
    cables: new InstancedMesh(
      new BoxGeometry(0.015, 1, 0.015).translate(0, -0.5, 0),
      new MeshStandardMaterial({ color: "#222222" }),
      CAPACITY.AGENTS,
    ),
    loads: new InstancedMesh(
      new BoxGeometry(0.5, 0.18, 0.3),
      new MeshStandardMaterial({ roughness: 0.7 }),
      CAPACITY.AGENTS,
    ),
    beacons: new InstancedMesh(
      new SphereGeometry(0.2, 10, 8),
      new MeshBasicMaterial({ toneMapped: false }),
      CAPACITY.AGENTS,
    ),
    /** One invisible box over each site, so a press anywhere on it picks its agent. */
    proxies: new InstancedMesh(
      new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
      new MeshBasicMaterial({ visible: false }),
      CAPACITY.AGENTS,
    ),
  };
  for (const mesh of Object.values(meshes)) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    // Note that only the builds cast shadows: a figurine's or a cable's would cost a draw call each for a speck.
    mesh.castShadow = mesh === meshes.boxes || mesh === meshes.gables;
    mesh.receiveShadow = mesh === meshes.boxes || mesh === meshes.gables;
  }
  return meshes;
}

export type SiteMeshes = ReturnType<typeof siteMeshes>;

/** Writes a site's parts into the box and gable meshes, each placed in the site's frame. */
class Parts {
  boxes = 0;
  gables = 0;
  frame = new Matrix4();
  private readonly scratch = new Matrix4();

  constructor(private readonly meshes: SiteMeshes) {}

  box(
    color: Color,
    x: number,
    y: number,
    z: number,
    ry: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
  ): void {
    if (this.boxes >= CAPACITY.BOXES) return;
    placing(x, y, z, ry, sx, sy, sz, rx, 0, this.scratch).premultiply(this.frame);
    this.meshes.boxes.setMatrixAt(this.boxes, this.scratch);
    this.meshes.boxes.setColorAt(this.boxes, color);
    this.boxes += 1;
  }

  gable(color: Color, x: number, y: number, z: number, sx: number, sy: number, sz: number): void {
    if (this.gables >= CAPACITY.GABLES) return;
    placing(x, y, z, 0, sx, sy, sz, 0, 0, this.scratch).premultiply(this.frame);
    this.meshes.gables.setMatrixAt(this.gables, this.scratch);
    this.meshes.gables.setColorAt(this.gables, color);
    this.gables += 1;
  }

  finish(): void {
    this.meshes.boxes.count = this.boxes;
    this.meshes.gables.count = this.gables;
    for (const mesh of [this.meshes.boxes, this.meshes.gables]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  }
}

/** The pad, the striped fence round it, and the taped rail along the fence's top. */
function fence(parts: Parts, width: number, building: Color): void {
  parts.box(new Color("#8b6b4a"), 0, 0, 0, 0, width, 0.06, width);
  for (let side = 0; side < 4; side += 1) {
    const turn = (side * Math.PI) / 2;
    const [fx, fz] = turned(0, 0, turn, 0, width / 2);
    for (let post = 0; post < 5; post += 1) {
      const [px, pz] = turned(fx, fz, turn, -width / 2 + (width * post) / 4, 0);
      parts.box(post % 2 ? WHITE : building, px, 0, pz, turn, 0.05, 0.3, 0.05);
    }
    parts.box(building, fx, 0.24, fz, turn, width, 0.05, 0.03);
  }
}

/** The build itself, by its kind. */
function build(
  parts: Parts,
  kind: Build,
  width: number,
  height: number,
  building: Color,
  rnd: () => number,
): void {
  const w = width * 0.62;
  const floors = Math.max(1, Math.round(height / 0.62));
  if (kind === BUILD.FRAME) {
    for (let floor = 0; floor < floors; floor += 1) {
      parts.box(new Color("#cfcac0"), 0, floor * 0.62 + 0.06, 0, 0, w, 0.08, w);
      for (const [cx, cz] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ] as const) {
        parts.box(
          floor > floors - 3 ? building : new Color("#b9b3a8"),
          cx * w * 0.45,
          floor * 0.62 + 0.14,
          cz * w * 0.45,
          0,
          0.08,
          0.48,
          0.08,
        );
      }
      if (floor < floors - 2)
        parts.box(
          floor % 2 ? new Color("#d9d2c4") : new Color("#cbc3b4"),
          0,
          floor * 0.62 + 0.14,
          0,
          0,
          w * 0.86,
          0.48,
          w * 0.86,
        );
    }
    return;
  }
  if (kind === BUILD.HOUSE) {
    parts.box(
      new Color("#e3d6bf").offsetHSL(0, 0, (rnd() - 0.5) * 0.06),
      0,
      0.06,
      0,
      0,
      w,
      height,
      w,
    );
    parts.gable(SLATE, 0, height + 0.06, 0, w * 1.1, w * 0.5, w * 1.06);
    for (let patch = 0; patch < 4; patch += 1) {
      parts.box(
        patch % 2 ? WHITE : building,
        -w * 0.3 + patch * w * 0.2,
        height * 0.3,
        w / 2 + 0.02,
        0,
        w * 0.2,
        height * 0.4,
        0.03,
      );
    }
    return;
  }
  if (kind === BUILD.REFIT) {
    parts.box(new Color("#d9d2c4"), 0, 0.06, 0, 0, w, height * 0.55, w);
    parts.box(building, 0, height * 0.5, 0, 0, w * 1.08, height * 0.5, w * 1.08);
    parts.box(shade(building, -0.1), 0, height, 0, 0, w * 1.1, 0.06, w * 1.1);
    return;
  }
  for (let stack = 0; stack < 4; stack += 1) {
    const [px, pz] = turned(0, 0, (stack * Math.PI) / 2, w * 0.22, w * 0.22);
    const tall = height * (0.55 + rnd() * 0.45);
    for (let y = 0; y < tall; y += 0.14) {
      parts.box(
        y % 0.56 < 0.14 ? building : new Color("#f4efe3"),
        px,
        0.06 + y,
        pz,
        (rnd() - 0.5) * 0.25,
        w * 0.36,
        0.13,
        w * 0.28,
      );
    }
  }
}

/** Scaffolding round the build, pallets at its corner, and a crane's mast over a large one. */
function scaffold(
  parts: Parts,
  kind: Build,
  width: number,
  height: number,
  lines: number,
  rnd: () => number,
): Crane | undefined {
  const reach = (width * 0.62) / 2 + 0.16;
  const tall = kind === BUILD.PAPERS ? 0 : height + 0.3;
  const pole = new Color("#c9c2b0");
  if (tall > 0) {
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const)
      parts.box(pole, cx * reach, 0.06, cz * reach, 0, 0.04, tall, 0.04);
    for (let y = 0.6; y < tall; y += 0.62) {
      for (let side = 0; side < 4; side += 1) {
        const [lx, lz] = turned(0, 0, (side * Math.PI) / 2, 0, reach);
        parts.box(
          side % 2 ? new Color("#d8b25a") : pole,
          lx,
          y,
          lz,
          (side * Math.PI) / 2,
          reach * 2,
          0.035,
          0.08,
        );
      }
    }
  }
  const pallets = 2 + Math.floor(rnd() * 3);
  for (let pallet = 0; pallet < pallets; pallet += 1) {
    parts.box(
      pallet % 2 ? WOOD : new Color("#c49a62"),
      -width * 0.36 + pallet * 0.05,
      0.06 + pallet * 0.12,
      width * 0.36,
      rnd() * 0.3,
      0.42,
      0.11,
      0.3,
    );
  }
  if (lines <= 350) return undefined;
  const [mx, mz] = turned(0, 0, 0, width * 0.42, -width * 0.42);
  const mast = height + 2.4;
  parts.box(new Color("#e9b52c"), mx, 0.06, mz, 0, 0.2, mast, 0.2);
  parts.box(new Color("#6a6a6a"), mx, 0.06, mz, 0, 0.5, 0.14, 0.5);
  return { x: mx, z: mz, height: mast, jib: Math.max(2.2, width * 1.25), phase: rnd() * TAU };
}

/** The crew a site's lines call for, posed by what its agent is doing. */
function crewOf(
  agent: AgentView,
  x: number,
  z: number,
  ry: number,
  width: number,
  lines: number,
  rnd: () => number,
): Worker[] {
  const count = 1 + (lines > 250 ? 1 : 0) + (lines > 1800 ? 1 : 0);
  return Array.from({ length: count }, (_, index) => {
    const angle = ry + (index / count) * TAU + 0.4;
    const radius = width * 0.42 + 0.25;
    const bx = x + Math.cos(angle) * radius;
    const bz = z + Math.sin(angle) * radius;
    const busy: Motion =
      index === 1
        ? MOTION.CARRY
        : agent.kind === AGENT_KIND.FIX && index === 0
          ? MOTION.WELD
          : MOTION.HAMMER;
    return {
      motion: motionOf(agent.state, busy),
      x: bx,
      z: bz,
      face: Math.atan2(-(z - bz), x - bx),
      phase: rnd() * TAU,
      skin: new Color(pickOf(SKINS, rnd)),
      angle,
      radius,
    };
  });
}

/** A worker's motion for its agent's state: busy at work, waving on the developer's move, sitting when stuck or failed. */
function motionOf(state: AgentState, busy: Motion): Motion {
  if (state === AGENT_STATE.WORKING) return busy;
  if (state === AGENT_STATE.WAITING) return MOTION.WAVE;
  return MOTION.SIT;
}

/** Where one agent's site is raised: on its lot, turned a seeded way. */
export interface SitePlan {
  readonly agent: AgentView;
  readonly x: number;
  readonly z: number;
}

/**
 * Raises every planned site: its parts into the shared meshes, its pick box,
 * and its crew and crane for `animate`. A site's colours are its signal's:
 * building's amber, unchanged.
 */
export function raiseSites(
  plans: readonly SitePlan[],
  meshes: SiteMeshes,
  signal: typeof SIGNAL_COLOR,
): Site[] {
  const parts = new Parts(meshes);
  const building = new Color(signal.BUILDING);
  const matrix = new Matrix4();
  const sites = plans.slice(0, CAPACITY.AGENTS).map(({ agent, x, z }, index) => {
    const rnd = seeded(hashOf(agent.id));
    const ry = rnd() * TAU;
    const { width, height } = siteSizeOf(agent.buildSize);
    const lines = linesOf(agent.buildSize);
    const kind = buildOf(agent.kind);
    parts.frame = placing(x, 0, z, ry);
    fence(parts, width, building);
    build(parts, kind, width, height, building, rnd);
    const crane = scaffold(parts, kind, width, height, lines, rnd);
    meshes.proxies.setMatrixAt(
      index,
      placing(
        x,
        0,
        z,
        ry,
        width + 0.8,
        height + (crane === undefined ? 1 : 2.6),
        width + 0.8,
        0,
        0,
        matrix,
      ),
    );
    return {
      agent,
      x,
      z,
      ry,
      width,
      height,
      crane,
      workers: crewOf(agent, x, z, ry, width, lines, rnd),
    };
  });
  parts.finish();
  meshes.proxies.count = sites.length;
  meshes.proxies.instanceMatrix.needsUpdate = true;
  meshes.proxies.computeBoundingSphere();
  paintCrews(sites, meshes, building);
  return sites;
}

/** Paints every figurine: navy trousers, a vest and hard hat in building's amber, skin, a grey tool, a pine plank. */
function paintCrews(sites: readonly Site[], meshes: SiteMeshes, building: Color): void {
  const trousers = new Color("#2c3e5c");
  const sleeve = shade(building, -0.1);
  const hat = shade(building, 0.12);
  let index = 0;
  for (const site of sites) {
    for (const worker of site.workers) {
      if (index >= CAPACITY.WORKERS) return;
      meshes.legs.setColorAt(index * 2, trousers);
      meshes.legs.setColorAt(index * 2 + 1, trousers);
      meshes.torsos.setColorAt(index, building);
      meshes.heads.setColorAt(index, worker.skin);
      meshes.hats.setColorAt(index, hat);
      meshes.arms.setColorAt(index * 2, sleeve);
      meshes.arms.setColorAt(index * 2 + 1, sleeve);
      meshes.tools.setColorAt(index, new Color("#6b6b6b"));
      meshes.planks.setColorAt(index, new Color("#c49a62"));
      index += 1;
    }
  }
  for (const mesh of [
    meshes.legs,
    meshes.torsos,
    meshes.heads,
    meshes.hats,
    meshes.arms,
    meshes.tools,
    meshes.planks,
  ]) {
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
}

/** A worker's limbs at `time`: legs' and arms' swing, a bob, and whether a tool or a plank is in hand. */
interface Pose {
  x: number;
  z: number;
  face: number;
  legA: number;
  legB: number;
  armL: number;
  armR: number;
  bob: number;
  tool: boolean;
  plank: boolean;
}

function poseOf(worker: Worker, time: number): Pose {
  const pose: Pose = {
    x: worker.x,
    z: worker.z,
    face: worker.face,
    legA: 0,
    legB: 0,
    armL: 0,
    armR: 0,
    bob: 0,
    tool: true,
    plank: false,
  };
  const t = time + worker.phase;
  if (worker.motion === MOTION.SIT)
    return {
      ...pose,
      legA: -1.45,
      legB: -1.45,
      bob: -0.22,
      armL: -0.35,
      armR: -0.35 + Math.sin(t * 0.7) * 0.1,
      tool: false,
    };
  if (worker.motion === MOTION.WAVE)
    return {
      ...pose,
      armR: -2.85 + Math.sin(t * 12) * 0.4,
      armL: 0.15,
      bob: Math.abs(Math.sin(t * 6)) * 0.04,
      tool: false,
    };
  if (worker.motion === MOTION.WELD) return { ...pose, armR: -1.35, armL: -1.2 };
  if (worker.motion === MOTION.HAMMER) {
    const swing = (t * 1.6) % 1;
    const armR =
      swing < 0.7 ? lerp(-0.4, -2.6, smooth(swing / 0.7)) : lerp(-2.6, -0.4, (swing - 0.7) / 0.3);
    return { ...pose, armR, armL: -0.6, bob: Math.abs(Math.sin(t * 1.6 * Math.PI)) * 0.01 };
  }
  // Note that a hauler walks an arc round the site and back, turning at each end.
  const lap = (t * 0.35) % 2;
  const along = lap < 1 ? lap : 2 - lap;
  const way = lap < 1 ? 1 : -1;
  const angle = worker.angle + ((along - 0.5) * 1.6) / Math.max(0.6, worker.radius + 0.3);
  const cx = worker.x - Math.cos(worker.angle) * worker.radius;
  const cz = worker.z - Math.sin(worker.angle) * worker.radius;
  const tx = -Math.sin(angle) * way;
  const tz = Math.cos(angle) * way;
  return {
    ...pose,
    x: cx + Math.cos(angle) * (worker.radius + 0.35),
    z: cz + Math.sin(angle) * (worker.radius + 0.35),
    face: Math.atan2(-tz, tx),
    legA: Math.sin(t * 9) * 0.55,
    legB: -Math.sin(t * 9) * 0.55,
    armL: -Math.PI + 0.35,
    armR: Math.sin(t * 9) * -0.4,
    bob: Math.abs(Math.cos(t * 9)) * 0.025,
    tool: false,
    plank: true,
  };
}

const BODY = new Matrix4();
const PART = new Matrix4();
const LIMB = new Matrix4();

function setPart(
  mesh: InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
): Matrix4 {
  PART.copy(BODY).multiply(placing(x, y, z, ry, 1, 1, 1, rx, 0, LIMB));
  mesh.setMatrixAt(index, PART);
  return PART;
}

/** Poses every crew at `time`, swings every crane, blinks every beacon, and throws a spark where a hammer lands. */
export function animateSites(
  sites: readonly Site[],
  meshes: SiteMeshes,
  signal: typeof SIGNAL_COLOR,
  chosen: (agentId: string) => boolean,
  time: number,
  sparks: Particles | undefined,
): void {
  let index = 0;
  for (const site of sites) {
    for (const worker of site.workers) {
      if (index >= CAPACITY.WORKERS) break;
      const pose = poseOf(worker, time);
      placing(pose.x, 0.06 + pose.bob, pose.z, pose.face - Math.PI / 2, 0.9, 0.9, 0.9, 0, 0, BODY);
      setPart(meshes.legs, index * 2, -0.05, 0.27, 0, pose.legA);
      setPart(meshes.legs, index * 2 + 1, 0.05, 0.27, 0, pose.legB);
      setPart(meshes.torsos, index, 0, 0.27, 0);
      setPart(meshes.heads, index, 0, 0.65, 0);
      setPart(meshes.hats, index, 0, 0.69, 0);
      setPart(meshes.arms, index * 2, -0.155, 0.53, 0, pose.armL);
      const hand = setPart(meshes.arms, index * 2 + 1, 0.155, 0.53, 0, pose.armR);
      if (pose.tool)
        meshes.tools.setMatrixAt(
          index,
          hand.clone().multiply(placing(0, -0.24, 0.02, 0, 1, 1, 1, Math.PI / 2, 0, LIMB)),
        );
      else meshes.tools.setMatrixAt(index, hidden(pose.x, 0, pose.z, LIMB));
      if (pose.plank) setPart(meshes.planks, index, -0.12, 0.78, 0, 0, Math.PI / 2);
      else meshes.planks.setMatrixAt(index, hidden(pose.x, 0, pose.z, LIMB));
      if (sparks !== undefined && worker.motion === MOTION.WELD && Math.random() < 0.5) {
        sparks.emit(
          pose.x + Math.cos(pose.face) * 0.42,
          0.5,
          pose.z - Math.sin(pose.face) * 0.42,
          (Math.random() - 0.5) * 2.5,
          Math.random() * 2,
          (Math.random() - 0.5) * 2.5,
          0.35,
          0.1,
          0.02,
          4,
          3.2,
          1.6,
          1,
          0.5,
          9,
        );
      }
      index += 1;
    }
  }
  for (const mesh of [meshes.legs, meshes.arms]) mesh.count = index * 2;
  for (const mesh of [meshes.torsos, meshes.heads, meshes.hats, meshes.tools, meshes.planks])
    mesh.count = index;
  swingCranes(sites, meshes, time);
  blinkBeacons(sites, meshes, signal, chosen, time);
  for (const mesh of Object.values(meshes)) {
    if (mesh === meshes.boxes || mesh === meshes.gables || mesh === meshes.proxies) continue;
    mesh.instanceMatrix.needsUpdate = true;
  }
}

function swingCranes(sites: readonly Site[], meshes: SiteMeshes, time: number): void {
  const top = new Matrix4();
  let index = 0;
  for (const site of sites) {
    const crane = site.crane;
    if (crane === undefined) continue;
    const moving = site.agent.state === AGENT_STATE.WORKING;
    const t = moving ? time : 0;
    const yaw = Math.sin(t * 0.3 + crane.phase) * 1.4 + crane.phase;
    placing(crane.x, 0.06 + crane.height, crane.z, yaw, 1, 1, 1, 0, 0, top).premultiply(
      placing(site.x, 0, site.z, site.ry),
    );
    meshes.jibs.setMatrixAt(index, top.clone().multiply(new Matrix4().makeScale(crane.jib, 1, 1)));
    const hookAt = crane.jib * (0.55 + 0.3 * Math.sin(t * 0.5 + crane.phase));
    const drop = (crane.height - 0.6) * (0.5 + 0.4 * Math.sin(t * 0.37 + crane.phase * 2));
    meshes.cables.setMatrixAt(index, top.clone().multiply(placing(hookAt, 0, 0, 0, 1, drop, 1)));
    meshes.loads.setMatrixAt(
      index,
      top.clone().multiply(placing(hookAt, -drop - 0.1, 0, Math.sin(t + crane.phase) * 0.3)),
    );
    meshes.loads.setColorAt(index, new Color("#c49a62"));
    index += 1;
  }
  for (const mesh of [meshes.jibs, meshes.cables, meshes.loads]) mesh.count = index;
  if (meshes.loads.instanceColor !== null) meshes.loads.instanceColor.needsUpdate = true;
}

/** Each site's beacon: building's amber, blinking while it works; selection's colour when chosen; dark when stuck, defect's red when failed. */
function blinkBeacons(
  sites: readonly Site[],
  meshes: SiteMeshes,
  signal: typeof SIGNAL_COLOR,
  chosen: (agentId: string) => boolean,
  time: number,
): void {
  const tint = new Color();
  const matrix = new Matrix4();
  sites.forEach((site, index) => {
    const top = site.crane === undefined ? site.height + 0.55 : site.crane.height + 0.35;
    const [bx, bz] =
      site.crane === undefined
        ? [site.x, site.z]
        : turned(site.x, site.z, site.ry, site.crane.x, site.crane.z);
    const big = chosen(site.agent.id) ? 1.5 : 1;
    meshes.beacons.setMatrixAt(index, placing(bx, top + 0.06, bz, 0, big, big, big, 0, 0, matrix));
    const state = site.agent.state;
    if (chosen(site.agent.id)) tint.set(signal.SELECTION);
    else if (state === AGENT_STATE.FAILED) tint.set(signal.DEFECT);
    else if (state === AGENT_STATE.STUCK) tint.set("#4a3a2a");
    else {
      const blink = state !== AGENT_STATE.WORKING || Math.sin(time * 3.4 + index * 1.7) > -0.2;
      tint.set(signal.BUILDING).multiplyScalar(blink ? 1 : 0.35);
    }
    meshes.beacons.setColorAt(index, tint);
  });
  meshes.beacons.count = sites.length;
  if (meshes.beacons.instanceColor !== null) meshes.beacons.instanceColor.needsUpdate = true;
}
