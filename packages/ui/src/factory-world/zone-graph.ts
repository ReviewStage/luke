import type { FactoryZone } from "@luke/features/factory-world-wire";
import { AREA_PATH } from "@luke/features/pull-request-area";

/**
 * zone-graph.ts -- a world's zones read off their dependency graph: which layer each stands in, how deep, and what depends on what.
 *
 * A snapshot names no layer (`factory-world-wire.ts`), so the layer is read
 * off the graph `dependsOn` draws, and the same reading serves any
 * repository:
 *
 *   - tooling: the root itself, and the directories at the root a
 *     repository keeps its own machinery in, a dot-directory or one of the
 *     names `TOOLING_DIRECTORY` lists by convention, with whatever sits
 *     inside them. They stand apart from the product's graph.
 *   - core: of the rest, the zones many others depend on, transitively: at
 *     least `CORE.MIN_DEPENDENTS`, and at least `CORE.SHARE` of the others.
 *   - surface: the zones nothing depends on, the edge a developer meets.
 *   - domain: everything between.
 *
 * Note that a zone's dependency on the zone it sits inside counts like any
 * other, as the contract names it, so a directory reads nearer the core
 * than the zones inside it. Tooling zones are left out of the product's
 * counts, so a script that reaches into every package pulls none of them
 * inward.
 *
 * A zone's depth is the longest chain of dependencies beneath it among the
 * zones on its own side, product or tooling: zero for one depending on
 * nothing. A cycle is cut where the walk first meets it again, walking in
 * path order, so the same snapshot always reads the same depths.
 */

/** The four layers a zone stands in, the core innermost. */
export const ZONE_LAYER = {
  CORE: "core",
  DOMAIN: "domain",
  SURFACE: "surface",
  TOOLING: "tooling",
} as const;

export type ZoneLayer = (typeof ZONE_LAYER)[keyof typeof ZONE_LAYER];

/** Each layer's ring, counted outward from the core. */
const LAYER_RING = {
  [ZONE_LAYER.CORE]: 0,
  [ZONE_LAYER.DOMAIN]: 1,
  [ZONE_LAYER.SURFACE]: 2,
  [ZONE_LAYER.TOOLING]: 3,
} as const satisfies { readonly [L in ZoneLayer]: number };

/** Why one zone depends on another: a package naming it, or a zone sitting inside it. */
export const ZONE_EDGE_KIND = {
  DEPENDS: "depends",
  INSIDE: "inside",
} as const;

/** @public Named by the Factory's worlds through `factory-world.ts`. */
export type ZoneEdgeKind = (typeof ZONE_EDGE_KIND)[keyof typeof ZONE_EDGE_KIND];

/** The directory names at a repository's root that hold its tools, scripts, and configuration by convention. */
const TOOLING_DIRECTORY = {
  TOOLS: "tools",
  TOOLING: "tooling",
  SCRIPTS: "scripts",
  SCRIPT: "script",
  BIN: "bin",
  CONFIG: "config",
  CONFIGS: "configs",
} as const;

/** How many zones must depend on one, transitively, for it to stand in the core. */
const CORE = {
  MIN_DEPENDENTS: 2,
  /** The share of the product's other zones that must depend on it. */
  SHARE: 1 / 3,
} as const;

/** One dependency between two zones of the snapshot, by path: `from` depends on `to`. */
export interface ZoneEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: ZoneEdgeKind;
}

/** What the graph says of one zone. */
export interface ZoneReading {
  readonly layer: ZoneLayer;
  readonly ring: number;
  readonly depth: number;
  /** The zones it depends on directly, by path, sorted. */
  readonly dependsOn: readonly string[];
  /** The zones that depend on it directly, by path, sorted. */
  readonly dependents: readonly string[];
  /** How many of the product's zones depend on it, transitively; zero for a tooling zone. */
  readonly transitiveDependents: number;
}

/** The snapshot's zones as a graph: every path, sorted, and the edges each way. */
interface ZoneGraph {
  readonly paths: readonly string[];
  readonly dependsOn: ReadonlyMap<string, readonly string[]>;
  readonly dependents: ReadonlyMap<string, readonly string[]>;
}

const NO_PATHS: readonly string[] = [];

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** True where `path` sits somewhere inside `ancestor`, the root holding every other path. */
function isInsideZone(path: string, ancestor: string): boolean {
  if (path === ancestor) return false;
  if (ancestor === AREA_PATH.ROOT) return true;
  return path.startsWith(ancestor) && path.charAt(ancestor.length) === "/";
}

function isTooling(path: string): boolean {
  if (path === AREA_PATH.ROOT) return true;
  const top = path.split("/")[0] ?? "";
  if (top.startsWith(".")) return true;
  return Object.values(TOOLING_DIRECTORY).some((name) => name === top);
}

/** Builds the graph, dropping a dependency on a zone the snapshot does not name, on itself, or named twice. */
function zoneGraphOf(zones: readonly FactoryZone[]): ZoneGraph {
  const known = new Set(zones.map((zone) => zone.path));
  const dependsOn = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();
  for (const zone of zones) {
    const targets = [...new Set(zone.dependsOn)].filter(
      (target) => target !== zone.path && known.has(target),
    );
    dependsOn.set(zone.path, targets.sort(byText));
    for (const target of targets) {
      dependents.set(target, [...(dependents.get(target) ?? []), zone.path]);
    }
  }
  for (const list of dependents.values()) list.sort(byText);
  return { paths: [...known].sort(byText), dependsOn, dependents };
}

/**
 * Walks outward from `origins` along `next`, breadth first, and answers each
 * zone reached with its fewest steps away, the origins at zero.
 */
export function reachOf(
  origins: readonly string[],
  next: (path: string) => readonly string[],
): Map<string, number> {
  const distance = new Map<string, number>(origins.map((path) => [path, 0]));
  let frontier = [...distance.keys()];
  for (let step = 1; frontier.length > 0; step += 1) {
    const reached: string[] = [];
    for (const path of frontier) {
      for (const neighbour of next(path)) {
        if (distance.has(neighbour)) continue;
        distance.set(neighbour, step);
        reached.push(neighbour);
      }
    }
    frontier = reached;
  }
  return distance;
}

/** The longest chain beneath each zone along the edges `follows` keeps, cutting a cycle where the walk meets it again. */
function depthsOf(
  graph: ZoneGraph,
  follows: (from: string, to: string) => boolean,
): Map<string, number> {
  const depth = new Map<string, number>();
  const walking = new Set<string>();
  const visit = (path: string): number => {
    const known = depth.get(path);
    if (known !== undefined) return known;
    if (walking.has(path)) return -1;
    walking.add(path);
    let deepest = -1;
    for (const target of graph.dependsOn.get(path) ?? NO_PATHS) {
      if (follows(path, target)) deepest = Math.max(deepest, visit(target));
    }
    walking.delete(path);
    depth.set(path, deepest + 1);
    return deepest + 1;
  };
  for (const path of graph.paths) visit(path);
  return depth;
}

function layerOf(path: string, transitiveDependents: number, productZones: number): ZoneLayer {
  if (isTooling(path)) return ZONE_LAYER.TOOLING;
  if (transitiveDependents === 0) return ZONE_LAYER.SURFACE;
  const coreAt = Math.max(CORE.MIN_DEPENDENTS, CORE.SHARE * (productZones - 1));
  return transitiveDependents >= coreAt ? ZONE_LAYER.CORE : ZONE_LAYER.DOMAIN;
}

/** Reads every zone of the snapshot off its graph, by path. */
export function zoneReadingsOf(zones: readonly FactoryZone[]): Map<string, ZoneReading> {
  const graph = zoneGraphOf(zones);
  const productZones = graph.paths.filter((path) => !isTooling(path)).length;
  const productDependents = (path: string): readonly string[] =>
    (graph.dependents.get(path) ?? NO_PATHS).filter((dependent) => !isTooling(dependent));
  const depths = depthsOf(graph, (from, to) => isTooling(from) === isTooling(to));
  const readings = new Map<string, ZoneReading>();
  for (const path of graph.paths) {
    const transitiveDependents = isTooling(path) ? 0 : reachOf([path], productDependents).size - 1;
    const layer = layerOf(path, transitiveDependents, productZones);
    readings.set(path, {
      layer,
      ring: LAYER_RING[layer],
      depth: depths.get(path) ?? 0,
      dependsOn: graph.dependsOn.get(path) ?? NO_PATHS,
      dependents: graph.dependents.get(path) ?? NO_PATHS,
      transitiveDependents,
    });
  }
  return readings;
}

/** Every dependency between two of the snapshot's zones, ordered by `from` then `to`. */
export function zoneEdgesOf(readings: ReadonlyMap<string, ZoneReading>): ZoneEdge[] {
  const edges: ZoneEdge[] = [];
  for (const [from, reading] of readings) {
    for (const to of reading.dependsOn) {
      edges.push({
        from,
        to,
        kind: isInsideZone(from, to) ? ZONE_EDGE_KIND.INSIDE : ZONE_EDGE_KIND.DEPENDS,
      });
    }
  }
  return edges;
}

/**
 * The zone an area of a pull request lands in: the zone at its path, else
 * the deepest zone it sits inside, the root's last, since every path sits
 * inside the root. The remainder (`AREA_PATH.REST`) is no directory and
 * lands nowhere.
 */
export function zoneOfAreaIn(zonePaths: readonly string[]): (areaPath: string) => string | null {
  const depthOf = (path: string): number => (path === AREA_PATH.ROOT ? 0 : path.split("/").length);
  const deepestFirst = [...zonePaths].sort((left, right) => depthOf(right) - depthOf(left));
  return (areaPath) => {
    if (areaPath === AREA_PATH.REST) return null;
    const holder = deepestFirst.find((zone) => zone === areaPath || isInsideZone(areaPath, zone));
    return holder ?? null;
  };
}
