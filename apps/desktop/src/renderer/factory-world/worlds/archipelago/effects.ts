import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  type Color,
  Points,
  type Scene,
  ShaderMaterial,
  type Vector3,
} from "three";
import { randomOf } from "./kit";
import { GLSL_OUTPUT } from "./mood";

/**
 * effects.ts -- the archipelago's particles: sparks off a builder's hammer, fireworks over what shipped, embers off a crack, and the smoke of its chimneys and its wounds.
 *
 * Both pools are allocated once at their bounds and recycled oldest first,
 * so emitting never allocates. They are idle motion alone: a world held
 * still shows none of them, and says what they say some other way.
 */

/** How many sparks and puffs of smoke stand at once. */
const SPARKS = 1600;
const SMOKE = 900;

/** Where smoke rises from: a chimney's white, or a wound's black. */
export interface SmokeSource {
  readonly at: Vector3;
  readonly dark: boolean;
}

/** The particles as the world drives them. */
export interface Effects {
  readonly spark: (
    at: Vector3,
    vx: number,
    vy: number,
    vz: number,
    color: Color,
    life: number,
    size: number,
    drag?: number,
  ) => void;
  /** A firework: `count` sparks of `color` thrown every way from `at`, and a white flash. */
  readonly burst: (at: Vector3, color: Color, count?: number) => void;
  readonly setSmoke: (sources: readonly SmokeSource[], darkOn: boolean) => void;
  readonly frame: (delta: number) => void;
  /** Whether particles show at all: never while the world is held still. */
  readonly setShown: (shown: boolean) => void;
}

/** The particle pools, allocated in `scene`. */
export function effectsOf(scene: Scene): Effects {
  const random = randomOf(0x5eed);
  const spark = {
    position: new Float32Array(SPARKS * 3),
    color: new Float32Array(SPARKS * 3),
    velocity: new Float32Array(SPARKS * 3),
    life: new Float32Array(SPARKS),
    max: new Float32Array(SPARKS),
    size: new Float32Array(SPARKS),
    drag: new Float32Array(SPARKS),
    next: 0,
  };
  const sparkGeometry = new BufferGeometry();
  sparkGeometry.setAttribute("position", new BufferAttribute(spark.position, 3));
  sparkGeometry.setAttribute("color", new BufferAttribute(spark.color, 3));
  sparkGeometry.setAttribute("aSize", new BufferAttribute(spark.size, 1));
  const sparks = new Points(
    sparkGeometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      vertexColors: true,
      vertexShader: /* glsl */ `attribute float aSize; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = aSize * 300. / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec3 vC; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; gl_FragColor = vec4(vC * smoothstep(.5, 0., d), 1.); ${GLSL_OUTPUT} }`,
    }),
  );
  const smoke = {
    position: new Float32Array(SMOKE * 3),
    data: new Float32Array(SMOKE * 3),
    velocity: new Float32Array(SMOKE * 3),
    life: new Float32Array(SMOKE),
    max: new Float32Array(SMOKE),
    next: 0,
  };
  const smokeGeometry = new BufferGeometry();
  smokeGeometry.setAttribute("position", new BufferAttribute(smoke.position, 3));
  smokeGeometry.setAttribute("aData", new BufferAttribute(smoke.data, 3));
  const smokePoints = new Points(
    smokeGeometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `attribute vec3 aData; varying vec3 vD; void main(){ vD = aData; vec4 mv = modelViewMatrix * vec4(position, 1.); gl_PointSize = aData.y * 300. / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec3 vD; void main(){ float d = length(gl_PointCoord - .5); if (d > .5) discard; vec3 c = mix(vec3(0.95, 0.85, 0.82), vec3(0.16, 0.11, 0.16), vD.z); gl_FragColor = vec4(c, smoothstep(.5, .1, d) * vD.x); ${GLSL_OUTPUT} }`,
    }),
  );
  smokePoints.renderOrder = 3;
  for (const points of [sparks, smokePoints]) points.frustumCulled = false;
  scene.add(sparks, smokePoints);
  let sources: { at: Vector3; dark: boolean; owed: number }[] = [];
  let darkShown = true;

  const emit = (
    at: Vector3,
    vx: number,
    vy: number,
    vz: number,
    color: Color,
    life: number,
    size: number,
    drag = 0.98,
  ) => {
    const i = spark.next;
    spark.next = (spark.next + 1) % SPARKS;
    spark.position.set([at.x, at.y, at.z], i * 3);
    spark.velocity.set([vx, vy, vz], i * 3);
    spark.color.set([color.r, color.g, color.b], i * 3);
    spark.life[i] = life;
    spark.max[i] = life;
    spark.size[i] = size;
    spark.drag[i] = drag;
  };

  const stepSparks = (delta: number) => {
    for (let i = 0; i < SPARKS; i += 1) {
      const life = spark.life[i] ?? 0;
      if (life <= 0) {
        spark.size[i] = 0;
        continue;
      }
      spark.life[i] = life - delta;
      spark.velocity[i * 3 + 1] = (spark.velocity[i * 3 + 1] ?? 0) - 3.2 * delta;
      for (let j = 0; j < 3; j += 1) {
        const v = (spark.velocity[i * 3 + j] ?? 0) * (spark.drag[i] ?? 1);
        spark.velocity[i * 3 + j] = v;
        spark.position[i * 3 + j] = (spark.position[i * 3 + j] ?? 0) + v * delta;
      }
      spark.color[i * 3] = (spark.color[i * 3] ?? 0) * 0.985;
      spark.color[i * 3 + 1] = (spark.color[i * 3 + 1] ?? 0) * 0.975;
      spark.color[i * 3 + 2] = (spark.color[i * 3 + 2] ?? 0) * 0.97;
      if (life - delta <= 0) spark.size[i] = 0;
    }
    for (const name of ["position", "color", "aSize"] as const)
      sparkGeometry.getAttribute(name).needsUpdate = true;
  };

  const stepSmoke = (delta: number) => {
    for (const source of sources) {
      if (source.dark && !darkShown) continue;
      source.owed += delta * (source.dark ? 2.2 : 0.9);
      while (source.owed > 1) {
        source.owed -= 1;
        const i = smoke.next;
        smoke.next = (smoke.next + 1) % SMOKE;
        smoke.position.set(
          [source.at.x + (random() - 0.5) * 0.2, source.at.y, source.at.z + (random() - 0.5) * 0.2],
          i * 3,
        );
        smoke.velocity.set(
          [0.25 + random() * 0.2, 0.7 + random() * 0.4, (random() - 0.5) * 0.2],
          i * 3,
        );
        smoke.life[i] = source.dark ? 3.5 : 4.5;
        smoke.max[i] = smoke.life[i] ?? 1;
        smoke.data[i * 3 + 2] = source.dark ? 1 : 0;
      }
    }
    for (let i = 0; i < SMOKE; i += 1) {
      const life = smoke.life[i] ?? 0;
      if (life <= 0) {
        smoke.data[i * 3] = 0;
        continue;
      }
      smoke.life[i] = life - delta;
      const t = 1 - (life - delta) / (smoke.max[i] ?? 1);
      for (let j = 0; j < 3; j += 1)
        smoke.position[i * 3 + j] =
          (smoke.position[i * 3 + j] ?? 0) + (smoke.velocity[i * 3 + j] ?? 0) * delta;
      const dark = (smoke.data[i * 3 + 2] ?? 0) > 0.5;
      smoke.data[i * 3] = Math.sin(Math.PI * t) * (dark ? 0.55 : 0.32);
      smoke.data[i * 3 + 1] = (0.25 + t * 1.1) * (dark ? 1.6 : 1);
    }
    smokeGeometry.getAttribute("position").needsUpdate = true;
    smokeGeometry.getAttribute("aData").needsUpdate = true;
  };

  return {
    spark: emit,
    burst: (at, color, count = 90) => {
      for (let i = 0; i < count; i += 1) {
        const x = random() - 0.5;
        const y = random() - 0.5;
        const z = random() - 0.5;
        const speed = (5 + random() * 2.5) / (Math.hypot(x, y, z) || 1);
        const bright = color.clone().multiplyScalar(2 + random() * 1.5);
        emit(at, x * speed, y * speed, z * speed, bright, 1.4 + random() * 0.8, 0.5, 0.965);
      }
      const flash = color.clone().lerp(color.clone().setScalar(1), 0.6).multiplyScalar(3);
      for (let i = 0; i < 26; i += 1)
        emit(
          at,
          (random() - 0.5) * 2.5,
          (random() - 0.5) * 2.5,
          (random() - 0.5) * 2.5,
          flash,
          0.5,
          0.7,
          0.9,
        );
    },
    setSmoke: (next, darkOn) => {
      sources = next.map(({ at, dark }) => ({ at, dark, owed: random() }));
      darkShown = darkOn;
    },
    frame: (delta) => {
      stepSparks(delta);
      stepSmoke(delta);
    },
    setShown: (shown) => {
      sparks.visible = shown;
      smokePoints.visible = shown;
    },
  };
}
