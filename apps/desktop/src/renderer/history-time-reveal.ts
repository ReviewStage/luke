/**
 * The stamps' reveal, kept the way iMessage keeps a message's time: laid out
 * past the thread's right edge, uncovered when the developer pulls the thread
 * left, and sprung home when they let go. On a Mac the pull is the trackpad's
 * sideways scroll, which reaches the renderer as wheel steps and nothing else.
 */

/**
 * How long the thread waits after the last sideways step before it counts the
 * hand as lifted. Chromium hands the renderer no gesture phase, only the steps
 * themselves, so the lift is the silence after them: a swipe delivers a step
 * every frame for as long as it lasts, and a pause this long is the hand at
 * rest. It is not a motion duration: the spring home is the stylesheet's own
 * transition, on the motion tokens, once the hold is dropped.
 */
export const TIME_REVEAL_SETTLE_MS = 160;

export interface WheelStep {
  readonly deltaX: number;
  readonly deltaY: number;
}

/** Whether a wheel step is the sideways pull the reveal takes, rather than the thread's own scroll. */
export function isSidewaysStep(step: WheelStep): boolean {
  return Math.abs(step.deltaX) > Math.abs(step.deltaY);
}

/**
 * The reveal after a sideways step. Fingers moving left arrive as a positive
 * deltaX under natural scrolling, the direction the content follows, so that
 * is the pull that uncovers the stamps, and the reverse covers them again.
 * The reveal is clamped to the column: a long pull leaves nothing to unwind,
 * and the thread rests against the column's edge instead of running past it.
 */
export function revealAfterStep(reveal: number, deltaX: number, column: number): number {
  return Math.min(column, Math.max(0, reveal + deltaX));
}

/** What the walk below needs of a node: the one above it, or nothing at the top. */
export interface Ancestry<Node> {
  readonly parentElement: Node | null;
}

/**
 * Whether a step over `target` belongs to a block between it and the thread
 * that already pans sideways, a fenced code line or a table wider than its
 * bubble, rather than to the pull. Over such a block the same gesture is the
 * only way to read the line's end, so the block keeps it whole, whichever edge
 * it stands at: a pull that took over at the block's edge would drag the
 * thread mid-swipe. `pans` is asked of each node on the way up, and the
 * thread itself is never asked.
 */
export function panningBlockBetween<Node extends Ancestry<Node>>(
  target: Node | null,
  thread: Node,
  pans: (node: Node) => boolean,
): boolean {
  for (let node = target; node !== null && node !== thread; node = node.parentElement) {
    if (pans(node)) return true;
  }
  return false;
}
