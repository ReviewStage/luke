import {
  BackSide,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { randomOf, TAU } from "./kit";

/**
 * mood.ts -- the sky the archipelago floats in: a sunset dome with drifting cloud streaks and a sun disc, a sea of cloud far below, banks and wisps of cloud puffs, the lights, the haze, and the birds.
 *
 * Every colour the sky is painted in stands in a `MOOD`, one for the
 * window's light appearance (the mockup's sunset) and one for its dark (the
 * blue hour after it, with the windows lit), and the uniforms every shader
 * shares are one object, so a change of appearance rewrites their values
 * and nothing else. The shaders tone-map and encode their own output the
 * way three's materials do, so they sit in the same light as the islands.
 */

/** Where the sun disc stands in the sky, and where the key light comes from. */
export const SUN_DIRECTION = new Vector3(-0.342, 0.085, -0.94).normalize();
const LIGHT_DIRECTION = new Vector3(-0.99, 0.46, 0.09).normalize();

/** The cloud sea's height: far below every island. */
export const SEA_Y = -46;

/** The sky dome's radius, inside the camera's far plane at its farthest reach. */
const DOME_RADIUS = 1000;

/** The shadow map's size: one light, at most 2048 px (`../README.md`). */
const SHADOW_MAP_PX = 2048;

/** How many birds circle the archipelago, in three flocks. */
const BIRDS = 24;

/** One appearance's sky: dome, sea, clouds, lights, haze, and how much the windows glow. */
interface Mood {
  readonly zenith: string;
  readonly upper: string;
  readonly horizon: string;
  readonly horizonSun: string;
  readonly disc: string;
  readonly stars: number;
  readonly fog: string;
  readonly fogDensity: number;
  readonly seaLit: string;
  readonly seaShadow: string;
  readonly seaGlow: string;
  readonly puffLit: string;
  readonly puffShadow: string;
  readonly puffGlow: string;
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly hemi: number;
  readonly sun: string;
  readonly sunIntensity: number;
  readonly rim: string;
  readonly rimIntensity: number;
  /** How bright the windows, lamps, and lanterns burn. */
  readonly glow: number;
  readonly bird: string;
}

const MOOD = {
  LIGHT: {
    zenith: "#1b2052",
    upper: "#5d4a8f",
    horizon: "#f29a86",
    horizonSun: "#ffc27c",
    disc: "#ffdb9e",
    stars: 0.9,
    fog: "#d98f8e",
    fogDensity: 0.0024,
    seaLit: "#f4a98c",
    seaShadow: "#4a3a78",
    seaGlow: "#ffb060",
    puffLit: "#ffc6a6",
    puffShadow: "#7560a0",
    puffGlow: "#ffa860",
    hemiSky: "#9d93ea",
    hemiGround: "#9a6aa6",
    hemi: 1.06,
    sun: "#ffc996",
    sunIntensity: 2.85,
    rim: "#8ea8ff",
    rimIntensity: 0.5,
    glow: 1,
    bird: "#3a2638",
  },
  DARK: {
    zenith: "#04050d",
    upper: "#151a3d",
    horizon: "#43305e",
    horizonSun: "#8a4f6e",
    disc: "#dfe6ff",
    stars: 1.6,
    fog: "#2b2444",
    fogDensity: 0.0019,
    seaLit: "#4f4777",
    seaShadow: "#100d24",
    seaGlow: "#9a5f80",
    puffLit: "#6a5f8f",
    puffShadow: "#1c1734",
    puffGlow: "#b0779a",
    hemiSky: "#5b62a8",
    hemiGround: "#3a2a52",
    hemi: 0.75,
    sun: "#b8c4ff",
    sunIntensity: 1.25,
    rim: "#7a6aff",
    rimIntensity: 0.45,
    glow: 2.4,
    bird: "#0d0a14",
  },
} as const satisfies Record<string, Mood>;

/** The noise and horizon every sky shader shares. */
export const GLSL_NOISE = /* glsl */ `
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
  float fbm3(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 3; i++){ s += a*vn(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s * 1.14; }
  float fbm2(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 5; i++){ s += a*vn(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
  vec3 horizonCol(vec3 V, vec3 sun, vec3 hor, vec3 horSun){ float s = pow(max(dot(normalize(vec3(V.x,0.,V.z)+1e-5), normalize(vec3(sun.x,0.,sun.z))), 0.), 2.5); return mix(hor, horSun, s); }
`;

/** What ends every custom fragment shader, so its colour is tone-mapped and encoded as three's own materials are. */
export const GLSL_OUTPUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`;

/** The uniforms the sky's shaders share, a change of mood rewriting their values. */
export interface SkyUniforms {
  readonly uTime: { value: number };
  readonly uSun: { value: Vector3 };
  readonly uHor: { value: Color };
  readonly uHorSun: { value: Color };
  readonly uLit: { value: Color };
  readonly uShadow: { value: Color };
  readonly uGlow: { value: Color };
}

/** One puff of cloud: where it floats, how wide and tall, and its seed. */
export interface Puff {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
  readonly h: number;
  readonly seed: number;
}

const PUFF_VERTEX = /* glsl */ `
  attribute vec3 offset; attribute vec2 aScale; attribute float aSeed; attribute float aFlash; attribute float aTint;
  uniform float uTime; varying vec2 vUv; varying float vSeed, vFlash, vTint; varying vec3 vCenter;
  void main(){
    vUv = uv; vSeed = aSeed; vFlash = aFlash; vTint = aTint;
    vCenter = offset + vec3(sin(uTime * 0.03 + aSeed * 6.3) * 2.5, sin(uTime * 0.05 + aSeed * 3.1) * 0.6, 0.);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 w = vCenter + right * position.x * aScale.x + up * position.y * aScale.y;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  }`;

const PUFF_FRAGMENT = /* glsl */ `${GLSL_NOISE}
  uniform vec3 uSun, uHor, uHorSun, uLit, uShadow, uGlow, uStormLow, uStormHigh, uStormEmber, uPick;
  uniform float uTime, uOpacity, uStorm, uFog;
  varying vec2 vUv; varying float vSeed, vFlash, vTint; varying vec3 vCenter;
  void main(){
    vec2 p = vUv * 2. - 1.;
    float n = fbm3(vUv * 2.6 + vSeed * 7.3 + uTime * 0.012);
    float d = length(p * vec2(1.0, 1.4)) + (n - 0.5) * 0.75;
    float a = smoothstep(1.0, 0.3, d) * smoothstep(1.0, 0.82, max(abs(p.x), abs(p.y)));
    if (a < 0.01) discard;
    float lit = smoothstep(-0.8, 0.9, p.y + (n - 0.5) * 0.9);
    vec3 V = normalize(vCenter - cameraPosition);
    float side = pow(max(dot(normalize(vec3(V.x,0.,V.z)+1e-5), normalize(vec3(uSun.x,0.,uSun.z))), 0.), 3.);
    vec3 col = mix(uShadow, uLit, lit) + uGlow * side * lit * 0.55;
    col += uGlow * side * smoothstep(0.55, 0.95, d) * 0.5;
    if (uStorm > 0.5) {
      col = mix(uStormLow, uStormHigh, lit) + uGlow * pow(lit, 3.) * side * 0.2 + uStormEmber * (1. - lit) * 0.2
        + vec3(1.9, 1.0, 0.9) * vFlash * (1.2 - d);
      col = mix(col, uPick * (0.4 + 0.6 * lit), vTint * 0.75);
    }
    float dist = length(vCenter - cameraPosition);
    col = mix(col, horizonCol(V, uSun, uHor, uHorSun), clamp(1. - exp(-dist * uFog), 0., 1.));
    gl_FragColor = vec4(col, a * uOpacity);
    ${GLSL_OUTPUT}
  }`;

/** A billboard per puff, `bound` of them, the first `puffs.length` set. */
export function puffGeometry(bound: number): InstancedBufferGeometry {
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.setAttribute("offset", new InstancedBufferAttribute(new Float32Array(bound * 3), 3));
  geometry.setAttribute("aScale", new InstancedBufferAttribute(new Float32Array(bound * 2), 2));
  geometry.setAttribute("aSeed", new InstancedBufferAttribute(new Float32Array(bound), 1));
  geometry.setAttribute("aFlash", new InstancedBufferAttribute(new Float32Array(bound), 1));
  geometry.setAttribute("aTint", new InstancedBufferAttribute(new Float32Array(bound), 1));
  geometry.instanceCount = 0;
  return geometry;
}

/** Writes `puffs` into a puff geometry from its first instance on. */
export function setPuffs(geometry: InstancedBufferGeometry, puffs: readonly Puff[]): void {
  const offset = geometry.getAttribute("offset");
  const scale = geometry.getAttribute("aScale");
  const seed = geometry.getAttribute("aSeed");
  puffs.forEach((puff, index) => {
    offset.setXYZ(index, puff.x, puff.y, puff.z);
    scale.setXY(index, puff.w, puff.h);
    seed.setX(index, puff.seed);
  });
  offset.needsUpdate = true;
  scale.needsUpdate = true;
  seed.needsUpdate = true;
  geometry.instanceCount = puffs.length;
}

/** The puffs' material: fair-weather cloud, or a storm's dark one lit from within by its lightning. */
export function puffMaterial(sky: SkyUniforms, storm: boolean): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      ...sky,
      uOpacity: { value: storm ? 0.96 : 0.62 },
      uStorm: { value: storm ? 1 : 0 },
      uFog: { value: storm ? 0.0007 : 0.0014 },
      uStormLow: { value: new Color(0.025, 0.018, 0.04) },
      uStormHigh: { value: new Color(0.13, 0.085, 0.15) },
      uStormEmber: { value: new Color(0, 0, 0) },
      uPick: { value: new Color(0, 0, 0) },
    },
    vertexShader: PUFF_VERTEX,
    fragmentShader: PUFF_FRAGMENT,
  });
}

/**
 * A dashed line that runs: dashes `dash` long and `gap` apart along a line
 * carrying its length so far in `aDistance`, sliding `speed` units a second
 * while motion runs.
 */
export function runningDashes(
  color: Color,
  time: { value: number },
  options: {
    readonly dash: number;
    readonly gap: number;
    readonly speed: number;
    readonly opacity: number;
  },
): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: { uTime: time, uColor: { value: color }, uOpacity: { value: options.opacity } },
    vertexShader: /* glsl */ `attribute float aDistance; varying float vDistance; void main(){ vDistance = aDistance; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uOpacity; uniform vec3 uColor; varying float vDistance;
      void main(){ if (fract((vDistance - uTime * ${options.speed.toFixed(2)}) / ${(options.dash + options.gap).toFixed(2)}) > ${(options.dash / (options.dash + options.gap)).toFixed(3)}) discard; gl_FragColor = vec4(uColor, uOpacity); ${GLSL_OUTPUT} }`,
  });
}

/** A line along `points`, each vertex carrying its length so far, for `runningDashes`. */
export function dashedPath(paths: readonly (readonly Vector3[])[]): BufferGeometry {
  const positions: number[] = [];
  const distances: number[] = [];
  for (const points of paths) {
    let distance = 0;
    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      if (a === undefined || b === undefined) continue;
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      distances.push(distance, distance + a.distanceTo(b));
      distance += a.distanceTo(b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aDistance", new Float32BufferAttribute(distances, 1));
  return geometry;
}

function skyDome(sky: SkyUniforms) {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      ...sky,
      uZen: { value: new Color() },
      uUp: { value: new Color() },
      uDisc: { value: new Color() },
      uStars: { value: 1 },
    },
    // Note that the dome turns with the camera but never moves with it, so it is always the sky's distance away.
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.); }`,
    fragmentShader: /* glsl */ `${GLSL_NOISE}
      uniform vec3 uSun, uHor, uHorSun, uZen, uUp, uDisc; uniform float uTime, uStars; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        float side = pow(max(dot(normalize(vec3(d.x,0.,d.z)+1e-5), normalize(vec3(uSun.x,0.,uSun.z))), 0.), 2.5);
        vec3 col = horizonCol(d, uSun, uHor, uHorSun);
        col = mix(col, uUp, smoothstep(0.03, 0.36, y));
        col = mix(col, uZen, smoothstep(0.32, 0.98, y));
        float sd = max(dot(d, uSun), 0.);
        col += uHorSun * (pow(sd, 6.) * 0.32 + pow(sd, 60.) * 0.8);
        col += uDisc * smoothstep(0.99935, 0.9997, sd) * 14.;
        if (y > 0.0) {
          vec2 uv = d.xz / (y + 0.06);
          float n = fbm2(uv * vec2(0.55, 1.9) + vec2(uTime * 0.006, 0.));
          float m = smoothstep(0.5, 0.82, n) * smoothstep(0.0, 0.08, y) * (1. - smoothstep(0.35, 0.75, y));
          vec3 cc = mix(uHor * vec3(1.15, 0.6, 0.75), uHorSun * vec3(1.2, 1.0, 0.75), side);
          col = mix(col, cc, m * 0.6);
        }
        float st = step(0.9975, hash12(floor(d.xz / (y + 0.4) * 160.))) * smoothstep(0.45, 0.9, y);
        col += vec3(st) * uStars;
        gl_FragColor = vec4(col, 1.);
        ${GLSL_OUTPUT}
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(DOME_RADIUS, 48, 24), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, material };
}

function cloudSea(sky: SkyUniforms) {
  const material = new ShaderMaterial({
    fog: false,
    uniforms: {
      ...sky,
      uLight: { value: LIGHT_DIRECTION },
      uSeaLit: { value: new Color() },
      uSeaShadow: { value: new Color() },
      uSeaGlow: { value: new Color() },
    },
    vertexShader: /* glsl */ `${GLSL_NOISE}
      uniform float uTime; varying vec3 vW; varying float vH;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.); vec2 p = w.xz * 0.0085 + vec2(uTime * 0.0035, uTime * 0.0016);
        float h = fbm2(p); w.y += (h - 0.5) * 26.; vH = h; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `${GLSL_NOISE}
      uniform vec3 uSun, uHor, uHorSun, uLight, uSeaLit, uSeaShadow, uSeaGlow; uniform float uTime; varying vec3 vW; varying float vH;
      void main(){
        float h2 = fbm2(vW.xz * 0.04 + vec2(uTime * 0.01, -uTime * 0.006));
        vec3 N = normalize(cross(dFdx(vW), dFdy(vW))); if (N.y < 0.) N = -N; N = normalize(mix(N, vec3(0., 1., 0.), 0.55));
        float diff = clamp(dot(N, uLight) * 0.7 + 0.35, 0., 1.);
        float lum = clamp(vH * 1.1 + h2 * 0.55 - 0.3, 0., 1.);
        vec3 col = mix(uSeaShadow, uSeaLit, smoothstep(0.1, 0.95, lum * 0.55 + diff * 0.55));
        vec3 V = normalize(vW - cameraPosition);
        float side = pow(max(dot(normalize(vec3(V.x,0.,V.z)+1e-5), normalize(vec3(uSun.x,0.,uSun.z))), 0.), 4.);
        col += uSeaGlow * side * smoothstep(0.4, 0.95, lum) * 0.9;
        float dist = length(vW - cameraPosition);
        // Note that the sea is all horizon by the camera's far plane, so its edge never shows against the sky.
        float f = clamp(1. - exp(-dist * 0.0012), 0., 1.) + smoothstep(900., 1500., dist);
        col = mix(col, horizonCol(V, uSun, uHor, uHorSun), clamp(f, 0., 1.));
        gl_FragColor = vec4(col, 1.);
        ${GLSL_OUTPUT}
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(3200, 3200, 170, 170).rotateX(-Math.PI / 2), material);
  mesh.position.y = SEA_Y;
  return { mesh, material };
}

/** The fair-weather cloud: a low bank hugging the sea, wisps drifting between the islands, and far banks towering on the horizon. */
function fairCloud(extent: number): Puff[] {
  const random = randomOf(77);
  const puffs: Puff[] = [];
  for (let i = 0; i < 100; i += 1) {
    const a = random() * TAU;
    const d = 30 + random() ** 0.7 * 420;
    const s = 26 + random() * 50;
    puffs.push({
      x: Math.cos(a) * d,
      y: SEA_Y + 8 + random() * 10,
      z: Math.sin(a) * d,
      w: s * 1.7,
      h: s,
      seed: random(),
    });
  }
  for (let i = 0; i < 30; i += 1) {
    const a = random() * TAU;
    const d = 30 + random() * extent * 1.1;
    const s = 6 + random() * 12;
    puffs.push({
      x: Math.cos(a) * d,
      y: -18 + random() * 34,
      z: Math.sin(a) * d,
      w: s * 1.5,
      h: s * 0.9,
      seed: random(),
    });
  }
  for (let i = 0; i < 40; i += 1) {
    const a = random() * TAU;
    const d = 650 + random() * 500;
    const s = 120 + random() * 160;
    puffs.push({
      x: Math.cos(a) * d,
      y: SEA_Y + s * 0.25,
      z: Math.sin(a) * d,
      w: s * 1.8,
      h: s,
      seed: random(),
    });
  }
  return puffs.sort((a, b) => Math.hypot(b.x, b.z) - Math.hypot(a.x, a.z));
}

function birdWing(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0.12, 0, 0, -0.1, 0.55, 0.02, -0.02], 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** The sky as the world drives it: its shared uniforms, a change of mood, a change of extent, and its idle motion. */
export interface Sky {
  readonly uniforms: SkyUniforms;
  /** How bright the windows and lamps burn in the mood drawn. */
  readonly glow: { value: number };
  readonly setDark: (dark: boolean) => void;
  /** Fits the haze's wisps and the sun's shadow to an archipelago `extent` across from its centre. */
  readonly fit: (extent: number) => void;
  readonly frame: (elapsed: number) => void;
  readonly placeStill: () => void;
}

/** The sky, built into `scene`. */
export function skyOf(scene: Scene): Sky {
  const uniforms: SkyUniforms = {
    uTime: { value: 0 },
    uSun: { value: SUN_DIRECTION },
    uHor: { value: new Color() },
    uHorSun: { value: new Color() },
    uLit: { value: new Color() },
    uShadow: { value: new Color() },
    uGlow: { value: new Color() },
  };
  const glow = { value: 1 };
  const dome = skyDome(uniforms);
  const sea = cloudSea(uniforms);
  const puffs = puffGeometry(170);
  const puffMesh = new Mesh(puffs, puffMaterial(uniforms, false));
  puffMesh.frustumCulled = false;
  puffMesh.renderOrder = 2;
  const fog = new FogExp2("#d98f8e", 0.0016);
  scene.fog = fog;

  const hemi = new HemisphereLight();
  const sun = new DirectionalLight();
  sun.position.copy(LIGHT_DIRECTION).multiplyScalar(240);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_PX, SHADOW_MAP_PX);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  const rim = new DirectionalLight();
  rim.position.set(90, 40, 80);

  const birdMaterial = new MeshBasicMaterial({ color: MOOD.LIGHT.bird, side: DoubleSide });
  const wings = [
    new InstancedMesh(birdWing(), birdMaterial, BIRDS),
    new InstancedMesh(birdWing(), birdMaterial, BIRDS),
  ] as const;
  const flocks = Array.from({ length: BIRDS }, (_, i) => {
    const random = randomOf(900 + i);
    const f = i % 3;
    const centre =
      [new Vector3(0, 0, 0), new Vector3(30, 0, -20), new Vector3(-40, 0, 30)][f] ?? new Vector3();
    return {
      centre,
      radius: ([34, 70, 120][f] ?? 50) + random() * 8,
      y: ([30, 44, 26][f] ?? 30) + random() * 6,
      speed: ([0.12, -0.08, 0.06][f] ?? 0.1) * (0.9 + random() * 0.2),
      phase: random() * 0.6 + f * 2,
      flap: random() * 6,
    };
  });
  for (const wing of wings) wing.frustumCulled = false;
  scene.add(dome.mesh, sea.mesh, puffMesh, hemi, sun, sun.target, rim, ...wings);

  const placing = new Object3D();
  const placeBirds = (elapsed: number) => {
    flocks.forEach((bird, i) => {
      const a = elapsed * bird.speed + bird.phase + i * 0.05;
      placing.position.set(
        bird.centre.x + Math.cos(a) * bird.radius + Math.sin(i * 3.1) * 3,
        bird.y + Math.sin(elapsed * 0.5 + i) * 1.2,
        bird.centre.z + Math.sin(a) * bird.radius + Math.cos(i * 2.3) * 3,
      );
      const yaw = -a - (bird.speed > 0 ? 0 : Math.PI);
      const flap = Math.sin(elapsed * 9 + bird.flap) * 0.7;
      placing.scale.setScalar(1.6);
      placing.rotation.set(0, yaw, flap);
      placing.updateMatrix();
      wings[0].setMatrixAt(i, placing.matrix);
      placing.rotation.set(0, yaw + Math.PI, -flap);
      placing.updateMatrix();
      wings[1].setMatrixAt(i, placing.matrix);
    });
    for (const wing of wings) wing.instanceMatrix.needsUpdate = true;
  };
  placeBirds(0);

  return {
    uniforms,
    glow,
    setDark: (dark) => {
      const mood: Mood = dark ? MOOD.DARK : MOOD.LIGHT;
      uniforms.uHor.value.set(mood.horizon);
      uniforms.uHorSun.value.set(mood.horizonSun);
      uniforms.uLit.value.set(mood.puffLit);
      uniforms.uShadow.value.set(mood.puffShadow);
      uniforms.uGlow.value.set(mood.puffGlow);
      dome.material.uniforms.uZen?.value.set(mood.zenith);
      dome.material.uniforms.uUp?.value.set(mood.upper);
      dome.material.uniforms.uDisc?.value.set(mood.disc);
      if (dome.material.uniforms.uStars !== undefined)
        dome.material.uniforms.uStars.value = mood.stars;
      sea.material.uniforms.uSeaLit?.value.set(mood.seaLit);
      sea.material.uniforms.uSeaShadow?.value.set(mood.seaShadow);
      sea.material.uniforms.uSeaGlow?.value.set(mood.seaGlow);
      fog.color.set(mood.fog);
      fog.density = mood.fogDensity;
      hemi.color.set(mood.hemiSky);
      hemi.groundColor.set(mood.hemiGround);
      hemi.intensity = mood.hemi;
      sun.color.set(mood.sun);
      sun.intensity = mood.sunIntensity;
      rim.color.set(mood.rim);
      rim.intensity = mood.rimIntensity;
      birdMaterial.color.set(mood.bird);
      glow.value = mood.glow;
    },
    fit: (extent) => {
      const reach = extent + 20;
      Object.assign(sun.shadow.camera, {
        left: -reach,
        right: reach,
        top: reach,
        bottom: -reach,
        near: 20,
        far: 240 + reach * 2,
      });
      sun.shadow.camera.updateProjectionMatrix();
      setPuffs(puffs, fairCloud(extent));
    },
    frame: (elapsed) => {
      uniforms.uTime.value = elapsed;
      placeBirds(elapsed);
    },
    placeStill: () => {
      uniforms.uTime.value = 0;
      placeBirds(0);
    },
  };
}
