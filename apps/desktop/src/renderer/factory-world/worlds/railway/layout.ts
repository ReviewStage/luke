import type { FactoryWorldView, ZoneLayer, ZoneView } from "@luke/ui/factory-world";
import { ZONE_LAYER } from "@luke/ui/factory-world";
import { Color, type Matrix4, Vector3 } from "three";
import { clamp, hashOf, lerp, placing, seeded, TAU, turned } from "./kit";

/**
 * layout.ts -- the railway's plan: each zone a round district on the baseboard, the tracks that ring it and the double-track mainlines that join it to what it depends on, and the route each train runs.
 *
 * A district stands where the view model's polar layout puts its zone
 * (`ZONE_LAYOUT`), scaled up so the rings hold every district, and is pushed
 * off its neighbours only as far as an overlap needs. The push reads the
 * zones only, so the same repository lays out the same board every time, and
 * a zone's district stays at its layout's place as others come and go.
 *
 * Every district is ringed by a loop of track. Mainlines follow the transitive
 * reduction of the dependency graph, because every implied edge would bury the
 * board in rails, and each is double track: every loop runs the same way
 * round, so the line out keeps right and the line back keeps right. A mainline
 * that would cross another district dives into a tunnel at its curb. A train's
 * route is a closed walk over the districts its agent touches, loop arcs joined
 * by mainlines, so it never turns a corner.
 *
 * Nothing here draws; `tracks.ts`, `town.ts`, and `scenery.ts` build meshes
 * from it.
 */

/** What a district is built as: its landmark, and what fills the rest of its plot. */
export const DISTRICT_STYLE = {
  STATION: "station",
  YARD: "yard",
  SIGNAL: "signal",
  WATER_TOWER: "watertower",
  MAST: "mast",
  CONTROL: "control",
  CLOCK_TOWER: "clocktower",
  FACTORY: "factory",
  WORKSHOP: "workshop",
  OFFICE: "office",
  WAREHOUSE: "warehouse",
  BANK: "bank",
  RADIO: "radio",
  WINDMILL: "windmill",
  GATE: "gate",
  SHOPS: "shops",
  TOWN: "town",
  PAINT: "paint",
  BILLBOARD: "billboard",
  MUSEUM: "museum",
  POWER: "power",
  HARBOR: "harbor",
  LUMBER: "lumber",
  UTILITY: "utility",
  AIRPORT: "airport",
} as const;

type DistrictStyle = (typeof DISTRICT_STYLE)[keyof typeof DISTRICT_STYLE];

/** The styles a layer's districts are drawn from, by their path's hash; its largest takes the first. */
const LAYER_STYLES = {
  [ZONE_LAYER.CORE]: [
    DISTRICT_STYLE.STATION,
    DISTRICT_STYLE.YARD,
    DISTRICT_STYLE.SIGNAL,
    DISTRICT_STYLE.WATER_TOWER,
    DISTRICT_STYLE.MAST,
    DISTRICT_STYLE.CONTROL,
    DISTRICT_STYLE.YARD,
  ],
  [ZONE_LAYER.DOMAIN]: [
    DISTRICT_STYLE.CLOCK_TOWER,
    DISTRICT_STYLE.FACTORY,
    DISTRICT_STYLE.WORKSHOP,
    DISTRICT_STYLE.OFFICE,
    DISTRICT_STYLE.WAREHOUSE,
    DISTRICT_STYLE.BANK,
    DISTRICT_STYLE.RADIO,
    DISTRICT_STYLE.WINDMILL,
    DISTRICT_STYLE.GATE,
    DISTRICT_STYLE.WORKSHOP,
  ],
  [ZONE_LAYER.SURFACE]: [
    DISTRICT_STYLE.SHOPS,
    DISTRICT_STYLE.SHOPS,
    DISTRICT_STYLE.TOWN,
    DISTRICT_STYLE.SHOPS,
    DISTRICT_STYLE.PAINT,
    DISTRICT_STYLE.BILLBOARD,
    DISTRICT_STYLE.MUSEUM,
    DISTRICT_STYLE.POWER,
    DISTRICT_STYLE.TOWN,
  ],
  [ZONE_LAYER.TOOLING]: [
    DISTRICT_STYLE.LUMBER,
    DISTRICT_STYLE.UTILITY,
    DISTRICT_STYLE.AIRPORT,
    DISTRICT_STYLE.WORKSHOP,
    DISTRICT_STYLE.POWER,
  ],
} as const satisfies {
  readonly [Layer in ZoneLayer]: readonly [DistrictStyle, ...DistrictStyle[]];
};

/**
 * The tints a layer's districts are drawn from: sand and gold at the core,
 * brick and terracotta in the domain, sea and lilac at the surface, slate for
 * tooling. They only ever tint walls and plots a little, so the signals keep
 * their colours to themselves.
 */
const LAYER_TINTS = {
  [ZONE_LAYER.CORE]: ["#e9c46a", "#e0a43a", "#f1dca2", "#cdb37a", "#ebb75a", "#d8c48c"],
  [ZONE_LAYER.DOMAIN]: [
    "#c8553d",
    "#dc7f4c",
    "#b8692a",
    "#a24c3c",
    "#c4704f",
    "#e39f6c",
    "#bd815a",
    "#d3865a",
    "#925c47",
    "#bb8b6b",
  ],
  [ZONE_LAYER.SURFACE]: [
    "#6aa6d8",
    "#77bfc9",
    "#8db6e8",
    "#a69ad9",
    "#6fc5a8",
    "#8aa8cb",
    "#4cb3b0",
    "#e98aab",
    "#f3b4c9",
    "#e4a3d1",
    "#9c8bd1",
    "#b996e2",
  ],
  [ZONE_LAYER.TOOLING]: ["#a3a08f", "#9190a2", "#a8a49a"],
} as const satisfies { readonly [Layer in ZoneLayer]: readonly [string, ...string[]] };

/** The styles whose landmark faces the front of the board rather than a seeded way. */
const FACING_FRONT: ReadonlySet<DistrictStyle> = new Set([
  DISTRICT_STYLE.STATION,
  DISTRICT_STYLE.YARD,
  DISTRICT_STYLE.CLOCK_TOWER,
  DISTRICT_STYLE.SHOPS,
  DISTRICT_STYLE.HARBOR,
]);

/** The board's proportions, in scene units, which are the mockup's own. */
export const BOARD = {
  /** The clear ground kept between two districts' outer edges. */
  GAP: 3.6,
  /** How far the loop track runs inside a district's edge. */
  RING_INSET: 0.78,
  /** How far the buildable plot stands inside a district's edge. */
  PLOT_INSET: 2,
  /** How far apart a mainline's two tracks run. */
  LANE: 0.74,
  /** The height of the rails' top. */
  RAIL_Y: 0.21,
  /** The step a train's route is sampled at. */
  ROUTE_STEP: 0.1,
  /** The baseboard's thickness. */
  THICKNESS: 2.8,
} as const;

/** One zone as a district on the board. */
export interface District {
  readonly index: number;
  readonly zone: ZoneView;
  readonly path: string;
  readonly layer: ZoneLayer;
  style: DistrictStyle;
  readonly color: Color;
  /** Its centre on the board. */
  x: number;
  z: number;
  /** Its outer radius, its loop track's, and its buildable plot's. */
  readonly radius: number;
  readonly ringRadius: number;
  readonly plotRadius: number;
  /** Which way its landmark faces, and the frame its own parts are placed in. */
  rot: number;
  frame: Matrix4;
}

/** One length of track: a district's loop, or a run of a mainline between tunnels. */
interface Track {
  readonly points: readonly Vector3[];
  readonly closed: boolean;
  readonly ring: boolean;
  /** The id its blast-radius glow is lit by: its district's index for a loop, its mainline's for a run. */
  readonly glow: number;
}

/** One way along a mainline between two districts: where it leaves the first loop and joins the second. */
interface Hop {
  readonly points: readonly Vector3[];
  /** The angle on the first district's loop it leaves at, and on the second's it joins at. */
  readonly leave: number;
  readonly join: number;
}

/** A tunnel mouth where a mainline dives under a district. */
interface Portal {
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/** A signal beside a mainline where it leaves its loop, red while its line carries the blast. */
interface Signal {
  readonly x: number;
  readonly z: number;
  readonly glow: number;
  /** The district the line leaves, and the one it runs to. */
  readonly from: string;
  readonly to: string;
}

export interface Bounds {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** The airfield behind the hangars: its centre, size, and heading. */
interface Runway {
  readonly x: number;
  readonly z: number;
  readonly length: number;
  readonly width: number;
  readonly rot: number;
}

/** The whole board as planned from one view's zones. */
export interface Layout {
  readonly districts: readonly District[];
  readonly byPath: ReadonlyMap<string, District>;
  /** The reduced dependency graph, both ways, by path. */
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
  readonly hops: ReadonlyMap<string, ReadonlyMap<string, Hop>>;
  readonly tracks: readonly Track[];
  readonly portals: readonly Portal[];
  readonly signals: readonly Signal[];
  /** How many glow ids the tracks use. */
  readonly glows: number;
  readonly bounds: Bounds;
  readonly runway: Runway;
  /** Where the water's edge runs, by depth along the board. */
  readonly shoreAt: (z: number) => number;
  /** Whether a point lies under a district, where a mainline runs in a tunnel. */
  readonly underDistrict: (x: number, z: number) => boolean;
}

/**
 * A district's outer radius for its footprint: the smallest zone a hamlet,
 * the largest a town. A footprint is the square root of a zone's share of the
 * largest's bytes; the radius grows with that share to the power 0.3, as a
 * town's reach grows with its size, so a large zone reads large without
 * swallowing the board.
 */
function radiusOf(footprint: number): number {
  return Math.round((2.6 + 12 * footprint ** 0.6) * 10) / 10;
}

/** The style of each zone: a seeded draw from its layer's styles, the largest of each layer taking the first. */
function stylesOf(zones: readonly ZoneView[]): Map<string, DistrictStyle> {
  const largest = new Map<ZoneLayer, ZoneView>();
  for (const zone of zones) {
    const held = largest.get(zone.layer);
    if (held === undefined || zone.bytes > held.bytes) largest.set(zone.layer, zone);
  }
  const styles = new Map<string, DistrictStyle>();
  for (const zone of zones) {
    const choices = LAYER_STYLES[zone.layer];
    const style =
      largest.get(zone.layer) === zone
        ? choices[0]
        : (choices[1 + (hashOf(zone.path) % (choices.length - 1))] ?? choices[0]);
    styles.set(zone.path, style);
  }
  return styles;
}

/** The dependency edges no other path implies, `from` depending on `to`. */
function reducedEdges(view: FactoryWorldView): { from: string; to: string }[] {
  const reach = new Map<string, Set<string>>();
  const reachOf = (path: string): Set<string> => {
    const known = reach.get(path);
    if (known !== undefined) return known;
    const found = new Set<string>();
    // Note that the set is held before it is filled, so a cycle meets it and stops.
    reach.set(path, found);
    for (const next of view.zoneByPath.get(path)?.dependsOn ?? []) {
      found.add(next);
      for (const further of reachOf(next)) found.add(further);
    }
    return found;
  };
  const edges: { from: string; to: string }[] = [];
  for (const zone of view.zones) {
    for (const to of zone.dependsOn) {
      if (!view.zoneByPath.has(to)) continue;
      const implied = zone.dependsOn.some((other) => other !== to && reachOf(other).has(to));
      if (!implied) edges.push({ from: zone.path, to });
    }
  }
  return edges;
}

/** A district while it is placed: its zone, its radius, and where it stands. */
interface Node {
  readonly zone: ZoneView;
  readonly radius: number;
  x: number;
  z: number;
}

/** Pushes every overlapping pair apart toward keeping `BOARD.GAP` between them; answers whether any pair overlapped. */
function collide(nodes: readonly Node[]): boolean {
  let moved = false;
  for (let i = 0; i < nodes.length; i += 1) {
    const a = nodes[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = nodes[j];
      if (b === undefined) continue;
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const need = a.radius + b.radius + BOARD.GAP;
      if (dx * dx + dz * dz >= need * need) continue;
      const distance = Math.hypot(dx, dz) || 0.01;
      const push = (need - distance) / 2;
      if (push > 0.01) moved = true;
      dx /= distance;
      dz /= distance;
      a.x -= dx * push;
      a.z -= dz * push;
      b.x += dx * push;
      b.z += dz * push;
    }
  }
  return moved;
}

/**
 * Where each zone's district stands: its layout's place, scaled so the rings
 * hold every district, and pushed off its neighbours only as far as an
 * overlap needs. The layout's angles and rings are the view model's, so the
 * core stands at the heart and the surface at the edge as it says; a
 * mainline that meets a district on its way tunnels under it.
 */
function placed(view: FactoryWorldView): Node[] {
  const radii = view.zones.map((zone) => radiusOf(zone.footprint));
  const area = radii.reduce((sum, radius) => sum + (2 * radius + BOARD.GAP) ** 2, 0);
  const scale = Math.max(12, 0.42 * Math.sqrt(area / Math.PI));
  const nodes = view.zones.map((zone, index) => {
    const radius = radii[index] ?? radiusOf(zone.footprint);
    return { zone, radius, x: zone.x * scale, z: zone.y * scale };
  });
  for (let round = 0; round < 240 && collide(nodes); round += 1);
  return nodes;
}

function districtOf(node: Node, index: number, style: DistrictStyle): District {
  const rnd = seeded(hashOf(node.zone.path));
  const tints = LAYER_TINTS[node.zone.layer];
  const rot = FACING_FRONT.has(style) ? 0 : rnd() * TAU;
  return {
    index,
    zone: node.zone,
    path: node.zone.path,
    layer: node.zone.layer,
    style,
    color: new Color(tints[hashOf(node.zone.path) % tints.length] ?? tints[0]),
    x: node.x,
    z: node.z,
    radius: node.radius,
    ringRadius: node.radius - BOARD.RING_INSET,
    plotRadius: node.radius - BOARD.PLOT_INSET,
    rot,
    frame: placing(node.x, 0, node.z, rot),
  };
}

/** The most points every mainline together keeps for its track: about a million vertices of ballast and rail. */
const MAINLINE_POINTS = 15_000;

/** How far inside a district's edge a mainline goes underground: a line grazing its band stays on the surface. */
const TUNNEL_INSET = 2.6;

/** A grid over the board answering whether a point lies under a district, quickly. */
function underDistrictOf(districts: readonly District[]): (x: number, z: number) => boolean {
  const CELL = 8;
  const cells = new Map<number, Map<number, District[]>>();
  for (const district of districts) {
    const reach = district.radius - TUNNEL_INSET;
    for (
      let cx = Math.floor((district.x - reach) / CELL);
      cx <= Math.floor((district.x + reach) / CELL);
      cx += 1
    ) {
      const column = cells.get(cx) ?? new Map<number, District[]>();
      cells.set(cx, column);
      for (
        let cz = Math.floor((district.z - reach) / CELL);
        cz <= Math.floor((district.z + reach) / CELL);
        cz += 1
      ) {
        column.set(cz, [...(column.get(cz) ?? []), district]);
      }
    }
  }
  return (x, z) => {
    const near = cells.get(Math.floor(x / CELL))?.get(Math.floor(z / CELL)) ?? [];
    return near.some((district) => {
      const reach = district.radius - TUNNEL_INSET;
      return (x - district.x) ** 2 + (z - district.z) ** 2 < reach * reach;
    });
  };
}

/** Where a line toward `toward` touches the district's loop, leaving or joining it the way the loops all run. */
function tangentOf(district: District, toward: Vector3, leaving: boolean) {
  const dx = toward.x - district.x;
  const dz = toward.z - district.z;
  const distance = Math.hypot(dx, dz);
  const base = Math.atan2(dz, dx);
  const offset = Math.acos(clamp(district.ringRadius / distance, -1, 1));
  for (const sign of [1, -1]) {
    const angle = base + sign * offset;
    const px = district.x + Math.cos(angle) * district.ringRadius;
    const pz = district.z + Math.sin(angle) * district.ringRadius;
    const lx = leaving ? toward.x - px : px - toward.x;
    const lz = leaving ? toward.z - pz : pz - toward.z;
    if (-Math.sin(angle) * lx + Math.cos(angle) * lz > 0) {
      return { point: new Vector3(px, 0, pz), angle };
    }
  }
  return { point: new Vector3(district.x + district.ringRadius, 0, district.z), angle: 0 };
}

/** Corner-cutting: each pass replaces each segment by its quarter and three-quarter points. */
function chaikin(points: readonly Vector3[], passes: number): Vector3[] {
  let line = [...points];
  for (let pass = 0; pass < passes; pass += 1) {
    const next: Vector3[] = [];
    const first = line[0];
    if (first !== undefined) next.push(first);
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index];
      const b = line[index + 1];
      if (a === undefined || b === undefined) continue;
      next.push(a.clone().lerp(b, 0.25), a.clone().lerp(b, 0.75));
    }
    const last = line.at(-1);
    if (last !== undefined) next.push(last);
    line = next;
  }
  return line;
}

/** The line re-spaced to points `step` apart. */
function resample(points: readonly Vector3[], step: number): Vector3[] {
  const first = points[0];
  if (first === undefined) return [];
  const out = [first.clone()];
  let carry = step;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index];
    const b = points[index + 1];
    if (a === undefined || b === undefined) continue;
    const length = a.distanceTo(b);
    let along = carry;
    while (along < length) {
      out.push(a.clone().lerp(b, along / length));
      along += step;
    }
    carry = along - length;
  }
  const last = points.at(-1);
  if (last !== undefined) out.push(last.clone());
  return out;
}

/** The line from `a`'s loop to `b`'s, keeping right of the line back. */
function hopOf(a: District, b: District): Hop {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const distance = Math.hypot(dx, dz) || 0.01;
  const ux = dx / distance;
  const uz = dz / distance;
  const reach = clamp(0.3 * (distance - a.ringRadius - b.ringRadius), 1.4, 7);
  const out = new Vector3(
    a.x + ux * (a.ringRadius + reach) + uz * BOARD.LANE,
    0,
    a.z + uz * (a.ringRadius + reach) - ux * BOARD.LANE,
  );
  const into = new Vector3(
    b.x - ux * (b.ringRadius + reach) + uz * BOARD.LANE,
    0,
    b.z - uz * (b.ringRadius + reach) - ux * BOARD.LANE,
  );
  const leave = tangentOf(a, out, true);
  const join = tangentOf(b, into, false);
  return {
    points: resample(chaikin([leave.point, out, into, join.point], 4), 0.3),
    leave: leave.angle,
    join: join.angle,
  };
}

/** A district's loop of track. */
function ringOf(district: District): Track {
  const count = Math.max(40, Math.ceil((TAU * district.ringRadius) / 0.45));
  const points = Array.from({ length: count }, (_, step) => {
    const angle = (step / count) * TAU;
    return new Vector3(
      district.x + Math.cos(angle) * district.ringRadius,
      0,
      district.z + Math.sin(angle) * district.ringRadius,
    );
  });
  return { points, closed: true, ring: true, glow: district.index };
}

/** The runs of one hop between tunnels, its portals, and the signal where it leaves its loop. */
function runsOf(
  hop: Hop,
  glow: number,
  from: string,
  to: string,
  underDistrict: (x: number, z: number) => boolean,
  stride: number,
) {
  const tracks: Track[] = [];
  const portals: Portal[] = [];
  let run: Vector3[] | undefined;
  let wasHidden = false;
  hop.points.forEach((point, index) => {
    const isHidden = underDistrict(point.x, point.z);
    const previous = hop.points[index - 1];
    if (previous !== undefined && isHidden !== wasHidden) {
      const yaw = Math.atan2(-(point.z - previous.z), point.x - previous.x);
      const mouth = isHidden ? previous : point;
      portals.push({ x: mouth.x, z: mouth.z, yaw: yaw + (isHidden ? 0 : Math.PI) });
    }
    if (isHidden) run = undefined;
    else {
      if (run === undefined) {
        run = [];
        tracks.push({ points: run, closed: false, ring: false, glow });
      }
      if (index % stride === 0 || index === hop.points.length - 1 || run.length === 0)
        run.push(point);
    }
    wasHidden = isHidden;
  });
  const kept = tracks.filter((track) => track.points.length > 1);
  const first = kept[0]?.points;
  const a = first?.[0];
  const b = first?.at(-1);
  if (a === undefined || b === undefined) return { tracks: kept, portals, signal: undefined };
  const length = Math.hypot(b.x - a.x, b.z - a.z) || 0.01;
  const along = Math.min(2.2, length * 0.3);
  const ux = (b.x - a.x) / length;
  const uz = (b.z - a.z) / length;
  return {
    tracks: kept,
    portals,
    signal: {
      x: a.x + ux * along + uz * 0.85,
      z: a.z + uz * along - ux * 0.85,
      glow,
      from,
      to,
    },
  };
}

/** The board's edges: the water along the left, the airfield behind, and a margin all round. */
function boundsOf(districts: readonly District[]) {
  const shoreX = Math.min(...districts.map((d) => d.x - d.radius)) - 1.2;
  const heading = { x: 0.55, z: -0.83 };
  const far = Math.max(...districts.map((d) => d.x * heading.x + d.z * heading.z + d.radius));
  const runway: Runway = {
    x: heading.x * (far + 7),
    z: heading.z * (far + 7),
    length: 34,
    width: 4.2,
    rot: Math.atan2(heading.x, heading.z) + Math.PI / 2,
  };
  let x1 = Math.max(...districts.map((d) => d.x + d.radius));
  let z0 = Math.min(...districts.map((d) => d.z - d.radius));
  let z1 = Math.max(...districts.map((d) => d.z + d.radius));
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const [cx, cz] = turned(
      runway.x,
      runway.z,
      runway.rot,
      (sx * runway.length) / 2,
      (sz * runway.width) / 2,
    );
    x1 = Math.max(x1, cx);
    z0 = Math.min(z0, cz);
    z1 = Math.max(z1, cz);
  }
  return { bounds: { x0: shoreX - 24, x1: x1 + 9, z0: z0 - 9, z1: z1 + 9 }, runway, shoreX };
}

/** Plans the board for a view's zones. */
export function layoutOf(view: FactoryWorldView): Layout {
  const edges = reducedEdges(view);
  const styles = stylesOf(view.zones);
  const nodes = placed(view);
  const districts = nodes.map((node, index) =>
    districtOf(node, index, styles.get(node.zone.path) ?? DISTRICT_STYLE.TOWN),
  );
  // Note that the district nearest the water keeps the harbour, whatever its layer drew.
  const harbor = districts.reduce<District | undefined>(
    (best, d) => (best === undefined || d.x - d.radius < best.x - best.radius ? d : best),
    undefined,
  );
  if (harbor !== undefined && districts.length > 1) {
    harbor.style = DISTRICT_STYLE.HARBOR;
    harbor.rot = 0;
    harbor.frame = placing(harbor.x, 0, harbor.z, 0);
  }
  const byPath = new Map(districts.map((d) => [d.path, d]));
  const underDistrict = underDistrictOf(districts);
  const adjacency = new Map<string, string[]>(districts.map((d) => [d.path, []]));
  const hops = new Map<string, Map<string, Hop>>();
  const tracks: Track[] = districts.map(ringOf);
  const portals: Portal[] = [];
  const signals: Signal[] = [];
  let glows = districts.length;
  const legs = edges.flatMap((edge) => {
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
    return [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ].flatMap(([from = "", to = ""]) => {
      const a = byPath.get(from);
      const b = byPath.get(to);
      return a === undefined || b === undefined ? [] : [{ from, to, hop: hopOf(a, b) }];
    });
  });
  // Note that a graph of many long mainlines keeps fewer of their points, so the track it draws stays within its budget.
  const sampledPoints = legs.reduce((sum, leg) => sum + leg.hop.points.length, 0);
  const stride = Math.max(3, Math.ceil(sampledPoints / MAINLINE_POINTS));
  for (const { from, to, hop } of legs) {
    const runs = runsOf(hop, glows, from, to, underDistrict, stride);
    glows += 1;
    tracks.push(...runs.tracks);
    portals.push(...runs.portals);
    if (runs.signal !== undefined) signals.push(runs.signal);
    const out = hops.get(from) ?? new Map<string, Hop>();
    out.set(to, hop);
    hops.set(from, out);
  }
  const { bounds, runway, shoreX } = boundsOf(districts);
  const shoreAt = (z: number) =>
    shoreX + 1.6 * Math.sin(z * 0.08) + 0.9 * Math.sin(z * 0.21 + 1.7) - 1.4;
  return {
    districts,
    byPath,
    adjacency,
    hops,
    tracks,
    portals,
    signals,
    glows,
    bounds,
    runway,
    shoreAt,
    underDistrict,
  };
}

/**
 * Whether a later view's zones plan the same board as an earlier one's: the
 * same zones, in the same layers, at the same sizes, with the same
 * dependencies. Scrubbing and hovering keep it, so the town stands while the
 * work on it moves.
 */
export function sameBoard(earlier: FactoryWorldView, later: FactoryWorldView): boolean {
  if (earlier === later) return true;
  if (earlier.zones.length !== later.zones.length || earlier.edges.length !== later.edges.length) {
    return false;
  }
  const sameZones = earlier.zones.every((zone, index) => {
    const other = later.zones[index];
    return (
      other !== undefined &&
      other.path === zone.path &&
      other.layer === zone.layer &&
      radiusOf(other.footprint) === radiusOf(zone.footprint)
    );
  });
  const sameEdges = earlier.edges.every((edge, index) => {
    const other = later.edges[index];
    return other !== undefined && other.from === edge.from && other.to === edge.to;
  });
  return sameZones && sameEdges;
}

/** A train's route, sampled every `BOARD.ROUTE_STEP`: where it runs, and where it is underground. */
export interface Route {
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly underground: Uint8Array;
  readonly length: number;
}

/** The shortest walk between two districts over the reduced graph; empty where none joins them. */
function walkBetween(layout: Layout, from: string, to: string): string[] {
  if (from === to) return [from];
  const previous = new Map<string, string | undefined>([[from, undefined]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head += 1) {
    const at = queue[head];
    if (at === undefined) continue;
    for (const next of layout.adjacency.get(at) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, at);
      if (next === to) {
        const walk = [to];
        for (let back = previous.get(to); back !== undefined; back = previous.get(back)) {
          walk.push(back);
        }
        return walk.reverse();
      }
      queue.push(next);
    }
  }
  return [];
}

function arcOnto(district: District, from: number, to: number, out: Vector3[]): void {
  let sweep = (((to - from) % TAU) + TAU) % TAU;
  if (sweep < 0.02) sweep = 0.02;
  const count = Math.max(2, Math.ceil((sweep * district.ringRadius) / 0.4));
  for (let step = 0; step < count; step += 1) {
    const angle = from + (sweep * step) / count;
    out.push(
      new Vector3(
        district.x + Math.cos(angle) * district.ringRadius,
        0,
        district.z + Math.sin(angle) * district.ringRadius,
      ),
    );
  }
}

function sampled(layout: Layout, points: readonly Vector3[]): Route {
  const xs: number[] = [];
  const zs: number[] = [];
  let carry = 0;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length] ?? a;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    let along = carry;
    while (along < length) {
      const t = along / length;
      xs.push(a.x + (b.x - a.x) * t);
      zs.push(a.z + (b.z - a.z) * t);
      along += BOARD.ROUTE_STEP;
    }
    carry = along - length;
  });
  const underground = Uint8Array.from(xs, (x, index) =>
    layout.underDistrict(x, zs[index] ?? 0) ? 1 : 0,
  );
  return {
    xs: Float32Array.from(xs),
    zs: Float32Array.from(zs),
    underground,
    length: Math.max(BOARD.ROUTE_STEP, xs.length * BOARD.ROUTE_STEP),
  };
}

/**
 * A closed walk from the first of `paths` over up to four more of them,
 * nearest next, and home: loop arcs joined by mainlines, sampled for a train
 * to run on. A district joined to none of the others is its own loop.
 */
export function routeOf(layout: Layout, paths: readonly string[]): Route | undefined {
  const start = paths[0];
  const home = start === undefined ? undefined : layout.byPath.get(start);
  if (start === undefined || home === undefined) return undefined;
  const todo = paths
    .slice(1)
    .filter((path) => walkBetween(layout, start, path).length > 0)
    .slice(0, 4);
  const walk = [start];
  let at = start;
  while (todo.length > 0) {
    todo.sort((a, b) => walkBetween(layout, at, a).length - walkBetween(layout, at, b).length);
    const next = todo.shift();
    if (next === undefined) break;
    walk.push(...walkBetween(layout, at, next).slice(1));
    at = next;
  }
  if (at !== start) walk.push(...walkBetween(layout, at, start).slice(1));
  const points: Vector3[] = [];
  if (walk.length < 2) {
    arcOnto(home, 0, TAU - 0.0001, points);
    return sampled(layout, points);
  }
  const loop = walk.slice(0, -1);
  const legs = loop.map((path, index) =>
    layout.hops.get(path)?.get(loop[(index + 1) % loop.length] ?? path),
  );
  loop.forEach((path, index) => {
    const district = layout.byPath.get(path);
    const inbound = legs[(index - 1 + legs.length) % legs.length];
    const outbound = legs[index];
    if (district === undefined || inbound === undefined || outbound === undefined) return;
    arcOnto(district, inbound.join, outbound.leave, points);
    points.push(...outbound.points.slice(0, -1));
  });
  return sampled(layout, points);
}

const AHEAD = { x: 0, z: 0 };
const BEHIND = { x: 0, z: 0 };

function routePoint(route: Route, along: number, out: { x: number; z: number }): void {
  const wrapped = ((along % route.length) + route.length) % route.length;
  const f = wrapped / BOARD.ROUTE_STEP;
  const count = route.xs.length;
  const i0 = Math.floor(f) % count;
  const i1 = (i0 + 1) % count;
  const t = f - Math.floor(f);
  out.x = lerp(route.xs[i0] ?? 0, route.xs[i1] ?? 0, t);
  out.z = lerp(route.zs[i0] ?? 0, route.zs[i1] ?? 0, t);
}

/** Where a vehicle `half` long stands with its middle `along` the route: its point, its heading, and whether it is in a tunnel. */
export function vehicleAt(route: Route, along: number, half: number) {
  routePoint(route, along + half, AHEAD);
  routePoint(route, along - half, BEHIND);
  const wrapped = ((along % route.length) + route.length) % route.length;
  const index = Math.floor(wrapped / BOARD.ROUTE_STEP) % route.xs.length;
  return {
    x: (AHEAD.x + BEHIND.x) / 2,
    z: (AHEAD.z + BEHIND.z) / 2,
    yaw: Math.atan2(-(AHEAD.z - BEHIND.z), AHEAD.x - BEHIND.x),
    underground: route.underground[index] === 1,
  };
}
