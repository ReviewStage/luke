import {
  FACTORY_WORLD_BOUNDS,
  type FactoryPlanned,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import type { SIGNAL_COLOR, TimelineEntry } from "@luke/ui/factory-world";
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CubicBezierCurve3,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineSegments,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  type Object3D,
  type Points,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  type Vector3,
} from "three";
import { PICK_KIND, type PickTarget } from "../../world";
import { type Bursts, haloPoints, type Sparks, type Streaks } from "./effects";
import {
  basisFromY,
  basisFromZ,
  box,
  clamp,
  clean,
  cylinder,
  hashOf,
  merged,
  radial,
  smooth,
  TAU,
  tangent,
  translation,
  v3,
} from "./kit";
import { EFFECT, type EffectUniforms, effectMaterial } from "./materials";
import type { ZoneBody } from "./station";

/**
 * traffic.ts -- what comes and goes about the station: the shipped work's navigation lights on the zones it landed in, the cargo pods launched toward Earth as work ships, and the planned work's supply ships holding orbit with their blueprints aboard.
 *
 * Shipped work is a light on each zone it landed in, brightest when it
 * merged most recently before the scrubber's instant; while the scrubber
 * rests at now, the window's merges launch again in order, a pod each,
 * falling away toward Earth. Planned work is a supply ship holding orbit
 * above the zone it is placed on, its cargo a hologram in the planned
 * colour, sized by its priority, now and then sending a blueprint down to
 * the zone; the hovered or selected ship beams to every zone it names.
 *
 * Every kind is an instanced mesh at its bound, and the lights and ships
 * register per instance for picking.
 */

/** How many zones of one merge carry its light. */
const LIGHTS_PER_MERGE = 4;
const MAX_LIGHTS = FACTORY_WORLD_BOUNDS.MAX_SHIPPED * LIGHTS_PER_MERGE;
const MAX_PODS = 28;
const POD_TRAIL = 26;
/** Seconds before the first pod launches. */
const FIRST_POD = 0.4;
/** Seconds between two pods while the scrubber rests at now. */
const POD_EVERY = 1.7;
const MAX_SHIPS = FACTORY_WORLD_BOUNDS.MAX_PLANNED;
/** The planned ships' orbit, and the height they hold over the station's plane. */
const ORBIT = { RADIUS: 60, HEIGHT: 14 } as const;
const HOUR_MS = 60 * 60 * 1000;

/** A ship's size by its issue's priority, the most pressing largest. */
const PRIORITY_SCALE = {
  [LINEAR_PRIORITY.NONE]: 1,
  [LINEAR_PRIORITY.URGENT]: 1.9,
  [LINEAR_PRIORITY.HIGH]: 1.6,
  [LINEAR_PRIORITY.MEDIUM]: 1.2,
  [LINEAR_PRIORITY.LOW]: 0.9,
} as const;

/** How often, in seconds, a ship sends a blueprint down, by priority. */
const PRIORITY_EVERY = {
  [LINEAR_PRIORITY.NONE]: 11,
  [LINEAR_PRIORITY.URGENT]: 5,
  [LINEAR_PRIORITY.HIGH]: 6,
  [LINEAR_PRIORITY.MEDIUM]: 9,
  [LINEAR_PRIORITY.LOW]: 13,
} as const;

/** Lights a zone's glow for a moment, as a launch or a blueprint's arrival does. */
export type ZoneFlash = (body: ZoneBody, color: string, strength: number) => void;

/** Whether `target` is the item of `kind` and `id`. */
function isTarget(target: PickTarget | undefined, kind: PickTarget["kind"], id: string): boolean {
  return target?.kind === kind && target.id === id;
}

/** One shipped light: the merge it stands for, and where. */
interface Light {
  readonly entry: TimelineEntry;
  readonly body: ZoneBody;
  readonly at: Vector3;
  readonly phase: number;
  /** How fresh the merge is, 1 at the instant and falling away over hours. */
  readonly fresh: number;
}

/** The navigation lights of shipped work, one per zone each merge landed in. */
export class ShippedLights {
  readonly mesh: InstancedMesh;
  readonly #halo: Points;
  #lights: Light[] = [];
  readonly #signal: typeof SIGNAL_COLOR;
  readonly #matrix = new Matrix4();
  readonly #tint = new Color();
  #chosen: PickTarget[] = [];

  constructor(signal: typeof SIGNAL_COLOR, effects: EffectUniforms, parent: Object3D) {
    this.#signal = signal;
    this.mesh = new InstancedMesh(
      new SphereGeometry(0.16, 8, 6),
      new MeshBasicMaterial({ toneMapped: false }),
      MAX_LIGHTS,
    );
    this.mesh.setColorAt(0, this.#tint.set(signal.SHIPPED));
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.#halo = haloPoints(MAX_LIGHTS, 1, effects);
    parent.add(this.mesh, this.#halo);
  }

  targetOf(instance: number): PickTarget | undefined {
    const light = this.#lights[instance];
    return light === undefined ? undefined : { kind: PICK_KIND.SHIPPED, id: light.entry.url };
  }

  /** Where the merge picked as `target` shows its first light, in station space. */
  positionOf(target: PickTarget | undefined): Vector3 | undefined {
    return this.#lights.find((light) => isTarget(target, PICK_KIND.SHIPPED, light.entry.url))?.at;
  }

  /** Lays out a light for each merge of `timeline` on its zones, as of `now`. */
  update(
    timeline: readonly TimelineEntry[],
    bodies: ReadonlyMap<string, ZoneBody>,
    now: number,
    chosen: PickTarget[],
    shown: boolean,
  ): void {
    const placed = new Map<ZoneBody, number>();
    this.#chosen = chosen;
    this.#lights = [];
    if (shown) {
      for (const entry of timeline) {
        for (const path of entry.zonePaths.slice(0, LIGHTS_PER_MERGE)) {
          const body = bodies.get(path);
          if (body === undefined || this.#lights.length >= MAX_LIGHTS) continue;
          const order = placed.get(body) ?? 0;
          placed.set(body, order + 1);
          const spot = body.spots[order % body.spots.length];
          if (spot === undefined) continue;
          const hours = Math.max(0, (now - entry.mergedAt) / HOUR_MS);
          this.#lights.push({
            entry,
            body,
            at: spot.point.clone().addScaledVector(spot.normal, 0.18),
            phase: ((hashOf(entry.url) % 1000) / 1000) * TAU,
            fresh: Math.exp(-hours / 2.5),
          });
        }
      }
    }
    this.#lights.forEach((light, index) => {
      this.mesh.setMatrixAt(
        index,
        this.#matrix.makeTranslation(light.at.x, light.at.y, light.at.z),
      );
    });
    this.mesh.count = this.#lights.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    const position = this.#halo.geometry.getAttribute("position");
    const size = this.#halo.geometry.getAttribute("size");
    this.#lights.forEach((light, index) => {
      position.setXYZ(index, light.at.x, light.at.y, light.at.z);
      size.setX(index, 1.6);
    });
    position.needsUpdate = true;
    size.needsUpdate = true;
    this.#halo.geometry.setDrawRange(0, this.#lights.length);
    this.frame(0, true);
  }

  /** Twinkles every light at `elapsed`; held still, each burns steady at its freshness. */
  frame(elapsed: number, still: boolean): void {
    const halo = this.#halo.geometry.getAttribute("color");
    this.#lights.forEach((light, index) => {
      const chosen = this.#chosen.some((target) =>
        isTarget(target, PICK_KIND.SHIPPED, light.entry.url),
      );
      const twinkle = still
        ? 1
        : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(elapsed * 2.2 + light.phase)) ** 4;
      this.#tint.set(chosen ? this.#signal.SELECTION : this.#signal.SHIPPED);
      this.mesh.setColorAt(index, this.#tint);
      this.#tint.multiplyScalar((0.6 + 2.6 * light.fresh) * twinkle * 0.35 * (chosen ? 2 : 1));
      halo.setXYZ(index, this.#tint.r, this.#tint.g, this.#tint.b);
    });
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
    halo.needsUpdate = true;
  }
}

/** One pod in flight toward Earth. */
interface Pod {
  readonly entry: TimelineEntry;
  readonly curve: CubicBezierCurve3;
  readonly seconds: number;
  age: number;
  readonly trail: Vector3[];
}

/** The cargo pods: shipped work launched again, in order, while the scrubber rests at now. */
export class Pods {
  readonly pick: InstancedMesh;
  readonly #body: InstancedMesh;
  readonly #band: InstancedMesh;
  readonly #trail: Points;
  readonly #pods: Pod[] = [];
  readonly #signal: typeof SIGNAL_COLOR;
  readonly #matrix = new Matrix4();
  readonly #scale = new Matrix4();
  readonly #tint = new Color();
  readonly #reentry = new Color(1, 0.45, 0.15);
  #cursor = 0;
  #wait = FIRST_POD;

  constructor(
    signal: typeof SIGNAL_COLOR,
    white: Material,
    effects: EffectUniforms,
    parent: Object3D,
  ) {
    this.#signal = signal;
    const body = merged([
      clean(new CapsuleGeometry(0.42, 1, 6, 14)),
      ...[0, 1, 2].map((k) =>
        clean(
          box(0.06, 0.5, 0.4).applyMatrix4(
            new Matrix4().makeRotationY((k * TAU) / 3).multiply(translation(0, -0.7, 0.45)),
          ),
        ),
      ),
      clean(new CylinderGeometry(0.44, 0.44, 0.18, 14).translate(0, 0.2, 0)),
    ]);
    this.#body = new InstancedMesh(body, white, MAX_PODS);
    this.#body.castShadow = true;
    this.#band = new InstancedMesh(
      new CylinderGeometry(0.45, 0.45, 0.12, 14),
      new MeshBasicMaterial({ toneMapped: false }),
      MAX_PODS,
    );
    this.#band.setColorAt(0, this.#tint.set(signal.SHIPPED));
    this.pick = new InstancedMesh(
      new SphereGeometry(2.6, 8, 6),
      new MeshBasicMaterial({ visible: false }),
      MAX_PODS,
    );
    this.#trail = haloPoints(MAX_PODS * POD_TRAIL, 1, effects);
    this.#trail.geometry.setDrawRange(0, MAX_PODS * POD_TRAIL);
    for (const mesh of [this.#body, this.#band, this.pick]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
    parent.add(this.#body, this.#band, this.pick, this.#trail);
  }

  targetOf(instance: number): PickTarget | undefined {
    const pod = this.#pods[instance];
    return pod === undefined ? undefined : { kind: PICK_KIND.SHIPPED, id: pod.entry.url };
  }

  /** Lands every pod, and starts the next launches over from the oldest merge. */
  clear(): void {
    this.#pods.length = 0;
    this.#cursor = 0;
    this.#wait = FIRST_POD;
    this.#write();
  }

  /** Launches the next merge of `timeline` when its turn comes, and flies every pod `delta` further. */
  frame(
    delta: number,
    timeline: readonly TimelineEntry[],
    launchFrom: (entry: TimelineEntry) => { at: Vector3; out: Vector3; body: ZoneBody } | undefined,
    effects: {
      sparks: Sparks;
      bursts: Bursts;
      flash: ZoneFlash;
      toStation: (world: Vector3) => Vector3;
    },
  ): void {
    this.#wait -= delta;
    if (this.#wait <= 0 && timeline.length > 0) {
      this.#wait = POD_EVERY;
      const entry = timeline[this.#cursor % timeline.length];
      this.#cursor += 1;
      const from = entry === undefined ? undefined : launchFrom(entry);
      if (entry !== undefined && from !== undefined) this.#launch(entry, from, effects);
    }
    for (const pod of this.#pods) pod.age += delta;
    while (this.#pods[0] !== undefined && this.#pods[0].age > this.#pods[0].seconds)
      this.#pods.shift();
    this.#write();
  }

  #launch(
    entry: TimelineEntry,
    { at, out, body }: { at: Vector3; out: Vector3; body: ZoneBody },
    {
      sparks,
      bursts,
      flash,
      toStation,
    }: { sparks: Sparks; bursts: Bursts; flash: ZoneFlash; toStation: (world: Vector3) => Vector3 },
  ): void {
    const across = v3(at.x, 0, at.z);
    if (across.lengthSq() < 1) across.set(1, 0, 0);
    across.normalize();
    const heading = out.clone().add(across.clone().multiplyScalar(0.6)).normalize();
    const lift = at
      .clone()
      .addScaledVector(heading, 16)
      .add(v3(0, 12, 0));
    const end = across
      .clone()
      .multiplyScalar(170 + Math.random() * 120)
      .add(v3(Math.random() * 80 - 40, -195, Math.random() * 80 - 40));
    const fall = lift
      .clone()
      .lerp(end, 0.45)
      .add(v3(0, 6, 0));
    if (this.#pods.length >= MAX_PODS) this.#pods.shift();
    this.#pods.push({
      entry,
      curve: new CubicBezierCurve3(at.clone(), lift, fall, end),
      seconds: 10 + Math.random() * 3,
      age: 0,
      trail: [],
    });
    flash(body, this.#signal.SHIPPED, 1);
    sparks.confetti(toStation(at.clone()), new Color(this.#signal.SHIPPED), 28, 6);
    bursts.launch(at, this.#signal.SHIPPED);
  }

  #write(): void {
    const position = this.#trail.geometry.getAttribute("position");
    const color = this.#trail.geometry.getAttribute("color");
    const size = this.#trail.geometry.getAttribute("size");
    for (let slot = 0; slot < MAX_PODS; slot += 1) {
      const pod = this.#pods[slot];
      if (pod === undefined) {
        for (let k = 0; k < POD_TRAIL; k += 1) size.setX(slot * POD_TRAIL + k, 0);
        continue;
      }
      const f = clamp(pod.age / pod.seconds, 0, 1);
      const eased = Math.min(1, f * f * (1.6 - 0.6 * f));
      const at = pod.curve.getPoint(eased);
      const heading = pod.curve.getTangent(eased);
      this.pick.setMatrixAt(slot, this.#matrix.makeTranslation(at.x, at.y, at.z));
      this.#matrix.copy(basisFromY(heading, at)).multiply(this.#scale.makeScale(1.6, 1.6, 1.6));
      this.#body.setMatrixAt(slot, this.#matrix);
      this.#band.setMatrixAt(slot, this.#matrix.multiply(this.#scale.makeTranslation(0, -0.05, 0)));
      this.#band.setColorAt(slot, this.#tint.set(this.#signal.SHIPPED));
      pod.trail.unshift(at);
      if (pod.trail.length > POD_TRAIL) pod.trail.pop();
      const fade = 1 - smooth(clamp((f - 0.75) / 0.25, 0, 1));
      const reentry = smooth(clamp((f - 0.6) / 0.3, 0, 1));
      for (let k = 0; k < POD_TRAIL; k += 1) {
        const point = pod.trail[Math.min(k, pod.trail.length - 1)] ?? at;
        const index = slot * POD_TRAIL + k;
        const weight = 1 - k / POD_TRAIL;
        position.setXYZ(index, point.x, point.y, point.z);
        this.#tint
          .set(this.#signal.SHIPPED)
          .lerp(this.#reentry, reentry)
          .multiplyScalar(weight * weight * 1.8 * fade);
        color.setXYZ(index, this.#tint.r, this.#tint.g, this.#tint.b);
        size.setX(index, (k === 0 ? 4 : 2.2 * weight + 0.4) * (1 + reentry));
      }
    }
    const count = Math.min(MAX_PODS, this.#pods.length);
    for (const mesh of [this.#body, this.#band, this.pick]) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.#band.instanceColor !== null) this.#band.instanceColor.needsUpdate = true;
    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
  }
}

/** A supply ship's hull: a cargo box, a cockpit, two engines, stubs, and the clamps its hologram hangs from. */
function shipHull(): BufferGeometry {
  const parts = [
    clean(box(1.4, 0.9, 3.4)),
    clean(
      cylinder(0.45, 0.6, 1.1, 12)
        .rotateX(Math.PI / 2)
        .translate(0, 0.1, 2.2),
    ),
  ];
  for (const side of [-1, 1]) {
    parts.push(
      clean(
        cylinder(0.38, 0.38, 2.2, 12)
          .rotateX(Math.PI / 2)
          .translate(side * 1.1, -0.1, -0.8),
      ),
    );
    parts.push(clean(box(1, 0.1, 1.4).translate(side * 0.9, 0, -0.4)));
  }
  parts.push(
    clean(box(0.15, 1.6, 0.15).translate(0, -1.2, 0.8)),
    clean(box(0.15, 1.6, 0.15).translate(0, -1.2, -0.8)),
  );
  return merged(parts);
}

/** The hologram a ship carries: a capsule ringed three times, gridded and scanned in the planned colour. */
function hologram(time: { value: number }, light: { value: number }) {
  const geometry = merged([
    clean(new CapsuleGeometry(0.9, 2.6, 4, 16)),
    ...[0, 1.2, -1.2].map((y) =>
      clean(new TorusGeometry(1.15, 0.04, 4, 32).rotateX(Math.PI / 2).translate(0, y, 0)),
    ),
  ]);
  const material = effectMaterial(
    {
      uniforms: { uTime: time },
      vertexShader: /* glsl */ `
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; varying vec3 vPoint; varying vec3 vColor;
void main() {
  vUv = uv; vPoint = position; vColor = instanceColor;
  vec4 view = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vView = -view.xyz;
  gl_Position = projectionMatrix * view;
}`,
      fragmentShader: /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying vec3 vNormal; varying vec3 vView; varying vec3 vPoint; varying vec3 vColor;
void main() {
  vec2 cell = abs(fract(vUv * vec2(12.0, 6.0)) - 0.5);
  float grid = smoothstep(0.44, 0.5, max(cell.x, cell.y));
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
  float scan = smoothstep(0.9, 1.0, fract(vPoint.y * 0.8 - uTime * 0.6)) * 0.8;
  float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vPoint.x * 3.0);
  gl_FragColor = vec4(vColor * (grid * 0.7 + rim * 0.45 + scan * 0.6 + 0.03) * flicker * 0.6, 1.0);
  ${EFFECT}
}`,
      side: DoubleSide,
    },
    light,
  );
  return { geometry, material };
}

/** One ship holding orbit. */
interface Ship {
  readonly issue: FactoryPlanned;
  readonly targets: readonly ZoneBody[];
  readonly angle: number;
  readonly height: number;
  readonly radius: number;
  readonly scale: number;
  readonly phase: number;
  readonly every: number;
  next: number;
  readonly at: Vector3;
  readonly hologram: Vector3;
}

/** The planned work's supply ships, holding orbit over the zones their issues are placed on. */
export class Fleet {
  readonly group = new Group();
  readonly pick: InstancedMesh;
  readonly #hull: InstancedMesh;
  readonly #holo: InstancedMesh;
  readonly #engines: Points;
  readonly #beams: LineSegments;
  readonly #signal: typeof SIGNAL_COLOR;
  #ships: Ship[] = [];
  #chosen: Ship | undefined;
  readonly #matrix = new Matrix4();
  readonly #scale = new Matrix4();
  readonly #turn = new Quaternion();
  readonly #tint = new Color();

  constructor(
    signal: typeof SIGNAL_COLOR,
    hull: Material,
    time: { value: number },
    effects: EffectUniforms,
  ) {
    this.#signal = signal;
    this.#hull = new InstancedMesh(shipHull(), hull, MAX_SHIPS);
    this.#hull.castShadow = true;
    const holo = hologram(time, effects.light);
    this.#holo = new InstancedMesh(holo.geometry, holo.material, MAX_SHIPS);
    this.#holo.setColorAt(0, this.#tint.set(signal.PLANNED));
    this.pick = new InstancedMesh(
      new SphereGeometry(3.8, 8, 6),
      new MeshBasicMaterial({ visible: false }),
      MAX_SHIPS,
    );
    this.#engines = haloPoints(MAX_SHIPS * 2, 1, effects);
    const beams = new BufferGeometry();
    beams.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(FACTORY_WORLD_BOUNDS.MAX_PLACES * 6), 3),
    );
    beams.setAttribute(
      "aAlong",
      new BufferAttribute(
        new Float32Array(FACTORY_WORLD_BOUNDS.MAX_PLACES * 2).map((_, index) => index % 2),
        1,
      ),
    );
    beams.setDrawRange(0, 0);
    this.#beams = new LineSegments(
      beams,
      effectMaterial(
        {
          uniforms: { uTime: time, uColor: { value: new Color(signal.PLANNED) } },
          vertexShader: /* glsl */ `
attribute float aAlong; varying float vAlong;
void main() { vAlong = aAlong; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
uniform float uTime; uniform vec3 uColor; varying float vAlong;
void main() {
  float dash = step(0.5, fract(vAlong * 14.0 - uTime * 0.8));
  gl_FragColor = vec4(uColor * (0.4 + 0.6 * dash) * (1.0 - vAlong * 0.5), 1.0);
  ${EFFECT}
}`,
        },
        effects.light,
      ),
    );
    this.#beams.frustumCulled = false;
    for (const mesh of [this.#hull, this.#holo, this.pick]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
    this.group.add(this.#hull, this.#holo, this.pick, this.#engines, this.#beams);
  }

  targetOf(instance: number): PickTarget | undefined {
    const ship = this.#ships[instance];
    return ship === undefined ? undefined : { kind: PICK_KIND.PLANNED, id: ship.issue.identifier };
  }

  /** Where the ship picked as `target` holds orbit, in station space. */
  positionOf(target: PickTarget | undefined): Vector3 | undefined {
    return this.#ships.find((ship) => isTarget(target, PICK_KIND.PLANNED, ship.issue.identifier))
      ?.hologram;
  }

  /** Puts a ship in orbit for each of `planned`, over the zones it names. */
  update(
    planned: readonly FactoryPlanned[],
    bodies: ReadonlyMap<string, ZoneBody>,
    chosen: readonly PickTarget[],
  ): void {
    const above = new Map<ZoneBody, number>();
    // Note that a ship keeps its countdown to its next blueprint across redraws, or a hover would postpone it forever.
    const waiting = new Map(this.#ships.map((ship) => [ship.issue.identifier, ship.next]));
    this.#ships = planned.slice(0, MAX_SHIPS).map((issue, index) => {
      const targets = issue.zonePaths.flatMap((path) => bodies.get(path) ?? []);
      const first = targets[0];
      const nearCentre = first === undefined || first.center.lengthSq() < 4;
      const base = first === undefined ? index * 2.399 : Math.atan2(first.center.z, first.center.x);
      const order = first === undefined ? 0 : (above.get(first) ?? 0);
      if (first !== undefined) above.set(first, order + 1);
      const priority = issue.priority ?? LINEAR_PRIORITY.NONE;
      return {
        issue,
        targets,
        angle: base + (nearCentre ? index * 0.7 : 0) + (order - 0.5) * 0.16,
        height: ORBIT.HEIGHT + (index % 4) * 3.2 + order * 2,
        radius: ORBIT.RADIUS + (index % 3) * 3.5,
        scale: PRIORITY_SCALE[priority],
        phase: ((hashOf(issue.identifier) % 1000) / 1000) * TAU,
        every: PRIORITY_EVERY[priority],
        next: waiting.get(issue.identifier) ?? 1 + (hashOf(issue.identifier) % 600) / 100,
        at: v3(),
        hologram: v3(),
      };
    });
    this.#chosen = this.#ships.find((ship) =>
      chosen.some((target) => isTarget(target, PICK_KIND.PLANNED, ship.issue.identifier)),
    );
    this.#ships.forEach((ship, index) => {
      const chosenShip = ship === this.#chosen;
      this.#tint
        .set(chosenShip ? this.#signal.SELECTION : this.#signal.PLANNED)
        .multiplyScalar(
          (chosenShip ? 2.2 : 1) *
            (ship.issue.priority === LINEAR_PRIORITY.URGENT ||
            ship.issue.priority === LINEAR_PRIORITY.HIGH
              ? 1.3
              : 1),
        );
      this.#holo.setColorAt(index, this.#tint);
    });
    if (this.#holo.instanceColor !== null) this.#holo.instanceColor.needsUpdate = true;
    for (const mesh of [this.#hull, this.#holo, this.pick]) mesh.count = this.#ships.length;
    this.#engines.geometry.setDrawRange(0, this.#ships.length * 2);
    const engineColor = this.#engines.geometry.getAttribute("color");
    const engineSize = this.#engines.geometry.getAttribute("size");
    for (let index = 0; index < this.#ships.length * 2; index += 1) {
      engineColor.setXYZ(index, 0.4, 0.75, 1.6);
      engineSize.setX(index, 1.1);
    }
    engineColor.needsUpdate = true;
    engineSize.needsUpdate = true;
    this.frame(0, 0);
  }

  /** Holds every ship in orbit at `elapsed`, and sends each one's blueprint down when its turn comes. */
  frame(elapsed: number, delta: number, send?: (from: Vector3, to: ZoneBody) => void): void {
    const engines = this.#engines.geometry.getAttribute("position");
    this.#ships.forEach((ship, index) => {
      const angle = ship.angle + Math.sin(elapsed * 0.05 + ship.phase) * 0.03;
      const height = ship.height + Math.sin(elapsed * 0.4 + ship.phase) * 0.6;
      ship.at.copy(radial(angle).multiplyScalar(ship.radius)).setY(height);
      const forward = tangent(angle);
      const size = ship.scale * 0.65;
      this.#matrix
        .copy(basisFromZ(forward, undefined, ship.at))
        .multiply(this.#scale.makeScale(size, size, size));
      this.#hull.setMatrixAt(index, this.#matrix);
      for (const side of [0, 1]) {
        const engine = v3(side === 1 ? 0.88 : -0.88, -0.08, -2).applyMatrix4(this.#matrix);
        engines.setXYZ(index * 2 + side, engine.x, engine.y, engine.z);
      }
      ship.hologram.copy(ship.at).add(v3(0, -2 * ship.scale, 0));
      this.pick.setMatrixAt(
        index,
        this.#matrix.makeTranslation(ship.hologram.x, ship.hologram.y, ship.hologram.z),
      );
      this.#turn
        .setFromRotationMatrix(basisFromZ(forward))
        .multiply(new Quaternion().setFromAxisAngle(v3(1, 0, 0), Math.PI / 2));
      this.#turn.multiply(
        new Quaternion().setFromAxisAngle(v3(0, 1, 0), elapsed * 0.3 + ship.phase),
      );
      this.#holo.setMatrixAt(
        index,
        this.#matrix.compose(ship.hologram, this.#turn, v3(ship.scale, ship.scale, ship.scale)),
      );
      const target = ship.targets[0];
      if (send !== undefined && target !== undefined) {
        ship.next -= delta;
        if (ship.next <= 0) {
          ship.next = ship.every * (0.8 + Math.random() * 0.4);
          send(ship.hologram.clone(), target);
        }
      }
    });
    for (const mesh of [this.#hull, this.#holo, this.pick]) mesh.instanceMatrix.needsUpdate = true;
    engines.needsUpdate = true;
    this.#aimBeams();
  }

  /** The chosen ship's beams, one to each zone its issue names. */
  #aimBeams(): void {
    const ship = this.#chosen;
    const beams = this.#beams.geometry;
    const position = beams.getAttribute("position");
    const targets = ship?.targets.slice(0, FACTORY_WORLD_BOUNDS.MAX_PLACES) ?? [];
    targets.forEach((body, index) => {
      if (ship === undefined) return;
      position.setXYZ(index * 2, ship.hologram.x, ship.hologram.y, ship.hologram.z);
      position.setXYZ(index * 2 + 1, body.center.x, body.center.y, body.center.z);
    });
    position.needsUpdate = true;
    beams.setDrawRange(0, targets.length * 2);
  }
}

/** Sends a blueprint from a ship down to `body`, lighting the zone in the planned colour as it lands. */
export function blueprint(
  streaks: Streaks,
  sparks: Sparks,
  flash: ZoneFlash,
  signal: typeof SIGNAL_COLOR,
): (from: Vector3, body: ZoneBody) => void {
  const color = new Color(signal.PLANNED);
  return (from, body) => {
    const to = body.center.clone();
    const bend = from
      .clone()
      .lerp(to, 0.5)
      .add(v3(0, 6 + from.distanceTo(to) * 0.12, 0));
    streaks.send(from, bend, to, 3.2, signal.PLANNED, 1.6, () => {
      flash(body, signal.PLANNED, 0.6);
      sparks.confetti(to, color, 10, 3);
    });
  };
}
