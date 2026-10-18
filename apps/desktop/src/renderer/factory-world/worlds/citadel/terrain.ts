import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  type IUniform,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { angleBetween, fbm, lerp, placed, polar, seeded, smooth, TAU, valueNoise } from "./math";

/**
 * terrain.ts -- the land the Citadel stands on and the air around it: the terraced hill, the river, the forest, the far mountains, the sky, the mist, the birds, and the light, at golden hour or by night.
 *
 * Note that the land is the same for every repository: three walls ring a
 * hill, the keep on its crown, the bailey on its shoulder, and the town
 * outside the outer curtain, and the zones are what is built on it. Its
 * height is a pure function of the floor (`heightAt`), so every part that
 * stands on the ground asks it rather than a mesh.
 */

/** The hill's terraces and walls, in scene units. */
export const HILL = {
  /** The keep's wall, around the crown. */
  KEEP_RADIUS: 15.4,
  /** The inner curtain, around the bailey. */
  INNER_RADIUS: 37.3,
  /** The outer curtain, the town's wall. */
  OUTER_RADIUS: 47,
  /** Where the bailey's buildings stand, midway between the keep and the curtain. */
  KEEP_LEVEL: 17,
  BAILEY_LEVEL: 10,
  WATER_LEVEL: -2.7,
  /** The octagonal foundation on the crown that the keep's towers stand on. */
  PLATFORM_RADIUS: 10,
  PLATFORM_HEIGHT: 2,
} as const;

/** The level of the crown's foundation, where the keep's towers stand. */
export const PLATFORM_LEVEL = HILL.KEEP_LEVEL + HILL.PLATFORM_HEIGHT;

/** The keep's two gates, on the crown's ramps. */
const KEEP_FACE = Math.PI / 2 + 0.62;
export const KEEP_GATES = [KEEP_FACE - Math.PI / 4 - 0.05, KEEP_FACE - Math.PI / 4 + Math.PI];

/** The inner curtain's four gates. */
export const INNER_GATES = [0, 1, 2, 3].map((k) => Math.PI / 2 - 0.42 + (k * Math.PI) / 2);

/** Where the sun stands: low in the west at golden hour. */
const SUN_ANGLE = 3.45;
const SUN_ELEVATION = 0.25;
const SUN_DIRECTION = new Vector3(
  Math.cos(SUN_ANGLE) * Math.cos(SUN_ELEVATION),
  Math.sin(SUN_ELEVATION),
  Math.sin(SUN_ANGLE) * Math.cos(SUN_ELEVATION),
).normalize();

/** The wind every flag and plume leans with. */
export const WIND = {
  x: 0.55 / Math.hypot(0.55, 0.85),
  z: -0.85 / Math.hypot(0.55, 0.85),
} as const;

/** How the scene is lit and hazed in each appearance: golden hour in the light, a blue night in the dark. */
const MOOD = {
  DAY: {
    horizon: "#f5cba0",
    zenith: "#5b84c0",
    sun: "#ffcf91",
    sunIntensity: 4.4,
    sky: "#c3cbe0",
    ground: "#6a5038",
    hemisphere: 1.1,
    fill: "#9fb6e0",
    fillIntensity: 0.55,
    fog: 0.0016,
    deepWater: "#2f4f52",
    mist: "#fbe1c4",
    mistAlpha: 1,
    disc: 14,
  },
  NIGHT: {
    horizon: "#3a4466",
    zenith: "#0a1024",
    sun: "#a9bcff",
    sunIntensity: 1.25,
    sky: "#5a6c9c",
    ground: "#1d1a24",
    hemisphere: 0.75,
    fill: "#6f86c0",
    fillIntensity: 0.35,
    fog: 0.0019,
    deepWater: "#0c1822",
    mist: "#7a88b0",
    mistAlpha: 0.55,
    disc: 3,
  },
} as const;

/** The GLSL noise the water, the mist, and the ground's grain share. */
const NOISE_GLSL = `
  float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1,0)), u.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), u.x), u.y); }
  float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }`;

/** The hill's height at radius `r` from the crown: the keep's plateau, the bailey's shoulder, the town's apron, and the valley below. */
export function profile(r: number): number {
  const baileyFoot = HILL.BAILEY_LEVEL - (HILL.INNER_RADIUS - HILL.KEEP_RADIUS - 0.6) * 0.014;
  if (r < HILL.KEEP_RADIUS) return HILL.KEEP_LEVEL;
  if (r < HILL.KEEP_RADIUS + 0.6) {
    return lerp(HILL.KEEP_LEVEL, HILL.BAILEY_LEVEL, (r - HILL.KEEP_RADIUS) / 0.6);
  }
  if (r < HILL.INNER_RADIUS) return HILL.BAILEY_LEVEL - (r - HILL.KEEP_RADIUS - 0.6) * 0.014;
  if (r < HILL.INNER_RADIUS + 0.6) return lerp(baileyFoot, 4.8, (r - HILL.INNER_RADIUS) / 0.6);
  if (r < 68) return 4.8 - (r - HILL.INNER_RADIUS - 0.6) * 0.055;
  if (r < 112) return lerp(3.13, -1.4, smooth(68, 112, r));
  return -1.4;
}

/** How far into a gate's ramp the point at `angle`, `r` stands, from 0 outside to 1 on its line. */
function rampAt(angle: number, r: number, gates: readonly number[], halfWidth: number): number {
  let into = 0;
  for (const gate of gates) {
    const off = Math.abs(angleBetween(angle, gate));
    if (off > 1.2) continue;
    into = Math.max(into, 1 - smooth(halfWidth, halfWidth + 0.9, off * r));
  }
  return into;
}

const KEEP_RAMP = { from: HILL.KEEP_RADIUS - 5.3, to: HILL.KEEP_RADIUS + 4.6 } as const;
const INNER_RAMP = { from: HILL.INNER_RADIUS - 3.4, to: HILL.INNER_RADIUS + 6.4 } as const;

/** A ramp's own height between its ends, which the terrace gives way to on the gate's line. */
function rampHeight(ramp: { readonly from: number; readonly to: number }, r: number): number {
  return lerp(profile(ramp.from), profile(ramp.to), (r - ramp.from) / (ramp.to - ramp.from));
}

/** The river's radius at `angle`: a slow meander around the hill's foot. */
function riverAt(angle: number): number {
  return 112 + Math.sin(angle * 3 + 0.7) * 8 + Math.sin(angle * 7 - 1.3) * 3.5;
}

/** The land's height at `x, z`: the hill, its gate ramps, its grass, the river, and the mountains far off. */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const angle = Math.atan2(z, x);
  let height = profile(r);
  if (r > KEEP_RAMP.from && r < KEEP_RAMP.to) {
    const into = rampAt(angle, r, KEEP_GATES, 1.7);
    if (into > 0) height = lerp(height, rampHeight(KEEP_RAMP, r), into);
  }
  if (r > INNER_RAMP.from && r < INNER_RAMP.to) {
    const into = rampAt(angle, r, INNER_GATES, 1.9);
    if (into > 0) height = lerp(height, rampHeight(INNER_RAMP, r), into);
  }
  const roughness =
    r < HILL.INNER_RADIUS + 0.5 ? 0.08 : r < 66 ? 0.32 : lerp(0.32, 2.6, smooth(66, 130, r));
  height += (fbm(x * 0.045 + 11, z * 0.045 - 5) - 0.5) * 2 * roughness;
  if (r > 88) height -= 4.2 * (1 - smooth(3.5, 11, Math.abs(r - riverAt(angle))));
  if (r > 165) {
    const rise = smooth(165, 330, r);
    const ridge = 1 - Math.abs(fbm(x * 0.011 + 3, z * 0.011 - 7, 5) * 2 - 1);
    height += rise * (14 + ridge * 70 * rise + fbm(x * 0.03, z * 0.03) * 16);
  }
  return height;
}

/** The height a figure stands at: the land, or the crown's foundation where it covers the land. */
export function groundAt(x: number, z: number): number {
  const height = heightAt(x, z);
  return Math.hypot(x, z) < HILL.PLATFORM_RADIUS * 0.93 ? Math.max(height, PLATFORM_LEVEL) : height;
}

/** The colour the land is painted at one vertex: grass on the hill, valley green and autumn below, cobbles on the crown and the ramps, rock where it is steep, sand at the water, the mountains blue. */
function landColor(out: Color, x: number, height: number, z: number, upward: number): void {
  const r = Math.hypot(x, z);
  const angle = Math.atan2(z, x);
  const broad = fbm(x * 0.08, z * 0.08, 3);
  const fine = valueNoise(x * 0.31, z * 0.31);
  if (r < 66)
    out
      .copy(LAND.grassA)
      .lerp(LAND.grassB, broad * 0.9)
      .lerp(LAND.grassC, fine * 0.35);
  else {
    out
      .copy(LAND.valley)
      .lerp(LAND.valleyLight, broad)
      .lerp(LAND.autumn, Math.max(0, fine - 0.62) * 1.6);
  }
  if (r < HILL.KEEP_RADIUS + 0.3) out.copy(LAND.paving).lerp(LAND.cobble, fine * 0.6);
  const keepRamp = r > KEEP_RAMP.from && r < KEEP_RAMP.to ? rampAt(angle, r, KEEP_GATES, 1.4) : 0;
  const innerRamp =
    r > INNER_RAMP.from && r < INNER_RAMP.to ? rampAt(angle, r, INNER_GATES, 1.6) : 0;
  out.lerp(LAND.cobble, Math.max(keepRamp, innerRamp));
  if (upward < 0.78) out.lerp(fine > 0.5 ? LAND.rock : LAND.rockDark, smooth(0.78, 0.5, upward));
  if (height < HILL.WATER_LEVEL + 0.6 && r > 70) {
    out.lerp(LAND.sand, smooth(HILL.WATER_LEVEL + 0.6, HILL.WATER_LEVEL + 0.05, height));
  }
  if (r > 175) {
    out
      .lerp(LAND.mountainGreen, smooth(175, 230, r))
      .lerp(LAND.mountain, smooth(12, 40, height) * smooth(200, 300, r));
  }
}

const LAND = {
  grassA: new Color("#8f9a45"),
  grassB: new Color("#b3a556"),
  grassC: new Color("#6c8a3c"),
  valley: new Color("#55743a"),
  valleyLight: new Color("#7c8a3e"),
  autumn: new Color("#b98a3e"),
  rock: new Color("#8d7f6e"),
  rockDark: new Color("#6a5e52"),
  cobble: new Color("#b8a68a"),
  paving: new Color("#c4b293"),
  sand: new Color("#cdb57f"),
  mountain: new Color("#7b8197"),
  mountainGreen: new Color("#5f7048"),
} as const;

/** The land as one mesh: rings dense near the hill and sparse towards the mountains, painted per vertex, with a grain the shader adds. */
function terrainMesh(): Mesh {
  const rings: number[] = [];
  for (let r = 0; r < 520; r += r < 72 ? 0.5 : r < 140 ? 1.5 : r < 230 ? 3.5 : 8) rings.push(r);
  const segments = 360;
  const positions = new Float32Array(rings.length * segments * 3);
  rings.forEach((r, ring) => {
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * TAU + (ring % 2) * (TAU / segments) * 0.5;
      const at = (ring * segments + segment) * 3;
      const x = r * Math.cos(angle);
      const z = r * Math.sin(angle);
      positions[at] = x;
      positions[at + 1] = heightAt(x, z);
      positions[at + 2] = z;
    }
  });
  const indices: number[] = [];
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * segments + segment;
      const b = ring * segments + ((segment + 1) % segments);
      const c = (ring + 1) * segments + segment;
      const d = (ring + 1) * segments + ((segment + 1) % segments);
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const colors = new Float32Array(positions.length);
  const paint = new Color();
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3] ?? 0;
    const z = positions[vertex * 3 + 2] ?? 0;
    landColor(paint, x, positions[vertex * 3 + 1] ?? 0, z, normals.getY(vertex));
    paint.toArray(colors, vertex * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.97 });
  // Note that the grain is noise the shader draws in world space, so the land needs no texture.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLandWorld;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvLandWorld = (modelMatrix * vec4(position, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vLandWorld;\n${NOISE_GLSL}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float grain = vn(vLandWorld.xz * 14.0) * 0.6 + vn(vLandWorld.xz * 2.9) * 0.4;
        diffuseColor.rgb *= 0.78 + 0.32 * (0.6 + 0.4 * grain);`,
      );
  };
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** The sky: a dome drawn at the far plane, the horizon warm and the sun a disc. */
function skyDome() {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSun: { value: SUN_DIRECTION },
      uZenith: { value: new Color() },
      uHorizon: { value: new Color() },
      uSunColor: { value: new Color() },
      uDisc: { value: 14 },
    },
    vertexShader:
      "varying vec3 vDirection; void main(){ vDirection = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }",
    fragmentShader: `uniform vec3 uSun, uZenith, uHorizon, uSunColor; uniform float uDisc; varying vec3 vDirection;
      void main(){ vec3 d = normalize(vDirection); float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
        col = mix(col, uHorizon * vec3(1.0, 0.92, 0.86), smoothstep(0.02, -0.2, h));
        float s = max(dot(d, uSun), 0.0);
        col += uSunColor * (pow(s, 5.0) * 0.32 + pow(s, 42.0) * 0.9) + vec3(1.0, 0.9, 0.7) * smoothstep(0.9993, 0.9997, s) * uDisc;
        col += vec3(1.0, 0.55, 0.3) * pow(1.0 - abs(h), 9.0) * 0.12;
        gl_FragColor = vec4(col * vec3(1.04, 1.0, 0.94), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new Mesh(new SphereGeometry(900, 48, 24), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, material };
}

/** The water in the valley: a plane whose ripples, sky reflection, and sun glint the shader draws. */
function waterPlane() {
  const material = new ShaderMaterial({
    fog: true,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSun: { value: SUN_DIRECTION },
        uSunColor: { value: new Color() },
        uHorizon: { value: new Color() },
        uZenith: { value: new Color() },
        uDeep: { value: new Color() },
      },
    ]),
    vertexShader: `varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uSun, uSunColor, uHorizon, uZenith, uDeep; varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main(){
        vec2 p = vWorld.xz * 0.09;
        float e = 0.05;
        float h0 = fbm2(p + uTime * 0.03) + fbm2(p * 2.3 - uTime * 0.05) * 0.5;
        float hx = fbm2(p + vec2(e, 0.0) + uTime * 0.03) + fbm2((p + vec2(e, 0.0)) * 2.3 - uTime * 0.05) * 0.5;
        float hz = fbm2(p + vec2(0.0, e) + uTime * 0.03) + fbm2((p + vec2(0.0, e)) * 2.3 - uTime * 0.05) * 0.5;
        vec3 N = normalize(vec3(-(hx - h0) / e * 0.35, 1.0, -(hz - h0) / e * 0.35));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.5));
        float spec = pow(max(dot(R, uSun), 0.0), 220.0) * 9.0 + pow(max(dot(R, uSun), 0.0), 24.0) * 0.35;
        gl_FragColor = vec4(mix(uDeep, sky, clamp(fres + 0.25, 0.0, 1.0)) + uSunColor * spec, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
  const mesh = new Mesh(new PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), material);
  mesh.position.y = HILL.WATER_LEVEL;
  return { mesh, material };
}

/** Three sheets of mist drifting in the valley below the hill. */
function mistSheets() {
  const sheets = [
    { y: -1.2, scale: 1, alpha: 0.42 },
    { y: 0.8, scale: 1.4, alpha: 0.28 },
    { y: 2.8, scale: 0.8, alpha: 0.14 },
  ];
  const materials = sheets.map(
    (sheet) =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: true,
        uniforms: UniformsUtils.merge([
          UniformsLib.fog,
          {
            uTime: { value: 0 },
            uScale: { value: sheet.scale },
            uAlpha: { value: sheet.alpha },
            uColor: { value: new Color() },
          },
        ]),
        vertexShader: `varying vec3 vWorld;
          #include <fog_pars_vertex>
          void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
          }`,
        fragmentShader: `uniform float uTime, uScale, uAlpha; uniform vec3 uColor; varying vec3 vWorld;
          #include <common>
          #include <fog_pars_fragment>
          ${NOISE_GLSL}
          void main(){
            float r = length(vWorld.xz);
            float n = fbm2(vWorld.xz * 0.012 * uScale + vec2(uTime * 0.006, uTime * 0.004));
            float n2 = fbm2(vWorld.xz * 0.035 * uScale - vec2(uTime * 0.01, 0.0));
            float a = smoothstep(0.38, 0.75, n * 0.75 + n2 * 0.4) * smoothstep(70.0, 104.0, r) * (1.0 - smoothstep(260.0, 520.0, r)) * uAlpha;
            gl_FragColor = vec4(uColor, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      }),
  );
  const meshes = sheets.map((sheet, index) => {
    const mesh = new Mesh(
      new RingGeometry(64, 560, 96, 1).rotateX(-Math.PI / 2),
      materials[index] ?? new MeshBasicMaterial(),
    );
    mesh.position.y = sheet.y;
    mesh.renderOrder = 2;
    return mesh;
  });
  // Note that night thins each sheet from its own daylight opacity.
  const thin = (share: number) => {
    materials.forEach((material, index) => {
      const alpha = material.uniforms.uAlpha;
      if (alpha) alpha.value = (sheets[index]?.alpha ?? 0) * share;
    });
  };
  return { meshes, materials, thin };
}

/** Geometry parts merged into one, each painted its own colour per vertex. */
function painted(parts: readonly (readonly [BufferGeometry, string])[]): BufferGeometry {
  const merged = mergeGeometries(
    parts.map(([part, hex]) => {
      const flat = part.index === null ? part : part.toNonIndexed();
      flat.deleteAttribute("uv");
      const color = new Color(hex);
      const colors = new Float32Array(flat.getAttribute("position").count * 3);
      for (let at = 0; at < colors.length; at += 3) color.toArray(colors, at);
      flat.setAttribute("color", new BufferAttribute(colors, 3));
      return flat;
    }),
  );
  return merged;
}

/** One tree that stands somewhere on the land, and how it is drawn there. */
interface TreeSpot {
  readonly x: number;
  readonly z: number;
  readonly matrix: Matrix4;
  /** Whether anything could be built where it stands. */
  readonly near: boolean;
}

/** How far from the crown anything is built: a tree beyond it never gives way. */
const NOTHING_BUILT_PAST = 96;

/** A circle on the floor where something is built, which a tree gives way to. */
export interface Clearing {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/** The forest: pines and oaks in the valley and on the slopes, and a few garden trees inside the walls, one instanced mesh each. */
function forest() {
  const pine = painted([
    [new CylinderGeometry(0.12, 0.2, 1.4, 6).translate(0, 0.7, 0), "#5a3d28"],
    [new ConeGeometry(1.15, 1.9, 7).translate(0, 1.9, 0), "#3f6a3a"],
    [new ConeGeometry(0.9, 1.6, 7).translate(0, 2.7, 0), "#467540"],
    [new ConeGeometry(0.6, 1.3, 7).translate(0, 3.4, 0), "#4f8046"],
  ]);
  const oak = painted([
    [new CylinderGeometry(0.14, 0.24, 1.6, 6).translate(0, 0.8, 0), "#5a3d28"],
    [new IcosahedronGeometry(1.25, 0).translate(0, 2.3, 0), "#ffffff"],
    [new IcosahedronGeometry(0.85, 0).translate(0.6, 2.8, 0.3), "#ffffff"],
  ]);
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    flatShading: true,
  });
  const random = seeded(99);
  const spots: { x: number; z: number; height: number; size: number; pine: boolean }[] = [];
  for (let tries = 0; spots.length < 1700 && tries < 30000; tries += 1) {
    const angle = random() * TAU;
    const r = 67 + random() ** 0.8 * 190;
    const [x, z] = polar(r, angle);
    const height = heightAt(x, z);
    if (height < HILL.WATER_LEVEL + 0.35) continue;
    if (fbm(x * 0.02 + 40, z * 0.02) < 0.42 && r > 72) continue;
    spots.push({
      x,
      z,
      height,
      size: 0.8 + random() * 0.9 + (r > 120 ? 0.5 : 0),
      pine: random() < (r > 140 ? 0.7 : 0.45),
    });
  }
  // Note that a handful of garden trees soften the bailey and the lists between the curtains.
  for (let k = 0; k < 26; k += 1) {
    const angle = random() * TAU;
    const r = k < 16 ? 33.2 + random() * 2 : 40 + random() * 2.5;
    if (INNER_GATES.some((gate) => Math.abs(angleBetween(angle, gate)) * r < 4)) continue;
    const [x, z] = polar(r, angle);
    spots.push({ x, z, height: heightAt(x, z), size: 0.55 + random() * 0.3, pine: false });
  }
  const autumn = ["#c9893b", "#d4a03f", "#b45f2c", "#9aa043"].map((hex) => new Color(hex));
  const green = ["#5b8a3e", "#6f9442", "#4f7a3a", "#7c9a48"].map((hex) => new Color(hex));
  const kinds = [
    { geometry: pine, list: spots.filter((spot) => spot.pine), oak: false },
    { geometry: oak, list: spots.filter((spot) => !spot.pine), oak: true },
  ];
  const stands: { mesh: InstancedMesh; trees: TreeSpot[] }[] = kinds.map((kind) => {
    const mesh = new InstancedMesh(kind.geometry, material, kind.list.length);
    const tint = new Color();
    const trees = kind.list.map((spot, index) => {
      const matrix = placed(
        new Matrix4(),
        spot.x,
        spot.height - 0.15,
        spot.z,
        random() * TAU,
        spot.size,
        spot.size * (0.85 + random() * 0.35),
        spot.size,
      );
      mesh.setMatrixAt(index, matrix);
      if (kind.oak) tint.copy((random() < 0.45 ? autumn : green)[Math.floor(random() * 4)] ?? tint);
      else tint.setHSL(0.3, 0.2, 0.42 + random() * 0.15).multiplyScalar(2.1);
      mesh.setColorAt(index, tint);
      return {
        x: spot.x,
        z: spot.z,
        matrix,
        near: Math.hypot(spot.x, spot.z) < NOTHING_BUILT_PAST,
      };
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { mesh, trees };
  });
  const gone = new Matrix4().makeScale(0, 0, 0);
  return {
    meshes: stands.map((stand) => stand.mesh),
    // Note that a tree standing where a zone, a worksite, or a blueprint was placed gives way to it.
    clear: (clearings: readonly Clearing[]) => {
      for (const { mesh, trees } of stands) {
        trees.forEach((tree, index) => {
          if (!tree.near) return;
          const cleared = clearings.some(
            (clearing) => Math.hypot(tree.x - clearing.x, tree.z - clearing.z) < clearing.radius,
          );
          mesh.setMatrixAt(index, cleared ? gone : tree.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}

/** The birds wheeling over the valley in three flocks: a body and two wings each, posed every frame. */
function flocks() {
  const count = 26;
  const body = new ConeGeometry(0.12, 0.7, 5).rotateX(Math.PI / 2);
  const wing = new BufferGeometry();
  wing.setAttribute(
    "position",
    new Float32BufferAttribute([0, 0, 0.18, 0, 0, -0.16, 1, 0, -0.05], 3),
  );
  wing.computeVertexNormals();
  const material = new MeshBasicMaterial({ color: "#3a2a24", side: DoubleSide });
  const bodies = new InstancedMesh(body, material, count);
  const left = new InstancedMesh(wing, material, count);
  const right = new InstancedMesh(wing, material, count);
  const random = seeded(61);
  const birds = Array.from({ length: count }, (_, index) => ({
    flock: index % 3,
    phase: random() * TAU,
    off: [random() * 6 - 3, random() * 3, random() * 6 - 3] as const,
    flap: random() * 10,
  }));
  const paths = [
    { r: 62, y: 52, speed: 0.06, cx: 0, cz: 0 },
    { r: 88, y: 44, speed: -0.045, cx: -30, cz: -40 },
    { r: 46, y: 60, speed: 0.08, cx: -10, cz: 10 },
  ] as const;
  const root = new Matrix4();
  const joint = new Matrix4();
  const fly = (elapsed: number) => {
    birds.forEach((bird, index) => {
      const path = paths[bird.flock] ?? paths[0];
      const angle = elapsed * path.speed + bird.phase * 0.08 + bird.flock * 2;
      const x = path.cx + Math.cos(angle) * path.r + bird.off[0];
      const z = path.cz + Math.sin(angle) * path.r + bird.off[2];
      const y = path.y + bird.off[1] + Math.sin(elapsed * 0.5 + bird.phase) * 1.5;
      const heading = Math.sign(path.speed);
      const yaw = Math.atan2(-Math.sin(angle) * heading, Math.cos(angle) * heading);
      const flap = Math.sin(elapsed * 9 + bird.flap) * 0.7;
      placed(root, x, y, z, yaw);
      bodies.setMatrixAt(index, root);
      left.setMatrixAt(
        index,
        joint.copy(root).multiply(placed(new Matrix4(), 0, 0, 0, 0, 1, 1, 1, 0, flap)),
      );
      right.setMatrixAt(
        index,
        joint.copy(root).multiply(placed(new Matrix4(), 0, 0, 0, Math.PI, 1, 1, 1, 0, -flap)),
      );
    });
    for (const mesh of [bodies, left, right]) mesh.instanceMatrix.needsUpdate = true;
  };
  for (const mesh of [bodies, left, right]) mesh.frustumCulled = false;
  fly(0);
  return { meshes: [bodies, left, right], fly };
}

/** The land and its air as built once: what the world steps each frame, and how it turns day to night. */
export interface Landscape {
  /** Hides the trees standing in the clearings, and shows the rest. */
  readonly clear: (clearings: readonly Clearing[]) => void;
  /** Lights and hazes the scene for the light appearance or the dark one. */
  readonly dress: (dark: boolean) => void;
  /** Steps the water, the mist, and the birds. */
  readonly step: (elapsed: number) => void;
  /** The fog's colour and density, which the glowing parts fade into as the scene's own parts do. */
  readonly fog: { readonly color: Color; readonly density: { value: number } };
}

/** Builds the land, the sky, the water, the mist, the forest, the birds, and the light into `scene`. */
export function buildLandscape(scene: Scene): Landscape {
  const fog = new FogExp2(MOOD.DAY.horizon, MOOD.DAY.fog);
  const density: IUniform<number> = { value: MOOD.DAY.fog };
  scene.fog = fog;
  const sun = new DirectionalLight(MOOD.DAY.sun, MOOD.DAY.sunIntensity);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(160);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -90,
    right: 90,
    top: 90,
    bottom: -90,
    near: 20,
    far: 340,
  });
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.045;
  const hemisphere = new HemisphereLight(MOOD.DAY.sky, MOOD.DAY.ground, MOOD.DAY.hemisphere);
  const fill = new DirectionalLight(MOOD.DAY.fill, MOOD.DAY.fillIntensity);
  fill.position.set(-SUN_DIRECTION.x * 100, 60, -SUN_DIRECTION.z * 100);
  scene.add(sun, sun.target, hemisphere, fill);

  const sky = skyDome();
  const water = waterPlane();
  const mist = mistSheets();
  const trees = forest();
  const birds = flocks();
  scene.add(terrainMesh(), sky.mesh, water.mesh, ...mist.meshes, ...trees.meshes, ...birds.meshes);

  return {
    clear: trees.clear,
    fog: { color: fog.color, density },
    dress: (dark) => {
      const mood = dark ? MOOD.NIGHT : MOOD.DAY;
      fog.color.set(mood.horizon);
      fog.density = mood.fog;
      density.value = mood.fog;
      sun.color.set(mood.sun);
      sun.intensity = mood.sunIntensity;
      hemisphere.color.set(mood.sky);
      hemisphere.groundColor.set(mood.ground);
      hemisphere.intensity = mood.hemisphere;
      fill.color.set(mood.fill);
      fill.intensity = mood.fillIntensity;
      for (const uniforms of [sky.material.uniforms, water.material.uniforms]) {
        uniforms.uHorizon?.value.set(mood.horizon);
        uniforms.uZenith?.value.set(mood.zenith);
        uniforms.uSunColor?.value.set(mood.sun);
      }
      if (sky.material.uniforms.uDisc) sky.material.uniforms.uDisc.value = mood.disc;
      water.material.uniforms.uDeep?.value.set(mood.deepWater);
      for (const material of mist.materials) material.uniforms.uColor?.value.set(mood.mist);
      mist.thin(mood.mistAlpha);
    },
    step: (elapsed) => {
      if (water.material.uniforms.uTime) water.material.uniforms.uTime.value = elapsed;
      for (const material of mist.materials) {
        if (material.uniforms.uTime) material.uniforms.uTime.value = elapsed;
      }
      birds.fly(elapsed);
    },
  };
}
