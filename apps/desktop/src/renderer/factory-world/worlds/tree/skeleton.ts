import { ZONE_LAYER, type ZoneView } from "@luke/ui/factory-world";
import { CatmullRomCurve3, MathUtils, Vector3 } from "three";
import {
  between,
  edgeRadius,
  groundY,
  ISLAND_DEPTH,
  meadowPoint,
  randomOf,
  seedOf,
  smooth,
  UP,
} from "./nature";

/**
 * skeleton.ts -- the World Tree's wood as curves: which zone is which root, strand, limb, branch, or meadow path, where each runs, and how a gardener walks from one to another.
 *
 * The repository is a tree on a floating island, its layers read from the
 * ground down and the trunk up:
 *
 *   - core: a root, below the meadow, as thick as the zone is large and as
 *     much as the rest leans on it, reaching out at the zone's layout angle.
 *   - domain: a strand of the braided trunk, peeling off into its limb at
 *     the zone's layout angle; the largest is the leader, the crown's top.
 *     A domain zone sitting inside another is a limb off that one.
 *   - surface: a branch off the domain limb it sits inside, else the one it
 *     depends on nearest its own angle, else the nearest limb, else the
 *     heartwood itself.
 *   - tooling: a place on the meadow at the zone's angle, reached from the
 *     trunk along stepping stones.
 *
 * Sizes read a zone's footprint as the mockup read the square root of its
 * lines (`SPAN_OF_LARGEST`), so the largest zone is as large as the
 * mockup's. Each zone's jitter is seeded by its own path.
 */

export const BRANCH_KIND = {
  /** The column every walk passes through: the base of the trunk. */
  BASE: "base",
  /** The heartwood column the strands braid around. */
  HEART: "heart",
  /** A domain zone: a trunk strand peeling into its limb. */
  LIMB: "limb",
  /** A zone off a limb: a surface zone, or a domain zone inside another. */
  BRANCH: "branch",
  /** A core zone. */
  ROOT: "root",
  /** A tooling zone: a path across the meadow. */
  GROUND: "ground",
} as const;

type BranchKind = (typeof BRANCH_KIND)[keyof typeof BRANCH_KIND];

/** What the mockup's largest zone measured as `sqrt(lines)`: the span a footprint of 1 grows to. */
const SPAN_OF_LARGEST = 285;

/** The least angle, in radians, two of a ring's zones stand apart before one is pushed off the other. */
const ANGLE_GAP = {
  STRAND: 0.26,
  ROOT: 0.3,
  GROUND: 0.2,
} as const;

/** The most branches that grow straight off one limb; more grow off its branches. */
const MAX_DIRECT_BRANCHES = 3;

/** The heartwood's height: the leader strand peels at its top. */
export const HEART_HEIGHT = 16.6;

/** One sample along a branch's curve: its point, its radius there, and its frame. */
export interface Sample {
  readonly p: Vector3;
  readonly r: number;
  readonly t: number;
  readonly tan: Vector3;
  readonly n: Vector3;
  readonly b: Vector3;
  readonly len: number;
}

export interface Branch {
  readonly kind: BranchKind;
  /** The zone's slot in the zone texture; the heartwood's is `HEART_SLOT`. */
  readonly slot: number;
  readonly parent: Branch | undefined;
  /** Where along its parent it grows from. */
  readonly attachT: number;
  readonly curve: CatmullRomCurve3 | undefined;
  readonly len: number;
  readonly radius: (t: number) => number;
  /** Where a strand peels off the trunk into its limb; zero for any other. */
  readonly tPeel: number;
  readonly samples: readonly Sample[];
}

/** One zone as the tree grows it. */
interface ZoneSite {
  readonly zone: ZoneView;
  readonly slot: number;
  readonly branch: Branch;
  /** Where the zone's label and a flight aim. */
  readonly center: Vector3;
  /** Its share of the root system's weight, for a root. */
  readonly weight: number;
  /** Whether another zone's branch grows off it. */
  readonly hasKids: boolean;
}

export interface Skeleton {
  readonly base: Branch;
  readonly heart: Branch;
  readonly branches: readonly Branch[];
  readonly sites: ReadonlyMap<string, ZoneSite>;
}

/** A list's item at `index`, held to its ends; the lists here are never empty. */
export function item<T>(list: readonly T[], index: number): T {
  const value = list[MathUtils.clamp(Math.floor(index), 0, list.length - 1)];
  if (value === undefined) throw new Error("tree: an empty list where samples were expected");
  return value;
}

/** How wide a zone reads, as the mockup's square root of its lines. */
export function spanOf(zone: ZoneView): number {
  return zone.footprint * SPAN_OF_LARGEST;
}

export function sampleCurve(
  curve: CatmullRomCurve3,
  count: number,
  radius: (t: number) => number,
): Sample[] {
  const frames = curve.computeFrenetFrames(count - 1, false);
  const length = curve.getLength();
  const samples: Sample[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    samples.push({
      p: curve.getPointAt(t),
      r: radius(t),
      t,
      tan: item(frames.tangents, index).clone(),
      n: item(frames.normals, index).clone(),
      b: item(frames.binormals, index).clone(),
      len: t * length,
    });
  }
  return samples;
}

/** The point, radius, and frame a fraction `t` along `branch`. */
export function branchPoint(branch: Branch, t: number): Sample {
  const samples = branch.samples;
  const first = item(samples, 0);
  if (samples.length === 1) {
    return { ...first, p: first.p.clone(), tan: first.tan.clone(), n: first.n.clone() };
  }
  const f = MathUtils.clamp(t, 0, 1) * (samples.length - 1);
  const index = Math.min(samples.length - 2, Math.floor(f));
  const k = f - index;
  const a = item(samples, index);
  const c = item(samples, index + 1);
  return {
    p: a.p.clone().lerp(c.p, k),
    r: a.r + (c.r - a.r) * k,
    t,
    tan: a.tan.clone().lerp(c.tan, k).normalize(),
    n: a.n.clone().lerp(c.n, k).normalize(),
    b: a.b.clone().lerp(c.b, k).normalize(),
    len: a.len + (c.len - a.len) * k,
  };
}

/** Which way is "up" on a branch's bark at `p`: the sky on a level limb, outward on a steep one. */
function topDirection(p: Vector3, tan: Vector3, out: Vector3): Vector3 {
  const radial = new Vector3(p.x, 0, p.z);
  if (radial.lengthSq() < 1e-4) radial.set(1, 0, 0);
  radial.normalize();
  const k = smooth(0.45, 0.92, Math.abs(tan.dot(UP)));
  out
    .copy(UP)
    .multiplyScalar(1 - k)
    .addScaledVector(radial, k);
  out.addScaledVector(tan, -tan.dot(out)).normalize();
  return out;
}

/** A point on the bark of `branch` at `t`, turned `angle` from its top, `lift` off it. */
export function surfacePoint(branch: Branch, t: number, angle: number, lift = 0) {
  const at = branchPoint(branch, t);
  const top = topDirection(at.p, at.tan, new Vector3());
  const side = new Vector3().crossVectors(at.tan, top).normalize();
  const dir = top.clone().multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle));
  return { p: at.p.clone().addScaledVector(dir, at.r + lift), dir, at, top, side };
}

function makeBranch(fields: {
  kind: BranchKind;
  slot: number;
  parent: Branch;
  attachT: number;
  points: Vector3[];
  radius: (t: number) => number;
  tPeel?: number;
}): Branch {
  const curve = new CatmullRomCurve3(fields.points, false, "centripetal", 0.5);
  const len = curve.getLength();
  return {
    kind: fields.kind,
    slot: fields.slot,
    parent: fields.parent,
    attachT: fields.attachT,
    curve,
    len,
    radius: fields.radius,
    tPeel: fields.tPeel ?? 0,
    samples: sampleCurve(curve, Math.max(24, Math.round(len * 2.2)), fields.radius),
  };
}

/** The angle from `from` to `to`, folded into [0, π]. */
function angleApart(from: number, to: number): number {
  const turn = Math.abs(((((to - from) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return turn;
}

/**
 * Each zone's angle round the trunk: its layout angle, pushed apart from a
 * neighbour in the same ring only where the two stand closer than `gap`
 * radians, so two limbs never grow through each other. Pushes are even
 * either side, so a crowded group keeps its order and stays centred on its
 * own layout angle.
 */
function separateAngles(zones: readonly ZoneView[], wanted: number): Map<string, number> {
  const sorted = [...zones].sort((a, b) => a.angle - b.angle || (a.path < b.path ? -1 : 1));
  const angles = sorted.map((zone) => zone.angle);
  const n = angles.length;
  const gap = Math.min(wanted, ((2 * Math.PI) / Math.max(1, n)) * 0.9);
  for (let pass = 0; pass < 600 && n > 1; pass += 1) {
    let moved = false;
    for (let i = 0; i < n; i += 1) {
      const j = (i + 1) % n;
      const apart = (angles[j] ?? 0) - (angles[i] ?? 0) + (j === 0 ? 2 * Math.PI : 0);
      if (apart >= gap - 1e-6) continue;
      const push = (gap - apart) / 2;
      angles[i] = (angles[i] ?? 0) - push;
      angles[j] = (angles[j] ?? 0) + push;
      moved = true;
    }
    if (!moved) break;
  }
  return new Map(sorted.map((zone, index) => [zone.path, angles[index] ?? zone.angle]));
}

/** The zone `path` sits inside among `among`: the dependency that is its own directory's ancestor, the deepest. */
function containerOf(zone: ZoneView, among: ReadonlyMap<string, ZoneView>): ZoneView | undefined {
  return zone.dependsOn
    .filter((path) => zone.path.startsWith(`${path}/`))
    .flatMap((path) => among.get(path) ?? [])
    .sort((left, right) => right.path.length - left.path.length)[0];
}

/** Grows the tree's skeleton from the zones, each in `slotOf`'s slot. */
export function growSkeleton(
  zones: readonly ZoneView[],
  slotOf: ReadonlyMap<string, number>,
  heartSlot: number,
): Skeleton {
  const origin: Sample = {
    p: new Vector3(0, 0.2, 0),
    r: 0,
    t: 0,
    tan: UP.clone(),
    n: new Vector3(1, 0, 0),
    b: new Vector3(0, 0, 1),
    len: 0,
  };
  const base: Branch = {
    kind: BRANCH_KIND.BASE,
    slot: heartSlot,
    parent: undefined,
    attachT: 0,
    curve: undefined,
    len: 0,
    radius: () => 0,
    tPeel: 0,
    samples: [origin],
  };
  const heart = makeBranch({
    kind: BRANCH_KIND.HEART,
    slot: heartSlot,
    parent: base,
    attachT: 0,
    points: [
      new Vector3(0, 0.2, 0),
      new Vector3(0.1, 5, 0.05),
      new Vector3(-0.05, 12, 0.1),
      new Vector3(0, HEART_HEIGHT, 0),
    ],
    radius: (t) => 1.18 - 0.72 * smooth(0.5, 1, t),
  });
  const branches: Branch[] = [heart];
  const branchOf = new Map<string, Branch>();
  const slot = (zone: ZoneView) => slotOf.get(zone.path) ?? heartSlot;
  const inLayer = (layer: ZoneView["layer"]) => zones.filter((zone) => zone.layer === layer);
  const domainByPath = new Map(inLayer(ZONE_LAYER.DOMAIN).map((zone) => [zone.path, zone]));

  // Note that a domain zone inside another domain zone is a limb off it rather than one more strand, so a deep tree stays one trunk.
  const strands = inLayer(ZONE_LAYER.DOMAIN).filter(
    (zone) => containerOf(zone, domainByPath) === undefined,
  );
  growStrands(strands, slot, base, branches, branchOf);
  const offshoots = zones.filter(
    (zone) =>
      zone.layer === ZONE_LAYER.SURFACE ||
      (zone.layer === ZONE_LAYER.DOMAIN && !strands.includes(zone)),
  );
  const kids = growBranches(offshoots, domainByPath, heart, slot, branches, branchOf);
  growRoots(inLayer(ZONE_LAYER.CORE), slot, base, branches, branchOf);
  const spots = growGround(inLayer(ZONE_LAYER.TOOLING), slot, base, branches, branchOf);

  const sites = new Map<string, ZoneSite>();
  const largestReach = Math.max(1, ...zones.map((zone) => zone.transitiveDependents));
  for (const zone of zones) {
    const branch = branchOf.get(zone.path);
    if (branch === undefined) continue;
    const t =
      branch.kind === BRANCH_KIND.ROOT ? 0.35 : branch.kind === BRANCH_KIND.LIMB ? 0.85 : 0.8;
    const spot = spots.get(zone.path);
    const site: ZoneSite = {
      zone,
      slot: slot(zone),
      branch,
      center: spot === undefined ? branchPoint(branch, t).p : spot.clone().add(UP),
      weight: 0.5 * zone.footprint + 0.5 * (zone.transitiveDependents / largestReach),
      hasKids: kids.has(zone.path),
    };
    sites.set(zone.path, site);
  }
  return { base, heart, branches, sites };
}

/** The domain strands braided into the trunk, each peeling into its limb. */
function growStrands(
  strands: readonly ZoneView[],
  slot: (zone: ZoneView) => number,
  base: Branch,
  branches: Branch[],
  branchOf: Map<string, Branch>,
): void {
  if (strands.length === 0) return;
  const spread = separateAngles(strands, ANGLE_GAP.STRAND);
  const leader = strands.reduce((a, b) => (b.footprint > a.footprint ? b : a));
  const rest = strands
    .filter((zone) => zone !== leader)
    .sort((a, b) => b.footprint - a.footprint || (a.path < b.path ? -1 : 1));
  const twist = 0.13;
  // Note that a crowded trunk thins its strands, so forty strands braid as tightly as the mockup's twelve.
  const thinning = Math.min(1, Math.sqrt(12 / Math.max(1, strands.length)));
  [...rest, leader].forEach((zone, index) => {
    const random = randomOf(seedOf(zone.path, 1));
    const isLeader = zone === leader;
    const span = spanOf(zone);
    const h = isLeader
      ? HEART_HEIGHT - 0.2
      : 5.4 + (rest.length > 1 ? index * (9.6 / (rest.length - 1)) : 4.8);
    const theta = spread.get(zone.path) ?? zone.angle;
    const rs = (0.34 + span / 290) * thinning;
    const ring = 1.05 + rs * 0.35;
    const start = theta - twist * h;
    const points: Vector3[] = [];
    for (let y = 0.1; y < h - 0.6; y += 1.2) {
      const a = start + twist * y;
      const rad = isLeader
        ? ring * (1 - smooth(h * 0.55, h, y) * 0.9)
        : ring + smooth(h - 3, h, y) * 0.4;
      points.push(new Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad));
    }
    const peel = item(points, points.length - 1).clone();
    const dir = new Vector3(Math.cos(theta), 0, Math.sin(theta));
    const length = 4.6 + span / 21;
    const lift = isLeader ? 0.8 : 0.3 + ((h - 5.4) / 9.6) * 0.35;
    const reach = isLeader ? 0.32 : 1;
    const jitter = () =>
      new Vector3(
        between(random, -0.4, 0.4),
        between(random, -0.3, 0.3),
        between(random, -0.4, 0.4),
      );
    points.push(
      peel
        .clone()
        .addScaledVector(dir, length * 0.22 * reach)
        .addScaledVector(UP, length * (0.08 + lift * 0.18) + 0.6),
      peel
        .clone()
        .addScaledVector(dir, length * 0.55 * reach)
        .addScaledVector(UP, length * (0.18 + lift * 0.4))
        .add(jitter()),
      peel
        .clone()
        .addScaledVector(dir, length * 0.82 * reach)
        .addScaledVector(UP, length * (0.3 + lift * 0.6))
        .add(jitter()),
      peel
        .clone()
        .addScaledVector(dir, length * reach)
        .addScaledVector(UP, length * (0.4 + lift * 0.75)),
    );
    const strandLength = (h - 0.6) * 1.02;
    const tPeel = strandLength / (strandLength + length * 1.15);
    const branch = makeBranch({
      kind: BRANCH_KIND.LIMB,
      slot: slot(zone),
      parent: base,
      attachT: 0,
      points,
      tPeel,
      radius: (t) => (t < tPeel ? rs : rs * (1 - 0.68 * smooth(tPeel, 1, t))),
    });
    branches.push(branch);
    branchOf.set(zone.path, branch);
  });
}

/**
 * The branches off the limbs, parents before children: each grows from the
 * branch it sits inside, else from the limb of the domain zone it depends on
 * nearest its own angle, else the nearest limb, else the heartwood. Answers
 * the zones another branch grows off.
 */
function growBranches(
  offshoots: readonly ZoneView[],
  domainByPath: ReadonlyMap<string, ZoneView>,
  heart: Branch,
  slot: (zone: ZoneView) => number,
  branches: Branch[],
  branchOf: Map<string, Branch>,
): Set<string> {
  // Note that the domain zones are placed first and the larger before the smaller, so a nested limb is there to hang from and the largest branches take the direct places.
  const order = [...offshoots].sort(
    (a, b) =>
      Number(b.layer === ZONE_LAYER.DOMAIN) - Number(a.layer === ZONE_LAYER.DOMAIN) ||
      b.footprint - a.footprint ||
      (a.path < b.path ? -1 : 1),
  );
  const parentOf = new Map<string, string | undefined>();
  const childrenOf = new Map<string, string[]>();
  const load = (path: string) => childrenOf.get(path)?.length ?? 0;
  const offshootByPath = new Map(offshoots.map((zone) => [zone.path, zone]));
  const footprintOf = (path: string) => offshootByPath.get(path)?.footprint ?? 0;
  for (const zone of order) {
    const container = containerOf(zone, domainByPath);
    const leaning = zone.dependsOn
      .flatMap((path) => domainByPath.get(path) ?? [])
      .filter((domain) => domain !== zone);
    const candidates =
      leaning.length > 0
        ? leaning
        : [...domainByPath.values()].filter(
            (domain) => domain !== zone && !domain.path.startsWith(`${zone.path}/`),
          );
    // Note that a branch hangs off the limb it depends on with the fewest branches yet, so one busy directory does not pile its whole canopy on one limb.
    const chosen = [...candidates].sort(
      (a, b) =>
        load(a.path) - load(b.path) ||
        Number(b === container) - Number(a === container) ||
        angleApart(zone.angle, a.angle) - angleApart(zone.angle, b.angle) ||
        (a.path < b.path ? -1 : 1),
    )[0];
    let parent = chosen?.path;
    // Note that a full limb passes a branch on to the least laden of its own branches, which spreads the crown outward.
    for (
      let hops = 0;
      parent !== undefined && load(parent) >= MAX_DIRECT_BRANCHES && hops < 6;
      hops += 1
    ) {
      const onward: string[] = childrenOf.get(parent) ?? [];
      parent = [...onward].sort(
        (a, b) => load(a) - load(b) || footprintOf(b) - footprintOf(a) || (a < b ? -1 : 1),
      )[0];
    }
    parentOf.set(zone.path, parent);
    if (parent !== undefined)
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), zone.path]);
  }
  const kids = new Set<string>();
  // Note that siblings fan out in their layout order, so neighbouring directories stay neighbouring twigs.
  const fanOf = new Map<string, { k: number; count: number }>();
  const byParent = new Map<string | undefined, ZoneView[]>();
  for (const zone of offshoots) {
    const parent = parentOf.get(zone.path);
    byParent.set(parent, [...(byParent.get(parent) ?? []), zone]);
  }
  for (const children of byParent.values()) {
    children
      .sort((a, b) => a.angle - b.angle || (a.path < b.path ? -1 : 1))
      .forEach((zone, k) => {
        fanOf.set(zone.path, { k, count: children.length });
      });
  }
  const heartAngles = separateAngles(byParent.get(undefined) ?? [], ANGLE_GAP.STRAND);
  const pending = [...offshoots].sort((a, b) => (a.path < b.path ? -1 : 1));
  // Note that a parent grows before its children: a pass that places nothing breaks a cycle by growing the rest off the heartwood.
  while (pending.length > 0) {
    let placed = false;
    for (let index = 0; index < pending.length; ) {
      const zone = item(pending, index);
      const parentPath = parentOf.get(zone.path);
      const parentBranch = parentPath === undefined ? heart : branchOf.get(parentPath);
      if (parentBranch === undefined) {
        index += 1;
        continue;
      }
      pending.splice(index, 1);
      placed = true;
      if (parentPath !== undefined) kids.add(parentPath);
      const fan = fanOf.get(zone.path) ?? { k: 0, count: 1 };
      const branch = growBranch(
        zone,
        parentBranch,
        fan,
        heartAngles.get(zone.path) ?? zone.angle,
        slot(zone),
      );
      branches.push(branch);
      branchOf.set(zone.path, branch);
    }
    if (!placed) {
      for (const zone of pending) parentOf.set(zone.path, undefined);
    }
  }
  return kids;
}

/** One branch growing off `parent`, the `k`th of `count` there in layout order, fanned about its parent's way; off the heartwood, at `angle`. */
function growBranch(
  zone: ZoneView,
  parent: Branch,
  fan: { readonly k: number; readonly count: number },
  angle: number,
  zoneSlot: number,
): Branch {
  const { k, count } = fan;
  const random = randomOf(seedOf(zone.path, 2));
  const span = spanOf(zone);
  const onHeart = parent.kind === BRANCH_KIND.HEART;
  const tp = parent.tPeel;
  const along = count === 1 ? 0.62 : 0.36 + 0.56 * ((k + 0.5) / count);
  const attachT = onHeart ? 0.45 + 0.5 * ((k + 0.5) / count) : tp + (1 - tp) * along;
  const at = branchPoint(parent, attachT);
  const flat = new Vector3(at.tan.x, 0, at.tan.z);
  if (onHeart || flat.lengthSq() < 1e-4) flat.set(Math.cos(angle), 0, Math.sin(angle));
  flat.normalize();
  // Note that a lone branch turns aside from its parent, as the mockup's first did, and siblings fan across it.
  const width = Math.min(0.9, 0.35 * count);
  const turn = onHeart
    ? 0
    : count === 1
      ? (seedOf(zone.path) % 2 === 0 ? 1 : -1) * 0.55
      : -width + (2 * width * k) / (count - 1);
  const dir = flat.clone().applyAxisAngle(UP, turn);
  const length = (4.2 + span / 21) * (parent.kind === BRANCH_KIND.BRANCH ? 0.8 : 1);
  const lift = 0.5 + between(random, 0, 0.25);
  const points = [
    at.p.clone(),
    at.p
      .clone()
      .addScaledVector(dir, length * 0.3)
      .addScaledVector(UP, length * 0.14),
    at.p
      .clone()
      .addScaledVector(dir, length * 0.62)
      .addScaledVector(UP, length * lift * 0.55)
      .add(new Vector3(between(random, -0.4, 0.4), 0, between(random, -0.4, 0.4))),
    at.p
      .clone()
      .addScaledVector(dir, length * 0.88)
      .addScaledVector(UP, length * lift * 0.85),
    at.p
      .clone()
      .addScaledVector(dir, length)
      .addScaledVector(UP, length * lift),
  ];
  const r0 = Math.min(0.16 + span / 330, at.r * 0.9);
  return makeBranch({
    kind: BRANCH_KIND.BRANCH,
    slot: zoneSlot,
    parent,
    attachT,
    points,
    radius: (t) => r0 * (1 - 0.72 * t),
  });
}

/** The core zones as roots, reaching down through the island's earth at their layout angles. */
function growRoots(
  cores: readonly ZoneView[],
  slot: (zone: ZoneView) => number,
  base: Branch,
  branches: Branch[],
  branchOf: Map<string, Branch>,
): void {
  const largestReach = Math.max(1, ...cores.map((zone) => zone.transitiveDependents));
  const spread = separateAngles(cores, ANGLE_GAP.ROOT);
  for (const zone of cores) {
    const random = randomOf(seedOf(zone.path, 3));
    const w = 0.5 * zone.footprint + 0.5 * (zone.transitiveDependents / largestReach);
    const r0 = (0.32 + 0.95 * w) * Math.min(1, Math.sqrt(8 / Math.max(1, cores.length)));
    const phi = (spread.get(zone.path) ?? zone.angle) + between(random, -0.12, 0.12);
    const tip = -(ISLAND_DEPTH + 3 + 8 * w + between(random, 0, 2));
    const profile = [
      [1.3, 1.1],
      [3.4, 0.45],
      [5.6, -1.8],
      [7.2, -5.5],
      [6.8, -9.5],
      [5.4, -13.5],
      [4.0, -17.2],
      [3.1, -20.5],
      [2.4 + between(random, 0, 1), tip + 2.5],
      [2.0 + between(random, 0, 1.5), tip],
    ] as const;
    const twist = between(random, 0, 6);
    const points = profile.map(([rho, y], k) => {
      const a = phi + Math.sin(k * 1.3 + twist) * 0.16;
      return new Vector3(Math.cos(a) * rho, y, Math.sin(a) * rho);
    });
    const branch = makeBranch({
      kind: BRANCH_KIND.ROOT,
      slot: slot(zone),
      parent: base,
      attachT: 0,
      points,
      radius: (t) => r0 * (1 - 0.82 * smooth(0, 1, t)) * (1 + 0.35 * (1 - smooth(0, 0.1, t))),
    });
    branches.push(branch);
    branchOf.set(zone.path, branch);
  }
}

/** The tooling zones as places on the meadow, nudged apart, each reached along a path from the trunk; answers each place. */
function growGround(
  tools: readonly ZoneView[],
  slot: (zone: ZoneView) => number,
  base: Branch,
  branches: Branch[],
  branchOf: Map<string, Branch>,
): Map<string, Vector3> {
  // Note that the tooling ring's band, radius 3.2 to 3.8 on the layout, spreads across the meadow from 13 to 20 units out.
  const spread = separateAngles(tools, ANGLE_GAP.GROUND);
  const places = tools.map((zone) => ({
    zone,
    theta: spread.get(zone.path) ?? zone.angle,
    rho: MathUtils.clamp(13 + (zone.radius - 3.2) * (7 / 0.6), 12.5, 20.5),
  }));
  for (let pass = 0; pass < 24; pass += 1) {
    for (const a of places) {
      for (const b of places) {
        if (a === b) continue;
        const apart = Math.hypot(
          Math.cos(a.theta) * a.rho - Math.cos(b.theta) * b.rho,
          Math.sin(a.theta) * a.rho - Math.sin(b.theta) * b.rho,
        );
        if (apart > 3.4) continue;
        const push = (3.4 - apart) / Math.max(a.rho, 1) / 2;
        const side = a.zone.path < b.zone.path ? -1 : 1;
        a.theta += side * push;
      }
    }
  }
  const spots = new Map<string, Vector3>();
  for (const place of places) {
    const theta = place.theta;
    const rim = edgeRadius(theta) - 2.5;
    const rho = Math.min(place.rho, rim);
    const points: Vector3[] = [];
    for (let k = 0; k <= 6; k += 1) {
      const r = 3.4 + (rho - 3.4) * (k / 6);
      points.push(meadowPoint(r, theta + Math.sin(k * 1.1) * 0.06, 0.02));
    }
    const branch = makeBranch({
      kind: BRANCH_KIND.GROUND,
      slot: slot(place.zone),
      parent: base,
      attachT: 0,
      points,
      radius: () => 0,
    });
    branches.push(branch);
    branchOf.set(place.zone.path, branch);
    const spot = item(points, points.length - 1).clone();
    spot.y = groundY(spot.x, spot.z);
    spots.set(place.zone.path, spot);
  }
  return spots;
}

/** A path across the meadow from the trunk to `rho` out at `theta`, for whatever stands there with no zone of its own. */
export function meadowBranch(base: Branch, slot: number, theta: number, rho: number): Branch {
  const points: Vector3[] = [];
  for (let k = 0; k <= 4; k += 1)
    points.push(meadowPoint(3.4 + (rho - 3.4) * (k / 4), theta, 0.02));
  return makeBranch({
    kind: BRANCH_KIND.GROUND,
    slot,
    parent: base,
    attachT: 0,
    points,
    radius: () => 0,
  });
}

/* ------------------------------------------------------------------ walks along the tree */

function slice(branch: Branch, t0: number, t1: number): Sample[] {
  const samples = branch.samples;
  if (samples.length === 1) return [item(samples, 0)];
  const out = [branchPoint(branch, t0)];
  const n = samples.length - 1;
  if (t1 > t0) {
    for (let index = Math.ceil(t0 * n + 1e-6); index < t1 * n; index += 1)
      out.push(item(samples, index));
  } else {
    for (let index = Math.floor(t0 * n - 1e-6); index > t1 * n; index -= 1)
      out.push(item(samples, index));
  }
  out.push(branchPoint(branch, t1));
  return out;
}

function chainOf(branch: Branch, t: number): Array<[Branch, number]> {
  const chain: Array<[Branch, number]> = [];
  for (
    let at: Branch | undefined = branch, along = t;
    at !== undefined;
    along = at.attachT, at = at.parent
  ) {
    chain.push([at, along]);
  }
  return chain;
}

/** The samples a walk from `(a, ta)` to `(b, tb)` passes, through the two branches' lowest common ancestor. */
export function treePath(a: Branch, ta: number, b: Branch, tb: number): Sample[] {
  const fromA = chainOf(a, ta);
  const fromB = chainOf(b, tb);
  let ia = -1;
  let ib = -1;
  for (let index = 0; index < fromA.length && ia < 0; index += 1) {
    const found = fromB.findIndex(([branch]) => branch === item(fromA, index)[0]);
    if (found >= 0) {
      ia = index;
      ib = found;
    }
  }
  const points: Sample[] = [];
  for (let index = 0; index < ia; index += 1) {
    const [branch, t] = item(fromA, index);
    points.push(...slice(branch, t, 0));
  }
  const [common, tFrom] = item(fromA, ia);
  points.push(...slice(common, tFrom, item(fromB, ib)[1]));
  for (let index = ib - 1; index >= 0; index -= 1) {
    const [branch, t] = item(fromB, index);
    points.push(...slice(branch, 0, t));
  }
  return points;
}

/** A walkable path: centreline, radius, a top and a side direction per point, and its running length. */
export interface Walk {
  readonly centre: readonly Vector3[];
  readonly radius: readonly number[];
  readonly top: readonly Vector3[];
  readonly side: readonly Vector3[];
  readonly length: Float32Array;
  readonly total: number;
}

export function bakeWalk(samples: readonly Sample[]): Walk {
  const clean = [item(samples, 0)];
  for (const sample of samples.slice(1)) {
    if (sample.p.distanceToSquared(item(clean, clean.length - 1).p) > 1e-4) clean.push(sample);
  }
  const n = clean.length;
  const centre: Vector3[] = [];
  const radius: number[] = [];
  const top: Vector3[] = [];
  const side: Vector3[] = [];
  const length = new Float32Array(n);
  for (let index = 0; index < n; index += 1) {
    const here = item(clean, index);
    const tan = item(clean, index + 1)
      .p.clone()
      .sub(item(clean, index - 1).p);
    if (tan.lengthSq() < 1e-8) tan.copy(UP);
    else tan.normalize();
    const d = topDirection(here.p, tan, new Vector3());
    centre.push(here.p.clone());
    radius.push(here.r);
    top.push(d);
    side.push(new Vector3().crossVectors(tan, d).normalize());
    if (index > 0)
      length[index] = (length[index - 1] ?? 0) + here.p.distanceTo(item(clean, index - 1).p);
  }
  return { centre, radius, top, side, length, total: Math.max(length[n - 1] ?? 0, 0.001) };
}

/** Where a walker stands `s` along `walk`, turned `angle` round its bark, `lift` off it; writes its heading into `heading`. */
export function walkAt(
  walk: Walk,
  s: number,
  angle: number,
  lift: number,
  out: Vector3,
  heading?: Vector3,
): Vector3 {
  const at = MathUtils.clamp(s, 0, walk.total);
  let lo = 0;
  let hi = walk.centre.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((walk.length[mid] ?? 0) <= at) lo = mid;
    else hi = mid;
  }
  const from = walk.length[lo] ?? 0;
  const segment = (walk.length[hi] ?? 0) - from;
  const k = segment > 1e-6 ? (at - from) / segment : 0;
  const r = item(walk.radius, lo) + (item(walk.radius, hi) - item(walk.radius, lo)) * k + lift;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const topLo = item(walk.top, lo);
  const topHi = item(walk.top, hi);
  const sideLo = item(walk.side, lo);
  const sideHi = item(walk.side, hi);
  out.copy(item(walk.centre, lo)).lerp(item(walk.centre, hi), k);
  out.x += (topLo.x * ca + sideLo.x * sa) * r * (1 - k) + (topHi.x * ca + sideHi.x * sa) * r * k;
  out.y += (topLo.y * ca + sideLo.y * sa) * r * (1 - k) + (topHi.y * ca + sideHi.y * sa) * r * k;
  out.z += (topLo.z * ca + sideLo.z * sa) * r * (1 - k) + (topHi.z * ca + sideHi.z * sa) * r * k;
  heading?.copy(item(walk.centre, hi)).sub(item(walk.centre, lo));
  return out;
}
