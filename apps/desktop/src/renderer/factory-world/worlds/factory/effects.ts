import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Fog,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { col, lerp } from "./geo";

/**
 * effects.ts -- the Factory's air and light: its sky by day and by night, the sun and its one shadow, soft glows, and the smoke, steam, and sparks that drift off it.
 *
 * The mockup bloomed and tilt-shifted its frame; the host draws no
 * post-processing, so the look comes from here instead. Glows are additive
 * radial falloffs drawn in the scene (a lamp's pool, a beacon's halo, a
 * zone's shipped glow), emissive parts are overdriven past white so the
 * tone mapping rolls them off, and the distance fades into a fog the colour
 * of the horizon. Particles are camera-facing quads sized in scene units,
 * one draw for all the smoke and one for all the sparks.
 */

/** The sky and its lights by day and by night, which the window's appearance picks. */
const SKY = {
  DAY: {
    top: "#6fa6dc",
    horizon: "#f4dcb8",
    sun: "#ffd49a",
    sunIntensity: 3.4,
    hemiIntensity: 1.35,
    hemiSky: "#cfe2ff",
    hemiGround: "#a8936b",
    glow: 1.0,
    lamp: 0.6,
    pool: 0,
  },
  NIGHT: {
    top: "#081128",
    horizon: "#25325a",
    sun: "#8fa6ff",
    sunIntensity: 0.7,
    hemiIntensity: 0.7,
    hemiSky: "#5a70b0",
    hemiGround: "#2a2a35",
    glow: 3.0,
    lamp: 3.5,
    pool: 0.9,
  },
} as const;

/** Where the sun shines from. */
const SUN_DIRECTION = new Vector3(-0.62, 0.66, 0.42).normalize();

/** The largest shadow map the README allows. */
const SHADOW_MAP = 2048;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDirection;
uniform float uNight;
varying vec3 vDirection;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  float y = vDirection.y;
  vec3 colour = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.7, y), 0.7));
  colour = mix(colour, uHorizon * 0.8, smoothstep(0.0, -0.25, y));
  float s = max(dot(vDirection, normalize(uSunDirection)), 0.0);
  colour += uSun * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.6);
  float star = step(0.9975, hash(floor(vDirection * 420.0))) * smoothstep(0.05, 0.4, y) * uNight;
  colour += vec3(star) * 1.4;
  gl_FragColor = vec4(colour, 1.0);
}`;

const GLOW_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vTint;
void main() {
  vUv = uv;
  vTint = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #endif
  #ifdef BILLBOARD
    vec3 centre = vec3(0.0);
    float size = 1.0;
    #ifdef USE_INSTANCING
      centre = instanceMatrix[3].xyz;
      size = length(instanceMatrix[0].xyz);
    #endif
    vec4 view = modelViewMatrix * vec4(centre, 1.0);
    view.xy += position.xy * size;
    gl_Position = projectionMatrix * view;
  #else
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    gl_Position = projectionMatrix * modelViewMatrix * local;
  #endif
}`;

const GLOW_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vTint;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(1.0 - d, 0.0), 2.2);
  gl_FragColor = vec4(uColor * vTint, a * uOpacity);
}`;

const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aPoint;
attribute vec4 aTint;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vUv = uv;
  vTint = aTint;
  vec4 view = modelViewMatrix * vec4(aPoint.xyz, 1.0);
  view.xy += position.xy * aPoint.w;
  gl_Position = projectionMatrix * view;
}`;

const PARTICLE_FRAGMENT = /* glsl */ `
uniform float uSoft;
varying vec2 vUv;
varying vec4 vTint;
void main() {
  vec2 c = vUv - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float fall = 1.0 - smoothstep(0.0, 0.5, d);
  float a = mix(fall, pow(fall, 1.6), uSoft) * vTint.a;
  vec3 colour = vTint.rgb * mix(1.0, 0.8 + vUv.y * 0.35, uSoft);
  gl_FragColor = vec4(colour, a);
}`;

/**
 * A soft radial glow, additive: one per instance of the plane or quad it is
 * drawn on, tinted by its instance colour. A billboard turns to face the
 * camera from its instance's centre, sized by its instance's scale.
 */
export function glowMaterial(color: string, opacity: number, billboard = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: col(color).clone() }, uOpacity: { value: opacity } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    defines: billboard ? { BILLBOARD: "" } : {},
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/** A material that draws its vertex colours unlit, overdriven by `scalar` so it glows. */
export function glowingMaterial(scalar: number): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ vertexColors: true });
  material.color.setScalar(scalar);
  return material;
}

/** A flat colour overdriven by `k`, unlit, as the mockup's lights and lenses are. */
export function hdrMaterial(color: string, k = 3): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: col(color).clone().multiplyScalar(k) });
}

/** The sky dome, the two lights, and the fog, set for the window's appearance. */
export interface Atmosphere {
  readonly sun: DirectionalLight;
  /** Sizes everything to a yard of `span` units across. */
  readonly fit: (span: number) => void;
  /** Turns day or night: the sky, the lights, the fog, and how much the factory's own lights glow. */
  readonly apply: (dark: boolean) => {
    readonly glow: number;
    readonly lamp: number;
    readonly pool: number;
  };
  /** Aims the sun's shadow at `x`, `z`, covering `extent` units either way. */
  readonly aim: (x: number, z: number, extent: number) => void;
}

/** Lights `scene` with its sky, its sun, and its fog. */
export function atmosphereOf(scene: Scene): Atmosphere {
  const uniforms = {
    uTop: { value: new Color() },
    uHorizon: { value: new Color() },
    uSun: { value: new Color() },
    uSunDirection: { value: SUN_DIRECTION.clone() },
    uNight: { value: 0 },
  };
  const sky = new Mesh(
    new SphereGeometry(1, 32, 16),
    new ShaderMaterial({
      uniforms,
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side: BackSide,
      depthWrite: false,
    }),
  );
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  const fog = new Fog("#f4dcb8", 520, 1500);
  const hemi = new HemisphereLight("#d8e8ff", "#b7a37c", 1.0);
  const sun = new DirectionalLight("#ffdcaa", 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  scene.add(sky, hemi, sun, sun.target);
  scene.fog = fog;

  const aim = (x: number, z: number, extent: number) => {
    sun.target.position.set(x, 0, z);
    sun.position.copy(sun.target.position).addScaledVector(SUN_DIRECTION, extent * 3);
    const camera = sun.shadow.camera;
    camera.left = -extent;
    camera.right = extent;
    camera.top = extent;
    camera.bottom = -extent;
    camera.near = extent * 0.2;
    camera.far = extent * 6;
    camera.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  };

  return {
    sun,
    fit: (span) => {
      const k = span / 200;
      sky.scale.setScalar(span * 10);
      fog.near = 520 * k;
      fog.far = 1500 * k;
      aim(0, 0, span * 0.62);
    },
    apply: (dark) => {
      const from = SKY.DAY;
      const to = SKY.NIGHT;
      const n = dark ? 1 : 0;
      uniforms.uTop.value.copy(col(from.top)).lerp(col(to.top), n);
      uniforms.uHorizon.value.copy(col(from.horizon)).lerp(col(to.horizon), n);
      uniforms.uSun.value.copy(col(from.sun)).lerp(col(to.sun), n);
      uniforms.uNight.value = n;
      fog.color.copy(uniforms.uHorizon.value);
      sun.color.copy(uniforms.uSun.value);
      sun.intensity = lerp(from.sunIntensity, to.sunIntensity, n);
      hemi.intensity = lerp(from.hemiIntensity, to.hemiIntensity, n);
      hemi.color.copy(col(from.hemiSky)).lerp(col(to.hemiSky), n);
      hemi.groundColor.copy(col(from.hemiGround)).lerp(col(to.hemiGround), n);
      return {
        glow: lerp(from.glow, to.glow, n),
        lamp: lerp(from.lamp, to.lamp, n),
        pool: lerp(from.pool, to.pool, n),
      };
    },
    aim,
  };
}

/** What a particle is: soft smoke or steam, or a bright spark that falls. */
export interface ParticleSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly color: Color;
  readonly size: number;
  readonly life: number;
  readonly grow: number;
  readonly alpha: number;
  readonly gravity: number;
}

/** What a particle rose from, so switching a layer off takes its smoke and sparks with it. */
export const PARTICLE_SOURCE = {
  /** The yard's own chimneys and towers, which no layer switches. */
  YARD: 0,
  BUILDING: 1,
  SHIPPED: 2,
  DEFECTS: 3,
} as const;

export type ParticleSource = (typeof PARTICLE_SOURCE)[keyof typeof PARTICLE_SOURCE];

/**
 * A ring of particles drawn as one instanced quad: smoke drifts with the
 * wind and fades in and out; sparks fall and fade. Emitting past the ring's
 * end overwrites the oldest.
 */
export class Particles {
  readonly mesh: Mesh;
  private readonly count: number;
  private head = 0;
  private readonly point: Float32Array;
  private readonly tint: Float32Array;
  private readonly velocity: Float32Array;
  private readonly state: Float32Array;
  private readonly pointAttribute: InstancedBufferAttribute;
  private readonly tintAttribute: InstancedBufferAttribute;
  private readonly smoke: boolean;
  private readonly sources: Uint8Array;

  constructor(count: number, smoke: boolean) {
    this.count = count;
    this.smoke = smoke;
    this.point = new Float32Array(count * 4);
    this.tint = new Float32Array(count * 4);
    this.velocity = new Float32Array(count * 3);
    // Note that each particle keeps six numbers of state: its life left and whole, its first size, its growth, its first alpha, and its gravity.
    this.state = new Float32Array(count * 6);
    this.sources = new Uint8Array(count);
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]),
        3,
      ),
    );
    geometry.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.pointAttribute = new InstancedBufferAttribute(this.point, 4).setUsage(DynamicDrawUsage);
    this.tintAttribute = new InstancedBufferAttribute(this.tint, 4).setUsage(DynamicDrawUsage);
    geometry.setAttribute("aPoint", this.pointAttribute);
    geometry.setAttribute("aTint", this.tintAttribute);
    geometry.instanceCount = count;
    this.mesh = new Mesh(
      geometry,
      new ShaderMaterial({
        uniforms: { uSoft: { value: smoke ? 1 : 0 } },
        vertexShader: PARTICLE_VERTEX,
        fragmentShader: PARTICLE_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: smoke ? NormalBlending : AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  emit(spec: ParticleSpec, source: ParticleSource = PARTICLE_SOURCE.YARD): void {
    const index = this.head;
    this.head = (this.head + 1) % this.count;
    this.sources[index] = source;
    this.point.set([spec.x, spec.y, spec.z, spec.size], index * 4);
    this.tint.set([spec.color.r, spec.color.g, spec.color.b, 0], index * 4);
    this.velocity.set([spec.vx, spec.vy, spec.vz], index * 3);
    this.state.set(
      [spec.life, spec.life, spec.size, spec.grow, spec.alpha, spec.gravity],
      index * 6,
    );
  }

  /** Lets every particle go at once, as a still frame wants, or only those from `source`, as a hidden layer does. */
  clear(source?: ParticleSource): void {
    for (let index = 0; index < this.count; index += 1) {
      if (source !== undefined && this.sources[index] !== source) continue;
      this.state[index * 6] = 0;
      this.tint[index * 4 + 3] = 0;
    }
    this.tintAttribute.needsUpdate = true;
  }

  step(delta: number): void {
    const { point, tint, velocity, state } = this;
    const smoke = this.smoke;
    const drag = smoke ? 0.985 : 0.995;
    for (let index = 0; index < this.count; index += 1) {
      const s = index * 6;
      const left = state[s] ?? 0;
      if (left <= 0) {
        tint[index * 4 + 3] = 0;
        continue;
      }
      const remaining = left - delta;
      state[s] = remaining;
      const t = 1 - remaining / (state[s + 1] ?? 1);
      const v = index * 3;
      velocity[v + 1] = (velocity[v + 1] ?? 0) - (state[s + 5] ?? 0) * delta;
      velocity[v] = (velocity[v] ?? 0) * drag + (smoke ? 0.9 * delta : 0);
      velocity[v + 2] = (velocity[v + 2] ?? 0) * drag + (smoke ? 0.25 * delta : 0);
      const p = index * 4;
      point[p] = (point[p] ?? 0) + (velocity[v] ?? 0) * delta;
      point[p + 1] = (point[p + 1] ?? 0) + (velocity[v + 1] ?? 0) * delta;
      point[p + 2] = (point[p + 2] ?? 0) + (velocity[v + 2] ?? 0) * delta;
      point[p + 3] = (state[s + 2] ?? 0) * (1 + (state[s + 3] ?? 0) * t);
      const fade = smoke ? Math.min(1, t * 6) * (1 - t) * (1 - t) : 1 - t;
      tint[p + 3] = remaining <= 0 ? 0 : (state[s + 4] ?? 0) * fade;
    }
    this.pointAttribute.needsUpdate = true;
    this.tintAttribute.needsUpdate = true;
  }
}
