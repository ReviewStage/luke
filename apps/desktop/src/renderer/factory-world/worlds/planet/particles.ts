import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
  type Vector3,
} from "three";
import { GLSL_OUTPUT, rng, type SharedUniforms } from "./kit";

/**
 * particles.ts -- one pool of glowing specks for every flame, trail, spark, and burst the planet's idle motion throws: a jetpack's exhaust, a hammer's sparks, a rocket's trail, a meteor's tail.
 *
 * A fixed ring of points, each with a velocity and a life, stepped on the
 * CPU each frame and drawn as one additive draw call. The oldest speck is
 * reused when the ring is full. Nothing here carries state the world reads:
 * it only decorates motion, so a still frame simply has none.
 */

const POOL = 2400;

/** A speck's colour, in linear light that may run past one, so it glows. */
type Glow = readonly [number, number, number];

export interface Particles {
  readonly points: Points;
  /** Throws one speck from `at` with `velocity`, living `life` seconds, of `size`; `swell` grows it as it fades rather than shrinking it. */
  readonly emit: (
    at: Vector3,
    velocity: Vector3,
    life: number,
    size: number,
    glow: Glow,
    swell?: number,
  ) => void;
  /** A random number in [0, 1), from the pool's own seeded draw. */
  readonly draw: () => number;
  readonly step: (delta: number) => void;
  /** Lets every speck go at once. */
  readonly clear: () => void;
}

export function createParticles(shared: SharedUniforms): Particles {
  const positions = new Float32Array(POOL * 3);
  const colours = new Float32Array(POOL * 3);
  const sizes = new Float32Array(POOL);
  const velocities = new Float32Array(POOL * 3);
  const lives = new Float32Array(POOL);
  const spans = new Float32Array(POOL);
  const bases = new Float32Array(POOL * 4);
  const swells = new Float32Array(POOL);
  let head = 0;
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("aCol", new BufferAttribute(colours, 3).setUsage(DynamicDrawUsage));
  geometry.setAttribute("aSize", new BufferAttribute(sizes, 1).setUsage(DynamicDrawUsage));
  const points = new Points(
    geometry,
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: shared,
      vertexShader: /* glsl */ `
        attribute vec3 aCol; attribute float aSize; uniform float uPixelRatio; varying vec3 vC;
        void main(){ vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aSize * uPixelRatio * 260.0 / -mv.z; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vC * a * a, 1.0); ${GLSL_OUTPUT} }`,
    }),
  );
  points.frustumCulled = false;
  points.renderOrder = 6;
  const draw = rng(4242);
  const mark = () => {
    for (const name of ["position", "aCol", "aSize"])
      geometry.getAttribute(name).needsUpdate = true;
  };
  return {
    points,
    draw,
    emit: (at, velocity, life, size, glow, swell = 0) => {
      const index = head;
      head = (head + 1) % POOL;
      at.toArray(positions, index * 3);
      velocity.toArray(velocities, index * 3);
      lives[index] = life;
      spans[index] = life;
      bases.set([glow[0], glow[1], glow[2], size], index * 4);
      swells[index] = swell;
    },
    step: (delta) => {
      for (let index = 0; index < POOL; index += 1) {
        if ((lives[index] ?? 0) <= 0) {
          sizes[index] = 0;
          continue;
        }
        lives[index] = (lives[index] ?? 0) - delta;
        const left = Math.max((lives[index] ?? 0) / (spans[index] || 1), 0);
        for (let axis = 0; axis < 3; axis += 1) {
          const at = index * 3 + axis;
          positions[at] = (positions[at] ?? 0) + (velocities[at] ?? 0) * delta;
          velocities[at] = (velocities[at] ?? 0) * 0.985;
        }
        const swell = swells[index] ?? 0;
        sizes[index] = (bases[index * 4 + 3] ?? 0) * (swell > 0 ? 1 + (1 - left) * swell : left);
        const fade = left * left;
        for (let channel = 0; channel < 3; channel += 1) {
          colours[index * 3 + channel] = (bases[index * 4 + channel] ?? 0) * fade;
        }
      }
      mark();
    },
    clear: () => {
      lives.fill(0);
      sizes.fill(0);
      mark();
    },
  };
}
