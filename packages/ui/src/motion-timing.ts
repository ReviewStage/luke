/**
 * motion-timing.ts -- the timing a script-played motion runs on, read from the motion tokens where it plays.
 *
 * A motion played with `element.animate` takes its duration and easing from
 * the same tokens a stylesheet's transition does, read as they stand at the
 * element, so reduced motion and a capture run, which zero the durations,
 * hold it still with no check of its own. Where a script must choose between
 * motion and none, rather than play a timing, `motionHeld` reads the same
 * tokens, never the OS setting, which a capture run does not touch.
 */

/** The custom properties a script-played motion reads, the same a stylesheet's transition does. */
export const MOTION_TOKEN = {
  DURATION_FAST: "--luke-duration-fast",
  DURATION_PANE: "--luke-duration-pane",
  DURATION_QUICK: "--luke-duration-quick",
  DURATION_EXIT: "--luke-duration-exit",
  DURATION_SHAPE: "--luke-duration-shape",
  SPRING: "--luke-spring",
  SPRING_FAST: "--luke-spring-fast",
  EASE_EXIT: "--luke-motion-exit",
  EASE_PANE: "--luke-motion-pane",
  ROW_STAGGER: "--luke-row-stagger",
} as const;

/** A CSS time, `240ms` or `0.24s`, in milliseconds; anything else is none. */
export function milliseconds(value: string): number {
  const match = /^\s*([\d.]+)(ms|s)\s*$/u.exec(value);
  if (match === null) return 0;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

/**
 * The timing a motion plays on, read from the duration and easing tokens
 * named as they stand at `element`, or nothing where there is to be no
 * motion.
 */
export function tokenTiming(
  element: Element,
  durationToken: string,
  easingToken: string,
): KeyframeAnimationOptions | undefined {
  const style = getComputedStyle(element);
  const duration = milliseconds(style.getPropertyValue(durationToken));
  const easing = style.getPropertyValue(easingToken).trim();
  // Note that reduced motion leaves 1ms rather than none, which is no motion either.
  if (duration <= 1 || easing === "") return undefined;
  return { duration, easing };
}

/**
 * Whether motion is held still where `element` stands, as reduced motion and a
 * capture run hold it: the tokens' durations zeroed. Note that a document no
 * stylesheet has drawn sets none, and is not held, so a script plays its motion
 * there as it would on a window that asked for nothing.
 */
export function motionHeld(element: Element = document.documentElement): boolean {
  const duration = getComputedStyle(element).getPropertyValue(MOTION_TOKEN.DURATION_FAST);
  if (duration.trim() === "") return false;
  return milliseconds(duration) <= 1;
}
