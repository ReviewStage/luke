import type {
  BlastZone,
  FactoryWorldView,
  SCENE_GROUND,
  SIGNAL_COLOR,
} from "@luke/ui/factory-world";
import type { InstancedMesh, Object3D, PerspectiveCamera, Scene } from "three";

/**
 * world.ts -- what a Factory world is: the module a world exports, the host the scene hands it, and the state it draws on every update.
 *
 * A world is one way of drawing the same reading of a repository
 * (`@luke/ui/factory-world`): a citadel, a planet, a railway. The scene host
 * (`scene/`) owns everything a world shares: the one WebGL renderer and its
 * loop, the camera and its home, picking, the shared chrome in the page's
 * DOM, the data read, the scrubber, and disposal. A world owns its geometry
 * alone. It is handed a `WorldHost` once, builds its scene in `create`, and
 * from then on redraws only what `update` hands it, so a world never reads
 * the act channel, the clock, or the DOM.
 *
 * Nothing here imports a value, so the panel names these types without
 * carrying any of Three.js. A world's own folder is `worlds/<key>/`, its
 * entry `worlds/<key>/index.ts` exporting `world: WorldModule`; the registry
 * (`registry.ts`) is the one line that offers it. `worlds/README.md` is the
 * author's checklist.
 */

/** What a press or a hover lands on: one item of the view, by its kind and its id there. */
export const PICK_KIND = {
  /** An agent at work, by its id. */
  AGENT: "agent",
  /** A zone, by its path. */
  ZONE: "zone",
  /** A merged pull request, by its URL. */
  SHIPPED: "shipped",
  /** A Linear issue planned, by its key. */
  PLANNED: "planned",
  /** A defect, by its id at the monitor. */
  DEFECT: "defect",
} as const;

export type PickKind = (typeof PICK_KIND)[keyof typeof PICK_KIND];

/** One item a world drew, as picking names it to the chrome and the chrome names it back. */
export interface PickTarget {
  readonly kind: PickKind;
  readonly id: string;
}

/** The layers the pipeline bar's counts switch, each a signal a world draws or leaves out. */
export const WORLD_LAYER = {
  PLANNED: "planned",
  BUILDING: "building",
  SHIPPED: "shipped",
  DEFECTS: "defects",
} as const;

export type WorldLayer = (typeof WORLD_LAYER)[keyof typeof WORLD_LAYER];

/** Which layers stand drawn; a world leaves out what a layer switched off holds. */
export type WorldLayers = { readonly [Layer in WorldLayer]: boolean };

/** Everything a world draws, handed whole on every change of any part of it. */
export interface WorldState {
  /** The reading, as of the scrubber's instant. */
  readonly view: FactoryWorldView;
  /** Whether the instant is the snapshot's own, the scrubber at its end. */
  readonly live: boolean;
  /** What the developer chose, which the agent card describes. */
  readonly selected: PickTarget | undefined;
  /** What the pointer rests on, which the hover label names. */
  readonly hovered: PickTarget | undefined;
  /** The selected agent's blast radius: each zone its work ripples to, by path, and how many steps away; empty with no agent selected. */
  readonly blast: ReadonlyMap<string, BlastZone["distance"]>;
  readonly layers: WorldLayers;
  /** Whether motion is held still: reduced motion or a capture run. Draw a still frame that says everything a moving one would. */
  readonly still: boolean;
  /** Whether the window draws in its dark appearance, so a world dresses its ground (`SCENE_GROUND.DARK`) to match. */
  readonly dark: boolean;
}

/** The colours every world draws its signals and grounds in, unchanged. */
export interface WorldPalette {
  readonly signal: typeof SIGNAL_COLOR;
  readonly ground: typeof SCENE_GROUND;
}

/** A point in the scene, as Three.js's own vectors read one. */
export interface WorldPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** The camera, as the host drives it: orbit, pan, and zoom from the pointer, a flight to a point, and home. */
export interface WorldCameraRig {
  readonly camera: PerspectiveCamera;
  /**
   * The establishing shot: where the camera stands and what it looks at,
   * which Esc and the home button fly back to and the scene opens on. Call
   * it from `create`, scaled to the world's own geometry.
   */
  readonly setHome: (position: WorldPoint, target: WorldPoint) => void;
  /** How near the camera may come and how far it may go, in scene units. */
  readonly setReach: (nearest: number, farthest: number) => void;
}

/** What a world registers to be picked. Each call answers the function that takes the registration back. */
export interface WorldPicking {
  /** An object (and everything under it) as one target; the label and a flight aim at its bounds' centre. */
  readonly add: (object: Object3D, target: PickTarget) => () => void;
  /** An instanced mesh, each instance its own target, or none for an instance that is not one. */
  readonly addInstances: (
    mesh: InstancedMesh,
    targetOf: (instanceId: number) => PickTarget | undefined,
  ) => () => void;
}

/** What the host hands a world once, as it creates it. */
export interface WorldHost {
  /** The scene the host renders: a world adds its lights and geometry here. */
  readonly scene: Scene;
  readonly camera: WorldCameraRig;
  readonly palette: WorldPalette;
  readonly picking: WorldPicking;
  /** Asks for one more frame, for a change drawn outside `update` and `frame`. */
  readonly invalidate: () => void;
}

/** A world as created: redrawn on every change, stepped on every frame while motion runs, and taken down. */
export interface WorldInstance {
  /** Draws the state handed: the first call follows `create` at once, and another follows every change. */
  readonly update: (state: WorldState) => void;
  /**
   * Steps the world's own motion, `delta` seconds since the last frame and
   * `elapsed` since the world was created. It is called only while motion
   * runs and the world is on screen; a still world is never stepped.
   */
  readonly frame?: (delta: number, elapsed: number) => void;
  /**
   * Lets go of what the world holds outside the scene: a timer, a worker.
   * The host disposes every geometry, material, and texture left in the
   * scene after it, so a world need not walk its own.
   */
  readonly dispose: () => void;
}

/** What a world's entry exports, as `world`. */
export interface WorldModule {
  readonly create: (host: WorldHost) => WorldInstance;
}
