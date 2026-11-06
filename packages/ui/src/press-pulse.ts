import { replayMotion } from "./replay-motion.js";

export const PRESS_PULSE = {
  FACE: "face",
  CONTROL: "control",
  QUIET: "quiet",
  FLUSH: "flush",
  WORDS: "words",
} as const;

export type PressPulse = (typeof PRESS_PULSE)[keyof typeof PRESS_PULSE];

const PULSE_ATTRIBUTE = "data-pulse";

const FACE_ATTRIBUTE = "data-press-face";

export const PRESS_FACE = { [FACE_ATTRIBUTE]: "" } as const;

export function pulsePress(pressed: HTMLElement, pulse: PressPulse = PRESS_PULSE.CONTROL): void {
  if (pulse === PRESS_PULSE.FLUSH) {
    const mover = [...pressed.children].find(
      (child) => getComputedStyle(child).display !== "contents",
    );
    if (mover === undefined) replayMotion(pressed, PULSE_ATTRIBUTE, pressed, PRESS_PULSE.WORDS);
    else replayMotion(pressed, PULSE_ATTRIBUTE, mover, pulse);
    return;
  }
  if (pulse !== PRESS_PULSE.FACE) {
    replayMotion(pressed, PULSE_ATTRIBUTE, pressed, pulse);
    return;
  }
  const face = pressed.querySelector(`:scope > [${FACE_ATTRIBUTE}]`);
  if (face === null) replayMotion(pressed, PULSE_ATTRIBUTE, pressed, PRESS_PULSE.CONTROL);
  else replayMotion(pressed, PULSE_ATTRIBUTE, face, pulse);
}

export function pulseOnPress<Event extends { currentTarget: HTMLElement }>(
  handler?: ((event: Event) => void) | undefined,
  pulse: PressPulse = PRESS_PULSE.CONTROL,
): (event: Event) => void {
  return (event) => {
    pulsePress(event.currentTarget, pulse);
    handler?.(event);
  };
}
