import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  FloatType,
  FrontSide,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SphereGeometry,
  Vector3,
  type Vector4,
} from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import {
  between,
  GLSL_NOISE,
  type Random,
  randomOf,
  seedOf,
  smooth,
  UP,
  valueNoise,
} from "./nature";
import {
  BRANCH_KIND,
  type Branch,
  branchPoint,
  HEART_HEIGHT,
  item,
  type Sample,
  type Skeleton,
  sampleCurve,
  spanOf,
} from "./skeleton";

/**
 * wood.ts -- the World Tree's bark and canopy: the zone texture every shader reads a zone's signals from, the bark and leaf materials, the wood and foliage grown from a skeleton, and the unseen shapes a zone is picked by.
 *
 * Each zone owns one texel of `ZONE_SLOTS` (its slot), and every vertex and
 * leaf of the zone carries that slot, so a hover, a selection, the blast
 * radius rippling outward, and a zone's shipped glow are a texel written,
 * never a mesh rebuilt. The wood itself is rebuilt only when the zones
 * change, which a refresh that adds or moves a zone does and a scrub, a
 * hover, or a selection never does.
 */

/** One texel per zone, and the heartwood's last. */
const ZONE_SLOTS = 256;
export const HEART_SLOT = ZONE_SLOTS - 1;

/** The most defect wounds a shader rots the wood around. */
export const MAX_WOUNDS = 12;

/** The most leaf clumps the canopy holds; a repository of more zones thins each zone's. */
const MAX_CLUMPS = 1600;

/** Leaf cards scattered over each clump's surface. */
const CARDS_PER_CLUMP = 30;

/** The most invisible segments a branch is picked by. */
const MAX_PICK_SEGMENTS = 3072;

const BARK_DARK = new Color("#4a3229");
const BARK_LIGHT = new Color("#9a7458");
const MOSS = new Color("#6f9a4c");
const ROOT_TINT = new Color("#7a5440");
const LEAF_BASE = new Color("#4fae5c");
const LEAF_TEAL = new Color("#2f9d84");
const LEAF_GOLD = new Color("#a9d45a");
const LEAF_DOMAIN = new Color("#2f8a68");

/** The uniforms every material of the tree shares, one object per value. */
export interface SharedUniforms {
  readonly uTime: { value: number };
  readonly uZones: { value: DataTexture };
  readonly uBlastT: { value: number };
  readonly uWound: { value: Vector4[] };
  readonly uWoundN: { value: number };
  readonly uDefects: { value: number };
  readonly uSunDir: { value: Vector3 };
  readonly uBlastColor: { value: Color };
  readonly uSelectColor: { value: Color };
  readonly uShipColor: { value: Color };
  readonly uDefectColor: { value: Color };
  readonly uNight: { value: number };
}

/** The zone texture: blast reach, blast delay in seconds, shipped glow, highlight, per slot. */
export function zoneTexture(): DataTexture {
  const texture = new DataTexture(
    new Float32Array(ZONE_SLOTS * 4),
    ZONE_SLOTS,
    1,
    RGBAFormat,
    FloatType,
  );
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** GLSL: a slot's zone texel. */
const GLSL_ZONE = /* glsl */ `
  uniform sampler2D uZones;
  vec4 zoneState(float slot){ return texelFetch(uZones, ivec2(int(slot + 0.5), 0), 0); }
`;

/** GLSL: how rotten a world point is, from the nearest defect wound. */
const GLSL_WOUNDS = /* glsl */ `
  uniform vec4 uWound[${MAX_WOUNDS}]; uniform int uWoundN; uniform float uDefects;
  float rotAt(vec3 p, float spread, float near, float far){
    float r = 0.0;
    for (int i = 0; i < ${MAX_WOUNDS}; i++){ if (i >= uWoundN) break; vec4 c = uWound[i];
      float d = length(p - c.xyz) + (vn3(p * spread) - 0.5) * c.w * (far - near) * 0.6;
      r = max(r, 1.0 - smoothstep(c.w * near, c.w * far, d)); }
    return r * uDefects; }
`;

/* ------------------------------------------------------------------ materials */

/** The bark: ridged, mossy on top, veined with sap at the roots, rotting round a wound, and lit by its zone's texel. */
function barkMaterial(shared: SharedUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aZone; attribute float aAlong; attribute float aLen;
        varying float vZone; varying float vAlong; varying float vLen; varying vec3 vWP; varying vec2 vBUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vZone = aZone; vAlong = aAlong; vLen = aLen; vBUv = uv;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        ${GLSL_NOISE}
        ${GLSL_ZONE}
        ${GLSL_WOUNDS}
        uniform float uTime; uniform float uBlastT; uniform float uNight;
        uniform vec3 uBlastColor; uniform vec3 uSelectColor; uniform vec3 uDefectColor;
        varying float vZone; varying float vAlong; varying float vLen; varying vec3 vWP; varying vec2 vBUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float rot = rotAt(vWP, 1.7, 0.35, 2.3);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.025, 0.05), rot * 0.94);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        vec4 zs = zoneState(vZone);
        float stripes = abs(fract(vBUv.x * 5.0 + vLen * 0.035) - 0.5) * 2.0;
        float vein = 1.0 - smoothstep(0.0, 0.07, stripes);
        float flow = pow(fract(vLen * 0.11 - uTime * 0.32 + vBUv.x * 0.2), 7.0);
        totalEmissiveRadiance += vec3(1.0, 0.9, 0.75) * vein * (0.05 + 0.5 * flow) * (vLen < 0.0 ? 1.0 + uNight : 0.0) * (1.0 - rot);
        if (zs.r > 0.0) {
          float tt = uBlastT - zs.g;
          float arrive = smoothstep(0.0, 0.45, tt);
          float band = exp(-pow((vAlong - fract(tt * 0.45)) * 7.0, 2.0));
          totalEmissiveRadiance += uBlastColor * arrive * zs.r * (0.1 + 0.55 * band);
        }
        totalEmissiveRadiance += uSelectColor * zs.a * (0.3 + 0.08 * sin(uTime * 6.0));
        float n = vn3(vWP * 3.2 + vec3(0.0, uTime * 0.05, 0.0));
        float crack = 1.0 - smoothstep(0.0, 0.05, abs(n - 0.5));
        totalEmissiveRadiance += uDefectColor * crack * rot * (1.0 + 0.7 * sin(uTime * 2.6 + n * 9.0)) * 2.4;`,
      );
  };
  material.customProgramCacheKey = () => "tree-bark";
  return material;
}

/** A leaf material: a clump's soft body, or (with `cards`) the leaf-shaped cards over it; both blight round a wound and light by their zone's texel. */
function foliageMaterial(shared: SharedUniforms, cards: boolean): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ side: cards ? DoubleSide : FrontSide });
  if (cards) material.defines = { USE_UV: "" };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aZone; attribute float aSeed;
        uniform float uTime;
        varying float vZone; varying vec3 vWP; varying float vSeed; varying vec3 vWN;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        transformed += vec3(sin(uTime * 1.1 + ip.x * 0.3 + aSeed * 6.0), sin(uTime * 1.7 + aSeed * 9.0) * 0.4, cos(uTime * 0.9 + ip.z * 0.3)) * ${cards ? "0.09" : "0.035"};
        vZone = aZone; vSeed = aSeed;
        vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        ${GLSL_NOISE}
        ${GLSL_ZONE}
        ${GLSL_WOUNDS}
        uniform float uTime; uniform float uBlastT; uniform vec3 uSunDir;
        uniform vec3 uBlastColor; uniform vec3 uSelectColor; uniform vec3 uShipColor;
        varying float vZone; varying vec3 vWP; varying float vSeed; varying vec3 vWN;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        ${
          cards
            ? `vec2 lp = vUv - vec2(0.5);
        float halfW = 0.42 * pow(max(sin((vUv.y * 0.92 + 0.04) * 3.14159), 0.0), 0.85);
        if (abs(lp.x) > halfW) discard;
        diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 0.025, abs(lp.x)));`
            : ""
        }
        float blight = rotAt(vWP, 0.9, 0.9, 2.7);
        ${cards ? "if (blight > 0.25 && h31(floor(vWP * 3.0)) < blight * 0.7) discard;" : ""}
        diffuseColor.rgb = mix(diffuseColor.rgb, srgb(vec3(0.36, 0.27, 0.24)), blight * 0.88);
        diffuseColor.rgb *= 0.86 + 0.28 * vn3(vWP * 1.3 + vSeed * 10.0);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        vec4 zs = zoneState(vZone);
        vec3 Vd = normalize(cameraPosition - vWP);
        float rimL = pow(1.0 - max(dot(normalize(vWN), Vd), 0.0), 3.0);
        float rimS = pow(1.0 - abs(dot(normalize(vWN), Vd)), 3.0);
        float sunSide = max(dot(normalize(vWN), uSunDir), 0.0);
        totalEmissiveRadiance += diffuseColor.rgb * (rimL * (0.3 + 0.7 * sunSide) + 0.05);
        totalEmissiveRadiance *= 1.0 - blight * 0.7;
        totalEmissiveRadiance += uShipColor * zs.b * rimS * 0.6;
        if (zs.r > 0.0) {
          float arrive = smoothstep(0.0, 0.6, uBlastT - zs.g);
          totalEmissiveRadiance += uBlastColor * arrive * zs.r * rimS * (0.55 + 0.25 * sin(uTime * 3.0 - vWP.y * 0.4));
        }
        totalEmissiveRadiance += zs.a * (uSelectColor * 0.06 + uSelectColor * rimS * 0.6);`,
      );
  };
  material.customProgramCacheKey = () => (cards ? "tree-leaf-card" : "tree-leaf-clump");
  return material;
}

/** The lumpy sphere every leaf clump is an instance of. */
export function clumpGeometry(): BufferGeometry {
  const geometry = mergeVertices(new IcosahedronGeometry(1, 3));
  const position = geometry.getAttribute("position");
  const p = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    p.fromBufferAttribute(position, index);
    p.multiplyScalar(0.82 + 0.32 * valueNoise(p.x * 1.8 + 4, p.y * 1.8, p.z * 1.8));
    p.y *= 0.85;
    position.setXYZ(index, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/* ------------------------------------------------------------------ bark */

/** The bark's vertex streams, appended tube by tube. */
class BarkBuilder {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly color: number[] = [];
  readonly uv: number[] = [];
  readonly zone: number[] = [];
  readonly along: number[] = [];
  readonly len: number[] = [];
  readonly index: number[] = [];

  get count(): number {
    return this.position.length / 3;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(this.position, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute("color", new Float32BufferAttribute(this.color, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    geometry.setAttribute("aZone", new Float32BufferAttribute(this.zone, 1));
    geometry.setAttribute("aAlong", new Float32BufferAttribute(this.along, 1));
    geometry.setAttribute("aLen", new Float32BufferAttribute(this.len, 1));
    geometry.setIndex(this.index);
    return geometry;
  }
}

interface TubeOptions {
  readonly radial: number;
  readonly slot: number;
  readonly random: Random;
  readonly lenSign?: number;
  readonly tint?: Color;
  readonly moss?: number;
  readonly lobe?: (t: number, angle: number) => number;
  readonly ao?: (t: number, p: Vector3) => number;
  readonly alongOf?: (t: number) => number;
}

/** A ridged tube along `samples`, coloured bark-dark to bark-light with moss on top. */
function tube(builder: BarkBuilder, samples: readonly Sample[], options: TubeOptions): void {
  const { radial, random } = options;
  const first = builder.count;
  const n = new Vector3();
  const p = new Vector3();
  const c = new Color();
  for (const s of samples) {
    for (let j = 0; j <= radial; j += 1) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(s.n).multiplyScalar(Math.cos(a)).addScaledVector(s.b, Math.sin(a));
      const ridge = 0.5 + 0.5 * Math.sin(a * 7 + s.len * 0.9) * Math.sin(a * 3 - s.len * 0.4 + 1.3);
      let r =
        s.r * (1 + 0.075 * Math.sin(a * 7 + s.len * 0.9) + 0.04 * Math.sin(a * 13 - s.len * 1.7));
      if (options.lobe !== undefined) r *= options.lobe(s.t, a);
      p.copy(s.p).addScaledVector(n, r);
      c.copy(BARK_DARK).lerp(BARK_LIGHT, ridge * 0.85 + random() * 0.1);
      if (options.tint !== undefined) c.lerp(options.tint, 0.3);
      const moss =
        smooth(0.35, 0.85, n.y) *
        (options.moss ?? 0.45) *
        (0.6 + 0.4 * valueNoise(p.x * 0.6, p.y * 0.6, p.z * 0.6));
      c.lerp(MOSS, moss);
      c.multiplyScalar(options.ao === undefined ? 1 : options.ao(s.t, p));
      builder.position.push(p.x, p.y, p.z);
      builder.normal.push(n.x, n.y, n.z);
      builder.color.push(c.r, c.g, c.b);
      builder.uv.push(j / radial, s.len);
      builder.zone.push(options.slot);
      builder.along.push(options.alongOf === undefined ? s.t : options.alongOf(s.t));
      builder.len.push((options.lenSign ?? 1) * s.len);
    }
  }
  for (let i = 0; i < samples.length - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = first + i * (radial + 1) + j;
      const b = a + radial + 1;
      builder.index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

/** Samples along `branch`, each pushed off its centre by `offset`. */
function offsetSamples(
  branch: Branch,
  count: number,
  offset: (t: number, at: Sample) => { x: number; y: number },
  radius: (t: number) => number,
): Sample[] {
  const points: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    const at = branchPoint(branch, t);
    const o = offset(t, at);
    points.push(at.p.clone().addScaledVector(at.n, o.x).addScaledVector(at.b, o.y));
  }
  return sampleCurve(new CatmullRomCurve3(points, false, "centripetal"), count, radius);
}

/** Where a twig ends on a branch: a small clump grows there. */
interface TwigTip {
  readonly slot: number;
  readonly p: Vector3;
  readonly t: number;
}

/** The whole of the tree's bark, grown from `skeleton`, and the twig tips the canopy fills. */
function growBark(skeleton: Skeleton) {
  const builder = new BarkBuilder();
  const twigs: TwigTip[] = [];
  const heartRandom = randomOf(17);
  const heartCurve = skeleton.heart.curve;
  if (heartCurve !== undefined) {
    const core = new CatmullRomCurve3([
      new Vector3(0, -1.2, 0),
      new Vector3(0.1, 5, 0.05),
      new Vector3(-0.05, 12, 0.1),
      new Vector3(0, HEART_HEIGHT, 0),
    ]);
    tube(
      builder,
      sampleCurve(core, 40, (t) => 1.18 - 0.72 * smooth(0.5, 1, t)),
      {
        radial: 22,
        slot: HEART_SLOT,
        random: heartRandom,
        moss: 0.25,
        ao: (t) => 0.75 + 0.25 * t,
      },
    );
    const flare = new CatmullRomCurve3([
      new Vector3(0, -1.4, 0),
      new Vector3(0, 0.2, 0),
      new Vector3(0, 2.4, 0),
      new Vector3(0, 4.6, 0),
    ]);
    tube(
      builder,
      sampleCurve(flare, 28, (t) => 3.6 - 2.3 * smooth(0, 0.75, t)),
      {
        radial: 40,
        slot: HEART_SLOT,
        random: heartRandom,
        moss: 0.6,
        lobe: (t, a) =>
          1 + (0.32 * (0.5 + 0.5 * Math.sin(a * 6 + 0.7)) ** 2 - 0.1) * (1 - smooth(0, 0.85, t)),
        ao: (t) => 0.62 + 0.38 * smooth(0, 0.6, t),
      },
    );
  }
  for (const site of skeleton.sites.values()) {
    const branch = site.branch;
    const random = randomOf(seedOf(site.zone.path, 4));
    if (branch.kind === BRANCH_KIND.GROUND) continue;
    if (branch.kind === BRANCH_KIND.ROOT) {
      // Note that a root is a bundle of twisted strands, with thinner rootlets wandering off it.
      const strands = site.weight > 0.45 ? 3 : 2;
      const count = Math.max(40, Math.round(branch.len * 3));
      for (let k = 0; k < strands; k += 1) {
        const phase = (k / strands) * Math.PI * 2;
        const samples = offsetSamples(
          branch,
          count,
          (t, at) => {
            const a = phase + t * branch.len * 0.55;
            return { x: Math.cos(a) * at.r * 0.48, y: Math.sin(a) * at.r * 0.48 };
          },
          (t) => branch.radius(t) * (strands === 3 ? 0.6 : 0.68),
        );
        tube(builder, samples, {
          radial: 9,
          slot: site.slot,
          random,
          lenSign: -1,
          tint: ROOT_TINT,
          moss: 0.05,
        });
      }
      const rootlets = 3 + Math.round(site.weight * 5);
      for (let k = 0; k < rootlets; k += 1) {
        const t0 = between(random, 0.18, 0.8);
        const at = branchPoint(branch, t0);
        const out = new Vector3(at.p.x, 0, at.p.z)
          .normalize()
          .applyAxisAngle(UP, between(random, -1.2, 1.2));
        const length = between(random, 2.5, 6) * (0.6 + site.weight);
        const points = [at.p.clone()];
        for (let q = 1; q <= 4; q += 1) {
          points.push(
            at.p
              .clone()
              .addScaledVector(out, (length * q) / 4)
              .add(
                new Vector3(
                  between(random, -0.4, 0.4),
                  ((-length * q) / 4) * between(random, 0.4, 1.1),
                  between(random, -0.4, 0.4),
                ),
              ),
          );
        }
        const thin = at.r * 0.32;
        tube(
          builder,
          sampleCurve(new CatmullRomCurve3(points), 14, (t) => thin * (1 - 0.85 * t)),
          {
            radial: 6,
            slot: site.slot,
            random,
            lenSign: -1,
            tint: ROOT_TINT,
            moss: 0,
            alongOf: () => t0,
          },
        );
      }
      continue;
    }
    const curve = branch.curve;
    if (curve === undefined) continue;
    const samples = sampleCurve(curve, Math.max(24, Math.round(branch.len * 2.6)), branch.radius);
    const r0 = branch.radius(0);
    tube(builder, samples, {
      radial: r0 > 0.6 ? 16 : r0 > 0.3 ? 12 : 9,
      slot: site.slot,
      random,
      moss: 0.5,
      ao: (_t, p) => 0.72 + 0.28 * smooth(0, 14, p.y),
    });
    // Note that short side shoots keep a limb from reading as a pipe.
    const shoots = Math.round(branch.len / 3.5);
    for (let k = 0; k < shoots; k += 1) {
      const t0 = between(random, Math.max(branch.tPeel, 0.25), 0.9);
      const at = branchPoint(branch, t0);
      const side = new Vector3()
        .crossVectors(at.tan, UP)
        .normalize()
        .multiplyScalar(random() < 0.5 ? -1 : 1);
      const dir = side
        .add(UP.clone().multiplyScalar(0.8))
        .add(at.tan.clone().multiplyScalar(0.5))
        .normalize();
      const length = between(random, 1.2, 2.6);
      const twig = new CatmullRomCurve3([
        at.p.clone(),
        at.p
          .clone()
          .addScaledVector(dir, length * 0.5)
          .add(new Vector3(0, 0.2, 0)),
        at.p
          .clone()
          .addScaledVector(dir, length)
          .add(new Vector3(0, 0.5, 0)),
      ]);
      const thin = Math.min(at.r * 0.45, 0.16);
      tube(
        builder,
        sampleCurve(twig, 8, (t) => thin * (1 - 0.8 * t)),
        {
          radial: 6,
          slot: site.slot,
          random,
          moss: 0.3,
          alongOf: () => t0,
        },
      );
      twigs.push({ slot: site.slot, p: twig.getPoint(1), t: t0 });
    }
  }
  return { geometry: builder.build(), twigs };
}

/* ------------------------------------------------------------------ canopy */

/** One clump of leaves: where, how large, whose, and in what green. */
export interface Clump {
  readonly c: Vector3;
  readonly r: number;
  readonly slot: number;
  readonly color: Color;
}

/** The canopy's clumps: each zone's along the outer part of its branch and at its twig tips, thinned to `MAX_CLUMPS`. */
function growCanopy(skeleton: Skeleton, twigs: readonly TwigTip[]): Clump[] {
  const leafy = [...skeleton.sites.values()].filter(
    (site) => site.branch.kind !== BRANCH_KIND.ROOT && site.branch.kind !== BRANCH_KIND.GROUND,
  );
  const wanted = (span: number, hasKids: boolean) =>
    Math.round((3 + span / 13) * (hasKids ? 0.4 : 1));
  const total =
    leafy.reduce((sum, site) => sum + wanted(spanOf(site.zone), site.hasKids), 0) + twigs.length;
  const thinning = Math.min(1, (MAX_CLUMPS * 0.92) / Math.max(1, total));
  const clumps: Clump[] = [];
  for (const site of leafy) {
    const branch = site.branch;
    const random = randomOf(seedOf(site.zone.path, 5));
    const span = spanOf(site.zone);
    const count = Math.max(1, Math.round(wanted(span, site.hasKids) * thinning));
    const h = (seedOf(site.zone.path) % 1000) / 1000;
    const green =
      site.zone.layer === ZONE_LAYER.DOMAIN
        ? LEAF_DOMAIN.clone()
        : LEAF_BASE.clone().lerp(h < 0.5 ? LEAF_TEAL : LEAF_GOLD, Math.abs(h - 0.5) * 1.6);
    const r0 = 1.15 + span / 80;
    const t0 = site.hasKids ? 0.88 : Math.max(branch.tPeel + (1 - branch.tPeel) * 0.6, 0.62);
    for (let index = 0; index < count; index += 1) {
      const t = index === 0 ? 1 : 1 - (1 - t0) * random() ** 1.4;
      const at = branchPoint(branch, t);
      const r = r0 * between(random, 0.6, 1.1) * (0.75 + 0.25 * t);
      const off = new Vector3(
        between(random, -1, 1),
        between(random, -0.2, 1),
        between(random, -1, 1),
      )
        .normalize()
        .multiplyScalar(r * between(random, 0.2, 0.65));
      off.y += r * 0.3;
      clumps.push({
        c: at.p.clone().add(off),
        r,
        slot: site.slot,
        color: green
          .clone()
          .offsetHSL(
            between(random, -0.02, 0.02),
            between(random, -0.05, 0.05),
            between(random, -0.05, 0.06),
          ),
      });
    }
    for (const twig of twigs) {
      if (twig.slot !== site.slot || twig.t < t0 - 0.25 || random() > thinning) continue;
      const r = r0 * between(random, 0.4, 0.62);
      clumps.push({
        c: twig.p.clone().add(new Vector3(0, r * 0.3, 0)),
        r,
        slot: site.slot,
        color: green.clone().offsetHSL(0, 0, between(random, -0.02, 0.06)),
      });
    }
  }
  return clumps.slice(0, MAX_CLUMPS);
}

/** A clump mesh and the leaf cards over it, at `capacity` clumps, drawn in `shared`'s light. */
export interface Foliage {
  readonly clumps: InstancedMesh;
  readonly cards: InstancedMesh;
  /** Lays `list` into the meshes; answers how many it laid. */
  readonly lay: (list: readonly Clump[]) => number;
}

export function foliage(shared: SharedUniforms, capacity: number, seed: number): Foliage {
  const clumps = new InstancedMesh(clumpGeometry(), foliageMaterial(shared, false), capacity);
  const cards = new InstancedMesh(
    new PlaneGeometry(0.85, 0.85),
    foliageMaterial(shared, true),
    capacity * CARDS_PER_CLUMP,
  );
  const clumpZone = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  const clumpSeed = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  const cardZone = new InstancedBufferAttribute(new Float32Array(capacity * CARDS_PER_CLUMP), 1);
  const cardSeed = new InstancedBufferAttribute(new Float32Array(capacity * CARDS_PER_CLUMP), 1);
  clumps.geometry.setAttribute("aZone", clumpZone);
  clumps.geometry.setAttribute("aSeed", clumpSeed);
  cards.geometry.setAttribute("aZone", cardZone);
  cards.geometry.setAttribute("aSeed", cardSeed);
  clumps.castShadow = true;
  clumps.receiveShadow = true;
  cards.receiveShadow = true;
  clumps.count = 0;
  cards.count = 0;
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const twist = new Quaternion();
  const scale = new Vector3();
  const euler = new Euler();
  const dir = new Vector3();
  const p = new Vector3();
  const facing = new Vector3(0, 0, 1);
  const shade = new Color();
  return {
    clumps,
    cards,
    lay: (list) => {
      const laid = Math.min(list.length, capacity);
      for (let index = 0; index < laid; index += 1) {
        const clump = item(list, index);
        const random = randomOf(seed + index * 7919);
        turn.setFromEuler(
          euler.set(between(random, -0.3, 0.3), random() * 6.28, between(random, -0.3, 0.3)),
        );
        matrix.compose(clump.c, turn, scale.setScalar(clump.r));
        clumps.setMatrixAt(index, matrix);
        clumps.setColorAt(
          index,
          shade.copy(clump.color).multiplyScalar(0.78 + 0.22 * smooth(0, 26, clump.c.y)),
        );
        clumpZone.setX(index, clump.slot);
        clumpSeed.setX(index, random());
        for (let k = 0; k < CARDS_PER_CLUMP; k += 1) {
          const card = index * CARDS_PER_CLUMP + k;
          dir
            .set(between(random, -1, 1), between(random, -0.35, 1), between(random, -1, 1))
            .normalize();
          p.copy(clump.c).addScaledVector(dir, clump.r * between(random, 0.86, 1.08));
          turn.setFromUnitVectors(facing, dir);
          turn.multiply(
            twist.setFromEuler(
              euler.set(between(random, -0.6, 0.6), between(random, -0.6, 0.6), random() * 6.28),
            ),
          );
          matrix.compose(p, turn, scale.setScalar(between(random, 0.7, 1.25) * clump.r ** 0.35));
          cards.setMatrixAt(card, matrix);
          cards.setColorAt(
            card,
            shade
              .copy(clump.color)
              .offsetHSL(between(random, -0.02, 0.03), 0.05, between(random, 0, 0.12)),
          );
          cardZone.setX(card, clump.slot);
          cardSeed.setX(card, random());
        }
      }
      clumps.count = laid;
      cards.count = laid * CARDS_PER_CLUMP;
      for (const mesh of [clumps, cards]) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
      for (const attribute of [clumpZone, clumpSeed, cardZone, cardSeed])
        attribute.needsUpdate = true;
      clumps.computeBoundingSphere();
      cards.computeBoundingSphere();
      return laid;
    },
  };
}

/* ------------------------------------------------------------------ the tree, as one */

/** The tree's wood and canopy, rebuilt whole when the zones change. */
export interface Wood {
  readonly bark: Mesh;
  readonly canopy: Foliage;
  /** Regrows the bark and the canopy from `skeleton`. */
  readonly grow: (skeleton: Skeleton) => readonly Clump[];
}

export function wood(shared: SharedUniforms): Wood {
  const bark = new Mesh(new BufferGeometry(), barkMaterial(shared));
  bark.castShadow = true;
  bark.receiveShadow = true;
  const canopy = foliage(shared, MAX_CLUMPS, 99);
  return {
    bark,
    canopy,
    grow: (skeleton) => {
      const grown = growBark(skeleton);
      bark.geometry.dispose();
      bark.geometry = grown.geometry;
      const clumps = growCanopy(skeleton, grown.twigs);
      canopy.lay(clumps);
      return clumps;
    },
  };
}

/* ------------------------------------------------------------------ picking a zone */

/**
 * The unseen shapes a zone is picked by: one sphere at each zone's centre,
 * registered first so a flight aims there, and a chain of segments along
 * each branch. The canopy's clumps pick their zone too.
 */
export interface ZonePicks {
  readonly anchors: InstancedMesh;
  readonly segments: InstancedMesh;
  readonly place: (skeleton: Skeleton, clumps: readonly Clump[]) => void;
}

export function zonePicks(picking: WorldPicking, canopy: Foliage): ZonePicks {
  const unseen = new MeshBasicMaterial({ visible: false });
  const anchors = new InstancedMesh(
    new SphereGeometry(1, 8, 6),
    unseen,
    FACTORY_WORLD_BOUNDS.MAX_ZONES,
  );
  const segments = new InstancedMesh(new CylinderGeometry(1, 1, 1, 6), unseen, MAX_PICK_SEGMENTS);
  anchors.count = 0;
  segments.count = 0;
  let anchorTargets: PickTarget[] = [];
  let segmentTargets: PickTarget[] = [];
  let clumpTargets: (PickTarget | undefined)[] = [];
  picking.addInstances(anchors, (instanceId) => anchorTargets[instanceId]);
  picking.addInstances(segments, (instanceId) => segmentTargets[instanceId]);
  picking.addInstances(canopy.clumps, (instanceId) => clumpTargets[instanceId]);
  const matrix = new Matrix4();
  const turn = new Quaternion();
  const scale = new Vector3();
  const mid = new Vector3();
  const dir = new Vector3();
  return {
    anchors,
    segments,
    place: (skeleton, clumps) => {
      const sites = [...skeleton.sites.values()];
      const targetOfSlot = new Map(
        sites.map((site) => [site.slot, { kind: PICK_KIND.ZONE, id: site.zone.path }]),
      );
      anchorTargets = sites.map((site) => ({ kind: PICK_KIND.ZONE, id: site.zone.path }));
      sites.forEach((site, index) => {
        const size =
          site.branch.kind === BRANCH_KIND.GROUND
            ? 1.6
            : site.branch.kind === BRANCH_KIND.ROOT
              ? 1.1
              : 0.9;
        matrix.compose(site.center, turn.identity(), scale.setScalar(size));
        anchors.setMatrixAt(index, matrix);
      });
      anchors.count = sites.length;
      segmentTargets = [];
      for (const site of sites) {
        if (site.branch.kind === BRANCH_KIND.GROUND) continue;
        const samples = site.branch.samples;
        for (let index = 0; index + 3 < samples.length; index += 3) {
          if (segmentTargets.length >= MAX_PICK_SEGMENTS) break;
          const a = item(samples, index);
          const b = item(samples, index + 3);
          mid.copy(a.p).add(b.p).multiplyScalar(0.5);
          dir.copy(b.p).sub(a.p);
          const length = dir.length();
          turn.setFromUnitVectors(UP, dir.normalize());
          const r = Math.max(a.r, 0.35) * 1.35;
          matrix.compose(mid, turn, scale.set(r, length, r));
          segments.setMatrixAt(segmentTargets.length, matrix);
          segmentTargets.push({ kind: PICK_KIND.ZONE, id: site.zone.path });
        }
      }
      segments.count = segmentTargets.length;
      clumpTargets = clumps.map((clump) => targetOfSlot.get(clump.slot));
      for (const mesh of [anchors, segments]) {
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
      }
    },
  };
}
