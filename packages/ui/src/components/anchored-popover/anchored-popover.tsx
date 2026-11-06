import { useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { visibleViewport } from "../../visible-viewport.js";
import { clipsAround, cutTo } from "./clip-room.js";
import {
  type Box,
  POPOVER_ALIGN,
  POPOVER_SIDE,
  POPOVER_WIDTH,
  type PopoverAlign,
  type PopoverPlace,
  type PopoverWidth,
  popoverPlace,
  samePlace,
} from "./popover-place.js";
import { type PressAway, usePressAway } from "./press-away.js";

export {
  POPOVER_ALIGN,
  POPOVER_SIDE,
  POPOVER_WIDTH,
  type PopoverAlign,
  type PopoverSide,
  type PopoverWidth,
} from "./popover-place.js";

export const POPOVER_BOUNDS = {
  ROOM: "room",
  WINDOW: "window",
} as const;

export type PopoverBounds = (typeof POPOVER_BOUNDS)[keyof typeof POPOVER_BOUNDS];

const LAYER =
  "ui-anchored-popover absolute z-menu data-[side=above]:bottom-[calc(100%+--spacing(1))] data-[side=below]:top-[calc(100%+--spacing(1))]";

const DEFAULT_WIDTH = 340;

const WIDTH_TOKEN: Record<PopoverWidth, string> = {
  [POPOVER_WIDTH.NARROW]: "--ui-popover-width-narrow",
  [POPOVER_WIDTH.REGULAR]: "--ui-popover-width-regular",
  [POPOVER_WIDTH.WIDE]: "--ui-popover-width-wide",
};

const POPOVER_ROOM = "[data-popover-room]";

function placeStyle(
  align: PopoverAlign,
  inset: number,
  width: number | string,
  room?: number,
): React.CSSProperties {
  const edge = align === POPOVER_ALIGN.START ? { left: inset, width } : { right: inset, width };
  return room === undefined
    ? edge
    : { ...edge, ...cssCustomProperties({ "--ui-popover-room": `${room}px` }) };
}

function markedRoom(element: HTMLElement, bounds: PopoverBounds): Element | null {
  return bounds === POPOVER_BOUNDS.ROOM ? element.closest(POPOVER_ROOM) : null;
}

export function roomAround(
  element: HTMLElement,
  bounds: PopoverBounds,
  clips: readonly HTMLElement[],
): Box {
  const marked = markedRoom(element, bounds)?.getBoundingClientRect();
  const seen = visibleViewport();
  const room = {
    left: Math.max(marked?.left ?? seen.left, seen.left),
    top: Math.max(marked?.top ?? seen.top, seen.top),
    right: Math.min(marked?.right ?? seen.right, seen.right),
    bottom: Math.min(marked?.bottom ?? seen.bottom, seen.bottom),
  };
  return cutTo(room, clips);
}

export function askedStyleWidth(width: number | PopoverWidth): number | string {
  return typeof width === "number" ? width : `var(${WIDTH_TOKEN[width]})`;
}

function askedWidth(layer: HTMLElement, width: number | PopoverWidth): number {
  if (typeof width === "number") return width;
  const token = Number.parseFloat(getComputedStyle(layer).getPropertyValue(WIDTH_TOKEN[width]));
  return Number.isFinite(token) ? token : layer.getBoundingClientRect().width;
}

export function AnchoredPopover({
  open,
  align,
  width = DEFAULT_WIDTH,
  bounds = POPOVER_BOUNDS.ROOM,
  onPressAway,
  holds,
  children,
}: PressAway & {
  open: boolean;
  align: PopoverAlign;
  width?: number | PopoverWidth | undefined;
  bounds?: PopoverBounds | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const layer = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopoverPlace | undefined>(undefined);
  usePressAway(layer, () => layer.current?.parentElement, {
    onPressAway: open ? onPressAway : undefined,
    holds,
  });

  useLayoutEffect(() => {
    if (!open) return;
    const drawn = layer.current;
    const anchor = drawn?.parentElement;
    if (drawn === null || anchor === null || anchor === undefined) return;
    const clips = clipsAround(drawn);
    const measure = () => {
      const next = popoverPlace({
        anchor: anchor.getBoundingClientRect(),
        room: roomAround(anchor, bounds, clips),
        width: askedWidth(drawn, width),
        height: drawn.getBoundingClientRect().height,
        align,
      });
      setPlace((last) => (samePlace(last, next) ? last : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(drawn);
    observer.observe(anchor);
    const room = markedRoom(anchor, bounds);
    if (room !== null) observer.observe(room);
    for (const clip of clips) observer.observe(clip);
    window.addEventListener("resize", measure);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    document.addEventListener("scroll", measure, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      document.removeEventListener("scroll", measure, { capture: true });
    };
  }, [open, align, width, bounds]);

  return (
    <div
      ref={layer}
      className={LAYER}
      data-side={place?.side ?? POPOVER_SIDE.ABOVE}
      data-width={typeof width === "number" ? undefined : width}
      style={
        place === undefined
          ? placeStyle(align, 0, askedStyleWidth(width))
          : placeStyle(align, place.inset, place.width, place.room)
      }
    >
      {children}
    </div>
  );
}
