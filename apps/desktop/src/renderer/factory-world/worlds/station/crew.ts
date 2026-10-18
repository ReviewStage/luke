import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { PickTarget } from "@luke/panel/factory-world/world";
import {
  AGENT_KIND,
  AGENT_STATE,
  type AgentKind,
  type AgentState,
  BUILD_FULL_LINES,
  type SIGNAL_COLOR,
} from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Points,
  Quaternion,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector3,
} from "three";
import { haloPoints, type Sparks } from "./effects";
import { basisFromY, basisFromZ, clamp, clean, merged, seeded, smooth, TAU, v3 } from "./kit";
import type { EffectUniforms } from "./materials";
import type { WorkSite } from "./station";

/**
 * crew.ts -- the agents at work: an astronaut each, welding the truss its pull request is building, its last bay glowing in the agent's state, a drone circling the work, and a halo that finds it from across the station.
 *
 * A truss is as long as its pull request is large: the view's `buildSize`
 * read back into lines, and those lines into bays as the mockup sized them,
 * so a one-line fix is a stub and a five-thousand-line feature a long
 * gantry. A feature clads its finished bays in hull plates.
 *
 * Where it stands says what it is doing, so a still frame says it too:
 *
 *   - working: at the tip of its truss, welding, in the building colour,
 *     and now and then flying to the second zone its work touches;
 *   - waiting: floating back from its work, arms down, its light steady;
 *   - stuck: drifted off the frame, looking about, its light a dim grey;
 *   - failed: tumbling away from a truss whose last bay is the defect red;
 *   - idle: parked beside finished work, unlit.
 *
 * The chosen agent, hovered or selected, turns to the camera and waves, in
 * the selection colour. Every part is one instanced mesh at the bound,
 * `FACTORY_WORLD_BOUNDS.MAX_AGENTS`, rewritten in place each frame.
 */

const MAX_AGENTS = FACTORY_WORLD_BOUNDS.MAX_AGENTS;
/** The most bays one truss has: the length of `BUILD_FULL_LINES` lines, and one more. */
const MAX_BAYS = 10;
/** The astronauts' scale. */
const SCALE = 0.95;

/** The truss's tint by the kind of work, which is dressing rather than a signal. */
const KIND_TINT = {
  FEAT: "#d9a650",
  REFACTOR: "#bfa274",
  FIX: "#c7a86e",
  OTHER: "#b8a47e",
} as const;

/** What no signal names: an agent stuck, and one at rest. */
const QUIET = {
  STUCK: "#8d96a8",
  IDLE: "#4b525c",
} as const;

/** What an agent is doing this instant, which poses it. */
const MODE = {
  HOME: "home",
  VISIT: "visit",
  FLY: "fly",
  ADRIFT: "adrift",
  REST: "rest",
} as const;

type Mode = (typeof MODE)[keyof typeof MODE];

/** What the world asks of one agent: where it works, how much, and in what state. */
export interface CrewPlan {
  readonly target: PickTarget;
  readonly state: AgentState;
  readonly kind: AgentKind;
  readonly buildSize: number;
  readonly site: WorkSite;
  /** Where on its second zone it goes to weld now and then; none where it touched one zone. */
  readonly visit: WorkSite | undefined;
  readonly selected: boolean;
  readonly hovered: boolean;
}

/** Where an agent floats, what it looks at, what it is doing, and how far into a flight and which way. */
interface Place {
  readonly at: Vector3;
  readonly look: Vector3;
  readonly mode: Mode;
  readonly fly: number;
  readonly heading: Vector3 | undefined;
}

/** An astronaut's arms and legs, in radians: the torch arm's swing, the other's hold, and the legs' kick and splay. */
interface Limbs {
  readonly swing: number;
  readonly swingSide: number;
  readonly hold: number;
  readonly holdSide: number;
  readonly kick: number;
  readonly splay: number;
}

/** One agent as the crew draws it. */
interface Member {
  readonly plan: CrewPlan;
  readonly anchor: Vector3;
  readonly direction: Vector3;
  readonly length: number;
  readonly tip: Vector3;
  readonly spot: Vector3;
  readonly visit: { readonly at: Vector3; readonly work: Vector3 } | undefined;
  readonly phase: number;
  readonly period: number;
  readonly seed: number;
  readonly turn: Quaternion;
  readonly current: Vector3;
  mode: Mode;
}

/** The parts of an astronaut and its drone, each one instanced mesh. */
interface Suit {
  readonly body: InstancedMesh;
  readonly visor: InstancedMesh;
  readonly armLeft: InstancedMesh;
  readonly armRight: InstancedMesh;
  readonly legLeft: InstancedMesh;
  readonly legRight: InstancedMesh;
  readonly chest: InstancedMesh;
  readonly lamp: InstancedMesh;
  readonly flame: InstancedMesh;
  readonly drone: InstancedMesh;
  readonly droneEye: InstancedMesh;
}

function kindTint(kind: AgentKind): string {
  if (kind === AGENT_KIND.FEAT) return KIND_TINT.FEAT;
  if (kind === AGENT_KIND.FIX) return KIND_TINT.FIX;
  if (kind === AGENT_KIND.REFACTOR) return KIND_TINT.REFACTOR;
  return KIND_TINT.OTHER;
}

/** A truss's length for a build of `buildSize`: its lines read back from the view's log scale, sized as the mockup's were. */
function trussLength(buildSize: number): number {
  const lines = Math.expm1(buildSize * Math.log1p(BUILD_FULL_LINES));
  return clamp(0.8 + 0.12 * Math.sqrt(lines), 1, 17);
}

/** The colour an agent's lights burn in. */
function stateColor(state: AgentState, signal: typeof SIGNAL_COLOR): string {
  switch (state) {
    case AGENT_STATE.WORKING:
    case AGENT_STATE.WAITING:
      return signal.BUILDING;
    case AGENT_STATE.FAILED:
      return signal.DEFECT;
    case AGENT_STATE.STUCK:
      return QUIET.STUCK;
    case AGENT_STATE.IDLE:
      return QUIET.IDLE;
  }
}

/** One open bay of a truss: four longerons, a frame, and a diagonal on each face, one unit long. */
function bayGeometry(): BufferGeometry {
  const half = 0.36;
  const parts: BufferGeometry[] = [];
  for (const [x, y] of [
    [half, half],
    [-half, half],
    [half, -half],
    [-half, -half],
  ] as const) {
    parts.push(clean(new BoxGeometry(0.08, 0.08, 1).translate(x, y, 0.5)));
  }
  for (const [x, y, w, h] of [
    [0, half, 2 * half, 0.06],
    [0, -half, 2 * half, 0.06],
    [half, 0, 0.06, 2 * half],
    [-half, 0, 0.06, 2 * half],
  ] as const) {
    parts.push(clean(new BoxGeometry(w, h, 0.06).translate(x, y, 0.02)));
  }
  const diagonal = Math.hypot(1, 2 * half);
  const slant = Math.atan2(2 * half, 1);
  parts.push(clean(new BoxGeometry(0.04, 0.04, diagonal).rotateY(slant).translate(0, half, 0.5)));
  parts.push(clean(new BoxGeometry(0.04, 0.04, diagonal).rotateY(-slant).translate(0, -half, 0.5)));
  parts.push(clean(new BoxGeometry(0.04, 0.04, diagonal).rotateX(slant).translate(half, 0, 0.5)));
  parts.push(clean(new BoxGeometry(0.04, 0.04, diagonal).rotateX(-slant).translate(-half, 0, 0.5)));
  return merged(parts);
}

/** Paints `geometry` one colour per vertex, so parts of different colours merge under one material. */
function painted(geometry: BufferGeometry, color: Color): BufferGeometry {
  const part = clean(geometry);
  const count = part.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1)
    colors.set([color.r, color.g, color.b], vertex * 3);
  part.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return part;
}

/** The crew of agents at work, drawn in station space. */
export class Crew {
  readonly group = new Group();
  /** One invisible sphere about each astronaut, what picking lands on. */
  readonly pick: InstancedMesh;
  readonly #suit: Suit;
  readonly #truss: InstancedMesh;
  readonly #hotBay: InstancedMesh;
  readonly #plates: InstancedMesh;
  readonly #halo: Points;
  readonly #sparks: Sparks;
  readonly #signal: typeof SIGNAL_COLOR;
  readonly #turns = new Map<string, Quaternion>();
  #members: Member[] = [];
  readonly #matrix = new Matrix4();
  readonly #limb = new Matrix4();
  readonly #euler = new Euler();
  readonly #scale = new Vector3(SCALE, SCALE, SCALE);
  readonly #aim = new Quaternion();
  readonly #tint = new Color();

  constructor(
    signal: typeof SIGNAL_COLOR,
    hullMap: Texture | null,
    sparks: Sparks,
    effects: EffectUniforms,
  ) {
    this.#signal = signal;
    this.#sparks = sparks;
    const suitWhite = new MeshStandardMaterial({
      color: 0xf2f0ea,
      roughness: 0.62,
      metalness: 0.05,
    });
    const suitBody = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      metalness: 0.12,
    });
    const visor = new MeshStandardMaterial({
      color: 0xffc35a,
      roughness: 0.08,
      metalness: 1,
      envMapIntensity: 2,
    });
    const add = (
      geometry: BufferGeometry,
      material: Material,
      count: number = MAX_AGENTS,
      shadow = true,
    ) => {
      const mesh = new InstancedMesh(geometry, material, count);
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = shadow;
      this.group.add(mesh);
      return mesh;
    };
    const white = new Color(0xf2f0ea);
    const pack = new Color(0xc9ccd0);
    const limb = (radius: number, length: number, end: BufferGeometry) =>
      merged([
        clean(new CapsuleGeometry(radius, length, 4, 10).translate(0, -length * 0.7, 0)),
        clean(end),
      ]);
    this.#suit = {
      body: add(
        merged([
          painted(new CapsuleGeometry(0.3, 0.42, 6, 14).translate(0, 0.42, 0), white),
          painted(new SphereGeometry(0.3, 20, 14).translate(0, 1.1, 0.02), white),
          painted(new BoxGeometry(0.62, 0.74, 0.3).translate(0, 0.55, -0.34), pack),
          painted(new CylinderGeometry(0.08, 0.1, 0.2, 8).translate(0.18, 0.1, -0.34), pack),
          painted(new CylinderGeometry(0.08, 0.1, 0.2, 8).translate(-0.18, 0.1, -0.34), pack),
        ]),
        suitBody,
      ),
      visor: add(
        new SphereGeometry(0.29, 20, 12, Math.PI / 2 - 0.95, 1.9, 0.75, 1).translate(0, 1.1, 0.06),
        visor,
      ),
      armLeft: add(
        limb(0.095, 0.42, new SphereGeometry(0.11, 10, 8).translate(0, -0.6, 0)),
        suitWhite,
      ),
      armRight: add(
        merged([
          clean(limb(0.095, 0.42, new SphereGeometry(0.11, 10, 8).translate(0, -0.6, 0))),
          clean(
            new CylinderGeometry(0.035, 0.05, 0.42, 8)
              .rotateX(Math.PI / 2)
              .translate(0, -0.66, 0.2),
          ),
        ]),
        suitWhite,
      ),
      legLeft: add(
        limb(0.115, 0.5, new BoxGeometry(0.2, 0.14, 0.32).translate(0, -0.72, 0.05)),
        suitWhite,
      ),
      legRight: add(
        limb(0.115, 0.5, new BoxGeometry(0.2, 0.14, 0.32).translate(0, -0.72, 0.05)),
        suitWhite,
      ),
      chest: add(
        new BoxGeometry(0.28, 0.08, 0.06).translate(0, 0.66, 0.29),
        new MeshBasicMaterial({ toneMapped: false }),
        MAX_AGENTS,
        false,
      ),
      lamp: add(
        new SphereGeometry(0.05, 8, 6).translate(0.2, 1.28, 0.2),
        new MeshBasicMaterial({ color: new Color(6, 6, 5.5), toneMapped: false }),
        MAX_AGENTS,
        false,
      ),
      flame: add(
        new ConeGeometry(0.1, 0.7, 10, 1, true).rotateX(Math.PI).translate(0, -0.35, 0),
        new MeshBasicMaterial({
          color: new Color(1.2, 2.2, 5),
          transparent: true,
          opacity: 0.85,
          blending: AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
        MAX_AGENTS * 2,
        false,
      ),
      drone: add(
        merged([
          clean(new SphereGeometry(0.3, 12, 8).scale(1, 0.5, 1)),
          clean(new TorusGeometry(0.46, 0.05, 5, 20).rotateX(Math.PI / 2)),
          ...[0, 1, 2, 3].map((k) =>
            clean(
              new CylinderGeometry(0.16, 0.16, 0.03, 10).translate(
                Math.cos((k * TAU) / 4 + 0.78) * 0.46,
                0.06,
                Math.sin((k * TAU) / 4 + 0.78) * 0.46,
              ),
            ),
          ),
        ]),
        new MeshStandardMaterial({ color: 0x3c434c, roughness: 0.45, metalness: 0.75 }),
      ),
      droneEye: add(
        new SphereGeometry(0.08, 8, 6).translate(0, 0, 0.27),
        new MeshBasicMaterial({ toneMapped: false }),
        MAX_AGENTS,
        false,
      ),
    };
    this.pick = add(
      new SphereGeometry(2.3, 8, 6),
      new MeshBasicMaterial({ visible: false }),
      MAX_AGENTS,
      false,
    );
    const bay = bayGeometry();
    this.#truss = add(
      bay,
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.75 }),
      MAX_AGENTS * MAX_BAYS,
    );
    this.#truss.receiveShadow = true;
    this.#hotBay = add(bay, new MeshBasicMaterial({ toneMapped: false }), MAX_AGENTS, false);
    this.#plates = add(
      new BoxGeometry(0.66, 0.66, 1).translate(0, 0, 0.5),
      new MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.6,
        metalness: 0.3,
        map: hullMap,
      }),
      MAX_AGENTS * MAX_BAYS,
    );
    for (const mesh of [
      this.#suit.chest,
      this.#suit.droneEye,
      this.#hotBay,
      this.#truss,
      this.#plates,
    ]) {
      mesh.setColorAt(0, this.#tint.set(0xffffff));
    }
    this.#halo = haloPoints(MAX_AGENTS, 0.75, effects);
    this.group.add(this.#halo);
  }

  /** The target the `instance`th pick sphere stands for. */
  targetOf(instance: number): PickTarget | undefined {
    return this.#members[instance]?.plan.target;
  }

  /** Where the agent picked as `target` floats now, in station space. */
  positionOf(target: PickTarget | undefined): Vector3 | undefined {
    if (target === undefined) return undefined;
    return this.#members.find((member) => member.plan.target.id === target.id)?.current;
  }

  /** Lays out `plans`: their trusses, their colours, and each one's pose as of `elapsed`. */
  update(plans: readonly CrewPlan[], still: boolean, elapsed: number): void {
    const kept = new Map<string, Quaternion>();
    this.#members = plans.slice(0, MAX_AGENTS).map((plan) => {
      const random = seeded(Number.parseInt(plan.target.id.replaceAll("-", "").slice(-8), 16) || 7);
      const direction = plan.site.direction.clone().normalize();
      const length = trussLength(plan.buildSize);
      const tip = plan.site.point.clone().addScaledVector(direction, length);
      const side = new Vector3()
        .crossVectors(direction, Math.abs(direction.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0))
        .normalize();
      const spot = tip.clone().addScaledVector(direction, 0.35).addScaledVector(side, 1.15);
      const visit =
        plan.visit === undefined
          ? undefined
          : {
              at: plan.visit.point.clone().addScaledVector(plan.visit.direction, 1.4),
              work: plan.visit.point.clone().addScaledVector(plan.visit.direction, 0.2),
            };
      const turn = this.#turns.get(plan.target.id) ?? new Quaternion();
      kept.set(plan.target.id, turn);
      return {
        plan,
        anchor: plan.site.point.clone(),
        direction,
        length,
        tip,
        spot,
        visit,
        phase: random(),
        period: 34 + random() * 22,
        seed: random() * 100,
        turn,
        current: spot.clone(),
        mode: MODE.HOME,
      };
    });
    this.#turns.clear();
    for (const [id, turn] of kept) this.#turns.set(id, turn);
    this.#layTrusses();
    this.#colour(elapsed, still);
    for (const mesh of Object.values(this.#suit)) mesh.count = this.#members.length;
    this.#suit.flame.count = this.#members.length * 2;
    this.pick.count = this.#members.length;
    this.#halo.geometry.setDrawRange(0, this.#members.length);
    this.#pose(elapsed, still ? 1 : 0.2, still, undefined, false);
    if (still) this.#freezeSparks();
  }

  /** Steps every agent's motion to `elapsed`, `delta` after the last, with the camera at `camera` in station space. */
  frame(elapsed: number, delta: number, camera: Vector3): void {
    this.#pose(elapsed, 1 - Math.exp(-delta * 6), false, camera, true);
    this.#colour(elapsed, false);
  }

  /** Each bay of each truss, the last one lit, and a feature's finished bays clad. */
  #layTrusses(): void {
    let bays = 0;
    let plates = 0;
    const scale = new Matrix4();
    this.#members.forEach((member, index) => {
      const count = Math.min(MAX_BAYS, Math.max(1, Math.round(member.length / 1.1)));
      const span = member.length / count;
      const base = basisFromZ(member.direction);
      const tint = this.#tint.set(kindTint(member.plan.kind));
      for (let bay = 0; bay < count; bay += 1) {
        this.#matrix
          .copy(base)
          .setPosition(member.anchor.clone().addScaledVector(member.direction, bay * span))
          .multiply(scale.makeScale(1, 1, span));
        if (bay === count - 1) this.#hotBay.setMatrixAt(index, this.#matrix);
        this.#truss.setMatrixAt(bays, this.#matrix);
        this.#truss.setColorAt(bays, tint);
        bays += 1;
        // Note that feature work is cladding new hull over its frame, so finished bays get plates.
        if (member.plan.kind === AGENT_KIND.FEAT && bay < count - 1 && bay % 2 === 0) {
          this.#plates.setMatrixAt(plates, this.#matrix.multiply(scale.makeScale(1, 1, 0.92)));
          this.#plates.setColorAt(plates, this.#tint.set(0xe7d6b0));
          plates += 1;
        }
      }
    });
    this.#truss.count = bays;
    this.#plates.count = plates;
    this.#hotBay.count = this.#members.length;
    for (const mesh of [this.#truss, this.#plates, this.#hotBay]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** The chest lights, drone eyes, halos and last bays, each in its agent's state, or the selection's. */
  #colour(elapsed: number, still: boolean): void {
    const halo = this.#halo.geometry.getAttribute("color");
    const pulse = still ? 1 : 0.85 + Math.sin(elapsed * 6) * 0.15;
    this.#members.forEach((member, index) => {
      const { plan, seed } = member;
      const chosen = plan.selected || plan.hovered;
      const base = chosen ? this.#signal.SELECTION : stateColor(plan.state, this.#signal);
      const stuck = plan.state === AGENT_STATE.STUCK;
      const blink = stuck && !still ? (Math.sin(elapsed * 2 + seed) > 0.6 ? 1 : 0.35) : 1;
      this.#suit.chest.setColorAt(index, this.#tint.set(base).multiplyScalar(blink));
      this.#suit.droneEye.setColorAt(index, this.#tint);
      const glow = plan.state === AGENT_STATE.IDLE && !chosen ? 0.25 : stuck ? 0.45 * blink : 1;
      this.#tint.set(base).multiplyScalar(glow);
      halo.setXYZ(index, this.#tint.r, this.#tint.g, this.#tint.b);
      const bay = this.#tint.set(stateColor(plan.state, this.#signal));
      if (plan.state === AGENT_STATE.WORKING) bay.multiplyScalar(pulse);
      if (plan.state === AGENT_STATE.IDLE) bay.set(kindTint(plan.kind)).multiplyScalar(0.3);
      this.#hotBay.setColorAt(index, bay);
    });
    for (const mesh of [this.#suit.chest, this.#suit.droneEye, this.#hotBay]) {
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
    halo.needsUpdate = true;
  }

  /** Every astronaut's place and limbs at `elapsed`, turning `ease` of the way to where it faces, welding sparks where `welding`. */
  #pose(
    elapsed: number,
    ease: number,
    still: boolean,
    camera: Vector3 | undefined,
    welding: boolean,
  ): void {
    const halo = this.#halo.geometry.getAttribute("position");
    const size = this.#halo.geometry.getAttribute("size");
    this.#members.forEach((member, index) => {
      const t = still ? member.seed : elapsed;
      const { at, look, mode, fly, heading } = this.#placeOf(member, t, still);
      const waving = (member.plan.hovered || member.plan.selected) && mode !== MODE.FLY;
      if (waving && camera !== undefined) look.copy(camera);
      if (waving && !still) at.y += Math.abs(Math.sin(t * 7)) * 0.12;
      member.current.copy(at);
      member.mode = mode;
      this.#aim.setFromRotationMatrix(basisFromZ(look.clone().sub(at)));
      if (mode === MODE.FLY && heading !== undefined && heading.lengthSq() > 1e-6) {
        this.#aim.slerp(
          new Quaternion().setFromRotationMatrix(basisFromY(heading)),
          clamp(fly * 2, 0, 1),
        );
      }
      if (member.plan.state === AGENT_STATE.FAILED) {
        this.#aim.multiply(new Quaternion().setFromEuler(this.#euler.set(t * 0.4, 0.3, t * 0.25)));
      }
      member.turn.slerp(this.#aim, waving ? Math.min(1, ease * 1.5) : ease);
      const root = new Matrix4().compose(at, member.turn, this.#scale);
      const limbs = this.#limbsOf(mode, t, member.seed, waving);
      const part = (
        mesh: InstancedMesh,
        slot: number,
        offset: readonly [number, number, number],
        rx = 0,
        rz = 0,
      ) => {
        this.#limb
          .makeRotationFromEuler(this.#euler.set(rx, 0, rz))
          .setPosition(offset[0], offset[1], offset[2]);
        mesh.setMatrixAt(slot, this.#limb.premultiply(root));
      };
      part(this.#suit.body, index, [0, 0, 0], Math.sin(t * 0.8 + member.seed) * 0.05);
      part(this.#suit.visor, index, [0, 0, 0]);
      part(this.#suit.chest, index, [0, 0, 0]);
      part(this.#suit.lamp, index, [0, 0, 0]);
      part(this.#suit.armRight, index, [-0.38, 0.8, 0], limbs.swing, limbs.swingSide);
      part(this.#suit.armLeft, index, [0.38, 0.8, 0], limbs.hold, limbs.holdSide);
      part(this.#suit.legLeft, index, [0.15, 0.04, 0], -0.15 + limbs.kick, 0.06 + limbs.splay);
      part(this.#suit.legRight, index, [-0.15, 0.04, 0], -0.15 - limbs.kick, -0.06 - limbs.splay);
      part(this.pick, index, [0, 0.5, 0]);
      const thrust =
        mode === MODE.FLY
          ? 0.6 + fly * 1.4 + Math.random() * 0.2
          : still
            ? 0.12
            : 0.12 + Math.random() * 0.08;
      for (const sideOf of [-1, 1]) {
        this.#limb.makeScale(1, thrust, 1).setPosition(sideOf * 0.18, 0.08, -0.34);
        this.#suit.flame.setMatrixAt(
          index * 2 + (sideOf > 0 ? 1 : 0),
          this.#limb.premultiply(root),
        );
      }
      const work =
        mode === MODE.HOME
          ? member.tip
          : mode === MODE.VISIT && member.visit !== undefined
            ? member.visit.work
            : at;
      const orbit =
        mode === MODE.ADRIFT || mode === MODE.REST ? member.seed : t * 0.9 + member.seed;
      const drone = work
        .clone()
        .add(
          v3(
            Math.cos(orbit) * 1.8,
            0.8 + Math.sin(t * 1.7 + member.seed) * 0.4,
            Math.sin(orbit) * 1.8,
          ),
        );
      const droneAt = basisFromZ(work.clone().sub(drone), undefined, drone);
      this.#suit.drone.setMatrixAt(index, droneAt);
      this.#suit.droneEye.setMatrixAt(index, droneAt);
      halo.setXYZ(index, at.x, at.y + 0.6, at.z);
      size.setX(index, 5.5);
      if (
        welding &&
        !waving &&
        member.plan.state === AGENT_STATE.WORKING &&
        (mode === MODE.HOME || mode === MODE.VISIT)
      ) {
        const torch = v3(-0.38, 0.2, 0.75).applyMatrix4(root);
        for (let spark = 0; spark < 2; spark += 1) {
          if (Math.random() < 0.55) {
            const velocity = v3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
              .normalize()
              .multiplyScalar(1.5 + Math.random() * 3);
            this.#sparks.emit(torch, velocity, 0.25 + Math.random() * 0.5);
          }
        }
      }
    });
    for (const mesh of [...Object.values(this.#suit), this.pick])
      mesh.instanceMatrix.needsUpdate = true;
    halo.needsUpdate = true;
    size.needsUpdate = true;
  }

  /** Where an agent floats at `t`, what it looks at, and what it is doing. */
  #placeOf(member: Member, t: number, still: boolean): Place {
    const { plan, spot, tip, direction, seed } = member;
    const bob = still
      ? v3()
      : v3(
          Math.sin(t * 1.1 + seed) * 0.12,
          Math.sin(t * 1.4 + seed * 2) * 0.16,
          Math.cos(t * 0.9 + seed) * 0.12,
        );
    switch (plan.state) {
      case AGENT_STATE.STUCK:
      case AGENT_STATE.FAILED: {
        // Note that stuck work is an astronaut drifted off its frame, looking about; failed work drifts further, tumbling.
        const away = plan.state === AGENT_STATE.FAILED ? 1.8 : 0.8;
        const at = spot
          .clone()
          .addScaledVector(direction, away + Math.sin(t * 0.4 + seed) * 0.4)
          .add(bob);
        const look = at
          .clone()
          .add(v3(Math.cos(t * 0.25 + seed), Math.sin(t * 0.3) * 0.4, Math.sin(t * 0.25 + seed)));
        return { at, look, mode: MODE.ADRIFT, fly: 0, heading: undefined };
      }
      case AGENT_STATE.WAITING:
        return {
          at: spot.clone().addScaledVector(direction, 0.5).add(bob),
          look: tip.clone(),
          mode: MODE.REST,
          fly: 0,
          heading: undefined,
        };
      case AGENT_STATE.IDLE:
        return {
          at: spot.clone().addScaledVector(direction, 0.2).add(bob),
          look: tip.clone(),
          mode: MODE.REST,
          fly: 0,
          heading: undefined,
        };
      case AGENT_STATE.WORKING:
        break;
    }
    const visit = member.visit;
    const cycle = still ? 0 : (t / member.period + member.phase) % 1;
    if (visit === undefined || cycle <= 0.6 || cycle >= 0.96) {
      return {
        at: spot.clone().add(bob),
        look: tip.clone(),
        mode: MODE.HOME,
        fly: 0,
        heading: undefined,
      };
    }
    const middle = spot.clone().add(visit.at).multiplyScalar(0.5);
    middle.y += 5 + spot.distanceTo(visit.at) * 0.22;
    const along = (from: Vector3, to: Vector3, f: number) => {
      const at = quadratic(from, middle, to, f);
      return {
        at,
        look: to.clone(),
        mode: MODE.FLY,
        fly: Math.sin(f * Math.PI),
        heading: quadratic(from, middle, to, Math.min(1, f + 0.02)).sub(at),
      };
    };
    if (cycle < 0.68) return along(spot, visit.at, smooth((cycle - 0.6) / 0.08));
    if (cycle < 0.88)
      return {
        at: visit.at.clone().add(bob),
        look: visit.work.clone(),
        mode: MODE.VISIT,
        fly: 0,
        heading: undefined,
      };
    return along(visit.at, spot, smooth((cycle - 0.88) / 0.08));
  }

  /** The arms' and legs' angles for `mode`: welding, flying, resting, adrift, or waving. */
  #limbsOf(mode: Mode, t: number, seed: number, waving: boolean): Limbs {
    if (waving)
      return {
        swing: -2.9,
        swingSide: -0.35 + Math.sin(t * 11) * 0.5,
        hold: -0.2,
        holdSide: 0.35,
        kick: Math.sin(t * 1.2 + seed) * 0.12,
        splay: 0,
      };
    switch (mode) {
      case MODE.FLY:
        return {
          swing: -0.2,
          swingSide: -0.15,
          hold: -0.1,
          holdSide: 0.2,
          kick: Math.sin(t * 5 + seed) * 0.25,
          splay: 0,
        };
      case MODE.ADRIFT:
        return {
          swing: -0.25 + Math.sin(t * 0.7 + seed) * 0.1,
          swingSide: -0.9,
          hold: -0.25,
          holdSide: 0.9,
          kick: Math.sin(t * 1.2 + seed) * 0.12,
          splay: 0.25,
        };
      case MODE.REST:
        return {
          swing: -0.3,
          swingSide: -0.25,
          hold: -0.3,
          holdSide: 0.25,
          kick: Math.sin(t * 1.2 + seed) * 0.08,
          splay: 0,
        };
      case MODE.HOME:
      case MODE.VISIT:
        return {
          swing: -1.25 + Math.sin(t * 7 + seed) * 0.28 + Math.sin(t * 17 + seed) * 0.05,
          swingSide: -0.15,
          hold: -0.55 + Math.sin(t * 1.3 + seed) * 0.12,
          holdSide: 0.2,
          kick: Math.sin(t * 1.2 + seed) * 0.12,
          splay: 0,
        };
    }
  }

  /** A still frame's welding: a fixed spray at every working torch, so the work reads without motion. */
  #freezeSparks(): void {
    this.#sparks.clear();
    for (const member of this.#members) {
      if (member.plan.state !== AGENT_STATE.WORKING || member.mode !== MODE.HOME) continue;
      const random = seeded(Math.floor(member.seed * 1000));
      const torch = member.tip.clone().addScaledVector(member.direction, 0.05);
      for (let spark = 0; spark < 10; spark += 1) {
        const out = v3(random() - 0.5, random() - 0.3, random() - 0.5)
          .normalize()
          .multiplyScalar(0.2 + random() * 0.7);
        this.#sparks.emit(torch.clone().add(out), v3(), 1, undefined, 0.25 + random() * 0.25);
      }
    }
    this.#sparks.step(0);
  }
}

function quadratic(from: Vector3, bend: Vector3, to: Vector3, t: number): Vector3 {
  const u = 1 - t;
  return v3()
    .addScaledVector(from, u * u)
    .addScaledVector(bend, 2 * u * t)
    .addScaledVector(to, t * t);
}
