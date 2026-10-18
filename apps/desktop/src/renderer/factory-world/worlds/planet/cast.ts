import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { AGENT_KIND, AGENT_STATE, type AgentView } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import {
  campSite,
  type PlanetLayout,
  type PlanetZone,
  type Site,
  sampleSite,
  siteInScene,
} from "./globe";
import {
  clamp,
  ease,
  flush,
  frameMatrix,
  HIDDEN,
  mix,
  rng,
  type SharedUniforms,
  seedOf,
  tangentBasis,
} from "./kit";
import type { Particles } from "./particles";

/**
 * cast.ts -- the agents at work: an astronaut, or a rover for a refactor, beside the rig it builds, a scaffold as tall as its pull request is large.
 *
 * Each agent stands in its primary zone beside its rig: scaffold floors
 * around a core block glowing the building colour, a beacon on top, a crane
 * for new work and a ring sliding up and down for a refactor. Its state is
 * its pose, so a still frame says it as well as a moving one:
 *
 *   - working: the astronaut swings its hammer at the rig, walks round it,
 *     and hops by jetpack to the other zones its pull request touches; a
 *     rover circles its rig.
 *   - waiting on the developer: it stands at the rig with an arm raised.
 *   - stuck: it sits beside a half-built rig gone dim.
 *   - failed: it sits beside a rig burning the defect colour.
 *   - idle: it sits beside a grey rig, done.
 *
 * Every part of every agent is an instanced mesh allocated at the contract's
 * bound, so a hundred agents cost the same draw calls as one. What is
 * selected or hovered stands on a ring of the selection's colour, and two
 * invisible proxies per agent, its rig and itself, are what picking meets.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_AGENTS;

/** The most scaffold floors one rig has. */
const MAX_FLOORS = 10;

/** An astronaut's and a rover's size, against their unit-scaled parts. */
const ASTRONAUT_SCALE = 0.22;
const ROVER_SCALE = 0.25;

const IDLE_TONE = new Color(0x8b97a8);
const SCAFFOLD_TONE = new Color(0xc9d0dc);
const SCAFFOLD_DIM = new Color(0x5d6470);

/** What an agent is doing at one instant of its plan. */
const MOTION = {
  WORK: "work",
  WALK: "walk",
  HOP: "hop",
  SIT: "sit",
  WAVE: "wave",
  DRIVE: "drive",
} as const;

type Motion = (typeof MOTION)[keyof typeof MOTION];

/** One step of a working astronaut's loop. */
type Step =
  | {
      readonly motion: typeof MOTION.WORK;
      readonly site: number;
      readonly angle: number;
      readonly seconds: number;
    }
  | {
      readonly motion: typeof MOTION.WALK;
      readonly site: number;
      readonly from: number;
      readonly to: number;
      readonly seconds: number;
    }
  | {
      readonly motion: typeof MOTION.HOP;
      readonly from: number;
      readonly to: number;
      readonly fromAngle: number;
      readonly toAngle: number;
      readonly seconds: number;
    };

/** One agent as drawn. */
interface Actor {
  readonly agent: AgentView;
  readonly rover: boolean;
  /** Its slot among the astronauts or the rovers. */
  readonly body: number;
  readonly crane: number | undefined;
  readonly ring: number | undefined;
  readonly firstFloor: number;
  readonly floors: number;
  readonly height: number;
  readonly width: number;
  readonly sites: readonly Site[];
  readonly plan: readonly Step[];
  readonly cycle: number;
  readonly phase: number;
  readonly seed: number;
  readonly tone: Color;
  /** How chosen it reads, eased toward `chosen` while motion runs. */
  lift: number;
  chosen: boolean;
  cheerUntil: number;
  struck: boolean;
}

/** Where an actor stands and faces at one instant, and how. */
interface Pose {
  readonly position: Vector3;
  readonly up: Vector3;
  readonly forward: Vector3;
  readonly motion: Motion;
  readonly progress: number;
}

const capsule = (radius: number, length: number) => new CapsuleGeometry(radius, length, 4, 10);

function scaffoldGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const [x, z] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    parts.push(new BoxGeometry(0.07, 1, 0.07).translate(x * 0.465, 0.5, z * 0.465));
  }
  parts.push(
    new BoxGeometry(1, 0.06, 0.06).translate(0, 0.97, -0.465),
    new BoxGeometry(1, 0.06, 0.06).translate(0, 0.97, 0.465),
    new BoxGeometry(0.06, 0.06, 1).translate(-0.465, 0.97, 0),
    new BoxGeometry(0.06, 0.06, 1).translate(0.465, 0.97, 0),
    new BoxGeometry(0.04, 1.3, 0.04).rotateZ(Math.atan2(0.93, 0.93)).translate(0, 0.5, 0.465),
    new BoxGeometry(0.04, 1.3, 0.04).rotateX(Math.atan2(0.93, 0.93)).translate(0.465, 0.5, 0),
  );
  return mergeGeometries(parts);
}

/** Every part's geometry: an astronaut's parts are unit-scaled, standing on y = 0 and facing +z. */
function castGeometry() {
  return {
    body: mergeGeometries([
      new SphereGeometry(0.21, 20, 14).translate(0, 0.9, 0),
      capsule(0.16, 0.12).scale(1, 1, 0.82).translate(0, 0.58, 0),
    ]),
    visor: new SphereGeometry(0.15, 18, 12).scale(1.05, 0.78, 0.7),
    pack: new BoxGeometry(0.26, 0.3, 0.13),
    arm: capsule(0.062, 0.2),
    leg: capsule(0.082, 0.2),
    tool: mergeGeometries([
      new CylinderGeometry(0.018, 0.018, 0.3, 6).translate(0, -0.12, 0),
      new BoxGeometry(0.16, 0.07, 0.07).translate(0, -0.28, 0),
    ]),
    chassis: new BoxGeometry(0.6, 0.22, 0.88),
    cab: new BoxGeometry(0.42, 0.22, 0.42),
    wheel: new CylinderGeometry(0.17, 0.17, 0.12, 14).rotateZ(Math.PI / 2),
    mast: mergeGeometries([
      new CylinderGeometry(0.02, 0.02, 0.36, 6).translate(0, 0.18, 0),
      new SphereGeometry(0.11, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4)
        .rotateX(Math.PI * 0.75)
        .translate(0, 0.38, 0),
    ]),
    blade: new BoxGeometry(0.78, 0.24, 0.06),
    floor: scaffoldGeometry(),
    core: new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
    jib: mergeGeometries([
      new BoxGeometry(1, 0.05, 0.05).translate(0.35, 0, 0),
      new BoxGeometry(0.16, 0.1, 0.1).translate(-0.2, 0, 0),
    ]),
    cable: new BoxGeometry(0.008, 1, 0.008).translate(0, -0.5, 0),
    load: new BoxGeometry(0.1, 0.07, 0.1),
    slider: new TorusGeometry(0.75, 0.05, 6, 28).rotateX(Math.PI / 2),
    beacon: new SphereGeometry(0.035, 10, 8),
    pad: new RingGeometry(0.92, 1, 40).rotateX(-Math.PI / 2),
    chosen: new RingGeometry(0.3, 0.36, 48).rotateX(-Math.PI / 2),
    proxy: new CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
  };
}

/** The core block's material: the building colour, banded like floors going up. */
function coreMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.25,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vStripe; varying vec3 vIC;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvStripe = position.y * length(instanceMatrix[1].xyz) * 14.0; vIC = instanceColor;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vStripe; varying vec3 vIC;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\nfloat st = smoothstep(0.35, 0.5, abs(fract(vStripe) - 0.5));\ntotalEmissiveRadiance += vIC * (0.25 + 0.9 * st);",
      );
  };
  return material;
}

function materials() {
  return {
    suit: new MeshStandardMaterial({
      color: 0xf2f3f6,
      roughness: 0.55,
      emissive: 0x3a4660,
      emissiveIntensity: 0.55,
    }),
    visor: new MeshStandardMaterial({
      color: 0xffc35a,
      metalness: 1,
      roughness: 0.12,
      emissive: 0x4a2a00,
      emissiveIntensity: 0.5,
    }),
    tinted: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 }),
    dark: new MeshStandardMaterial({ color: 0x2c3038, roughness: 0.6, metalness: 0.5 }),
    scaffold: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.55 }),
    glow: new MeshBasicMaterial({ color: 0xffffff }),
    pad: new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
    core: coreMaterial(),
    hidden: new MeshBasicMaterial({ visible: false }),
  };
}

function instanced(
  geometry: BufferGeometry,
  material: Material,
  count: number,
  shadow = true,
): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = shadow;
  mesh.receiveShadow = shadow;
  mesh.count = 0;
  return mesh;
}

/**
 * A working astronaut's loop: work, stroll round the rig, work, hop to each
 * other zone it touches and back to where it left, and stroll back to where
 * it began, so every step starts where the one before it ended.
 */
function planOf(sites: number, draw: () => number): Step[] {
  const start = draw() * Math.PI * 2;
  const across = start + 1.4 + draw() * 2;
  const plan: Step[] = [
    { motion: MOTION.WORK, site: 0, angle: start, seconds: 8 + draw() * 6 },
    { motion: MOTION.WALK, site: 0, from: start, to: across, seconds: 2.6 },
    { motion: MOTION.WORK, site: 0, angle: across, seconds: 7 + draw() * 5 },
  ];
  for (let site = 1; site < sites; site += 1) {
    const there = draw() * Math.PI * 2;
    plan.push(
      { motion: MOTION.HOP, from: 0, to: site, fromAngle: across, toAngle: there, seconds: 3.6 },
      { motion: MOTION.WORK, site, angle: there, seconds: 6 + draw() * 3 },
      { motion: MOTION.HOP, from: site, to: 0, fromAngle: there, toAngle: across, seconds: 3.6 },
    );
  }
  plan.push({ motion: MOTION.WALK, site: 0, from: across, to: start + Math.PI * 2, seconds: 3.2 });
  return plan;
}

function toneOf(agent: AgentView, building: Color, defect: Color): Color {
  if (agent.state === AGENT_STATE.FAILED) return defect;
  if (agent.state === AGENT_STATE.IDLE) return IDLE_TONE;
  return building;
}

const scratch = { position: new Vector3() };

/** A point `radius` out from `site`, `angle` round it, in the scene at `t`. */
function around(site: Site, t: number, angle: number, radius: number) {
  const position = new Vector3();
  const up = new Vector3();
  siteInScene(site, t, position, up);
  const [first, second] = tangentBasis(up);
  const offset = first
    .multiplyScalar(Math.cos(angle) * radius)
    .add(second.multiplyScalar(Math.sin(angle) * radius));
  return { position: position.clone().add(offset), up, centre: position, offset };
}

function bezier(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number): Vector3 {
  const u = 1 - t;
  return p0
    .clone()
    .multiplyScalar(u * u * u)
    .addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t)
    .addScaledVector(p3, t * t * t);
}

/** Where `actor` stands at `t`, and what it is doing. */
function poseOf(actor: Actor, t: number, still: boolean): Pose {
  const reach = actor.width * 0.5 + 0.17;
  const first = actor.sites[0];
  if (first === undefined) throw new Error("an actor stands at one site at least");
  const working = actor.agent.state === AGENT_STATE.WORKING;
  if (actor.rover) {
    const turn = working && !still ? t : 0;
    const angle = actor.phase + turn * 0.32 + 0.5 * Math.sin(turn * 0.25 + actor.seed * 9);
    const at = around(first, t, angle, actor.width * 0.5 + 0.3);
    const [one, two] = tangentBasis(at.up);
    const forward = one
      .multiplyScalar(-Math.sin(angle))
      .add(two.multiplyScalar(Math.cos(angle)))
      .normalize();
    return { position: at.position, up: at.up, forward, motion: MOTION.DRIVE, progress: 0 };
  }
  if (!working) {
    const waiting = actor.agent.state === AGENT_STATE.WAITING;
    const at = around(first, t, actor.phase, actor.width * 0.5 + (waiting ? 0.3 : 0.2));
    const forward = at.offset.clone().normalize();
    return {
      position: at.position,
      up: at.up,
      forward,
      motion: waiting ? MOTION.WAVE : MOTION.SIT,
      progress: 0,
    };
  }
  let into = still ? 0.4 : (t + actor.phase) % actor.cycle;
  let step = actor.plan[0];
  for (const each of actor.plan) {
    if (into < each.seconds) {
      step = each;
      break;
    }
    into -= each.seconds;
  }
  if (step === undefined) throw new Error("a working actor has a plan");
  const progress = into / step.seconds;
  if (step.motion === MOTION.WORK) {
    const at = around(actor.sites[step.site] ?? first, t, step.angle, reach);
    return {
      position: at.position,
      up: at.up,
      forward: at.offset.clone().negate().normalize(),
      motion: MOTION.WORK,
      progress,
    };
  }
  if (step.motion === MOTION.WALK) {
    const angle = mix(step.from, step.to, ease(progress));
    const at = around(actor.sites[step.site] ?? first, t, angle, reach);
    const [one, two] = tangentBasis(at.up);
    const turning = Math.sign(step.to - step.from) || 1;
    const forward = one
      .multiplyScalar(-Math.sin(angle) * turning)
      .add(two.multiplyScalar(Math.cos(angle) * turning))
      .normalize();
    return { position: at.position, up: at.up, forward, motion: MOTION.WALK, progress };
  }
  const from = around(actor.sites[step.from] ?? first, t, step.fromAngle, reach);
  const to = around(actor.sites[step.to] ?? first, t, step.toAngle, reach);
  const lift = 0.8 + from.position.distanceTo(to.position) * 0.55;
  const k = ease(progress);
  const p1 = from.position.clone().addScaledVector(from.up, lift);
  const p2 = to.position.clone().addScaledVector(to.up, lift);
  const position = bezier(from.position, p1, p2, to.position, k);
  const ahead = bezier(from.position, p1, p2, to.position, Math.min(k + 0.02, 1));
  const up = from.up.clone().lerp(to.up, k).normalize();
  let forward = ahead.sub(position);
  forward.addScaledVector(up, -forward.dot(up));
  forward = forward.lengthSq() < 1e-8 ? tangentBasis(up)[0] : forward.normalize();
  return { position, up, forward, motion: MOTION.HOP, progress };
}

/** The agents, cast with each change of who is at work and placed on every frame. */
export interface Cast {
  readonly objects: readonly Object3D[];
  /** Casts the drawn agents: each at its primary zone, apart from what `taken` already holds there. */
  readonly cast: (
    layout: PlanetLayout,
    agents: readonly AgentView[],
    taken: Map<PlanetZone, Vector3[]>,
  ) => void;
  /** Marks the agents chosen, by id. */
  readonly choose: (chosen: (agent: AgentView) => boolean) => void;
  /** Sets every agent where it stands at `t`, `delta` after the last; a still frame throws nothing. */
  readonly place: (t: number, delta: number, still: boolean) => void;
  /** Has every agent building in `zone` cheer until `until`. */
  readonly cheer: (zone: string, until: number) => void;
}

export function createCast(
  shared: SharedUniforms,
  picking: WorldPicking,
  particles: Particles,
): Cast {
  const geometry = castGeometry();
  const material = materials();
  const parts = {
    body: instanced(geometry.body, material.suit, MAX),
    visor: instanced(geometry.visor, material.visor, MAX),
    pack: instanced(geometry.pack, material.tinted, MAX),
    arm: instanced(geometry.arm, material.suit, MAX * 2),
    leg: instanced(geometry.leg, material.suit, MAX * 2),
    tool: instanced(geometry.tool, material.dark, MAX),
    chassis: instanced(geometry.chassis, material.tinted, MAX),
    cab: instanced(geometry.cab, material.suit, MAX),
    wheel: instanced(geometry.wheel, material.dark, MAX * 4),
    mast: instanced(geometry.mast, material.suit, MAX),
    blade: instanced(geometry.blade, material.dark, MAX),
    floor: instanced(geometry.floor, material.scaffold, MAX * MAX_FLOORS),
    core: instanced(geometry.core, material.core, MAX),
    jib: instanced(geometry.jib, material.scaffold, MAX),
    cable: instanced(geometry.cable, material.dark, MAX, false),
    load: instanced(geometry.load, material.tinted, MAX),
    slider: instanced(geometry.slider, material.glow, MAX, false),
    beacon: instanced(geometry.beacon, material.glow, MAX, false),
    pad: instanced(geometry.pad, material.pad, MAX, false),
    chosen: instanced(geometry.chosen, material.pad, MAX, false),
  };
  const proxies = instanced(geometry.proxy, material.hidden, MAX * 2, false);
  let actors: Actor[] = [];
  let targets: PickTarget[] = [];
  picking.addInstances(proxies, (instance) => targets[instance % Math.max(1, actors.length)]);
  const building = shared.uBuilding.value;
  const defect = shared.uDefect.value;
  const chosenTone = shared.uChosen.value;
  const tint = new Color();
  const frame = new Matrix4();
  const piece = new Matrix4();
  const rotation = new Matrix4();
  const pivot = new Matrix4();
  const stretch = new Matrix4();
  const turn = new Euler();
  const top = new Vector3();
  const velocity = new Vector3();

  /** One part of a body: `frame` moved to (`x`, `y`, `z`), turned, swung about a pivot `pivotY` below, and scaled. */
  const part = (
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    pivotY = 0,
    sx = 1,
    sy = 1,
    sz = 1,
  ) =>
    piece
      .copy(frame)
      .multiply(stretch.makeTranslation(x, y, z))
      .multiply(rotation.makeRotationFromEuler(turn.set(rx, ry, rz)))
      .multiply(pivot.makeTranslation(0, pivotY, 0))
      .multiply(stretch.makeScale(sx, sy, sz));

  const cast: Cast["cast"] = (layout, agents, taken) => {
    let astronauts = 0;
    let rovers = 0;
    let floors = 0;
    let cranes = 0;
    let sliders = 0;
    actors = [];
    const camp: Vector3[] = [];
    for (const agent of agents) {
      const zone = agent.primaryZone === null ? undefined : layout.byPath.get(agent.primaryZone);
      const draw = rng(seedOf(agent.id));
      const rover = agent.kind === AGENT_KIND.REFACTOR;
      const height = 0.2 + 1.2 * agent.buildSize ** 2.5;
      const width = 0.15 + 0.126 * agent.buildSize;
      const sites = [
        zone === undefined
          ? campSite(draw, camp)
          : sampleSite(layout, zone, draw, taken, { apart: 0.62, spread: 0.72 }),
      ];
      for (const touched of agent.touched.slice(1)) {
        const there = layout.byPath.get(touched.path);
        if (
          rover ||
          sites.length >= 3 ||
          touched.weight <= 0.12 ||
          there === undefined ||
          there === zone
        )
          continue;
        sites.push(sampleSite(layout, there, draw, taken, { apart: 0.4, spread: 0.7 }));
      }
      const plan = planOf(sites.length, draw);
      const count = clamp(Math.round(height / (width * 0.72)), 2, MAX_FLOORS);
      const crane = !rover && agent.kind !== AGENT_KIND.FIX ? cranes++ : undefined;
      actors.push({
        agent,
        rover,
        body: rover ? rovers++ : astronauts++,
        crane,
        ring: rover ? sliders++ : undefined,
        firstFloor: floors,
        floors: count,
        height,
        width,
        sites,
        plan,
        cycle: plan.reduce((sum, step) => sum + step.seconds, 0),
        phase: draw() * 100,
        seed: draw(),
        tone: toneOf(agent, building, defect),
        lift: 0,
        chosen: false,
        cheerUntil: 0,
        struck: false,
      });
      floors += count;
    }
    targets = actors.map((actor) => ({ kind: PICK_KIND.AGENT, id: actor.agent.id }));
    for (const name of ["body", "visor", "pack", "tool"] as const) parts[name].count = astronauts;
    for (const name of ["chassis", "cab", "mast", "blade"] as const) parts[name].count = rovers;
    parts.arm.count = astronauts * 2;
    parts.leg.count = astronauts * 2;
    parts.wheel.count = rovers * 4;
    parts.floor.count = floors;
    parts.jib.count = cranes;
    parts.cable.count = cranes;
    parts.load.count = cranes;
    parts.slider.count = sliders;
    for (const name of ["core", "beacon", "pad"] as const) parts[name].count = actors.length;
    proxies.count = actors.length * 2;
    paint();
  };

  const paint = () => {
    actors.forEach((actor, index) => {
      const dim = actor.agent.state === AGENT_STATE.IDLE || actor.agent.state === AGENT_STATE.STUCK;
      if (actor.rover) parts.chassis.setColorAt(actor.body, actor.tone);
      else parts.pack.setColorAt(actor.body, actor.tone);
      for (let floor = 0; floor < actor.floors; floor += 1) {
        parts.floor.setColorAt(actor.firstFloor + floor, dim ? SCAFFOLD_DIM : SCAFFOLD_TONE);
      }
      parts.core.setColorAt(index, tint.copy(actor.tone).multiplyScalar(dim ? 0.15 : 0.55));
      parts.beacon.setColorAt(
        index,
        tint.copy(actor.chosen ? chosenTone : actor.tone).multiplyScalar(dim ? 0.5 : 3.2),
      );
      parts.pad.setColorAt(
        index,
        tint
          .copy(actor.chosen ? chosenTone : actor.tone)
          .multiplyScalar(actor.chosen ? 1.2 : dim ? 0.15 : 0.5),
      );
      parts.chosen.setColorAt(index, tint.copy(chosenTone).multiplyScalar(actor.chosen ? 2.5 : 0));
      if (actor.crane !== undefined) {
        parts.jib.setColorAt(actor.crane, dim ? SCAFFOLD_DIM : SCAFFOLD_TONE);
        parts.load.setColorAt(actor.crane, actor.tone);
      }
      if (actor.ring !== undefined)
        parts.slider.setColorAt(actor.ring, tint.copy(actor.tone).multiplyScalar(1.5));
    });
    for (const mesh of Object.values(parts)) flush(mesh);
  };

  const placeRig = (actor: Actor, index: number, t: number, still: boolean) => {
    const site = actor.sites[0];
    if (site === undefined) return;
    const position = new Vector3();
    const up = new Vector3();
    siteInScene(site, t, position, up);
    const forward = tangentBasis(up)[0];
    const motion = still ? 0 : t;
    const stuck = actor.agent.state === AGENT_STATE.STUCK || actor.agent.state === AGENT_STATE.IDLE;
    const height = actor.height * (1 + 0.06 * actor.lift);
    const floorHeight = height / actor.floors;
    for (let floor = 0; floor < actor.floors; floor += 1) {
      frameMatrix(
        frame,
        scratch.position.copy(position).addScaledVector(up, floor * floorHeight - 0.01),
        up,
        forward,
        1,
      );
      parts.floor.setMatrixAt(
        actor.firstFloor + floor,
        frame.multiply(stretch.makeScale(actor.width, floorHeight, actor.width)),
      );
    }
    const progress = stuck
      ? 0.45
      : 0.62 + 0.3 * (0.5 + 0.5 * Math.sin(motion * 0.07 + actor.seed * 20));
    frameMatrix(frame, scratch.position.copy(position).addScaledVector(up, -0.01), up, forward, 1);
    parts.core.setMatrixAt(
      index,
      frame.multiply(
        stretch.makeScale(
          actor.width * 0.74,
          Math.max(height * progress, 0.001),
          actor.width * 0.74,
        ),
      ),
    );
    top.copy(position).addScaledVector(up, height + 0.05);
    const blink = still
      ? 1
      : 0.8 + 0.7 * Math.max(0, Math.sin(motion * 2.6 + actor.seed * 30)) ** 10;
    frameMatrix(
      frame,
      top,
      up,
      forward,
      (stuck ? 0.8 : blink) * (1 + actor.agent.buildSize * 0.5) * (1 + actor.lift * 1.2),
    );
    parts.beacon.setMatrixAt(index, frame);
    frameMatrix(
      frame,
      scratch.position.copy(position).addScaledVector(up, 0.012),
      up,
      forward,
      actor.width * 0.5 + 0.34,
    );
    parts.pad.setMatrixAt(index, frame);
    const idleMotion = stuck ? actor.seed * 50 : motion;
    if (actor.crane !== undefined)
      placeCrane(actor, actor.crane, position, up, forward, height, idleMotion);
    if (actor.ring !== undefined) {
      const y = height * (0.5 + 0.42 * Math.sin(idleMotion * 0.6 + actor.seed * 13));
      frameMatrix(
        frame,
        scratch.position.copy(position).addScaledVector(up, y),
        up,
        forward.clone().applyAxisAngle(up, idleMotion * 1.5),
        actor.width,
      );
      parts.slider.setMatrixAt(actor.ring, frame);
    }
    frameMatrix(frame, position, up, forward, 1);
    const girth = Math.max(actor.width, 0.5);
    proxies.setMatrixAt(index, frame.multiply(stretch.makeScale(girth, height + 0.45, girth)));
  };

  const placeCrane = (
    actor: Actor,
    crane: number,
    position: Vector3,
    up: Vector3,
    forward: Vector3,
    height: number,
    motion: number,
  ) => {
    const yaw = Math.sin(motion * 0.22 + actor.seed * 7) * 1.4;
    const length = actor.width * 3.2;
    const facing = forward.clone().applyAxisAngle(up, yaw);
    const mount = position.clone().addScaledVector(up, height + 0.02);
    frameMatrix(frame, mount, up, facing, 1);
    parts.jib.setMatrixAt(
      crane,
      frame.multiply(rotation.makeRotationY(Math.PI / 2)).multiply(stretch.makeScale(length, 1, 1)),
    );
    const tip = mount
      .clone()
      .addScaledVector(new Vector3().crossVectors(up, facing).normalize(), -length * 0.82);
    const drop = (0.25 + 0.6 * (0.5 + 0.5 * Math.sin(motion * 0.5 + actor.seed * 11))) * height;
    frameMatrix(frame, tip, up, facing, 1);
    parts.cable.setMatrixAt(crane, frame.multiply(stretch.makeScale(1, drop, 1)));
    frameMatrix(frame, tip.addScaledVector(up, -drop - 0.035), up, facing, 0.8 + actor.width * 2);
    parts.load.setMatrixAt(crane, frame);
  };

  const placeRover = (actor: Actor, pose: Pose, t: number, delta: number, still: boolean) => {
    const working = actor.agent.state === AGENT_STATE.WORKING && !still;
    const cheering = t < actor.cheerUntil;
    const bob =
      (working ? Math.abs(Math.sin(t * 9 + actor.seed * 10)) * 0.012 : 0) +
      (cheering ? Math.abs(Math.sin(t * 10)) * 0.08 : 0);
    frameMatrix(
      frame,
      scratch.position.copy(pose.position).addScaledVector(pose.up, bob),
      pose.up,
      pose.forward,
      ROVER_SCALE * (1 + actor.lift * 0.2),
    );
    const slot = actor.body;
    parts.chassis.setMatrixAt(slot, part(0, 0.3, 0, 0, 0, 0));
    parts.cab.setMatrixAt(slot, part(0, 0.52, -0.12, 0, 0, 0));
    parts.mast.setMatrixAt(slot, part(0.16, 0.6, -0.25, 0, still ? 0.6 : t * 1.2, 0));
    parts.blade.setMatrixAt(
      slot,
      part(0, 0.2 + (still ? 0 : 0.05 * Math.sin(t * 2 + actor.seed)), 0.5, -0.25, 0, 0),
    );
    const spin = working ? t * 6 : 0;
    [
      [-0.36, 0.3],
      [0.36, 0.3],
      [-0.36, -0.3],
      [0.36, -0.3],
    ].forEach(([x = 0, z = 0], wheel) => {
      parts.wheel.setMatrixAt(slot * 4 + wheel, part(x, 0.17, z, spin, 0, 0));
    });
    if (working && particles.draw() < delta * 3) {
      particles.emit(
        scratch.position.copy(pose.position).addScaledVector(pose.forward, 0.1),
        velocity.copy(pose.up).multiplyScalar(0.06).addScaledVector(pose.forward, 0.04),
        0.9,
        0.05,
        [0.25, 0.22, 0.2],
        2.5,
      );
    }
  };

  /** The astronaut's limbs for `pose` at `t`: arms, legs, its bob and its lean, and whether its hammer lands now. */
  const limbsOf = (actor: Actor, pose: Pose, t: number, delta: number, still: boolean) => {
    const limbs = {
      armRight: 0,
      armLeft: 0,
      legRight: 0,
      legLeft: 0,
      bob: 0,
      lean: 0,
      strike: false,
    };
    if (pose.motion === MOTION.WORK) {
      if (actor.agent.kind === AGENT_KIND.FIX) {
        Object.assign(limbs, {
          armRight: -1.45 + (still ? 0 : Math.sin(t * 23) * 0.05),
          armLeft: -0.9,
          lean: 0.12,
          strike: particles.draw() < delta * 22,
        });
      } else {
        const swing = still ? 0.6 : (t * 1.5 + actor.seed * 5) % 1;
        limbs.armRight =
          swing < 0.72
            ? mix(-0.6, -2.7, ease(swing / 0.72))
            : mix(-2.7, -0.6, ((swing - 0.72) / 0.28) ** 2);
        limbs.armLeft = -0.35;
        limbs.lean = swing > 0.72 ? 0.18 : 0.04;
        limbs.strike = swing > 0.96 && !actor.struck;
        actor.struck = swing > 0.96 || (actor.struck && swing >= 0.9);
      }
      limbs.bob = still ? 0 : Math.sin(t * 3 + actor.seed) * 0.008;
    } else if (pose.motion === MOTION.WALK) {
      const stride = Math.sin(t * 8 + actor.seed * 4);
      Object.assign(limbs, {
        legRight: stride * 0.6,
        legLeft: -stride * 0.6,
        armRight: -stride * 0.5,
        armLeft: stride * 0.5,
        bob: Math.abs(stride) * 0.05,
      });
    } else if (pose.motion === MOTION.SIT) {
      Object.assign(limbs, {
        legRight: -1.45,
        legLeft: -1.3,
        armRight: -0.3,
        armLeft: -0.2,
        bob: -0.075 + (still ? 0 : Math.sin(t * 1.3 + actor.seed * 9) * 0.004),
        lean: -0.15,
      });
    } else if (pose.motion === MOTION.WAVE) {
      Object.assign(limbs, {
        armLeft: -2.7 + (still ? 0 : Math.sin(t * 6 + actor.seed) * 0.35),
        armRight: -0.2,
      });
    } else {
      Object.assign(limbs, {
        legRight: 0.35,
        legLeft: 0.25,
        armRight: 0.5,
        armLeft: 0.5,
        lean: 0.25,
      });
    }
    if (t < actor.cheerUntil && pose.motion !== MOTION.HOP) {
      const leap = Math.abs(Math.sin(t * 9 + actor.seed));
      Object.assign(limbs, {
        bob: leap * 0.1,
        armRight: -2.9 + leap * 0.3,
        armLeft: -2.9 + leap * 0.3,
        legRight: 0,
        legLeft: 0,
        lean: 0,
        strike: false,
      });
    } else if (actor.lift > 0.5 && pose.motion !== MOTION.HOP && pose.motion !== MOTION.SIT) {
      limbs.armLeft = -2.7 + (still ? 0 : Math.sin(t * 12) * 0.35);
    }
    return limbs;
  };

  const placeAstronaut = (actor: Actor, pose: Pose, t: number, delta: number, still: boolean) => {
    const limbs = limbsOf(actor, pose, t, delta, still);
    frameMatrix(
      frame,
      scratch.position.copy(pose.position).addScaledVector(pose.up, limbs.bob),
      pose.up,
      pose.forward,
      ASTRONAUT_SCALE * (1 + actor.lift * 0.25),
    );
    frame.multiply(rotation.makeRotationX(limbs.lean));
    const slot = actor.body;
    parts.leg.setMatrixAt(slot * 2, part(0.09, 0.4, 0, limbs.legRight, 0, 0, -0.19));
    parts.leg.setMatrixAt(slot * 2 + 1, part(-0.09, 0.4, 0, limbs.legLeft, 0, 0, -0.19));
    parts.body.setMatrixAt(slot, part(0, 0, 0, 0, 0, 0));
    parts.pack.setMatrixAt(slot, part(0, 0.6, -0.17, 0, 0, 0));
    parts.visor.setMatrixAt(slot, part(0, 0.91, 0.09, 0, 0, 0));
    parts.arm.setMatrixAt(slot * 2, part(-0.22, 0.7, 0.02, limbs.armRight, 0, 0.12, -0.15));
    parts.arm.setMatrixAt(slot * 2 + 1, part(0.22, 0.7, 0.02, limbs.armLeft, 0, -0.12, -0.15));
    parts.tool.setMatrixAt(slot, part(-0.22, 0.7, 0.02, limbs.armRight, 0, 0.12, -0.28));
    if (still) return;
    if (limbs.strike) {
      const spark = pose.position
        .clone()
        .addScaledVector(pose.up, 0.07)
        .addScaledVector(pose.forward, 0.1);
      const fixing = actor.agent.kind === AGENT_KIND.FIX;
      for (let flake = 0; flake < (fixing ? 1 : 5); flake += 1) {
        velocity
          .set(particles.draw() - 0.5, particles.draw() - 0.5, particles.draw() - 0.5)
          .multiplyScalar(0.5)
          .addScaledVector(pose.up, 0.35);
        particles.emit(
          spark,
          velocity,
          0.3 + particles.draw() * 0.25,
          0.028,
          fixing ? [2.2, 2.8, 3.6] : [3, 2.9, 2.6],
        );
      }
    }
    if (pose.motion === MOTION.HOP) {
      const exhaust = pose.position
        .clone()
        .addScaledVector(pose.up, 0.08)
        .addScaledVector(pose.forward, -0.06);
      particles.emit(
        exhaust,
        velocity.copy(pose.up).multiplyScalar(-0.6).addScaledVector(pose.forward, -0.2),
        0.35,
        0.06,
        [3, 1.4, 0.4],
      );
      particles.emit(
        exhaust,
        velocity.copy(pose.up).multiplyScalar(-0.15),
        1.4,
        0.035,
        [0.35, 0.33, 0.4],
        3,
      );
    }
    if (pose.motion === MOTION.SIT && particles.draw() < delta * 0.5) {
      const smoke = actor.agent.state === AGENT_STATE.FAILED;
      particles.emit(
        pose.position.clone().addScaledVector(pose.up, 0.24),
        velocity.copy(pose.up).multiplyScalar(0.12),
        2.2,
        smoke ? 0.06 : 0.03,
        smoke ? [0.5, 0.12, 0.1] : [0.5, 0.55, 0.7],
        1.5,
      );
    }
  };

  const place: Cast["place"] = (t, delta, still) => {
    actors.forEach((actor, index) => {
      actor.lift = still
        ? actor.chosen
          ? 1
          : 0
        : mix(actor.lift, actor.chosen ? 1 : 0, Math.min(1, delta * 10));
      const pose = poseOf(actor, t, still);
      placeRig(actor, index, t, still);
      if (actor.rover) placeRover(actor, pose, t, delta, still);
      else placeAstronaut(actor, pose, t, delta, still);
      frameMatrix(frame, pose.position, pose.up, pose.forward, 1);
      proxies.setMatrixAt(
        actors.length + index,
        frame.multiply(stretch.makeScale(0.38, 0.55, 0.38)),
      );
      const ring = actor.chosen ? 1 + (still ? 0 : 0.15 * Math.sin(t * 4)) : 0;
      if (ring === 0) parts.chosen.setMatrixAt(index, HIDDEN);
      else {
        frameMatrix(
          frame,
          scratch.position.copy(pose.position).addScaledVector(pose.up, 0.01),
          pose.up,
          pose.forward,
          ring,
        );
        parts.chosen.setMatrixAt(index, frame);
      }
    });
    parts.chosen.count = actors.length;
    for (const mesh of Object.values(parts)) mesh.instanceMatrix.needsUpdate = true;
    proxies.instanceMatrix.needsUpdate = true;
  };

  return {
    objects: [...Object.values(parts), proxies],
    cast,
    choose: (chosen) => {
      for (const actor of actors) actor.chosen = chosen(actor.agent);
      paint();
    },
    place,
    cheer: (zone, until) => {
      for (const actor of actors)
        if (actor.sites[0]?.zone?.view.path === zone) actor.cheerUntil = until;
    },
  };
}
