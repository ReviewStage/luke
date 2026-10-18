import { FACTORY_WORLD_BOUNDS, type FactoryDefect } from "@luke/features/factory-world-wire";
import type { SIGNAL_COLOR } from "@luke/ui/factory-world";
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Euler,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Path,
  PointLight,
  Points,
  RingGeometry,
  ShaderMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { PICK_KIND, type PickTarget } from "../../world";
import type { Sparks, Streaks } from "./effects";
import { basisFromZ, between, box, clamp, clean, hashOf, merged, seeded, TAU, v3 } from "./kit";
import { EFFECT, type EffectUniforms, effectMaterial, SHADER_OUTPUT } from "./materials";
import type { ZoneBody } from "./station";

/**
 * damage.ts -- defects as damage: each one a breach torn in the hull of the zone it is placed on, its rim burning in the defect colour, scorched about, venting atmosphere that freezes as it leaves, and a red beacon turning over every damaged zone.
 *
 * A breach is wider as its defect reaches more events, up to what its hull
 * can hold. Its place on the hull is seeded by the defect's id, so it opens
 * in the same place every time. The breaches only change when the defects
 * do, so their scorch, holes, rims and torn plates merge into one mesh of
 * each, rebuilt then and only then; the beacons and pick spheres are
 * instanced at the bound. While motion runs, the wounds flicker, spark, and
 * draw defect light up from Earth into them, oftener the more events they
 * reach; held still, every rim burns steady.
 */

const MAX_DEFECTS = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;
/** The most venting crystals across every breach. */
const MAX_VENTING = 12000;
/** A defect reaching this many events throws red light on the hull about it. */
const LIGHT_AT_EVENTS = 50;

/** One breach. */
interface Breach {
  readonly defect: FactoryDefect;
  readonly body: ZoneBody;
  readonly at: Vector3;
  readonly normal: Vector3;
  readonly radius: number;
  readonly every: number;
  next: number;
}

/** Whether two lists of defects would tear the same breaches. */
function sameDefects(left: readonly FactoryDefect[], right: readonly FactoryDefect[]): boolean {
  return (
    left.length === right.length &&
    left.every((defect, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        defect.id === other.id &&
        defect.events === other.events &&
        defect.zonePaths[0] === other.zonePaths[0]
      );
    })
  );
}

/** Conforms `geometry`, placed by `matrix`, onto `body`'s hull, `lift` above it. */
function conform(
  geometry: BufferGeometry,
  matrix: Matrix4,
  body: ZoneBody,
  lift: number,
): BufferGeometry {
  geometry.applyMatrix4(matrix);
  const position = geometry.getAttribute("position");
  const point = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    body.project(point, lift);
    position.setXYZ(index, point.x, point.y, point.z);
  }
  return geometry;
}

/** A jagged ring, the torn rim of a hole. */
function jaggedRim(inner: number, outer: number, seed: number): BufferGeometry {
  const random = seeded(seed);
  const shape = new Shape();
  const hole = new Path();
  const steps = 40;
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * TAU;
    const reach = outer * (0.75 + 0.5 * random());
    if (step === 0) shape.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
    else shape.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  for (let step = 0; step <= steps; step += 1) {
    const angle = (-step / steps) * TAU;
    const reach = inner * (0.8 + 0.35 * random());
    if (step === 0) hole.moveTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
    else hole.lineTo(Math.cos(angle) * reach, Math.sin(angle) * reach);
  }
  shape.holes.push(hole);
  return new ShapeGeometry(shape);
}

/** The breaches, their venting, and the beacons over damaged zones. */
export class Damage {
  readonly group = new Group();
  readonly pick: InstancedMesh;
  readonly #beacons: InstancedMesh;
  readonly #beams: InstancedMesh;
  readonly #light: PointLight;
  readonly #rim: MeshBasicMaterial;
  readonly #hole: ShaderMaterial;
  readonly #scorch: MeshBasicMaterial;
  readonly #vent: ShaderMaterial;
  readonly #hull: Material;
  readonly #signal: typeof SIGNAL_COLOR;
  #wounds = new Group();
  #breaches: Breach[] = [];
  #defects: readonly FactoryDefect[] = [];
  #beaconAt: { at: Vector3; severity: number }[] = [];
  readonly #matrix = new Matrix4();
  readonly #turn = new Matrix4();
  readonly #scale = new Matrix4();

  constructor(
    signal: typeof SIGNAL_COLOR,
    hull: Material,
    time: { value: number },
    motion: { value: number },
    effects: EffectUniforms,
  ) {
    this.#signal = signal;
    this.#hull = hull;
    this.#rim = new MeshBasicMaterial({
      color: signal.DEFECT,
      toneMapped: false,
      side: DoubleSide,
    });
    this.#scorch = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: DoubleSide,
    });
    this.#hole = new ShaderMaterial({
      uniforms: { uTime: time, uMotion: motion, uColor: { value: new Color(signal.DEFECT) } },
      side: DoubleSide,
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
uniform float uTime, uMotion; uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float flicker = mix(1.0, 0.75 + 0.25 * sin(uTime * 11.0) * sin(uTime * 4.3), uMotion);
  gl_FragColor = vec4(mix(uColor * 2.2 * flicker, vec3(0.03, 0.0, 0.0), smoothstep(0.0, 0.8, d)), 1.0);
  ${SHADER_OUTPUT}
}`,
    });
    this.#vent = effectMaterial(
      {
        uniforms: { uTime: time, uScale: effects.viewport },
        vertexShader: /* glsl */ `
attribute vec3 aDirection; attribute vec4 aSpray;
uniform float uTime, uScale;
varying float vAlpha; varying float vSeed;
void main() {
  float life = aSpray.z;
  float t = fract(uTime / life + aSpray.x);
  float age = t * life;
  vec3 p = position + aDirection * aSpray.y * age * (1.0 - 0.18 * t)
    + vec3(sin(aSpray.x * 40.0 + uTime), cos(aSpray.x * 30.0 + uTime * 0.7), sin(aSpray.x * 20.0)) * age * 0.12;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vAlpha = (1.0 - t) * smoothstep(0.0, 0.05, t);
  vSeed = aSpray.x;
  float twinkle = 0.6 + 0.4 * sin(uTime * 12.0 + aSpray.x * 100.0);
  gl_PointSize = min(aSpray.w * (1.0 + t * 1.5) * uScale / -view.z * 3.0 * twinkle, 48.0);
  gl_Position = projectionMatrix * view;
}`,
        fragmentShader: /* glsl */ `
varying float vAlpha; varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  float star = max(0.0, 1.0 - abs(c.x * c.y) * 60.0) * smoothstep(0.5, 0.0, d);
  float a = exp(-d * d * 22.0) + star * 0.6;
  vec3 color = mix(vec3(0.75, 0.9, 1.0), vec3(1.0, 0.55, 0.45), step(0.85, vSeed));
  gl_FragColor = vec4(color * a * vAlpha * 1.6, 1.0);
  ${EFFECT}
}`,
      },
      effects.light,
    );
    this.pick = new InstancedMesh(
      new SphereGeometry(1, 12, 8),
      new MeshBasicMaterial({ visible: false }),
      MAX_DEFECTS,
    );
    this.#beacons = new InstancedMesh(
      new SphereGeometry(0.35, 16, 10),
      new MeshBasicMaterial({ color: signal.DEFECT, toneMapped: false }),
      MAX_DEFECTS,
    );
    const beam = new ConeGeometry(1, 1, 24, 1, true).translate(0, -0.5, 0).rotateZ(Math.PI / 2);
    this.#beams = new InstancedMesh(
      beam,
      effectMaterial(
        {
          uniforms: { uColor: { value: new Color(signal.DEFECT) } },
          side: DoubleSide,
          vertexShader: /* glsl */ `
varying float vAlong;
void main() { vAlong = position.x; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
          fragmentShader: /* glsl */ `
uniform vec3 uColor; varying float vAlong;
void main() { gl_FragColor = vec4(uColor * 0.5 * exp(-vAlong * 2.4), 1.0); ${EFFECT} }`,
        },
        effects.light,
      ),
      MAX_DEFECTS * 2,
    );
    this.#light = new PointLight(signal.DEFECT, 0, 38, 1.6);
    for (const mesh of [this.pick, this.#beacons, this.#beams]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
    }
    this.group.add(this.#wounds, this.pick, this.#beacons, this.#beams, this.#light);
  }

  targetOf(instance: number): PickTarget | undefined {
    const breach = this.#breaches[instance];
    return breach === undefined ? undefined : { kind: PICK_KIND.DEFECT, id: breach.defect.id };
  }

  /** Where the defect picked as `target` breaches its hull, in station space. */
  positionOf(target: PickTarget | undefined): Vector3 | undefined {
    if (target?.kind !== PICK_KIND.DEFECT) return undefined;
    return this.#breaches.find((breach) => breach.defect.id === target.id)?.at;
  }

  /** The zones a defect damages, by how many events reach them. */
  severityOf(): ReadonlyMap<ZoneBody, number> {
    const severity = new Map<ZoneBody, number>();
    for (const breach of this.#breaches)
      severity.set(breach.body, (severity.get(breach.body) ?? 0) + breach.defect.events);
    return severity;
  }

  /** Tears a breach for each of `defects` on the zone it is placed on, or on `fallback`; only rebuilt when the defects change. */
  update(
    defects: readonly FactoryDefect[],
    bodies: ReadonlyMap<string, ZoneBody>,
    fallback: ZoneBody | undefined,
    rebuilt: boolean,
  ): void {
    if (!rebuilt && sameDefects(defects, this.#defects)) return;
    this.#defects = defects;
    this.#breaches = defects.slice(0, MAX_DEFECTS).flatMap((defect) => {
      const placed = defect.zonePaths
        .flatMap((path) => bodies.get(path) ?? [])
        .find((body) => !body.turning);
      const body = placed ?? fallback;
      if (body === undefined) return [];
      const random = seeded(hashOf(defect.id));
      const { point, normal } = body.surface(between(random, 0.1, 0.9), between(random, -1.5, 1.5));
      const limit = body.hullRadius * 0.82;
      return [
        {
          defect,
          body,
          at: point.clone(),
          normal: normal.clone().normalize(),
          radius: Math.min(limit, 0.45 + 0.36 * Math.sqrt(defect.events)),
          every: clamp(26 / Math.max(1, defect.events), 0.45, 22),
          next: random() * 3,
        },
      ];
    });
    this.#tear();
    this.#raiseBeacons();
  }

  /** The scorch, holes, rims, torn plates, and venting of every breach, merged. */
  #tear(): void {
    this.#wounds.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) object.geometry.dispose();
    });
    this.group.remove(this.#wounds);
    this.#wounds = new Group();
    this.group.add(this.#wounds);
    if (this.#breaches.length === 0) {
      this.pick.count = 0;
      return;
    }
    const scorch: BufferGeometry[] = [];
    const holes: BufferGeometry[] = [];
    const rims: BufferGeometry[] = [];
    const plates: BufferGeometry[] = [];
    this.#breaches.forEach((breach, index) => {
      const { body, at, normal, radius, defect } = breach;
      const random = seeded(hashOf(defect.id) + 1);
      const frame = basisFromZ(normal, undefined, at.clone().addScaledVector(normal, 0.06));
      scorch.push(
        clean(conform(new RingGeometry(radius * 0.7, radius * 1.7, 40, 6), frame, body, 0.03)),
      );
      holes.push(clean(conform(new RingGeometry(0.001, radius * 0.8, 40, 8), frame, body, 0.05)));
      rims.push(
        clean(conform(jaggedRim(radius * 0.72, radius, 77 + defect.events), frame, body, 0.08)),
      );
      const torn = 5 + Math.min(6, Math.floor(defect.events / 10));
      for (let k = 0; k < torn; k += 1) {
        const angle = (k / 6) * TAU + random() * 0.5;
        const plate = new Matrix4()
          .makeRotationFromEuler(
            new Euler(between(random, -0.8, 0.8), between(random, -0.8, 0.8), angle),
          )
          .setPosition(
            Math.cos(angle) * radius * 0.95,
            Math.sin(angle) * radius * 0.95,
            0.25 + radius * 0.1,
          );
        plates.push(
          clean(
            box(radius * 0.45, 0.05, radius * 0.35).applyMatrix4(frame.clone().multiply(plate)),
          ),
        );
      }
      this.pick.setMatrixAt(
        index,
        this.#matrix
          .makeScale(
            Math.max(2.2, radius * 1.5),
            Math.max(2.2, radius * 1.5),
            Math.max(2.2, radius * 1.5),
          )
          .setPosition(at),
      );
    });
    this.pick.count = this.#breaches.length;
    this.pick.instanceMatrix.needsUpdate = true;
    const hole = new Mesh(merged(holes), this.#hole);
    const rim = new Mesh(merged(rims), this.#rim);
    hole.renderOrder = 3;
    rim.renderOrder = 3;
    const torn = new Mesh(merged(plates), this.#hull);
    torn.castShadow = true;
    this.#wounds.add(new Mesh(merged(scorch), this.#scorch), hole, rim, torn, this.#venting());
  }

  /** Atmosphere venting from every breach and freezing as it goes, simulated in its vertex shader. */
  #venting(): Points {
    const counts = this.#breaches.map((breach) => Math.min(1400, 40 + breach.defect.events * 16));
    const share = Math.min(
      1,
      MAX_VENTING /
        Math.max(
          1,
          counts.reduce((sum, count) => sum + count, 0),
        ),
    );
    const total = counts.reduce((sum, count) => sum + Math.floor(count * share), 0);
    const origins = new Float32Array(total * 3);
    const directions = new Float32Array(total * 3);
    const sprays = new Float32Array(total * 4);
    let cursor = 0;
    this.#breaches.forEach((breach, index) => {
      const random = seeded(hashOf(breach.defect.id) + 2);
      const count = Math.floor((counts[index] ?? 0) * share);
      const strength = 0.6 + Math.sqrt(breach.defect.events) * 0.1;
      const spread = 0.35 + 0.1 * Math.min(1, breach.defect.events / 30);
      const across = new Vector3()
        .crossVectors(breach.normal, Math.abs(breach.normal.y) < 0.9 ? v3(0, 1, 0) : v3(1, 0, 0))
        .normalize();
      const up = new Vector3().crossVectors(breach.normal, across);
      for (let n = 0; n < count; n += 1, cursor += 1) {
        const angle = random() * TAU;
        const reach = Math.sqrt(random()) * breach.radius * 0.6;
        const origin = breach.at
          .clone()
          .addScaledVector(across, Math.cos(angle) * reach)
          .addScaledVector(up, Math.sin(angle) * reach);
        const direction = breach.normal
          .clone()
          .addScaledVector(across, (random() - 0.5) * spread * 2)
          .addScaledVector(up, (random() - 0.5) * spread * 2)
          .normalize();
        origins.set(origin.toArray(), cursor * 3);
        directions.set(direction.toArray(), cursor * 3);
        sprays.set(
          [
            random(),
            (1.5 + random() * 3) * strength,
            1.6 + random() * 1.8,
            0.05 + random() * 0.16 * strength,
          ],
          cursor * 4,
        );
      }
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(origins, 3));
    geometry.setAttribute("aDirection", new BufferAttribute(directions, 3));
    geometry.setAttribute("aSpray", new BufferAttribute(sprays, 4));
    const vent = new Points(geometry, this.#vent);
    vent.frustumCulled = false;
    return vent;
  }

  /** A beacon over each damaged zone, its beams as long as the zone's events are many, and red light on the worst. */
  #raiseBeacons(): void {
    const byZone = new Map<ZoneBody, Breach[]>();
    for (const breach of this.#breaches)
      byZone.set(breach.body, [...(byZone.get(breach.body) ?? []), breach]);
    this.#beaconAt = [...byZone.values()].flatMap((breaches) => {
      const first = breaches[0];
      if (first === undefined) return [];
      const severity = breaches.reduce((sum, breach) => sum + breach.defect.events, 0);
      return [{ at: first.at.clone().addScaledVector(first.normal, first.radius + 0.6), severity }];
    });
    this.#beacons.count = this.#beaconAt.length;
    this.#beams.count = this.#beaconAt.length * 2;
    this.#beaconAt.forEach(({ at }, index) => {
      this.#beacons.setMatrixAt(index, this.#matrix.makeTranslation(at.x, at.y, at.z));
    });
    this.#beacons.instanceMatrix.needsUpdate = true;
    const worst = [...this.#breaches].sort(
      (left, right) => right.defect.events - left.defect.events,
    )[0];
    this.#light.visible = worst !== undefined && worst.defect.events >= LIGHT_AT_EVENTS;
    if (worst !== undefined) this.#light.position.copy(worst.at).addScaledVector(worst.normal, 2.5);
    this.frame(0, 0, true);
  }

  /** Turns the beacons and flickers the wounds at `elapsed`; while live, draws defect light up into them and sparks the worst. */
  frame(
    elapsed: number,
    delta: number,
    still: boolean,
    effects?: { streaks: Streaks; sparks: Sparks },
  ): void {
    this.#beaconAt.forEach(({ at, severity }, index) => {
      const length = 6 + Math.min(severity, 200) * 0.08;
      const width = 1.4 + Math.min(severity, 200) * 0.03;
      for (const side of [0, 1]) {
        this.#turn.makeRotationY(elapsed * 3.2 + side * Math.PI);
        this.#matrix
          .makeTranslation(at.x, at.y, at.z)
          .multiply(this.#turn)
          .multiply(this.#scale.makeScale(length, width, width));
        this.#beams.setMatrixAt(index * 2 + side, this.#matrix);
      }
    });
    this.#beams.instanceMatrix.needsUpdate = true;
    const flicker = still ? 1 : 0.7 + 0.3 * Math.sin(elapsed * 9) * Math.sin(elapsed * 23);
    this.#rim.color.set(this.#signal.DEFECT).multiplyScalar(flicker);
    this.#light.intensity = this.#light.visible
      ? 260 * (still ? 0.7 : (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 3.2)) ** 2) * flicker)
      : 0;
    if (effects === undefined) return;
    const color = new Color(this.#signal.DEFECT);
    for (const breach of this.#breaches) {
      breach.next -= delta;
      if (breach.next <= 0) {
        breach.next = breach.every * (0.7 + Math.random() * 0.6);
        const to = breach.at.clone().addScaledVector(breach.normal, 0.3);
        const across = v3(to.x, 0, to.z);
        if (across.lengthSq() < 1) across.set(Math.random() - 0.5, 0, Math.random() - 0.5);
        across.normalize();
        const from = across
          .clone()
          .multiplyScalar(90 + Math.random() * 60)
          .add(v3(Math.random() * 50 - 25, -150, Math.random() * 50 - 25));
        const bend = from.clone().lerp(to, 0.6).addScaledVector(across, 12);
        effects.streaks.send(from, bend, to, 2.4, this.#signal.DEFECT, 1.5, () => {
          for (let k = 0; k < 10; k += 1) {
            effects.sparks.emit(
              to,
              breach.normal.clone().multiplyScalar(2).add(v3().randomDirection().multiplyScalar(3)),
              0.4 + Math.random() * 0.4,
              color,
              0.5,
            );
          }
        });
      }
      if (
        breach.defect.events >= 5 &&
        Math.random() < 0.06 + Math.min(breach.defect.events, 300) / 600
      ) {
        for (let k = 0; k < 4; k += 1) {
          const off = new Vector3()
            .crossVectors(breach.normal, v3(0, 1, 0))
            .normalize()
            .applyAxisAngle(breach.normal, Math.random() * TAU)
            .multiplyScalar(breach.radius);
          effects.sparks.emit(
            breach.at.clone().add(off),
            breach.normal
              .clone()
              .multiplyScalar(2 + Math.random() * 3)
              .add(
                v3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(3),
              ),
            0.3 + Math.random() * 0.5,
          );
        }
      }
    }
  }
}
