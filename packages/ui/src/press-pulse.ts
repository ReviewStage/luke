import { replayMotion } from "./replay-motion.js";

/**
 * press-pulse.ts -- the answer every press a ui control takes plays once it lands: what it presses springs back from pressed.
 *
 * A click lets go of its press within a tenth of a second, too quick for a
 * press held down to be seen, so a press taken is answered after it lands,
 * keyboard presses included: what was pressed springs back from a little
 * smaller, once, and a second press restarts it (`replayMotion`). How much
 * it gives fits its shape (`PRESS_PULSE`): a Button's face, the glyph and
 * words inside its box; a small control whole; a row or a card, only a
 * little, since a wide shape that gave as much would lurch; a row flush to
 * the frame around it, a card's head or a table's row, by what it holds
 * alone, since its fill shrinking inside the frame that stands still would
 * open a gap at the frame's edges; and words among words, which a
 * transform cannot move, by a fade. Each runs over the
 * motion tokens (`press-pulse.css`), which reduced motion and a capture run
 * hold still, and moves by `scale` or `opacity` alone, so a transform the
 * shape stands at, a drag's or a swipe's, composes with it rather than
 * being replaced. A press refused plays nothing.
 */

/** How a press a control took is answered, by its shape. */
export const PRESS_PULSE = {
  /** The face inside its box springs back, the box standing still: a Button's. */
  FACE: "face",
  /** The whole control springs back: a tab, a chip, a swatch. */
  CONTROL: "control",
  /** A wide shape, a row or a card, gives a little and settles. */
  QUIET: "quiet",
  /** A row flush to a frame that stands still gives a little inside its fill, which holds the frame: a card's head, a table's row. */
  FLUSH: "flush",
  /** Words among words, which no transform moves, fade a little and come back. */
  WORDS: "words",
} as const;

export type PressPulse = (typeof PRESS_PULSE)[keyof typeof PRESS_PULSE];

/** The attribute a pulse stands as while it plays, its value the pulse. */
const PULSE_ATTRIBUTE = "data-pulse";

/** What a control's face wears, the part a `FACE` pulse moves. */
const FACE_ATTRIBUTE = "data-press-face";

/** The attributes a control's face is drawn with, so a `FACE` pulse finds it. */
export const PRESS_FACE = { [FACE_ATTRIBUTE]: "" } as const;

/**
 * Plays `pulse` on `pressed`, what the press moves: the control itself, or a
 * part of it that stands for it (a switch's thumb, a card around its press).
 * A `FACE` pulse moves the face `pressed` holds, or the whole of a control
 * that holds none. A `FLUSH` pulse moves each element `pressed` holds, its
 * first the one whose end takes the pulse away, or fades a row that holds
 * only words, so its fill never leaves the frame's edges.
 */
export function pulsePress(pressed: HTMLElement, pulse: PressPulse = PRESS_PULSE.CONTROL): void {
  if (pulse === PRESS_PULSE.FLUSH) {
    const first = pressed.firstElementChild;
    if (first === null) replayMotion(pressed, PULSE_ATTRIBUTE, pressed, PRESS_PULSE.WORDS);
    else replayMotion(pressed, PULSE_ATTRIBUTE, first, pulse);
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

/** `handler`, answering each press it hears with `pulse` on the element it is drawn on. */
export function pulseOnPress<Event extends { currentTarget: HTMLElement }>(
  handler?: ((event: Event) => void) | undefined,
  pulse: PressPulse = PRESS_PULSE.CONTROL,
): (event: Event) => void {
  return (event) => {
    pulsePress(event.currentTarget, pulse);
    handler?.(event);
  };
}
