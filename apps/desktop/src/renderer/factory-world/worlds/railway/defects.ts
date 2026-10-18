import type { FactoryDefect } from "@luke/features/factory-world-wire";
import type { SIGNAL_COLOR } from "@luke/ui/factory-world";
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { Builder, hashOf, placing, put, seeded, TAU, UNIT } from "./kit";
import type { District, Layout } from "./layout";
import type { Lot } from "./lots";
import type { Particles } from "./particles";

/**
 * defects.ts -- the errors a monitor reports, drawn as damage: a frequent one derails a train on its district's loop, wagons strewn and burning, fire engines hosing it down; a rarer one leaves a burnt-out shell smoking in the street. Each is ringed in defect's red.
 *
 * How bad it looks follows how often it fired: the square root of its
 * events sizes the wreck, the fire, and how many engines come. A still frame
 * keeps its flames and its ring, so it reads as damage without the smoke.
 * Nothing fills `defects` yet (Sentry comes later), so this layer stays empty
 * until data arrives; every part of it is instanced at the contract's bound.
 */

/** The most defects a snapshot holds (`FACTORY_WORLD_BOUNDS.MAX_DEFECTS`), and their parts. */
const CAPACITY = { DEFECTS: 50, WAGONS: 400, ENGINES: 150, FLAMES: 300 } as const;

/** How often a defect fires before it derails a train rather than burning a house. */
const DERAILS_AT = 10;

/** A wrecked wagon's body over its chassis, its body taking the instance's rust. */
function wagonGeometry() {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  put(pen, UNIT.cbox, new Color("#ffffff"), 0, 0, 0, 0, 1.22, 0.5, 0.6);
  put(pen, UNIT.cbox, new Color("#2a2724"), 0, -0.3, 0, 0, 1.16, 0.12, 0.45);
  return builder.build();
}

/** A burnt-out house: blackened walls and a fallen roof. */
function shellGeometry() {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  put(pen, UNIT.box, new Color("#3a3330"), 0, 0, 0, 0, 1.3, 1, 1.1);
  put(pen, UNIT.gable, new Color("#241f1c"), 0.15, 1, 0, 0.2, 1.0, 0.4, 0.9, 0, 0.35);
  return builder.build();
}

/** A fire engine: red body and cab, glass, a ladder, and its wheels. */
function engineGeometry() {
  const builder = new Builder();
  const pen = { builder, frame: new Matrix4(), extra: [] };
  const red = new Color("#a8231b");
  put(pen, UNIT.cbox, red, -0.15, 0.48, 0, 0, 1.9, 0.62, 0.78);
  put(pen, UNIT.cbox, red, 0.95, 0.45, 0, 0, 0.6, 0.55, 0.76);
  put(pen, UNIT.cbox, new Color("#203040"), 1.25, 0.58, 0, 0, 0.05, 0.22, 0.66);
  put(pen, UNIT.cbox, new Color("#d8d8d8"), -0.2, 0.86, 0, 0, 1.8, 0.08, 0.28, 0, 0.12);
  for (const x of [-0.7, 0.85])
    for (const z of [-0.38, 0.38])
      put(pen, UNIT.disc, new Color("#151515"), x, 0.17, z, 0, 0.34, 0.34, 0.1);
  return builder.build();
}

/** The defects layer's meshes, made once at their bounds, and the one light its worst fire casts. */
export function defectMeshes(signal: typeof SIGNAL_COLOR) {
  const meshes = {
    scorches: new InstancedMesh(
      new CylinderGeometry(0.5, 0.5, 0.03, 24),
      new MeshStandardMaterial({ color: "#1d1a17", roughness: 1 }),
      CAPACITY.DEFECTS,
    ),
    wagons: new InstancedMesh(
      wagonGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      CAPACITY.WAGONS,
    ),
    shells: new InstancedMesh(
      shellGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
      CAPACITY.DEFECTS,
    ),
    engines: new InstancedMesh(
      engineGeometry(),
      new MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 }),
      CAPACITY.ENGINES,
    ),
    sirens: new InstancedMesh(
      new SphereGeometry(0.08, 8, 6),
      new MeshBasicMaterial({ toneMapped: false }),
      CAPACITY.ENGINES * 2,
    ),
    flames: new InstancedMesh(
      new ConeGeometry(0.35, 1, 7).translate(0, 0.5, 0),
      new MeshBasicMaterial({ color: "#ff8a2a", transparent: true, opacity: 0.85 }),
      CAPACITY.FLAMES,
    ),
    rings: new InstancedMesh(
      new RingGeometry(0.86, 1, 56).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({
        color: signal.DEFECT,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        toneMapped: false,
      }),
      CAPACITY.DEFECTS,
    ),
  };
  for (const mesh of Object.values(meshes)) {
    mesh.count = 0;
    mesh.frustumCulled = false;
  }
  for (const mesh of [meshes.wagons, meshes.shells, meshes.engines]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  const light = new PointLight("#ff7a2a", 0, 28, 1.6);
  light.visible = false;
  return { ...meshes, light };
}

export type DefectMeshes = ReturnType<typeof defectMeshes>;

/** One defect as drawn: where its damage is, how bad, and where its engines stand and aim. */
export interface Wreck {
  readonly defect: FactoryDefect;
  readonly x: number;
  readonly z: number;
  /** The square root of its events: how bad it looks. */
  readonly severity: number;
  readonly derailed: boolean;
  /** The loop's heading where a train derailed, along which its wagons are strewn. */
  readonly tangent: number;
  readonly engines: readonly {
    readonly x: number;
    readonly z: number;
    readonly ry: number;
    readonly nozzle: Vector3;
    readonly aim: Vector3;
  }[];
  readonly flames: readonly Vector3[];
}

/** A derailment on the district's loop, turned toward the front so it reads from the establishing shot. */
function derail(defect: FactoryDefect, district: District, nth: number, severity: number): Wreck {
  const angle = Math.PI / 2 + (nth === 0 ? 0.25 : -0.9 + (nth - 1) * 0.5);
  const x = district.x + Math.cos(angle) * district.ringRadius;
  const z = district.z + Math.sin(angle) * district.ringRadius;
  const count = 1 + Math.floor(severity / 3);
  const engines = Array.from({ length: count }, (_, index) => {
    const around = angle + (index - (count - 1) / 2) * 0.55;
    const r = district.radius + 2.2 + (index % 2) * 1.2;
    const ex = district.x + Math.cos(around) * r;
    const ez = district.z + Math.sin(around) * r;
    const ry = Math.atan2(-(z - ez), x - ex);
    return {
      x: ex,
      z: ez,
      ry,
      nozzle: new Vector3(-0.2, 1, 0).applyMatrix4(placing(ex, 0, ez, ry)),
      aim: new Vector3(x, 0.8, z),
    };
  });
  const rnd = seeded(hashOf(defect.id));
  const flames = Array.from(
    { length: Math.min(6, 1 + Math.round(severity * 0.6)) },
    () => new Vector3(x + (rnd() - 0.5) * 2, 0.4, z + (rnd() - 0.5) * 2),
  );
  return { defect, x, z, severity, derailed: true, tangent: angle + Math.PI / 2, engines, flames };
}

/** Where each defect's damage is: derailments on the loop for the frequent ones, shells on claimed lots for the rest. */
export function placeWrecks(
  defects: readonly FactoryDefect[],
  layout: Layout,
  claim: (district: District, seed: string, radius: number) => Lot,
): Wreck[] {
  const derailed = new Map<District, number>();
  const ranked = [...defects]
    .slice(0, CAPACITY.DEFECTS)
    .sort((a, b) => b.events - a.events || (a.id < b.id ? -1 : 1));
  const wrecks: Wreck[] = [];
  let unplaced = 0;
  for (const defect of ranked) {
    const severity = Math.sqrt(defect.events);
    const path = defect.zonePaths.find((zone) => layout.byPath.has(zone));
    const district = path === undefined ? undefined : layout.byPath.get(path);
    if (district === undefined) {
      // Note that a defect placed on no zone smoulders along the back of the board, still in view.
      const { x0, x1, z0 } = layout.bounds;
      const x = x0 + 34 + ((unplaced * 6) % Math.max(10, x1 - x0 - 60));
      unplaced += 1;
      wrecks.push({
        defect,
        x,
        z: z0 + 6,
        severity,
        derailed: false,
        tangent: 0,
        engines: [],
        flames: [new Vector3(x, 1.2, z0 + 6)],
      });
      continue;
    }
    if (defect.events >= DERAILS_AT) {
      const nth = derailed.get(district) ?? 0;
      derailed.set(district, nth + 1);
      wrecks.push(derail(defect, district, nth, severity));
      continue;
    }
    const lot = claim(district, defect.id, 0.9);
    wrecks.push({
      defect,
      x: lot.x,
      z: lot.z,
      severity,
      derailed: false,
      tangent: 0,
      engines: [],
      flames: [new Vector3(lot.x, 1 + severity * 0.35, lot.z)],
    });
  }
  return wrecks;
}

const RUST = ["#5c4a3e", "#6e3b2c", "#3d3a37", "#7a6a52", "#4a5a62"] as const;

/** Lays out every wreck's static damage: scorches, strewn wagons, shells, engines, and rings. */
export function raiseWrecks(wrecks: readonly Wreck[], meshes: DefectMeshes): void {
  const matrix = new Matrix4();
  const counts = { wagons: 0, shells: 0, engines: 0, flames: 0 };
  wrecks.forEach((wreck, index) => {
    const rnd = seeded(hashOf(wreck.defect.id));
    const spread = 0.8 + wreck.severity * 0.22;
    const scorch = wreck.derailed ? spread * 3.4 : 2.6 + wreck.severity * 0.4;
    meshes.scorches.setMatrixAt(
      index,
      placing(wreck.x, 0.02, wreck.z, 0, scorch, 1, scorch, 0, 0, matrix),
    );
    if (wreck.derailed) {
      const along = wreck.tangent;
      const strewn = Math.round(1 + wreck.severity * 1.1);
      for (let car = 0; car < strewn && counts.wagons < CAPACITY.WAGONS; car += 1) {
        const offset = (car - strewn / 2) * 0.9 + (rnd() - 0.5) * 0.6;
        const out = (rnd() - 0.3) * spread * 1.4;
        const stack = car > 2 && rnd() < 0.3 ? 0.55 : 0;
        placing(
          wreck.x + Math.cos(along) * offset + Math.sin(along) * out,
          0.3 + stack,
          wreck.z + Math.sin(along) * offset - Math.cos(along) * out,
          -along + (rnd() - 0.5) * 1.6,
          1,
          1,
          1,
          (rnd() - 0.5) * 0.5,
          1.2 + rnd() * 0.6,
          matrix,
        );
        meshes.wagons.setMatrixAt(counts.wagons, matrix);
        meshes.wagons.setColorAt(counts.wagons, new Color(RUST[car % RUST.length] ?? RUST[0]));
        counts.wagons += 1;
      }
    } else if (wreck.engines.length === 0 && counts.shells < CAPACITY.DEFECTS) {
      meshes.shells.setMatrixAt(
        counts.shells,
        placing(wreck.x, 0, wreck.z, rnd() * TAU, 1, 1 + wreck.severity * 0.35, 1, 0, 0, matrix),
      );
      counts.shells += 1;
    }
    for (const engine of wreck.engines) {
      if (counts.engines >= CAPACITY.ENGINES) break;
      meshes.engines.setMatrixAt(
        counts.engines,
        placing(engine.x, 0, engine.z, engine.ry, 1, 1, 1, 0, 0, matrix),
      );
      counts.engines += 1;
    }
    for (const flame of wreck.flames) {
      if (counts.flames >= CAPACITY.FLAMES) break;
      const size = 0.6 + wreck.severity * 0.08;
      meshes.flames.setMatrixAt(
        counts.flames,
        placing(flame.x, flame.y - 0.4, flame.z, 0, size, size * 1.6, size, 0, 0, matrix),
      );
      counts.flames += 1;
    }
    const ring = 1.4 + wreck.severity * 0.5;
    meshes.rings.setMatrixAt(
      index,
      placing(wreck.x, 0.14, wreck.z, 0, ring, 1, ring, 0, 0, matrix),
    );
  });
  meshes.scorches.count = wrecks.length;
  meshes.rings.count = wrecks.length;
  meshes.wagons.count = counts.wagons;
  meshes.shells.count = counts.shells;
  meshes.engines.count = counts.engines;
  meshes.sirens.count = counts.engines * 2;
  meshes.flames.count = counts.flames;
  for (const mesh of Object.values(meshes)) {
    if (!(mesh instanceof InstancedMesh)) continue;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }
  const worst = wrecks.find((wreck) => wreck.derailed && wreck.defect.events > 50);
  meshes.light.visible = worst !== undefined;
  if (worst !== undefined) meshes.light.position.set(worst.x, 2.2, worst.z);
}

const MOVING = new Matrix4();

/** Flickers the flames and the fire's light, blinks the engines' lights, pulses the rings, and sends up smoke, fire and the hoses' water. */
export function animateWrecks(
  wrecks: readonly Wreck[],
  meshes: DefectMeshes,
  time: number,
  delta: number,
  night: number,
  smoke: Particles,
  sparks: Particles,
): void {
  let flame = 0;
  let siren = 0;
  const blue = new Color(0.3, 0.6, 4);
  const red = new Color(4, 0.3, 0.2);
  const dark = new Color(0.1, 0.1, 0.1);
  wrecks.forEach((wreck, index) => {
    const pulse = (time * 0.55 + index * 0.37) % 1;
    const ring = (1.4 + wreck.severity * 0.5) * (0.6 + pulse * 0.9);
    meshes.rings.setMatrixAt(
      index,
      placing(wreck.x, 0.14, wreck.z, 0, ring, 1, ring, 0, 0, MOVING),
    );
    for (const at of wreck.flames) {
      const size =
        (0.6 + wreck.severity * 0.08) * (0.85 + 0.25 * Math.sin(time * 13 + flame * 1.7));
      meshes.flames.setMatrixAt(
        flame,
        placing(at.x, at.y - 0.4, at.z, time * 2 + flame, size, size * 1.6, size, 0, 0, MOVING),
      );
      flame += 1;
      if (Math.random() < delta * (6 + wreck.severity * 3)) {
        const hot = Math.random();
        const k = 4.5 + night * 2;
        sparks.emit(
          at.x + (Math.random() - 0.5) * 0.5,
          at.y,
          at.z + (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.4,
          1.4 + Math.random() * 1.4,
          (Math.random() - 0.5) * 0.4,
          0.6 + Math.random() * 0.35,
          1.05,
          0.2,
          k,
          (0.35 + hot * 0.35) * k,
          (0.06 + hot * 0.1) * k,
          1,
          0.8,
          -0.5,
        );
      }
      if (Math.random() < delta * (1.6 + wreck.severity * 1.1)) {
        const s = 0.5 + wreck.severity * 0.15;
        smoke.emit(
          at.x + (Math.random() - 0.5) * s,
          at.y + 0.6,
          at.z + (Math.random() - 0.5) * s,
          0.35 + (Math.random() - 0.5) * 0.3,
          1.4 + Math.random() * 0.6,
          0.12,
          7,
          0.8 * s,
          6.5 * s,
          0.13,
          0.12,
          0.12,
          0.8,
          0.2,
          -0.04,
        );
      }
    }
    for (const engine of wreck.engines) {
      for (const side of [-1, 1]) {
        const on = Math.sin(time * 9 + (side > 0 ? 0 : Math.PI)) > 0;
        const at = new Vector3(0.95, 0.78, side * 0.22).applyMatrix4(
          placing(engine.x, 0, engine.z, engine.ry),
        );
        meshes.sirens.setMatrixAt(siren, placing(at.x, at.y, at.z, 0, 1, 1, 1, 0, 0, MOVING));
        meshes.sirens.setColorAt(siren, on ? (side > 0 ? red : blue) : dark);
        siren += 1;
      }
      if (Math.random() < delta * 30) {
        const reach = engine.aim.clone().sub(engine.nozzle);
        sparks.emit(
          engine.nozzle.x,
          engine.nozzle.y,
          engine.nozzle.z,
          reach.x / 0.9 + (Math.random() - 0.5) * 0.4,
          reach.y / 0.9 + 0.5 * 6 * 0.9,
          reach.z / 0.9 + (Math.random() - 0.5) * 0.4,
          0.9,
          0.12,
          0.2,
          0.5,
          0.8,
          1.4,
          0.8,
          0,
          6,
        );
      }
    }
  });
  meshes.light.intensity =
    (60 + 40 * Math.sin(time * 13) + 25 * Math.sin(time * 31)) * (0.4 + night);
  for (const mesh of [meshes.rings, meshes.flames, meshes.sirens]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }
}

/** Sets every engine's lights to steady red, for a still frame. */
export function restWrecks(wrecks: readonly Wreck[], meshes: DefectMeshes): void {
  let siren = 0;
  for (const wreck of wrecks) {
    for (const engine of wreck.engines) {
      for (const side of [-1, 1]) {
        const at = new Vector3(0.95, 0.78, side * 0.22).applyMatrix4(
          placing(engine.x, 0, engine.z, engine.ry),
        );
        meshes.sirens.setMatrixAt(siren, placing(at.x, at.y, at.z, 0, 1, 1, 1, 0, 0, MOVING));
        meshes.sirens.setColorAt(siren, side > 0 ? new Color(4, 0.3, 0.2) : new Color(0.3, 0.6, 4));
        siren += 1;
      }
    }
  }
  meshes.sirens.instanceMatrix.needsUpdate = true;
  if (meshes.sirens.instanceColor !== null) meshes.sirens.instanceColor.needsUpdate = true;
  meshes.light.intensity = meshes.light.visible ? 70 : 0;
}
