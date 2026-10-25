import { useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
import { visibleViewport } from "../../visible-viewport.js";
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
 * cut to the window, or else the window; an owner whose layer may hang out
 * of its box, as a tab strip's "+" menu hangs over the column beside the
 * side panel, asks for what is seen of the window alone. It is measured
 * as the layer opens, before it is painted, again whenever the layer, its anchor, its room, or
 * the window resizes, and again whenever anything scrolls, since a scroll
 * moves the anchor inside its room. The layer is held by the anchor's edge
 * it was asked to line up with, so a button that grows or shrinks from its
 * other edge, as the model chip does when Fast comes on, leaves its open
 * menu where it stood rather than throwing it sideways for a frame until
 * the resize is measured. A press outside the layer and its button is
 * handed to the owner, who closes it (`press-away.ts`). A popover asks for its width in pixels or by one
 * of the three names a menu's width is chosen from (`POPOVER_WIDTH`), whose
 * token the layer is drawn at and measured by. An owner that closes its
 * popover through `open` keeps the layer drawn where it last stood, so what
 * it holds fades out in place (`PopoverPanel`'s `open`), while the layer
 * hears no press away and measures nothing until it opens again.
 */

export {
  POPOVER_ALIGN,
  POPOVER_SIDE,
  POPOVER_WIDTH,
  type PopoverAlign,
  type PopoverSide,
  type PopoverWidth,
} from "./popover-place.js";

/** What a popover keeps within: its marked room cut to what is seen of the window, or what is seen of the window alone. */
export const POPOVER_BOUNDS = {
  ROOM: "room",
  WINDOW: "window",
} as const;

export type PopoverBounds = (typeof POPOVER_BOUNDS)[keyof typeof POPOVER_BOUNDS];

/**
 * The layer: over the anchor's neighbours, a small gap above the box that
 * holds the button, or below it where only there is room, its asked edge at
 * the inset and width it was measured to. What it holds draws its own
 * surface. `luke-anchored-popover` names it for what hangs in it.
 */
const LAYER =
  "luke-anchored-popover absolute z-2 data-[side=above]:bottom-[calc(100%+--spacing(1))] data-[side=below]:top-[calc(100%+--spacing(1))]";

/** The width a popover asks for unless its owner asks another, the desktop's searchable menu's own, which the room may narrow. */
const DEFAULT_WIDTH = 340;

/** The token each named width is drawn at. */
const WIDTH_TOKEN: Record<PopoverWidth, string> = {
  [POPOVER_WIDTH.NARROW]: "--luke-popover-width-narrow",
  [POPOVER_WIDTH.REGULAR]: "--luke-popover-width-regular",
  [POPOVER_WIDTH.WIDE]: "--luke-popover-width-wide",
};

/** The box that bounds a popover beside the window's: the desktop's side panel, which marks itself so. */
const POPOVER_ROOM = "[data-popover-room]";

/**
 * The layer's inline place: its asked edge's inset, as `left` or `right`,
 * its width, and, once measured, the height its side leaves it as
 * `--luke-popover-room`, which a popover taller than a menu bounds itself by.
 */
function placeStyle(
  align: PopoverAlign,
  inset: number,
  width: number | string,
  room?: number,
): React.CSSProperties {
  const edge = align === POPOVER_ALIGN.START ? { left: inset, width } : { right: inset, width };
  return room === undefined
    ? edge
    : { ...edge, ...cssCustomProperties({ "--luke-popover-room": `${room}px` }) };
}

/** The box marking the room around `element` where its popover keeps to one, or none. */
function markedRoom(element: HTMLElement, bounds: PopoverBounds): Element | null {
  return bounds === POPOVER_BOUNDS.ROOM ? element.closest(POPOVER_ROOM) : null;
}

/** The room a popover inside `element` may fill: its marked room cut to what can be seen of the window, or that. */
function roomAround(element: HTMLElement, bounds: PopoverBounds): Box {
  const marked = markedRoom(element, bounds)?.getBoundingClientRect();
  const seen = visibleViewport();
  return {
    left: Math.max(marked?.left ?? seen.left, seen.left),
    top: Math.max(marked?.top ?? seen.top, seen.top),
    right: Math.min(marked?.right ?? seen.right, seen.right),
    bottom: Math.min(marked?.bottom ?? seen.bottom, seen.bottom),
  };
}

/** The width asked for before it is measured: its pixels, or its token's. */
export function askedStyleWidth(width: number | PopoverWidth): number | string {
  return typeof width === "number" ? width : `var(${WIDTH_TOKEN[width]})`;
}

/**
 * The pixels `width` asks for: its own, or what its token holds where the
 * layer is drawn. Note that a token no sheet sets, as under a test with no
 * stylesheet, is read off the layer as it is laid out instead.
 */
function askedWidth(layer: HTMLElement, width: number | PopoverWidth): number {
  if (typeof width === "number") return width;
  const token = Number.parseFloat(getComputedStyle(layer).getPropertyValue(WIDTH_TOKEN[width]));
  return Number.isFinite(token) ? token : layer.getBoundingClientRect().width;
}

/**
 * The layer itself, at the menu's width where the room allows it. Note that it is
 * placed in a layout effect and never hidden while unplaced, because the
 * placing lands before the first paint, and a hidden layer would refuse
 * the focus its popover takes as it mounts.
 */
export function AnchoredPopover({
  open,
  align,
  width = DEFAULT_WIDTH,
  bounds = POPOVER_BOUNDS.ROOM,
  onPressAway,
  holds,
  children,
}: PressAway & {
  /** Whether what it holds stands open; closed, the layer stays where it stood while that fades. */
  open: boolean;
  align: PopoverAlign;
  /** The width it asks for, in pixels or by name, a form's wider than a menu's. */
  width?: number | PopoverWidth | undefined;
  /** What it keeps within: its marked room unless its owner asks for the window. */
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
    const measure = () => {
      const next = popoverPlace({
        anchor: anchor.getBoundingClientRect(),
        room: roomAround(anchor, bounds),
        width: askedWidth(drawn, width),
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
    const room = markedRoom(anchor, bounds);
    if (room !== null) observer.observe(room);
    window.addEventListener("resize", measure);
    // Note that the visual viewport is heard too, because a phone's keyboard
    // rising under a popover's field shrinks what is seen without resizing
    // the window.
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    // Note that a scroll is heard while it is captured, because a scroll
    // does not bubble and the scroller that moved the anchor may be any box
    // around it.
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
