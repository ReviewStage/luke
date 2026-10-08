/**
 * use-resizable-edge.ts -- the edge a pane is resized by: dragged between its bounds, snapped shut or to the whole window past them, reset by a double-click, and stepped from the keyboard.
 *
 * A pane hands this its width, its bounds, and what to do with a new width,
 * and spreads what comes back onto the element it draws as its edge, a
 * focusable separator that is the pane's own child. The edge decides nothing
 * the pane keeps: every width and every snap is handed back to the pane's
 * owner, so the window's two resizable panes (the plan's side panel at the
 * right, the sidebar at the left) drag alike and keep their widths their own
 * ways.
 *
 * A drag past a bound holds the pane at that bound until the pointer has gone
 * on far enough to mean more than the bound: then the pane snaps, shut past
 * its least width or to the whole window past its greatest. The pending snap
 * is answered while the drag lasts, so the pane can draw it before the
 * release commits it.
 */

import type React from "react";
import { useRef, useState } from "react";

/** Which side of its pane the edge stands on: the side panel's left, the sidebar's right. */
export const EDGE_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

type EdgeSide = (typeof EDGE_SIDE)[keyof typeof EDGE_SIDE];

/** What a release would do to the pane, as the drag stands. */
export const EDGE_SNAP = {
  /** Keep the width the drag reached. */
  NONE: "none",
  /** Close the pane, its width kept as it was before the drag. */
  COLLAPSE: "collapse",
  /** Grow the pane over the window's work, its width kept as it was before the drag. */
  EXPAND: "expand",
} as const;

type EdgeSnap = (typeof EDGE_SNAP)[keyof typeof EDGE_SNAP];

/**
 * How far past a bound, in CSS pixels, the pointer goes before a release
 * snaps rather than holds at the bound. Far enough that a drag to the bound
 * that overshoots by a hand's tremor still lands on it, near enough that a
 * deliberate fling does not run out of window.
 */
const SNAP_OVERSHOOT = 80;

/** How far one arrow press moves the edge, in CSS pixels. */
const KEY_STEP = 16;

/** A pane's widths, in CSS pixels: the least and greatest it is dragged to, and the one a reset gives it. */
interface EdgeBounds {
  readonly MIN: number;
  readonly MAX: number;
  readonly DEFAULT: number;
}

export interface ResizableEdgeOptions {
  side: EdgeSide;
  /** The pane's width as its owner keeps it. */
  width: number;
  bounds: EdgeBounds;
  /**
   * What the pane leaves its neighbour in the container they share: the pane
   * is dragged no wider than the container less this, whatever its own bound
   * says, so the column beside it stays readable.
   */
  reserve: number;
  label: string;
  onResize: (width: number) => void;
  /** Closes the pane. Without it a drag past the least width holds there. */
  onCollapse?: (() => void) | undefined;
  /** Grows the pane over the window's work. Without it a drag past the greatest width holds there. */
  onExpand?: (() => void) | undefined;
}

/** What the edge's element is spread with. */
export interface ResizableEdgeProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: 0;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

export interface ResizableEdge {
  /** What releasing the drag under way would do, or {@link EDGE_SNAP.NONE} with no drag. */
  snap: EdgeSnap;
  edge: ResizableEdgeProps;
}

/**
 * A drag under way: the pointer making it, where it began, the width the pane
 * was drawn at and the one its owner kept (wider where the window held it
 * narrower), and the greatest width the pane could take when it began.
 */
interface Drag {
  pointerId: number;
  x: number;
  from: number;
  kept: number;
  max: number;
}

/**
 * The greatest width the pane can take in the container it stands in now.
 * A container that measures nothing is not laid out, so its pane's own bound
 * stands.
 */
function roomFor(edge: HTMLElement, bounds: EdgeBounds, reserve: number): number {
  const container = edge.parentElement?.parentElement;
  const room = container?.getBoundingClientRect().width ?? 0;
  if (room <= 0) return bounds.MAX;
  return Math.max(bounds.MIN, Math.min(bounds.MAX, Math.round(room - reserve)));
}

/** The snap a width the pointer asks for would earn on release. */
function snapFor(asked: number, min: number, max: number, options: ResizableEdgeOptions): EdgeSnap {
  if (options.onCollapse !== undefined && asked < min - SNAP_OVERSHOOT) return EDGE_SNAP.COLLAPSE;
  if (options.onExpand !== undefined && asked > max + SNAP_OVERSHOOT) return EDGE_SNAP.EXPAND;
  return EDGE_SNAP.NONE;
}

/** The width the pane asks for when the pointer stands at `x`, by how far it has come and which way widens. */
function askedWidth(drag: Drag, x: number, side: EdgeSide): number {
  const moved = side === EDGE_SIDE.LEFT ? drag.x - x : x - drag.x;
  return drag.from + moved;
}

/** The width one key press asks for, or nothing where the key is not the edge's. */
function keyedWidth(
  key: string,
  width: number,
  max: number,
  options: ResizableEdgeOptions,
): number | undefined {
  // Note that the arrow pointing away from the pane widens it, because that
  // is the way the edge moves.
  const widens = options.side === EDGE_SIDE.LEFT ? "ArrowLeft" : "ArrowRight";
  const narrows = options.side === EDGE_SIDE.LEFT ? "ArrowRight" : "ArrowLeft";
  if (key === widens) return width + KEY_STEP;
  if (key === narrows) return width - KEY_STEP;
  if (key === "Home") return options.bounds.MIN;
  if (key === "End") return max;
  if (key === "Enter") return options.bounds.DEFAULT;
  return undefined;
}

/**
 * The edge's drag, its pending snap, and its keys. The pointer is captured on
 * press, so a drag that crosses the board's canvas or leaves the window is
 * still the edge's.
 */
export function useResizableEdge(options: ResizableEdgeOptions): ResizableEdge {
  const { bounds, width, onResize } = options;
  const drag = useRef<Drag | undefined>(undefined);
  const [snap, setSnap] = useState<EdgeSnap>(EDGE_SNAP.NONE);

  // Note that only the pointer that began the drag moves or ends it, so a
  // second finger on the trackpad cannot take the drag over.
  const end = (pointerId: number): Drag | undefined => {
    const ended = drag.current;
    if (ended?.pointerId !== pointerId) return undefined;
    drag.current = undefined;
    setSnap(EDGE_SNAP.NONE);
    return ended;
  };

  const edge: ResizableEdgeProps = {
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": options.label,
    "aria-valuemin": bounds.MIN,
    "aria-valuemax": bounds.MAX,
    "aria-valuenow": width,
    tabIndex: 0,
    onPointerDown: (event) => {
      if (event.button !== 0 || drag.current !== undefined) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      // The drag starts from the width the pane is drawn at, which the window
      // may hold narrower than the one kept.
      const max = roomFor(event.currentTarget, bounds, options.reserve);
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        from: Math.min(width, max),
        kept: width,
        max,
      };
    },
    onPointerMove: (event) => {
      const held = drag.current;
      if (held?.pointerId !== event.pointerId) return;
      const asked = askedWidth(held, event.clientX, options.side);
      setSnap(snapFor(asked, bounds.MIN, held.max, options));
      onResize(Math.min(held.max, Math.max(bounds.MIN, asked)));
    },
    onPointerUp: (event) => {
      const held = end(event.pointerId);
      if (held === undefined) return;
      const snapped = snapFor(
        askedWidth(held, event.clientX, options.side),
        bounds.MIN,
        held.max,
        options,
      );
      if (snapped === EDGE_SNAP.NONE) return;
      // A snap keeps the width the pane had before the drag, so reopening it
      // or leaving the whole window gives back the pane the developer had.
      onResize(held.kept);
      if (snapped === EDGE_SNAP.COLLAPSE) options.onCollapse?.();
      else options.onExpand?.();
    },
    onPointerCancel: (event) => {
      const held = end(event.pointerId);
      if (held !== undefined) onResize(held.kept);
    },
    onDoubleClick: () => onResize(bounds.DEFAULT),
    onKeyDown: (event) => {
      // The keys move the pane the window draws, held to the same room a drag is.
      const max = roomFor(event.currentTarget, bounds, options.reserve);
      const asked = keyedWidth(event.key, Math.min(width, max), max, options);
      if (asked === undefined) return;
      event.preventDefault();
      onResize(Math.min(max, Math.max(bounds.MIN, asked)));
    },
  };
  return { snap, edge };
}
