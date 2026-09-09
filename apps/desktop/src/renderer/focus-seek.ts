/** Long enough for any stage to arrive, and short enough to be a backstop. */
export const FOCUS_FRAME_LIMIT = 60;

/** Only an element a reader can actually see is worth acting on. */
export function drawnVisibly(element: HTMLElement): boolean {
  return element.checkVisibility({ opacityProperty: true });
}

/** Whether the staged surface an element sits in has finished arriving. */
function staged(element: HTMLElement): boolean {
  return getComputedStyle(element).visibility === "visible";
}

/**
 * Waits, frame by frame, for something the panel has not drawn yet, and does
 * one thing to it when it arrives.
 *
 * Everything the panel draws sits in a staged surface that is
 * `visibility: hidden` until its arrival delay has passed, and a hidden element
 * refuses focus outright — so asking on the frame the shape changes silently
 * does nothing. This waits for the stage rather than guessing at its delay,
 * which keeps the timing in the stylesheet where the rest of the motion lives.
 * A target the panel never draws is given up on quietly, because the
 * alternative is a seek that never stops.
 *
 * Answers the way to stop waiting.
 */
export function focusSeek<Target extends HTMLElement>({
  find,
  ready = staged,
  act,
  frames: limit = FOCUS_FRAME_LIMIT,
}: {
  /** The target, absent while it is not drawn yet. Read once per frame. */
  find: () => Target | null | undefined;
  /** Whether the found target can be acted on. Defaults to the staged reading. */
  ready?: (target: Target) => boolean;
  /** What to do once. */
  act: (target: Target) => void;
  /** How many frames to wait. */
  frames?: number;
}): () => void {
  let frame = 0;
  let waited = 0;
  const seek = () => {
    const target = find();
    if (target && ready(target)) {
      act(target);
      return;
    }
    if (waited++ > limit) return;
    frame = requestAnimationFrame(seek);
  };
  seek();
  return () => cancelAnimationFrame(frame);
}
