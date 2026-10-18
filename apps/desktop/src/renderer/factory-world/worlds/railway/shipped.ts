import type { SIGNAL_COLOR, TimelineEntry } from "@luke/ui/factory-world";
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from "three";
import { clamp, hashOf, hidden, placing, seeded, TAU, UNIT_GEOMETRY } from "./kit";
import type { District, Layout } from "./layout";
import type { Lot } from "./lots";
import type { Particles } from "./particles";

/**
 * shipped.ts -- what merged: a fresh house for each pull request in the district it landed in, its roof in shipped's colour and brighter the fresher it is, bunting strung over the street, and, while the board shows now, confetti when an express pulls in and fireworks over the districts that shipped the most.
 *
 * A pull request's district is the zone it changed the most lines in. Its
 * house claims a lot there (`lots.ts`), the newest last so a scrub forward
 * only ever adds houses; a house that appears while motion runs pops up out
 * of the ground. The houses, flags, bulbs and confetti are instanced meshes
 * at their bounds.
 */

/** How many of each the shipped layer holds at most. */
const CAPACITY = { HOUSES: 200, FLAGS: 4200, CONFETTI: 900 } as const;

/** How long a merge takes to lose half its freshness: the view model's alive half-life. */
const FRESH_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;

/** The zone a merge changed the most lines in, of those it landed in. */
function primaryZoneOf(entry: TimelineEntry): string | undefined {
  const lines = new Map<string, number>();
  for (const area of entry.areas) {
    // Note that an area lands in the deepest of the merge's zones that holds it.
    const zone = [...entry.zonePaths]
      .filter((path) => area.path === path || area.path.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (zone !== undefined)
      lines.set(zone, (lines.get(zone) ?? 0) + area.additions + area.deletions);
  }
  const ranked = [...lines].sort(([a, left], [b, right]) => right - left || (a < b ? -1 : 1));
  return ranked[0]?.[0] ?? entry.zonePaths[0];
}

/** The shipped layer's meshes, made once at their bounds. */
export function shippedMeshes(signal: typeof SIGNAL_COLOR) {
  const flag = new BufferGeometry().setAttribute(
    "position",
    new Float32BufferAttribute([-0.11, 0, 0, 0.11, 0, 0, 0, -0.24, 0], 3),
  );
  flag.computeVertexNormals();
  const meshes = {
    walls: new InstancedMesh(
      new BoxGeometry(1.15, 0.95, 0.95).translate(0, 0.475, 0),
      new MeshStandardMaterial({ color: "#f4ecda", roughness: 0.7 }),
      CAPACITY.HOUSES,
    ),
    roofs: new InstancedMesh(
      UNIT_GEOMETRY.gable().scale(1.4, 0.75, 1.16).translate(0, 0.95, 0),
      new MeshStandardMaterial({
        roughness: 0.35,
        metalness: 0.1,
        emissive: new Color(signal.SHIPPED),
        emissiveIntensity: 0.35,
      }),
      CAPACITY.HOUSES,
    ),
    windows: new InstancedMesh(
      new BoxGeometry(1.17, 0.22, 0.6).translate(0, 0.5, 0),
      new MeshBasicMaterial({ color: "#ffffff" }),
      CAPACITY.HOUSES,
    ),
    flags: new InstancedMesh(
      flag,
      new MeshStandardMaterial({ side: DoubleSide, roughness: 0.7 }),
      CAPACITY.FLAGS,
    ),
    bulbs: new InstancedMesh(
      new OctahedronGeometry(0.05),
      new MeshBasicMaterial({ color: "#ffd98a" }),
      CAPACITY.FLAGS,
    ),
    confetti: new InstancedMesh(
      new PlaneGeometry(0.16, 0.1),
      new MeshStandardMaterial({ side: DoubleSide, roughness: 0.6 }),
      CAPACITY.CONFETTI,
    ),
  };
  for (const mesh of Object.values(meshes)) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  }
  meshes.walls.castShadow = true;
  meshes.roofs.castShadow = true;
  meshes.walls.receiveShadow = true;
  meshes.roofs.receiveShadow = true;
  return meshes;
}

export type ShippedMeshes = ReturnType<typeof shippedMeshes>;

/** One merge's house: where, which way, how fresh, and when it first showed. */
export interface House {
  readonly entry: TimelineEntry;
  readonly district: District;
  readonly x: number;
  readonly z: number;
  readonly ry: number;
  /** In (0, 1]: one for a merge this instant, halving every three days. */
  readonly fresh: number;
}

/** One flag of a merge's bunting. */
interface Flag {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  readonly color: Color;
}

/** Where each merge's house stands, in merge order, claiming its lot through `claim`. */
export function siteHouses(
  timeline: readonly TimelineEntry[],
  layout: Layout,
  now: number,
  claim: (district: District, seed: string, radius: number) => Lot,
): House[] {
  return timeline.slice(-CAPACITY.HOUSES).flatMap((entry) => {
    const path = primaryZoneOf(entry);
    const district = path === undefined ? undefined : layout.byPath.get(path);
    if (district === undefined) return [];
    const lot = claim(district, entry.url, 0.6);
    const turn = Math.floor(seeded(hashOf(entry.url))() * 4);
    const fresh = 0.5 ** (Math.max(0, now - entry.mergedAt) / FRESH_HALF_LIFE_MS);
    return [
      { entry, district, x: lot.x, z: lot.z, ry: district.rot + (turn * Math.PI) / 2, fresh },
    ];
  });
}

/** The bunting over each house's street: a sagging string of flags between two seeded points of its district. */
function buntingOf(houses: readonly House[], signal: typeof SIGNAL_COLOR): Flag[] {
  const colors = [
    new Color(signal.SHIPPED),
    new Color("#f6f3ec"),
    new Color("#9fd2ae"),
    new Color("#f4e3c0"),
  ];
  const flags: Flag[] = [];
  for (const house of houses) {
    const { district } = house;
    const rnd = seeded(hashOf(`bunting:${house.entry.url}`));
    const angle = rnd() * TAU;
    const r = rnd() * district.plotRadius * 0.7;
    const length = 2.5 + rnd() * Math.min(5, district.plotRadius);
    const start = new Vector3(
      district.x + Math.cos(angle) * r,
      0,
      district.z + Math.sin(angle) * r,
    );
    const heading = angle + Math.PI * (0.6 + rnd() * 0.8);
    const end = new Vector3(
      start.x + Math.cos(heading) * length,
      0,
      start.z + Math.sin(heading) * length,
    );
    const height = 2.2 + rnd() * 1.6;
    const count = Math.round(length / 0.32);
    const scale = clamp(0.5 + house.fresh, 0.5, 1);
    for (let index = 0; index <= count && flags.length < CAPACITY.FLAGS; index += 1) {
      const t = index / count;
      const at = start.clone().lerp(end, t);
      flags.push({
        x: at.x,
        y: height - Math.sin(t * Math.PI) * 0.55,
        z: at.z,
        yaw: Math.atan2(-(end.z - start.z), end.x - start.x),
        scale,
        color: colors[index % colors.length] ?? new Color(signal.SHIPPED),
      });
    }
  }
  return flags;
}

/** The shipped layer as drawn: its houses and bunting, and when each house first showed. */
export interface Shipped {
  readonly houses: readonly House[];
  readonly flags: readonly Flag[];
}

/** Paints the houses and strings the bunting; answers what the frame animates. */
export function raiseShipped(
  houses: readonly House[],
  meshes: ShippedMeshes,
  signal: typeof SIGNAL_COLOR,
  night: number,
): Shipped {
  const roof = new Color();
  const weathered = new Color(signal.SHIPPED).lerp(new Color("#c9c4b5"), 0.45);
  const glow = new Color();
  houses.forEach((house, index) => {
    meshes.roofs.setColorAt(
      index,
      roof.copy(weathered).lerp(new Color(signal.SHIPPED), house.fresh),
    );
    meshes.windows.setColorAt(
      index,
      glow.set("#ffd98a").multiplyScalar(0.4 + night * 3.2 * house.fresh),
    );
  });
  for (const mesh of [meshes.walls, meshes.roofs, meshes.windows]) mesh.count = houses.length;
  for (const mesh of [meshes.roofs, meshes.windows]) {
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
  const roofs = meshes.roofs.material;
  if (roofs instanceof MeshStandardMaterial) roofs.emissiveIntensity = 0.3 + night * 0.35;
  const flags = buntingOf(houses, signal);
  flags.forEach((flag, index) => {
    meshes.flags.setColorAt(index, flag.color);
  });
  meshes.flags.count = flags.length;
  meshes.bulbs.count = flags.length;
  if (meshes.flags.instanceColor !== null) meshes.flags.instanceColor.needsUpdate = true;
  return { houses, flags };
}

const MOVING = new Matrix4();

/** A house's height as it pops up out of the ground: overshooting, then settling. */
function popOf(progress: number): number {
  if (progress >= 1) return 1;
  if (progress <= 0) return 0;
  return 1 - Math.cos(progress * Math.PI * 3.2) * Math.exp(-progress * 5.5);
}

/** Stands every house, popping up those that first showed within the last second, and flutters the bunting. */
export function animateShipped(
  shipped: Shipped,
  meshes: ShippedMeshes,
  shownAt: ReadonlyMap<string, number>,
  time: number,
): void {
  shipped.houses.forEach((house, index) => {
    const since = shownAt.get(house.entry.url);
    const scale = 0.88 * (since === undefined ? 1 : popOf((time - since) / 0.9));
    const matrix =
      scale > 0.001
        ? placing(house.x, 0, house.z, house.ry, scale, scale, scale, 0, 0, MOVING)
        : hidden(house.x, 0, house.z, MOVING);
    meshes.walls.setMatrixAt(index, matrix);
    meshes.roofs.setMatrixAt(index, matrix);
    meshes.windows.setMatrixAt(index, matrix);
  });
  shipped.flags.forEach((flag, index) => {
    placing(
      flag.x,
      flag.y,
      flag.z,
      flag.yaw,
      flag.scale,
      flag.scale,
      flag.scale,
      Math.sin(time * 3 + index) * 0.25,
      0,
      MOVING,
    );
    meshes.flags.setMatrixAt(index, MOVING);
    meshes.bulbs.setMatrixAt(
      index,
      index % 2
        ? placing(flag.x, flag.y + 0.02, flag.z, 0, 1, 1, 1, 0, 0, MOVING)
        : hidden(flag.x, flag.y, flag.z, MOVING),
    );
  });
  for (const mesh of [meshes.walls, meshes.roofs, meshes.windows, meshes.flags, meshes.bulbs])
    mesh.instanceMatrix.needsUpdate = true;
}

/** One scrap of confetti in the air or on the ground. */
interface Scrap {
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly turn: Euler;
  readonly spin: Vector3;
  readonly color: Color;
  age: number;
}

/** The confetti thrown when an express pulls in, and the rockets over the busiest districts. */
export class Celebration {
  private readonly scraps: Scrap[] = [];
  private readonly rockets: {
    position: Vector3;
    speed: number;
    age: number;
    fuse: number;
    color: Color;
  }[] = [];
  private readonly colors: readonly Color[];
  private readonly turn = new Quaternion();
  private readonly size = new Vector3();

  constructor(
    private readonly meshes: ShippedMeshes,
    signal: typeof SIGNAL_COLOR,
  ) {
    this.colors = [signal.SHIPPED, "#f6f3ec", "#f4e3c0", "#9fd2ae", "#ffffff", "#d9e8c8"].map(
      (hex) => new Color(hex),
    );
  }

  /** Throws `count` scraps up from `at`, with a puff of steam and a shower of sparks. */
  burst(at: { x: number; z: number }, count: number, smoke: Particles, sparks: Particles): void {
    for (let index = 0; index < count; index += 1) {
      if (this.scraps.length >= CAPACITY.CONFETTI) this.scraps.shift();
      const angle = Math.random() * TAU;
      const speed = 1 + Math.random() * 2.5;
      this.scraps.push({
        position: new Vector3(at.x, 1, at.z),
        velocity: new Vector3(
          Math.cos(angle) * speed,
          4 + Math.random() * 4,
          Math.sin(angle) * speed,
        ),
        turn: new Euler(Math.random() * 6, Math.random() * 6, 0),
        spin: new Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        color: this.colors[index % this.colors.length] ?? new Color("#ffffff"),
        age: 0,
      });
    }
    for (let puff = 0; puff < 26; puff += 1) {
      smoke.emit(
        at.x,
        1,
        at.z,
        (Math.random() - 0.5) * 1.2,
        2.5 + Math.random() * 2,
        (Math.random() - 0.5) * 1.2,
        2.2,
        0.5,
        2.4,
        1,
        1,
        1,
        0.75,
        1.2,
        -0.3,
      );
    }
    for (let spark = 0; spark < 18; spark += 1) {
      sparks.emit(
        at.x,
        1.2,
        at.z,
        (Math.random() - 0.5) * 5,
        3 + Math.random() * 4,
        (Math.random() - 0.5) * 5,
        1.1,
        0.25,
        0.05,
        1.2,
        2.4,
        1.4,
        1,
        0.8,
        6,
      );
    }
  }

  /** Sends rockets up over the districts that shipped the most, more of them at night, and bursts each at the top. */
  fireworks(
    busiest: readonly { district: District; merges: number }[],
    night: number,
    delta: number,
    sparks: Particles,
  ): void {
    for (const { district, merges } of busiest) {
      if (Math.random() >= delta * merges * 0.012 * (0.25 + night)) continue;
      const angle = Math.random() * TAU;
      const r = Math.random() * district.plotRadius * 0.6;
      this.rockets.push({
        position: new Vector3(
          district.x + Math.cos(angle) * r,
          0.5,
          district.z + Math.sin(angle) * r,
        ),
        speed: 9 + Math.random() * 4,
        age: 0,
        fuse: 1 + Math.random() * 0.5,
        color: this.colors[Math.floor(Math.random() * this.colors.length)] ?? new Color("#ffffff"),
      });
    }
    for (let index = this.rockets.length - 1; index >= 0; index -= 1) {
      const rocket = this.rockets[index];
      if (rocket === undefined) continue;
      rocket.age += delta;
      rocket.position.y += rocket.speed * delta;
      rocket.speed *= 0.985;
      sparks.emit(
        rocket.position.x,
        rocket.position.y,
        rocket.position.z,
        0,
        -0.5,
        0,
        0.4,
        0.22,
        0.05,
        2.5,
        1.8,
        1,
        1,
        1,
        0,
      );
      if (rocket.age <= rocket.fuse) continue;
      const bright = 2.2 + night * 2.5;
      for (let star = 0; star < 70; star += 1) {
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * TAU;
        const ring = Math.sqrt(1 - u * u);
        const speed = 3.5 + Math.random() * 1.2;
        sparks.emit(
          rocket.position.x,
          rocket.position.y,
          rocket.position.z,
          Math.cos(theta) * ring * speed,
          u * speed,
          Math.sin(theta) * ring * speed,
          1.5 + Math.random() * 0.6,
          0.32,
          0.08,
          rocket.color.r * bright,
          rocket.color.g * bright,
          rocket.color.b * bright,
          1,
          1.4,
          2.2,
        );
      }
      this.rockets.splice(index, 1);
    }
  }

  /** Lets every scrap fall, tumble and settle, and fades the ones that have lain a while. */
  step(delta: number): void {
    for (const scrap of this.scraps) {
      scrap.age += delta;
      if (scrap.position.y > 0.08) {
        scrap.velocity.y -= 7 * delta;
        scrap.velocity.multiplyScalar(Math.exp(-2.2 * delta));
        scrap.velocity.y = Math.max(scrap.velocity.y, -1.1);
        scrap.position.addScaledVector(scrap.velocity, delta);
        scrap.turn.set(
          scrap.turn.x + scrap.spin.x * delta,
          scrap.turn.y + scrap.spin.y * delta,
          scrap.turn.z + scrap.spin.z * delta,
        );
      } else {
        scrap.position.y = 0.07;
        scrap.turn.set(-Math.PI / 2, 0, 0);
      }
    }
    while ((this.scraps[0]?.age ?? 0) > 8) this.scraps.shift();
    this.scraps.forEach((scrap, index) => {
      const fade = scrap.age > 6 ? Math.max(0, 1 - (scrap.age - 6) / 2) : 1;
      MOVING.compose(scrap.position, this.turn.setFromEuler(scrap.turn), this.size.setScalar(fade));
      this.meshes.confetti.setMatrixAt(index, MOVING);
      this.meshes.confetti.setColorAt(index, scrap.color);
    });
    this.meshes.confetti.count = this.scraps.length;
    this.meshes.confetti.instanceMatrix.needsUpdate = true;
    if (this.meshes.confetti.instanceColor !== null)
      this.meshes.confetti.instanceColor.needsUpdate = true;
  }

  /** Lets every scrap and rocket go, for a world held still. */
  clear(): void {
    this.scraps.length = 0;
    this.rockets.length = 0;
    this.meshes.confetti.count = 0;
  }
}
