import { useLayoutEffect, useRef, useState } from "react";

/**
 * anchored-popover.tsx -- the layer a popover hangs from its own button in: above it, a small gap off, from one of its edges, inside the room around it.
 *
 * The desktop composer's chips open their menus here, so a menu stands right
 * over the button that opened it rather than over the card the button sits
 * in. The layer is drawn as the button's sibling inside a positioned box that
 * holds the button alone, which is the anchor: it opens upward, since the
 * composer stands at its panel's foot, and turns below only where the room
 * above cannot hold it and the room below can. It lines up with the
 * anchor's leading or trailing edge as its owner asks, takes the other
 * where the asked one would run past the room, and is pushed back inside
 * where neither fits; it is never wider than the room leaves. The room is
 * the nearest box marked `data-popover-room` (the desktop's side panel),
 * cut to the window, or else the window, measured as the layer opens,
 * before it is painted, again whenever the layer, its anchor, its room, or
 * the window resizes, and again whenever anything scrolls, since a scroll
 * moves the anchor inside its room. The layer is held by the anchor's edge
 * it was asked to line up with, so a button that grows or shrinks from its
 * other edge, as the model chip does when Fast comes on, leaves its open
 * menu where it stood rather than throwing it sideways for a frame until
 * the resize is measured.
 */

/** Which side of its anchor a popover hangs on. */
const POPOVER_SIDE = {
  ABOVE: "above",
  BELOW: "below",
} as const;

type PopoverSide = (typeof POPOVER_SIDE)[keyof typeof POPOVER_SIDE];

/** Which of its anchor's edges a popover lines up with: the leading one, growing rightward, or the trailing one, growing leftward. */
export const POPOVER_ALIGN = {
  START: "start",
  END: "end",
} as const;

export type PopoverAlign = (typeof POPOVER_ALIGN)[keyof typeof POPOVER_ALIGN];

/** The gap between the anchor and its popover, which is the stylesheet's `--luke-space-4`. */
const POPOVER_GAP = 4;

/** The width a popover asks for, the desktop's searchable menu's own, which the room may narrow. */
const POPOVER_WIDTH = 340;

/** The least gap a popover keeps from its room's edges, as the desktop's action menu keeps from the window's. */
const POPOVER_MARGIN = 8;

/** The box that bounds a popover beside the window's: the desktop's side panel, which marks itself so. */
const POPOVER_ROOM = "[data-popover-room]";

/** A box in window coordinates. */
interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a popover stands: its side, how far its asked edge stands in from its anchor's, and its width. */
interface PopoverPlace {
  side: PopoverSide;
  inset: number;
  width: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/**
 * Where a popover of this width and height stands against its anchor in
 * its room: above unless only below has room for it, at the asked edge
 * unless only the other keeps it inside, else pushed back inside.
 */
function popoverPlace(input: {
  anchor: Box;
  room: Box;
  width: number;
  height: number;
  align: PopoverAlign;
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
  const side =
    above < input.height && below >= input.height ? POPOVER_SIDE.BELOW : POPOVER_SIDE.ABOVE;
  const inset = align === POPOVER_ALIGN.START ? left - anchor.left : anchor.right - left - width;
  return { side, inset, width };
}

/** Whether two places draw the layer alike, so a scroll that moves nothing renders nothing. */
function samePlace(a: PopoverPlace | undefined, b: PopoverPlace): boolean {
  return a !== undefined && a.side === b.side && a.inset === b.inset && a.width === b.width;
}

/** The layer's inline place: its asked edge's inset, as `left` or `right`, and its width. */
function placeStyle(align: PopoverAlign, inset: number, width: number): React.CSSProperties {
  return align === POPOVER_ALIGN.START ? { left: inset, width } : { right: inset, width };
}

/** The room a popover inside `element` may fill: its marked room cut to the window, or the window. */
function roomAround(element: HTMLElement): Box {
  const marked = element.closest(POPOVER_ROOM)?.getBoundingClientRect();
  return {
    left: Math.max(marked?.left ?? 0, 0),
    top: Math.max(marked?.top ?? 0, 0),
    right: Math.min(marked?.right ?? window.innerWidth, window.innerWidth),
    bottom: Math.min(marked?.bottom ?? window.innerHeight, window.innerHeight),
  };
}

/**
 * The layer itself, at the menu's width where the room allows it. Note that it is
 * placed in a layout effect and never hidden while unplaced, because the
 * placing lands before the first paint, and a hidden layer would refuse
 * the focus its popover takes as it mounts.
 */
export function AnchoredPopover({
  align,
  children,
}: {
  align: PopoverAlign;
  children: React.ReactNode;
}): React.JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlace | undefined>(undefined);

  useLayoutEffect(() => {
    const drawn = layer.current;
    const anchor = drawn?.parentElement;
    if (drawn === null || anchor === null || anchor === undefined) return;
    const measure = () => {
      const next = popoverPlace({
        anchor: anchor.getBoundingClientRect(),
        room: roomAround(anchor),
        width: POPOVER_WIDTH,
        height: drawn.getBoundingClientRect().height,
        align,
      });
      setPlace((last) => (samePlace(last, next) ? last : next));
    };
    measure();
    // Note that the popover is placed again whenever it, its button, or its
    // room resizes, because a menu grows as its rows arrive and the side
    // panel is dragged wider or narrower without the window resizing.
    const observer = new ResizeObserver(measure);
    observer.observe(drawn);
    observer.observe(anchor);
    const room = anchor.closest(POPOVER_ROOM);
    if (room !== null) observer.observe(room);
    window.addEventListener("resize", measure);
    // Note that a scroll is heard while it is captured, because a scroll
    // does not bubble and the scroller that moved the anchor may be any box
    // around it.
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, { capture: true });
    };
  }, [align]);

  return (
    <div
      ref={layer}
      className="luke-anchored-popover"
      data-side={place?.side ?? POPOVER_SIDE.ABOVE}
      style={
        place === undefined
          ? placeStyle(align, 0, POPOVER_WIDTH)
          : placeStyle(align, place.inset, place.width)
      }
    >
      {children}
    </div>
  );
}
