/**
 * motion-timing.ts -- the timing a script-played motion runs on, read from the motion tokens where it plays.
 *
 * A motion played with `element.animate` takes its duration and easing from
 * the same tokens a stylesheet's transition does, read as they stand at the
 * element, so reduced motion and a capture run, which zero the durations,
 * hold it still with no check of its own.
 */

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
