import {
  FACTORY_WORLD_BOUNDS,
  type FactoryDefect,
  type FactoryPlanned,
  LINEAR_PRIORITY,
} from "@luke/features/factory-world-wire";
import type { SIGNAL_COLOR, TimelineEntry } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  type BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { PICK_KIND, type PickTarget, type WorldPicking } from "../../world";
import { GLOW_BLEND, GLOW_SHAPE, type GlowField, glowField } from "./glow";
import {
  between,
  GLSL_NOISE,
  groundY,
  meadowPoint,
  painted,
  type Random,
  randomOf,
  seedOf,
  UP,
  valueNoise,
} from "./nature";
import { BRANCH_KIND, type Branch, item, type Skeleton, surfacePoint } from "./skeleton";
import { type Clump, MAX_WOUNDS, type SharedUniforms } from "./wood";

/**
 * signals.ts -- what the World Tree says of the work around it: blossoms and sky lanterns where pull requests shipped, holographic buds where issues are planned, and rot, pests, and smoke where defects strike.
 *
 * Every merged pull request blossoms in the zones it landed in and releases
 * a paper lantern above the first of them; both glow brightest fresh and
 * dim as it ages, and an older lantern floats higher. A planned issue is a
 * holographic bud on each zone it is placed on, larger as it is more
 * pressing, or a seed hovering by the trunk where it is placed on none. A
 * defect is a canker on the first zone it is placed on, as large as its
 * events are many, rotting the wood and withering the leaves round it, with
 * beetles crawling about it and smoke and embers rising off it.
 *
 * Each draws in its signal's colour, and in the selection's while chosen.
 */

const MAX_BLOOMS = 4096;
const MAX_BUDS = 256;
const MAX_LUMPS = FACTORY_WORLD_BOUNDS.MAX_DEFECTS * 14;
const MAX_BEETLES = FACTORY_WORLD_BOUNDS.MAX_DEFECTS * 8;
const SMOKE = 220;
const EMBERS = 140;
const DRIFT = 340;
const HOUR_MS = 60 * 60 * 1000;
/** How many of the newest merges the idle ticker takes turns flaring. */
const TICKER_RECENT = 24;
const TICKER_SECONDS = 6;

/** Where something sits on the tree, and which way it faces out. */
interface Placed {
  readonly p: Vector3;
  readonly dir: Vector3;
}

/** One blossom: where, which way it faces, whose, and how large. */
interface Bloom {
  readonly p: Vector3;
  readonly dir: Vector3;
  readonly url: string;
  readonly scale: number;
}

interface Lantern {
  readonly entry: TimelineEntry;
  readonly base: Vector3;
  readonly zone: Vector3;
  readonly seed: number;
  readonly size: number;
}

interface Bud {
  readonly p: Vector3;
  readonly dir: Vector3;
  readonly size: number;
  readonly identifier: string;
  readonly seed: number;
}

interface Wound {
  readonly defect: FactoryDefect;
  readonly branch: Branch;
  readonly t: number;
  readonly r: number;
  readonly p: Vector3;
  readonly dir: Vector3;
  readonly angle: number;
  /** The bark's patch round the wound, as the beetles crawl it: the axis point, its way along, its top and side, and its radius. */
  readonly bark: {
    readonly axis: Vector3;
    readonly tan: Vector3;
    readonly top: Vector3;
    readonly side: Vector3;
    readonly radius: number;
  };
}

/** The hours since `entry` merged, as of `now`. */
function ageOf(entry: TimelineEntry, now: number): number {
  return Math.max(0, (now - entry.mergedAt) / HOUR_MS);
}

/** A merge's freshness: one the instant it lands, falling away over its first day. */
function freshnessOf(ageHours: number): number {
  return Math.exp(-ageHours / 18);
}

/** A point on `branch` near `t`, its bark's outward way, for whatever sits on a zone with no leaves there. */
function onBranch(branch: Branch, random: Random, low: number, high: number): Placed {
  const at = surfacePoint(branch, between(random, low, high), between(random, -0.9, 0.9), 0);
  return {
    p: at.p,
    dir:
      branch.kind === BRANCH_KIND.ROOT
        ? at.dir.clone().negate().lerp(UP.clone().negate(), 0.3).normalize()
        : at.dir.clone().lerp(UP, 0.5).normalize(),
  };
}

/** Blossom material: a flower that pops open as it lands and glows while fresh. */
function bloomMaterial(shared: SharedUniforms): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ side: DoubleSide, vertexColors: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aAge; attribute float aSeed; uniform float uTime; varying float vFresh;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float pop = min(1.0, aAge * 6.0);
        pop = pop * (1.0 + 0.6 * sin(pop * 3.14159));
        vFresh = exp(-aAge / 18.0);
        transformed *= pop * (0.7 + 0.3 * vFresh) * (1.0 + 0.06 * sin(uTime * 2.0 + aSeed * 30.0));`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFresh;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.9 + 3.2 * vFresh);",
      );
  };
  material.customProgramCacheKey = () => "tree-bloom";
  return material;
}

/** Five petals round a bright heart, facing +y. */
function flowerGeometry(): BufferGeometry {
  const petals = [0, 1, 2, 3, 4].map((k) =>
    painted(
      new CircleGeometry(0.16, 8)
        .scale(0.75, 1, 1)
        .translate(0, 0.14, 0)
        .rotateX(-0.35)
        .rotateZ((k / 5) * Math.PI * 2),
      "#ffffff",
    ),
  );
  const heart = painted(new SphereGeometry(0.06, 6, 4), "#ffffff");
  const heartColor = heart.getAttribute("color");
  for (let index = 0; index < heartColor.count; index += 1) heartColor.setXYZ(index, 2.2, 2.1, 1.6);
  const merged = mergeGeometries([...petals, heart]);
  if (merged === null) throw new Error("tree: the flower's parts would not merge");
  return merged.rotateX(-Math.PI / 2);
}

/** The paper lantern a merge releases. */
function lanternGeometry(): BufferGeometry {
  const merged = mergeGeometries([
    new CylinderGeometry(0.3, 0.24, 0.55, 10).toNonIndexed(),
    new CylinderGeometry(0.1, 0.3, 0.14, 10).translate(0, 0.34, 0).toNonIndexed(),
    new CylinderGeometry(0.24, 0.12, 0.1, 10).translate(0, -0.32, 0).toNonIndexed(),
  ]);
  if (merged === null) throw new Error("tree: the lantern's parts would not merge");
  return merged;
}

/** The planned bud: a hologram, rim-lit and scanned, breathing, in the planned colour or the selection's. */
function budMaterial(shared: SharedUniforms): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uTime: shared.uTime },
    vertexShader: /* glsl */ `attribute float aSeed; attribute vec3 aTint; varying vec3 vN; varying vec3 vWP; varying float vSeed; varying vec3 vTint; uniform float uTime;
      void main(){ vec3 p = position * (1.0 + 0.07 * sin(uTime * 2.0 + aSeed * 20.0));
        vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0); vWP = w.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal); vSeed = aSeed; vTint = aTint; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vN; varying vec3 vWP; varying float vSeed; varying vec3 vTint;
      void main(){ vec3 V = normalize(cameraPosition - vWP); float f = pow(1.0 - abs(dot(normalize(vN), V)), 2.0);
        float scan = 0.5 + 0.5 * sin(vWP.y * 18.0 - uTime * 4.0);
        float ribs = smoothstep(0.9, 1.0, abs(sin(atan(vN.z, vN.x) * 3.0)));
        float a = (0.18 + 0.85 * f) * (0.7 + 0.3 * scan) + ribs * 0.2;
        a *= 0.75 + 0.25 * sin(uTime * 1.5 + vSeed * 10.0);
        gl_FragColor = vec4(vTint * a * 1.6, a); }`,
  });
}

/** Rot lumps: near-black, cracked with the defect's colour, the cracks breathing. */
function lumpMaterial(shared: SharedUniforms): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: "#1c0f1c", roughness: 0.45, metalness: 0.1 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aCrack; varying vec3 vOP; varying vec3 vCrack;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvOP = (instanceMatrix * vec4(position, 1.0)).xyz; vCrack = aCrack;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${GLSL_NOISE}\nuniform float uTime; varying vec3 vOP; varying vec3 vCrack;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float n = vn3(vOP * 4.0);
        float crack = 1.0 - smoothstep(0.0, 0.07, abs(n - 0.5));
        totalEmissiveRadiance += vCrack * crack * (1.6 + 1.0 * sin(uTime * 2.8 + n * 12.0));`,
      );
  };
  material.customProgramCacheKey = () => "tree-rot";
  return material;
}

function lumpGeometry(): BufferGeometry {
  const geometry = mergeVertices(new IcosahedronGeometry(1, 2));
  const position = geometry.getAttribute("position");
  const p = new Vector3();
  for (let index = 0; index < position.count; index += 1) {
    p.fromBufferAttribute(position, index);
    p.multiplyScalar(0.75 + 0.45 * valueNoise(p.x * 2.5 + 9, p.y * 2.5, p.z * 2.5));
    position.setXYZ(index, p.x, p.y, p.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function beetleGeometries() {
  const body = mergeGeometries([
    new SphereGeometry(0.11, 8, 6).scale(0.8, 0.55, 1.15).toNonIndexed(),
    new SphereGeometry(0.055, 6, 4).translate(0, 0.01, 0.13).toNonIndexed(),
  ]);
  const eyes = mergeGeometries([
    new SphereGeometry(0.018, 4, 3).translate(0.03, 0.03, 0.17).toNonIndexed(),
    new SphereGeometry(0.018, 4, 3).translate(-0.03, 0.03, 0.17).toNonIndexed(),
  ]);
  if (body === null || eyes === null) throw new Error("tree: the beetle's parts would not merge");
  return { body, eyes };
}

/** What the signals draw from: the state's timeline, plans and defects, the tree as grown, and its clumps. */
interface SignalInput {
  readonly timeline: readonly TimelineEntry[];
  readonly now: number;
  readonly planned: readonly FactoryPlanned[];
  readonly defects: readonly FactoryDefect[];
  readonly skeleton: Skeleton;
  readonly clumpsOf: ReadonlyMap<number, readonly Clump[]>;
}

export interface Signals {
  /** Places every blossom, lantern, bud, and wound for `input`. */
  readonly place: (input: SignalInput) => void;
  /** Colours what is chosen, and shows the layers switched on. */
  readonly paint: (
    chosen: (kind: PickTarget["kind"], id: string) => number,
    layers: { shipped: boolean; planned: boolean; defects: boolean },
  ) => void;
  /** Steps every signal's motion `dt` seconds to `t`; with `still`, lays each in place and spawns nothing. */
  readonly pose: (dt: number, t: number, still: boolean) => void;
  /** Answers the zone the idle ticker flares next, `t` seconds in, or nothing. */
  readonly tick: (t: number) => string | undefined;
}

export function signals(
  scene: Scene,
  shared: SharedUniforms,
  picking: WorldPicking,
  signal: typeof SIGNAL_COLOR,
  glow: { readonly add: GlowField; readonly over: GlowField; readonly xray: GlowField },
): Signals {
  const colors = {
    planned: new Color(signal.PLANNED),
    shipped: new Color(signal.SHIPPED),
    defect: new Color(signal.DEFECT),
    selection: new Color(signal.SELECTION),
  };
  const maxShipped = FACTORY_WORLD_BOUNDS.MAX_SHIPPED;
  const flowers = new InstancedMesh(flowerGeometry(), bloomMaterial(shared), MAX_BLOOMS);
  const bloomAge = new InstancedBufferAttribute(new Float32Array(MAX_BLOOMS), 1);
  const bloomSeed = new InstancedBufferAttribute(new Float32Array(MAX_BLOOMS), 1);
  flowers.geometry.setAttribute("aAge", bloomAge);
  flowers.geometry.setAttribute("aSeed", bloomSeed);
  // Note that a blossom's halo is what makes a green flower on a green crown read as light, where the mockup had bloom.
  const halos = glowField(MAX_BLOOMS, GLOW_BLEND.ADD);
  let bloomFresh: number[] = [];
  /** What the blossoms were last painted for; nothing once they are placed again. */
  let bloomsPainted:
    | { readonly shipped: boolean; readonly lit: ReadonlyMap<string, number> }
    | undefined;
  const lanterns = new InstancedMesh(
    lanternGeometry(),
    new MeshBasicMaterial({ color: "#ffffff" }),
    maxShipped,
  );
  lanterns.instanceMatrix.setUsage(DynamicDrawUsage);
  lanterns.frustumCulled = false;
  const lanternGlow = glow.add.reserve(maxShipped);

  const budGeometry = new LatheGeometry(
    Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      return new Vector2(Math.sin(t * Math.PI) * 0.42 * (1 - t * 0.35), t * 1.3 - 0.05);
    }),
    14,
  );
  const budSeed = new InstancedBufferAttribute(new Float32Array(MAX_BUDS), 1);
  const budTint = new InstancedBufferAttribute(new Float32Array(MAX_BUDS * 3), 3);
  budGeometry.setAttribute("aSeed", budSeed);
  budGeometry.setAttribute("aTint", budTint);
  const buds = new InstancedMesh(budGeometry, budMaterial(shared), MAX_BUDS);
  buds.instanceMatrix.setUsage(DynamicDrawUsage);
  buds.renderOrder = 5;
  buds.frustumCulled = false;
  const budGlow = glow.xray.reserve(MAX_BUDS);

  const rot = new Group();
  const lumpCrack = new InstancedBufferAttribute(new Float32Array(MAX_LUMPS * 3), 3);
  const lumpShape = lumpGeometry();
  lumpShape.setAttribute("aCrack", lumpCrack);
  const lumps = new InstancedMesh(lumpShape, lumpMaterial(shared), MAX_LUMPS);
  lumps.castShadow = true;
  const beetleParts = beetleGeometries();
  const beetles = new InstancedMesh(
    beetleParts.body,
    new MeshStandardMaterial({ color: "#160b16", roughness: 0.3, metalness: 0.4 }),
    MAX_BEETLES,
  );
  const eyeColor = colors.defect.clone().multiplyScalar(5);
  const beetleEyes = new InstancedMesh(
    beetleParts.eyes,
    new MeshBasicMaterial({ color: eyeColor }),
    MAX_BEETLES,
  );
  for (const mesh of [beetles, beetleEyes]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
  }
  rot.add(lumps, beetles, beetleEyes);
  const haloFirst = glow.add.reserve(FACTORY_WORLD_BOUNDS.MAX_DEFECTS);
  const smokeFirst = glow.over.reserve(SMOKE);
  const emberFirst = glow.add.reserve(EMBERS);

  const driftGeometry = new CircleGeometry(0.12, 6).scale(0.65, 1, 1);
  const drift = new InstancedMesh(
    driftGeometry,
    new MeshLambertMaterial({ side: DoubleSide, emissive: new Color(0.12, 0.2, 0.14) }),
    DRIFT,
  );
  drift.instanceMatrix.setUsage(DynamicDrawUsage);
  drift.frustumCulled = false;
  const ringFirst = glow.add.reserve(10);
  scene.add(flowers, halos.points, lanterns, buds, rot, drift);
  for (const mesh of [flowers, lanterns, buds, lumps, beetles, beetleEyes, drift]) mesh.count = 0;

  let blooms: Bloom[] = [];
  let lanternList: Lantern[] = [];
  let budList: Bud[] = [];
  let wounds: Wound[] = [];
  let now = 0;
  let bloomTargets: PickTarget[] = [];
  let lanternTargets: PickTarget[] = [];
  let budTargets: PickTarget[] = [];
  let lumpTargets: PickTarget[] = [];
  let lumpWound: number[] = [];
  let chosenOf: (kind: PickTarget["kind"], id: string) => number = () => 0;
  let shown = { shipped: true, planned: true, defects: true };
  picking.addInstances(lanterns, (instanceId) => lanternTargets[instanceId]);
  picking.addInstances(flowers, (instanceId) => bloomTargets[instanceId]);
  picking.addInstances(buds, (instanceId) => budTargets[instanceId]);
  picking.addInstances(lumps, (instanceId) => lumpTargets[instanceId]);

  const effects = randomOf(4321);
  const flashes = new Map<string, number>();
  const rings = Array.from({ length: 10 }, () => ({ life: 0, p: new Vector3(), size: 9 }));
  let nextRing = 0;
  const beetleList: {
    wound: number;
    phase: number;
    speed: number;
    reach: number;
    wobble: number;
  }[] = [];
  const smoke = Array.from({ length: SMOKE }, () => ({
    wound: -1,
    life: effects() * 5,
    max: between(effects, 3.5, 6),
    off: new Vector3(),
    drift: new Vector3(),
  }));
  const embers = Array.from({ length: EMBERS }, () => ({
    wound: -1,
    life: effects() * 3,
    max: between(effects, 1.5, 3.2),
    off: new Vector3(),
    v: new Vector3(),
  }));
  const parts = Array.from({ length: DRIFT }, () => ({
    alive: false,
    life: 0,
    max: 1,
    petal: true,
    p: new Vector3(),
    v: new Vector3(),
    rot: new Euler(),
    spin: new Vector3(),
    s: 1,
  }));
  let petalSources: { p: Vector3; w: number }[] = [];
  let leafSources: readonly Clump[] = [];
  let spawnDue = 0;
  let recent: TimelineEntry[] = [];
  let tickerDue = 2.5;
  let tickerAt = 0;

  const matrix = new Matrix4();
  const turn = new Quaternion();
  const twist = new Quaternion();
  const scale = new Vector3();
  const euler = new Euler();
  const p = new Vector3();
  const c = new Color();
  const look = new Matrix4();
  const ahead = new Vector3();
  const outward = new Vector3();

  /** The wound a draw weighted by events falls on. */
  const woundByEvents = (draw: number) => {
    const total = wounds.reduce((sum, wound) => sum + wound.defect.events + 1, 0);
    let left = draw * total;
    for (let index = 0; index < wounds.length; index += 1) {
      left -= item(wounds, index).defect.events + 1;
      if (left <= 0) return index;
    }
    return wounds.length - 1;
  };

  const placeBlooms = (input: SignalInput) => {
    blooms = [];
    // Note that each merge has its even share of the blossoms, so a full window blossoms for every merge in it.
    const perMerge = Math.max(1, Math.floor(MAX_BLOOMS / Math.max(1, input.timeline.length)));
    for (const entry of input.timeline) {
      const random = randomOf(entry.number * 13 + 1);
      const zones = entry.zonePaths;
      const lines = entry.additions + entry.deletions;
      const placedBefore = blooms.length;
      for (const path of zones) {
        const site = input.skeleton.sites.get(path);
        if (site === undefined) continue;
        const share = 1 / zones.length;
        const count = Math.min(
          16,
          Math.max(
            zones.length > 4 ? 1 : 2,
            Math.round((2 + Math.log2(lines * share + 2) * 1.3) * (0.5 + share)),
          ),
        );
        const clumps = input.clumpsOf.get(site.slot) ?? [];
        for (
          let k = 0;
          k < count && blooms.length < MAX_BLOOMS && blooms.length - placedBefore < perMerge;
          k += 1
        ) {
          let at: Placed;
          if (clumps.length > 0) {
            const clump = item(clumps, Math.floor(random() * clumps.length));
            const dir = new Vector3(
              between(random, -1, 1),
              between(random, -0.1, 1),
              between(random, -1, 1),
            ).normalize();
            at = {
              p: clump.c.clone().addScaledVector(dir, clump.r * between(random, 0.9, 1.04)),
              dir,
            };
          } else if (site.branch.kind === BRANCH_KIND.GROUND) {
            const a = random() * 6.28;
            const d = between(random, 0.8, 2.5);
            const x = site.center.x + Math.cos(a) * d;
            const z = site.center.z + Math.sin(a) * d;
            at = { p: new Vector3(x, groundY(x, z) + 0.2, z), dir: UP.clone() };
          } else {
            at = onBranch(site.branch, random, 0.15, 0.85);
          }
          blooms.push({
            p: at.p,
            dir: at.dir,
            url: entry.url,
            scale: between(random, 0.9, 1.4) * (0.85 + 0.25 * Math.min(1, lines / 800)),
          });
        }
      }
    }
    bloomTargets = blooms.map((bloom) => ({ kind: PICK_KIND.SHIPPED, id: bloom.url }));
    blooms.forEach((bloom, index) => {
      matrix.compose(bloom.p, turn.setFromUnitVectors(UP, bloom.dir), scale.setScalar(bloom.scale));
      flowers.setMatrixAt(index, matrix);
      bloomSeed.setX(index, randomOf(index * 31 + 7)());
    });
    flowers.count = blooms.length;
    flowers.instanceMatrix.needsUpdate = true;
    bloomSeed.needsUpdate = true;
    flowers.computeBoundingSphere();
    lanternList = input.timeline.slice(-maxShipped).map((entry) => {
      const random = randomOf(entry.number);
      const site =
        entry.zonePaths[0] === undefined ? undefined : input.skeleton.sites.get(entry.zonePaths[0]);
      const zone = site?.center.clone() ?? new Vector3(0, 17, 0);
      const a = random() * Math.PI * 2;
      const d = 0.8 + random() * 2.6;
      const base = zone
        .clone()
        .add(new Vector3(Math.cos(a) * d, 2.2 + random() * 1.5, Math.sin(a) * d));
      base.y = Math.max(base.y, 3);
      return {
        entry,
        base,
        zone,
        seed: random() * 10,
        size: 0.85 + 0.5 * Math.min(1, (entry.additions + entry.deletions) / 700),
      };
    });
    lanternTargets = lanternList.map((lantern) => ({
      kind: PICK_KIND.SHIPPED,
      id: lantern.entry.url,
    }));
    lanterns.count = lanternList.length;
    recent = [...input.timeline].slice(-TICKER_RECENT).reverse();
  };

  const placeBuds = (input: SignalInput) => {
    budList = [];
    // Note that each issue has its even share of the buds, so the last of fifty issues on sixteen zones each still buds.
    const perIssue = Math.max(1, Math.floor(MAX_BUDS / Math.max(1, input.planned.length)));
    for (const issue of input.planned) {
      const random = randomOf(seedOf(issue.identifier));
      const pressing =
        issue.priority === undefined || issue.priority === LINEAR_PRIORITY.NONE
          ? LINEAR_PRIORITY.LOW
          : issue.priority;
      const size = 0.5 + (5 - pressing) * 0.28;
      const sites = issue.zonePaths
        .flatMap((path) => input.skeleton.sites.get(path) ?? [])
        .slice(0, perIssue);
      if (sites.length === 0) {
        // Note that an issue placed on no zone is a seed hovering by the trunk, at an angle of its own.
        const at = meadowPoint(
          between(random, 4.6, 7.5),
          (seedOf(issue.identifier, 9) % 6283) / 1000,
          0.5,
        );
        if (budList.length < MAX_BUDS)
          budList.push({
            p: at,
            dir: UP.clone(),
            size,
            identifier: issue.identifier,
            seed: random(),
          });
        continue;
      }
      for (const site of sites) {
        if (budList.length >= MAX_BUDS) break;
        const branch = site.branch;
        const at =
          branch.kind === BRANCH_KIND.GROUND
            ? { p: site.center.clone(), dir: UP.clone() }
            : branch.kind === BRANCH_KIND.ROOT
              ? onBranch(branch, random, 0.25, 0.6)
              : branch.kind === BRANCH_KIND.LIMB
                ? onBranch(branch, random, Math.max(branch.tPeel, 0.3), 0.85)
                : onBranch(branch, random, 0.35, 0.8);
        budList.push({ p: at.p, dir: at.dir, size, identifier: issue.identifier, seed: random() });
      }
    }
    budTargets = budList.map((bud) => ({ kind: PICK_KIND.PLANNED, id: bud.identifier }));
    budList.forEach((bud, index) => {
      budSeed.setX(index, bud.seed);
    });
    budSeed.needsUpdate = true;
    buds.count = budList.length;
  };

  const placeWounds = (input: SignalInput) => {
    const perZone = new Map<string, number>();
    wounds = input.defects.map((defect) => {
      const random = randomOf(seedOf(defect.id, 3));
      const path = defect.zonePaths[0];
      const site = path === undefined ? undefined : input.skeleton.sites.get(path);
      const key = path ?? "";
      const k = perZone.get(key) ?? 0;
      perZone.set(key, k + 1);
      // Note that a defect placed on no zone, or on a meadow place, wounds the trunk's foot.
      const branch =
        site === undefined || site.branch.kind === BRANCH_KIND.GROUND
          ? input.skeleton.heart
          : site.branch;
      const t =
        branch.kind === BRANCH_KIND.HEART
          ? ([0.08, 0.22, 0.36][k] ?? between(random, 0.05, 0.5))
          : branch.kind === BRANCH_KIND.ROOT
            ? ([0.075, 0.36, 0.55, 0.7][k] ?? between(random, 0.2, 0.7))
            : branch.kind === BRANCH_KIND.LIMB
              ? branch.tPeel +
                (1 - branch.tPeel) * ([0.35, 0.6, 0.8][k] ?? between(random, 0.3, 0.9))
              : ([0.55, 0.32, 0.78, 0.2, 0.68, 0.45, 0.9][k] ?? between(random, 0.2, 0.9));
      const r = Math.min(2.4, 0.38 + Math.sqrt(defect.events) * 0.2);
      const angle = branch.kind === BRANCH_KIND.ROOT && k === 0 ? 0 : between(random, -0.7, 0.7);
      const at = surfacePoint(branch, t, angle, -0.05);
      const bark = { axis: at.at.p, tan: at.at.tan, top: at.top, side: at.side, radius: at.at.r };
      return { defect, branch, t, r, p: at.p, dir: at.dir, angle, bark };
    });
    wounds.sort((a, b) => b.defect.events - a.defect.events);
    const lumpList: { p: Vector3; s: number; wound: number; rot: Euler }[] = [];
    // Note that each wound has its even share of the lumps and the beetles, so every defect stands to be picked however many there are.
    const share = (capacity: number) =>
      Math.max(1, Math.floor(capacity / Math.max(1, wounds.length)));
    wounds.forEach((wound, index) => {
      const random = randomOf(seedOf(wound.defect.id, 4));
      const count = Math.min(Math.round(6 + wound.r * 8), share(MAX_LUMPS));
      for (let k = 0; k < count && lumpList.length < MAX_LUMPS; k += 1) {
        const dt = (between(random, -1, 1) * wound.r * 0.7) / Math.max(wound.branch.len, 1);
        const at = surfacePoint(
          wound.branch,
          Math.min(0.99, Math.max(0.01, wound.t + dt)),
          wound.angle + between(random, -1.6, 1.6) * 0.9,
          -0.05,
        );
        lumpList.push({
          p: at.p,
          s: wound.r * between(random, 0.26, 0.55),
          wound: index,
          rot: new Euler(random() * 3, random() * 3, random() * 3),
        });
      }
    });
    lumpTargets = lumpList.map((lump) => ({
      kind: PICK_KIND.DEFECT,
      id: item(wounds, lump.wound).defect.id,
    }));
    lumpWound = lumpList.map((lump) => lump.wound);
    lumpList.forEach((lump, index) => {
      matrix.compose(lump.p, turn.setFromEuler(lump.rot), scale.setScalar(lump.s));
      lumps.setMatrixAt(index, matrix);
    });
    lumps.count = lumpList.length;
    lumps.instanceMatrix.needsUpdate = true;
    lumps.computeBoundingSphere();
    beetleList.length = 0;
    wounds.forEach((wound, index) => {
      const random = randomOf(seedOf(wound.defect.id, 5));
      const count = Math.round(1 + Math.sqrt(wound.defect.events) * 1.6);
      for (
        let k = 0;
        k < Math.min(count, 8, share(MAX_BEETLES)) && beetleList.length < MAX_BEETLES;
        k += 1
      ) {
        beetleList.push({
          wound: index,
          phase: random() * 6.28,
          speed: between(random, 0.3, 0.8) * (random() < 0.5 ? -1 : 1),
          reach: between(random, 0.6, 1.5),
          wobble: random() * 6,
        });
      }
    });
    beetles.count = beetleList.length;
    beetleEyes.count = beetleList.length;
    for (const puff of smoke) {
      puff.wound = wounds.length === 0 ? -1 : woundByEvents(effects());
      const wound = wounds[puff.wound];
      if (wound !== undefined) {
        puff.off
          .set(between(effects, -1, 1), 0, between(effects, -1, 1))
          .multiplyScalar(wound.r * 0.5);
        puff.drift.set(
          between(effects, -0.2, 0.2),
          between(effects, 0.5, 1),
          between(effects, -0.2, 0.2),
        );
      }
    }
    for (const ember of embers) {
      ember.wound = wounds.length === 0 ? -1 : woundByEvents(effects());
      const wound = wounds[ember.wound];
      if (wound !== undefined) {
        ember.off
          .set(between(effects, -1, 1), 0, between(effects, -1, 1))
          .multiplyScalar(wound.r * 0.6);
        ember.v.set(
          between(effects, -0.4, 0.4),
          between(effects, 0.8, 1.8),
          between(effects, -0.4, 0.4),
        );
      }
    }
    shared.uWoundN.value = Math.min(MAX_WOUNDS, wounds.length);
    wounds.slice(0, MAX_WOUNDS).forEach((wound, index) => {
      item(shared.uWound.value, index).set(wound.p.x, wound.p.y, wound.p.z, wound.r);
    });
  };

  /** Lays each lantern, bud, and beetle at `t`; motion only when `still` is false. */
  const layMotion = (t: number, still: boolean) => {
    const motion = still ? 0 : 1;
    lanternList.forEach((lantern, index) => {
      const age = ageOf(lantern.entry, now);
      const flash = flashes.get(lantern.entry.url) ?? 0;
      const fresh = freshnessOf(age);
      const rise = 0.4 + 2.6 * Math.min(Math.sqrt(age), 7);
      p.copy(lantern.base);
      p.y += rise + Math.sin(t * 0.8 + lantern.seed) * 0.25 * motion;
      p.x += Math.sin(t * 0.35 + lantern.seed) * 0.5 * motion;
      p.z += Math.cos(t * 0.3 + lantern.seed) * 0.5 * motion;
      const chosen = chosenOf(PICK_KIND.SHIPPED, lantern.entry.url);
      const bright = 0.3 + 0.7 * fresh + flash * 1.5 + chosen * 0.6;
      const size =
        lantern.size *
        (0.75 + 0.35 * fresh) *
        Math.min(1, 0.4 + age * 12) *
        (1 + flash * 0.6) *
        (1 + chosen * 0.35);
      turn.setFromEuler(
        euler.set(
          Math.sin(t + lantern.seed) * 0.08 * motion,
          t * 0.2 * motion + lantern.seed,
          Math.cos(t * 0.9 + lantern.seed) * 0.08 * motion,
        ),
      );
      matrix.compose(p, turn, scale.setScalar(size));
      lanterns.setMatrixAt(index, matrix);
      const hue = chosen > 0 ? colors.selection : colors.shipped;
      lanterns.setColorAt(index, c.copy(hue).multiplyScalar(0.8 + 2.2 * bright));
      glow.add.set(
        lanternGlow + index,
        p.x,
        p.y,
        p.z,
        (1.4 + 2.2 * bright) * lantern.size,
        hue.r * 1.4,
        hue.g * 1.4,
        hue.b * 1.4,
        shown.shipped ? 0.22 + 0.4 * Math.min(1, bright) : 0,
      );
    });
    glow.add.clear(lanternGlow + lanternList.length, maxShipped - lanternList.length);
    lanterns.instanceMatrix.needsUpdate = true;
    if (lanterns.instanceColor !== null) lanterns.instanceColor.needsUpdate = true;
    budList.forEach((bud, index) => {
      turn.setFromUnitVectors(UP, bud.dir);
      turn.multiply(twist.setFromAxisAngle(UP, t * 0.4 * motion + bud.seed * 6));
      p.copy(bud.p).addScaledVector(
        bud.dir,
        0.05 + Math.sin(t * 1.2 + bud.seed * 9) * 0.06 * motion,
      );
      const chosen = chosenOf(PICK_KIND.PLANNED, bud.identifier);
      matrix.compose(p, turn, scale.setScalar(bud.size * (1 + chosen * 0.3)));
      buds.setMatrixAt(index, matrix);
      p.addScaledVector(bud.dir, bud.size * 0.55);
      const hue = chosen > 0 ? colors.selection : colors.planned;
      glow.xray.set(
        budGlow + index,
        p.x,
        p.y,
        p.z,
        bud.size * (2.4 + 0.3 * Math.sin(t * 2 + bud.seed * 9)) * (1 + chosen * 0.5),
        hue.r * 2.6,
        hue.g * 2.6,
        hue.b * 2.6,
        shown.planned ? 0.42 + chosen * 0.4 : 0,
      );
    });
    glow.xray.clear(budGlow + budList.length, MAX_BUDS - budList.length);
    buds.instanceMatrix.needsUpdate = true;
    // Note that a beetle crawls the bark's patch round its wound as a cylinder, which a frame can afford for every beetle.
    const crawl = (wound: Wound, along: number, round: number, out: Vector3) => {
      const { axis, tan, top, side, radius } = wound.bark;
      outward.copy(top).multiplyScalar(Math.cos(round)).addScaledVector(side, Math.sin(round));
      return out
        .copy(axis)
        .addScaledVector(tan, along)
        .addScaledVector(outward, radius + 0.03);
    };
    beetleList.forEach((beetle, index) => {
      const wound = item(wounds, beetle.wound);
      const a = beetle.phase + t * beetle.speed;
      const way = Math.sign(beetle.speed);
      const reach = (0.6 + wound.r * 0.35) * beetle.reach;
      const along = Math.sin(a * 1.3 + beetle.wobble) * wound.r * 0.9 * beetle.reach;
      crawl(wound, along + 0.02 * way, wound.angle + Math.cos(a + 0.1 * way) * reach, ahead);
      crawl(wound, along, wound.angle + Math.cos(a) * reach, p);
      look.lookAt(ahead, p, outward);
      matrix.compose(p, turn.setFromRotationMatrix(look), scale.setScalar(0.9 + wound.r * 0.35));
      beetles.setMatrixAt(index, matrix);
      beetleEyes.setMatrixAt(index, matrix);
    });
    beetles.instanceMatrix.needsUpdate = true;
    beetleEyes.instanceMatrix.needsUpdate = true;
    wounds.forEach((wound, index) => {
      if (index >= FACTORY_WORLD_BOUNDS.MAX_DEFECTS) return;
      const chosen = chosenOf(PICK_KIND.DEFECT, wound.defect.id);
      const hue = chosen > 0 ? colors.selection : colors.defect;
      p.copy(wound.p).addScaledVector(wound.dir, 0.2);
      glow.add.set(
        haloFirst + index,
        p.x,
        p.y,
        p.z,
        wound.r * 3 * (1 + 0.18 * Math.sin(t * 2.6 + index)) * (1 + chosen * 0.4),
        hue.r * 2.4,
        hue.g * 2.4,
        hue.b * 2.4,
        shown.defects ? 0.45 + 0.3 * Math.sin(t * 2.6 + index) * motion + chosen * 0.2 : 0,
      );
    });
    glow.add.clear(haloFirst + wounds.length, FACTORY_WORLD_BOUNDS.MAX_DEFECTS - wounds.length);
  };

  return {
    place: (input) => {
      now = input.now;
      placeBlooms(input);
      placeBuds(input);
      placeWounds(input);
      leafSources = [...input.clumpsOf.values()].flat();
      // Note that a merge's age is written per blossom, so a scrub ages the canopy without moving a petal.
      const ages = new Map(input.timeline.map((entry) => [entry.url, ageOf(entry, now)]));
      blooms.forEach((bloom, index) => {
        bloomAge.setX(index, ages.get(bloom.url) ?? 0);
      });
      bloomFresh = blooms.map((bloom) => freshnessOf(ages.get(bloom.url) ?? 0));
      bloomsPainted = undefined;
      bloomAge.needsUpdate = true;
      petalSources = blooms.flatMap((bloom) => {
        const w = freshnessOf(ages.get(bloom.url) ?? 0);
        return w > 0.05 ? [{ p: bloom.p, w }] : [];
      });
    },
    paint: (chosen, layers) => {
      chosenOf = chosen;
      shown = layers;
      flowers.visible = layers.shipped;
      lanterns.visible = layers.shipped;
      drift.visible = layers.shipped;
      buds.visible = layers.planned;
      rot.visible = layers.defects;
      shared.uDefects.value = layers.defects ? 1 : 0;
      // Note that the blossoms are repainted only when what is chosen among the merges, or the layer, changes, since a hover elsewhere leaves thousands of them as they were.
      const lit = new Map(
        lanternList.flatMap(({ entry }) => {
          const chosenHere = chosen(PICK_KIND.SHIPPED, entry.url);
          return chosenHere > 0 ? [[entry.url, chosenHere] as const] : [];
        }),
      );
      const unchanged =
        bloomsPainted !== undefined &&
        bloomsPainted.shipped === layers.shipped &&
        bloomsPainted.lit.size === lit.size &&
        [...lit].every(([url, chosenHere]) => bloomsPainted?.lit.get(url) === chosenHere);
      if (!unchanged) {
        bloomsPainted = { shipped: layers.shipped, lit };
        blooms.forEach((bloom, index) => {
          const chosenHere = lit.get(bloom.url) ?? 0;
          const hue = chosenHere > 0 ? colors.selection : colors.shipped;
          const fresh = bloomFresh[index] ?? 0;
          flowers.setColorAt(index, hue);
          halos.set(
            index,
            bloom.p.x + bloom.dir.x * 0.12,
            bloom.p.y + bloom.dir.y * 0.12,
            bloom.p.z + bloom.dir.z * 0.12,
            bloom.scale * (0.9 + 0.5 * fresh + chosenHere * 0.4),
            hue.r * 1.8,
            hue.g * 1.8,
            hue.b * 1.8,
            layers.shipped ? 0.14 + 0.5 * fresh + chosenHere * 0.3 : 0,
          );
        });
        if (flowers.instanceColor !== null) flowers.instanceColor.needsUpdate = true;
        halos.clear(blooms.length, MAX_BLOOMS - blooms.length);
        halos.commit();
      }
      budList.forEach((bud, index) => {
        const hue =
          chosen(PICK_KIND.PLANNED, bud.identifier) > 0 ? colors.selection : colors.planned;
        budTint.setXYZ(index, hue.r, hue.g, hue.b);
      });
      budTint.needsUpdate = true;
      lumpWound.forEach((wound, index) => {
        const hue =
          chosen(PICK_KIND.DEFECT, item(wounds, wound).defect.id) > 0
            ? colors.selection
            : colors.defect;
        lumpCrack.setXYZ(index, hue.r, hue.g, hue.b);
      });
      lumpCrack.needsUpdate = true;
    },
    tick: (t) => {
      if (recent.length === 0 || !shown.shipped || t < tickerDue) return undefined;
      tickerDue = t + TICKER_SECONDS;
      const entry = item(recent, tickerAt % recent.length);
      tickerAt += 1;
      flashes.set(entry.url, 1);
      const lantern = lanternList.find((each) => each.entry.url === entry.url);
      if (lantern !== undefined) {
        const ring = item(rings, nextRing % rings.length);
        nextRing += 1;
        ring.life = 1;
        ring.p.copy(lantern.zone);
        ring.size = 9 + Math.sqrt(entry.additions + entry.deletions) / 6;
        for (let k = 0; k < 22; k += 1) {
          const part = parts.find((each) => !each.alive);
          if (part === undefined) break;
          Object.assign(part, {
            alive: true,
            life: 0,
            max: between(effects, 6, 11),
            petal: true,
            s: between(effects, 0.8, 1.3),
          });
          part.p
            .copy(lantern.zone)
            .add(
              p
                .set(between(effects, -1, 1), between(effects, -0.5, 1), between(effects, -1, 1))
                .multiplyScalar(2),
            );
          part.v.set(
            between(effects, -2.5, 2.5),
            between(effects, 1, 3.5),
            between(effects, -2.5, 2.5),
          );
          part.rot.set(effects() * 6, effects() * 6, effects() * 6);
          part.spin.set(between(effects, -3, 3), between(effects, -3, 3), between(effects, -3, 3));
        }
      }
      return entry.zonePaths[0];
    },
    pose: (dt, t, still) => {
      if (still) flashes.clear();
      for (const [url, flash] of flashes) {
        if (flash - dt * 0.6 <= 0) flashes.delete(url);
        else flashes.set(url, flash - dt * 0.6);
      }
      layMotion(t, still);
      smoke.forEach((puff, index) => {
        const wound = wounds[puff.wound];
        if (wound === undefined || still || !shown.defects) {
          glow.over.set(smokeFirst + index, 0, 0, 0, 0, 0, 0, 0, 0);
          return;
        }
        puff.life += dt;
        if (puff.life > puff.max) puff.life = 0;
        const f = puff.life / puff.max;
        p.copy(wound.p)
          .add(puff.off)
          .addScaledVector(puff.drift, puff.life * (0.6 + wound.r * 0.55));
        p.x += Math.sin(t + index) * f * 0.8;
        glow.over.set(
          smokeFirst + index,
          p.x,
          p.y,
          p.z,
          (0.8 + f * 3.2) * (0.5 + wound.r * 0.5),
          0.07,
          0.025,
          0.07,
          Math.sin(f * Math.PI) * 0.75,
        );
      });
      embers.forEach((ember, index) => {
        const wound = wounds[ember.wound];
        if (wound === undefined || still || !shown.defects) {
          glow.add.set(emberFirst + index, 0, 0, 0, 0, 0, 0, 0, 0);
          return;
        }
        ember.life += dt;
        if (ember.life > ember.max) ember.life = 0;
        const f = ember.life / ember.max;
        p.copy(wound.p).add(ember.off).addScaledVector(ember.v, ember.life);
        p.x += Math.sin(t * 3 + index) * 0.2 * f;
        glow.add.set(
          emberFirst + index,
          p.x,
          p.y,
          p.z,
          0.16 + 0.1 * Math.sin(t * 12 + index),
          colors.defect.r * 2,
          colors.defect.g * 2,
          colors.defect.b * 2,
          (1 - f) * (0.6 + 0.4 * Math.sin(t * 20 + index * 3)),
        );
      });
      rings.forEach((ring, index) => {
        ring.life = Math.max(0, ring.life - dt / 1.1);
        glow.add.set(
          ringFirst + index,
          ring.p.x,
          ring.p.y,
          ring.p.z,
          ring.size * (0.25 + 1.2 * (1 - ring.life)),
          colors.shipped.r * 1.6,
          colors.shipped.g * 1.6,
          colors.shipped.b * 1.6,
          still ? 0 : ring.life * ring.life,
          GLOW_SHAPE.RING,
        );
      });
      // Petals fall from the freshest blossoms, and leaves from the canopy.
      spawnDue += still ? 0 : dt;
      const petalRate = shown.shipped ? Math.min(4, petalSources.length * 0.05) : 0;
      while (spawnDue > 0.05) {
        spawnDue -= 0.05;
        const petal = effects() < petalRate * 0.05 && petalSources.length > 0;
        const leaf = !petal && effects() < 0.06 && leafSources.length > 0;
        if (!petal && !leaf) continue;
        const part = parts.find((each) => !each.alive);
        if (part === undefined) continue;
        if (petal) {
          const source = item(petalSources, Math.floor(effects() * petalSources.length));
          if (effects() > source.w) continue;
          part.p.copy(source.p);
        } else {
          const clump = item(leafSources, Math.floor(effects() * leafSources.length));
          part.p
            .copy(clump.c)
            .add(
              p
                .set(between(effects, -1, 1), between(effects, -0.5, 0.5), between(effects, -1, 1))
                .multiplyScalar(clump.r),
            );
        }
        Object.assign(part, {
          alive: true,
          life: 0,
          max: between(effects, 6, 11),
          petal,
          s: petal ? between(effects, 0.8, 1.3) : between(effects, 1.4, 2.1),
        });
        part.v.set(
          between(effects, -0.3, 0.3),
          between(effects, -0.2, 0.1),
          between(effects, -0.3, 0.3),
        );
        part.rot.set(effects() * 6, effects() * 6, effects() * 6);
        part.spin.set(between(effects, -3, 3), between(effects, -3, 3), between(effects, -3, 3));
        drift.setColorAt(
          parts.indexOf(part),
          petal
            ? colors.shipped
            : c.setHSL(between(effects, 0.16, 0.3), 0.6, between(effects, 0.4, 0.55)),
        );
        if (drift.instanceColor !== null) drift.instanceColor.needsUpdate = true;
      }
      parts.forEach((part, index) => {
        if (part.alive && !still) {
          part.life += dt;
          const wind = Math.sin(t * 0.3 + part.p.y * 0.1) * 0.6 + 0.4;
          part.v.x += (wind * 0.5 - part.v.x * 0.6) * dt;
          part.v.z += (Math.cos(t * 0.23 + part.p.x * 0.1) * 0.35 - part.v.z * 0.6) * dt;
          part.v.y += (-0.55 - part.v.y) * dt * 0.8;
          part.p.addScaledVector(part.v, dt);
          part.p.x += Math.sin(t * 2 + index) * dt * 0.3;
          part.rot.x += part.spin.x * dt;
          part.rot.y += part.spin.y * dt;
          part.rot.z += part.spin.z * dt;
          if (part.life > part.max || part.p.y < -30) part.alive = false;
        }
        const fade =
          part.alive && !still
            ? Math.min(1, part.life * 2) * Math.min(1, (part.max - part.life) * 0.8)
            : 0;
        matrix.compose(
          part.p,
          turn.setFromEuler(part.rot),
          scale.setScalar(Math.max(0.0001, fade * part.s)),
        );
        drift.setMatrixAt(index, matrix);
      });
      drift.count = DRIFT;
      drift.instanceMatrix.needsUpdate = true;
    },
  };
}
