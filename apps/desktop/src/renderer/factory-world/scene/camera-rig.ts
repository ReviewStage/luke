import { MathUtils, type PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { WorldCameraRig, WorldPoint } from "../world";

/**
 * camera-rig.ts -- the camera every world is seen through: orbit, pan, and zoom from the pointer with damping, a tweened flight to a point, and home to the establishing shot.
 *
 * The pointer drives `OrbitControls` on the canvas; a flight eases the
 * camera and what it looks at together from where they stand to where they
 * are sent, and the pointer taking hold mid-flight ends it where it is. The
 * rig says when it leaves the establishing shot (the pointer taking hold, or
 * a flight away) and when it is home again, which is what Esc reads. Held
 * still, a flight lands at once and the pointer's moves stop where they let
 * go, with no damping glide after them.
 */

/** How long a flight takes, in seconds. */
const FLIGHT_SECONDS = 0.9;

/** How much of a frame's way the damping covers: the glide after the pointer lets go. */
const DAMPING = 0.08;

/** How far below the horizon the camera may tilt: just short of level, so the ground never turns edge-on. */
const LOWEST_TILT = Math.PI * 0.46;

/** How far a flight stops from its point, as a share of the home shot's distance, at least twice the nearest reach. */
const FLIGHT_DISTANCE = 0.4;

/** The establishing shot before a world names its own. */
const DEFAULT_HOME = {
  position: { x: 0, y: 9, z: 12 },
  target: { x: 0, y: 0, z: 0 },
} as const;

/** One flight under way: from where, to where, and how far along. */
interface Flight {
  readonly fromPosition: Vector3;
  readonly fromTarget: Vector3;
  readonly toPosition: Vector3;
  readonly toTarget: Vector3;
  progress: number;
}

/** The rig as the host drives it, beside what a world is handed. */
export interface CameraRig extends WorldCameraRig {
  /** Flies to look at `point` from nearer, keeping the direction it looks from. */
  readonly flyTo: (point: WorldPoint) => void;
  /** Flies back to the establishing shot. */
  readonly home: () => void;
  /** Holds motion still, or lets it run. */
  readonly setStill: (still: boolean) => void;
  /** Steps the damping and a flight by `delta` seconds; answers whether the camera moved. */
  readonly step: (delta: number) => boolean;
  /** Fits the camera to the canvas's shape. */
  readonly fit: (width: number, height: number) => void;
  readonly dispose: () => void;
}

function vector({ x, y, z }: WorldPoint): Vector3 {
  return new Vector3(x, y, z);
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The rig over `camera`, its pointer on `canvas`, saying each time it leaves home or comes back, and each time the pointer moved it. */
export function cameraRig(
  camera: PerspectiveCamera,
  canvas: HTMLElement,
  onAway: (away: boolean) => void,
  onMove: () => void,
): CameraRig {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING;
  controls.maxPolarAngle = LOWEST_TILT;
  controls.screenSpacePanning = false;
  controls.zoomToCursor = true;
  const homePosition = vector(DEFAULT_HOME.position);
  const homeTarget = vector(DEFAULT_HOME.target);
  let flight: Flight | undefined;
  let still = false;
  let away = false;

  const setAway = (next: boolean) => {
    if (next === away) return;
    away = next;
    onAway(next);
  };
  // Note that the pointer taking hold ends a flight where it stands, since the developer has the camera now.
  const tookHold = () => {
    flight = undefined;
    setAway(true);
  };
  controls.addEventListener("start", tookHold);
  controls.addEventListener("change", onMove);

  const land = (position: Vector3, target: Vector3) => {
    camera.position.copy(position);
    controls.target.copy(target);
    controls.update();
  };
  const fly = (toPosition: Vector3, toTarget: Vector3, home: boolean) => {
    setAway(!home);
    if (still) {
      flight = undefined;
      land(toPosition, toTarget);
      return;
    }
    flight = {
      fromPosition: camera.position.clone(),
      fromTarget: controls.target.clone(),
      toPosition,
      toTarget,
      progress: 0,
    };
  };

  return {
    camera,
    setHome: (position, target) => {
      homePosition.copy(vector(position));
      homeTarget.copy(vector(target));
      if (!away && flight === undefined) land(homePosition, homeTarget);
    },
    setReach: (nearest, farthest) => {
      controls.minDistance = nearest;
      controls.maxDistance = farthest;
      camera.near = Math.max(0.01, nearest / 20);
      camera.far = farthest * 4;
      camera.updateProjectionMatrix();
    },
    flyTo: (point) => {
      const toTarget = vector(point);
      const direction = camera.position.clone().sub(controls.target).normalize();
      const distance = Math.max(
        controls.minDistance * 2,
        homePosition.distanceTo(homeTarget) * FLIGHT_DISTANCE,
      );
      fly(toTarget.clone().addScaledVector(direction, distance), toTarget, false);
    },
    home: () => fly(homePosition.clone(), homeTarget.clone(), true),
    setStill: (next) => {
      still = next;
      controls.enableDamping = !next;
      if (next && flight !== undefined) {
        land(flight.toPosition, flight.toTarget);
        flight = undefined;
      }
    },
    step: (delta) => {
      if (flight === undefined) return controls.update(delta);
      flight.progress = Math.min(1, flight.progress + delta / FLIGHT_SECONDS);
      const eased = easeInOut(flight.progress);
      camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
      controls.update();
      if (flight.progress >= 1) flight = undefined;
      return true;
    },
    fit: (width, height) => {
      camera.aspect = width / Math.max(1, height);
      // Note that a narrow canvas widens the view rather than cropping the world's sides.
      camera.fov = MathUtils.clamp(40 / Math.min(1, camera.aspect), 40, 70);
      camera.updateProjectionMatrix();
    },
    dispose: () => {
      controls.removeEventListener("start", tookHold);
      controls.removeEventListener("change", onMove);
      controls.dispose();
    },
  };
}
