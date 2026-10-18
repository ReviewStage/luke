import type { FactoryWorldView, ZoneView } from "@luke/ui/factory-world";
import { ZONE_LAYER } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  Color,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
} from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import {
  clamp,
  GLSL_NOISE,
  GLSL_OCTANT,
  GLSL_OUTPUT,
  GLSL_ZONE,
  mix,
  noise3,
  rng,
  rotateToward,
  type SharedUniforms,
  seedOf,
  smooth,
} from "./kit";

/**
 * globe.ts -- the planet itself: where each zone stands on it, the crust shaped from them, and the ocean, clouds, and air around it.
 *
 * The planet is the repository cut open. Its core is the core layer, drawn
 * as shells in the cutaway (`core.ts`); the crust carries the domain zones as
 * continents and the surface zones as the cities on their coasts; the
 * tooling zones are moons. Each crust zone's place is the view model's
 * layout laid over the planet as a map centred on the cutaway (see
 * `directionOf`), so the same path lands in the same place on every open,
 * and its size is its footprint. A relaxation then only pushes apart what
 * overlaps, and out of the cutaway, as the README asks a world to do; a city
 * may come as close as the coast of the continent it depends on most.
 *
 * The crust is one sphere, its vertices raised and coloured by the zone that
 * owns them: mountains and forest on a continent, streets on a city, sea
 * between. Its shader reads the zone-state texture (`kit.ts`) for the glow
 * of shipped work, the blast radius's ripple, and the chosen zone, and the
 * defects' scorch from uniforms. The ocean, clouds, and atmosphere are
 * shader spheres around it.
 */

/** The planet's sea-level radius, in scene units. */
export const PLANET_RADIUS = 10;

/** The core's outer edge: the shells of the core layer fill this sphere. */
export const CORE_RADIUS = 7;

/** How deep the ocean is drawn in the cutaway. */
const SEA_DEPTH = 0.16;

/** The most core zones drawn as shells; past it a core zone stands on the crust. */
export const MAX_STRATA = 12;

/** The most tooling zones drawn as moons; past it a tooling zone stands on the crust. */
export const MAX_MOONS = 16;

/** The share of the open sphere the crust's land covers before the largest zone is capped. */
const LAND_SHARE = 0.4;

/** The largest angular radius a zone covers, in radians. */
const LARGEST_THETA = 0.42;

/** How far from the cut's axis the layout's inner and outer edges map, in radians: past the cut's rim, and round toward the far side. */
const CUT_AWAY = { NEAREST: (62 * Math.PI) / 180, FARTHEST: (128 * Math.PI) / 180 } as const;

/** How many passes the relaxation takes. */
const RELAX_PASSES = 320;

/** The most crust damage the terrain shader scorches. */
export const MAX_SCORCHES = 12;

/** Each continent's ground, chosen by its path: mostly grassland and forest, some savanna and heath. */
const BIOMES = [
  0x5d8f4c, 0x3c7a5a, 0x7b8d48, 0x7d9a78, 0x8ba24a, 0x4f7f5a, 0xa79558, 0x93707e, 0x7a6f96,
  0xc4a86a,
] as const;

/** The greys and sands a moon is drawn in, chosen by its path. */
const MOON_TONES = [0x9aa0ad, 0xb8a58c, 0xa29a92, 0x8f98a6] as const;

/** Where a zone stands on the planet. */
export const ZONE_PLACE = {
  /** On the crust: a continent or a city. */
  CRUST: "crust",
  /** A shell of the core, in the cutaway. */
  CORE: "core",
  /** A moon in orbit. */
  MOON: "moon",
} as const;

interface PlacedZone {
  /** The zone's column in the zone-state texture: its order in the view. */
  readonly index: number;
  readonly view: ZoneView;
}

/** A continent or a city: its centre on the unit sphere and its angular radius. */
export interface CrustZone extends PlacedZone {
  readonly place: typeof ZONE_PLACE.CRUST;
  readonly city: boolean;
  readonly centre: Vector3;
  theta: number;
  /** The continent a city stands on the coast of. */
  readonly host: CrustZone | undefined;
  readonly biome: Color;
}

/** A shell of the core, from `inner` to `outer`, the heart innermost. */
export interface CoreZone extends PlacedZone {
  readonly place: typeof ZONE_PLACE.CORE;
  readonly shell: number;
  readonly inner: number;
  readonly outer: number;
}

/** A moon: its size, its orbit, and its tone. */
export interface MoonZone extends PlacedZone {
  readonly place: typeof ZONE_PLACE.MOON;
  readonly moon: number;
  readonly radius: number;
  readonly orbit: number;
  readonly inclination: number;
  readonly speed: number;
  readonly phase: number;
  readonly tone: Color;
}

export type PlanetZone = CrustZone | CoreZone | MoonZone;

/** What stands under one point of the crust: the zone that owns it, how far inside its coast, and how high. */
export interface Ground {
  readonly owner: CrustZone | undefined;
  readonly inside: number;
  readonly height: number;
}

/** Every zone, placed. */
export interface PlanetLayout {
  readonly zones: readonly PlanetZone[];
  readonly byPath: ReadonlyMap<string, PlanetZone>;
  readonly crust: readonly CrustZone[];
  /** The core's shells, the heart first. */
  readonly strata: readonly CoreZone[];
  readonly moons: readonly MoonZone[];
  /** The crust zones whose land may reach into each crust zone's. */
  readonly neighbours: ReadonlyMap<CrustZone, readonly CrustZone[]>;
}

/** Where a thing stands: on the crust, on a shell's floor, on a moon (in the moon's own frame), or at the camp, in no zone. */
export interface Site {
  readonly zone: PlanetZone | undefined;
  readonly position: Vector3;
  readonly up: Vector3;
}

/** How far a zone stands from the layout floor's centre, in layout units. */
function fromCentreOf(zone: ZoneView): number {
  return Math.hypot(zone.x, zone.y);
}

/** The cutaway's axis: the opened octant's centre, which the layout's centre maps to. */
const CUT_AXIS = new Vector3(1, 1, 1).normalize();

/**
 * The unit direction the layout puts a crust zone at. The layout's floor is
 * laid over the planet as a map centred on the cutaway, so the core layer
 * at the floor's centre is the core the cutaway shows: a zone's angle is
 * its bearing around the cut, and its distance from the floor's centre how
 * far from the cut it stands, the domain ring nearer and the surface ring
 * beyond. Overlaps are pushed apart after (`relax`), and nothing else.
 */
function directionOf(zone: ZoneView): Vector3 {
  const away = mix(CUT_AWAY.NEAREST, CUT_AWAY.FARTHEST, clamp((fromCentreOf(zone) - 1) / 2, 0, 1));
  return rotateToward(CUT_AXIS, away, Math.atan2(zone.y, zone.x));
}

/** The continent a city stands on the coast of: what it depends on with the largest footprint. */
function hostOf(zone: ZoneView, view: FactoryWorldView): ZoneView | undefined {
  return zone.dependsOn
    .map((path) => view.zoneByPath.get(path))
    .filter((other) => other?.layer === ZONE_LAYER.DOMAIN)
    .reduce<ZoneView | undefined>(
      (best, other) =>
        other !== undefined && (best === undefined || other.footprint > best.footprint)
          ? other
          : best,
      undefined,
    );
}

const pushAway = new Vector3();

/** Pushes `moving` away from `from` by `amount` radians along the sphere. */
function push(moving: Vector3, from: Vector3, amount: number, draw: () => number): void {
  pushAway.copy(from).addScaledVector(moving, -moving.dot(from));
  if (pushAway.lengthSq() < 1e-9) pushAway.set(draw() - 0.5, draw() - 0.5, draw() - 0.5);
  pushAway.normalize();
  moving.addScaledVector(pushAway, -amount).normalize();
}

/** Keeps a crust zone out of the opened octant and off the poles. */
function keepOpen(zone: CrustZone, step: number): void {
  const centre = zone.centre;
  const margin = Math.sin(zone.theta * 1.05 + 0.08);
  if (centre.x > -margin && centre.y > -margin && centre.z > -margin) {
    const axis =
      centre.x < centre.y ? (centre.x < centre.z ? "x" : "z") : centre.y < centre.z ? "y" : "z";
    centre[axis] -= (centre[axis] + margin) * 0.25 * step + 0.002;
    centre.normalize();
  }
  if (Math.abs(centre.y) > 0.86) {
    centre.y *= 0.995;
    centre.normalize();
  }
}

/** Pushes overlapping crust zones apart, a city no further than its continent's coast. */
function relax(crust: readonly CrustZone[]): void {
  const draw = rng(seedOf("relax"));
  for (let pass = 0; pass < RELAX_PASSES; pass += 1) {
    const step = 0.5 * (1 - pass / (RELAX_PASSES * 1.1));
    for (let left = 0; left < crust.length; left += 1) {
      for (let right = left + 1; right < crust.length; right += 1) {
        relaxPair(crust[left], crust[right], step, draw);
      }
    }
    for (const zone of crust) keepOpen(zone, step);
  }
}

function relaxPair(
  first: CrustZone | undefined,
  second: CrustZone | undefined,
  step: number,
  draw: () => number,
): void {
  if (first === undefined || second === undefined) return;
  const coastal = first.host === second || second.host === first;
  // Note that a city may stand on its continent's coast, so the two are pushed apart only past it.
  const want = coastal
    ? Math.max(first.theta, second.theta) + Math.min(first.theta, second.theta) * 0.38
    : (first.theta + second.theta) * 1.1 + 0.035;
  const dot = first.centre.dot(second.centre);
  if (dot < Math.cos(want)) return;
  const apart = (want - Math.acos(clamp(dot, -1, 1))) * 0.5 * step;
  push(first.centre, second.centre, apart, draw);
  push(second.centre, first.centre, apart, draw);
}

/** Each zone's angular radius scale: the land shares `LAND_SHARE` of the open sphere, the largest zone at most `LARGEST_THETA`. */
function thetaScaleOf(crust: readonly ZoneView[]): number {
  const area = Math.PI * crust.reduce((sum, zone) => sum + zone.footprint, 0);
  if (area <= 0) return LARGEST_THETA;
  const open = 4 * Math.PI * (7 / 8);
  return Math.min(LARGEST_THETA, Math.sqrt((LAND_SHARE * open) / area));
}

function crustZoneOf(
  zone: ZoneView,
  index: number,
  scale: number,
  host: CrustZone | undefined,
): CrustZone {
  const theta = scale * Math.sqrt(zone.footprint);
  const centre = directionOf(zone);
  const biome = new Color(BIOMES[seedOf(zone.path) % BIOMES.length]);
  return {
    place: ZONE_PLACE.CRUST,
    index,
    view: zone,
    city: zone.layer === ZONE_LAYER.SURFACE,
    centre,
    theta,
    host,
    biome,
  };
}

function strataOf(core: readonly { zone: ZoneView; index: number }[]): CoreZone[] {
  const ordered = [...core].sort(
    (left, right) =>
      fromCentreOf(left.zone) - fromCentreOf(right.zone) ||
      (left.zone.path < right.zone.path ? -1 : 1),
  );
  const weights = ordered.map(({ zone }) => Math.max(0.3, zone.footprint));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let inner = 0;
  return ordered.map(({ zone, index }, shell) => {
    const outer = inner + (CORE_RADIUS * (weights[shell] ?? 0)) / total;
    const stratum: CoreZone = { place: ZONE_PLACE.CORE, index, view: zone, shell, inner, outer };
    inner = outer;
    return stratum;
  });
}

function moonOf(zone: ZoneView, index: number, moon: number): MoonZone {
  const across = clamp((fromCentreOf(zone) - zone.ring - 0.2) / 0.6, 0, 1);
  const orbit = 16 + across * 8 + moon * 0.9;
  return {
    place: ZONE_PLACE.MOON,
    index,
    view: zone,
    moon,
    radius: 0.55 + 0.9 * Math.sqrt(zone.footprint),
    orbit,
    inclination: (((seedOf(zone.path) >>> 8) % 1000) / 1000 - 0.5) * 0.9,
    speed: 0.045 * (16 / orbit) ** 1.5,
    phase: Math.atan2(zone.y, zone.x),
    tone: new Color(MOON_TONES[seedOf(zone.path) % MOON_TONES.length]),
  };
}

/** The crust zones whose caps reach into each one's. */
function neighboursOf(crust: readonly CrustZone[]): Map<CrustZone, CrustZone[]> {
  return new Map(
    crust.map((zone) => [
      zone,
      crust.filter(
        (other) =>
          other === zone ||
          Math.acos(clamp(zone.centre.dot(other.centre), -1, 1)) <
            (zone.theta + other.theta) * 1.6 + 0.05,
      ),
    ]),
  );
}

/** Every zone of `view`, placed on the planet. */
export function planetLayoutOf(view: FactoryWorldView): PlanetLayout {
  const indexed = view.zones.map((zone, index) => ({ zone, index }));
  const core = indexed.filter(({ zone }) => zone.layer === ZONE_LAYER.CORE);
  const tooling = indexed.filter(({ zone }) => zone.layer === ZONE_LAYER.TOOLING);
  const strata = strataOf(core.slice(0, MAX_STRATA));
  const moons = tooling
    .slice(0, MAX_MOONS)
    .map(({ zone, index }, moon) => moonOf(zone, index, moon));
  const inCore = new Set(strata.map((stratum) => stratum.index));
  const onMoon = new Set(moons.map((moon) => moon.index));
  const onCrust = indexed.filter(({ index }) => !inCore.has(index) && !onMoon.has(index));
  const scale = thetaScaleOf(onCrust.map(({ zone }) => zone));
  const continents = new Map<string, CrustZone>();
  const crust: CrustZone[] = [];
  // Note that the continents are placed first, so each city can start on its continent's coast.
  for (const { zone, index } of onCrust) {
    if (zone.layer === ZONE_LAYER.SURFACE) continue;
    const placed = crustZoneOf(zone, index, scale, undefined);
    continents.set(zone.path, placed);
    crust.push(placed);
  }
  for (const { zone, index } of onCrust) {
    if (zone.layer !== ZONE_LAYER.SURFACE) continue;
    const host = hostOf(zone, view);
    crust.push(crustZoneOf(zone, index, scale, host && continents.get(host.path)));
  }
  relax(crust);
  const zones: PlanetZone[] = [...crust, ...strata, ...moons].sort(
    (left, right) => left.index - right.index,
  );
  return {
    zones,
    byPath: new Map(zones.map((zone) => [zone.view.path, zone])),
    crust,
    strata,
    moons,
    neighbours: neighboursOf(crust),
  };
}

/** The crust zone that owns direction (`x`, `y`, `z`) among `candidates`, and how far inside its coast. */
function ownerAt(x: number, y: number, z: number, candidates: readonly CrustZone[]) {
  const warp =
    noise3(x * 2.3 + 5.1, y * 2.3, z * 2.3) * 0.95 +
    noise3(x * 6.3, y * 6.3 + 3.3, z * 6.3) * 0.4 +
    noise3(x * 15, y * 15, z * 15 + 9) * 0.15;
  let owner: CrustZone | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const zone of candidates) {
    const centre = zone.centre;
    const angle = Math.acos(clamp(x * centre.x + y * centre.y + z * centre.z, -1, 1));
    const share = angle / zone.theta;
    if (share < nearest) {
      nearest = share;
      owner = zone;
    }
  }
  return { owner, inside: 1 - nearest - warp * 0.48 };
}

function mountainOf(zone: CrustZone): number {
  return 0.16 + 0.55 * zone.view.footprint;
}

/** How high the crust stands at a direction owned by `owner`, `inside` its coast; the sea floor where it is owned by none. */
function heightAt(x: number, y: number, z: number, owner: CrustZone | undefined, inside: number) {
  let height: number;
  // Note that land and sea meet at height zero on both sides, so the ocean draws a smooth coastline.
  if (owner === undefined || inside <= 0) {
    height =
      -0.012 -
      0.5 * smooth(0, 1.4, -inside) +
      noise3(x * 4, y * 4, z * 4) * 0.05 * smooth(0, 0.3, -inside);
  } else if (!owner.city) {
    const ridge = 1 - Math.abs(noise3(x * 5.5 + 11, y * 5.5, z * 5.5));
    const massif = 0.5 + 0.5 * noise3(x * 2.6, y * 2.6 + 7, z * 2.6);
    const mask = smooth(-0.15, 0.35, noise3(x * 1.9 + 3, y * 1.9, z * 1.9 + 5));
    height =
      0.004 +
      0.075 * smooth(0, 0.2, inside) +
      mountainOf(owner) * (ridge ** 4 * 0.9 * mask + massif * 0.16) * smooth(0.12, 0.62, inside);
  } else {
    height =
      0.004 +
      0.07 * smooth(0, 0.14, inside) +
      noise3(x * 20, y * 20, z * 20) * 0.005 * smooth(0, 0.1, inside);
  }
  // Note that the crust sinks to the sea floor along the cutaway's edges, so the cut reads clean.
  return mix(height, -SEA_DEPTH, smooth(-0.12, -0.04, Math.min(x, y, z)));
}

/** What stands under unit direction `direction`, among `candidates` or every crust zone. */
export function groundAt(
  layout: PlanetLayout,
  direction: Vector3,
  candidates: readonly CrustZone[] = layout.crust,
): Ground {
  const { x, y, z } = direction;
  const { owner, inside } = ownerAt(x, y, z, candidates);
  const land = owner !== undefined && inside > 0;
  return {
    owner: land ? owner : undefined,
    inside,
    height: heightAt(x, y, z, land ? owner : undefined, inside),
  };
}

/** Where a sampled thing may stand: how far apart from what stands there already, and how far out from the zone's centre. */
export interface SiteSpacing {
  readonly apart: number;
  readonly spread: number;
}

/**
 * Draws a place at the camp for one more agent whose work lands in no zone
 * yet, apart from those `taken` holds: the cutaway's floor between the core
 * and the sea, which no zone owns and the establishing shot looks onto.
 */
export function campSite(draw: () => number, taken: Vector3[]): Site {
  let position = new Vector3();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const radius = mix(CORE_RADIUS + 0.5, PLANET_RADIUS - 0.8, draw());
    const angle = (mix(14, 76, draw()) * Math.PI) / 180;
    position = new Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle));
    if (!taken.some((other) => other.distanceTo(position) < 0.62)) break;
  }
  taken.push(position);
  return { zone: undefined, position, up: new Vector3(0, 1, 0) };
}

/** Draws a place in `zone` for one more thing, apart from what `taken` holds there, and records it. */
export function sampleSite(
  layout: PlanetLayout,
  zone: PlanetZone,
  draw: () => number,
  taken: Map<PlanetZone, Vector3[]>,
  spacing: SiteSpacing,
): Site {
  const there = taken.get(zone) ?? [];
  taken.set(zone, there);
  const site = siteIn(layout, zone, draw, there, spacing);
  there.push(site.position);
  return site;
}

function siteIn(
  layout: PlanetLayout,
  zone: PlanetZone,
  draw: () => number,
  there: readonly Vector3[],
  { apart, spread }: SiteSpacing,
): Site {
  const crowded = (position: Vector3, gap: number) =>
    there.some((other) => other.distanceTo(position) < gap);
  if (zone.place === ZONE_PLACE.MOON) {
    let site: Site | undefined;
    for (let attempt = 0; attempt < 40 && site === undefined; attempt += 1) {
      const up = rotateToward(new Vector3(0, 1, 0), draw() * 1.1, draw() * Math.PI * 2);
      const position = up.clone().multiplyScalar(zone.radius * 0.97);
      if (attempt < 39 && crowded(position, apart * zone.radius * 0.5)) continue;
      site = { zone, position, up };
    }
    return site ?? { zone, position: new Vector3(0, zone.radius, 0), up: new Vector3(0, 1, 0) };
  }
  if (zone.place === ZONE_PLACE.CORE) return coreSite(zone, draw, crowded, apart);
  return crustSite(layout, zone, draw, crowded, { apart, spread });
}

function coreSite(
  zone: CoreZone,
  draw: () => number,
  crowded: (position: Vector3, gap: number) => boolean,
  apart: number,
): Site {
  if (zone.shell === 0) {
    const up = rotateToward(new Vector3(1, 1, 1).normalize(), draw() * 0.5, draw() * Math.PI * 2);
    return { zone, position: up.clone().multiplyScalar(zone.outer), up };
  }
  let position = new Vector3();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const band = zone.outer - zone.inner;
    const radius = mix(zone.inner + band * 0.22, zone.outer - band * 0.22, draw());
    const angle = (mix(14, 76, draw()) * Math.PI) / 180;
    position = new Vector3(radius * Math.cos(angle), 0, radius * Math.sin(angle));
    if (attempt === 39 || !crowded(position, apart)) break;
  }
  return { zone, position, up: new Vector3(0, 1, 0) };
}

function crustSite(
  layout: PlanetLayout,
  zone: CrustZone,
  draw: () => number,
  crowded: (position: Vector3, gap: number) => boolean,
  { apart, spread }: SiteSpacing,
): Site {
  const candidates = layout.neighbours.get(zone) ?? layout.crust;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const up = rotateToward(
      zone.centre,
      Math.sqrt(draw()) * zone.theta * spread,
      draw() * Math.PI * 2,
    );
    if (Math.min(up.x, up.y, up.z) > -0.06) continue;
    const ground = groundAt(layout, up, candidates);
    if (ground.owner !== zone || ground.inside < 0.1) continue;
    const position = up.clone().multiplyScalar(PLANET_RADIUS + ground.height);
    if (attempt < 70 && crowded(position, apart)) continue;
    return { zone, position, up };
  }
  const up = zone.centre.clone();
  return { zone, position: up.clone().multiplyScalar(PLANET_RADIUS + 0.06), up };
}

const moonPlace = new Vector3();

/** Where `moon` stands at `t` seconds of idle motion, as a matrix of its own frame. */
export function moonMatrix(moon: MoonZone, t: number, out: Matrix4): Matrix4 {
  const angle = moon.phase + t * moon.speed;
  moonPlace.set(
    Math.cos(angle) * moon.orbit,
    Math.sin(angle) * moon.orbit * Math.sin(moon.inclination),
    Math.sin(angle) * moon.orbit * Math.cos(moon.inclination),
  );
  return out.makeRotationY(t * 0.05).setPosition(moonPlace);
}

const siteFrame = new Matrix4();

/** Where `site` stands in the scene at `t`, written into `position` and `up`. */
export function siteInScene(site: Site, t: number, position: Vector3, up: Vector3): void {
  if (site.zone?.place !== ZONE_PLACE.MOON) {
    position.copy(site.position);
    up.copy(site.up);
    return;
  }
  moonMatrix(site.zone, t, siteFrame);
  position.copy(site.position).applyMatrix4(siteFrame);
  up.copy(site.up).transformDirection(siteFrame);
}

/** Where the camera looks at `zone`, and where its label would stand: its centre at the surface, its shell's floor, or its moon. */
export function anchorOf(layout: PlanetLayout, zone: PlanetZone, t: number): Vector3 {
  if (zone.place === ZONE_PLACE.MOON) {
    return new Vector3().setFromMatrixPosition(moonMatrix(zone, t, siteFrame));
  }
  if (zone.place === ZONE_PLACE.CORE) {
    if (zone.shell === 0) return new Vector3(1, 1, 1).normalize().multiplyScalar(zone.outer);
    const radius = (zone.inner + zone.outer) / 2;
    return new Vector3(radius * Math.SQRT1_2, 0.02, radius * Math.SQRT1_2);
  }
  const ground = groundAt(layout, zone.centre, layout.neighbours.get(zone));
  return zone.centre.clone().multiplyScalar(PLANET_RADIUS + Math.max(ground.height, 0) + 0.05);
}

/** The crust: one sphere raised and coloured by the zones that own it, and rebuilt when they change. */
export interface Terrain {
  readonly mesh: Mesh;
  /** The scorch each defect leaves: its direction and reach, and how deep. */
  readonly scorches: { readonly value: Vector4[] };
  readonly scorchDepths: { readonly value: number[] };
  readonly rebuild: (layout: PlanetLayout) => void;
}

const SAND = new Color(0xd8c48e);
const ROCK = new Color(0x6c635a);
const SNOW = new Color(0xf3f5fa);
const FOREST = new Color(0x234d2c);
const DRY = new Color(0xb59a62);
const SHALLOW = new Color(0x2bb0b0);
const DEEP = new Color(0x0a2246);
const CITY_GREY = new Color(0x8d939c);
const CITY_STONE = new Color(0xb9b3a6);

/** A crust vertex's colour, and how much of a city's street grid it carries. */
function groundColour(direction: Vector3, ground: Ground, out: Color): number {
  const { x, y, z } = direction;
  const grain = noise3(x * 14, y * 14, z * 14);
  const { owner, inside, height } = ground;
  if (owner === undefined) {
    out.copy(SHALLOW).lerp(DEEP, smooth(0, 0.3, -height));
    out.lerp(SAND, smooth(-0.05, 0, height) * 0.6);
    return 0;
  }
  if (owner.city) {
    out.copy(CITY_GREY).lerp(CITY_STONE, 0.5 + grain);
    out.lerp(SAND, 1 - smooth(0, 0.1, inside));
    return smooth(0.04, 0.14, inside);
  }
  out.copy(owner.biome).multiplyScalar(0.85 + grain * 0.3);
  const patch = noise3(x * 3.5 + 8, y * 3.5, z * 3.5);
  out.lerp(FOREST, smooth(0, 0.4, patch) * 0.55).lerp(DRY, smooth(0.05, 0.45, -patch) * 0.35);
  out.lerp(ROCK, smooth(0.3, 0.56, height) * 0.85);
  out.lerp(SNOW, smooth(0.58, 0.72, height));
  if (Math.abs(y) > 0.82) out.lerp(SNOW, smooth(0.82, 0.9, Math.abs(y)));
  out.lerp(SAND, 1 - smooth(0, 0.13, inside));
  return 0;
}

/** The crust's shader: streets, night lights, the glow of shipped work, the blast radius's ripple, the chosen zone, and the scorch of defects. */
function terrainMaterial(
  shared: SharedUniforms,
  terrain: Pick<Terrain, "scorches" | "scorchDepths">,
) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, {
      uScorch: terrain.scorches,
      uScorchDepth: terrain.scorchDepths,
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aZone; attribute float aCity;
        varying vec3 vLocal; flat varying int vZone; varying float vCity;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLocal = position; vZone = int(floor(aZone + 0.5)); vCity = aCity;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        #define SCORCHES ${MAX_SCORCHES}
        uniform float uTime; uniform vec3 uSunDir; uniform float uDefects;
        uniform vec3 uShipped; uniform vec3 uBlast; uniform vec3 uChosen; uniform vec3 uDefect;
        uniform vec4 uScorch[SCORCHES]; uniform float uScorchDepth[SCORCHES];
        varying vec3 vLocal; flat varying int vZone; varying float vCity;
        ${GLSL_NOISE}
        ${GLSL_ZONE}`,
      )
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        ${GLSL_OCTANT}
        vec3 pdir = normalize(vLocal);
        float scorch = 0.0;
        for (int i = 0; i < SCORCHES; i++) { float d = acos(clamp(dot(pdir, uScorch[i].xyz), -1.0, 1.0)); scorch += uScorchDepth[i] * smoothstep(uScorch[i].w, uScorch[i].w * 0.2, d); }
        scorch = clamp(scorch * uDefects, 0.0, 1.0);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.2, 0.18), scorch * 0.85);
        if (vCity > 0.01) { vec3 g = abs(fract(vLocal * 9.0) - 0.5); float street = smoothstep(0.47, 0.5, max(g.x, max(g.y, g.z))); diffuseColor.rgb *= 1.0 - street * 0.35 * vCity; }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float night = smoothstep(0.06, -0.22, dot(pdir, uSunDir));
        if (vZone >= 0) {
          vec4 zs = zoneState(vZone);
          float ship = zs.z;
          vec3 q = vLocal * 24.0; vec3 cell = floor(q); float h = hash3(cell); float h2 = hash3(cell + 17.0);
          float dotm = smoothstep(0.34, 0.0, length(fract(q) - 0.5));
          float lit = step(0.66 - 0.36 * ship, h) * dotm * vCity;
          vec3 warm = mix(mix(vec3(0.95, 0.86, 0.72), vec3(0.78, 0.84, 1.0), h2), uShipped * 1.6, ship);
          totalEmissiveRadiance += warm * lit * night * (0.75 + 3.2 * ship);
          totalEmissiveRadiance += uShipped * ship * (0.05 + vCity * 0.08) * (1.0 - night * 0.5);
          float hi = zoneBlast(zs);
          if (hi > 0.002) {
            float d = acos(clamp(dot(pdir, zoneCentre(vZone).xyz), -1.0, 1.0));
            float rip = 0.5 + 0.5 * sin(d * 60.0 - uTime * 5.0);
            totalEmissiveRadiance += uBlast * 1.4 * hi * (0.06 + 0.4 * rip * rip * rip);
          }
          totalEmissiveRadiance += uChosen * zs.w * 0.45;
        }
        float crack = smoothstep(0.06, 0.0, abs(vnoise(vLocal * 6.0) - 0.5)) + 0.6 * smoothstep(0.04, 0.0, abs(vnoise(vLocal * 15.0 + 3.0) - 0.5));
        totalEmissiveRadiance += uDefect * 2.4 * scorch * crack * (0.6 + 0.4 * sin(uTime * 3.0 + vLocal.x));
        totalEmissiveRadiance += uDefect * scorch * 0.12;`,
      );
  };
  return material;
}

/** The crust's shadow, cut open as the crust is. */
function cutDepthMaterial(): MeshDepthMaterial {
  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  depth.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLocal;")
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>\n${GLSL_OCTANT}`,
      );
  };
  return depth;
}

/** The crust, allocated once at its full detail and reshaped when the zones change. */
export function createTerrain(shared: SharedUniforms): Terrain {
  const base = new IcosahedronGeometry(1, 96);
  base.deleteAttribute("normal");
  base.deleteAttribute("uv");
  const geometry = mergeVertices(base);
  base.dispose();
  const positions = geometry.getAttribute("position");
  const count = positions.count;
  const directions = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    const length = Math.hypot(
      positions.getX(vertex),
      positions.getY(vertex),
      positions.getZ(vertex),
    );
    directions[vertex * 3] = positions.getX(vertex) / length;
    directions[vertex * 3 + 1] = positions.getY(vertex) / length;
    directions[vertex * 3 + 2] = positions.getZ(vertex) / length;
  }
  const colours = new BufferAttribute(new Float32Array(count * 3), 3);
  const zones = new BufferAttribute(new Float32Array(count).fill(-1), 1);
  const cities = new BufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute("color", colours);
  geometry.setAttribute("aZone", zones);
  geometry.setAttribute("aCity", cities);
  const scorches = {
    value: Array.from({ length: MAX_SCORCHES }, () => new Vector4(0, 1, 0, 0)),
  };
  const scorchDepths = { value: Array.from({ length: MAX_SCORCHES }, () => 0) };
  const mesh = new Mesh(geometry, terrainMaterial(shared, { scorches, scorchDepths }));
  mesh.customDepthMaterial = cutDepthMaterial();
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const direction = new Vector3();
  const colour = new Color();
  const rebuild = (layout: PlanetLayout) => {
    for (let vertex = 0; vertex < count; vertex += 1) {
      direction.fromArray(directions, vertex * 3);
      const ground = groundAt(layout, direction);
      const land =
        ground.owner !== undefined && Math.min(direction.x, direction.y, direction.z) < -0.06;
      const shaped = land
        ? ground
        : { owner: undefined, inside: ground.inside, height: ground.height };
      const city = groundColour(direction, shaped, colour);
      colours.setXYZ(vertex, colour.r, colour.g, colour.b);
      zones.setX(vertex, shaped.owner?.index ?? -1);
      cities.setX(vertex, city);
      const radius = PLANET_RADIUS + shaped.height;
      positions.setXYZ(vertex, direction.x * radius, direction.y * radius, direction.z * radius);
    }
    positions.needsUpdate = true;
    colours.needsUpdate = true;
    zones.needsUpdate = true;
    cities.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  };
  return { mesh, scorches, scorchDepths, rebuild };
}

const SPHERE_VERTEX = /* glsl */ `
varying vec3 vLocal; varying vec3 vWP; varying vec3 vN;
void main(){ vLocal = position; vN = normalize(mat3(modelMatrix) * normal);
  vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

/** The ocean: a glossy sphere at sea level, the sun's glint on it and its rim catching the sky. */
function ocean(shared: SharedUniforms): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(PLANET_RADIUS, 160, 110),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: shared,
      vertexShader: SPHERE_VERTEX,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; varying vec3 vLocal; varying vec3 vWP; varying vec3 vN;
        ${GLSL_NOISE}
        void main(){ ${GLSL_OCTANT}
          vec3 p = normalize(vLocal);
          vec3 w = vec3(vnoise(p*90.0 + uTime*0.25), vnoise(p*90.0 + 7.1 - uTime*0.2), vnoise(p*90.0 + 3.7 + uTime*0.15)) - 0.5;
          vec3 n = normalize(p + w * 0.012);
          vec3 V = normalize(cameraPosition - vWP);
          float ndl = dot(n, uSunDir);
          float day = smoothstep(-0.15, 0.35, dot(p, uSunDir));
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(n, H), 0.0), 260.0) * 0.6 * step(0.0, ndl) + pow(max(dot(n, H), 0.0), 40.0) * 0.03 * day;
          float fres = pow(1.0 - max(dot(V, p), 0.0), 4.0);
          vec3 col = vec3(0.01, 0.07, 0.16) * (0.05 + 1.1 * max(ndl, 0.0)) + vec3(0.2, 0.4, 0.7) * fres * day * 0.18 + vec3(1.0, 0.92, 0.8) * spec;
          col += vec3(0.01, 0.02, 0.05) * (1.0 - day);
          gl_FragColor = vec4(col, 0.8 + fres * 0.15); ${GLSL_OUTPUT}
        }`,
    }),
  );
  mesh.renderOrder = 1;
  return mesh;
}

/** The clouds: banded weather drifting over the crust, lit by the sun and thinning near the camera. */
function clouds(shared: SharedUniforms): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(PLANET_RADIUS + 1.05, 128, 90),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: shared,
      vertexShader: SPHERE_VERTEX,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSunDir; varying vec3 vLocal; varying vec3 vWP; varying vec3 vN;
        ${GLSL_NOISE}
        void main(){ ${GLSL_OCTANT}
          vec3 p = normalize(vLocal);
          vec3 q = p * 2.6 + vec3(uTime * 0.008, 0.0, uTime * 0.004);
          float n = fbm(q + fbm(q * 1.7) * 0.8);
          float band = 0.55 + 0.45 * cos(p.y * 7.0);
          float cov = smoothstep(0.56, 0.78, n * (0.82 + 0.25 * band));
          float ndl = dot(p, uSunDir);
          float light = smoothstep(-0.2, 0.45, ndl);
          vec3 col = mix(vec3(0.02, 0.025, 0.05), vec3(1.05, 1.03, 1.0), light);
          col = mix(col, vec3(1.1, 0.5, 0.3), exp(-pow(ndl * 4.5, 2.0)) * 0.55);
          float near = smoothstep(2.0, 7.0, distance(cameraPosition, vWP));
          gl_FragColor = vec4(col, cov * 0.36 * (0.25 + 0.75 * light) * near); ${GLSL_OUTPUT}
        }`,
    }),
  );
  mesh.renderOrder = 3;
  return mesh;
}

/** The atmosphere: a halo around the limb, blue by day and red at the terminator, and a haze over the crust. */
function atmosphere(shared: SharedUniforms): Mesh[] {
  const outer = PLANET_RADIUS * 1.17;
  const halo = new Mesh(
    new SphereGeometry(outer, 96, 64),
    new ShaderMaterial({
      side: BackSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: shared,
      vertexShader: SPHERE_VERTEX,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; varying vec3 vN; varying vec3 vWP;
        void main(){
          vec3 V = normalize(cameraPosition - vWP);
          float rim = dot(-vN, V);
          float k = pow(smoothstep(0.0, 0.62, rim), 2.0) * smoothstep(0.98, 0.5, rim);
          float s = dot(normalize(vWP), uSunDir);
          vec3 day = vec3(0.22, 0.55, 1.35) * smoothstep(-0.35, 0.6, s);
          vec3 dusk = vec3(1.0, 0.42, 0.2) * exp(-pow((s + 0.05) * 5.0, 2.0)) * 0.6;
          vec3 night = vec3(0.03, 0.05, 0.14);
          gl_FragColor = vec4((day + dusk + night) * k * 0.3 * smoothstep(${outer.toFixed(2)}, ${(outer + 3).toFixed(2)}, length(cameraPosition)), 1.0); ${GLSL_OUTPUT}
        }`,
    }),
  );
  halo.renderOrder = 5;
  const haze = new Mesh(
    new SphereGeometry(PLANET_RADIUS + 1.25, 128, 90),
    new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: shared,
      vertexShader: SPHERE_VERTEX,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir; varying vec3 vN; varying vec3 vWP; varying vec3 vLocal;
        void main(){ ${GLSL_OCTANT}
          vec3 V = normalize(cameraPosition - vWP);
          float fres = pow(1.0 - max(dot(vN, V), 0.0), 3.0);
          float s = dot(vN, uSunDir);
          vec3 c = vec3(0.2, 0.45, 1.0) * smoothstep(-0.25, 0.6, s) * fres * 0.2 + vec3(1.0, 0.4, 0.22) * exp(-pow(s * 3.5, 2.0)) * fres * 0.12;
          gl_FragColor = vec4(c, 1.0); ${GLSL_OUTPUT}
        }`,
    }),
  );
  haze.renderOrder = 4;
  return [halo, haze];
}

/** The ocean, the clouds, and the atmosphere. */
export function createAir(shared: SharedUniforms): Mesh[] {
  return [ocean(shared), clouds(shared), ...atmosphere(shared)];
}
