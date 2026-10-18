import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { PICK_KIND, type PickTarget, type WorldPicking } from "@luke/panel/factory-world/world";
import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentKind,
  type AgentState,
  type AgentView,
  BUILD_FULL_LINES,
  type SIGNAL_COLOR,
} from "@luke/ui/factory-world";
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Quaternion,
  type Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLOW_SHAPE, type GlowField, type GlowShape } from "./glow";
import { between, groundY, painted, type Random, randomOf, seedOf, smooth, UP } from "./nature";
import {
  BRANCH_KIND,
  type Branch,
  bakeWalk,
  branchPoint,
  item,
  meadowBranch,
  type Skeleton,
  sampleCurve,
  surfacePoint,
  treePath,
  type Walk,
  walkAt,
} from "./skeleton";
import { type Clump, foliage, type SharedUniforms } from "./wood";

/**
 * gardeners.ts -- the agents at work: little lantern-carrying gardeners, each grafting its pull request onto the zone it builds in, the graft as long as the pull request is large.
 *
 * Each agent's mood is its state, in a pose that says it with motion held:
 *
 *   - working: hammering at its graft, and now and then walking the
 *     branches to another zone its pull request touches and back.
 *   - waiting: sitting by its graft, three dots over its head.
 *   - stuck: asleep against its graft, its lantern low, a snore bubble over it.
 *   - failed: slumped, its lantern and its graft the defect's colour.
 *   - idle: sitting by an unlit lantern, its graft quiet.
 *
 * A graft is one of three shapes by the pull request's kind: a braid bound
 * with rings for a refactor, a collared shoot for a fix, a plain shoot for
 * the rest; its length and girth read the pull request's lines back from
 * `buildSize`. The gardeners and grafts are instanced at the contract's
 * bound of agents, so a hundred cost what one does.
 */

const MAX_AGENTS = FACTORY_WORLD_BOUNDS.MAX_AGENTS;
const AGENT_SCALE = 1.25;
/** A graft's girth per unit of length, as its canonical shape is built. */
const GRAFT_GIRTH = 0.035;
const GRAFT_CURL = 0.3;
const GRAFT_LIFT = 0.45;
const SPARKS = 260;
const GLYPHS = 72;
const RINGS = 10;

const GRAFT_SHAPE = {
  PLAIN: "plain",
  BRAID: "braid",
  COLLARED: "collared",
} as const;

type GraftShape = (typeof GRAFT_SHAPE)[keyof typeof GRAFT_SHAPE];

const MOOD = {
  WORK: "work",
  WALK: "walk",
  WAIT: "wait",
  SLEEP: "sleep",
  SLUMP: "slump",
  REST: "rest",
} as const;

type Mood = (typeof MOOD)[keyof typeof MOOD];

/** The mood each state settles into. */
const MOOD_OF = {
  [AGENT_STATE.WORKING]: MOOD.WORK,
  [AGENT_STATE.WAITING]: MOOD.WAIT,
  [AGENT_STATE.STUCK]: MOOD.SLEEP,
  [AGENT_STATE.FAILED]: MOOD.SLUMP,
  [AGENT_STATE.IDLE]: MOOD.REST,
} as const satisfies Record<AgentState, Mood>;

/** How each kind of work grafts, wears its hat, and leafs: a braid for a refactor, a collar for a fix, the mockup's ambers and greens. */
const KIND_LOOK = {
  [AGENT_KIND.FEAT]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffbe45", leaf: "#b9f26a" },
  [AGENT_KIND.FIX]: { shape: GRAFT_SHAPE.COLLARED, hat: "#ff9a3c", leaf: "#b0ec70" },
  [AGENT_KIND.REFACTOR]: { shape: GRAFT_SHAPE.BRAID, hat: "#f0a858", leaf: "#a6e67a" },
  [AGENT_KIND.PERF]: { shape: GRAFT_SHAPE.BRAID, hat: "#f0a858", leaf: "#a6e67a" },
  [AGENT_KIND.DOCS]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffd98a", leaf: "#c4f47e" },
  [AGENT_KIND.TEST]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffb066", leaf: "#b9f26a" },
  [AGENT_KIND.BUILD]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffb066", leaf: "#b9f26a" },
  [AGENT_KIND.CI]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffb066", leaf: "#b9f26a" },
  [AGENT_KIND.CHORE]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffb066", leaf: "#b9f26a" },
  [AGENT_KIND.STYLE]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffb066", leaf: "#b9f26a" },
  [AGENT_KIND.REVERT]: { shape: GRAFT_SHAPE.COLLARED, hat: "#ff9a3c", leaf: "#b0ec70" },
  [AGENT_KIND.UNKNOWN]: { shape: GRAFT_SHAPE.PLAIN, hat: "#ffb066", leaf: "#b9f26a" },
} as const satisfies Record<AgentKind, { shape: GraftShape; hat: string; leaf: string }>;

const TUNICS = ["#efe2c8", "#c98f62", "#86a86f", "#7d8fc0", "#d9a3b8", "#e3c27a"].map(
  (hex) => new Color(hex),
);
const BOOTS = new Color("#5a4434");
const UNLIT = new Color("#6d655c");
const QUIET_GRAFT = new Color("#8a7650");

/** A pull request's lines, read back from its `buildSize` on the view model's log scale. */
function linesOf(buildSize: number): number {
  return Math.expm1(buildSize * Math.log1p(BUILD_FULL_LINES));
}

function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * k;
}

/* ------------------------------------------------------------------ the graft's shapes */

/** One tube's streams along a canonical curve: positions, normals, colours, its axis and its fraction along. */
function graftTube(
  points: readonly Vector3[],
  radial: number,
  radius: (t: number) => number,
  tint: Color,
  alongOf?: (t: number) => number,
): BufferGeometry {
  const samples = sampleCurve(
    new CatmullRomCurve3([...points]),
    Math.max(3, points.length > 2 ? 30 : 3),
    radius,
  );
  const position: number[] = [];
  const normal: number[] = [];
  const color: number[] = [];
  const axis: number[] = [];
  const along: number[] = [];
  const index: number[] = [];
  const n = new Vector3();
  for (const s of samples) {
    for (let j = 0; j <= radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(s.n).multiplyScalar(Math.cos(a)).addScaledVector(s.b, Math.sin(a));
      position.push(s.p.x + n.x * s.r, s.p.y + n.y * s.r, s.p.z + n.z * s.r);
      normal.push(n.x, n.y, n.z);
      color.push(tint.r, tint.g, tint.b);
      axis.push(s.p.x, s.p.y, s.p.z);
      along.push(alongOf === undefined ? s.t : alongOf(s.t));
    }
  }
  for (let i = 0; i < samples.length - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(color, 3));
  geometry.setAttribute("aAxis", new Float32BufferAttribute(axis, 3));
  geometry.setAttribute("aAlong", new Float32BufferAttribute(along, 1));
  geometry.setIndex(index);
  return geometry.toNonIndexed();
}

/** The canonical graft curve, one unit long: forward along +z, bending up (+y) and curling aside (+x). */
function graftPoint(f: number): Vector3 {
  return new Vector3(0.5 * GRAFT_CURL * f * f, GRAFT_LIFT * f * f, f);
}

function graftGeometry(shape: GraftShape): BufferGeometry {
  const points = [0, 0.25, 0.5, 0.75, 1].map(graftPoint);
  const white = new Color(1, 1, 1);
  if (shape === GRAFT_SHAPE.BRAID) {
    // Note that a refactor is two rebuilt strands braided round the line, bound with rings.
    const spine = sampleCurve(new CatmullRomCurve3(points), 30, () => 0);
    const strands = [0, 1].map((k) => {
      const twisted = spine.map((s) => {
        const a = s.t * 9 + k * Math.PI;
        return s.p
          .clone()
          .addScaledVector(s.n, Math.cos(a) * GRAFT_GIRTH * 0.7)
          .addScaledVector(s.b, Math.sin(a) * GRAFT_GIRTH * 0.7);
      });
      const strand = graftTube(twisted, 6, (t) => GRAFT_GIRTH * 0.62 * (1 - 0.6 * t), white);
      // Note that a strand's axis is the braid's spine, so its girth scales about the line it twists round.
      const axis = strand.getAttribute("aAxis");
      const along = strand.getAttribute("aAlong");
      for (let index = 0; index < axis.count; index += 1) {
        const at = item(spine, Math.round(along.getX(index) * 29)).p;
        axis.setXYZ(index, at.x, at.y, at.z);
      }
      return strand;
    });
    const rings = [1, 2, 3, 4].map((k) => {
      const t = k / 5;
      const at = item(spine, Math.round(t * 29));
      const reach = GRAFT_GIRTH * 0.4;
      return graftTube(
        [at.p.clone().addScaledVector(at.tan, -reach), at.p.clone().addScaledVector(at.tan, reach)],
        8,
        () => GRAFT_GIRTH * 1.35 * (1 - 0.5 * t),
        new Color("#e9d6a8").multiplyScalar(1.6),
        () => t,
      );
    });
    return mergeOrThrow([...strands, ...rings]);
  }
  const shoot = graftTube(points, 7, (t) => GRAFT_GIRTH * (1 - 0.7 * t), white);
  if (shape === GRAFT_SHAPE.PLAIN) return shoot;
  const spine = sampleCurve(new CatmullRomCurve3(points), 30, () => 0);
  const collar = graftTube(
    [item(spine, 0).p.clone().addScaledVector(item(spine, 0).tan, -0.02), item(spine, 4).p.clone()],
    9,
    () => GRAFT_GIRTH * 2.6,
    new Color("#f2e6cf").multiplyScalar(1.6),
    () => 0,
  );
  return mergeOrThrow([shoot, collar]);
}

function mergeOrThrow(geometries: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(geometries);
  if (merged === null) throw new Error("tree: a graft's parts would not merge");
  return merged;
}

/** A graft's wood: its girth scaled about its axis per instance, glowing the building signal in pulses running out along it. */
function graftMaterial(shared: SharedUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 aAxis; attribute float aAlong; attribute float aThick; attribute vec3 aGlow; attribute float aPulse; attribute float aSeed;
        varying float vAlong; varying vec3 vGlow; varying float vPulse; varying float vSeed;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed = aAxis + (transformed - aAxis) * aThick;
        vAlong = aAlong; vGlow = aGlow; vPulse = aPulse; vSeed = aSeed;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime; varying float vAlong; varying vec3 vGlow; varying float vPulse; varying float vSeed;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float pulse = pow(fract(vAlong * 1.5 - uTime * 0.5 + vSeed), 6.0);
        totalEmissiveRadiance += vGlow * (0.18 + 1.1 * pulse * vPulse);`,
      );
  };
  material.customProgramCacheKey = () => "tree-graft";
  return material;
}

/** One shape's instanced grafts, with their per-instance girth, glow, pulse, and seed. */
interface GraftMesh {
  readonly mesh: InstancedMesh;
  readonly thick: InstancedBufferAttribute;
  readonly glow: InstancedBufferAttribute;
  readonly pulse: InstancedBufferAttribute;
  readonly seed: InstancedBufferAttribute;
  targets: PickTarget[];
}

function graftMesh(shape: GraftShape, material: MeshStandardMaterial): GraftMesh {
  const mesh = new InstancedMesh(graftGeometry(shape), material, MAX_AGENTS);
  const attribute = (size: number) =>
    new InstancedBufferAttribute(new Float32Array(MAX_AGENTS * size), size).setUsage(
      DynamicDrawUsage,
    );
  const graft: GraftMesh = {
    mesh,
    thick: attribute(1),
    glow: attribute(3),
    pulse: attribute(1),
    seed: attribute(1),
    targets: [],
  };
  mesh.geometry.setAttribute("aThick", graft.thick);
  mesh.geometry.setAttribute("aGlow", graft.glow);
  mesh.geometry.setAttribute("aPulse", graft.pulse);
  mesh.geometry.setAttribute("aSeed", graft.seed);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0;
  return graft;
}

/* ------------------------------------------------------------------ the gardeners */

/** Where on the tree a gardener stands: a branch, how far along, and how far round its bark. */
interface Spot {
  readonly branch: Branch;
  readonly t: number;
  readonly angle: number;
}

/** One gardener as planned from its agent: where it lives, where it may walk, and its graft. */
interface Gardener {
  readonly view: AgentView;
  readonly index: number;
  readonly mood: Mood;
  readonly home: Spot;
  /** Where it stands to work, beside its graft. */
  readonly homeSpot: Spot;
  /** The other zones its pull request touches, as spots to walk to. */
  readonly others: readonly Spot[];
  readonly graft:
    | { readonly shape: GraftShape; readonly matrix: Matrix4; readonly length: number }
    | undefined;
  readonly random: Random;
  readonly tunic: Color;
  readonly hat: Color;
  readonly phase: number;
  readonly speed: number;
  /** Its motion, stepped each frame. */
  motion: {
    mode: Mood;
    at: Spot;
    timer: number;
    workFor: number;
    walk: Walk | undefined;
    s: number;
    dest: Spot;
    fromAngle: number;
    toAngle: number;
    pos: Vector3;
    yaw: number;
    face: number;
    hop: number;
    scale: number;
    swing: number;
    glyphIn: number;
  };
}

/** What a gardener stands on, drawn: its position on its spot and the way it faces. */
function standOn(spot: Spot, out: Vector3, heading: Vector3): void {
  const at = surfacePoint(spot.branch, spot.t, spot.angle, 0);
  out.copy(at.p);
  heading.copy(at.at.tan);
}

/** The meadow under `t` along a ground path. */
function meadowSpot(branch: Branch, t: number): Vector3 {
  const p = branchPoint(branch, t).p;
  p.y = groundY(p.x, p.z);
  return p;
}

/** The spot beside the graft at home, or a spot to work at on another zone's branch. */
function spotOn(branch: Branch, random: Random, home: Spot | undefined): Spot {
  if (home !== undefined && branch === home.branch) {
    return {
      branch,
      t: Math.min(0.99, Math.max(0.01, home.t - 0.35 / Math.max(branch.len, 1))),
      angle: home.angle * 0.7,
    };
  }
  if (branch.kind === BRANCH_KIND.GROUND)
    return { branch, t: between(random, 0.8, 0.97), angle: 0 };
  const lo =
    branch.kind === BRANCH_KIND.ROOT
      ? 0.12
      : branch.kind === BRANCH_KIND.LIMB
        ? Math.max(branch.tPeel + 0.05, 0.3)
        : 0.2;
  return { branch, t: between(random, lo, 0.75), angle: between(random, -0.8, 0.8) };
}

/** A sign rising over a gardener's head: a snore bubble or a wait's dots. */
interface Glyph {
  life: number;
  readonly p: Vector3;
  readonly v: Vector3;
  shape: GlowShape;
}

/** The scene's gardeners, re-planned on `plan` and drawn on `pose`. */
export interface Gardeners {
  /** Plans every agent drawn, in order, against the tree as grown. */
  readonly plan: (agents: readonly AgentView[], skeleton: Skeleton) => void;
  /** Colours every gardener and graft for the selection and the hover, and the layers. */
  readonly paint: (chosen: (agent: AgentView) => number) => void;
  /** Steps every gardener `dt` seconds to `t`; with `still`, lays each in its pose at home and spawns nothing. */
  readonly pose: (dt: number, t: number, still: boolean) => void;
  /** Rings the agent at `id` as it is chosen. */
  readonly ring: (id: string) => void;
  /** Has every gardener whose work touches `zonePath` hop for a merge landing there. */
  readonly cheer: (zonePath: string) => void;
}

export function gardeners(
  scene: Scene,
  camera: PerspectiveCamera,
  shared: SharedUniforms,
  picking: WorldPicking,
  signal: typeof SIGNAL_COLOR,
  glow: { readonly add: GlowField; readonly over: GlowField; readonly xray: GlowField },
): Gardeners {
  const standard = (hex: string, roughness = 0.7) =>
    new MeshStandardMaterial({ color: hex, roughness });
  const part = (
    geometry: BufferGeometry,
    material: MeshStandardMaterial | MeshBasicMaterial,
    per = 1,
  ) => {
    const mesh = new InstancedMesh(geometry, material, MAX_AGENTS * per);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    return mesh;
  };
  const hatGeometry = new ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0);
  const body = part(new SphereGeometry(1, 14, 10), standard("#ffffff"));
  const head = part(new SphereGeometry(1, 14, 10), standard("#f6ecdc", 0.55));
  const hat = part(hatGeometry, standard("#ffffff", 0.6));
  const brim = part(new CylinderGeometry(1, 1, 0.12, 12), standard("#ffffff", 0.6));
  const eyes = part(new SphereGeometry(1, 6, 4), new MeshBasicMaterial({ color: "#1b1420" }), 2);
  const limbs = part(new CapsuleGeometry(1, 1, 2, 6), standard("#ffffff"), 4);
  const lantern = part(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: "#ffffff" }));
  const tool = part(
    mergeOrThrow([
      painted(new CylinderGeometry(0.018, 0.018, 0.22, 5).translate(0, -0.07, 0), "#9b7a5a"),
      painted(new BoxGeometry(0.1, 0.06, 0.06).translate(0, -0.18, 0), "#8d8a86"),
    ]),
    new MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.6 }),
  );
  const figure = [body, head, hat, brim, eyes, limbs, lantern, tool];
  for (const mesh of [body, head, hat]) mesh.castShadow = true;
  scene.add(...figure);

  const woodMaterial = graftMaterial(shared);
  const grafts = {
    [GRAFT_SHAPE.PLAIN]: graftMesh(GRAFT_SHAPE.PLAIN, woodMaterial),
    [GRAFT_SHAPE.BRAID]: graftMesh(GRAFT_SHAPE.BRAID, woodMaterial),
    [GRAFT_SHAPE.COLLARED]: graftMesh(GRAFT_SHAPE.COLLARED, woodMaterial),
  } as const satisfies Record<GraftShape, GraftMesh>;
  const leaves = foliage(shared, MAX_AGENTS * 3, 7);
  scene.add(...Object.values(grafts).map((graft) => graft.mesh), leaves.clumps, leaves.cards);

  const lanternFirst = glow.xray.reserve(MAX_AGENTS);
  const haloFirst = glow.add.reserve(2);
  const sparkFirst = glow.add.reserve(SPARKS);
  const ringFirst = glow.add.reserve(RINGS);
  const glyphFirst = glow.over.reserve(GLYPHS);
  const sparks = Array.from({ length: SPARKS }, () => ({
    life: 0,
    max: 1,
    p: new Vector3(),
    v: new Vector3(),
    size: 0.15,
  }));
  const rings = Array.from({ length: RINGS }, () => ({ life: 0, p: new Vector3(), size: 4 }));
  const glyphs = Array.from(
    { length: GLYPHS },
    (): Glyph => ({ life: 0, p: new Vector3(), v: new Vector3(), shape: GLOW_SHAPE.BUBBLE }),
  );
  let nextSpark = 0;
  let nextRing = 0;
  let nextGlyph = 0;
  const effects = randomOf(91);

  let drawn: Gardener[] = [];
  let leafTargets: (PickTarget | undefined)[] = [];
  let chosenOf: (agent: AgentView) => number = () => 0;
  const targetOf = (instanceId: number): PickTarget | undefined => {
    const gardener = drawn[instanceId];
    return gardener === undefined ? undefined : { kind: PICK_KIND.AGENT, id: gardener.view.id };
  };
  picking.addInstances(body, targetOf);
  picking.addInstances(head, targetOf);
  picking.addInstances(hat, targetOf);
  for (const graft of Object.values(grafts))
    picking.addInstances(graft.mesh, (instanceId) => graft.targets[instanceId]);
  picking.addInstances(leaves.clumps, (instanceId) => leafTargets[instanceId]);

  const scratch = {
    m: new Matrix4(),
    base: new Matrix4(),
    tmp: new Matrix4(),
    limb: new Matrix4(),
    head: new Matrix4(),
    hand: new Matrix4(),
    q: new Quaternion(),
    e: new Euler(),
    p: new Vector3(),
    s: new Vector3(),
    dir: new Vector3(),
    out: new Vector3(),
    c: new Color(),
  };
  const setPart = (
    mesh: InstancedMesh,
    index: number,
    base: Matrix4,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    sx: number,
    sy: number,
    sz: number,
    into: Matrix4 = scratch.tmp,
  ) => {
    scratch.q.setFromEuler(scratch.e.set(rx, ry, rz));
    scratch.m.compose(scratch.p.set(x, y, z), scratch.q, scratch.s.set(sx, sy, sz));
    into.multiplyMatrices(base, scratch.m);
    mesh.setMatrixAt(index, into);
    return into;
  };
  const setLimb = (
    index: number,
    k: number,
    base: Matrix4,
    px: number,
    py: number,
    pz: number,
    rx: number,
    rz: number,
    length: number,
    radius: number,
    into?: Matrix4,
  ) => {
    scratch.q.setFromEuler(scratch.e.set(rx, 0, rz));
    scratch.m.compose(scratch.p.set(px, py, pz), scratch.q, scratch.s.set(1, 1, 1));
    scratch.limb.multiplyMatrices(base, scratch.m);
    if (into !== undefined) into.copy(scratch.limb);
    setPart(
      limbs,
      index * 4 + k,
      scratch.limb,
      0,
      -length * 0.5,
      0,
      0,
      0,
      0,
      radius,
      length * 0.5,
      radius,
    );
  };

  const spawnSparks = (at: Vector3, count: number) => {
    for (let k = 0; k < count; k += 1) {
      const spark = item(sparks, nextSpark % SPARKS);
      nextSpark += 1;
      spark.life = 1;
      spark.max = between(effects, 0.35, 0.7);
      spark.p.copy(at);
      spark.v.set(
        between(effects, -1.6, 1.6),
        between(effects, 0.8, 2.6),
        between(effects, -1.6, 1.6),
      );
      spark.size = between(effects, 0.12, 0.22);
    }
  };
  const spawnGlyph = (at: Vector3, shape: GlowShape) => {
    const glyph = item(glyphs, nextGlyph % GLYPHS);
    nextGlyph += 1;
    glyph.life = 1;
    glyph.p.copy(at);
    glyph.v.set(between(effects, -0.15, 0.15), 0.45, between(effects, -0.15, 0.15));
    glyph.shape = shape;
  };

  const startWalk = (gardener: Gardener, to: Spot, midway: boolean) => {
    const from = gardener.motion.at;
    const walk = bakeWalk(treePath(from.branch, from.t, to.branch, to.t));
    Object.assign(gardener.motion, {
      walk,
      mode: MOOD.WALK,
      dest: to,
      fromAngle: from.angle,
      toAngle: to.angle,
      s: midway ? gardener.random() * walk.total : 0,
    });
  };

  return {
    plan: (agents, skeleton) => {
      drawn = agents.map((view, index) => {
        const random = randomOf(seedOf(view.id, 11));
        const site = view.primaryZone === null ? undefined : skeleton.sites.get(view.primaryZone);
        // Note that an agent building in no zone stands on the meadow by the trunk, at an angle of its own.
        const branch =
          site?.branch ??
          meadowBranch(
            skeleton.base,
            skeleton.heart.slot,
            (seedOf(view.id) % 6283) / 1000,
            between(random, 6, 9),
          );
        const home: Spot =
          branch.kind === BRANCH_KIND.GROUND
            ? { branch, t: between(random, 0.82, 0.97), angle: 0 }
            : {
                branch,
                t:
                  branch.kind === BRANCH_KIND.ROOT
                    ? between(random, 0.12, 0.7)
                    : branch.kind === BRANCH_KIND.LIMB
                      ? between(
                          random,
                          Math.max(branch.tPeel + 0.03, 0.3),
                          branch.tPeel + (1 - branch.tPeel) * 0.6,
                        )
                      : between(random, 0.12, 0.55),
                angle: between(random, -1, 1),
              };
        const homeSpot = spotOn(branch, random, home);
        const others = view.touched
          .flatMap((touched) => skeleton.sites.get(touched.path)?.branch ?? [])
          .filter((other) => other !== branch)
          .map((other) => spotOn(other, random, undefined));
        const hasGraft = view.agent.pullRequest !== null || view.state === AGENT_STATE.WORKING;
        let graft: Gardener["graft"];
        if (hasGraft) {
          const lines = linesOf(view.buildSize);
          const length = Math.min(9.5, Math.max(0.8, 0.75 + Math.sqrt(lines) * 0.068));
          const isRoot = branch.kind === BRANCH_KIND.ROOT;
          // Note that on the meadow a graft is a sapling springing from the ground at the gardener's place.
          const at =
            branch.kind === BRANCH_KIND.GROUND
              ? { p: meadowSpot(branch, home.t), dir: UP.clone() }
              : surfacePoint(branch, home.t, home.angle, -0.05);
          const radial = new Vector3(at.p.x, 0, at.p.z).normalize();
          const forward = isRoot
            ? radial
                .clone()
                .multiplyScalar(0.8)
                .addScaledVector(UP, -0.9)
                .addScaledVector(at.dir, 0.3)
                .normalize()
            : at.dir
                .clone()
                .multiplyScalar(0.8)
                .addScaledVector(radial, 0.7)
                .addScaledVector(UP, 0.35)
                .normalize();
          const up = UP.clone()
            .addScaledVector(forward, -UP.dot(forward))
            .normalize()
            .multiplyScalar(isRoot ? -1 : 1);
          if (up.lengthSq() < 1e-4) up.set(1, 0, 0);
          const aside = new Vector3().crossVectors(up, forward).normalize();
          const roll = new Quaternion().setFromAxisAngle(forward, between(random, -0.6, 0.6));
          up.applyQuaternion(roll);
          aside.applyQuaternion(roll);
          const matrix = new Matrix4()
            .makeBasis(aside, up, forward)
            .scale(new Vector3(length, length, length))
            .setPosition(at.p);
          graft = { shape: KIND_LOOK[view.kind].shape, matrix, length };
        }
        const mood = MOOD_OF[view.state];
        const gardener: Gardener = {
          view,
          index,
          mood,
          home,
          homeSpot,
          others,
          graft,
          random,
          tunic: item(TUNICS, index % TUNICS.length),
          hat: new Color(KIND_LOOK[view.kind].hat),
          phase: random() * 10,
          speed: between(random, 1.4, 2.1),
          motion: {
            mode: mood,
            at: homeSpot,
            timer: between(random, 0, 10),
            workFor: between(random, 7, 14),
            walk: undefined,
            s: 0,
            dest: homeSpot,
            fromAngle: 0,
            toAngle: 0,
            pos: new Vector3(),
            yaw: random() * 6.28,
            face: 0,
            hop: 9,
            scale: AGENT_SCALE,
            swing: 0,
            glyphIn: between(random, 0, 3),
          },
        };
        // Note that some begin mid-walk, so the opening shot is already alive.
        if (mood === MOOD.WORK && others.length > 0 && random() < 0.45) {
          startWalk(gardener, item(others, Math.floor(random() * others.length)), true);
        }
        return gardener;
      });
      for (const mesh of figure)
        mesh.count = drawn.length * (mesh === eyes ? 2 : mesh === limbs ? 4 : 1);
      drawn.forEach((gardener, index) => {
        body.setColorAt(index, gardener.tunic);
        hat.setColorAt(index, scratch.c.copy(gardener.hat).multiplyScalar(0.85));
        brim.setColorAt(index, scratch.c.copy(gardener.hat).multiplyScalar(0.7));
        for (let k = 0; k < 4; k += 1)
          limbs.setColorAt(
            index * 4 + k,
            k < 2 ? scratch.c.copy(gardener.tunic).multiplyScalar(0.85) : BOOTS,
          );
      });
      // The grafts and their new leaves.
      const leafList: Clump[] = [];
      leafTargets = [];
      for (const graft of Object.values(grafts)) graft.targets = [];
      for (const gardener of drawn) {
        const graft = gardener.graft;
        if (graft === undefined) continue;
        const mesh = grafts[graft.shape];
        const index = mesh.targets.length;
        mesh.mesh.setMatrixAt(index, graft.matrix);
        const lines = linesOf(gardener.view.buildSize);
        const girth =
          (0.045 + Math.sqrt(lines) * 0.0024) *
          (gardener.home.branch.kind === BRANCH_KIND.ROOT ? 0.75 : 1);
        mesh.thick.setX(index, girth / (GRAFT_GIRTH * graft.length));
        mesh.seed.setX(index, gardener.random());
        mesh.targets.push({ kind: PICK_KIND.AGENT, id: gardener.view.id });
        if (gardener.home.branch.kind === BRANCH_KIND.ROOT) continue;
        const green = new Color(KIND_LOOK[gardener.view.kind].leaf);
        const leafSize = 0.28 + graft.length * 0.13;
        const leafAt = (f: number, lift: number) =>
          graftPoint(f)
            .applyMatrix4(graft.matrix)
            .add(new Vector3(0, leafSize * lift, 0));
        const slot = gardener.home.branch.slot;
        leafList.push({ c: leafAt(1, 0.4), r: leafSize, slot, color: green });
        if (graft.length > 1.6)
          leafList.push({
            c: leafAt(0.82, 0.2),
            r: leafSize * 0.75,
            slot,
            color: green.clone().offsetHSL(0.02, 0, -0.03),
          });
        if (graft.length > 3)
          leafList.push({
            c: leafAt(0.6, 0.5),
            r: leafSize * 0.6,
            slot,
            color: green.clone().offsetHSL(0, 0, -0.05),
          });
        const target: PickTarget = { kind: PICK_KIND.AGENT, id: gardener.view.id };
        while (leafTargets.length < leafList.length) leafTargets.push(target);
      }
      for (const graft of Object.values(grafts)) {
        graft.mesh.count = graft.targets.length;
        graft.mesh.instanceMatrix.needsUpdate = true;
        graft.thick.needsUpdate = true;
        graft.seed.needsUpdate = true;
        graft.mesh.computeBoundingSphere();
      }
      leaves.lay(leafList);
    },
    paint: (chosen) => {
      chosenOf = chosen;
      const building = new Color(signal.BUILDING);
      const defect = new Color(signal.DEFECT);
      const selection = new Color(signal.SELECTION);
      const counts = { [GRAFT_SHAPE.PLAIN]: 0, [GRAFT_SHAPE.BRAID]: 0, [GRAFT_SHAPE.COLLARED]: 0 };
      drawn.forEach((gardener, index) => {
        const state = gardener.view.state;
        const lit =
          state === AGENT_STATE.FAILED ? defect : state === AGENT_STATE.IDLE ? UNLIT : building;
        const glowFor = chosen(gardener.view) > 0 ? selection : lit;
        lantern.setColorAt(
          index,
          scratch.c
            .copy(glowFor)
            .multiplyScalar(
              state === AGENT_STATE.IDLE ? 1 : state === AGENT_STATE.STUCK ? 2.2 : 4.5,
            ),
        );
        const graft = gardener.graft;
        if (graft === undefined) return;
        const mesh = grafts[graft.shape];
        const at = counts[graft.shape];
        counts[graft.shape] = at + 1;
        const pulse =
          state === AGENT_STATE.WORKING
            ? 1
            : state === AGENT_STATE.WAITING
              ? 0.45
              : state === AGENT_STATE.STUCK
                ? 0.15
                : 0;
        const glowColor =
          chosen(gardener.view) > 0
            ? selection
            : state === AGENT_STATE.FAILED
              ? defect
              : state === AGENT_STATE.IDLE
                ? QUIET_GRAFT
                : building;
        mesh.glow.setXYZ(at, glowColor.r, glowColor.g, glowColor.b);
        mesh.pulse.setX(at, chosen(gardener.view) > 0 ? 1 : pulse);
        mesh.mesh.setColorAt(
          at,
          scratch.c
            .set(gardener.home.branch.kind === BRANCH_KIND.ROOT ? "#7a5440" : "#8a7650")
            .lerp(
              state === AGENT_STATE.FAILED ? defect : building,
              state === AGENT_STATE.FAILED ? 0.35 : 0.18,
            ),
        );
      });
      for (const mesh of [lantern, body, hat, brim, limbs]) {
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
      for (const graft of Object.values(grafts)) {
        graft.glow.needsUpdate = true;
        graft.pulse.needsUpdate = true;
        if (graft.mesh.instanceColor !== null) graft.mesh.instanceColor.needsUpdate = true;
      }
    },
    ring: (id) => {
      const gardener = drawn.find((each) => each.view.id === id);
      if (gardener === undefined) return;
      gardener.motion.hop = 0;
      const ring = item(rings, nextRing % RINGS);
      nextRing += 1;
      ring.life = 1;
      ring.p.copy(gardener.motion.pos).addScaledVector(UP, 0.4);
      ring.size = 4;
    },
    cheer: (zonePath) => {
      for (const gardener of drawn) {
        if (gardener.view.touched.some((touched) => touched.path === zonePath))
          gardener.motion.hop = 0;
      }
    },
    pose: (dt, t, still) => {
      // Note that held still, nothing spawned while motion ran stays hanging in the air.
      if (still) {
        for (const each of [...sparks, ...rings, ...glyphs]) each.life = 0;
      }
      const selection = new Color(signal.SELECTION);
      const building = new Color(signal.BUILDING);
      const defect = new Color(signal.DEFECT);
      const halos: (Gardener | undefined)[] = [undefined, undefined];
      drawn.forEach((gardener, i) => {
        const motion = gardener.motion;
        const chosen = chosenOf(gardener.view);
        if (chosen >= 1) halos[0] = gardener;
        else if (chosen > 0) halos[1] = gardener;
        if (still && motion.mode === MOOD.WALK)
          Object.assign(motion, { mode: gardener.mood, at: gardener.homeSpot, walk: undefined });
        let walking = false;
        let climbing = 0;
        const walk = motion.walk;
        if (motion.mode === MOOD.WALK && walk !== undefined) {
          motion.s += dt * gardener.speed;
          const f = motion.s / walk.total;
          walkAt(
            walk,
            motion.s,
            motion.fromAngle + (motion.toAngle - motion.fromAngle) * smooth(0, 1, f),
            0,
            motion.pos,
            scratch.dir,
          );
          walking = true;
          climbing = Math.abs(scratch.dir.y) / Math.max(1e-6, scratch.dir.length());
          if (climbing > 0.75) motion.yaw = Math.atan2(-motion.pos.x, -motion.pos.z);
          else motion.yaw = Math.atan2(scratch.dir.x, scratch.dir.z);
          if (motion.s >= walk.total) {
            const atHome = motion.dest === gardener.homeSpot;
            Object.assign(motion, {
              mode: MOOD.WORK,
              at: motion.dest,
              walk: undefined,
              timer: 0,
              workFor: atHome ? between(gardener.random, 8, 16) : between(gardener.random, 4, 8),
            });
          }
        } else {
          standOn(motion.at, motion.pos, scratch.dir);
          if (motion.at === gardener.homeSpot && gardener.graft !== undefined) {
            scratch.dir.set(0, 0, 0.04).applyMatrix4(gardener.graft.matrix).sub(motion.pos);
          }
          motion.yaw = Math.atan2(scratch.dir.x, scratch.dir.z);
          if (motion.mode === MOOD.WORK && !still) {
            motion.timer += dt;
            if (motion.timer > motion.workFor) {
              motion.timer = 0;
              motion.workFor = between(gardener.random, 7, 15);
              if (motion.at !== gardener.homeSpot) startWalk(gardener, gardener.homeSpot, false);
              else if (gardener.others.length > 0 && gardener.random() < 0.55) {
                startWalk(
                  gardener,
                  item(gardener.others, Math.floor(gardener.random() * gardener.others.length)),
                  false,
                );
              }
            }
          }
        }
        const mood = motion.mode;
        const sitting =
          mood === MOOD.WAIT || mood === MOOD.SLEEP || mood === MOOD.SLUMP || mood === MOOD.REST;
        const faceGoal = chosen > 0 && !walking ? 1 : 0;
        motion.face = still
          ? faceGoal
          : motion.face + (faceGoal - motion.face) * Math.min(1, dt * 5);
        const yaw = lerpAngle(
          motion.yaw,
          Math.atan2(camera.position.x - motion.pos.x, camera.position.z - motion.pos.z),
          motion.face,
        );
        motion.hop += dt;
        const goal = AGENT_SCALE * (1 + chosen * 0.45);
        motion.scale = still ? goal : motion.scale + (goal - motion.scale) * Math.min(1, dt * 8);
        const sc = motion.scale;
        const ph = t * (walking ? 9 : 1) + gardener.phase;
        let bob = walking
          ? Math.abs(Math.sin(ph)) * 0.035
          : Math.sin(t * 2 + gardener.phase) * 0.01;
        if (motion.hop < 0.55 && !still) bob += Math.sin((Math.PI * motion.hop) / 0.55) * 0.5;
        if (chosen > 0 && !walking && !still) bob += Math.abs(Math.sin(t * 6)) * 0.04;
        const settled = still || motion.hop > 0.55;
        const drop = sitting && settled ? -0.13 : 0;
        const asleep = (mood === MOOD.SLEEP || mood === MOOD.SLUMP) && chosen === 0;
        const waiting = (mood === MOOD.WAIT || mood === MOOD.REST) && chosen === 0;
        scratch.q.setFromEuler(scratch.e.set(0, yaw, 0));
        scratch.base.compose(
          scratch.out.copy(motion.pos).addScaledVector(UP, (bob + drop) * sc),
          scratch.q,
          scratch.s.setScalar(sc),
        );
        const base = scratch.base;
        setPart(
          body,
          i,
          base,
          0,
          0.3,
          0,
          walking ? 0.12 : asleep ? (mood === MOOD.SLUMP ? 0.5 : 0.28) : 0.05,
          0,
          0,
          0.14,
          0.17,
          0.125,
        );
        const headTilt = asleep
          ? 0.5 + Math.sin(t * 1.2 + gardener.phase) * 0.06
          : walking
            ? 0
            : Math.sin(t * 1.3 + gardener.phase) * 0.1;
        const headYaw =
          mood === MOOD.WAIT && chosen === 0 ? Math.sin(t * 0.6 + gardener.phase) * 0.7 : 0;
        setPart(
          head,
          i,
          base,
          0,
          0.53,
          0.01,
          headTilt,
          headYaw,
          0,
          0.135,
          0.13,
          0.13,
          scratch.head,
        );
        const headM = scratch.head;
        // Note that the head's matrix is scaled, so the eyes and the hat are placed in a unit head's space.
        const blink = asleep || ((t * 0.31 + gardener.phase) % 1 < 0.035 && !still) ? 0.15 : 1;
        setPart(eyes, i * 2, headM, 0.35, 0.15, 0.85, 0, 0, 0, 0.16, 0.21 * blink, 0.15);
        setPart(eyes, i * 2 + 1, headM, -0.35, 0.15, 0.85, 0, 0, 0, 0.16, 0.21 * blink, 0.15);
        setPart(hat, i, headM, 0, 0.68, 0, -0.18, 0, 0.12, 1.1, 2.3, 1.1);
        setPart(brim, i, headM, 0, 0.68, 0, -0.18, 0, 0.12, 1.5, 1.9, 1.5);
        let legL: number;
        let legR: number;
        if (sitting && !walking && settled) {
          const sw = mood === MOOD.WAIT ? Math.sin(t * 2.4 + gardener.phase) * 0.3 : 0;
          legL = -1.45 + sw;
          legR = -1.45 - sw;
        } else {
          const sw = walking ? Math.sin(ph) * 0.75 : 0;
          legL = sw;
          legR = -sw;
        }
        setLimb(i, 2, base, 0.055, 0.17, 0, legL, 0, 0.13, 0.034);
        setLimb(i, 3, base, -0.055, 0.17, 0, legR, 0, 0.13, 0.034);
        let rArm: number;
        let lArm: number;
        let striking = false;
        if (chosen > 0 && !walking) {
          rArm = -2.7 + Math.sin(t * 11) * 0.38;
          lArm = -0.5;
        } else if (climbing > 0.75) {
          rArm = -2.6 + Math.sin(ph) * 0.5;
          lArm = -2.6 - Math.sin(ph) * 0.5;
        } else if (walking) {
          rArm = -Math.sin(ph) * 0.6;
          lArm = -0.5 + Math.sin(ph * 0.5) * 0.08;
        } else if (asleep) {
          rArm = -0.15;
          lArm = -0.3;
        } else if (waiting) {
          const scratching = mood === MOOD.WAIT && (t * 0.13 + gardener.phase) % 1 < 0.14 && !still;
          rArm = scratching ? -2.75 + Math.sin(t * 20) * 0.12 : -0.35;
          lArm = -0.45;
        } else {
          // Note that held still, a worker's hammer stands raised mid-swing, so the frame still says it is at work.
          const sw = still ? 0.8 : Math.sin(t * 7 + gardener.phase);
          rArm = -1.2 - Math.max(0, sw) * 1.4 + Math.min(0, sw) * 0.2;
          lArm = -0.55;
          striking = motion.swing > 0 && sw <= 0;
          motion.swing = sw;
        }
        setLimb(i, 0, base, 0.15, 0.38, 0, rArm, -0.15, 0.13, 0.03, scratch.hand);
        const toolM = setPart(tool, i, scratch.hand, 0, -0.16, 0, 1.6, 0, 0, 1, 1, 1);
        if (striking && !still && gardener.graft !== undefined)
          spawnSparks(scratch.out.set(0, -0.18, 0).applyMatrix4(toolM), 4);
        setLimb(i, 1, base, -0.15, 0.38, 0, lArm, 0.15, 0.13, 0.03, scratch.hand);
        const sway = still ? 0 : Math.sin(t * 3 + gardener.phase) * 0.15;
        const lanternM = setPart(
          lantern,
          i,
          scratch.hand,
          0,
          -0.2 - Math.abs(sway) * 0.03,
          sway * 0.1,
          0,
          0,
          0,
          0.045,
          0.055,
          0.045,
        );
        const state = gardener.view.state;
        const lightColor =
          chosen > 0 ? selection : state === AGENT_STATE.FAILED ? defect : building;
        const dim = state === AGENT_STATE.IDLE ? 0 : asleep ? 0.35 : waiting ? 0.7 : 1;
        glow.xray.set(
          lanternFirst + i,
          lanternM.elements[12] ?? 0,
          lanternM.elements[13] ?? 0,
          lanternM.elements[14] ?? 0,
          (1.5 + 0.15 * Math.sin(t * 5 + gardener.phase)) *
            (1 + chosen * 0.6) *
            (asleep ? 0.75 : 1),
          lightColor.r * 3.4,
          lightColor.g * 3.4,
          lightColor.b * 3.4,
          dim * 0.75,
        );
        // Note that a sleeper's bubble and a waiter's dots rise while motion runs, and stand over the head while it is held.
        const glyphShape =
          mood === MOOD.SLEEP
            ? GLOW_SHAPE.BUBBLE
            : mood === MOOD.WAIT
              ? GLOW_SHAPE.ELLIPSIS
              : undefined;
        if (glyphShape !== undefined && !still && chosen === 0) {
          motion.glyphIn -= dt;
          if (motion.glyphIn <= 0) {
            motion.glyphIn =
              glyphShape === GLOW_SHAPE.BUBBLE
                ? between(gardener.random, 1.4, 2.2)
                : between(gardener.random, 5, 9);
            spawnGlyph(scratch.out.set(0, 0.9, 0).applyMatrix4(headM), glyphShape);
          }
        }
      });
      for (let i = drawn.length; i < MAX_AGENTS; i += 1)
        glow.xray.set(lanternFirst + i, 0, 0, 0, 0, 0, 0, 0, 0);
      // The halo round the selected gardener and the hovered one.
      halos.forEach((gardener, k) => {
        if (gardener === undefined) {
          glow.add.set(haloFirst + k, 0, 0, 0, 0, 0, 0, 0, 0);
          return;
        }
        const m = gardener.motion;
        glow.add.set(
          haloFirst + k,
          m.pos.x,
          m.pos.y + 0.35 * m.scale,
          m.pos.z,
          (k === 0 ? 3.2 : 2.2) * (1 + 0.12 * Math.sin(t * 4)),
          selection.r * 1.5,
          selection.g * 1.5,
          selection.b * 1.5,
          k === 0 ? 0.55 : 0.35,
        );
      });
      sparks.forEach((spark, k) => {
        spark.life = Math.max(0, spark.life - dt / spark.max);
        spark.v.y -= 6 * dt;
        spark.p.addScaledVector(spark.v, dt);
        glow.add.set(
          sparkFirst + k,
          spark.p.x,
          spark.p.y,
          spark.p.z,
          spark.size,
          building.r * 2.4,
          building.g * 2.4,
          building.b * 2.4,
          spark.life,
        );
      });
      rings.forEach((ring, k) => {
        ring.life = Math.max(0, ring.life - dt / 1.1);
        glow.add.set(
          ringFirst + k,
          ring.p.x,
          ring.p.y,
          ring.p.z,
          ring.size * (0.25 + 1.2 * (1 - ring.life)),
          selection.r * 1.6,
          selection.g * 1.6,
          selection.b * 1.6,
          ring.life * ring.life,
          GLOW_SHAPE.RING,
        );
      });
      glyphs.forEach((glyph, k) => {
        glyph.life = Math.max(0, glyph.life - dt / 2.2);
        glyph.p.addScaledVector(glyph.v, dt);
        const size = 0.55 * (0.7 + 0.6 * (1 - glyph.life));
        const tint = glyph.shape === GLOW_SHAPE.BUBBLE ? [0.82, 0.78, 1] : [1, 0.86, 0.62];
        glow.over.set(
          glyphFirst + k,
          glyph.p.x,
          glyph.p.y,
          glyph.p.z,
          size,
          tint[0] ?? 1,
          tint[1] ?? 1,
          tint[2] ?? 1,
          Math.sin(glyph.life * Math.PI) * 0.95,
          glyph.shape,
        );
      });
      if (still) {
        // Note that held still, each sleeper and waiter wears its sign over its head, where a moving frame would float it.
        let k = 0;
        for (const gardener of drawn) {
          const shape =
            gardener.motion.mode === MOOD.SLEEP
              ? GLOW_SHAPE.BUBBLE
              : gardener.motion.mode === MOOD.WAIT
                ? GLOW_SHAPE.ELLIPSIS
                : undefined;
          if (shape === undefined || k >= GLYPHS || chosenOf(gardener.view) > 0) continue;
          const m = gardener.motion;
          const tint = shape === GLOW_SHAPE.BUBBLE ? [0.82, 0.78, 1] : [1, 0.86, 0.62];
          glow.over.set(
            glyphFirst + k,
            m.pos.x,
            m.pos.y + 1.15 * m.scale,
            m.pos.z,
            0.55,
            tint[0] ?? 1,
            tint[1] ?? 1,
            tint[2] ?? 1,
            0.95,
            shape,
          );
          k += 1;
        }
      }
      for (const mesh of figure) mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
