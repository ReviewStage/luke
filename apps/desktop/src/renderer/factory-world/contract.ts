import type { RefObject } from "react";
import type { PickTarget, WorldModule, WorldState } from "./world";

/**
 * contract.ts -- what the Factory page and the scene bundle say to each other: the one mount call, and the handle the page redraws the world through.
 *
 * Three.js is too large for the bundle every window parses, so the scene
 * host ships as a bundle of its own (`factory-world.js`, built from
 * `./scene/index.ts`) that the page loads the first time a world is chosen,
 * as a plan loads its diagrams; each world is a bundle of its own beside it
 * (`factory-world-<key>.js`). This file is the whole of what the page and
 * the host share: the world module chosen, the state it draws, and what the
 * pointer lands on, and nothing here imports a value, so the page carries
 * none of Three.js.
 *
 * Every word stays in the page's DOM, which session replay masks: the scene
 * draws shapes alone, and names what the pointer rests on to the page, whose
 * hover label and card say it.
 */

/** Where in the scene's box the pointer stands, in CSS pixels from its top-left corner. */
interface ScenePoint {
  readonly x: number;
  readonly y: number;
}

/** What the pointer rests on, and where. */
export interface SceneHover {
  readonly target: PickTarget;
  readonly at: ScenePoint;
}

/** What the page hands the scene when it mounts it. */
export interface FactorySceneProps {
  readonly world: WorldModule;
  /** The first state drawn. */
  readonly state: WorldState;
  /** The pointer came to rest on something, or left it for nothing. */
  readonly onHover: (hover: SceneHover | undefined) => void;
  /** A press (not a drag) landed on something, or on nothing. */
  readonly onPick: (target: PickTarget | undefined) => void;
  /** The camera left the establishing shot, by the pointer or a flight, or came back to it. */
  readonly onAway: (away: boolean) => void;
}

/** The scene as mounted: draw a later state, run or rest, fly home, and take it down. */
export interface FactorySceneHandle {
  /** Draws a later state; a newly selected target the world registered is flown to. */
  readonly show: (state: WorldState) => void;
  /** Whether the scene is on screen; off it, the loop rests and nothing is drawn. */
  readonly setShown: (shown: boolean) => void;
  /** Flies back to the establishing shot. */
  readonly home: () => void;
  readonly unmount: () => void;
}

/** What the scene bundle's entry exports, which the page imports the first time a world is chosen (`../bundle-loader.ts`). */
export interface FactorySceneModule {
  /** Mounts the world chosen in `element`; throws where the Mac's WebGL cannot be had. */
  readonly mount: (element: HTMLElement, props: FactorySceneProps) => FactorySceneHandle;
}

/**
 * What the Factory page hands whichever scene it draws in, a world's or the
 * campus's (`campus/`): the state, whether it is on screen, and the doors
 * back, so the chrome over it serves both alike.
 */
export interface StageSceneProps {
  readonly state: WorldState;
  readonly shown: boolean;
  /** Where the scene leaves its way back to the establishing shot, which the home button and Esc take. */
  readonly home: RefObject<(() => void) | undefined>;
  readonly onHover: (hover: SceneHover | undefined) => void;
  readonly onPick: (target: PickTarget | undefined) => void;
  readonly onAway: (away: boolean) => void;
}
