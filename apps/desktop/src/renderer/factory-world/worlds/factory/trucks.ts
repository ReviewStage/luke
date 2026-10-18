import {
  BoxGeometry,
  type Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
} from "three";
import type { PickTarget, WorldPalette } from "../../world";
import { col, PAL, partGeo } from "./geo";
import { Path, type Spot } from "./layout";

/**
 * trucks.ts -- the Factory's traffic: box trucks carrying shipped work out of the gate and down the highway, and red ones bringing defects back in to their wrecks.
 *
 * A truck is idle motion over the shipped and defect signals the world
 * already draws: while motion runs, the world sends one out every second or
 * two with the newest merges, and one back now and then to a wreck. Each
 * truck stands for the pull request or defect it carries, so it can be
 * picked like the lamp or wreck it echoes; a still frame has none.
 */

/** The most trucks on the road at once. */
const FLEET = 40;

/** Which way a truck runs: out with shipped work, or back with a defect. */
export const HAUL = {
  OUT: "out",
  BACK: "back",
} as const;

type Haul = (typeof HAUL)[keyof typeof HAUL];

/** One truck on the road. */
interface Truck {
  readonly haul: Haul;
  readonly path: Path;
  readonly target: PickTarget;
  along: number;
  speed: number;
  yaw: number;
  x: number;
  z: number;
}

/** The fleet, drawn. */
export interface Trucks {
  readonly group: Group;
  /** What picking casts against: each truck's box. */
  readonly boxes: InstancedMesh;
  readonly targetAt: (index: number) => PickTarget | undefined;
  /** Sends a truck along `route`, `along` of the way already, carrying `target`; nothing where the fleet is full. */
  readonly send: (
    haul: Haul,
    route: readonly Spot[],
    target: PickTarget,
    along?: number,
  ) => Truck | undefined;
  /** Drives every truck `delta` seconds; a truck at its route's end leaves the road and is answered. */
  readonly drive: (
    delta: number,
    shown: (haul: Haul) => boolean,
  ) => readonly { haul: Haul; x: number; z: number }[];
  /** Takes every truck off the road. */
  readonly clear: () => void;
  /** Takes off the road every truck whose load `keep` no longer holds. */
  readonly retain: (keep: (target: PickTarget) => boolean) => void;
}

/** Builds the fleet in `palette`'s signals. */
export function trucksOf(palette: WorldPalette, solid: Material): Trucks {
  const group = new Group();
  const cab = partGeo((g) => {
    g.box(0, 0.35, 0, 1.6, 0.35, 7.2, PAL.iron);
    g.box(0, 0.55, 2.65, 2.15, 2.0, 1.8, "#f3f0e8");
    g.box(0, 2.55, 2.4, 2.0, 0.5, 1.2, "#e6e2d8");
    g.box(0, 1.65, 3.56, 1.8, 0.7, 0.05, "#34404f");
    g.box(0, 0.4, 3.6, 2.2, 0.35, 0.15, PAL.iron);
    for (const [x, z] of [
      [-1.0, 2.8],
      [1.0, 2.8],
      [-1.0, -1.6],
      [1.0, -1.6],
      [-1.0, -2.6],
      [1.0, -2.6],
    ] as const) {
      g.rcyl(x, 0.45, z, 0.45, 0.32, "#1f2329", 0, 0, Math.PI / 2, 8);
    }
  });
  const box = partGeo((g) => {
    g.box(0, 0.75, -0.85, 2.3, 2.55, 5.0, "#ffffff");
    for (let rib = -2; rib <= 2; rib += 1)
      g.box(1.16, 0.85, -0.85 + rib, 0.04, 2.35, 0.12, "#d6d6d6");
    g.box(0, 3.3, -0.85, 2.32, 0.08, 5.02, "#e2e2e2");
  });
  const instanced = (
    geometry: ReturnType<typeof partGeo> | BoxGeometry,
    material: Material,
    cast: boolean,
  ) => {
    const mesh = new InstancedMesh(geometry, material, FLEET);
    mesh.count = 0;
    mesh.castShadow = cast;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    group.add(mesh);
    return mesh;
  };
  const cabs = instanced(cab, solid, false);
  const boxes = instanced(box, solid, true);
  const lights = instanced(
    new BoxGeometry(2.0, 0.22, 4.4).translate(0, 3.42, -0.85),
    new MeshBasicMaterial({ toneMapped: false }),
    false,
  );
  const placing = new Object3D();
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const tints = {
    [HAUL.OUT]: { box: col("#f4f1ea"), light: col(palette.signal.SHIPPED) },
    [HAUL.BACK]: { box: col("#d24a3c"), light: col(palette.signal.DEFECT) },
  } as const satisfies Record<Haul, { box: Color; light: Color }>;
  const slots = Array.from({ length: FLEET }, (): Truck | undefined => undefined);
  const out = { x: 0, z: 0, yaw: 0 };
  let showing: (haul: Haul) => boolean = () => false;

  const recount = () => {
    let last = 0;
    slots.forEach((truck, index) => {
      if (truck !== undefined) last = index + 1;
    });
    for (const mesh of [cabs, boxes, lights]) {
      mesh.count = last;
      mesh.visible = last > 0;
    }
  };

  return {
    group,
    boxes,
    targetAt: (index) => {
      const truck = slots[index];
      return truck !== undefined && showing(truck.haul) ? truck.target : undefined;
    },
    send: (haul, route, target, along = 0) => {
      const slot = slots.indexOf(undefined);
      if (slot < 0) return undefined;
      const path = new Path(route);
      path.at(along * path.length, out);
      const truck: Truck = {
        haul,
        path,
        target,
        along: along * path.length,
        speed: along > 0 ? 13 : 0,
        yaw: out.yaw,
        x: out.x,
        z: out.z,
      };
      slots[slot] = truck;
      boxes.setColorAt(slot, tints[haul].box);
      lights.setColorAt(slot, tints[haul].light);
      for (const mesh of [boxes, lights]) {
        if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
      }
      recount();
      return truck;
    },
    drive: (delta, shown) => {
      const arrived: { haul: Haul; x: number; z: number }[] = [];
      showing = shown;
      slots.forEach((truck, index) => {
        if (truck === undefined) {
          for (const mesh of [cabs, boxes, lights]) mesh.setMatrixAt(index, hidden);
          return;
        }
        truck.speed = Math.min(truck.haul === HAUL.BACK ? 10 : 13, truck.speed + delta * 6);
        truck.along += truck.speed * delta;
        if (truck.along >= truck.path.length) {
          arrived.push({ haul: truck.haul, x: truck.x, z: truck.z });
          slots[index] = undefined;
          for (const mesh of [cabs, boxes, lights]) mesh.setMatrixAt(index, hidden);
          return;
        }
        truck.path.at(truck.along, out);
        let turn = out.yaw - truck.yaw;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        truck.yaw = truck.along < 0.5 ? out.yaw : truck.yaw + turn * Math.min(1, delta * 5);
        truck.x = out.x;
        truck.z = out.z;
        placing.position.set(out.x, 0.1, out.z);
        placing.rotation.set(0, truck.yaw, 0);
        placing.scale.setScalar(1.3 * Math.min(1, truck.along / 2 + 0.2));
        placing.updateMatrix();
        const matrix = shown(truck.haul) ? placing.matrix : hidden;
        for (const mesh of [cabs, boxes, lights]) mesh.setMatrixAt(index, matrix);
      });
      for (const mesh of [cabs, boxes, lights]) mesh.instanceMatrix.needsUpdate = true;
      recount();
      return arrived;
    },
    clear: () => {
      slots.fill(undefined);
      recount();
    },
    retain: (keep) => {
      slots.forEach((truck, index) => {
        if (truck === undefined || keep(truck.target)) return;
        slots[index] = undefined;
        for (const mesh of [cabs, boxes, lights]) mesh.setMatrixAt(index, hidden);
      });
      for (const mesh of [cabs, boxes, lights]) mesh.instanceMatrix.needsUpdate = true;
      recount();
    },
  };
}
