/**
 * popover-place.ts -- where a popover stands against its anchor inside its room, worked out from their boxes alone.
 *
 * The anchored popover (`anchored-popover.tsx`) measures its anchor, its
 * room, and itself, and asks this where to stand, as the layer laid by a box
 * in the window does (`../rect-float/rect-float.tsx`): on the side asked,
 * above unless told otherwise, unless only the other side has room for it,
 * or, where neither side has, on the side with more, at the edge its owner
 * asked for unless only the other keeps it inside, else pushed back inside,
 * never wider than the room leaves, and told the height its side leaves it.
 */

/** Which side of its anchor a popover hangs on. */
export const POPOVER_SIDE = {
  ABOVE: "above",
  BELOW: "below",
} as const;

export type PopoverSide = (typeof POPOVER_SIDE)[keyof typeof POPOVER_SIDE];

/** Which of its anchor's edges a popover lines up with: the leading one, growing rightward, or the trailing one, growing leftward. */
export const POPOVER_ALIGN = {
  START: "start",
  END: "end",
} as const;

export type PopoverAlign = (typeof POPOVER_ALIGN)[keyof typeof POPOVER_ALIGN];

/** The gap between the anchor and its popover, which is the stylesheet's `--luke-space-4`. */
const POPOVER_GAP = 4;

/** The least gap a popover keeps from its room's edges, as the desktop's action menu keeps from the window's. */
const POPOVER_MARGIN = 8;

/** A box in window coordinates. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a popover stands: its side, how far its asked edge stands in from its anchor's, its width, and the height that side leaves it. */
export interface PopoverPlace {
  side: PopoverSide;
  inset: number;
  width: number;
  room: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * Where a popover of this width and height stands against its anchor in
 * its room: on the side asked, above where none is, unless only the other
 * side has room for it, or, where neither side has, on the side with more,
 * at the asked edge unless only the other keeps it inside, else pushed
 * back inside.
 */
export function popoverPlace(input: {
  anchor: Box;
  room: Box;
  width: number;
  height: number;
  align: PopoverAlign;
  side?: PopoverSide | undefined;
}): PopoverPlace {
  const { anchor, room, align } = input;
  const width = Math.min(input.width, room.right - room.left - 2 * POPOVER_MARGIN);
  const low = room.left + POPOVER_MARGIN;
  const high = room.right - POPOVER_MARGIN - width;
  const startLeft = anchor.left;
  const endLeft = anchor.right - width;
  const [asked, other] =
    align === POPOVER_ALIGN.START ? [startLeft, endLeft] : [endLeft, startLeft];
  const fits = (left: number) => left >= low && left <= high;
  const left = fits(asked) ? asked : fits(other) ? other : clamp(asked, low, high);
  const above = anchor.top - room.top - POPOVER_GAP - POPOVER_MARGIN;
  const below = room.bottom - anchor.bottom - POPOVER_GAP - POPOVER_MARGIN;
  const wanted = input.side ?? POPOVER_SIDE.ABOVE;
  const [own, across, turned] =
    wanted === POPOVER_SIDE.ABOVE
      ? [above, below, POPOVER_SIDE.BELOW]
      : [below, above, POPOVER_SIDE.ABOVE];
  // Note that it turns only where its own side cannot hold it and the other holds it, or holds more of it.
  const turns = own < input.height && (across >= input.height || across > own);
  const side = turns ? turned : wanted;
  const inset = align === POPOVER_ALIGN.START ? left - anchor.left : anchor.right - left - width;
  return { side, inset, width, room: Math.max(side === POPOVER_SIDE.BELOW ? below : above, 0) };
}

/** Whether two places draw the layer alike, so a scroll that moves nothing renders nothing. */
export function samePlace(a: PopoverPlace | undefined, b: PopoverPlace): boolean {
  return (
    a !== undefined &&
    a.side === b.side &&
    a.inset === b.inset &&
    a.width === b.width &&
    a.room === b.room
  );
}
