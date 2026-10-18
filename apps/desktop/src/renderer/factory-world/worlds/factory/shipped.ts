import { FACTORY_WORLD_BOUNDS } from "@luke/features/factory-world-wire";
import type { TimelineEntry } from "@luke/ui/factory-world";
import {
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import type { WorldPalette } from "../../world";
import type { Building, Spot as BuildingSpot } from "./buildings";
import { glowMaterial } from "./effects";
import { col, PRIM, partGeo } from "./geo";
import type { Layout, Lot } from "./layout";

/**
 * shipped.ts -- the Factory's shipped work: a lamp lit on the building each merged pull request landed in, a pin over every building that took one, and the glow round a zone alive with merges.
 *
 * A merged pull request hangs a lamp in the shipped signal's colour on the
 * building of the zone it changed most, filling the building's lamp slots
 * from the middle of its front outward and stacking above once they are
 * full; one that landed in no zone hangs on the fence by the gate it left
 * through. A fresh merge's lamp is larger and settles over hours, read from
 * the scrubber's instant, never the clock. Every building that took one
 * flies a pin with a check, larger as more land, and a zone glows on the
 * ground as alive as the view model says it is.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_SHIPPED;

const MAX_ZONES = FACTORY_WORLD_BOUNDS.MAX_ZONES;

/** How long a fresh merge's lamp takes to settle, in hours. */
const SETTLE_HOURS = 3;

/** One lamp: the merge it stands for, where it hangs, and how fresh it is. */
interface Lamp {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly fresh: number;
}

/** One pin: the zone it flies over, where, and how many merges it counts. */
interface Pin {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly count: number;
}

/** The shipped signal, drawn. */
export interface ShippedLayer {
  readonly group: Group;
  readonly lamps: InstancedMesh;
  readonly pins: InstancedMesh;
  readonly lampUrlAt: (index: number) => string | undefined;
  readonly pinPathAt: (index: number) => string | undefined;
  /** Hangs every merge in `timeline` as of `instant`, and glows each lot as alive as `aliveOf` says its zone is now. */
  readonly show: (
    timeline: readonly TimelineEntry[],
    instant: number,
    aliveOf: (path: string) => number,
    chosen: (url: string) => boolean,
    shown: boolean,
  ) => void;
  /** Lays the lamps and pins out over `layout`'s buildings and their lamp slots; called when the yard is built. */
  readonly settle: (
    layout: Layout,
    buildings: readonly Building[],
    lampSlots: readonly (readonly BuildingSpot[])[],
  ) => void;
  /** Twinkles the lamps and bobs the pins `time` seconds in; at zero, both stand at rest. */
  readonly step: (time: number, scale: number) => void;
}

/** The zone of `zonePaths` the merge changed most: the deepest zone each area sits in, its lines summed. */
export function mainZoneOf(entry: TimelineEntry): string | undefined {
  const lines = new Map<string, number>();
  for (const area of entry.areas) {
    const home = entry.zonePaths
      .filter((zone) => area.path === zone || area.path.startsWith(`${zone}/`))
      .sort((left, right) => right.length - left.length)[0];
    if (home !== undefined)
      lines.set(home, (lines.get(home) ?? 0) + area.additions + area.deletions);
  }
  const ranked = [...lines].sort(([lp, l], [rp, r]) => r - l || (lp < rp ? -1 : 1));
  return ranked[0]?.[0] ?? entry.zonePaths[0];
}

function pinGeometry() {
  return partGeo((g) => {
    g.sph(0, 1.6, 0, 1, "#ffffff", true);
    g.add(PRIM.cone12, "#ffffff", 0, 0.45, 0, 0.55, 0.9, 0.55, Math.PI);
  });
}

function checkGeometry() {
  return partGeo((g) => {
    for (const face of [1, -1]) {
      g.rbox(-0.24, 1.48, face * 0.9, 0.56, 0.3, 0.2, "#ffffff", 0, 0, -0.8);
      g.rbox(0.17, 1.7, face * 0.9, 0.95, 0.3, 0.2, "#ffffff", 0, 0, 0.9);
    }
  });
}

/** Builds the shipped layer in `palette`'s signal. */
export function shippedLayerOf(palette: WorldPalette): ShippedLayer {
  const group = new Group();
  const lamps = new InstancedMesh(
    new IcosahedronGeometry(0.3, 1),
    new MeshBasicMaterial({ toneMapped: false }),
    MAX,
  );
  const pins = new InstancedMesh(
    pinGeometry(),
    new MeshBasicMaterial({ color: palette.signal.SHIPPED, toneMapped: false }),
    MAX_ZONES,
  );
  const checks = new InstancedMesh(
    checkGeometry(),
    new MeshBasicMaterial({ toneMapped: false }),
    MAX_ZONES,
  );
  const halos = new InstancedMesh(
    new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    glowMaterial(palette.signal.SHIPPED, 1),
    MAX_ZONES,
  );
  halos.renderOrder = 4;
  for (const mesh of [lamps, pins, checks, halos]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  const shipped = col(palette.signal.SHIPPED);
  const selection = col(palette.signal.SELECTION);
  const scratch = { matrix: new Matrix4(), vector: new Vector3(), tint: new Color() };

  let layout: Layout | undefined;
  let buildings: readonly Building[] = [];
  let lampSlots: readonly (readonly BuildingSpot[])[] = [];
  let entries: readonly TimelineEntry[] = [];
  let at = 0;
  let isChosen: (url: string) => boolean = () => false;
  // Note that a lot keeps the zone it was built from, so how alive a zone is now is read from the latest view.
  let aliveNow: (path: string) => number = () => 0;
  let visible = true;
  let hung: Lamp[] = [];
  let flown: Pin[] = [];

  const hang = () => {
    hung = [];
    flown = [];
    if (layout === undefined) return;
    const filled = new Map<Lot, number>();
    let atGate = 0;
    for (const entry of entries) {
      const fresh = Math.exp(-Math.max(0, at - entry.mergedAt) / 3.6e6 / SETTLE_HOURS);
      const zone = mainZoneOf(entry);
      const lot = zone === undefined ? undefined : layout.lotByPath.get(zone);
      if (lot === undefined) {
        // Note that work that landed in no zone hangs along the fence beside the gate it shipped through.
        hung.push({
          url: entry.url,
          x: layout.gateX + 8 + atGate * 0.9,
          y: 2.6,
          z: layout.z1 + 3.2,
          fresh,
        });
        atGate += 1;
        continue;
      }
      const n = filled.get(lot) ?? 0;
      filled.set(lot, n + 1);
      const building = buildings[lot.index];
      const slots = lampSlots[lot.index] ?? [];
      const slot = slots[n % Math.max(1, slots.length)];
      const stack = slots.length === 0 ? n : Math.floor(n / slots.length);
      hung.push({
        url: entry.url,
        x: slot?.x ?? lot.bx,
        y: (slot?.y ?? (building?.top ?? 4) + 0.6) + stack * 0.45,
        z: slot?.z ?? lot.bz,
        fresh,
      });
    }
    for (const [lot, count] of filled) {
      const building = buildings[lot.index];
      if (building === undefined) continue;
      flown.push({
        path: lot.zone.path,
        x: lot.bx - Math.min(3, building.w * 0.2),
        y: 0.24 + building.top + 1.5,
        z: lot.bz,
        count,
      });
    }
  };

  const draw = (time: number, scale: number) => {
    const shown = visible ? hung.length : 0;
    hung.slice(0, shown).forEach((lamp, index) => {
      const twinkle = time === 0 ? 1 : 1 + 0.12 * Math.sin(time * 3 + index);
      const k = (1 + 0.9 * lamp.fresh) * twinkle;
      scratch.matrix.makeScale(k, k, k).setPosition(lamp.x, lamp.y, lamp.z);
      lamps.setMatrixAt(index, scratch.matrix);
      lamps.setColorAt(index, isChosen(lamp.url) ? selection : shipped);
    });
    lamps.count = shown;
    const pinned = visible ? flown.length : 0;
    flown.slice(0, pinned).forEach((pin, index) => {
      const bob = time === 0 ? 0 : Math.sin(time * 2 + index) * 0.25;
      const k = (1 + Math.min(0.5, Math.sqrt(pin.count) * 0.12)) * scale;
      scratch.matrix
        .makeRotationY(time * 0.6 + index)
        .scale(scratch.vector.setScalar(k))
        .setPosition(pin.x, pin.y + bob * scale, pin.z);
      pins.setMatrixAt(index, scratch.matrix);
      checks.setMatrixAt(index, scratch.matrix);
    });
    pins.count = pinned;
    checks.count = pinned;
    for (const mesh of [lamps, pins, checks]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      mesh.visible = mesh.count > 0;
    }
  };

  const glow = () => {
    let count = 0;
    if (visible && layout !== undefined) {
      for (const lot of layout.lots) {
        const building = buildings[lot.index];
        const alive = aliveNow(lot.zone.path);
        if (building === undefined || alive < 0.02) continue;
        scratch.matrix
          .makeScale(building.w * 2, 1, building.d * 2)
          .setPosition(lot.bx, 0.36, lot.bz);
        halos.setMatrixAt(count, scratch.matrix);
        halos.setColorAt(count, scratch.tint.setScalar(Math.min(0.45, alive * 0.5)));
        count += 1;
      }
    }
    halos.count = count;
    halos.visible = count > 0;
    halos.instanceMatrix.needsUpdate = true;
    if (halos.instanceColor !== null) halos.instanceColor.needsUpdate = true;
  };

  let lastScale = 1.6;
  return {
    group,
    lamps,
    pins,
    lampUrlAt: (index) => (index < lamps.count ? hung[index]?.url : undefined),
    pinPathAt: (index) => (index < pins.count ? flown[index]?.path : undefined),
    show: (timeline, instant, aliveOf, chosen, shown) => {
      entries = timeline;
      at = instant;
      aliveNow = aliveOf;
      isChosen = chosen;
      visible = shown;
      hang();
      glow();
      draw(0, lastScale);
    },
    settle: (next, nextBuildings, nextSlots) => {
      layout = next;
      buildings = nextBuildings;
      lampSlots = nextSlots;
      hang();
      glow();
      draw(0, lastScale);
    },
    step: (time, scale) => {
      lastScale = scale;
      draw(time, scale);
    },
  };
}
