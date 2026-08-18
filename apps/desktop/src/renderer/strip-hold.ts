/**
 * The decisions behind a pointer resting on the spoken strip — the caption
 * block and the chip band drawn under the housing while Luke speaks — kept
 * pure so they can be tested.
 *
 * The words and the chips normally leave with the reply that earned them, and
 * a voice failure leaves on its own clock. But a pointer already over them is
 * someone mid-read, or mid-press on a chip, and content that vanishes under a
 * hand is worse than content that lingers: the hold keeps exactly what the
 * strip was showing until the pointer moves away. It can start nothing — a
 * pointer arriving over an empty strip finds nothing to hold — so nothing
 * dismissed before the hover began is ever resurrected.
 */

/**
 * What the strip is showing, snapshotted whole. The hold keeps a snapshot
 * rather than reading each part's own last-drawn value, because the parts
 * outlive each other separately: a reply that drew only chips must not hold
 * an older reply's words, and one that drew only words must not hold chips
 * nobody was shown.
 */
export interface SpokenStripContent {
  /** The caption block's words, absent while only chips are drawn. */
  texts: readonly string[] | undefined;
  /** Whether the words are a failure borrowing the caption's strip. */
  isError: boolean;
  /** Whether the chip band is drawn. */
  chips: boolean;
}

/**
 * What the hold should be after this frame. Live content always wins — a new
 * reply's words replace whatever was held — and the hold survives only from
 * one drawn frame to the next under an unbroken hover: the moment the pointer
 * leaves, the strip goes back to saying only what is live. A hold that would
 * say the same thing keeps its identity, because the caller re-derives it
 * every render against the last frame's answer and the live content's own
 * identity churns per render: words rebuilt around an unchanged sentence must
 * not read as a change.
 */
export function stripHoldNext(input: {
  hovered: boolean;
  drawn: SpokenStripContent | undefined;
  held: SpokenStripContent | undefined;
}): SpokenStripContent | undefined {
  if (!input.hovered) return undefined;
  const next = input.drawn ?? input.held;
  return next !== undefined && input.held !== undefined && stripContentEquals(next, input.held)
    ? input.held
    : next;
}

function stripContentEquals(a: SpokenStripContent, b: SpokenStripContent): boolean {
  if (a.isError !== b.isError || a.chips !== b.chips) return false;
  if (a.texts === undefined || b.texts === undefined) return a.texts === b.texts;
  return (
    a.texts.length === b.texts.length && a.texts.every((text, index) => text === b.texts?.[index])
  );
}

/** An element's box as the hover test reads it. */
export interface StripBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Whether the pointer is over the strip. The caption element's own box runs
 * to the reserved maximum and a clip is what ends it at the words, so
 * containment stops at the visible height rather than the box's edge — the
 * remainder is desktop, and a pointer resting there is not resting on the
 * words. Either box is offered only while its content is drawn; an invisible
 * element still has a box, and it must hold nothing.
 */
export function pointOverStrip(input: {
  x: number;
  y: number;
  caption: { box: StripBox; visibleHeight: number } | undefined;
  band: StripBox | undefined;
}): boolean {
  if (input.caption) {
    const { box, visibleHeight } = input.caption;
    if (
      input.x >= box.left &&
      input.x <= box.right &&
      input.y >= box.top &&
      input.y <= box.top + visibleHeight
    ) {
      return true;
    }
  }
  if (input.band) {
    const { left, top, right, bottom } = input.band;
    if (input.x >= left && input.x <= right && input.y >= top && input.y <= bottom) return true;
  }
  return false;
}
