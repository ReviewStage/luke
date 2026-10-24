/**
 * landed.ts -- "you landed here": the one mark a place wears once the view brought the eye to it.
 *
 * A search result's row, a review thread a link named, a message brought
 * into view, a unit of the plan as it settles, a diff's lines a chapter
 * points at: each wears `data-landed`, and `landed.css` lights it once. A
 * wash stands over it for `--luke-confirm-delay`, then fades over
 * `--luke-duration-shape`. Reduced motion zeroes the fade alone, so the wash
 * still stands, still, for the same hold, and a person jumped to a row can
 * see where they landed. The light is one inherited number, `--luke-landed`,
 * from 1 to 0, animated on the landed element itself, so its end is that
 * element's own `animationend` (`LANDED_ANIMATION`) and what it holds may
 * draw the light itself, as a diff's lines do inside their shadow root,
 * where no keyframes of the document's reach.
 */

/** Where a landed place's wash is laid, by the shape of its box. */
export const LANDED = {
  /** A step beyond the box's edges, so words and cards are lit with room around them. */
  AROUND: "around",
  /** A step inside the box's edges, for a row flush to the card it stands in, so the wash keeps clear of the card's corner. */
  WITHIN: "within",
  /** No wash of its own: what it holds draws `--luke-landed`, as a diff's lit lines do. */
  HELD: "held",
} as const;

export type Landed = (typeof LANDED)[keyof typeof LANDED];

/** The attribute a landed place wears, its value where its wash is laid. */
export const LANDED_ATTRIBUTE = "data-landed";

/** The animation whose end is a landing's, heard as the landed element's own `animationend`. */
export const LANDED_ANIMATION = "luke-landed";

/** What a place React draws wears while it is landed on, none while it is not. */
export function landedMark(
  lit: boolean,
  where: Landed = LANDED.AROUND,
): { readonly [LANDED_ATTRIBUTE]?: Landed } {
  return lit ? { [LANDED_ATTRIBUTE]: where } : {};
}

/**
 * Lands on `element`, one React does not draw the mark of: lights it from
 * the start, a light still standing begun again, and takes the mark away
 * as the light ends.
 */
export function land(element: HTMLElement, where: Landed = LANDED.AROUND): void {
  element.removeAttribute(LANDED_ATTRIBUTE);
  // Note that reading the layout here makes the engine see the mark gone before it is set again, which starts the light anew.
  void element.offsetWidth;
  element.setAttribute(LANDED_ATTRIBUTE, where);
  // Note that only the light's own end takes the mark, since the element's other motions, and those it holds, end here too.
  const ended = (event: AnimationEvent) => {
    if (event.target !== element || event.animationName !== LANDED_ANIMATION) return;
    element.removeAttribute(LANDED_ATTRIBUTE);
    element.removeEventListener("animationend", ended);
  };
  element.addEventListener("animationend", ended);
}
