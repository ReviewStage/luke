import { useLayoutEffect, useRef, useState } from "react";
import { visibleViewport } from "../../visible-viewport.js";
import {
  type Box,
  POPOVER_ALIGN,
  POPOVER_SIDE,
  type PopoverSide,
  popoverPlace,
} from "../anchored-popover/popover-place.js";

/**
 * rect-float.tsx -- the layer that stands by a box in the window rather than by a button: words selected, or a caret, with a toolbar, a list, or a field floated over or under it.
 *
 * Its owner draws it inside a positioned box of its own, the room an editor
 * stands in say, and hands it the box to stand by in window coordinates
 * (`anchor`), read anew each time it is measured; the layer stands a small
 * gap off that box, from its leading edge, on the side asked. It turns to
 * the other side where the side asked cannot hold it and the other can, and
 * keeps inside what can be seen of it: the box that clips it, a scroller
 * say, cut to what is seen of the window. It is laid in its owner's box
 * rather than over the window, so a scroll carries it with the words it
 * stands by and a field in it is still inside the owner's box when it takes
 * the focus. It is measured as it is drawn, before it is painted, each time
 * it is drawn again, whenever it resizes or the window does, and whenever
 * anything scrolls, since a scroll may leave its side no room. What it
 * holds draws its own surface (`MenuSurface`).
 */

/** Where the layer stands in its owner's box: its corner, and the widest the room it keeps inside leaves it. */
interface FloatPlace {
  readonly side: PopoverSide;
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

/** Whether two places draw the layer alike, so a scroll that moves nothing renders nothing. */
function samePlace(a: FloatPlace | undefined, b: FloatPlace): boolean {
  return (
    a !== undefined &&
    a.side === b.side &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width
  );
}

/** The nearest box around `element` that clips what overflows it; none where only the window does. */
function clipOf(element: HTMLElement): HTMLElement | undefined {
  for (let at = element.parentElement; at !== null; at = at.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(at);
    if (overflowX !== "visible" || overflowY !== "visible") return at;
  }
  return undefined;
}

/** What can be seen of the clipping box, cut to what is seen of the window. */
function roomOf(clip: HTMLElement | undefined): Box {
  const seen = visibleViewport();
  const box = clip?.getBoundingClientRect();
  return {
    left: Math.max(box?.left ?? seen.left, seen.left),
    top: Math.max(box?.top ?? seen.top, seen.top),
    right: Math.min(box?.right ?? seen.right, seen.right),
    bottom: Math.min(box?.bottom ?? seen.bottom, seen.bottom),
  };
}

/**
 * Where `drawn` stands by `anchor` in `room`, in the coordinates of
 * `frame`, the box it is laid in: its top is the anchor's edge on its side,
 * and the stylesheet moves it the gap off and, above, its own height up.
 * Note that a margin an owner's rule gives it, as a rule spacing a box's
 * children does, is taken off, because a box laid absolutely stands by its
 * margin's edge.
 */
function placeIn(
  drawn: HTMLElement,
  frame: HTMLElement,
  anchor: Box,
  room: Box,
  side: PopoverSide,
): FloatPlace {
  const size = { width: drawn.offsetWidth, height: drawn.offsetHeight };
  const place = popoverPlace({ anchor, room, ...size, align: POPOVER_ALIGN.START, side });
  const own = frame.getBoundingClientRect();
  const margin = getComputedStyle(drawn);
  const edge = place.side === POPOVER_SIDE.ABOVE ? anchor.top : anchor.bottom;
  return {
    side: place.side,
    left:
      anchor.left +
      place.inset -
      own.left -
      frame.clientLeft +
      frame.scrollLeft -
      (Number.parseFloat(margin.marginLeft) || 0),
    top:
      edge -
      own.top -
      frame.clientTop +
      frame.scrollTop -
      (Number.parseFloat(margin.marginTop) || 0),
    width: place.width,
  };
}

/**
 * The layer by `anchor`, on `side`, above where none is said. Note that it
 * is never hidden while unplaced, because the placing lands before the
 * first paint, and a hidden layer would refuse the focus a field in it
 * takes as it mounts; where `anchor` answers none, it stays where it stood.
 */
export function RectFloat({
  anchor,
  side = POPOVER_SIDE.ABOVE,
  children,
}: {
  /** The box to stand by, in window coordinates, as it stands now; none where it cannot be measured. */
  anchor: () => Box | undefined;
  side?: PopoverSide | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<FloatPlace | undefined>(undefined);
  const measure = useRef<() => void>(() => undefined);
  measure.current = () => {
    const drawn = layer.current;
    const frame = drawn?.offsetParent;
    const box = anchor();
    if (drawn === null || !(frame instanceof HTMLElement) || box === undefined) return;
    const next = placeIn(drawn, frame, box, roomOf(clipOf(drawn)), side);
    setPlace((last) => (samePlace(last, next) ? last : next));
  };
  // Note that it is measured on every draw, because what it stands by moves with its owner's state, words selected anew say, and nothing else tells it.
  useLayoutEffect(() => measure.current());
  useLayoutEffect(() => {
    const drawn = layer.current;
    if (drawn === null) return;
    const again = () => measure.current();
    const observer = new ResizeObserver(again);
    observer.observe(drawn);
    window.addEventListener("resize", again);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", again);
    viewport?.addEventListener("scroll", again);
    // Note that a scroll is heard while it is captured, because a scroll does not bubble and the scroller may be any box around the layer.
    document.addEventListener("scroll", again, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", again);
      viewport?.removeEventListener("resize", again);
      viewport?.removeEventListener("scroll", again);
      document.removeEventListener("scroll", again, { capture: true });
    };
  }, []);
  return (
    <div
      ref={layer}
      className="luke-rect-float"
      data-side={place?.side ?? side}
      style={
        place === undefined
          ? undefined
          : { left: place.left, top: place.top, maxWidth: place.width }
      }
    >
      {children}
    </div>
  );
}
