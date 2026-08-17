import { MOTION_DELAY_MS, MOTION_DURATION_MS } from "@sidecar/core";
import { FACE_MOTION, FACE_MOTION_CYCLE_MS, type FaceMotion } from "./luke-face-art";

/**
 * The moment after a send lands: Luke swoops down into the composer's shape,
 * lands beside "Sent — thank you!", and plays one gesture from the artwork's
 * own vocabulary before the panel returns. Which gesture is a function of how
 * many sends have landed from this machine — the very first gets the loud
 * one, and every send after walks a fixed ring — so the confirmation is warm
 * without ever being the same twice in a row.
 */

/** How the confirmation dresses the landing: what the text does alongside. */
export const CONFIRMATION_SCENE = {
  /** The first landing: a stomp whose impact ducks the text lines under him. */
  SHOCKWAVE: "shockwave",
  /** A puff at the exclamation mark, which tips over and springs back up. */
  BOOP: "boop",
  /** The plain landing: Luke arrives, plays his gesture, and that is all. */
  LANDING: "landing",
} as const;

export type ConfirmationScene = (typeof CONFIRMATION_SCENE)[keyof typeof CONFIRMATION_SCENE];

export interface FeedbackConfirmation {
  motion: FaceMotion;
  scene: ConfirmationScene;
}

/** The first-ever landing gets the loud one: the squash-and-stretch stomp. */
const FIRST_CONFIRMATION: FeedbackConfirmation = {
  motion: FACE_MOTION.SUCCESS,
  scene: CONFIRMATION_SCENE.SHOCKWAVE,
};

/**
 * Every send after the first walks this ring in order and wraps. Each entry is
 * a motion the artwork already defines; the two dressed scenes lead so the
 * text tricks are seen early, and the quieter face-only gestures follow.
 */
export const CONFIRMATION_CYCLE: readonly FeedbackConfirmation[] = [
  { motion: FACE_MOTION.BOOP, scene: CONFIRMATION_SCENE.BOOP },
  { motion: FACE_MOTION.REVIEWING, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.DIZZY, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.FLOATING, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.WINK, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.IDLE, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.YES, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.REFRESH, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.SHIMMY, scene: CONFIRMATION_SCENE.LANDING },
  { motion: FACE_MOTION.GLANCE, scene: CONFIRMATION_SCENE.LANDING },
];

/**
 * The confirmation a landed send plays, from how many landed before it. A
 * sequence the store could not supply reads as the first send, because the
 * worst that costs is replaying the welcome.
 */
export function feedbackConfirmation(sequence: number): FeedbackConfirmation {
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return FIRST_CONFIRMATION;
  const step = CONFIRMATION_CYCLE[(sequence - 1) % CONFIRMATION_CYCLE.length];
  return step ?? FIRST_CONFIRMATION;
}

/**
 * When the gesture may begin: the entrance's own end. The swoop rides
 * `--slot-delay` and `--duration-shape`, so this mirror names the tokens it
 * restates rather than the numbers.
 */
export const CONFIRMATION_ENTRANCE_MS =
  MOTION_DURATION_MS.EXIT + MOTION_DELAY_MS.PEEK + MOTION_DURATION_MS.SHAPE;

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
