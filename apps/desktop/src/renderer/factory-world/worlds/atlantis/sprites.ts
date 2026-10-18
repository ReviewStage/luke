import {
  AdditiveBlending,
  type Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  Vector3,
} from "three";
import { easeInOut, instancedAttribute, smoothstep } from "./geometry";
import type { Sea } from "./sea";

/**
 * sprites.ts -- what glows and drifts in the water: the soft lights on lamps, sparks, and crowns, the bubbles that rise, the ink that clouds round a breach, the particles that make them, and the sonar rings that spread across the floor.
 *
 * Each is one draw: a quad per sprite turned to face the camera in its
 * vertex shader, filled from arrays the world rewrites as it draws. Glows
 * add their light, which is how Atlantis glows without a bloom pass: a
 * lamp is a bright core in a wide soft halo, fogged with distance like
 * everything else.
 */

/** How a set of sprites is drawn. */
export const SPRITE_KIND = {
  /** A soft light, added. */
  GLOW: "glow",
  /** A bubble's rim and highlight, added. */
  BUBBLE: "bubble",
  /** A cloud of ink, laid over. */
  INK: "ink",
} as const;

export type SpriteKind = (typeof SPRITE_KIND)[keyof typeof SPRITE_KIND];

const SPRITE_VERTEX = /* glsl */ `
attribute vec3 aC; attribute vec2 aS; attribute vec4 aCol;
varying vec2 vUv; varying vec4 vCol; varying float vDepth;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(aS.y), s = sin(aS.y);
  vec2 p = vec2(c*position.x - s*position.y, s*position.x + c*position.y) * aS.x;
  vec3 w = aC + right*p.x + up*p.y;
  vec4 mv = viewMatrix*vec4(w,1.0); vDepth = -mv.z;
  gl_Position = projectionMatrix*mv; vUv = uv; vCol = aCol;
}`;

const SPRITE_FRAGMENT = {
  [SPRITE_KIND.GLOW]: /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying float vDepth;
void main(){ float d = length(vUv-0.5)*2.0; if (d>1.0) discard;
  float a = exp(-d*d*4.5)*(1.0-d) + pow(max(0.0,1.0-d),12.0)*1.5;
  gl_FragColor = vec4(vCol.rgb*a*vCol.a*(1.0-fogF(vDepth)*0.85), 1.0); }`,
  [SPRITE_KIND.BUBBLE]: /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying float vDepth;
void main(){ float d = length(vUv-0.5)*2.0; if (d>1.0) discard;
  float rim = smoothstep(0.55,0.9,d)*(1.0-smoothstep(0.9,1.0,d));
  float hl = exp(-pow(length(vUv-vec2(0.36,0.64))*7.0, 2.0));
  float a = rim*0.85 + hl*1.3 + 0.06;
  gl_FragColor = vec4(vCol.rgb*a*vCol.a*(1.0-fogF(vDepth)*0.9), 1.0); }`,
  [SPRITE_KIND.INK]: /* glsl */ `
varying vec2 vUv; varying vec4 vCol; varying float vDepth;
void main(){ vec2 p = vUv-0.5; float d = length(p)*2.0; if (d>1.0) discard;
  float n = fbm2(p*3.2 + vCol.a*13.0 + uTime*0.05);
  float a = smoothstep(1.0, 0.15, d) * smoothstep(0.25, 0.75, n + (1.0-d)*0.35);
  gl_FragColor = vec4(mix(vCol.rgb, uFogColor*0.4, fogF(vDepth)*0.5), a*0.62); }`,
} as const satisfies Record<SpriteKind, string>;

/** A set of sprites, rewritten whole each time the world draws. */
export interface Billboards {
  readonly mesh: Mesh;
  readonly begin: () => void;
  /** One sprite at `x`, `y`, `z`, `size` across, in `r`, `g`, `b` at `alpha`, turned `turn` radians. */
  readonly push: (
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    turn?: number,
  ) => void;
  readonly end: () => void;
}

/** Up to `capacity` sprites of `kind`. */
export function billboardsOf(sea: Sea, capacity: number, kind: SpriteKind): Billboards {
  const quad = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute("position", quad.getAttribute("position"));
  geometry.setAttribute("uv", quad.getAttribute("uv"));
  const centres = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  const sizes = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2);
  const colours = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  for (const attribute of [centres, sizes, colours]) attribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("aC", centres);
  geometry.setAttribute("aS", sizes);
  geometry.setAttribute("aCol", colours);
  geometry.instanceCount = 0;
  const material = sea.shader({}, SPRITE_VERTEX, SPRITE_FRAGMENT[kind], {
    transparent: true,
    depthWrite: false,
    blending: kind === SPRITE_KIND.INK ? NormalBlending : AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = kind === SPRITE_KIND.INK ? 2 : 5;
  let count = 0;
  return {
    mesh,
    begin: () => {
      count = 0;
    },
    push: (x, y, z, size, r, g, b, alpha, turn = 0) => {
      if (count >= capacity) return;
      centres.setXYZ(count, x, y, z);
      sizes.setXY(count, size, turn);
      colours.setXYZW(count, r, g, b, alpha);
      count += 1;
    },
    end: () => {
      geometry.instanceCount = count;
      centres.needsUpdate = true;
      sizes.needsUpdate = true;
      colours.needsUpdate = true;
    },
  };
}

/** What a particle is, which says how it moves and how it is drawn. */
export const PARTICLE_KIND = {
  /** Rises, wobbling, and swells as it goes. */
  BUBBLE: 0,
  /** Flies out hot and falls, fading. */
  SPARK: 1,
  /** Drifts up slowly, flickering. */
  PLANKTON: 2,
} as const;

type ParticleKind = (typeof PARTICLE_KIND)[keyof typeof PARTICLE_KIND];

/** Which signal a particle belongs to, so switching that layer off hides it without stopping what makes it. */
export const PARTICLE_LAYER = {
  BUILDING: 0,
  SHIPPED: 1,
  DEFECTS: 2,
  AMBIENT: 3,
} as const;

type ParticleLayer = (typeof PARTICLE_LAYER)[keyof typeof PARTICLE_LAYER];

/** A pool of particles, stepped while motion runs. */
export interface Particles {
  readonly spawn: (
    kind: ParticleKind,
    layer: ParticleLayer,
    at: Vector3,
    velocity: Vector3,
    life: number,
    size: number,
    color: Color,
    alpha: number,
  ) => void;
  readonly step: (delta: number) => void;
  /** Draws every particle of a layer `shown` answers for: bubbles to `bubbles`, the rest to `glows`. */
  readonly draw: (
    bubbles: Billboards,
    glows: Billboards,
    shown: (layer: number) => boolean,
  ) => void;
  readonly clear: () => void;
}

/** Up to `capacity` particles, their wobble seeded by `random`. */
export function particlesOf(capacity: number, random: () => number): Particles {
  const columns = () => new Float32Array(capacity);
  const px = columns();
  const py = columns();
  const pz = columns();
  const vx = columns();
  const vy = columns();
  const vz = columns();
  const age = columns();
  const life = columns();
  const size = columns();
  const red = columns();
  const green = columns();
  const blue = columns();
  const alpha = columns();
  const seed = columns();
  const kinds = new Uint8Array(capacity);
  const layers = new Uint8Array(capacity);
  const all = [
    px,
    py,
    pz,
    vx,
    vy,
    vz,
    age,
    life,
    size,
    red,
    green,
    blue,
    alpha,
    seed,
    kinds,
    layers,
  ];
  let count = 0;
  const kill = (index: number) => {
    count -= 1;
    for (const column of all) column[index] = column[count] ?? 0;
  };
  const read = (column: Float32Array, index: number) => column[index] ?? 0;
  return {
    spawn: (kind, layer, at, velocity, lifetime, width, color, opacity) => {
      if (count >= capacity) return;
      const index = count;
      count += 1;
      px[index] = at.x;
      py[index] = at.y;
      pz[index] = at.z;
      vx[index] = velocity.x;
      vy[index] = velocity.y;
      vz[index] = velocity.z;
      age[index] = 0;
      life[index] = lifetime;
      size[index] = width;
      red[index] = color.r;
      green[index] = color.g;
      blue[index] = color.b;
      alpha[index] = opacity;
      seed[index] = random() * 100;
      kinds[index] = kind;
      layers[index] = layer;
    },
    step: (delta) => {
      for (let index = 0; index < count; index += 1) {
        age[index] = read(age, index) + delta;
        if (read(age, index) > read(life, index)) {
          kill(index);
          index -= 1;
          continue;
        }
        const kind = kinds[index];
        const t = read(age, index);
        const wobble = read(seed, index);
        if (kind === PARTICLE_KIND.BUBBLE) {
          vy[index] = Math.min(read(vy, index) + 2.2 * delta, 7.5);
          px[index] =
            read(px, index) + (read(vx, index) + Math.sin(t * 3.1 + wobble) * 0.9) * delta;
          pz[index] =
            read(pz, index) + (read(vz, index) + Math.cos(t * 2.7 + wobble) * 0.7) * delta;
          vx[index] = read(vx, index) * (1 - 1.5 * delta);
          vz[index] = read(vz, index) * (1 - 1.5 * delta);
          py[index] = read(py, index) + read(vy, index) * delta;
          continue;
        }
        const drag = Math.exp((kind === PARTICLE_KIND.SPARK ? -4 : -0.9) * delta);
        vx[index] = read(vx, index) * drag;
        vz[index] = read(vz, index) * drag;
        vy[index] = read(vy, index) * drag + (kind === PARTICLE_KIND.SPARK ? -1.5 : 0.4) * delta;
        px[index] = read(px, index) + read(vx, index) * delta;
        py[index] = read(py, index) + read(vy, index) * delta;
        pz[index] = read(pz, index) + read(vz, index) * delta;
      }
    },
    draw: (bubbles, glows, shown) => {
      for (let index = 0; index < count; index += 1) {
        const layer = layers[index];
        if (layer === undefined || !shown(layer)) continue;
        const k = read(age, index) / read(life, index);
        const x = read(px, index);
        const y = read(py, index);
        const z = read(pz, index);
        const r = read(red, index);
        const g = read(green, index);
        const b = read(blue, index);
        const a = read(alpha, index);
        const width = read(size, index);
        const kind = kinds[index];
        if (kind === PARTICLE_KIND.BUBBLE) {
          const fade = smoothstep(0, 0.08, k) * (1 - smoothstep(0.75, 1, k)) * a;
          bubbles.push(x, y, z, width * (1 + k * 0.6), r, g, b, fade);
        } else if (kind === PARTICLE_KIND.SPARK) {
          glows.push(x, y, z, width * (1 - k * 0.7), r * 3, g * 3, b * 3, (1 - k) * a);
        } else {
          const fade = smoothstep(0, 0.1, k) * (1 - smoothstep(0.6, 1, k)) * a;
          const flicker = 0.7 + 0.3 * Math.sin(read(age, index) * 9 + read(seed, index));
          glows.push(x, y, z, width, r * 1.3, g * 1.3, b * 1.3, fade * flicker);
        }
      }
    },
    clear: () => {
      count = 0;
    },
  };
}

const PING_VERTEX = /* glsl */ `
attribute vec4 aPing;
varying vec2 vUv; varying float vDepth; varying vec4 vPing;
void main(){ vUv = uv; vPing = aPing; vec4 mv = viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.0); vDepth = -mv.z; gl_Position = projectionMatrix*mv; }`;

const PING_FRAGMENT = /* glsl */ `
varying vec2 vUv; varying float vDepth; varying vec4 vPing;
void main(){ float r = length(vUv-0.5)*2.0; float band = exp(-pow((r-0.97)*28.0, 2.0)) + exp(-pow((r-0.9)*14.0,2.0))*0.35;
  float a = band*(1.0-vPing.w)*1.4; gl_FragColor = vec4(vPing.rgb*a*(1.0-fogF(vDepth)*0.7), 1.0); }`;

/** Sonar rings spreading over the floor. */
export interface Pings {
  readonly mesh: InstancedMesh;
  /** A ring from `centre`, `height` above the floor, out to `reach` in `color` over `seconds`, from `now`. */
  readonly send: (
    centre: Vector3,
    height: number,
    reach: number,
    color: Color,
    seconds: number,
    now: number,
  ) => void;
  /** Draws every ring as it stands at `now`. */
  readonly step: (now: number) => void;
  readonly clear: () => void;
}

interface Ping {
  readonly centre: Vector3;
  height: number;
  reach: number;
  readonly color: Vector3;
  seconds: number;
  sentAt: number;
}

/** Up to `capacity` rings at once; the oldest gives way to a new one. */
export function pingsOf(sea: Sea, capacity: number): Pings {
  const geometry = new PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const look = instancedAttribute(geometry, "aPing", 4, capacity);
  const material = sea.shader({}, PING_VERTEX, PING_FRAGMENT, {
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  const pings: Ping[] = Array.from({ length: capacity }, () => ({
    centre: new Vector3(),
    height: 0,
    reach: 0,
    color: new Vector3(),
    seconds: 1,
    sentAt: -1e9,
  }));
  let next = 0;
  const matrix = new Matrix4();
  return {
    mesh,
    send: (centre, height, reach, color, seconds, now) => {
      const ping = pings[next];
      next = (next + 1) % capacity;
      if (ping === undefined) return;
      ping.centre.copy(centre);
      ping.height = height;
      ping.reach = reach;
      ping.color.set(color.r, color.g, color.b);
      ping.seconds = seconds;
      ping.sentAt = now;
    },
    step: (now) => {
      let count = 0;
      for (const ping of pings) {
        const k = (now - ping.sentAt) / ping.seconds;
        if (k < 0 || k >= 1) continue;
        const radius = Math.max(0.01, easeInOut(Math.min(1, k * 1.1)) * ping.reach);
        matrix.makeScale(radius, 1, radius).setPosition(ping.centre.x, ping.height, ping.centre.z);
        mesh.setMatrixAt(count, matrix);
        look.setXYZW(count, ping.color.x, ping.color.y, ping.color.z, k);
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      look.needsUpdate = true;
    },
    clear: () => {
      for (const ping of pings) ping.sentAt = -1e9;
      mesh.count = 0;
    },
  };
}
