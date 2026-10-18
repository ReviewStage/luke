import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { WorldPalette } from "@luke/panel/factory-world/world";
import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentKind,
  type AgentState,
  type AgentView,
} from "@luke/ui/factory-world";
import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { hdrMaterial } from "./effects";
import { clamp, col, ease, lerp, PAL, PRIM, partGeo, rngOf, shade } from "./geo";
import { keptRight, type Layout, type Lot, Path, roadRoute, type Spot } from "./layout";

/**
 * agents.ts -- the Factory's coding agents: a worker robot each, its forklift, and the build site it raises on its zone's apron.
 *
 * An agent at work builds a structure as large as its pull request
 * (`buildSize`): a new machine going in for a feature, a patched one for a
 * fix, an old half swapped for a new one for a refactor, crates for the
 * rest, ringed by scaffolding in the building signal's colour, with a
 * pallet of crates as many as its lines and a tower crane over the largest.
 * Its robot works there (a welding torch, a wrench, a hammer by its kind),
 * walks to the pallet, and drives its forklift out along the roads to each
 * other zone its pull request touches and back. Where it stands is said by
 * pose as well as motion, so a still frame says it too: one waiting on the
 * developer stands with a hand up, a stuck one slumps beside its flag at
 * half-mast, a failed one slumps red beside a beacon, and an idle one sits
 * in its parked forklift with no site at all.
 *
 * Every part is one instanced mesh allocated at the contract's bound, so a
 * hundred agents draw in the same few calls as one; each frame poses one
 * rig per agent and copies its joints' matrices into the instances.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_AGENTS;

/** The most crates on one site's pallet. */
const MAX_PALLET = 12;

/** The size a site's geometry is drawn at, scaled to each agent's own. */
const SITE_REFERENCE = 3;

/** The build sizes: a structure's side from no lines up to full. */
const SITE_SMALLEST = 1.1;
const SITE_LARGEST = 5.6;

/** The build size past which a site gets a tower crane: about three thousand lines. */
const CRANE_FROM = 0.94;

/** A tower crane's mast, the mockup's `9 + 2.6 * size` at the sizes that get one. */
const CRANE_HEIGHT = 23;

/** The kinds of site, which a pull request's type picks. */
export const SITE = {
  FEAT: "feat",
  FIX: "fix",
  REFACTOR: "refactor",
  OTHER: "other",
} as const;

type SiteKind = (typeof SITE)[keyof typeof SITE];

const SITE_KINDS = [SITE.FEAT, SITE.FIX, SITE.REFACTOR, SITE.OTHER] as const;

/** The robot's poses. */
const POSE = {
  WORK: "work",
  WALK: "walk",
  SIT: "sit",
  PICK: "pick",
  IDLE: "idle",
  WAVE: "wave",
  SLEEP: "sleep",
} as const;

type Pose = (typeof POSE)[keyof typeof POSE];

/** One step of a working agent's round. */
const STEP = {
  WORK: "work",
  WALK: "walk",
  MOUNT: "mount",
  DRIVE: "drive",
  LOAD: "load",
  DISMOUNT: "dismount",
  IDLE: "idle",
} as const;

type StepKind = (typeof STEP)[keyof typeof STEP];

/** A side of a site, in scene units, from its agent's build size. */
export function siteSizeOf(buildSize: number): number {
  return SITE_SMALLEST + (SITE_LARGEST - SITE_SMALLEST) * clamp(buildSize, 0, 1);
}

function siteKindOf(kind: AgentKind): SiteKind {
  switch (kind) {
    case AGENT_KIND.FEAT:
      return SITE.FEAT;
    case AGENT_KIND.FIX:
    case AGENT_KIND.REVERT:
      return SITE.FIX;
    case AGENT_KIND.REFACTOR:
    case AGENT_KIND.PERF:
    case AGENT_KIND.STYLE:
      return SITE.REFACTOR;
    default:
      return SITE.OTHER;
  }
}

/** Whether an agent in `state` raises a site; an idle one's work is done or dropped. */
export function raisesSite(state: AgentState): boolean {
  return state !== AGENT_STATE.IDLE;
}

/** Where one agent stands and builds, as the world placed it. */
export interface AgentPlacement {
  readonly view: AgentView;
  /** Its site's centre, or its parked forklift's where it raises none. */
  readonly x: number;
  readonly z: number;
  readonly size: number;
  /** Its home lot; none for an agent the world placed at the gate. */
  readonly lot: Lot | undefined;
  /** The other lots its pull request touches, which its forklift delivers to. */
  readonly deliveries: readonly Lot[];
}

/** One step of a round, and how long it takes. */
interface Step {
  readonly kind: StepKind;
  readonly duration: number;
  readonly path?: Path;
  readonly cargo?: boolean;
  readonly pick?: boolean;
  readonly drop?: boolean;
  readonly carry?: boolean;
}

/** One agent's round under way: where it is in its steps, what it carries, and where its robot and forklift stand. */
interface Walker {
  readonly placement: AgentPlacement;
  readonly rng: () => number;
  readonly work: Spot;
  readonly pallet: Spot;
  readonly park: Spot;
  steps: readonly Step[];
  index: number;
  into: number;
  cycle: number;
  carry: boolean;
  cargo: boolean;
  fork: number;
  robot: { x: number; z: number; yaw: number };
  lift: { x: number; z: number; yaw: number };
  robotYaw: number;
  liftYaw: number;
  pose: Pose;
  seated: boolean;
}

/** The worker robot's rig, posed for each agent in turn. */
interface Rig {
  readonly root: Object3D;
  readonly hips: Object3D;
  readonly torso: Object3D;
  readonly body: Object3D;
  readonly head: Object3D;
  readonly visor: Object3D;
  readonly hat: Object3D;
  readonly armL: Object3D;
  readonly armR: Object3D;
  readonly tool: Object3D;
  readonly tip: Object3D;
  readonly legL: Object3D;
  readonly legR: Object3D;
  readonly crate: Object3D;
}

function rigOf(): Rig {
  const node = (parent: Object3D | undefined, x = 0, y = 0, z = 0) => {
    const object = new Object3D();
    object.position.set(x, y, z);
    parent?.add(object);
    return object;
  };
  const root = node(undefined);
  const hips = node(root);
  const torso = node(hips);
  const body = node(torso, 0, 0.4, 0);
  const neck = node(torso, 0, 0.8, 0);
  const head = node(neck, 0, 0.26, 0);
  const armR = node(torso, 0.47, 0.74, 0);
  const tool = node(armR, 0, -0.62, 0.02);
  return {
    root,
    hips,
    torso,
    body,
    head,
    visor: node(head, 0, 0.02, 0.26),
    hat: node(head, 0, 0.2, 0),
    armL: node(torso, -0.47, 0.74, 0),
    armR,
    tool,
    tip: node(tool, 0, -0.04, 0.62),
    legL: node(hips, -0.17, 0, 0),
    legR: node(hips, 0.17, 0, 0),
    crate: node(torso, 0, 0.52, 0.55),
  };
}

/** Poses `rig` for `pose` at `t` seconds in; at zero, each pose stands at its rest. */
function poseRig(rig: Rig, pose: Pose, t: number, site: SiteKind, carry: boolean): void {
  const R = rig;
  R.hips.position.y = 0.8;
  R.hips.rotation.set(0, 0, 0);
  R.torso.rotation.set(0, 0, 0);
  R.head.rotation.set(0, 0, 0);
  R.armL.rotation.set(0, 0, 0.08);
  R.armR.rotation.set(0, 0, -0.08);
  R.legL.rotation.set(0, 0, 0);
  R.legR.rotation.set(0, 0, 0);
  R.tool.rotation.set(0, 0, 0);
  switch (pose) {
    case POSE.WALK: {
      const s = Math.sin(t * 9);
      R.legL.rotation.x = s * 0.62;
      R.legR.rotation.x = -s * 0.62;
      R.hips.position.y = 0.8 + Math.abs(Math.cos(t * 9)) * 0.07;
      R.torso.rotation.x = 0.06;
      if (carry) {
        R.armL.rotation.set(-1.25, 0, 0.25);
        R.armR.rotation.set(-1.25, 0, -0.25);
      } else {
        R.armL.rotation.x = -s * 0.55;
        R.armR.rotation.x = s * 0.55;
      }
      return;
    }
    case POSE.SIT:
      R.hips.position.y = 0.42;
      R.legL.rotation.x = -1.45;
      R.legR.rotation.x = -1.45;
      R.armL.rotation.x = -0.95;
      R.armR.rotation.x = -0.95;
      R.head.rotation.y = Math.sin(t * 0.7) * 0.3;
      return;
    case POSE.PICK:
      R.torso.rotation.x = 0.55;
      R.hips.position.y = 0.72;
      R.legL.rotation.x = -0.25;
      R.legR.rotation.x = -0.25;
      R.armL.rotation.x = -1.0;
      R.armR.rotation.x = -1.0;
      return;
    case POSE.IDLE:
      R.head.rotation.y = Math.sin(t * 0.8) * 0.5;
      R.hips.position.y = 0.8 + Math.sin(t * 2) * 0.01;
      if (carry) {
        R.armL.rotation.x = -1.25;
        R.armR.rotation.x = -1.25;
      }
      return;
    case POSE.WAVE:
      R.armR.rotation.x = -2.7;
      R.armR.rotation.z = -0.25 + Math.sin(t * 13) * 0.45;
      R.head.rotation.z = Math.sin(t * 4) * 0.15;
      R.head.rotation.x = -0.15;
      R.armL.rotation.z = 0.2;
      R.hips.position.y = 0.8 + Math.abs(Math.sin(t * 6.5)) * 0.06;
      return;
    case POSE.SLEEP:
      R.hips.position.y = 0.36;
      R.legL.rotation.x = -1.5;
      R.legR.rotation.set(-1.35, 0, -0.15);
      R.torso.rotation.x = 0.42 + Math.sin(t * 1.4) * 0.04;
      R.head.rotation.set(0.55, 0, 0.2);
      R.armL.rotation.set(-0.5, 0, 0.25);
      R.armR.rotation.set(-0.5, 0, -0.25);
      return;
    case POSE.WORK:
      workPose(R, t, site);
      return;
  }
}

function workPose(R: Rig, t: number, site: SiteKind): void {
  if (site === SITE.FEAT) {
    R.hips.position.y = 0.55;
    R.legL.rotation.x = -1.2;
    R.legR.rotation.x = 0.4;
    R.torso.rotation.x = 0.3;
    R.head.rotation.x = 0.25;
    R.armR.rotation.set(-1.2 + Math.sin(t * 23) * 0.04, Math.sin(t * 1.3) * 0.25, -0.08);
    R.armL.rotation.set(-0.9, 0, 0.35);
    return;
  }
  if (site === SITE.FIX) {
    R.torso.rotation.x = 0.2;
    R.armR.rotation.set(-1.25 + Math.sin(t * 4) * 0.12, Math.cos(t * 4) * 0.35, -0.08);
    R.armL.rotation.x = -1.0;
    R.tool.rotation.y = Math.sin(t * 4) * 0.5;
    R.head.rotation.x = 0.15;
    return;
  }
  const c = (t * 1.5) % 1;
  R.armR.rotation.x =
    c < 0.62 ? lerp(-0.4, -2.75, ease(c / 0.62)) : lerp(-2.75, -0.4, ((c - 0.62) / 0.38) ** 0.5);
  R.armL.rotation.x = -0.75;
  R.torso.rotation.x = 0.12 + (c > 0.62 ? 0.12 : 0);
  R.head.rotation.x = 0.2;
  R.legL.rotation.x = 0.2;
  R.legR.rotation.x = -0.2;
}

/** One site kind's structure, drawn at `SITE_REFERENCE` about its centre: its pad, the structure, its scaffolding, and its pallet. */
function siteGeometryOf(kind: SiteKind, building: string): BufferGeometry {
  return partGeo((g) => {
    const s = SITE_REFERENCE;
    const mh = s * 0.85;
    const frame = "#5d6673";
    g.box(0.9, 0, 0, s + 2.6, 0.1, s + 1.2, "#b5ad9b");
    const scaffold = (h: number) => {
      for (const [x, z] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        g.box(x * (s / 2 + 0.35), 0.1, z * (s / 2 + 0.35), 0.1, h, 0.1, building);
      }
      for (let y = 1.1; y < h; y += 1.1) {
        g.box(0, 0.1 + y, -(s / 2 + 0.35), s + 0.8, 0.07, 0.07, building);
        g.box(-(s / 2 + 0.35), 0.1 + y, 0, 0.07, 0.07, s + 0.8, building);
        g.box(s / 2 + 0.35, 0.1 + y, 0, 0.07, 0.07, s + 0.8, building);
        g.box(0, 0.1 + y - 0.05, s / 2 + 0.4, s + 0.8, 0.06, 0.3, PAL.wood);
      }
    };
    if (kind === SITE.FEAT) {
      // Note that a feature is a new machine mid-install: a solid lower body, an open frame above.
      g.box(0, 0.1, 0, s, mh * 0.55, s * 0.85, "#dfe5ec");
      g.box(0, 0.1, 0, s + 0.06, 0.25, s * 0.85 + 0.06, frame);
      g.box(0, 0.1 + mh * 0.55, 0, s + 0.06, 0.12, s * 0.85 + 0.06, frame);
      for (const [x, z] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        g.box(x * s * 0.48, 0.1, z * s * 0.4, 0.14, mh, 0.14, frame);
      }
      g.box(0, 0.1 + mh, 0, s, 0.12, 0.14, frame);
      g.box(0, 0.1 + mh, s * 0.4, s, 0.12, 0.14, frame);
      g.box(0, 0.1 + mh, -s * 0.4, s, 0.12, 0.14, frame);
      g.cyl(-s * 0.2, 0.1 + mh * 0.55, 0, s * 0.18, mh * 0.35, "#e9edf2", 12);
      g.box(s * 0.25, 0.1 + mh * 0.3, s * 0.43, s * 0.2, s * 0.1, 0.04, building);
      scaffold(mh + 0.4);
    } else if (kind === SITE.FIX) {
      g.box(0, 0.1, 0, s, mh, s * 0.85, "#a8b0bb");
      g.box(0, 0.1 + mh, 0, s * 0.9, 0.15, s * 0.75, frame);
      g.box(s * 0.15, 0.1 + mh * 0.3, s * 0.43, s * 0.35, s * 0.3, 0.06, building);
      g.box(-s * 0.3, 0.1 + mh * 0.5, s * 0.43, s * 0.2, s * 0.2, 0.06, building);
      g.rbox(-s * 0.1, 0.12, s * 0.7, s * 0.35, 0.05, s * 0.3, "#a8b0bb", 0, 0.4, 0);
      g.box(s * 0.55, 0.1, s * 0.55, 0.6, 0.35, 0.3, PAL.red);
      for (const x of [-0.6, 0.6]) g.cone(x * s, 0.1, s * 0.75, 0.18, 0.5, "#ff7a2a", 6);
    } else if (kind === SITE.REFACTOR) {
      // Note that a refactor swaps an old, rusted half for a new one.
      const rng = rngOf("refactor");
      g.box(-s * 0.25, 0.1, 0, s * 0.48, mh * 0.8, s * 0.85, "#8d7464");
      g.box(-s * 0.25, 0.1 + mh * 0.8, 0, s * 0.3, mh * 0.12, s * 0.5, "#6e5a4e");
      g.box(s * 0.25, 0.1, 0, s * 0.48, mh, s * 0.85, "#cfd8e0");
      g.box(s * 0.25, 0.1 + mh, 0, s * 0.5, 0.1, s * 0.87, frame);
      g.box(0, 0.1, 0, 0.08, mh, s * 0.9, frame);
      for (let index = 0; index < 3; index += 1) {
        g.rbox(
          -s * 0.7 + rng() * 0.3,
          0.2 + index * 0.12,
          s * 0.3 - rng() * s * 0.4,
          0.5,
          0.12,
          0.25,
          "#7a6152",
          0,
          rng() * 3,
          0,
        );
      }
      scaffold(mh + 0.2);
    } else {
      for (let index = 0; index < 4; index += 1) {
        g.box(
          ((index % 2) - 0.5) * s * 0.5,
          0.1 + Math.floor(index / 2) * s * 0.42,
          0,
          s * 0.46,
          s * 0.4,
          s * 0.8,
          PAL.wood,
        );
      }
      g.box(0, 0.1, 0, s * 1.02, 0.15, s * 0.85, PAL.woodDark);
    }
    g.box(s / 2 + 1.1, 0.1, -s * 0.15, 1.3, 0.16, 1.3, PAL.woodDark);
  });
}

/** Every agent's parts, instanced at the bound, and the walkers posing them. */
export interface AgentsLayer {
  readonly group: Group;
  /** Places and paints every agent in `placements`; a walker stays where its agent stays. */
  readonly show: (
    placements: readonly AgentPlacement[],
    chosen: (agent: AgentView) => boolean,
    layout: Layout,
  ) => void;
  /** Steps every walker `delta` seconds and poses it. */
  readonly step: (delta: number, time: number, scale: number) => void;
  /** Poses every agent at rest, as a still frame stands. */
  readonly rest: () => void;
  /** Where each drawn agent's welding torch or hammer strikes this frame, for the sparks; none for one not working. */
  readonly strikes: () => readonly {
    x: number;
    y: number;
    z: number;
    site: SiteKind;
    phase: number;
  }[];
  /** The agent each instance of the proxy and each site stands for, by index. */
  readonly agentAt: (index: number) => AgentView | undefined;
  readonly proxy: InstancedMesh;
  readonly sites: readonly InstancedMesh[];
  readonly siteAgentAt: (mesh: InstancedMesh, index: number) => AgentView | undefined;
}

/** The materials an agents layer draws in, made once by the world. */
interface AgentMaterials {
  readonly solid: Material;
  readonly invisible: Material;
}

/** Builds every agent's parts at the bound, in `palette`'s signals. */
export function agentsLayerOf(palette: WorldPalette, materials: AgentMaterials): AgentsLayer {
  const group = new Group();
  const robot = new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.1,
  });
  // Note that only the larger parts cast shadows: a tool's or a hat's is too small to see and costs a draw in the shadow pass.
  const instanced = (geometry: BufferGeometry, material: Material, count: number, cast = false) => {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number) => new BoxGeometry(w, h, d);
  const W = {
    legs: instanced(box(0.26, 0.78, 0.3).translate(0, -0.39, 0), materials.solid, MAX * 2, true),
    torso: instanced(
      partGeo((g) => {
        g.box(0, 0, 0, 0.74, 0.8, 0.5, "#ffffff");
        g.box(0, 0.32, 0.26, 0.5, 0.12, 0.04, "#f2f2f2");
        g.box(0, 0.05, -0.32, 0.5, 0.55, 0.18, "#d0d0d0");
      }),
      robot,
      MAX,
      true,
    ),
    head: instanced(
      partGeo((g) => {
        g.box(0, 0, 0, 0.56, 0.48, 0.5, "#e8ebef");
        g.box(0, 0.12, -0.27, 0.06, 0.2, 0.06, "#9aa3ad");
      }),
      robot,
      MAX,
    ),
    visor: instanced(box(0.44, 0.14, 0.06), hdrMaterial("#e6f2ff", 2.6), MAX),
    hat: instanced(
      partGeo((g) => {
        g.dome(0, 0, 0, 0.34, 0.26, "#ffffff");
        g.cyl(0, 0, 0.06, 0.4, 0.05, "#ffffff", 12);
        g.box(0, 0.18, 0, 0.08, 0.1, 0.6, "#e8e8e8");
      }),
      robot,
      MAX,
    ),
    arms: instanced(box(0.19, 0.66, 0.21).translate(0, -0.33, 0), materials.solid, MAX * 2),
    hammer: instanced(
      partGeo((g) => {
        g.box(0, -0.04, 0.32, 0.07, 0.07, 0.6, "#7a5a3c");
        g.box(0, -0.04, 0.64, 0.16, 0.36, 0.16, "#59616d");
      }),
      materials.solid,
      MAX,
    ),
    wrench: instanced(
      partGeo((g) => {
        g.box(0, -0.03, 0.3, 0.06, 0.12, 0.62, "#a9b2bd");
        g.box(0, -0.03, 0.62, 0.06, 0.3, 0.12, "#a9b2bd");
      }),
      materials.solid,
      MAX,
    ),
    torch: instanced(
      partGeo((g) => {
        g.box(0, -0.03, 0.22, 0.12, 0.12, 0.42, "#3f4650");
        g.box(0, -0.03, 0.5, 0.05, 0.05, 0.2, "#c9a14a");
      }),
      materials.solid,
      MAX,
    ),
    crate: instanced(
      partGeo((g) => {
        g.box(0, -0.27, 0, 0.6, 0.54, 0.6, PAL.wood);
        g.box(0, -0.02, 0, 0.62, 0.06, 0.62, PAL.woodDark);
      }),
      materials.solid,
      MAX,
    ),
  };
  const F = {
    body: instanced(
      partGeo((g) => {
        g.box(0, 0.22, -0.15, 1.25, 0.62, 1.7, "#f2b632");
        g.box(0, 0.22, -0.95, 1.3, 0.95, 0.5, "#3d424c");
        g.box(0, 0.84, -0.32, 0.6, 0.22, 0.55, "#2b2f36");
        g.box(0, 0.84, -0.6, 0.6, 0.7, 0.12, "#2b2f36");
        for (const s of [-1, 1]) {
          g.beam(s * 0.56, 0.84, 0.42, s * 0.56, 2.15, 0.3, 0.08, "#3d424c");
          g.beam(s * 0.56, 0.84, -0.78, s * 0.56, 2.15, -0.7, 0.08, "#3d424c");
        }
        g.box(0, 2.12, -0.2, 1.22, 0.08, 1.15, "#3d424c");
        for (const s of [-1, 1]) g.box(s * 0.38, 0.15, 0.78, 0.12, 2.5, 0.14, "#3d424c");
        g.box(0, 2.5, 0.78, 0.9, 0.12, 0.14, "#3d424c");
        for (const [x, z, r] of [
          [-0.64, 0.45, 0.32],
          [0.64, 0.45, 0.32],
          [-0.64, -0.75, 0.27],
          [0.64, -0.75, 0.27],
        ] as const) {
          g.rcyl(x, r, z, r, 0.26, "#1f2329", 0, 0, Math.PI / 2, 8);
        }
        g.box(0, 0.86, 0.25, 0.08, 0.5, 0.08, PAL.iron);
        g.sph(0, 2.22, -0.65, 0.09, "#ff9a2e");
      }),
      materials.solid,
      MAX,
      true,
    ),
    forks: instanced(
      partGeo((g) => {
        g.box(0, 0, 0.86, 1.0, 0.62, 0.08, "#3d424c");
        for (const s of [-1, 1]) g.box(s * 0.3, 0, 1.42, 0.12, 0.06, 1.1, "#3d424c");
      }),
      materials.solid,
      MAX,
    ),
    cargo: instanced(
      partGeo((g) => {
        g.box(0, 0, 1.4, 1.0, 0.12, 1.0, PAL.woodDark);
        g.box(0, 0.12, 1.4, 0.9, 0.8, 0.9, PAL.wood);
        g.box(0, 0.5, 1.4, 0.94, 0.06, 0.94, "#94693c");
      }),
      materials.solid,
      MAX,
    ),
  };
  const proxy = instanced(
    new BoxGeometry(2.6, 3.4, 2.6).translate(0, 1.7, 0),
    materials.invisible,
    MAX,
    false,
  );
  const siteMeshes = new Map<SiteKind, InstancedMesh>(
    SITE_KINDS.map((kind) => [
      kind,
      instanced(siteGeometryOf(kind, palette.signal.BUILDING), materials.solid, MAX, true),
    ]),
  );
  const pallet = instanced(
    partGeo((g) => g.box(0, 0, 0, 0.55, 0.52, 0.55, PAL.wood)),
    materials.solid,
    MAX * MAX_PALLET,
  );
  const poles = instanced(
    partGeo((g) => {
      g.box(0, 0, 0, 0.12, 5.2, 0.12, "#e9e6df");
      g.sph(0, 5.25, 0, 0.14, "#e9e6df");
    }),
    materials.solid,
    MAX,
  );
  const cloths = instanced(
    partGeo((g) => g.box(0.75, -0.55, 0, 1.5, 1.0, 0.06, "#ffffff")),
    materials.solid,
    MAX,
  );
  // Note that only a build past `CRANE_FROM` gets a crane, so every mast stands within a unit of `CRANE_HEIGHT`, and one lattice serves them all.
  const masts = instanced(
    partGeo((g) => {
      g.box(0, 0, 0, 1.6, 0.4, 1.6, PAL.concreteDark);
      for (const [dx, dz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        g.box(dx * 0.35, 0.4, dz * 0.35, 0.12, CRANE_HEIGHT, 0.12, PAL.hazard);
      }
      for (let y = 0.8; y < CRANE_HEIGHT; y += 1.0) {
        g.rbox(0, y + 0.4, 0.35, 0.95, 0.06, 0.06, PAL.hazard, 0, 0, 0.7);
        g.rbox(0.35, y + 0.4, 0, 0.06, 0.06, 0.95, PAL.hazard, 0.7, 0, 0);
      }
    }),
    materials.solid,
    MAX,
    true,
  );
  const jibs = instanced(
    partGeo((g) => {
      const J = 10;
      g.box(J / 2 - 1.5, 0, 0, J + 3, 0.5, 0.6, PAL.hazard);
      g.box(-2.6, -0.5, 0, 1.4, 1.0, 1.0, "#7a828d");
      g.box(0.3, 0.0, 0.5, 1.0, 0.9, 0.9, "#f1eee6");
      g.add(PRIM.cone4, PAL.hazard, 0, 1.2, 0, 0.5, 1.6, 0.5);
      g.box(J - 1, -0.4, 0, 0.6, 0.35, 0.6, PAL.iron);
      g.box(J - 1, -6, 0, 0.05, 5.6, 0.05, PAL.iron);
      g.box(J - 1, -6.9, 0, 1.6, 0.9, 1.6, palette.signal.BUILDING);
    }),
    materials.solid,
    MAX,
    true,
  );
  const beacons = instanced(
    new SphereGeometry(0.3, 10, 8),
    hdrMaterial(palette.signal.DEFECT, 2.5),
    MAX,
  );
  const rings = instanced(
    new RingGeometry(1.6, 2.1, 40).rotateX(-Math.PI / 2),
    new MeshBasicMaterial({
      color: palette.signal.SELECTION,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    }),
    MAX,
  );
  const pins = instanced(
    new OctahedronGeometry(0.75, 0),
    new MeshBasicMaterial({ color: palette.signal.SELECTION, toneMapped: false }),
    MAX,
  );

  const rig = rigOf();
  const fork = { root: new Object3D(), forks: new Object3D(), seat: new Object3D() };
  fork.root.add(fork.forks, fork.seat);
  fork.seat.position.set(0, 0.2, -0.3);
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const scratch = {
    matrix: new Matrix4(),
    vector: new Vector3(),
    tint: new Color(),
    out: { x: 0, z: 0, yaw: 0 },
  };
  const signal = palette.signal;
  const idleGrey = col("#9aa3ad");

  let walkers = new Map<string, Walker>();
  let drawn: Walker[] = [];
  let chosen: Walker[] = [];
  let currentLayout: Layout | undefined;
  let siteOrder = new Map<InstancedMesh, AgentView[]>();
  let lastScale = 1.4;
  let lastTime = 0;

  const planOf = (walker: Walker): Step[] => {
    const { placement, rng } = walker;
    const state = placement.view.state;
    if (state !== AGENT_STATE.WORKING)
      return [{ kind: STEP.WORK, duration: Number.POSITIVE_INFINITY }];
    const steps: Step[] = [{ kind: STEP.WORK, duration: 6 + rng() * 8 }];
    const home = placement.lot;
    const deliveries = placement.deliveries;
    if (home !== undefined && currentLayout !== undefined && deliveries.length > 0 && rng() < 0.8) {
      const target = deliveries[walker.cycle % deliveries.length];
      walker.cycle += 1;
      if (target !== undefined) {
        const dock = {
          x: clamp(target.cx + (rng() - 0.5) * target.W * 0.5, target.x0 + 2, target.x1 - 2),
          z: target.z1 - 1.6,
        };
        // Note that each way is kept to its own right, so a forklift coming back drives the other lane.
        const road = roadRoute(currentLayout, walker.park, home, dock, target);
        const go = keptRight(road, 1.3);
        go[0] = walker.park;
        const back = keptRight([...road].reverse(), 1.3);
        back[back.length - 1] = walker.park;
        const seat = { x: walker.park.x - 0.9, z: walker.park.z };
        steps.push(
          { kind: STEP.WALK, duration: 0, path: new Path([walker.work, seat]) },
          { kind: STEP.MOUNT, duration: 0.5 },
          { kind: STEP.DRIVE, duration: 0, path: new Path(go) },
          { kind: STEP.LOAD, duration: 1.8 },
          { kind: STEP.DRIVE, duration: 0, path: new Path(back), cargo: true },
          { kind: STEP.DISMOUNT, duration: 0.5 },
          { kind: STEP.WALK, duration: 0, path: new Path([seat, walker.work]), carry: true },
          { kind: STEP.IDLE, duration: 0.5, drop: true },
        );
      }
    } else {
      steps.push(
        { kind: STEP.WALK, duration: 0, path: new Path([walker.work, walker.pallet]) },
        { kind: STEP.IDLE, duration: 0.7, pick: true },
        { kind: STEP.WALK, duration: 0, path: new Path([walker.pallet, walker.work]), carry: true },
        { kind: STEP.IDLE, duration: 0.5, drop: true },
      );
    }
    return steps.map((step) =>
      step.path === undefined
        ? step
        : { ...step, duration: step.path.length / (step.kind === STEP.DRIVE ? 7.5 : 1.7) + 0.01 },
    );
  };

  const walkerOf = (placement: AgentPlacement): Walker => {
    const rng = rngOf(placement.view.id);
    const s = placement.size;
    const site = raisesSite(placement.view.state);
    const work = site
      ? { x: placement.x + (rng() - 0.5) * s * 0.4, z: placement.z + s * 0.5 + 0.55 }
      : { x: placement.x - 0.9, z: placement.z };
    const park = site
      ? { x: placement.x + s / 2 + 2.25, z: placement.z + s * 0.15 + 0.5 }
      : { x: placement.x, z: placement.z };
    const walker: Walker = {
      placement,
      rng,
      work,
      pallet: { x: placement.x + s / 2 + 1.1, z: placement.z - s * 0.15 + 1.05 },
      park,
      steps: [],
      index: 0,
      into: rng() * 6,
      cycle: 0,
      carry: false,
      cargo: false,
      fork: 0.15,
      robot: { x: work.x, z: work.z, yaw: Math.PI },
      lift: { x: park.x, z: park.z, yaw: Math.PI },
      robotYaw: Math.PI,
      liftYaw: Math.PI,
      pose: POSE.WORK,
      seated: !site,
    };
    walker.steps = planOf(walker);
    return walker;
  };

  /** The pose an agent holds when it is not walking or driving: its state says it. */
  const restingPose = (walker: Walker, time: number): Pose => {
    switch (walker.placement.view.state) {
      case AGENT_STATE.WAITING:
        return time === 0 || (time + walker.into) % 6 < 2.4 ? POSE.WAVE : POSE.IDLE;
      case AGENT_STATE.STUCK:
      case AGENT_STATE.FAILED:
        return POSE.SLEEP;
      case AGENT_STATE.IDLE:
        return POSE.SIT;
      case AGENT_STATE.WORKING:
        return POSE.WORK;
    }
  };

  /** Advances `walker`'s round by `delta` and settles its robot's and forklift's places and pose. */
  const advance = (walker: Walker, delta: number, time: number) => {
    walker.into += delta;
    let step = walker.steps[walker.index];
    for (
      let guard = 0;
      step !== undefined && walker.into >= step.duration && guard < 20;
      guard += 1
    ) {
      walker.into -= step.duration;
      if (step.pick === true) walker.carry = true;
      if (step.drop === true) walker.carry = false;
      if (step.kind === STEP.LOAD) walker.cargo = true;
      if (step.kind === STEP.DISMOUNT) {
        walker.cargo = false;
        walker.carry = true;
      }
      walker.index += 1;
      if (walker.index >= walker.steps.length) {
        walker.steps = planOf(walker);
        walker.index = 0;
      }
      step = walker.steps[walker.index];
    }
    if (step === undefined) return;
    const u = Number.isFinite(step.duration) ? clamp(walker.into / step.duration, 0, 1) : 0;
    const { robot, lift } = walker;
    let pose: Pose = restingPose(walker, time);
    let seated = walker.placement.view.state === AGENT_STATE.IDLE;
    switch (step.kind) {
      case STEP.WORK:
        robot.x = walker.work.x;
        robot.z = walker.work.z;
        robot.yaw = Math.PI;
        break;
      case STEP.WALK:
        step.path?.at(u * step.path.length, scratch.out);
        robot.x = scratch.out.x;
        robot.z = scratch.out.z;
        robot.yaw = scratch.out.yaw;
        pose = POSE.WALK;
        break;
      case STEP.IDLE:
        pose =
          step.pick === true
            ? u < 0.7
              ? POSE.PICK
              : POSE.IDLE
            : step.drop === true
              ? u < 0.6
                ? POSE.PICK
                : POSE.IDLE
              : POSE.IDLE;
        break;
      case STEP.MOUNT:
      case STEP.DISMOUNT:
        pose = POSE.IDLE;
        seated = step.kind === STEP.MOUNT ? u > 0.5 : u < 0.5;
        break;
      case STEP.DRIVE:
        step.path?.at(u * step.path.length, scratch.out);
        lift.x = scratch.out.x;
        lift.z = scratch.out.z;
        lift.yaw = scratch.out.yaw;
        seated = true;
        walker.fork = step.cargo === true ? 0.75 : 0.15;
        break;
      case STEP.LOAD:
        seated = true;
        walker.fork = lerp(0.15, 0.75, u * u * (3 - 2 * u));
        if (u > 0.4) walker.cargo = true;
        break;
    }
    if (step.kind === STEP.WORK || step.kind === STEP.WALK || step.kind === STEP.IDLE) {
      lift.x = lerp(lift.x, walker.park.x, 0.2);
      lift.z = lerp(lift.z, walker.park.z, 0.2);
      lift.yaw = Math.PI;
      walker.fork = 0.15;
    }
    if (step.kind === STEP.DISMOUNT && u > 0.5) walker.cargo = false;
    walker.pose = seated ? POSE.SIT : pose;
    walker.seated = seated;
  };

  const turnToward = (from: number, to: number, t: number) => {
    let d = to - from;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return from + d * t;
  };

  /** Copies every walker's rig into the instances, at `time` and `scale`. */
  const pose = (delta: number, time: number, scale: number) => {
    drawn.forEach((walker, index) => {
      const site = siteKindOf(walker.placement.view.kind);
      walker.liftYaw =
        delta === 0
          ? walker.lift.yaw
          : turnToward(walker.liftYaw, walker.lift.yaw, Math.min(1, delta * 7));
      fork.root.position.set(walker.lift.x, 0.24, walker.lift.z);
      fork.root.rotation.set(0, walker.liftYaw, 0);
      fork.root.scale.setScalar(1.3 * scale);
      fork.forks.position.y = walker.fork;
      fork.root.updateMatrixWorld(true);
      F.body.setMatrixAt(index, fork.root.matrixWorld);
      F.forks.setMatrixAt(index, fork.forks.matrixWorld);
      F.cargo.setMatrixAt(index, walker.cargo ? fork.forks.matrixWorld : hidden);
      if (walker.seated) {
        fork.seat.getWorldPosition(scratch.vector);
        walker.robot.x = scratch.vector.x;
        walker.robot.z = scratch.vector.z;
      }
      walker.robotYaw =
        delta === 0
          ? walker.robot.yaw
          : turnToward(walker.robotYaw, walker.robot.yaw, Math.min(1, delta * 10));
      rig.root.position.set(
        walker.robot.x,
        walker.seated ? scratch.vector.y : 0.24,
        walker.robot.z,
      );
      rig.root.rotation.set(0, walker.seated ? walker.liftYaw : walker.robotYaw, 0);
      rig.root.scale.setScalar(1.4 * scale);
      poseRig(rig, walker.pose, time === 0 ? 0 : time + index * 0.37, site, walker.carry);
      rig.root.updateMatrixWorld(true);
      W.torso.setMatrixAt(index, rig.body.matrixWorld);
      W.head.setMatrixAt(index, rig.head.matrixWorld);
      W.visor.setMatrixAt(index, rig.visor.matrixWorld);
      W.hat.setMatrixAt(index, rig.hat.matrixWorld);
      W.legs.setMatrixAt(index * 2, rig.legL.matrixWorld);
      W.legs.setMatrixAt(index * 2 + 1, rig.legR.matrixWorld);
      W.arms.setMatrixAt(index * 2, rig.armL.matrixWorld);
      W.arms.setMatrixAt(index * 2 + 1, rig.armR.matrixWorld);
      const tool = site === SITE.FEAT ? W.torch : site === SITE.FIX ? W.wrench : W.hammer;
      const holding = (walker.pose === POSE.WORK || walker.pose === POSE.IDLE) && !walker.carry;
      for (const each of [W.torch, W.wrench, W.hammer]) {
        each.setMatrixAt(index, each === tool && holding ? rig.tool.matrixWorld : hidden);
      }
      W.crate.setMatrixAt(index, walker.carry ? rig.crate.matrixWorld : hidden);
      scratch.matrix
        .makeScale(scale, scale, scale)
        .setPosition(walker.robot.x, 0.24, walker.robot.z);
      proxy.setMatrixAt(index, scratch.matrix);
    });
    chosen.forEach((walker, index) => {
      // Note that the pin flies clear of the agent's own scaffolding, and the ring lies above its site's pad.
      const lift = Math.max(walker.seated ? 5.8 : 4.8, walker.placement.size * 1.1 + 3.5);
      const bob = time === 0 ? 0 : Math.sin(time * 3) * 0.2;
      const pulse = time === 0 ? 1 : 1 + Math.sin(time * 4) * 0.08;
      scratch.matrix
        .makeScale(pulse * scale * 1.2, 1, pulse * scale * 1.2)
        .setPosition(walker.robot.x, 0.62, walker.robot.z);
      rings.setMatrixAt(index, scratch.matrix);
      scratch.matrix
        .makeRotationY(time * 2)
        .scale(scratch.vector.setScalar(scale))
        .setPosition(walker.robot.x, lift + bob * scale, walker.robot.z);
      pins.setMatrixAt(index, scratch.matrix);
    });
    for (const mesh of [...Object.values(W), ...Object.values(F), proxy, rings, pins])
      mesh.instanceMatrix.needsUpdate = true;
  };

  /** Places every site, its pallet, its flag, its crane, and a failed one's beacon; these stand still. */
  const raise = (time: number) => {
    const counts = new Map<SiteKind, number>(SITE_KINDS.map((kind) => [kind, 0]));
    siteOrder = new Map(SITE_KINDS.map((kind) => [siteMeshes.get(kind) ?? proxy, []]));
    let crates = 0;
    let flags = 0;
    let cranes = 0;
    let lights = 0;
    for (const walker of drawn) {
      const { placement } = walker;
      const view = placement.view;
      if (!raisesSite(view.state)) continue;
      const kind = siteKindOf(view.kind);
      const mesh = siteMeshes.get(kind);
      if (mesh === undefined) continue;
      const index = counts.get(kind) ?? 0;
      counts.set(kind, index + 1);
      siteOrder.get(mesh)?.push(view);
      const s = placement.size;
      const k = s / SITE_REFERENCE;
      scratch.matrix.makeScale(k, k, k).setPosition(placement.x, 0.24, placement.z);
      mesh.setMatrixAt(index, scratch.matrix);
      const lines = Math.expm1(view.buildSize * Math.log1p(5000));
      const stack = clamp(Math.round(Math.log2(lines / 15 + 1)), 1, MAX_PALLET);
      const px = placement.x + (SITE_REFERENCE / 2 + 1.1) * k;
      const pz = placement.z - SITE_REFERENCE * 0.15 * k;
      for (let crate = 0; crate < stack && crates < MAX * MAX_PALLET; crate += 1) {
        const lx = (crate % 2) - 0.5;
        const lz = (Math.floor(crate / 2) % 2) - 0.5;
        const ly = Math.floor(crate / 4);
        scratch.matrix.makeTranslation(px + lx * 0.6, 0.24 + 0.26 + ly * 0.55, pz + lz * 0.6);
        pallet.setMatrixAt(crates, scratch.matrix);
        pallet.setColorAt(crates, crate % 3 ? col("#ffffff") : shade("#ffffff", 0.85));
        crates += 1;
      }
      const fx = placement.x - s / 2 - 0.5;
      const fz = placement.z + s / 2 + 0.3;
      const halfMast = view.state === AGENT_STATE.STUCK || view.state === AGENT_STATE.FAILED;
      const flagScale = Math.max(1, lastScale * 0.6);
      scratch.matrix.makeScale(flagScale, flagScale, flagScale).setPosition(fx, 0.24, fz);
      poles.setMatrixAt(flags, scratch.matrix);
      const sway = time === 0 ? 0.2 : Math.sin(time * 2.2 + flags) * 0.35;
      scratch.matrix
        .makeRotationY(sway)
        .scale(scratch.vector.setScalar(flagScale))
        .setPosition(fx, 0.24 + (halfMast ? 3.0 : 5.1) * flagScale, fz);
      cloths.setMatrixAt(flags, scratch.matrix);
      cloths.setColorAt(
        flags,
        col(view.state === AGENT_STATE.FAILED ? signal.DEFECT : signal.BUILDING),
      );
      flags += 1;
      if (view.buildSize >= CRANE_FROM) {
        const cx = placement.x - s / 2 - 0.4;
        const cz = placement.z - s / 2 - 0.2;
        scratch.matrix.makeTranslation(cx, 0.24, cz);
        masts.setMatrixAt(cranes, scratch.matrix);
        const swing = Math.sin(time * 0.18 + flags) * 1.4;
        scratch.matrix.makeRotationY(swing).setPosition(cx, 0.24 + CRANE_HEIGHT + 0.4, cz);
        jibs.setMatrixAt(cranes, scratch.matrix);
        cranes += 1;
      }
      if (view.state === AGENT_STATE.FAILED) {
        const pulse = time === 0 ? 1 : 0.8 + 0.4 * Math.abs(Math.sin(time * 6));
        scratch.matrix
          .makeScale(pulse, pulse, pulse)
          .setPosition(placement.x, 0.24 + s * 0.9 + 0.6, placement.z);
        beacons.setMatrixAt(lights, scratch.matrix);
        lights += 1;
      }
    }
    for (const [kind, mesh] of siteMeshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
    pallet.count = crates;
    poles.count = flags;
    cloths.count = flags;
    masts.count = cranes;
    jibs.count = cranes;
    beacons.count = lights;
    for (const mesh of [pallet, poles, cloths, masts, jibs, beacons]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
  };

  const paint = (isChosen: (agent: AgentView) => boolean) => {
    drawn.forEach((walker, index) => {
      const view = walker.placement.view;
      const body = isChosen(view)
        ? col(signal.SELECTION)
        : view.state === AGENT_STATE.FAILED
          ? col(signal.DEFECT)
          : view.state === AGENT_STATE.IDLE
            ? idleGrey
            : col(signal.BUILDING);
      W.torso.setColorAt(index, body);
      W.hat.setColorAt(index, scratch.tint.copy(body).lerp(col("#ffffff"), 0.2));
      W.head.setColorAt(index, col("#eef1f4"));
    });
    for (const mesh of [W.torso, W.hat, W.head]) {
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    group,
    show: (placements, isChosen, layout) => {
      const layoutChanged = layout !== currentLayout;
      currentLayout = layout;
      const next = new Map<string, Walker>();
      for (const placement of placements) {
        const before = walkers.get(placement.view.id);
        const same =
          before !== undefined &&
          !layoutChanged &&
          before.placement.x === placement.x &&
          before.placement.z === placement.z &&
          before.placement.size === placement.size &&
          before.placement.view.state === placement.view.state &&
          before.placement.lot === placement.lot &&
          before.placement.deliveries.length === placement.deliveries.length &&
          before.placement.deliveries.every((lot, index) => placement.deliveries[index] === lot);
        if (same && before !== undefined) {
          next.set(placement.view.id, { ...before, placement });
          continue;
        }
        next.set(placement.view.id, walkerOf(placement));
      }
      walkers = next;
      drawn = placements.flatMap((placement) => next.get(placement.view.id) ?? []);
      chosen = drawn.filter((walker) => isChosen(walker.placement.view));
      const count = drawn.length;
      for (const mesh of [...Object.values(W), ...Object.values(F), proxy]) {
        mesh.count = mesh === W.legs || mesh === W.arms ? count * 2 : count;
        mesh.visible = count > 0;
      }
      rings.count = chosen.length;
      pins.count = chosen.length;
      rings.visible = chosen.length > 0;
      pins.visible = chosen.length > 0;
      paint(isChosen);
      raise(lastTime);
      for (const walker of drawn) advance(walker, 0, 0);
      pose(0, lastTime, lastScale);
    },
    step: (delta, time, scale) => {
      lastScale = scale;
      lastTime = time;
      for (const walker of drawn) advance(walker, delta, time);
      pose(delta, time, scale);
      raise(time);
    },
    rest: () => {
      lastTime = 0;
      for (const walker of drawn) {
        walker.index = 0;
        walker.into = 0;
        walker.carry = false;
        walker.cargo = false;
        walker.lift.x = walker.park.x;
        walker.lift.z = walker.park.z;
        advance(walker, 0, 0);
      }
      pose(0, 0, lastScale);
      raise(0);
    },
    strikes: () =>
      drawn.flatMap((walker, index) => {
        if (walker.pose !== POSE.WORK || walker.placement.view.state !== AGENT_STATE.WORKING)
          return [];
        const site = siteKindOf(walker.placement.view.kind);
        // Note that the tool strikes an arm's length in front of the robot, low for a kneeling welder.
        const reach = 0.9 * 1.4 * lastScale;
        return [
          {
            x: walker.robot.x + Math.sin(walker.robotYaw) * reach,
            y: 0.24 + (site === SITE.FEAT ? 0.7 : 1.1) * 1.4 * lastScale,
            z: walker.robot.z + Math.cos(walker.robotYaw) * reach,
            site,
            phase: index * 0.37,
          },
        ];
      }),
    agentAt: (index) => drawn[index]?.placement.view,
    proxy,
    sites: [...siteMeshes.values()],
    siteAgentAt: (mesh, index) => siteOrder.get(mesh)?.[index],
  };
}
