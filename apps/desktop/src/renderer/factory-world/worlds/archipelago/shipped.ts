import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { PickTarget, WorldPalette, WorldPicking } from "@luke/panel/factory-world/world";
import { PICK_KIND } from "@luke/panel/factory-world/world";
import type { TimelineEntry } from "@luke/ui/factory-world";
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  type Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import type { Effects } from "./effects";
import type { Isle } from "./islands";
import {
  airshipHull,
  box,
  easeInOut,
  hashOf,
  mergedSome,
  PALETTE,
  pickOf,
  randomOf,
  sphere,
  TAU,
  tint,
  xf,
} from "./kit";
import { dashedPath, runningDashes, SUN_DIRECTION } from "./mood";

/**
 * shipped.ts -- what merged: an airship for each pull request, lifting off the island it landed on, through the golden gate, and down the lane into the sunset, the newest nearest the gate; sky lanterns rising off the zones alive with merges; and fireworks over the liveliest.
 *
 * An airship's place is read from its age at the scrubber's instant alone,
 * on a log scale over the window, so every pull request in the window is on
 * the lane and scrubbing flies them back. While motion runs, the newest
 * merges take turns lifting off again with fanfare; that hero, the lanterns,
 * and the fireworks are idle motion, and the still frame says the same with
 * the airships and the islands' lit rims.
 */

const MAX_SHIPPED = FACTORY_WORLD_BOUNDS.MAX_SHIPPED;
const LANTERNS = 320;

/** How long a merge spends flying from its island to the gate, in hours. */
const LIFT_OFF_HOURS = 0.6;

/** How far down the lane the oldest merge of the window has sailed. */
const LANE_LENGTH = 270;

const HOUR_MS = 60 * 60 * 1000;

/** The direction of the sun across the plane: where the lane runs. */
const SUN_FLAT = new Vector3(SUN_DIRECTION.x, 0, SUN_DIRECTION.z).normalize();
const LANE_DIRECTION = SUN_FLAT.clone()
  .add(new Vector3(0, 0.1, 0))
  .normalize();

/** Where the golden gate stands for an archipelago `extent` across: out towards the sun, above the islands. */
export function gateOf(extent: number): Vector3 {
  return SUN_FLAT.clone()
    .multiplyScalar(extent * 1.2 + 10)
    .setY(30);
}

/** One airship as placed by the last update. */
interface Airship {
  readonly entry: TimelineEntry;
  readonly from: Vector3;
  readonly ageHours: number;
  readonly spread: number;
  readonly lift: number;
  readonly phase: number;
  readonly scale: number;
}

/** One sky lantern: the island it rose from, how far through its rise, and its drift. */
interface Lantern {
  readonly random: () => number;
  isle: Isle | undefined;
  t: number;
  readonly life: number;
  readonly offset: Vector3;
  readonly drift: Vector3;
}

/** The zone a merge landed most of its lines in, of those it names. */
function homeOf(entry: TimelineEntry): string | undefined {
  const lines = new Map<string, number>();
  for (const area of entry.areas) {
    const zone = entry.zonePaths
      .filter((path) => area.path === path || area.path.startsWith(`${path}/`) || path === ".")
      .sort((a, b) => b.length - a.length)[0];
    if (zone !== undefined)
      lines.set(zone, (lines.get(zone) ?? 0) + area.additions + area.deletions);
  }
  return [...lines].sort((a, b) => b[1] - a[1])[0]?.[0] ?? entry.zonePaths[0];
}

function bezier(a: Vector3, c: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  const u = 1 - t;
  return out.set(
    u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    u * u * a.y + 2 * u * t * c.y + t * t * b.y,
    u * u * a.z + 2 * u * t * c.z + t * t * b.z,
  );
}

/** The shipped work as the world drives it. */
export interface Shipped {
  readonly update: (input: {
    readonly timeline: readonly TimelineEntry[];
    readonly instant: number;
    readonly windowOpens: number;
    readonly isles: ReadonlyMap<string, Isle>;
    readonly extent: number;
    readonly shown: boolean;
    readonly live: boolean;
    readonly still: boolean;
    readonly elapsed: number;
    /** The zones at the instant, by path, for how alive each is. */
    readonly zones: ReadonlyMap<string, { readonly alive: number }>;
    readonly chosen: (url: string) => "selected" | "hovered" | undefined;
  }) => void;
  readonly frame: (delta: number, elapsed: number) => void;
  readonly placeStill: () => void;
}

/** The shipped work, allocated in `scene` at its bounds and registered for picking. */
export function shippedOf(
  scene: Scene,
  picking: WorldPicking,
  palette: WorldPalette,
  effects: Effects,
  glow: { value: number },
  time: { value: number },
): Shipped {
  const shippedColor = new Color(palette.signal.SHIPPED);
  const shipGeometry = mergedSome([
    xf(sphere(1, 16, 10, "#ffffff"), 0, 0, 0, 0, 0, 0, 1.15, 0.42, 0.42),
    xf(box(0.4, 0.34, 0.02, "#b84a3a"), -1.05, 0.2, 0),
    xf(box(0.4, 0.02, 0.34, "#b84a3a"), -1.05, 0, 0),
    xf(
      tint(new CylinderGeometry(0.43, 0.43, 0.08, 16).rotateZ(Math.PI / 2), "#c9553e"),
      0.35,
      0,
      0,
    ),
    xf(box(0.5, 0.16, 0.22, PALETTE.WOOD), 0, -0.53, 0),
  ]);
  const shipMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.05,
  });
  shipMaterial.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.22;",
    );
  };
  shipMaterial.customProgramCacheKey = () => "archipelago-airship";
  const ships = new InstancedMesh(shipGeometry, shipMaterial, MAX_SHIPPED);
  const lampGeometry = mergedSome([
    tint(new SphereGeometry(0.16, 8, 6).translate(0, -0.74, 0), "#ffffff"),
    tint(new SphereGeometry(0.1, 6, 4).translate(1.18, 0, 0), "#ffffff"),
    tint(new SphereGeometry(0.1, 6, 4).translate(-0.2, 0.44, 0), "#ffffff"),
  ]);
  const lamps = new InstancedMesh(
    lampGeometry,
    new MeshBasicMaterial({ vertexColors: true }),
    MAX_SHIPPED,
  );
  const lanterns = new InstancedMesh(
    tint(new CylinderGeometry(0.13, 0.1, 0.28, 6), "#ffffff"),
    new MeshBasicMaterial({ vertexColors: true }),
    LANTERNS,
  );
  for (const mesh of [ships, lamps, lanterns]) {
    mesh.setColorAt(0, new Color(1, 1, 1));
    mesh.count = 0;
    mesh.frustumCulled = false;
  }
  ships.castShadow = true;

  const gate = new Group();
  const gold = new MeshBasicMaterial({ color: palette.signal.SHIPPED });
  const outerRing = new Mesh(new TorusGeometry(7.5, 0.6, 10, 64), gold);
  for (let k = 0; k < 8; k += 1) {
    const fin = new Mesh(new BoxGeometry(0.35, 1.3, 0.35), gold);
    const a = (k / 8) * TAU;
    fin.position.set(Math.cos(a) * 8.4, Math.sin(a) * 8.4, 0);
    fin.rotation.z = a + Math.PI / 2;
    outerRing.add(fin);
  }
  const innerRing = new Mesh(
    new TorusGeometry(6.1, 0.2, 6, 48),
    new MeshBasicMaterial({ color: new Color(palette.signal.SHIPPED).multiplyScalar(1.3) }),
  );
  const discMaterial = new MeshBasicMaterial({
    color: new Color(palette.signal.SHIPPED).multiplyScalar(0.25),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  gate.add(outerRing, innerRing, new Mesh(new CircleGeometry(6, 48), discMaterial));
  const lane = new LineSegments(
    new BufferGeometry(),
    runningDashes(shippedColor, time, { dash: 2.6, gap: 1.4, speed: 4, opacity: 0.85 }),
  );
  lane.frustumCulled = false;
  const hero = new Mesh(
    airshipHull("#fff1d6"),
    new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true }),
  );
  hero.visible = false;
  scene.add(ships, lamps, lanterns, gate, lane, hero);

  let airships: Airship[] = [];
  let targets: PickTarget[] = [];
  let gateAt = new Vector3(120, 30, 0);
  let alive: { isle: Isle; weight: number }[] = [];
  let isles: ReadonlyMap<string, Isle> = new Map();
  let shown = true;
  let live = true;
  let chosenOf: (url: string) => "selected" | "hovered" | undefined = () => undefined;
  const lanternState = Array.from({ length: LANTERNS }, (_, i): Lantern => {
    const random = randomOf(0x1a7 + i);
    return {
      random,
      isle: undefined,
      t: random(),
      life: 16 + random() * 14,
      offset: new Vector3(),
      drift: new Vector3(),
    };
  });
  picking.addInstances(ships, (instanceId) => targets[instanceId]);
  picking.addInstances(lamps, (instanceId) => targets[instanceId]);

  const object = new Object3D();
  const look = new Vector3();
  const control = new Vector3();
  const side = new Vector3(-LANE_DIRECTION.z, 0, LANE_DIRECTION.x);
  const shade = new Color();
  let heroAt = 2.5;
  let heroOrder = 0;
  let flight: { airship: Airship; t: number } | undefined;
  let fireworkAt = 3;

  /** Where an airship of `age` hours stands, and where it looks; answers how far down the lane it is. */
  const path = (airship: Airship, ageHours: number, windowHours: number, out: Vector3): number => {
    control.lerpVectors(airship.from, gateAt, 0.5);
    control.y = Math.max(airship.from.y, gateAt.y) + 12;
    if (ageHours < LIFT_OFF_HOURS) {
      const t = easeInOut(ageHours / LIFT_OFF_HOURS);
      bezier(airship.from, control, gateAt, t, out);
      bezier(airship.from, control, gateAt, Math.min(1, t + 0.03), look);
      return 0;
    }
    const along =
      6 +
      LANE_LENGTH * (Math.log1p(ageHours - LIFT_OFF_HOURS) / Math.log1p(Math.max(1, windowHours)));
    const widen = Math.min(1, along / 25);
    out
      .copy(gateAt)
      .addScaledVector(LANE_DIRECTION, along)
      .addScaledVector(side, airship.spread * 7 * widen);
    out.y += airship.lift * 0.5 * widen;
    look.copy(out).add(LANE_DIRECTION);
    return along;
  };

  let windowHours = 24 * 14;
  let read:
    | {
        timeline: readonly TimelineEntry[];
        instant: number;
        isles: ReadonlyMap<string, Isle>;
        shown: boolean;
      }
    | undefined;
  const place = (elapsed: number, still: boolean) => {
    airships.forEach((airship, i) => {
      const along = path(airship, airship.ageHours, windowHours, object.position);
      if (!still) object.position.y += Math.sin(elapsed * 0.6 + airship.phase) * 0.3;
      const choice = chosenOf(airship.entry.url);
      const pop = choice === undefined ? 1 : 1.6;
      const direction = look.sub(object.position);
      object.rotation.set(
        0,
        Math.atan2(-direction.z, direction.x),
        still ? 0 : Math.sin(elapsed * 0.8 + airship.phase) * 0.04,
      );
      object.scale.setScalar(Math.max(0.001, airship.scale * Math.max(0.6, 1 - along / 300) * pop));
      object.updateMatrix();
      ships.setMatrixAt(i, object.matrix);
      lamps.setMatrixAt(i, object.matrix);
      const fresh = Math.max(1, 1.6 * Math.exp(-airship.ageHours / 6));
      lamps.setColorAt(
        i,
        choice === undefined
          ? shade.copy(shippedColor).multiplyScalar(fresh * Math.min(1.4, glow.value))
          : shade.set(palette.signal.SELECTION),
      );
    });
    ships.instanceMatrix.needsUpdate = true;
    lamps.instanceMatrix.needsUpdate = true;
    if (lamps.instanceColor !== null) lamps.instanceColor.needsUpdate = true;
    if (!still) {
      outerRing.rotation.z = elapsed * 0.25;
      innerRing.rotation.z = -elapsed * 0.6;
    }
  };

  const stepLanterns = (delta: number, elapsed: number) => {
    const total = alive.reduce((sum, entry) => sum + entry.weight, 0);
    const cap = Math.min(LANTERNS, Math.round(total * 14));
    lanternState.forEach((lantern, i) => {
      lantern.t += delta / lantern.life;
      if (lantern.t >= 1 || lantern.isle === undefined) {
        lantern.t = lantern.isle === undefined ? lantern.random() : 0;
        let u = lantern.random() * total;
        lantern.isle = undefined;
        for (const entry of alive) {
          u -= entry.weight;
          if (u <= 0) {
            lantern.isle = entry.isle;
            break;
          }
        }
        const isle = lantern.isle;
        if (isle !== undefined) {
          const theta = lantern.random() * TAU;
          const d = Math.sqrt(lantern.random()) * isle.radius * 0.8;
          lantern.offset
            .set(
              Math.cos(theta) * d,
              isle.topHeight(Math.cos(theta) * d, Math.sin(theta) * d) + 0.6,
              Math.sin(theta) * d,
            )
            .add(isle.position);
        }
        lantern.drift.set((lantern.random() - 0.3) * 4, 0, (lantern.random() - 0.5) * 4);
      }
      const showing = i < cap && lantern.isle !== undefined && shown;
      object.position.copy(lantern.offset).addScaledVector(lantern.drift, lantern.t);
      object.position.y += lantern.t * 24;
      object.position.x += Math.sin(elapsed * 0.7 + i) * 0.3 * lantern.t;
      object.rotation.set(0, i, 0);
      object.scale.setScalar(
        showing ? Math.max(0.001, Math.min(1, lantern.t * 12) * (1 - lantern.t ** 4) * 1.2) : 0,
      );
      object.updateMatrix();
      lanterns.setMatrixAt(i, object.matrix);
      lanterns.setColorAt(
        i,
        shade
          .copy(shippedColor)
          .multiplyScalar((1.1 + 0.25 * Math.sin(elapsed * 9 + i)) * Math.min(1.5, glow.value)),
      );
    });
    lanterns.count = LANTERNS;
    lanterns.instanceMatrix.needsUpdate = true;
    if (lanterns.instanceColor !== null) lanterns.instanceColor.needsUpdate = true;
  };

  const stepHero = (delta: number, elapsed: number) => {
    const recent = [...airships].sort((a, b) => a.ageHours - b.ageHours).slice(0, 24);
    if (!live || !shown || recent.length === 0) {
      hero.visible = false;
      flight = undefined;
      return;
    }
    if (flight === undefined && elapsed > heroAt) {
      const airship = recent[heroOrder % recent.length];
      heroOrder += 1;
      if (airship !== undefined) {
        flight = { airship, t: 0 };
        effects.burst(airship.from.clone().add(new Vector3(0, 1, 0)), shippedColor, 80);
      }
    }
    if (flight === undefined) return;
    flight.t += delta / 6;
    path(flight.airship, Math.min(1, flight.t) * LIFT_OFF_HOURS, windowHours, hero.position);
    const direction = look.clone().sub(hero.position);
    hero.rotation.set(0, Math.atan2(-direction.z, direction.x), Math.sin(elapsed * 2) * 0.06);
    const pop = flight.t < 0.12 ? 1 + Math.sin((flight.t / 0.12) * Math.PI) * 0.35 : 1;
    hero.scale.setScalar(1.6 * Math.min(1, flight.t * 10) * pop);
    hero.visible = true;
    if (flight.t >= 1) {
      effects.burst(gateAt, shippedColor, 110);
      flight = undefined;
      hero.visible = false;
      heroAt = elapsed + 2.2;
    }
  };

  const stepFireworks = (elapsed: number) => {
    if (!live || !shown || elapsed < fireworkAt) return;
    fireworkAt = elapsed + 3 + ((elapsed * 7.3) % 4);
    const lively = alive.filter((entry) => entry.weight > 0.3);
    const total = lively.reduce((sum, entry) => sum + entry.weight, 0);
    let u = ((elapsed * 13.7) % 1) * total;
    for (const entry of lively) {
      u -= entry.weight;
      if (u > 0) continue;
      const { isle } = entry;
      const at = new Vector3(
        Math.sin(elapsed) * isle.radius * 0.5,
        isle.topHeight(0, 0) + 9 + (elapsed % 5),
        Math.cos(elapsed) * isle.radius * 0.5,
      ).add(isle.position);
      effects.burst(at, shippedColor, 70);
      return;
    }
  };

  const readAirships = (timeline: readonly TimelineEntry[], instant: number) => {
    const entries = shown ? timeline.slice(-MAX_SHIPPED) : [];
    airships = entries.map((entry) => {
      const random = randomOf(hashOf(entry.url));
      const home = homeOf(entry);
      const isle = home === undefined ? undefined : isles.get(home);
      const from =
        isle === undefined
          ? new Vector3(0, 20, 0)
          : new Vector3(0, isle.topHeight(0, 0) + 2, 0).add(isle.position);
      return {
        entry,
        from,
        ageHours: Math.max(0, (instant - entry.mergedAt) / HOUR_MS),
        spread: (random() - 0.5) * 0.9,
        lift: random() * 10,
        phase: random() * TAU,
        scale: 0.9 + 0.32 * Math.log10(entry.additions + entry.deletions + 10),
      };
    });
    targets = airships.map((airship) => ({ kind: PICK_KIND.SHIPPED, id: airship.entry.url }));
    airships.forEach((airship, i) => {
      const canvas = pickOf(randomOf(airship.entry.number), [
        "#f6ead6",
        "#f2dfc0",
        "#efe6dc",
        "#f4d9c6",
      ] as const);
      ships.setColorAt(i, shade.set(canvas).lerp(shippedColor, 0.22));
    });
    ships.count = airships.length;
    lamps.count = airships.length;
    if (ships.instanceColor !== null) ships.instanceColor.needsUpdate = true;
  };

  return {
    update: (input) => {
      shown = input.shown;
      live = input.live;
      isles = input.isles;
      chosenOf = input.chosen;
      windowHours = Math.max(1, (input.instant - input.windowOpens) / HOUR_MS);
      if (read === undefined || read.isles !== isles) {
        gateAt = gateOf(input.extent);
        gate.position.copy(gateAt);
        gate.lookAt(gateAt.clone().add(LANE_DIRECTION));
        lane.geometry.dispose();
        lane.geometry = dashedPath([
          Array.from({ length: 61 }, (_, i) =>
            gateAt.clone().addScaledVector(LANE_DIRECTION, i * 5),
          ),
        ]);
      }
      // Note that a hover changes only what is chosen, so the airships are read again only when the timeline, the instant, or the islands change.
      const same =
        read !== undefined &&
        read.timeline === input.timeline &&
        read.instant === input.instant &&
        read.isles === isles &&
        read.shown === shown;
      read = { timeline: input.timeline, instant: input.instant, isles, shown };
      if (!same) readAirships(input.timeline, input.instant);
      alive = [...isles.values()].flatMap((isle) => {
        const weight = input.zones.get(isle.zone.path)?.alive ?? 0;
        return weight > 0.05 ? [{ isle, weight: weight * 2.5 }] : [];
      });
      for (const mesh of [ships, lamps, lanterns, gate, lane]) mesh.visible = shown;
      if (!shown) hero.visible = false;
      place(input.still ? 0 : input.elapsed, input.still);
    },
    frame: (delta, elapsed) => {
      place(elapsed, false);
      stepLanterns(delta, elapsed);
      stepHero(delta, elapsed);
      stepFireworks(elapsed);
    },
    placeStill: () => {
      place(0, true);
      lanterns.count = 0;
      hero.visible = false;
      flight = undefined;
    },
  };
}
