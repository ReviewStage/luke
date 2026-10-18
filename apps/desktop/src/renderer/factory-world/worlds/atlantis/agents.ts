import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { AGENT_KIND, AGENT_STATE, type AgentState, type AgentView } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Quaternion,
  type Scene,
  SphereGeometry,
  Vector3,
} from "three";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { CITY, type CityLayout, DISTRICT_KIND, type District } from "./city";
import {
  clamp,
  easeInOut,
  geodesicDome,
  latticeTower,
  lerp,
  merged,
  painted,
  seabedHeightAt,
  seededRandom,
  smoothstep,
  unitHashOf,
} from "./geometry";
import { DOME_MODE, type DomeMode, domeLookOf, domesOf } from "./glass";
import { type Sea, TAU } from "./sea";
import { type Billboards, PARTICLE_KIND, PARTICLE_LAYER, type Particles } from "./sprites";

/**
 * agents.ts -- the coding agents as Atlantis draws them: divers in brass helmets building glass domes beside the zones they work in, a crane over a large build and a submarine over the largest, each standing as its state says.
 *
 * A diver's dome is its pull request, as large as its lines, rising panel
 * by panel, swept by a band where it refactors, flickering where it fixes.
 * At work it welds or hammers, sparks flying, and now and then swims off
 * to the other zones its pull request touches and back. Waiting on the
 * developer, it stands with its arms folded looking about; stuck, it sits
 * slumped by a dome gone still under a warning lamp; failed, it kneels by a
 * dome flickering the defect's red; idle, it rests on its slab with no dome
 * at all. Held still, every one of those reads in its pose alone.
 *
 * A diver is drawn in parts, each one instanced mesh at the snapshot's
 * bound of agents, posed on the CPU each frame. An agent is picked by its
 * site and by its diver, wherever it has swum.
 */

const AGENTS = FACTORY_WORLD_BOUNDS.MAX_AGENTS;
const DIVER_SCALE = 1.25;

/** Builds past these sizes raise a crane, and a submarine over the largest. */
const CRANE_AT = 0.77;
const SUB_AT = 0.95;

/** The reference crane parts, which each crane scales to its site. */
const CRANE = { MAST: 12, JIB: 10 } as const;

/** The suit each state is drawn in where no signal says otherwise. */
const SUIT = { STUCK: "#9aa9b0", IDLE: "#c9d3d6" } as const;

/** Agents at work, drawn. */
export interface Agents {
  /** Places `agents` over `layout`; `chosen` says which the developer selected or hovers. */
  readonly draw: (
    layout: CityLayout,
    agents: readonly AgentView[],
    shown: (agent: AgentView) => boolean,
    chosen: (id: string) => boolean,
    selected: string | undefined,
    elapsed: number,
    moving: boolean,
  ) => void;
  /** Poses every diver, crane and submarine at `elapsed`, and makes their bubbles and sparks. */
  readonly step: (
    delta: number,
    elapsed: number,
    particles: Particles,
    pings: (centre: Vector3) => void,
  ) => void;
  readonly paint: (glows: Billboards, elapsed: number, moving: boolean) => void;
}

/** One agent as placed. */
interface Diver {
  readonly view: AgentView;
  readonly state: AgentState;
  readonly centre: Vector3;
  readonly radius: number;
  readonly bearing: number;
  readonly seed: number;
  readonly mode: DomeMode;
  readonly fill: number;
  readonly away: readonly District[];
  readonly cycle: number;
  readonly crane: boolean;
  readonly sub: boolean;
  picked: boolean;
  hopAt: number;
  greet: number;
  bubbles: number;
  sparks: number;
  readonly at: Vector3;
  readonly head: Vector3;
  readonly tip: Vector3;
  working: boolean;
}

/** Where a diver works, swims and looks, and how far into a swim it is. */
interface Pose {
  readonly at: Vector3;
  readonly look: Vector3;
  readonly heading: Vector3 | undefined;
  readonly swim: number;
  readonly working: boolean;
  readonly away: boolean;
}

function domeModeOf(view: AgentView): DomeMode {
  if (view.state === AGENT_STATE.FAILED) return DOME_MODE.FLICKERING;
  if (view.state !== AGENT_STATE.WORKING) return DOME_MODE.RISING;
  if (view.kind === AGENT_KIND.REFACTOR) return DOME_MODE.SWEEPING;
  if (view.kind === AGENT_KIND.FIX) return DOME_MODE.FLICKERING;
  return DOME_MODE.RISING;
}

/** A site's radius by its build's size: a small dome before a pull request, a large one at `BUILD_FULL_LINES`. */
function siteRadiusOf(view: AgentView): number {
  return 1.6 + 4.6 * view.buildSize;
}

/** Where an agent's dome stands, and its bearing from what it builds round. */
interface Site {
  readonly centre: Vector3;
  readonly bearing: number;
}

/** Where a diver hovers to work at another of its zones, and what it faces there. */
interface Visit {
  readonly at: Vector3;
  readonly look: Vector3;
}

/** Where the agents of one district set their sites: round its edge, out from the heart, the largest at the front. */
function sitesRound(district: District, divers: readonly AgentView[]): Map<string, Site> {
  const core = district.kind === DISTRICT_KIND.CRYSTAL;
  const from = core ? new Vector3() : district.centre;
  const base = core
    ? CITY.DOME_RADIUS + 8.5
    : district.kind === DISTRICT_KIND.DOME
      ? district.radius + 2.4
      : district.radius * 1.25 + 4.5;
  const sites = new Map<string, Site>();
  let left = district.bearing;
  let right = district.bearing;
  [...divers]
    .sort((a, b) => b.buildSize - a.buildSize || (a.id < b.id ? -1 : 1))
    .forEach((view, order) => {
      const radius = siteRadiusOf(view);
      const ring = base + radius + 1.6;
      const half = (radius + 1.4) / ring;
      let bearing: number;
      if (order === 0) {
        bearing = district.bearing;
        left = bearing - half;
        right = bearing + half;
      } else if (order % 2 === 1) {
        bearing = right + half;
        right = bearing + half;
      } else {
        bearing = left - half;
        left = bearing - half;
      }
      const centre = new Vector3(
        from.x + Math.cos(bearing) * ring,
        0,
        from.z + Math.sin(bearing) * ring,
      );
      centre.y = Math.max(0.1, seabedHeightAt(centre.x, centre.z)) + 0.35;
      sites.set(view.id, { centre, bearing });
    });
  return sites;
}

/** Where an agent with no zone works: round the plaza, by its id. */
function siteOnPlaza(view: AgentView, order: number): Site {
  const bearing = order * 2.39996 + unitHashOf(view.id);
  const out = CITY.DOME_RADIUS + 24;
  const centre = new Vector3(Math.cos(bearing) * out, 0, Math.sin(bearing) * out);
  centre.y = Math.max(0.1, seabedHeightAt(centre.x, centre.z)) + 0.35;
  return { centre, bearing };
}

/** Where a diver hovers to work at another of its zones, coming from `from`. */
function visitOf(district: District, from: Vector3): Visit {
  if (district.kind === DISTRICT_KIND.CRYSTAL) {
    const out = new Vector3(from.x, 0, from.z).normalize();
    const at = out.multiplyScalar(CITY.DOME_RADIUS + 1.6).setY(8 + (district.radius % 3) * 2);
    return { at, look: new Vector3(0, at.y, 0) };
  }
  const out = new Vector3(from.x - district.centre.x, 0, from.z - district.centre.z).normalize();
  const reach =
    district.kind === DISTRICT_KIND.DOME
      ? district.radius * 0.8 + 1.6
      : district.radius * 1.05 + 1.2;
  const at = district.centre.clone().addScaledVector(out, reach);
  at.y =
    district.kind === DISTRICT_KIND.DOME
      ? district.base + district.radius * 0.55
      : district.base + 1.5;
  return { at, look: new Vector3(district.centre.x, at.y, district.centre.z) };
}

/** The diver's parts, each an instanced mesh. */
function diverParts(sea: Sea, add: (mesh: InstancedMesh) => InstancedMesh) {
  const suit = sea.standard({ color: "#ffffff", roughness: 0.62 }, { caustic: 0.6 });
  const brass = sea.standard(
    { color: "#e0aa52", roughness: 0.35, metalness: 0.45 },
    { caustic: 0.6 },
  );
  const visor = new MeshStandardMaterial({
    color: "#06161c",
    emissive: "#41dcff",
    emissiveIntensity: 1.1,
    roughness: 0.1,
    metalness: 0.3,
  });
  const steel = sea.standard(
    { color: "#c7d3d6", roughness: 0.3, metalness: 0.85 },
    { caustic: 0.6 },
  );
  const rubber = sea.standard({ color: "#1d2a30", roughness: 0.5 }, { caustic: 0.4 });
  const torch = new MeshStandardMaterial({ color: "#262c30", roughness: 0.4, metalness: 0.7 });
  const mesh = (
    geometry: ConstructorParameters<typeof InstancedMesh>[0],
    material: Material,
    count: number,
  ) => add(new InstancedMesh(geometry, material, count));
  return {
    torso: mesh(new CapsuleGeometry(0.3, 0.42, 4, 12), suit, AGENTS),
    helmet: mesh(
      merged([
        new SphereGeometry(0.36, 20, 14),
        new CylinderGeometry(0.3, 0.36, 0.14, 16).translate(0, -0.28, 0),
      ]),
      brass,
      AGENTS,
    ),
    visor: mesh(
      merged([
        new SphereGeometry(0.2, 14, 10).scale(1.05, 1, 0.5).translate(0, 0.02, 0.25),
        new SphereGeometry(0.2, 14, 10).scale(0.35, 0.6, 0.6).translate(0.26, 0, 0.05),
        new SphereGeometry(0.2, 14, 10).scale(0.35, 0.6, 0.6).translate(-0.26, 0, 0.05),
      ]),
      visor,
      AGENTS,
    ),
    tank: mesh(new CapsuleGeometry(0.15, 0.48, 4, 10), steel, AGENTS),
    arm: mesh(new CapsuleGeometry(0.095, 0.44, 4, 8).translate(0, -0.3, 0), suit, AGENTS * 2),
    leg: mesh(new CapsuleGeometry(0.115, 0.5, 4, 8).translate(0, -0.36, 0), suit, AGENTS * 2),
    fin: mesh(new BoxGeometry(0.3, 0.035, 0.55).translate(0, 0, 0.18), rubber, AGENTS * 2),
    torch: mesh(new CylinderGeometry(0.05, 0.07, 0.42, 6).translate(0, 0.21, 0), torch, AGENTS),
  };
}

/** A submarine's hull, tower and fins in one shape, nose to +z. */
function subBodyGeometry(hull: Color) {
  const fin = new Color("#e7eef0");
  return merged(
    [
      painted(new CapsuleGeometry(1.1, 2.6, 6, 16).rotateX(Math.PI / 2), hull),
      painted(new BoxGeometry(0.7, 0.9, 1.3).translate(0, 1.2, -0.3), hull),
      painted(new BoxGeometry(3, 0.12, 0.7).translate(0, 0, -2.1), fin),
      painted(new BoxGeometry(0.12, 1.6, 0.7).translate(0, 0, -2.1), fin),
    ],
    ["position", "normal", "color", "aLit"],
  );
}

/** A crane's jib, with its counterweight, reaching along +x from its pivot. */
function jibGeometry() {
  const jib = latticeTower(0.6, CRANE.JIB + 3, 1, true)
    .rotateZ(-Math.PI / 2)
    .translate(-3, 0, 0);
  const steel = new Color("#f0a52e");
  return merged(
    [
      painted(jib, steel),
      painted(new BoxGeometry(1.6, 1.2, 1.2).translate(-2.6, -0.2, 0), new Color("#2c3d44")),
    ],
    ["position", "normal", "color", "aLit"],
  );
}

/** The agents in `scene`, picked through `picking`, seen through `camera`. */
export function agentsOf(
  scene: Scene,
  sea: Sea,
  picking: WorldPicking,
  camera: PerspectiveCamera,
): Agents {
  const building = new Color(sea.signal.BUILDING);
  const defect = new Color(sea.signal.DEFECT);
  const selection = new Color(sea.signal.SELECTION);
  const meshes: InstancedMesh[] = [];
  const add = (mesh: InstancedMesh) => {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    meshes.push(mesh);
    scene.add(mesh);
    return mesh;
  };

  const sites = domesOf(sea, geodesicDome(3), AGENTS, {
    opacity: 0.05,
    strutWidth: 0.022,
    strut: "#86f0ff",
    strutGain: 0.55,
  });
  scene.add(sites.mesh);
  const slabs = add(
    new InstancedMesh(
      new CylinderGeometry(1.06, 1.18, 0.6, 40, 1),
      sea.standard({ color: "#ffffff", roughness: 0.55, metalness: 0.5 }, { caustic: 0.8 }),
      AGENTS,
    ),
  );
  slabs.receiveShadow = true;
  const parts = diverParts(sea, add);
  const steel = sea.standard(
    { vertexColors: true, roughness: 0.5, metalness: 0.45 },
    { caustic: 0.7, lit: true },
  );
  const masts = add(
    new InstancedMesh(
      latticeTower(0.9, CRANE.MAST, 1.1, true),
      sea.standard({ color: "#f0a52e", roughness: 0.5, metalness: 0.45 }, { caustic: 0.7 }),
      AGENTS,
    ),
  );
  const jibs = add(new InstancedMesh(jibGeometry(), steel, AGENTS));
  const cables = add(
    new InstancedMesh(
      new CylinderGeometry(0.04, 0.04, 1, 4).translate(0, -0.5, 0),
      new MeshBasicMaterial({ color: "#0d1a1f" }),
      AGENTS,
    ),
  );
  const loads = add(
    new InstancedMesh(new BoxGeometry(1, 0.25, 0.7), new MeshBasicMaterial(), AGENTS),
  );
  const hulls = add(
    new InstancedMesh(
      subBodyGeometry(new Color(building).lerp(new Color("#ffd27a"), 0.35)),
      steel,
      AGENTS,
    ),
  );
  const portholes = add(
    new InstancedMesh(
      new SphereGeometry(0.85, 16, 12).scale(1, 0.9, 0.8).translate(0, 0, 2.1),
      new MeshStandardMaterial({
        color: "#0d2a33",
        emissive: "#4fe3ff",
        emissiveIntensity: 0.9,
        metalness: 0.2,
        roughness: 0.05,
      }),
      AGENTS,
    ),
  );
  const propellers = add(
    new InstancedMesh(
      merged(
        Array.from({ length: 4 }, (_, blade) =>
          new BoxGeometry(0.16, 0.9, 0.06)
            .translate(0, 0.45, 0)
            .rotateY(0.4)
            .rotateZ((blade / 4) * TAU),
        ),
      ),
      sea.standard({ color: "#e7eef0", roughness: 0.5, metalness: 0.3 }),
      AGENTS,
    ),
  );
  const searchlights = add(
    new InstancedMesh(
      new ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0),
      sea.shader(
        {},
        /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
void main(){ vUv = uv; vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix*instanceMatrix)*normal); vV = cameraPosition - w.xyz; vec4 mv = viewMatrix*w; vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`,
        /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth;
void main(){ float core = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); float a = pow(1.0 - vUv.y, 1.6)*core*0.25; gl_FragColor = vec4(vec3(0.75,0.97,1.0)*a*(1.0-fogF(vDepth)*0.7), 1.0); }`,
        { transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide },
      ),
      AGENTS,
    ),
  );
  searchlights.renderOrder = 6;
  const proxies = add(
    new InstancedMesh(
      new IcosahedronGeometry(1, 1),
      new MeshBasicMaterial({ visible: false }),
      AGENTS,
    ),
  );
  // Note that only the parts large enough to throw a shadow worth seeing cast one, so the shadow pass stays a handful of draws.
  for (const mesh of [parts.torso, parts.helmet, masts, hulls]) mesh.castShadow = true;
  let siteTargets: PickTarget[] = [];
  picking.addInstances(proxies, (instanceId) => siteTargets[instanceId]);
  picking.addInstances(parts.torso, (instanceId) => siteTargets[instanceId]);
  picking.addInstances(parts.helmet, (instanceId) => siteTargets[instanceId]);

  let divers: Diver[] = [];
  let cranes: Diver[] = [];
  let subs: Diver[] = [];
  let selectedId: string | undefined;
  const matrix = new Matrix4();
  const body = new Matrix4();
  const part = new Matrix4();
  const local = new Matrix4();
  const shoulder = new Matrix4();
  const turn = new Quaternion();
  const spin = new Quaternion();
  const facing = new Quaternion();
  const swimming = new Quaternion();
  const size = new Vector3();
  const at = new Vector3();
  const look = new Vector3();
  const side = new Vector3();
  const up = new Vector3(0, 1, 0);
  const velocity = new Vector3();
  const tint = new Color();
  const dome = domeLookOf();
  const white = new Color("#ffffff");
  const bubble = new Color("#bff6ff");
  const hot = new Color("#fff3d0");
  const nextRandom = seededRandom(5150);

  const suitOf = (diver: Diver) => {
    switch (diver.state) {
      case AGENT_STATE.FAILED:
        return tint.copy(defect);
      case AGENT_STATE.STUCK:
        return tint.set(SUIT.STUCK);
      case AGENT_STATE.IDLE:
        return tint.set(SUIT.IDLE);
      default:
        return tint.copy(building).lerp(white, 0.3);
    }
  };

  /** Where `diver` works on its dome at `elapsed`. */
  const workPose = (diver: Diver, elapsed: number, moving: boolean): Pose => {
    const sway = moving ? elapsed : 0;
    const height =
      diver.state !== AGENT_STATE.WORKING
        ? 0.1
        : clamp(
            diver.mode === DOME_MODE.RISING
              ? diver.fill
              : diver.mode === DOME_MODE.SWEEPING
                ? (sway * 0.045 + diver.seed) % 1
                : 0.45,
            0.08,
            0.9,
          );
    const lean = Math.asin(height);
    const bearing =
      diver.bearing +
      Math.PI +
      0.9 * Math.sin(sway * 0.05 + diver.seed * 20) +
      (diver.seed - 0.5) * 2;
    const reach =
      diver.state === AGENT_STATE.IDLE ? 0 : diver.radius * Math.cos(lean) + 0.75 * DIVER_SCALE;
    const pose = new Vector3(
      diver.centre.x + Math.cos(bearing) * reach,
      diver.centre.y + (diver.state === AGENT_STATE.IDLE ? 0.3 : diver.radius * height - 0.7),
      diver.centre.z + Math.sin(bearing) * reach,
    );
    const target =
      diver.state === AGENT_STATE.IDLE
        ? pose.clone().add(new Vector3(Math.cos(diver.bearing), 0, Math.sin(diver.bearing)))
        : new Vector3(diver.centre.x, pose.y, diver.centre.z);
    return { at: pose, look: target, heading: undefined, swim: 0, working: true, away: false };
  };

  /**
   * Where `diver` is at `elapsed`. Note that a diver's whole day is a pure
   * function of the clock, so a still frame, a scrub and the first frame
   * agree on where it is without anything kept between them.
   */
  const poseOf = (diver: Diver, elapsed: number, moving: boolean): Pose => {
    const work = workPose(diver, elapsed, moving);
    if (
      !moving ||
      diver.away.length === 0 ||
      diver.view.id === selectedId ||
      diver.state !== AGENT_STATE.WORKING
    ) {
      return work;
    }
    const visiting =
      diver.away[Math.floor((elapsed + diver.seed * 100) / (diver.cycle * 2)) % diver.away.length];
    if (visiting === undefined) return work;
    const visit = visitOf(visiting, diver.centre);
    const distance = work.at.distanceTo(visit.at);
    const travel = 2 + distance / 7.5;
    const stay = 7;
    const period = diver.cycle + travel * 2 + stay;
    const k = (elapsed + diver.seed * 100) % period;
    if (k < diver.cycle) return work;
    const arc = (u: number, from: Vector3, to: Vector3) => {
      const middle = from.clone().add(to).multiplyScalar(0.5);
      middle.y = Math.max(from.y, to.y) + 6 + distance * 0.12;
      const point = from
        .clone()
        .multiplyScalar((1 - u) ** 2)
        .addScaledVector(middle, 2 * u * (1 - u))
        .addScaledVector(to, u * u);
      const heading = middle
        .clone()
        .sub(from)
        .multiplyScalar(2 * (1 - u))
        .addScaledVector(to.clone().sub(middle), 2 * u);
      return { point, heading };
    };
    if (k < diver.cycle + travel) {
      const u = easeInOut((k - diver.cycle) / travel);
      const { point, heading } = arc(u, work.at, visit.at);
      return {
        at: point,
        look: point.clone().add(heading),
        heading,
        swim: Math.min(smoothstep(0, 0.12, u), smoothstep(1, 0.88, u)),
        working: false,
        away: false,
      };
    }
    if (k < diver.cycle + travel + stay)
      return {
        at: visit.at,
        look: visit.look,
        heading: undefined,
        swim: 0,
        working: true,
        away: true,
      };
    const u = easeInOut((k - diver.cycle - travel - stay) / travel);
    const { point, heading } = arc(u, visit.at, work.at);
    return {
      at: point,
      look: point.clone().add(heading),
      heading,
      swim: Math.min(smoothstep(0, 0.12, u), smoothstep(1, 0.88, u)),
      working: false,
      away: false,
    };
  };

  const setPart = (mesh: InstancedMesh, index: number, ...locals: readonly Matrix4[]) => {
    part.copy(body);
    for (const one of locals) part.multiply(one);
    mesh.setMatrixAt(index, part);
    return part;
  };
  // Note that a part's local transforms come from a ring of four scratch matrices, since no pose takes more than three at once, so posing a hundred divers a frame allocates nothing.
  const scratch = [new Matrix4(), new Matrix4(), new Matrix4(), new Matrix4()] as const;
  let scratchTurn = 0;
  const nextScratch = () => {
    scratchTurn = (scratchTurn + 1) % scratch.length;
    return scratch[scratchTurn] ?? scratch[0];
  };
  const translation = (x: number, y: number, z: number) => nextScratch().makeTranslation(x, y, z);
  const rotationX = (angle: number) => nextScratch().makeRotationX(angle);
  const rotationZ = (angle: number) => nextScratch().makeRotationZ(angle);
  const rotationY = (angle: number) => nextScratch().makeRotationY(angle);

  /** Poses one diver's parts at `elapsed`, and answers whether it is at work there. */
  const poseDiver = (
    diver: Diver,
    index: number,
    elapsed: number,
    delta: number,
    moving: boolean,
  ) => {
    const pose = poseOf(diver, elapsed, moving);
    const still = !moving;
    const greeting = diver.picked && pose.swim < 0.2 && diver.state !== AGENT_STATE.IDLE;
    diver.greet = still
      ? greeting
        ? 1
        : 0
      : lerp(diver.greet, greeting ? 1 : 0, 1 - Math.exp(-delta * 6));
    const bob = moving ? Math.sin(elapsed * 1.7 + diver.seed * 30) * 0.12 * (1 - pose.swim) : 0;
    const hop = moving ? Math.sin(clamp((elapsed - diver.hopAt) / 0.9, 0, 1) * Math.PI) * 1.8 : 0;
    diver.at.copy(pose.at);
    diver.at.y += bob + hop;
    const ahead = look.copy(pose.look).sub(pose.at).setY(0);
    if (diver.greet > 0.5) ahead.copy(camera.position).sub(pose.at).setY(0);
    if (ahead.lengthSq() < 1e-4) ahead.set(0, 0, 1);
    matrix.lookAt(at.set(0, 0, 0), ahead.normalize().negate(), up);
    facing.setFromRotationMatrix(matrix);
    const hopK = clamp((elapsed - diver.hopAt) / 0.9, 0, 1);
    if (moving && hopK < 1) facing.multiply(spin.setFromAxisAngle(up, easeInOut(hopK) * TAU));
    if (pose.heading !== undefined) {
      const heading = pose.heading.clone().normalize();
      const belly = new Vector3(0, -1, 0).addScaledVector(heading, heading.y);
      if (belly.lengthSq() < 1e-4) belly.set(0, 0, 1);
      belly.normalize();
      matrix.makeBasis(side.crossVectors(heading, belly).normalize(), heading, belly);
      swimming.setFromRotationMatrix(matrix);
    } else swimming.copy(facing);
    turn.slerpQuaternions(facing, swimming, pose.swim);
    // Note that a stuck or failed diver sits slumped, so the still frame says it stopped.
    const slumped = diver.state === AGENT_STATE.STUCK || diver.state === AGENT_STATE.FAILED;
    const resting = diver.state === AGENT_STATE.IDLE;
    if (slumped || resting)
      turn.multiply(spin.setFromAxisAngle(side.set(1, 0, 0), slumped ? 0.35 : -0.15));
    const sink = slumped ? -0.45 : resting ? -0.25 : 0;
    body.compose(at.copy(diver.at).setY(diver.at.y + sink), turn, size.setScalar(DIVER_SCALE));

    const glance = Math.sin((moving ? elapsed : 0) * 0.6 + diver.seed * 10);
    const waiting = diver.state === AGENT_STATE.WAITING;
    const headTurn = waiting ? glance * 0.6 : glance * 0.15 * (moving ? 1 : 0);
    const headDip = slumped
      ? 0.55
      : resting
        ? 0.1
        : -0.15 * (pose.working ? 1 : 0) * (1 - diver.greet) + headTurn * 0.3 - diver.greet * 0.25;
    setPart(parts.torso, index, translation(0, 0.45, 0));
    setPart(parts.helmet, index, translation(0, 1.2, 0), rotationY(headTurn), rotationX(headDip));
    setPart(parts.visor, index, translation(0, 1.2, 0), rotationY(headTurn), rotationX(headDip));
    setPart(parts.tank, index, translation(0, 0.58, -0.34));

    let right: number;
    let left: number;
    let rightOut = -0.12;
    let leftOut = 0.12;
    let strike = false;
    if (waiting && pose.working) {
      right = -1.15;
      left = -1.2;
      rightOut = 0.95;
      leftOut = -0.95;
    } else if (slumped || resting) {
      right = slumped ? 0.2 : -0.6;
      left = slumped ? 0.15 : -0.6;
      rightOut = slumped ? -0.25 : 0.4;
      leftOut = slumped ? 0.25 : -0.4;
    } else if (pose.working) {
      if (diver.mode === DOME_MODE.SWEEPING) {
        const swing = moving ? Math.max(0, Math.sin(elapsed * 4.2 + diver.seed * 9)) : 0.6;
        right = -0.5 - 1.25 * swing;
        strike = swing > 0.97;
      } else right = -1.3 + (moving ? Math.sin(elapsed * 13 + diver.seed) * 0.05 : 0);
      left = -0.85 + (moving ? Math.sin(elapsed * 1.3 + diver.seed) * 0.12 : 0);
    } else {
      right = lerp(-1.2, 0.25, pose.swim) + Math.sin(elapsed * 3) * 0.1;
      left = lerp(-0.8, 0.25, pose.swim) - Math.sin(elapsed * 3) * 0.1;
    }
    if (diver.greet > 0.01) {
      right = lerp(right, -2.75, diver.greet);
      rightOut = lerp(rightOut, -0.35 + (moving ? Math.sin(elapsed * 11) * 0.45 : 0), diver.greet);
      left = lerp(left, -0.2, diver.greet);
      leftOut = lerp(leftOut, 0.25, diver.greet);
    }
    shoulder.copy(
      setPart(
        parts.arm,
        index * 2,
        translation(-0.4, 0.82, 0),
        rotationX(right),
        rotationZ(rightOut),
      ),
    );
    setPart(
      parts.arm,
      index * 2 + 1,
      translation(0.4, 0.82, 0),
      rotationX(left),
      rotationZ(leftOut),
    );
    local
      .copy(shoulder)
      .multiply(translation(0, -0.64, 0.02))
      .multiply(rotationX(Math.PI * 0.5 + 0.9));
    parts.torch.setMatrixAt(index, local);
    diver.tip.set(0, 0.45, 0).applyMatrix4(local);

    const kick = resting
      ? 0
      : moving
        ? pose.swim > 0.3
          ? 0.55 * Math.sin(elapsed * 9 + diver.seed * 7)
          : 0.28 * Math.sin(elapsed * 2.1 + diver.seed * 7)
        : 0;
    for (const leg of [0, 1] as const) {
      const sideways = leg === 1 ? 0.15 : -0.15;
      const swing =
        (leg === 1 ? 1 : -1) * kick +
        (resting ? -1.35 : pose.working ? 0.15 : 0) +
        (slumped ? -0.9 : 0);
      const thigh = setPart(
        parts.leg,
        index * 2 + leg,
        translation(sideways, 0.05, 0),
        rotationX(swing),
      );
      local
        .copy(thigh)
        .multiply(translation(0, -0.8, 0))
        .multiply(rotationX(0.25));
      parts.fin.setMatrixAt(index * 2 + leg, local);
    }
    diver.head.set(0, 1.62, 0.1).applyMatrix4(body);
    diver.working =
      pose.working &&
      !slumped &&
      !resting &&
      !(waiting && pose.working) &&
      diver.greet < 0.5 &&
      diver.state === AGENT_STATE.WORKING;
    return strike;
  };

  /** Raises one crane over its site at `elapsed`. */
  const poseCrane = (diver: Diver, slot: number, elapsed: number, moving: boolean) => {
    const t = moving ? elapsed : 0;
    const height = diver.radius * 1.9 + 4.5;
    const reach = diver.radius * 1.25 + 3;
    const across = new Vector3(-Math.sin(diver.bearing), 0, Math.cos(diver.bearing));
    const foot = diver.centre.clone().addScaledVector(across, diver.radius + 1.8);
    const toSite = diver.centre.clone().sub(foot);
    const yaw = Math.atan2(-toSite.z, toSite.x);
    const sway = Math.sin(t * 0.18 + diver.seed * TAU) * 0.5;
    matrix.compose(foot, turn.setFromAxisAngle(up, yaw), size.setScalar(height / CRANE.MAST));
    masts.setMatrixAt(slot, matrix);
    const pivot = foot.clone().setY(foot.y + height);
    const scale = reach / CRANE.JIB;
    matrix.compose(pivot, turn.setFromAxisAngle(up, yaw + sway), size.setScalar(scale));
    jibs.setMatrixAt(slot, matrix);
    const tip = new Vector3(reach, 0, 0).applyQuaternion(turn).add(pivot);
    const drop =
      height -
      (diver.radius * (0.6 + 0.4 * diver.fill) + 1.2) +
      Math.sin(t * 0.5 + diver.seed * TAU) * 0.6;
    matrix.compose(tip, spin.identity(), size.set(1, drop, 1));
    cables.setMatrixAt(slot, matrix);
    matrix.compose(
      tip.setY(tip.y - drop - 0.2),
      spin.setFromAxisAngle(up, t * 0.2 + diver.seed * TAU),
      size.set(Math.min(3.5, diver.radius * 0.6), 1, Math.min(3.4, diver.radius * 0.65)),
    );
    loads.setMatrixAt(slot, matrix);
    loads.setColorAt(
      slot,
      tint.copy(diver.state === AGENT_STATE.FAILED ? defect : building).multiplyScalar(1.6),
    );
  };

  /** Circles one submarine over its site at `elapsed`. */
  const poseSub = (diver: Diver, slot: number, elapsed: number, moving: boolean) => {
    const t = moving ? elapsed : 0;
    const out = diver.radius * 0.7 + 2;
    const angle = t * 0.16 + diver.seed * TAU;
    const height = diver.centre.y + diver.radius * 1.3 + 9;
    at.set(
      diver.centre.x + Math.cos(angle) * out,
      height + Math.sin(t * 0.7) * 0.5,
      diver.centre.z + Math.sin(angle) * out,
    );
    turn
      .setFromAxisAngle(up, -angle)
      .multiply(spin.setFromAxisAngle(new Vector3(0, 0, 1), Math.sin(t * 0.5) * 0.05));
    body.compose(at, turn, size.setScalar(2.2));
    hulls.setMatrixAt(slot, body);
    portholes.setMatrixAt(slot, body);
    local
      .copy(body)
      .multiply(translation(0, 0, -2.65))
      .multiply(rotationZ(t * 8));
    propellers.setMatrixAt(slot, local);
    const reachDown = diver.centre.y - (at.y - 0.8 * 2.2);
    const width = diver.radius * 0.55 + 1;
    matrix.compose(
      look.copy(at).setY(at.y - 0.8 * 2.2),
      spin.setFromUnitVectors(up, side.copy(at).sub(diver.centre).normalize()),
      size.set(width, Math.abs(reachDown) + diver.radius, width),
    );
    searchlights.setMatrixAt(slot, matrix);
  };

  const finish = () => {
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };

  const placeSites = (elapsed: number, moving: boolean) => {
    let slot = 0;
    divers.forEach((diver, index) => {
      const fill = moving
        ? clamp(diver.fill + 0.06 * Math.sin(elapsed * 0.12 + diver.seed * 9), 0.08, 0.97)
        : diver.fill;
      matrix.compose(
        look.copy(diver.centre).setY(diver.centre.y - 0.3),
        turn.identity(),
        size.set(diver.radius * 1.04 + 0.25, 1, diver.radius * 1.04 + 0.25),
      );
      slabs.setMatrixAt(index, matrix);
      slabs.setColorAt(
        index,
        tint.set("#33464c").lerp(diver.state === AGENT_STATE.FAILED ? defect : building, 0.18),
      );
      if (diver.state === AGENT_STATE.IDLE) return;
      matrix.compose(diver.centre, turn.identity(), size.setScalar(diver.radius));
      dome.color.copy(diver.state === AGENT_STATE.FAILED ? defect : building);
      dome.highlight.copy(diver.picked ? selection : building);
      dome.fill = fill;
      dome.mode = diver.mode;
      dome.lit = diver.picked ? 1 : 0;
      dome.dim = diver.state === AGENT_STATE.STUCK ? 0.55 : 1;
      dome.steps = -1;
      dome.seed = diver.seed;
      sites.place(slot, matrix, dome);
      slot += 1;
    });
    sites.finish(slot);
  };

  const poseAll = (elapsed: number, delta: number, moving: boolean) => {
    const strikes = divers.map((diver, index) => poseDiver(diver, index, elapsed, delta, moving));
    cranes.forEach((diver, slot) => {
      poseCrane(diver, slot, elapsed, moving);
    });
    subs.forEach((diver, slot) => {
      poseSub(diver, slot, elapsed, moving);
    });
    placeSites(elapsed, moving);
    finish();
    return strikes;
  };

  return {
    draw: (layout, views, shown, chosen, selected, elapsed, moving) => {
      const previous = new Map(divers.map((diver) => [diver.view.id, diver]));
      const drawn = views.filter(shown).slice(0, AGENTS);
      const byDistrict = new Map<District, AgentView[]>();
      const homeless: AgentView[] = [];
      for (const view of drawn) {
        const district =
          view.primaryZone === null ? undefined : layout.byPath.get(view.primaryZone);
        if (district === undefined) homeless.push(view);
        else byDistrict.set(district, [...(byDistrict.get(district) ?? []), view]);
      }
      const placed = new Map<string, Site>();
      for (const [district, here] of byDistrict)
        for (const [id, site] of sitesRound(district, here)) placed.set(id, site);
      homeless.forEach((view, order) => {
        placed.set(view.id, siteOnPlaza(view, order));
      });
      const chose = selected !== undefined && selected !== selectedId;
      selectedId = selected;
      divers = drawn.map((view): Diver => {
        const site = placed.get(view.id) ?? siteOnPlaza(view, 0);
        const seed = unitHashOf(view.id);
        const before = previous.get(view.id);
        const away = view.touched
          .filter((zone) => zone.path !== view.primaryZone && zone.lines > 4)
          .slice(0, 2)
          .map((zone) => layout.byPath.get(zone.path))
          .filter((district) => district !== undefined);
        return {
          view,
          state: view.state,
          centre: site.centre,
          radius: view.state === AGENT_STATE.IDLE ? 1.2 : siteRadiusOf(view),
          bearing: site.bearing,
          seed,
          mode: domeModeOf(view),
          fill: 0.3 + seed * 0.55,
          away: seed < 0.75 ? away : [],
          cycle: 16 + seed * 12,
          crane: view.buildSize >= CRANE_AT && view.state !== AGENT_STATE.IDLE,
          sub: view.buildSize >= SUB_AT && view.state !== AGENT_STATE.IDLE,
          picked: chosen(view.id),
          hopAt: chose && view.id === selected ? elapsed : (before?.hopAt ?? -1e9),
          greet: before?.greet ?? 0,
          bubbles: before?.bubbles ?? seed,
          sparks: 0,
          at: before?.at ?? site.centre.clone(),
          head: before?.head ?? site.centre.clone(),
          tip: before?.tip ?? site.centre.clone(),
          working: false,
        };
      });
      cranes = divers.filter((diver) => diver.crane);
      subs = divers.filter((diver) => diver.sub);
      siteTargets = divers.map((diver) => ({ kind: PICK_KIND.AGENT, id: diver.view.id }));
      divers.forEach((diver, index) => {
        matrix.compose(
          look.copy(diver.centre).setY(diver.centre.y + diver.radius * 0.4),
          turn.identity(),
          size.setScalar(diver.radius + 1.2),
        );
        proxies.setMatrixAt(index, matrix);
        const suit = suitOf(diver);
        parts.torso.setColorAt(index, suit);
        for (const limb of [0, 1]) parts.arm.setColorAt(index * 2 + limb, suit);
        suit.multiplyScalar(0.85);
        for (const limb of [0, 1]) parts.leg.setColorAt(index * 2 + limb, suit);
      });
      for (const [mesh, count] of [
        [proxies, divers.length],
        [slabs, divers.length],
        [parts.torso, divers.length],
        [parts.helmet, divers.length],
        [parts.visor, divers.length],
        [parts.tank, divers.length],
        [parts.torch, divers.length],
        [parts.arm, divers.length * 2],
        [parts.leg, divers.length * 2],
        [parts.fin, divers.length * 2],
        [masts, cranes.length],
        [jibs, cranes.length],
        [cables, cranes.length],
        [loads, cranes.length],
        [hulls, subs.length],
        [portholes, subs.length],
        [propellers, subs.length],
        [searchlights, subs.length],
      ] as const) {
        mesh.count = count;
      }
      poseAll(elapsed, 0, moving);
    },
    step: (delta, elapsed, particles, ping) => {
      const strikes = poseAll(elapsed, delta, true);
      divers.forEach((diver, index) => {
        diver.bubbles += delta * 1.6;
        while (diver.bubbles > 1) {
          diver.bubbles -= 1 + nextRandom() * 0.6;
          particles.spawn(
            PARTICLE_KIND.BUBBLE,
            PARTICLE_LAYER.BUILDING,
            at.copy(diver.head).setY(diver.head.y + 0.1),
            velocity.set((nextRandom() - 0.5) * 0.4, 1, (nextRandom() - 0.5) * 0.4),
            5 + nextRandom() * 3,
            0.16 + nextRandom() * 0.22,
            bubble,
            0.9,
          );
        }
        if (!diver.working) return;
        diver.sparks +=
          delta * (diver.mode === DOME_MODE.SWEEPING ? 6 : 22) + (strikes[index] === true ? 8 : 0);
        while (diver.sparks > 1) {
          diver.sparks -= 1;
          const speed = 2.2 + nextRandom() * 3;
          particles.spawn(
            PARTICLE_KIND.SPARK,
            PARTICLE_LAYER.BUILDING,
            diver.tip,
            velocity.set(
              (nextRandom() - 0.5) * speed,
              nextRandom() * speed * 0.8,
              (nextRandom() - 0.5) * speed,
            ),
            0.25 + nextRandom() * 0.4,
            0.12 + nextRandom() * 0.12,
            nextRandom() < 0.5 ? building : hot,
            1,
          );
        }
      });
      const chosen = divers.find((diver) => diver.view.id === selectedId);
      if (chosen !== undefined && Math.floor(elapsed / 1.6) !== Math.floor((elapsed - delta) / 1.6))
        ping(chosen.centre);
    },
    paint: (glows, elapsed, moving) => {
      const t = moving ? elapsed : 0;
      for (const diver of divers) {
        const distance = camera.position.distanceTo(diver.head);
        const resting = diver.state === AGENT_STATE.IDLE;
        const lamp = diver.state === AGENT_STATE.WORKING ? 1 : 0.5;
        glows.push(
          diver.head.x,
          diver.head.y - 0.25,
          diver.head.z,
          Math.max(1.6, distance * 0.011),
          1.3 * lamp,
          1.2 * lamp,
          0.95 * lamp,
          1,
        );
        if (diver.picked) {
          glows.push(
            diver.at.x,
            diver.at.y + 0.8,
            diver.at.z,
            4.2,
            selection.r * 1.4,
            selection.g * 1.4,
            selection.b * 1.4,
            1,
          );
        }
        if (resting) continue;
        const signal = diver.state === AGENT_STATE.FAILED ? defect : building;
        const workLight =
          diver.state === AGENT_STATE.WORKING
            ? 0.55 + 0.25 * Math.sin(t * 9 + diver.seed * 30)
            : diver.state === AGENT_STATE.WAITING
              ? 0.25 + 0.25 * Math.sin(t * 2 + diver.seed * 9)
              : 0.12;
        const glowAt = diver.centre.y + diver.radius * clamp(diver.fill, 0.1, 0.95) + 0.4;
        glows.push(
          diver.centre.x,
          glowAt,
          diver.centre.z,
          Math.max(diver.radius * 0.9 + 1.4, distance * 0.018),
          signal.r * 1.8 * workLight,
          signal.g * 1.8 * workLight,
          signal.b * 1.8 * workLight,
          1,
        );
        // Note that a stuck agent's warning lamp burns steady when held still, so the still frame still says it.
        if (
          diver.state === AGENT_STATE.STUCK &&
          (!moving || Math.sin(t * 3 + diver.seed * 7) > 0)
        ) {
          glows.push(
            diver.head.x,
            diver.head.y + 0.7,
            diver.head.z,
            1.1,
            building.r * 2.4,
            building.g * 2.4,
            building.b * 2.4,
            1,
          );
        }
        if (diver.state === AGENT_STATE.FAILED) {
          glows.push(
            diver.head.x,
            diver.head.y + 0.7,
            diver.head.z,
            1.4,
            defect.r * 2.6,
            defect.g * 2.6,
            defect.b * 2.6,
            1,
          );
        }
        if (diver.working) {
          const flare = moving
            ? 0.6 + 0.4 * Math.abs(Math.sin(elapsed * 37 + diver.seed * 91))
            : 0.8;
          glows.push(
            diver.tip.x,
            diver.tip.y,
            diver.tip.z,
            (diver.mode === DOME_MODE.SWEEPING ? 1.2 : 2.4) * flare,
            building.r * 3 * flare + 1,
            building.g * 3 * flare + 1,
            building.b * 3 * flare + 1,
            1,
          );
        }
      }
      for (const diver of cranes) {
        const height = diver.radius * 1.9 + 4.5;
        const across = new Vector3(-Math.sin(diver.bearing), 0, Math.cos(diver.bearing));
        const foot = diver.centre.clone().addScaledVector(across, diver.radius + 1.8);
        const blink = !moving || Math.sin(elapsed * 2.4 + diver.seed * TAU) > 0.2 ? 1 : 0.08;
        glows.push(
          foot.x,
          foot.y + height + 0.5,
          foot.z,
          1.6,
          2 * blink,
          0.5 * blink,
          0.38 * blink,
          1,
        );
      }
      for (const diver of subs) {
        hulls.getMatrixAt(subs.indexOf(diver), matrix);
        const lamp = at.set(0, 0, 2.6).applyMatrix4(matrix);
        glows.push(lamp.x, lamp.y, lamp.z, 4, 2, 2, 1.7, 1);
      }
    },
  };
}
