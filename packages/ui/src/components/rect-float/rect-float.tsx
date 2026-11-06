import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { motionHeld } from "../../motion-timing.js";
import { useDisclosure } from "../../use-disclosure.js";
import { visibleViewport } from "../../visible-viewport.js";
import { askedStyleWidth } from "../anchored-popover/anchored-popover.js";
import { clipsAround, cutTo } from "../anchored-popover/clip-room.js";
import {
  type Box,
  POPOVER_ALIGN,
  POPOVER_SIDE,
  type PopoverSide,
  type PopoverWidth,
  popoverPlace,
} from "../anchored-popover/popover-place.js";
import { type PressAway, usePressAway } from "../anchored-popover/press-away.js";

interface FloatPlace {
  readonly side: PopoverSide;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly room: number;
}

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
  open: boolean;
  anchor: () => Box | undefined;
  side?: PopoverSide | undefined;
  width?: PopoverWidth | undefined;
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
  const last = useRef(children);
  if (open) last.current = children;
  usePressAway(layer, () => undefined, { onPressAway: open ? onPressAway : undefined, holds });
  measure.current = () => {
    const element = layer.current;
    const frame = element?.offsetParent;
    const box = anchor();
    if (element === null || !(frame instanceof HTMLElement) || box === undefined) return;
    const next = placeIn(element, frame, box, cutTo(visibleViewport(), clipsAround(element)), side);
    setPlace((was) => (samePlace(was, next) ? was : next));
  };
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
    document.addEventListener("scroll", again, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", again);
      viewport?.removeEventListener("resize", again);
      viewport?.removeEventListener("scroll", again);
      document.removeEventListener("scroll", again, { capture: true });
    };
  }, [open]);

  const stood = useRef(false);
  useEffect(() => {
    if (mounted) {
      stood.current = true;
    } else if (stood.current) {
      stood.current = false;
      onExited?.();
    }
  }, [mounted, onExited]);

  if (!mounted || (leaving && motionHeld())) return null;
  return (
    <div
      ref={drawn}
      className="ui-rect-float"
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
              ...cssCustomProperties({ "--ui-popover-room": `${place.room}px` }),
            }),
      }}
    >
      {open ? children : last.current}
    </div>
  );
}
