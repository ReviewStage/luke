import type { RefObject } from "react";
import type { PickTarget, WorldState } from "./world.js";

/**
 * contract.ts -- what the Factory page and the campus's scene say to each other: the state handed, what the pointer lands on, and the doors back.
 *
 * Every word stays in the page's DOM, which session replay masks: the scene
 * names what the pointer rests on to the page, whose hover label and card
 * say it.
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

/**
 * What the Factory page hands the campus's scene (`campus/`): the state,
 * whether it is on screen, and the doors back, which the chrome over it
 * shares.
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
