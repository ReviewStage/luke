import {
  BufferAttribute,
  BufferGeometry,
  Color,
  type ColorRepresentation,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  Points,
  RingGeometry,
  ShaderMaterial,
  type Vector3,
} from "three";
import { clamp, easeInOut, v3 } from "./kit";
import {
  EFFECT,
  type EffectUniforms,
  effectMaterial,
  haloMaterial,
  SHADER_OUTPUT,
} from "./materials";

/**
 * effects.ts -- the light that moves: welding sparks and confetti from one pool, the streaks that carry work between Earth, the ships and the station, the rings a launch throws off, the halos, and the reticles that ring what the developer hovers or chose.
 *
 * Each is one draw call over a pool allocated at its bound when the world
 * is created, and each frame rewrites the pool's buffers in place, so
 * nothing is allocated while motion runs. A pool's slot that is not in use
 * is drawn at size zero.
 */

/** The sparks' pool: welding, confetti, and a defect's sparking panels. */
const SPARK_COUNT = 2400;
/** The streaks in flight at once, and the points along each one's trail. */
const STREAKS = { COUNT: 64, TRAIL: 16 } as const;
/** The launch rings at once. */
const BURST_COUNT = 8;
/** How long a launch ring lasts, in seconds. */
const BURST_SECONDS = 1.6;

/** The welding torch's colour, which is no signal: white-hot to orange. */
function weldingInto(target: Color, fade: number): Color {
  return target.setRGB(3 * fade, (1.6 + fade) * fade, 0.6 * fade * fade);
}

/** Halo points whose positions, colours and sizes a caller writes: the glow about an agent, a shipped light, a ship's engines. */
export function haloPoints(count: number, strength: number, effects: EffectUniforms): Points {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("size", new BufferAttribute(new Float32Array(count), 1));
  geometry.setDrawRange(0, 0);
  const points = new Points(geometry, haloMaterial(strength, effects));
  points.frustumCulled = false;
  return points;
}

interface Spark {
  readonly at: Vector3;
  readonly velocity: Vector3;
  life: number;
  span: number;
  /** Its own colour, or none for the welding torch's. */
  color: Color | undefined;
  size: number;
}

/** One pool of sparks, written round-robin, each fading as it flies. */
export class Sparks {
  readonly points: Points;
  readonly #sparks: Spark[];
  #cursor = 0;

  constructor(effects: EffectUniforms) {
    this.points = haloPoints(SPARK_COUNT, 1, effects);
    this.points.geometry.setDrawRange(0, SPARK_COUNT);
    this.#sparks = Array.from({ length: SPARK_COUNT }, () => ({
      at: v3(),
      velocity: v3(),
      life: 0,
      span: 1,
      color: undefined,
      size: 0.35,
    }));
  }

  /** Throws one spark from `at` at `velocity`, living `life` seconds, in `color` or the torch's. */
  emit(at: Vector3, velocity: Vector3, life: number, color?: Color, size = 0.35): void {
    this.#cursor = (this.#cursor + 1) % SPARK_COUNT;
    const spark = this.#sparks[this.#cursor];
    if (spark === undefined) return;
    spark.at.copy(at);
    spark.velocity.copy(velocity);
    spark.life = life;
    spark.span = life;
    spark.color = color;
    spark.size = size;
  }

  /** A burst of `count` sparks in `color` from `at`, as a launch or an arrival throws. */
  confetti(at: Vector3, color: Color, count: number, speed: number): void {
    for (let n = 0; n < count; n += 1) {
      const velocity = v3()
        .randomDirection()
        .multiplyScalar(speed * (0.35 + Math.random()));
      this.emit(at, velocity, 0.9 + Math.random() * 0.9, color, 0.7);
    }
  }

  clear(): void {
    for (const spark of this.#sparks) spark.life = 0;
  }

  /** Flies every spark `delta` seconds and writes the pool. */
  step(delta: number): void {
    const geometry = this.points.geometry;
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    const size = geometry.getAttribute("size");
    const tint = new Color();
    this.#sparks.forEach((spark, index) => {
      if (spark.life > 0) {
        spark.life -= delta;
        spark.at.addScaledVector(spark.velocity, delta);
        spark.velocity.multiplyScalar(1 - delta * 1.5);
      }
      const fade = Math.max(0, spark.life / spark.span);
      position.setXYZ(index, spark.at.x, spark.at.y, spark.at.z);
      if (spark.color === undefined) weldingInto(tint, fade);
      else tint.copy(spark.color).multiplyScalar(2.4 * fade);
      color.setXYZ(index, tint.r, tint.g, tint.b);
      size.setX(index, fade > 0 ? spark.size * fade + 0.05 : 0);
    });
    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
  }
}

/** One streak: a quadratic curve it eases along, and what happens when it lands. */
interface Streak {
  readonly from: Vector3;
  readonly bend: Vector3;
  readonly to: Vector3;
  readonly seconds: number;
  age: number;
  readonly color: Color;
  readonly size: number;
  readonly land: () => void;
  readonly trail: Vector3[];
}

function bezier(from: Vector3, bend: Vector3, to: Vector3, t: number, into: Vector3): Vector3 {
  const u = 1 - t;
  return into
    .set(0, 0, 0)
    .addScaledVector(from, u * u)
    .addScaledVector(bend, 2 * u * t)
    .addScaledVector(to, t * t);
}

/** Lights in flight: a blueprint from a ship to the zone that will build it, a defect from Earth up into its breach. */
export class Streaks {
  readonly points: Points;
  readonly #streaks: Streak[] = [];

  constructor(effects: EffectUniforms) {
    this.points = haloPoints(STREAKS.COUNT * STREAKS.TRAIL, 1, effects);
    this.points.geometry.setDrawRange(0, STREAKS.COUNT * STREAKS.TRAIL);
  }

  /** Sends a streak from `from` round `bend` to `to` over `seconds`, calling `land` when it arrives. */
  send(
    from: Vector3,
    bend: Vector3,
    to: Vector3,
    seconds: number,
    color: ColorRepresentation,
    size: number,
    land: () => void,
  ): void {
    if (this.#streaks.length >= STREAKS.COUNT) return;
    this.#streaks.push({
      from,
      bend,
      to,
      seconds,
      age: 0,
      color: new Color(color),
      size,
      land,
      trail: [],
    });
  }

  clear(): void {
    this.#streaks.length = 0;
    this.step(0);
  }

  step(delta: number): void {
    for (let index = this.#streaks.length - 1; index >= 0; index -= 1) {
      const streak = this.#streaks[index];
      if (streak === undefined) continue;
      streak.age += delta;
      if (streak.age >= streak.seconds) {
        streak.land();
        this.#streaks.splice(index, 1);
      }
    }
    const geometry = this.points.geometry;
    const position = geometry.getAttribute("position");
    const color = geometry.getAttribute("color");
    const size = geometry.getAttribute("size");
    for (let slot = 0; slot < STREAKS.COUNT; slot += 1) {
      const streak = this.#streaks[slot];
      if (streak === undefined) {
        for (let k = 0; k < STREAKS.TRAIL; k += 1) size.setX(slot * STREAKS.TRAIL + k, 0);
        continue;
      }
      streak.trail.unshift(
        bezier(streak.from, streak.bend, streak.to, easeInOut(streak.age / streak.seconds), v3()),
      );
      if (streak.trail.length > STREAKS.TRAIL) streak.trail.pop();
      for (let k = 0; k < STREAKS.TRAIL; k += 1) {
        const at = streak.trail[Math.min(k, streak.trail.length - 1)] ?? streak.from;
        const index = slot * STREAKS.TRAIL + k;
        const weight = 1 - k / STREAKS.TRAIL;
        position.setXYZ(index, at.x, at.y, at.z);
        color.setXYZ(
          index,
          streak.color.r * weight * 1.6,
          streak.color.g * weight * 1.6,
          streak.color.b * weight * 1.6,
        );
        size.setX(index, k === 0 ? streak.size * 1.8 : streak.size * weight);
      }
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    size.needsUpdate = true;
  }
}

/** The rings a launch throws off, widening and fading, each facing the camera. */
export class Bursts {
  readonly mesh: InstancedMesh;
  readonly #bursts: { at: Vector3; age: number; color: Color }[] = [];
  readonly #matrix = new Matrix4();
  readonly #tint = new Color();

  constructor(effects: EffectUniforms) {
    this.mesh = new InstancedMesh(
      new RingGeometry(0.85, 1, 48),
      effectMaterial(
        {
          vertexShader: /* glsl */ `
varying vec3 vColor;
void main() {
  vColor = instanceColor;
  vec4 view = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(instanceMatrix[0].xyz);
  view.xy += position.xy * scale;
  gl_Position = projectionMatrix * view;
}`,
          fragmentShader: /* glsl */ `
varying vec3 vColor;
void main() { gl_FragColor = vec4(vColor, 1.0); ${EFFECT} }`,
          side: DoubleSide,
        },
        effects.light,
      ),
      BURST_COUNT,
    );
    // Note that the colours are made now, so the shader is built with them rather than without.
    this.mesh.setColorAt(0, this.#tint);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  launch(at: Vector3, color: ColorRepresentation): void {
    if (this.#bursts.length >= BURST_COUNT) this.#bursts.shift();
    this.#bursts.push({ at: at.clone(), age: 0, color: new Color(color) });
  }

  clear(): void {
    this.#bursts.length = 0;
    this.mesh.count = 0;
  }

  step(delta: number): void {
    for (let index = this.#bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.#bursts[index];
      if (burst === undefined) continue;
      burst.age += delta;
      if (burst.age >= BURST_SECONDS) this.#bursts.splice(index, 1);
    }
    this.#bursts.forEach((burst, index) => {
      const t = burst.age / BURST_SECONDS;
      this.#matrix.makeScale(1 + t * 9, 1 + t * 9, 1).setPosition(burst.at);
      this.mesh.setMatrixAt(index, this.#matrix);
      this.mesh.setColorAt(
        index,
        this.#tint.copy(burst.color).multiplyScalar(3 * (1 - t) * (1 - t)),
      );
    });
    this.mesh.count = this.#bursts.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor !== null) this.mesh.instanceColor.needsUpdate = true;
  }
}

/**
 * A ring about what the developer hovers or chose, in the selection's
 * colour: it faces the camera and keeps a readable size on screen in its
 * vertex shader, so it holds without a frame however the camera moves.
 */
export class Reticle {
  readonly mesh: Mesh;
  readonly #radius = { value: 1 };

  /** A ring of `sides` sides, turning `spin` radians a second. */
  constructor(color: ColorRepresentation, sides: number, time: { value: number }, spin: number) {
    this.mesh = new Mesh(
      new RingGeometry(0.9, 1, sides, 1),
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(color) },
          uRadius: this.#radius,
          uScreen: { value: 0.022 },
          uTime: time,
          uSpin: { value: spin },
        },
        vertexShader: /* glsl */ `
uniform float uRadius, uScreen, uTime, uSpin;
void main() {
  vec4 view = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float angle = uTime * uSpin;
  vec2 turned = mat2(cos(angle), sin(angle), -sin(angle), cos(angle)) * position.xy;
  view.xy += turned * max(uRadius, -view.z * uScreen);
  gl_Position = projectionMatrix * view;
}`,
        fragmentShader: /* glsl */ `
uniform vec3 uColor;
void main() { gl_FragColor = vec4(uColor, 0.95); ${SHADER_OUTPUT} }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    this.mesh.renderOrder = 20;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Rings what stands at `at`, about `radius` across, or nothing. */
  aim(at: Vector3 | undefined, radius: number): void {
    this.mesh.visible = at !== undefined;
    if (at === undefined) return;
    this.mesh.position.copy(at);
    this.#radius.value = clamp(radius, 0.5, 20);
  }
}
