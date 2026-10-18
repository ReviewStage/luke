import { FACTORY_WORLD_BOUNDS, type FactoryDefect } from "@luke/features/factory-world-wire";
import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import type { WorldPalette } from "../../world";
import { glowMaterial, hdrMaterial } from "./effects";
import { clamp, col, hashOf, PAL, partGeo, rngOf } from "./geo";

/**
 * defects.ts -- the Factory's defects as damage: a wrecked machine on the apron of the zone each defect is placed on, its ground cracked and glowing in the defect signal's colour, a beacon turning over it, and a warning pin over the zone's building.
 *
 * The more events a defect reached, the larger its wreck, the longer and
 * wider its cracks, and the thicker the smoke off it (a fire past forty
 * events); a zone's pin grows with all its defects' events. A defect placed
 * on no zone is wrecked in the scrap yard by the gate. Nothing fills
 * defects yet, so this layer draws nothing until a monitor does.
 */

const MAX = FACTORY_WORLD_BOUNDS.MAX_DEFECTS;

const MAX_ZONES = FACTORY_WORLD_BOUNDS.MAX_ZONES;

/** The most crack segments drawn across every wreck. */
const MAX_CRACKS = 4000;

/** Where one defect's wreck stands, and how large. */
export interface DefectPlacement {
  readonly defect: FactoryDefect;
  readonly x: number;
  readonly z: number;
  readonly size: number;
}

/** A warning pin over a zone with defects: where, and how many events it adds up to. */
export interface DefectPin {
  readonly path: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly events: number;
}

/** A wreck's size, by how many events its defect reached. */
export function wreckSizeOf(defect: FactoryDefect): number {
  return clamp(1.6 + 0.38 * Math.sqrt(defect.events), 1.9, 5.2);
}

/** Smoke a wreck gives off: where, how thick, and whether it burns. */
interface Smoulder {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly rate: number;
  readonly size: number;
  readonly fire: boolean;
}

/** The defect signal, drawn. */
export interface DefectsLayer {
  readonly group: Group;
  readonly wrecks: InstancedMesh;
  readonly pins: InstancedMesh;
  readonly defectAt: (index: number) => string | undefined;
  readonly pinPathAt: (index: number) => string | undefined;
  readonly show: (
    placements: readonly DefectPlacement[],
    pins: readonly DefectPin[],
    chosen: (id: string) => boolean,
  ) => void;
  /** Pulses the beacons and cracks and bobs the pins `time` seconds in; at zero, all stand at rest. */
  readonly step: (time: number, scale: number) => void;
  /** Where smoke rises off the wrecks drawn. */
  readonly smoulders: () => readonly Smoulder[];
}

/** One crack's segments, wandering out from `x`, `z` and forking now and then. */
function crack(
  into: { x: number; z: number; angle: number; width: number }[],
  x: number,
  z: number,
  length: number,
  width: number,
  rng: () => number,
): void {
  let angle = rng() * Math.PI * 2;
  let px = x;
  let pz = z;
  const steps = Math.ceil(length / 0.9);
  for (let index = 0; index < steps && into.length < MAX_CRACKS; index += 1) {
    angle += (rng() - 0.5) * 1.1;
    const qx = px + Math.cos(angle) * 0.9;
    const qz = pz + Math.sin(angle) * 0.9;
    const w = width * (1 - index / steps) + 0.05;
    into.push({
      x: (px + qx) / 2,
      z: (pz + qz) / 2,
      angle: Math.atan2(qz - pz, qx - px),
      width: w,
    });
    if (rng() < 0.18 && index > 1)
      crack(into, qx, qz, length * 0.4 * (1 - index / steps), w * 0.7, rng);
    px = qx;
    pz = qz;
  }
}

function wreckGeometry() {
  return partGeo((g) => {
    const s = 1;
    const tilt = 0.28;
    g.cyl(0, 0, 0, s * 0.62, 0.04, "#3a3330", 16);
    g.rbox(0, s * 0.3, 0, s * 0.7, s * 0.55, s * 0.55, "#5f5650", tilt * 0.4, 0.3, tilt);
    g.rbox(-s * 0.05, s * 0.62, 0, s * 0.42, s * 0.18, s * 0.38, "#4a423d", tilt, 0.3, tilt * 0.8);
    g.rbox(s * 0.35, s * 0.08, s * 0.3, s * 0.4, 0.06, s * 0.3, "#7a6e66", 0, 0.7, 0.05);
    g.pipe(-s * 0.3, s * 0.5, 0, -s * 0.55, s * 0.9, s * 0.1, 0.12 * s, "#6c625b");
    for (let index = 0; index < 6; index += 1) {
      const a = (index / 6) * Math.PI * 2 + 0.3;
      g.box(
        Math.cos(a) * s * 0.66,
        0,
        Math.sin(a) * s * 0.66,
        0.05,
        0.3,
        0.05,
        index % 2 ? PAL.hazard : PAL.dark,
      );
    }
    for (let index = 0; index < 6; index += 1) {
      const a0 = (index / 6) * Math.PI * 2 + 0.3;
      const a1 = ((index + 1) / 6) * Math.PI * 2 + 0.3;
      g.beam(
        Math.cos(a0) * s * 0.66,
        0.24,
        Math.sin(a0) * s * 0.66,
        Math.cos(a1) * s * 0.66,
        0.24,
        Math.sin(a1) * s * 0.66,
        0.03,
        index % 2 ? PAL.hazard : "#222222",
      );
    }
  });
}

function warningGeometry() {
  return partGeo((g) => {
    for (const face of [1, -1]) {
      g.box(0, 1.75, face * 0.92, 0.2, 0.62, 0.12, "#ffffff");
      g.box(0, 1.2, face * 0.92, 0.2, 0.2, 0.12, "#ffffff");
    }
  });
}

/** Builds the defects layer in `palette`'s signal. */
export function defectsLayerOf(palette: WorldPalette, solid: Material): DefectsLayer {
  const group = new Group();
  const defect = palette.signal.DEFECT;
  const wrecks = new InstancedMesh(wreckGeometry(), solid, MAX);
  wrecks.castShadow = true;
  const cracks = new InstancedMesh(
    new BoxGeometry(1, 0.03, 1),
    new MeshBasicMaterial({ color: "#2a2422" }),
    MAX_CRACKS,
  );
  const glowMaterialOfCracks = hdrMaterial(defect, 1.6);
  const seams = new InstancedMesh(new BoxGeometry(0.98, 0.03, 1), glowMaterialOfCracks, MAX_CRACKS);
  const bulbs = new InstancedMesh(new SphereGeometry(0.24, 10, 8), hdrMaterial(defect, 4), MAX);
  const halos = new InstancedMesh(new PlaneGeometry(1, 1), glowMaterial(defect, 0.9, true), MAX);
  halos.renderOrder = 8;
  const pins = new InstancedMesh(
    partGeo((g) => {
      g.sph(0, 1.6, 0, 1, "#ffffff", true);
      g.cone(0, 0, 0, 0.55, 0.9, "#ffffff", 12);
    }),
    new MeshBasicMaterial({ color: defect, toneMapped: false }),
    MAX_ZONES,
  );
  const marks = new InstancedMesh(
    warningGeometry(),
    new MeshBasicMaterial({ toneMapped: false }),
    MAX_ZONES,
  );
  for (const mesh of [wrecks, cracks, seams, bulbs, halos, pins, marks]) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.visible = false;
    group.add(mesh);
  }
  const selection = col(palette.signal.SELECTION);
  const scratch = { matrix: new Matrix4(), tint: new Color(), scale: new Vector3() };
  const glowColor = col(defect).clone();
  let placed: readonly DefectPlacement[] = [];
  let flown: readonly DefectPin[] = [];
  let lastScale = 1.6;

  const draw = (time: number, scale: number) => {
    placed.forEach((placement, index) => {
      const s = placement.size;
      const pulse = time === 0 ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 6 + index));
      const bs = clamp(s / 3, 0.6, 1.4);
      scratch.matrix
        .makeScale(bs, bs, bs)
        .setPosition(placement.x, 0.24 + s * 0.82 + 0.32 * bs, placement.z);
      bulbs.setMatrixAt(index, scratch.matrix);
      scratch.matrix
        .makeScale(3.2 * bs, 3.2 * bs, 3.2 * bs)
        .setPosition(placement.x, 0.24 + s * 0.82 + 0.32 * bs, placement.z);
      halos.setMatrixAt(index, scratch.matrix);
      halos.setColorAt(index, scratch.tint.setScalar(pulse));
    });
    flown.forEach((pin, index) => {
      const bob = time === 0 ? 0 : Math.sin(time * 2.4 + index) * 0.25;
      const k = (1.15 + Math.min(0.6, Math.sqrt(pin.events) * 0.05)) * scale;
      scratch.matrix
        .makeRotationY(time * 0.6 + index)
        .scale(scratch.scale.setScalar(k))
        .setPosition(pin.x, pin.y + bob * scale, pin.z);
      pins.setMatrixAt(index, scratch.matrix);
      marks.setMatrixAt(index, scratch.matrix);
    });
    glowMaterialOfCracks.color
      .copy(glowColor)
      .multiplyScalar(time === 0 ? 1.6 : 1.6 + Math.sin(time * 2.2) * 0.8);
    for (const mesh of [bulbs, halos, pins, marks]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  };

  return {
    group,
    wrecks,
    pins,
    defectAt: (index) => (index < wrecks.count ? placed[index]?.defect.id : undefined),
    pinPathAt: (index) => (index < pins.count ? flown[index]?.path : undefined),
    show: (placements, nextPins, chosen) => {
      placed = placements.slice(0, MAX);
      flown = nextPins.slice(0, MAX_ZONES);
      const segments: { x: number; z: number; angle: number; width: number }[] = [];
      placed.forEach((placement, index) => {
        const s = placement.size;
        const rng = rngOf(placement.defect.id);
        scratch.matrix
          .makeRotationY(hashOf(placement.defect.id) % 6)
          .scale(scratch.scale.setScalar(s));
        scratch.matrix.setPosition(placement.x, 0.24, placement.z);
        wrecks.setMatrixAt(index, scratch.matrix);
        wrecks.setColorAt(index, chosen(placement.defect.id) ? selection : col("#ffffff"));
        const events = placement.defect.events;
        const count = Math.min(8, 2 + Math.round(events / 10));
        for (let k = 0; k < count; k += 1) {
          crack(
            segments,
            placement.x + (rng() - 0.5) * s * 0.4,
            placement.z + (rng() - 0.5) * s * 0.4,
            Math.min(12, 1.5 + Math.sqrt(events) * 0.9),
            0.1 + Math.sqrt(events) * 0.015,
            rng,
          );
        }
      });
      segments.forEach((segment, index) => {
        scratch.matrix
          .makeRotationY(-segment.angle)
          .scale(scratch.scale.set(1, 1, segment.width * 2.6));
        scratch.matrix.setPosition(segment.x, 0.27, segment.z);
        cracks.setMatrixAt(index, scratch.matrix);
        scratch.matrix.makeRotationY(-segment.angle).scale(scratch.scale.set(1, 1, segment.width));
        scratch.matrix.setPosition(segment.x, 0.295, segment.z);
        seams.setMatrixAt(index, scratch.matrix);
      });
      wrecks.count = placed.length;
      bulbs.count = placed.length;
      halos.count = placed.length;
      cracks.count = segments.length;
      seams.count = segments.length;
      pins.count = flown.length;
      marks.count = flown.length;
      for (const mesh of [wrecks, cracks, seams, bulbs, halos, pins, marks]) {
        mesh.visible = mesh.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
      draw(0, lastScale);
    },
    step: (time, scale) => {
      lastScale = scale;
      draw(time, scale);
    },
    smoulders: () =>
      placed.map((placement) => ({
        x: placement.x,
        y: placement.size * 0.9,
        z: placement.z,
        rate: 0.8 + placement.defect.events * 0.32,
        size: 0.5 + placement.size * 0.22,
        fire: placement.defect.events > 40,
      })),
  };
}
