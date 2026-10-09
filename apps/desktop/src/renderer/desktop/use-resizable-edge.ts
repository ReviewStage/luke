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
 * on far enough to mean more than the bound: then the pane snaps there and
 * then, shut past its least width or to the whole window past its greatest,
 * and a drag that comes back undoes the snap as it crosses again, as VS
 * Code's and ChatGPT's panes do. The whole window asks the longer pull of
 * the two. A release leaves the pane however the drag
 * left it. Note that the hook is called by whoever outlives the pane, because
 * a drag that shuts the pane takes its edge away and must still hear the
 * pointer coming back.
 */

import type React from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

/** Which side of its pane the edge stands on: the side panel's left, the sidebar's right. */
export const EDGE_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

type EdgeSide = (typeof EDGE_SIDE)[keyof typeof EDGE_SIDE];

/** Where a drag has taken the pane past its bounds. */
const EDGE_SNAP = {
  /** Within them: the pane takes the width the drag asks for. */
  NONE: "none",
  /** Shut. */
  COLLAPSE: "collapse",
  /** Grown over the window's work. */
  EXPAND: "expand",
} as const;

type EdgeSnap = (typeof EDGE_SNAP)[keyof typeof EDGE_SNAP];

/**
 * How far past the least width, in CSS pixels, the pointer goes before the
 * pane shuts rather than holds there. Far enough that a drag to the bound that
 * overshoots by a hand's tremor still lands on it, near enough that a
 * deliberate fling does not run out of window.
 */
const COLLAPSE_OVERSHOOT = 80;

/**
 * How far past the greatest width, in CSS pixels, the pointer goes before the
 * pane grows over the window. Twice the way to shut it, because filling the
 * window covers the work beside the pane rather than giving it room, so a
 * drag that only meant to leave that work at its least must not reach it.
 */
const EXPAND_OVERSHOOT = 160;

/**
 * How far back past the snap's own threshold, in CSS pixels, the pointer
 * comes before a snap the drag holds lets go, so a pointer resting on the
 * threshold does not flicker the pane open and shut.
 */
const SNAP_HYSTERESIS = 24;

/** What the document's root wears while a drag lasts; desktop.css draws the resize cursor everywhere under it. */
const EDGE_DRAG_ATTRIBUTE = "data-edge-drag";

/** How far one arrow press moves the edge, in CSS pixels. */
const KEY_STEP = 16;

/**
 * A pane's widths, in CSS pixels: the least and greatest it is dragged to, and
 * the one a reset gives it. A pane with no greatest width of its own is held
 * only by the reserve its neighbour keeps.
 */
interface EdgeBounds {
  readonly MIN: number;
  readonly MAX?: number;
  readonly DEFAULT: number;
}

export interface ResizableEdgeOptions {
  side: EdgeSide;
  /** The pane's width as its owner keeps it. */
  width: number;
  bounds: EdgeBounds;
  /**
   * What the pane leaves its neighbour in the container they share, read from
   * that container as a drag or a key press begins: the pane is dragged no
   * wider than the container less this, whatever its own bound says, so the
   * column beside it stays readable.
   */
  reserve: (container: HTMLElement) => number;
  label: string;
  onResize: (width: number) => void;
  /** Shuts the pane, or opens it again. Without it a drag past the least width holds there. */
  onToggleCollapsed?: (() => void) | undefined;
  /** Grows the pane over the window's work, or brings it back. Without it a drag past the greatest width holds there. */
  onToggleExpanded?: (() => void) | undefined;
}

/** What the edge's element is spread with. */
export interface ResizableEdgeProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number | undefined;
  "aria-valuenow": number;
  tabIndex: 0;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/**
 * A drag under way: the pointer making it, where it began, the width the pane
 * was drawn at and the one its owner kept (wider where the window held it
 * narrower), the greatest width the pane could take when it began, and the
 * snap it holds the pane in now.
 */
interface Drag {
  pointerId: number;
  x: number;
  from: number;
  kept: number;
  max: number;
  snap: EdgeSnap;
}

/**
 * The greatest width the pane can take in the container it stands in now: its
 * own bound, where it has one, and no wider than the container less the
 * reserve. A container that measures nothing is not laid out, so only the
 * pane's own bound stands.
 */
function roomFor(edge: HTMLElement, options: ResizableEdgeOptions): number {
  const { bounds } = options;
  const own = bounds.MAX ?? Number.POSITIVE_INFINITY;
  const container = edge.parentElement?.parentElement;
  const room = container?.getBoundingClientRect().width ?? 0;
  if (container == null || room <= 0) return own;
  return Math.max(bounds.MIN, Math.min(own, Math.round(room - options.reserve(container))));
}

/** The snap a width the pointer asks for earns, given the one the drag holds. */
function snapFor(asked: number, drag: Drag, options: ResizableEdgeOptions): EdgeSnap {
  const give = (snap: EdgeSnap) => (drag.snap === snap ? SNAP_HYSTERESIS : 0);
  const shutBelow = options.bounds.MIN - COLLAPSE_OVERSHOOT + give(EDGE_SNAP.COLLAPSE);
  const growAbove = drag.max + EXPAND_OVERSHOOT - give(EDGE_SNAP.EXPAND);
  if (options.onToggleCollapsed !== undefined && asked < shutBelow) return EDGE_SNAP.COLLAPSE;
  if (options.onToggleExpanded !== undefined && asked > growAbove) return EDGE_SNAP.EXPAND;
  return EDGE_SNAP.NONE;
}

/** The width the pane asks for when the pointer stands at `x`, by how far it has come and which way widens. */
function askedWidth(drag: Drag, x: number, side: EdgeSide): number {
  const moved = side === EDGE_SIDE.LEFT ? drag.x - x : x - drag.x;
  return drag.from + moved;
}

/** Toggles the pane into or out of one snap. */
function toggleSnap(snap: EdgeSnap, options: ResizableEdgeOptions): void {
  if (snap === EDGE_SNAP.COLLAPSE) options.onToggleCollapsed?.();
  if (snap === EDGE_SNAP.EXPAND) options.onToggleExpanded?.();
}

/**
 * Moves the drag to `x`: the pane leaves the snap it held and takes the one
 * the pointer has reached, or between its bounds takes the width asked for.
 * A snap leaves the width as the drag drew it, so the pane shuts or grows
 * from where it stood.
 */
function follow(drag: Drag, x: number, options: ResizableEdgeOptions): void {
  const asked = askedWidth(drag, x, options.side);
  const snap = snapFor(asked, drag, options);
  if (snap !== drag.snap) {
    toggleSnap(drag.snap, options);
    toggleSnap(snap, options);
    drag.snap = snap;
  }
  if (snap === EDGE_SNAP.NONE) {
    options.onResize(Math.min(drag.max, Math.max(options.bounds.MIN, asked)));
  }
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
 * The edge's drag and its keys. The pointer is captured on press, so a drag
 * that crosses the board's canvas or leaves the window is still the edge's,
 * and the drag is heard at the window rather than the edge, so it outlives
 * an edge its own snap took away. While it lasts the whole window wears the
 * resize cursor and selects no text.
 */
export function useResizableEdge(options: ResizableEdgeOptions): ResizableEdgeProps {
  const { bounds, width, onResize } = options;
  const latest = useRef(options);
  const drag = useRef<Drag | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => () => release.current?.(), []);

  const begin = (event: React.PointerEvent<HTMLElement>, max: number) => {
    const { pointerId } = event;
    const held: Drag = {
      pointerId,
      x: event.clientX,
      from: Math.min(width, max),
      kept: width,
      max,
      snap: EDGE_SNAP.NONE,
    };
    // Note that only the pointer that began the drag moves or ends it, so a
    // second finger on the trackpad cannot take the drag over.
    const move = (moved: PointerEvent) => {
      if (moved.pointerId === pointerId) follow(held, moved.clientX, latest.current);
    };
    const end = (ended: PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      release.current?.();
      // A snap keeps the width the pane had before the drag, so opening it
      // again or leaving the whole window gives back the pane the developer had.
      if (held.snap !== EDGE_SNAP.NONE) latest.current.onResize(held.kept);
    };
    drag.current = held;
    document.documentElement.setAttribute(EDGE_DRAG_ATTRIBUTE, "true");
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    release.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      document.documentElement.removeAttribute(EDGE_DRAG_ATTRIBUTE);
      drag.current = undefined;
      release.current = undefined;
    };
  };

  return {
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
      begin(event, roomFor(event.currentTarget, options));
    },
    onDoubleClick: () => onResize(bounds.DEFAULT),
    onKeyDown: (event) => {
      // The keys move the pane the window draws, held to the same room a drag is.
      const max = roomFor(event.currentTarget, options);
      const asked = keyedWidth(event.key, Math.min(width, max), max, options);
      if (asked === undefined) return;
      event.preventDefault();
      onResize(Math.min(max, Math.max(bounds.MIN, asked)));
    },
  };
}
