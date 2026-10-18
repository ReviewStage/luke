import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { GLOW_SHAPE, type GlowField } from "./glow";
import {
  between,
  edgeRadius,
  fractalNoise,
  GLSL_NOISE,
  groundY,
  ISLAND_DEPTH,
  ISLAND_RADIUS,
  meadowPoint,
  painted,
  randomOf,
  smooth,
  valueNoise,
} from "./nature";
import { BRANCH_KIND, branchPoint, item, type Skeleton } from "./skeleton";
import { MAX_WOUNDS, type SharedUniforms } from "./wood";

/**
 * island.ts -- the floating island the World Tree stands on: its meadow and swaying grass, the earth cut away beneath so the roots read through it, its rocks, vines, and waterfall, and the tooling zones as places on the meadow.
 *
 * A tooling zone is a shed when it is one of the larger ones and a stone
 * lantern when small, at its layout angle, joined to the trunk by stepping
 * stones; seven more lanterns light the rim and stand for nothing. The
 * grass and the meadow wither round a defect wound below them, read from
 * the shared wound uniforms, so a defect needs no grass rewritten.
 */

const GRASS_COUNT = 9000;
const FLOWER_COUNT = 220;
const ROCK_COUNT = 14;
const SHARD_COUNT = 4;
const RIM_LANTERNS = 7;
const MIST_COUNT = 46;
const STONES_PER_PATH = 14;
/** The share of the largest zone a tooling zone must reach to be a shed rather than a lantern. */
const SHED_FOOTPRINT = 0.3;
/** The angle the stream runs out along to the waterfall. */
const STREAM_ANGLE = 0.02;

/** GLSL: how withered the meadow is at `p`, from the wounds beneath it. */
const GLSL_BLIGHT = /* glsl */ `
  uniform vec4 uWound[${MAX_WOUNDS}]; uniform int uWoundN; uniform float uDefects;
  float blightAt(vec3 p){
    float k = 0.0;
    for (int i = 0; i < ${MAX_WOUNDS}; i++){ if (i >= uWoundN) break; vec4 c = uWound[i];
      if (c.y > 2.0 || c.w <= 0.0) continue;
      float d = length(p.xz - c.xz) + (vn3(vec3(p.x, 0.0, p.z)) - 0.5) * 2.0;
      k = max(k, 1.0 - smoothstep(1.5, 4.0 + c.w * 3.5, d)); }
    return k * uDefects; }
`;

function quad(index: number[], a: number, b: number, c: number, d: number): void {
  index.push(a, b, c, b, d, c);
}

/** The meadow's top: a polar grid following the ragged rim, coloured grass-green to dry gold, earthy round the trunk. */
function meadowGeometry(): BufferGeometry {
  const rings = 34;
  const segments = 120;
  const position: number[] = [];
  const color: number[] = [];
  const index: number[] = [];
  const g1 = new Color("#7fae55");
  const g2 = new Color("#b9cf6e");
  const g3 = new Color("#5c8e4a");
  const dirt = new Color("#9b7a55");
  const c = new Color();
  for (let i = 0; i <= rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const th = (j / segments) * Math.PI * 2;
      const rho = (i / rings) ** 0.8 * edgeRadius(th);
      const x = Math.cos(th) * rho;
      const z = Math.sin(th) * rho;
      position.push(x, i === rings ? -0.25 : groundY(x, z), z);
      const n = fractalNoise(x * 0.15, 3, z * 0.15);
      c.copy(g3)
        .lerp(g1, smooth(0.25, 0.55, n))
        .lerp(g2, smooth(0.55, 0.85, n) * 0.8);
      c.lerp(dirt, (1 - smooth(3.2, 5.5, rho)) * 0.55);
      color.push(c.r, c.g, c.b);
    }
  }
  position.push(0, groundY(0, 0), 0);
  color.push(dirt.r, dirt.g, dirt.b);
  const centre = (rings + 1) * segments;
  for (let j = 0; j < segments; j += 1) index.push(centre, (j + 1) % segments, j);
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      quad(
        index,
        i * segments + j,
        i * segments + ((j + 1) % segments),
        (i + 1) * segments + j,
        (i + 1) * segments + ((j + 1) % segments),
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** The island's earth: rings narrowing to a point far below. */
function earthGeometry(): BufferGeometry {
  const levels = 42;
  const segments = 120;
  const position: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= levels; i += 1) {
    const f = i / levels;
    const y = -0.25 - f * ISLAND_DEPTH;
    for (let j = 0; j < segments; j += 1) {
      const th = (j / segments) * Math.PI * 2;
      const shape =
        (1 - f) ** 0.72 *
        (1 +
          0.16 *
            (fractalNoise(Math.cos(th) * 2 + 7, y * 0.12, Math.sin(th) * 2) - 0.5) *
            2 *
            Math.sin(f * Math.PI));
      const rho = edgeRadius(th) * shape * (i === 0 ? 1 : 0.985);
      position.push(Math.cos(th) * rho, y - (i === levels ? 1.5 : 0), Math.sin(th) * rho);
    }
  }
  for (let i = 0; i < levels; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      quad(
        index,
        i * segments + j,
        i * segments + ((j + 1) % segments),
        (i + 1) * segments + j,
        (i + 1) * segments + ((j + 1) % segments),
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** The earth's two faces: its far inside, strata and sparkle, and its near outside, cut away on the camera's side so the roots read through it. */
function earthMaterial(shared: SharedUniforms, fogColor: Color, inside: boolean): ShaderMaterial {
  return new ShaderMaterial({
    side: inside ? BackSide : FrontSide,
    uniforms: {
      uSunDir: shared.uSunDir,
      uTime: shared.uTime,
      uFog: { value: fogColor },
      uNight: shared.uNight,
    },
    vertexShader: /* glsl */ `varying vec3 vWP; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${GLSL_NOISE}
      uniform vec3 uSunDir; uniform float uTime; uniform vec3 uFog; uniform float uNight; varying vec3 vWP; varying vec3 vN;
      void main(){
        vec2 cam = normalize(cameraPosition.xz + vec2(1e-4));
        vec2 dirP = normalize(vWP.xz + vec2(1e-4));
        float facing = dot(dirP, cam);
        float cutAt = 0.6 + (vn3(vec3(vWP.y * 0.35, 0.0, 1.0)) - 0.5) * 0.14;
        ${inside ? "" : "if (facing > cutAt && vWP.y < -0.9) discard;"}
        vec3 N = normalize(vN); ${inside ? "N = -N;" : ""}
        float y = vWP.y;
        float wob = vn3(vWP * vec3(0.22, 0.8, 0.22));
        float strata = 0.5 + 0.5 * sin(y * 2.1 + wob * 5.5);
        float fine = vn3(vWP * vec3(1.6, 4.0, 1.6));
        vec3 col;
        ${
          inside
            ? `vec3 top = srgb(vec3(0.38, 0.23, 0.15)), mid = srgb(vec3(0.24, 0.14, 0.21)), bot = srgb(vec3(0.09, 0.07, 0.17));
          col = mix(bot, mid, smoothstep(-21.0, -7.0, y));
          col = mix(col, top, smoothstep(-8.0, -0.5, y));
          col *= 0.72 + 0.45 * strata + 0.15 * fine;
          float sparkle = step(0.9965, h31(floor(vWP * 4.0))) * (0.5 + 0.5 * sin(uTime * 3.0 + h31(floor(vWP * 5.0) + 2.0) * 40.0));
          col += vec3(0.5, 0.9, 1.0) * sparkle * 0.9;
          col += vec3(1.0, 0.55, 0.25) * pow(strata, 6.0) * 0.08;`
            : `vec3 top = srgb(vec3(0.78, 0.52, 0.38)), mid = srgb(vec3(0.62, 0.40, 0.52)), bot = srgb(vec3(0.30, 0.22, 0.48));
          col = mix(bot, mid, smoothstep(-21.0, -8.0, y));
          col = mix(col, top, smoothstep(-9.0, -0.8, y));
          col *= 0.78 + 0.32 * strata + 0.12 * fine;
          col *= (0.42 + 0.75 * max(dot(N, uSunDir), 0.0) + 0.18 * max(N.y, 0.0)) * mix(1.0, 0.45, uNight);
          float edge = smoothstep(cutAt - 0.06, cutAt, facing) * step(vWP.y, -0.9);
          col = mix(col, srgb(vec3(1.0, 0.82, 0.6)) * mix(1.3, 0.7, uNight), edge * 0.85);
          col = mix(col, srgb(vec3(0.45, 0.32, 0.22)), smoothstep(-1.4, -0.4, y) * 0.6);`
        }
        float dist = length(cameraPosition - vWP);
        col = mix(col, uFog, 1.0 - exp(-pow(dist * 0.0024, 2.0)));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** One blade of grass: a tapered strip, lighter at its tip. */
function bladeGeometry(): BufferGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const segments = 4;
  for (let k = 0; k <= segments; k += 1) {
    const v = k / segments;
    const w = 0.06 * (1 - v * 0.9);
    position.push(-w, v, 0, w, v, 0);
    uv.push(0, v, 1, v);
    const shade = 0.45 + 0.55 * v;
    color.push(shade, shade, shade, shade, shade, shade);
    if (k < segments) index.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
  }
  const blade = new BufferGeometry();
  blade.setAttribute("position", new Float32BufferAttribute(position, 3));
  blade.setAttribute("color", new Float32BufferAttribute(color, 3));
  blade.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  blade.setIndex(index);
  blade.computeVertexNormals();
  return blade;
}

/** Grass that sways, and withers flat and dark over a wound. */
function grassMaterial(shared: SharedUniforms): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\n${GLSL_NOISE}\n${GLSL_BLIGHT}\nuniform float uTime; varying float vBlight;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vBlight = blightAt(ip);
        transformed.y *= 1.0 - vBlight * 0.8; transformed.x *= 1.0 + vBlight;
        float sway = sin(uTime * 1.7 + ip.x * 0.35 + ip.z * 0.22) * 0.5 + sin(uTime * 3.1 + ip.x * 1.3) * 0.18;
        transformed.x += sway * uv.y * uv.y * 0.35 * (1.0 - vBlight); transformed.z += cos(uTime * 1.3 + ip.z * 0.4) * uv.y * uv.y * 0.12;`,
      )
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nobjectNormal = vec3(0.0, 1.0, 0.0);",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBlight;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.010, 0.016), vBlight * 0.95);",
      );
  };
  material.customProgramCacheKey = () => "tree-grass";
  return material;
}

/** The meadow's own colours, darkened over a wound. */
function meadowMaterial(shared: SharedUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vMeadow;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvMeadow = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${GLSL_NOISE}\n${GLSL_BLIGHT}\nvarying vec3 vMeadow;`,
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.006, 0.009), blightAt(vMeadow) * 0.9);",
      );
  };
  material.customProgramCacheKey = () => "tree-meadow";
  return material;
}

/** Running water: the stream across the meadow and the fall off its rim, foam flowing down it. */
function waterMaterial(shared: SharedUniforms, fall: boolean): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    uniforms: { uTime: shared.uTime, uNight: shared.uNight },
    vertexShader:
      /* glsl */ "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: /* glsl */ `${GLSL_NOISE}
      uniform float uTime; uniform float uNight; varying vec2 vUv;
      void main(){
        float across = abs(vUv.x - 0.5) * 2.0;
        float speed = ${fall ? "1.6" : "0.35"};
        float n = vn3(vec3(vUv.x * ${fall ? "9.0" : "6.0"}, vUv.y * ${fall ? "5.0" : "14.0"} - uTime * speed * ${fall ? "3.0" : "4.0"}, 0.0));
        float n2 = vn3(vec3(vUv.x * 21.0, vUv.y * ${fall ? "9.0" : "30.0"} - uTime * speed * 5.0, 3.0));
        float foam = smoothstep(0.55, 0.85, n * 0.7 + n2 * 0.45);
        vec3 deep = srgb(vec3(0.42, 0.66, 0.86)), lite = srgb(vec3(0.86, 0.96, 1.0));
        vec3 col = mix(deep, lite, foam * 0.85 + ${fall ? "0.25" : "0.1"}) * mix(1.0, 0.5, uNight);
        col += srgb(vec3(1.0, 0.85, 0.7)) * pow(foam, 3.0) * 0.4;
        float a = (1.0 - smoothstep(0.6, 1.0, across)) * ${
          fall
            ? "(0.55 + 0.4 * foam) * (1.0 - smoothstep(0.55, 1.0, vUv.y)) * smoothstep(0.0, 0.04, vUv.y)"
            : "(0.7 + 0.25 * foam)"
        };
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** A flat ribbon along `points`, `width` across, turned to face `sideOf`. */
function ribbon(points: readonly Vector3[], width: (f: number) => number): BufferGeometry {
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const lengths = [0];
  for (let i = 1; i < points.length; i += 1)
    lengths.push((lengths[i - 1] ?? 0) + item(points, i).distanceTo(item(points, i - 1)));
  const total = item(lengths, lengths.length - 1);
  points.forEach((p, i) => {
    const f = i / (points.length - 1);
    const side = new Vector3(-p.z, 0, p.x).normalize();
    const w = width(f);
    const a = p.clone().addScaledVector(side, -w / 2);
    const b = p.clone().addScaledVector(side, w / 2);
    position.push(a.x, a.y, a.z, b.x, b.y, b.z);
    const v = (lengths[i] ?? 0) / total;
    uv.push(0, v, 1, v);
    if (i < points.length - 1)
      index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

/** The parts of a stone lantern: its stone, and its lit box. */
function lanternGeometries() {
  const cap = new ConeGeometry(0.48, 0.32, 4).rotateY(Math.PI / 4).translate(0, 1.66, 0);
  const stone = mergeGeometries([
    new CylinderGeometry(0.35, 0.45, 0.25, 6).translate(0, 0.12, 0).toNonIndexed(),
    new CylinderGeometry(0.13, 0.16, 0.9, 6).translate(0, 0.7, 0).toNonIndexed(),
    cap.toNonIndexed(),
    new SphereGeometry(0.08, 6, 5).translate(0, 1.88, 0).toNonIndexed(),
  ]);
  if (stone === null) throw new Error("tree: the lantern's stone would not merge");
  return { stone, light: new BoxGeometry(0.42, 0.36, 0.42).translate(0, 1.32, 0) };
}

/** The parts of a shed: its walls, roof, door, and rakes painted into one, and its lit windows and lamp. */
function shedGeometries() {
  const roof = new CylinderGeometry(0.01, 1.85, 1.2, 4, 1)
    .rotateY(Math.PI / 4)
    .scale(1, 1, 0.85)
    .translate(0, 2.25, 0);
  const rakes = [0, 1, 2].map((k) =>
    painted(
      new CylinderGeometry(0.03, 0.03, 1.6, 5)
        .rotateZ(0.25 - k * 0.1)
        .translate(-0.9 + k * 0.25, 0.75, 1.15),
      "#a8754e",
    ),
  );
  const body = mergeGeometries([
    painted(new BoxGeometry(2.4, 1.7, 2.0).translate(0, 0.85, 0), "#a8754e"),
    painted(roof, "#c4564a"),
    painted(new BoxGeometry(0.7, 1.15, 0.05).translate(0, 0.58, 1.01), "#5a3a2a"),
    ...rakes,
  ]);
  const light = mergeGeometries([
    new PlaneGeometry(0.5, 0.4)
      .rotateY(-Math.PI / 2)
      .translate(-1.21, 1.05, 0)
      .toNonIndexed(),
    new PlaneGeometry(0.5, 0.4)
      .rotateY(Math.PI / 2)
      .translate(1.21, 1.05, 0)
      .toNonIndexed(),
    new SphereGeometry(0.12, 10, 8).translate(0.6, 1.45, 1.15).toNonIndexed(),
  ]);
  if (body === null || light === null) throw new Error("tree: the shed's parts would not merge");
  return { body, light };
}

/** The tooling zones' places, as they stand: drawn by `place`, lit by `paint`. */
export interface Meadow {
  /** Stands each tooling zone of `skeleton` on the meadow, and lays the stepping stones to it. */
  readonly place: (skeleton: Skeleton) => void;
  /** Tints each place by its zone's highlight and blast reach. */
  readonly paint: (tintOf: (path: string) => Color | undefined) => void;
  /** Steps the waterfall's mist and the shards below `t` seconds in. */
  readonly drift: (t: number) => void;
}

export function island(
  scene: Scene,
  shared: SharedUniforms,
  fogColor: Color,
  picking: WorldPicking,
  glow: { readonly add: GlowField; readonly over: GlowField },
): Meadow {
  const mist = glow.over;
  const random = randomOf(20261017);
  const group = new Group();
  const meadow = new Mesh(meadowGeometry(), meadowMaterial(shared));
  meadow.receiveShadow = true;
  const earth = earthGeometry();
  const inside = new Mesh(earth, earthMaterial(shared, fogColor, true));
  const outside = new Mesh(earth, earthMaterial(shared, fogColor, false));
  // Note that the meadow's underside is the earth's ceiling, seen through the cut.
  const ceiling = new Mesh(
    meadow.geometry,
    new MeshBasicMaterial({ color: "#2a1712", side: BackSide }),
  );
  ceiling.position.y = -0.9;
  group.add(meadow, inside, outside, ceiling);

  const grass = new InstancedMesh(bladeGeometry(), grassMaterial(shared), GRASS_COUNT);
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const scale = new Vector3();
  const euler = new Euler();
  const p = new Vector3();
  const c = new Color();
  const gc1 = new Color("#8fc25c");
  const gc2 = new Color("#d3dc7a");
  const gc3 = new Color("#5d9a54");
  for (let placed = 0; placed < GRASS_COUNT; ) {
    const th = random() * Math.PI * 2;
    const rho = Math.sqrt(random()) * edgeRadius(th) * 0.97;
    if (rho < 3.4) continue;
    const x = Math.cos(th) * rho;
    const z = Math.sin(th) * rho;
    turn.setFromEuler(
      euler.set(between(random, -0.25, 0.25), random() * Math.PI, between(random, -0.25, 0.25)),
    );
    const height = between(random, 0.35, 0.95) * (0.7 + 0.6 * fractalNoise(x * 0.2, 1, z * 0.2));
    matrix.compose(p.set(x, groundY(x, z) - 0.03, z), turn, scale.set(1, height, 1));
    grass.setMatrixAt(placed, matrix);
    const n = fractalNoise(x * 0.15, 3, z * 0.15);
    grass.setColorAt(
      placed,
      c
        .copy(gc3)
        .lerp(gc1, smooth(0.25, 0.55, n))
        .lerp(gc2, smooth(0.6, 0.9, n) * 0.7 + random() * 0.15),
    );
    placed += 1;
  }
  grass.receiveShadow = true;

  const flowers = new InstancedMesh(
    new IcosahedronGeometry(0.08, 0),
    new MeshLambertMaterial(),
    FLOWER_COUNT,
  );
  const petals = ["#fff6e8", "#f4f0d0", "#ffe9a8", "#ffffff"].map((hex) => new Color(hex));
  for (let index = 0; index < FLOWER_COUNT; index += 1) {
    const th = random() * Math.PI * 2;
    const rho = 4 + Math.sqrt(random()) * (edgeRadius(th) * 0.95 - 4);
    const x = Math.cos(th) * rho;
    const z = Math.sin(th) * rho;
    matrix.compose(
      p.set(x, groundY(x, z) + between(random, 0.25, 0.55), z),
      turn.identity(),
      scale.setScalar(between(random, 0.7, 1.3)),
    );
    flowers.setMatrixAt(index, matrix);
    flowers.setColorAt(index, item(petals, index % 4));
  }

  const rockGeometry = mergeVertices(new DodecahedronGeometry(1, 1));
  {
    const position = rockGeometry.getAttribute("position");
    for (let index = 0; index < position.count; index += 1) {
      p.fromBufferAttribute(position, index);
      p.multiplyScalar(0.8 + 0.4 * valueNoise(p.x * 2 + 5, p.y * 2, p.z * 2));
      position.setXYZ(index, p.x, p.y, p.z);
    }
    rockGeometry.computeVertexNormals();
  }
  const rocks = new InstancedMesh(
    rockGeometry,
    new MeshStandardMaterial({ color: "#b5aca2", roughness: 0.9, flatShading: true }),
    ROCK_COUNT,
  );
  for (let index = 0; index < ROCK_COUNT; index += 1) {
    const th = random() * Math.PI * 2;
    const rho = between(random, 6, edgeRadius(th) * 0.92);
    const x = Math.cos(th) * rho;
    const z = Math.sin(th) * rho;
    const s = between(random, 0.25, 0.8);
    matrix.compose(
      p.set(x, groundY(x, z) + s * 0.2, z),
      turn.setFromEuler(euler.set(random() * 3, random() * 3, random() * 3)),
      scale.set(s, s * 0.7, s),
    );
    rocks.setMatrixAt(index, matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const shards = new InstancedMesh(
    rockGeometry,
    new MeshStandardMaterial({ color: "#7d6488", roughness: 0.85, flatShading: true }),
    SHARD_COUNT,
  );
  const shardBase = Array.from({ length: SHARD_COUNT }, () => {
    const th = random() * Math.PI * 2;
    const y = between(random, -26, -6);
    const rho = (1 - -y / (ISLAND_DEPTH + 6)) * ISLAND_RADIUS * 0.9 + between(random, 5, 12);
    return {
      p: new Vector3(Math.cos(th) * rho, y, Math.sin(th) * rho),
      s: between(random, 0.3, 0.8),
      phase: random() * 6,
      rot: new Euler(random() * 3, random() * 3, random() * 3),
    };
  });

  const vines = mergeGeometries(
    Array.from({ length: 30 }, () => {
      const th = random() * Math.PI * 2;
      const rim = edgeRadius(th) * 0.99;
      const length = between(random, 1, 3.6);
      const points = Array.from({ length: 6 }, (_, k) => {
        const f = k / 5;
        const rho = rim + Math.sin(f * Math.PI) * 0.4 - f * f * 1.2;
        return new Vector3(Math.cos(th) * rho, -0.2 - f * length, Math.sin(th) * rho);
      });
      return new TubeGeometry(new CatmullRomCurve3(points), 10, 0.08, 5);
    }),
  );
  if (vines !== null)
    group.add(
      new Mesh(
        vines,
        new MeshLambertMaterial({ color: "#6fa858", emissive: new Color("#1c3a18") }),
      ),
    );
  group.add(grass, flowers, rocks);
  scene.add(group, shards);

  // The stream runs out from beside the trunk and falls off the rim.
  const lip = edgeRadius(STREAM_ANGLE);
  const stream = Array.from({ length: 41 }, (_, k) => {
    const f = k / 40;
    const rho = 11 + (lip - 11) * f;
    const a = STREAM_ANGLE + Math.sin(f * 7) * 0.05 * (1 - f);
    const x = Math.cos(a) * rho;
    const z = Math.sin(a) * rho;
    return new Vector3(x, Math.max(groundY(x, z), -0.25) + 0.07, z);
  });
  const fall = Array.from({ length: 61 }, (_, k) => {
    const f = k / 60;
    const rho = lip + 0.15 + 2.2 * Math.sqrt(f);
    return new Vector3(
      Math.cos(STREAM_ANGLE) * rho,
      -0.2 - 52 * f ** 1.15,
      Math.sin(STREAM_ANGLE) * rho,
    );
  });
  const pool = new CircleGeometry(1.5, 24)
    .rotateX(-Math.PI / 2)
    .translate(item(stream, 0).x - 0.6, item(stream, 0).y + 0.01, item(stream, 0).z);
  pool.deleteAttribute("normal");
  const streamGeometry = mergeGeometries([ribbon(stream, (f) => 0.9 + 0.5 * f), pool]);
  const waters = [
    new Mesh(streamGeometry ?? ribbon(stream, () => 1), waterMaterial(shared, false)),
    new Mesh(
      ribbon(fall, (f) => 1.5 + 3.5 * f),
      waterMaterial(shared, true),
    ),
  ];
  for (const water of waters) water.renderOrder = 4;
  scene.add(...waters);
  const mistFirst = mist.reserve(MIST_COUNT);
  const mistParts = Array.from({ length: MIST_COUNT }, (_, index) => ({
    k: index < 16 ? between(random, 0, 0.06) : between(random, 0.08, 0.7),
    phase: random() * 6,
    size: between(random, 1.2, 3.2),
  }));

  // The places: sheds and lanterns for the tooling zones, and the rim's own lanterns.
  const shedParts = shedGeometries();
  const lanternParts = lanternGeometries();
  const maxPlaces = FACTORY_WORLD_BOUNDS.MAX_ZONES;
  const sheds = new InstancedMesh(
    shedParts.body,
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
    maxPlaces,
  );
  const shedLights = new InstancedMesh(
    shedParts.light,
    new MeshBasicMaterial({ color: new Color(3.2, 2.0, 0.9) }),
    maxPlaces,
  );
  const lanterns = new InstancedMesh(
    lanternParts.stone,
    new MeshStandardMaterial({ color: "#b9adb4", roughness: 0.9 }),
    maxPlaces + RIM_LANTERNS,
  );
  const lanternLights = new InstancedMesh(
    lanternParts.light,
    new MeshBasicMaterial({ color: new Color(1.5, 1.45, 1.35) }),
    maxPlaces + RIM_LANTERNS,
  );
  const stones = new InstancedMesh(
    new CylinderGeometry(0.42, 0.48, 0.12, 9),
    new MeshStandardMaterial({ color: "#cbbfae", roughness: 0.95 }),
    maxPlaces * STONES_PER_PATH,
  );
  for (const mesh of [sheds, lanterns]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  stones.receiveShadow = true;
  scene.add(sheds, shedLights, lanterns, lanternLights, stones);
  let shedTargets: PickTarget[] = [];
  let lanternTargets: (PickTarget | undefined)[] = [];
  picking.addInstances(sheds, (instanceId) => shedTargets[instanceId]);
  picking.addInstances(lanterns, (instanceId) => lanternTargets[instanceId]);
  const white = new Color(1, 1, 1);
  // Note that every lit window and lantern carries a soft glow, the light the mockup's bloom gave them.
  const lanternGlowFirst = glow.add.reserve(maxPlaces + RIM_LANTERNS);
  const shedGlowFirst = glow.add.reserve(maxPlaces);
  const lit = new Vector3();

  const placeAt = (mesh: InstancedMesh, index: number, at: Vector3, size: number) => {
    matrix.lookAt(at, new Vector3(0, at.y, 0), new Vector3(0, 1, 0));
    turn.setFromRotationMatrix(matrix);
    matrix.compose(at, turn, scale.setScalar(size));
    mesh.setMatrixAt(index, matrix);
  };

  const standLantern = (index: number, at: Vector3, size: number) => {
    placeAt(lanterns, index, at, size);
    placeAt(lanternLights, index, at, size);
    glow.add.set(
      lanternGlowFirst + index,
      at.x,
      at.y + 1.32 * size,
      at.z,
      3.4 * size,
      1.2,
      1.12,
      0.95,
      0.6,
    );
  };

  return {
    place: (skeleton) => {
      const grounds = [...skeleton.sites.values()].filter(
        (site) => site.branch.kind === BRANCH_KIND.GROUND,
      );
      const largest = Math.max(0, ...grounds.map((site) => site.zone.footprint));
      const asShed = grounds.filter(
        (site) => site.zone.footprint >= SHED_FOOTPRINT || site.zone.footprint === largest,
      );
      const asLantern = grounds.filter((site) => !asShed.includes(site));
      shedTargets = asShed.map((site) => ({ kind: PICK_KIND.ZONE, id: site.zone.path }));
      asShed.forEach((site, index) => {
        const at = site.center.clone();
        at.y = groundY(at.x, at.z) - 0.05;
        const size = 0.75 + 0.6 * site.zone.footprint;
        placeAt(sheds, index, at, size);
        placeAt(shedLights, index, at, size);
        lit.set(0.6, 1.45, 1.15).applyMatrix4(matrix);
        glow.add.set(shedGlowFirst + index, lit.x, lit.y, lit.z, 2.8 * size, 1.4, 0.9, 0.4, 0.6);
      });
      glow.add.clear(shedGlowFirst + asShed.length, maxPlaces - asShed.length);
      sheds.count = asShed.length;
      shedLights.count = asShed.length;
      lanternTargets = [
        ...asLantern.map((site) => ({ kind: PICK_KIND.ZONE, id: site.zone.path })),
        ...Array.from({ length: RIM_LANTERNS }, () => undefined),
      ];
      asLantern.forEach((site, index) => {
        const at = site.center.clone();
        at.y = groundY(at.x, at.z) - 0.05;
        const size = 0.9 + 0.8 * site.zone.footprint;
        standLantern(index, at, size);
      });
      for (let k = 0; k < RIM_LANTERNS; k += 1) {
        const th = -0.55 + (k / RIM_LANTERNS) * Math.PI * 2;
        const at = meadowPoint(Math.min(21.6, edgeRadius(th) - 1.6), th, -0.05);
        standLantern(asLantern.length + k, at, 1);
      }
      glow.add.clear(
        lanternGlowFirst + asLantern.length + RIM_LANTERNS,
        maxPlaces - asLantern.length,
      );
      lanterns.count = asLantern.length + RIM_LANTERNS;
      lanternLights.count = lanterns.count;
      let stoneCount = 0;
      for (const site of grounds) {
        const stoneRandom = randomOf(site.slot * 97 + 13);
        for (let t = 0.06; t < 0.97 && stoneCount < stones.instanceMatrix.count; t += 0.07) {
          const at = branchPoint(site.branch, t).p;
          matrix.compose(
            p
              .copy(at)
              .add(
                scale.set(between(stoneRandom, -0.2, 0.2), 0.02, between(stoneRandom, -0.2, 0.2)),
              ),
            turn.setFromEuler(euler.set(0, stoneRandom() * 3, 0)),
            scale.set(between(stoneRandom, 0.8, 1.15), 1, between(stoneRandom, 0.75, 1)),
          );
          stones.setMatrixAt(stoneCount, matrix);
          stoneCount += 1;
        }
      }
      stones.count = stoneCount;
      for (const mesh of [sheds, shedLights, lanterns, lanternLights, stones]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
    paint: (tintOf) => {
      shedTargets.forEach((target, index) => {
        sheds.setColorAt(index, tintOf(target.id) ?? white);
      });
      lanternTargets.forEach((target, index) => {
        lanterns.setColorAt(index, (target === undefined ? undefined : tintOf(target.id)) ?? white);
      });
      for (const mesh of [sheds, lanterns]) {
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
    },
    drift: (t) => {
      shardBase.forEach((shard, index) => {
        p.copy(shard.p);
        p.y += Math.sin(t * 0.5 + shard.phase) * 0.6;
        matrix.compose(
          p,
          turn.setFromEuler(euler.set(shard.rot.x + t * 0.05, shard.rot.y + t * 0.07, shard.rot.z)),
          scale.setScalar(shard.s),
        );
        shards.setMatrixAt(index, matrix);
      });
      shards.instanceMatrix.needsUpdate = true;
      mistParts.forEach((part, index) => {
        const f = (part.k + t * 0.01 * (1 + (index % 3))) % 1;
        const at = item(fall, Math.floor(f * fall.length));
        mist.set(
          mistFirst + index,
          at.x + Math.sin(t * 0.7 + part.phase) * 1.2,
          at.y + Math.sin(t + part.phase) * 0.5,
          at.z + Math.cos(t * 0.6 + part.phase) * 1.2,
          part.size * (1 + f * 2.5),
          0.95,
          0.97,
          1,
          0.22 * (1 - f),
          GLOW_SHAPE.DOT,
        );
      });
    },
  };
}
