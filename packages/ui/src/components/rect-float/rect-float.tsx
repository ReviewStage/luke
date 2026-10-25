import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { motionHeld } from "../../motion-timing.js";
import { useDisclosure } from "../../use-disclosure.js";
import { visibleViewport } from "../../visible-viewport.js";
import { askedStyleWidth } from "../anchored-popover/anchored-popover.js";
import {
  type Box,
  POPOVER_ALIGN,
  POPOVER_SIDE,
  type PopoverSide,
  type PopoverWidth,
  popoverPlace,
} from "../anchored-popover/popover-place.js";
import { type PressAway, usePressAway } from "../anchored-popover/press-away.js";

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
 * anything scrolls, since a scroll may leave its side no room. The height
 * its side leaves it is handed to what it holds as `--luke-popover-room`,
 * as the anchored popover's is, which a tall list bounds itself by. A press
 * outside it is handed to its owner, who closes it unless the press lands
 * on what it `holds`, the field whose caret it stands by say
 * (`../anchored-popover/press-away.ts`). It stands at one of the popover's
 * three widths where its owner names one (`POPOVER_WIDTH`), never at a
 * width of the owner's own. What it holds draws its own surface (`MenuSurface`).
 *
 * Whether it stands is its owner's (`open`), as a popover's is. As `open`
 * falls it fades out on the exit token where it last stood, inert, hearing
 * no press away and measuring nothing, and still drawing what it last held
 * open, so an owner that let go of what it showed in the render that closed
 * it need keep nothing for the fade; it goes once the fade has run
 * (`useDisclosure`), and reduced motion and a capture run, which zero the
 * tokens, take it away at once. An owner that mounts it to open it and
 * unmounts it to close it passes `true`, and it goes at once. An owner whose
 * own body holds state while it is drawn hears `onExited` once it is gone.
 */

/** Where the layer stands in its owner's box: its corner, the widest the room it keeps inside leaves it, and the height its side leaves it. */
interface FloatPlace {
  readonly side: PopoverSide;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly room: number;
}

/** Whether two places draw the layer alike, so a scroll that moves nothing renders nothing. */
function samePlace(a: FloatPlace | undefined, b: FloatPlace): boolean {
  return (
    a !== undefined &&
    a.side === b.side &&
    a.left === b.left &&
    a.top === b.top &&
    a.width === b.width &&
    a.room === b.room
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
    room: place.room,
  };
}

/**
 * The layer by `anchor`, on `side`, above where none is said. Note that it
 * is never hidden while unplaced, because the placing lands before the
 * first paint, and a hidden layer would refuse the focus a field in it
 * takes as it mounts; where `anchor` answers none, it stays where it stood.
 */
export function RectFloat({
  open,
  anchor,
  side = POPOVER_SIDE.ABOVE,
  width,
  onPressAway,
  holds,
  onExited,
  children,
}: PressAway & {
  /** Whether it stands; falling, it fades out where it stood before it goes. */
  open: boolean;
  /** The box to stand by, in window coordinates, as it stands now; none where it cannot be measured. */
  anchor: () => Box | undefined;
  side?: PopoverSide | undefined;
  /** One of the three widths a popover asks for, drawn from its token; as wide as what it holds where none is named. */
  width?: PopoverWidth | undefined;
  /** Its fade has run and it is gone, which an owner whose body holds state lets go of it on. */
  onExited?: (() => void) | undefined;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const layer = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<FloatPlace | undefined>(undefined);
  const measure = useRef<() => void>(() => undefined);
  const { mounted, leaving, ref: held } = useDisclosure(open);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      layer.current = node;
      held(node);
    },
    [held],
  );
  // Note that what it held open is what it draws as it fades, because its owner may have let go of it in the render that closed it.
  const last = useRef(children);
  if (open) last.current = children;
  usePressAway(layer, () => undefined, { onPressAway: open ? onPressAway : undefined, holds });
  measure.current = () => {
    const element = layer.current;
    const frame = element?.offsetParent;
    const box = anchor();
    if (element === null || !(frame instanceof HTMLElement) || box === undefined) return;
    const next = placeIn(element, frame, box, roomOf(clipOf(element)), side);
    setPlace((was) => (samePlace(was, next) ? was : next));
  };
  // Note that it is measured on every draw while it stands, because what it stands by moves with its owner's state, words selected anew say, and nothing else tells it.
  useLayoutEffect(() => {
    if (open) measure.current();
  });
  useLayoutEffect(() => {
    const element = layer.current;
    if (!open || element === null) return;
    const again = () => measure.current();
    const observer = new ResizeObserver(again);
    observer.observe(element);
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
  }, [open]);

  // Note that the owner hears it gone only once it has stood, because one that never opened has left nothing to let go of.
  const stood = useRef(false);
  useEffect(() => {
    if (mounted) {
      stood.current = true;
    } else if (stood.current) {
      stood.current = false;
      onExited?.();
    }
  }, [mounted, onExited]);

  // Note that reduced motion and a capture run take it away in the render
  // that closes it, rather than once its fade is found to run none.
  if (!mounted || (leaving && motionHeld())) return null;
  return (
    <div
      ref={drawn}
      className="luke-rect-float"
      data-side={place?.side ?? side}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      style={{
        ...(width === undefined ? undefined : { width: askedStyleWidth(width) }),
        ...(place === undefined
          ? undefined
          : {
              left: place.left,
              top: place.top,
              maxWidth: place.width,
              ...cssCustomProperties({ "--luke-popover-room": `${place.room}px` }),
            }),
      }}
    >
      {open ? children : last.current}
    </div>
  );
}
