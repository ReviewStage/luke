import {
  Box3,
  type Camera,
  type InstancedMesh,
  Matrix4,
  type Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import type { PickTarget, WorldPicking } from "../world";

/**
 * picking.ts -- what the pointer lands on: the registered object a ray from it meets first, or, where it meets none, the nearest registered one within a finger's width on screen.
 *
 * A world registers what may be picked, an object as one target or an
 * instanced mesh as one target per instance, and the host asks here on each
 * move and press. The ray comes first, so what stands in front wins; where it
 * meets nothing registered, the target whose centre stands nearest the
 * pointer on screen, within `SLOP_PX`, is picked instead, which is what makes
 * a small agent or a thin pipe as easy to land on as a building. A hidden
 * object, or one under a hidden parent, is never picked.
 */

/** How far from the pointer, in CSS pixels, a target's centre may stand and still be picked. */
const SLOP_PX = 18;

/** One registration: an object as one target, or an instanced mesh's instances each as their own. */
type Registration =
  | { readonly object: Object3D; readonly target: PickTarget }
  | {
      readonly object: InstancedMesh;
      readonly targetOf: (instanceId: number) => PickTarget | undefined;
    };

/** Where the pointer is: in the canvas's CSS pixels and its size. */
export interface PickPointer {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Picking as the host drives it, beside what a world is handed. */
export interface ScenePicking extends WorldPicking {
  /** What the pointer lands on, seen through `camera`, or nothing. */
  readonly pick: (pointer: PickPointer, camera: Camera) => PickTarget | undefined;
  /** Where a target stands, its bounds' centre or its instance's place; nothing where it is not registered. */
  readonly anchorOf: (target: PickTarget) => Vector3 | undefined;
  readonly clear: () => void;
}

export function sameTarget(left: PickTarget | undefined, right: PickTarget | undefined): boolean {
  return left?.kind === right?.kind && left?.id === right?.id;
}

function shown(object: Object3D): boolean {
  for (let at: Object3D | null = object; at !== null; at = at.parent) {
    if (!at.visible) return false;
  }
  return true;
}

/** Each target a registration stands for, and where it stands in the scene. */
function anchorsOf(registration: Registration): { target: PickTarget; at: Vector3 }[] {
  if ("target" in registration) {
    const box = new Box3().setFromObject(registration.object);
    return box.isEmpty() ? [] : [{ target: registration.target, at: box.getCenter(new Vector3()) }];
  }
  const mesh = registration.object;
  const matrix = new Matrix4();
  const anchors: { target: PickTarget; at: Vector3 }[] = [];
  for (let instanceId = 0; instanceId < mesh.count; instanceId += 1) {
    const target = registration.targetOf(instanceId);
    if (target === undefined) continue;
    mesh.getMatrixAt(instanceId, matrix);
    const at = new Vector3().setFromMatrixPosition(matrix).applyMatrix4(mesh.matrixWorld);
    anchors.push({ target, at });
  }
  return anchors;
}

/** Picking over the registrations a world makes. */
export function scenePicking(): ScenePicking {
  const registrations = new Map<Object3D, Registration>();
  const raycaster = new Raycaster();

  const register = (registration: Registration) => {
    registrations.set(registration.object, registration);
    return () => {
      if (registrations.get(registration.object) === registration) {
        registrations.delete(registration.object);
      }
    };
  };

  /** The target a ray's hit stands for: the nearest registered object at or above what it met. */
  const targetOfHit = (object: Object3D, instanceId: number | undefined) => {
    for (let at: Object3D | null = object; at !== null; at = at.parent) {
      const registration = registrations.get(at);
      if (registration === undefined) continue;
      if ("target" in registration) return registration.target;
      return at === object && instanceId !== undefined
        ? registration.targetOf(instanceId)
        : undefined;
    }
    return undefined;
  };

  const nearestOnScreen = (pointer: PickPointer, camera: Camera) => {
    let nearest: { target: PickTarget; distance: number } | undefined;
    for (const registration of registrations.values()) {
      if (!shown(registration.object)) continue;
      for (const { target, at } of anchorsOf(registration)) {
        const projected = at.project(camera);
        if (projected.z > 1) continue;
        const x = ((projected.x + 1) / 2) * pointer.width;
        const y = ((1 - projected.y) / 2) * pointer.height;
        const distance = Math.hypot(x - pointer.x, y - pointer.y);
        if (distance <= SLOP_PX && (nearest === undefined || distance < nearest.distance)) {
          nearest = { target, distance };
        }
      }
    }
    return nearest?.target;
  };

  return {
    add: (object, target) => register({ object, target }),
    addInstances: (object, targetOf) => register({ object, targetOf }),
    pick: (pointer, camera) => {
      if (registrations.size === 0 || pointer.width === 0 || pointer.height === 0) return undefined;
      const ndc = new Vector2(
        (pointer.x / pointer.width) * 2 - 1,
        -(pointer.y / pointer.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      // Note that an instanced mesh keeps the bounds of its first raycast, so a world that moves its instances would be missed outside them.
      for (const registration of registrations.values()) {
        if (!("target" in registration)) registration.object.boundingSphere = null;
      }
      const objects = [...registrations.keys()].filter(shown);
      for (const hit of raycaster.intersectObjects(objects, true)) {
        if (!shown(hit.object)) continue;
        const target = targetOfHit(hit.object, hit.instanceId);
        if (target !== undefined) return target;
      }
      return nearestOnScreen(pointer, camera);
    },
    anchorOf: (target) => {
      for (const registration of registrations.values()) {
        const found = anchorsOf(registration).find((anchor) => sameTarget(anchor.target, target));
        if (found !== undefined) return found.at;
      }
      return undefined;
    },
    clear: () => registrations.clear(),
  };
}
