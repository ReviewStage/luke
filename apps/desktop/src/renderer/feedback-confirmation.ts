import { MOTION_DELAY_MS, MOTION_DURATION_MS } from "@sidecar/core";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "./luke-face-art";

/**
 * The moment after a send lands: Luke swoops down into the composer's shape,
 * lands beside "Sent — thank you!", and plays one of two dressed landings
 * before the panel returns. Which one is a coin flip per send, so the
 * confirmation is warm without being the same every time.
 */

/** How the confirmation dresses the landing: what the text does alongside. */
export const CONFIRMATION_SCENE = {
  /** A stomp whose impact ducks the text lines under him. */
  SHOCKWAVE: "shockwave",
  /** A puff at the exclamation mark, which tips over and springs back up. */
  BOOP: "boop",
} as const;

export type ConfirmationScene = (typeof CONFIRMATION_SCENE)[keyof typeof CONFIRMATION_SCENE];

export interface FeedbackConfirmation {
  motion: FaceMotion;
  scene: ConfirmationScene;
}

const SHOCKWAVE_CONFIRMATION: FeedbackConfirmation = {
  motion: FACE_MOTION.SUCCESS,
  scene: CONFIRMATION_SCENE.SHOCKWAVE,
};

const BOOP_CONFIRMATION: FeedbackConfirmation = {
  motion: FACE_MOTION.BOOP,
  scene: CONFIRMATION_SCENE.BOOP,
};

/** The two landings a send may draw. Each motion is one the artwork defines. */
export const CONFIRMATIONS: readonly FeedbackConfirmation[] = [
  SHOCKWAVE_CONFIRMATION,
  BOOP_CONFIRMATION,
];

/**
 * The confirmation a landed send plays: a coin flip between the two
 * landings. The flip is injectable so a test can watch both faces of the
 * coin, and a fixture run never reaches here at all — a send is refused
 * before it lands.
 */
export function feedbackConfirmation(random: () => number = Math.random): FeedbackConfirmation {
  return random() < 0.5 ? SHOCKWAVE_CONFIRMATION : BOOP_CONFIRMATION;
}

/**
 * When the gesture may begin: the entrance's own end. The swoop rides
 * `--slot-delay` and `--duration-shape`, so this mirror names the tokens it
 * restates rather than the numbers.
 */
export const CONFIRMATION_ENTRANCE_MS =
  MOTION_DURATION_MS.EXIT + MOTION_DELAY_MS.PEEK + MOTION_DURATION_MS.SURFACE;

/** The beat the landing rests after its gesture, before the panel returns. */
export const CONFIRMATION_REST_MS = 700;

/**
 * With motion asked away, the words alone say it: long enough to be read on
 * the way back from the Send button, no gesture to wait out.
 */
export const STILL_CONFIRMATION_MS = 1_600;

/**
 * How long the confirmation holds the shape before the panel is restored:
 * the swoop in, the gesture's own cycle, and a beat of rest — or, under
 * reduced motion, just long enough to read.
 */
export function confirmationHoldMs(input: { motion: FaceMotion; still: boolean }): number {
  if (input.still) return STILL_CONFIRMATION_MS;
  return CONFIRMATION_ENTRANCE_MS + FACE_MOTION_CYCLE_MS[input.motion] + CONFIRMATION_REST_MS;
}
