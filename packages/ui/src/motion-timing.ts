export const MOTION_TOKEN = {
  DURATION_FAST: "--ui-duration-fast",
  DURATION_PANE: "--ui-duration-pane",
  DURATION_QUICK: "--ui-duration-quick",
  DURATION_EXIT: "--ui-duration-exit",
  DURATION_SHAPE: "--ui-duration-shape",
  SPRING: "--ui-spring",
  SPRING_FAST: "--ui-spring-fast",
  EASE_EXIT: "--ui-motion-exit",
  EASE_PANE: "--ui-motion-pane",
  ROW_STAGGER: "--ui-row-stagger",
} as const;

export function milliseconds(value: string): number {
  const match = /^\s*([\d.]+)(ms|s)\s*$/u.exec(value);
  if (match === null) return 0;
  return Number(match[1]) * (match[2] === "s" ? 1000 : 1);
}

export function tokenTiming(
  element: Element,
  durationToken: string,
  easingToken: string,
): KeyframeAnimationOptions | undefined {
  const style = getComputedStyle(element);
  const duration = milliseconds(style.getPropertyValue(durationToken));
  const easing = style.getPropertyValue(easingToken).trim();
  if (duration <= 1 || easing === "") return undefined;
  return { duration, easing };
}

export function motionHeld(element: Element = document.body): boolean {
  const duration = getComputedStyle(element).getPropertyValue(MOTION_TOKEN.DURATION_FAST);
  if (duration.trim() === "") return false;
  return milliseconds(duration) <= 1;
}
