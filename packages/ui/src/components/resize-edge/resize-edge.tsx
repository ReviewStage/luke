import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const RESIZE_EDGE_SIDE = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type ResizeEdgeSide = (typeof RESIZE_EDGE_SIDE)[keyof typeof RESIZE_EDGE_SIDE];

const EDGE_SNAP = {
  NONE: "none",
  COLLAPSE: "collapse",
  EXPAND: "expand",
} as const;

type EdgeSnap = (typeof EDGE_SNAP)[keyof typeof EDGE_SNAP];

const COLLAPSE_OVERSHOOT = 80;

const EXPAND_OVERSHOOT = 160;

const SNAP_HYSTERESIS = 24;

const EDGE_DRAG_ATTRIBUTE = "data-edge-drag";

const KEY_STEP = 16;

interface EdgeBounds {
  readonly MIN: number;
  readonly MAX?: number;
  readonly DEFAULT: number;
}

export interface ResizeEdgeOptions {
  side: ResizeEdgeSide;
  width: number;
  bounds: EdgeBounds;
  reserve: (container: HTMLElement) => number;
  label: string;
  onResize: (width: number) => void;
  onToggleCollapsed?: (() => void) | undefined;
  onToggleExpanded?: (() => void) | undefined;
}

export interface ResizeEdgeHandle {
  kept: number;
  greatest: number | undefined;
  roomOf: (edge: HTMLElement) => number | undefined;
  "data-side": ResizeEdgeSide;
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  "aria-valuemin": number;
  tabIndex: 0;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}

interface Drag {
  pointerId: number;
  x: number;
  from: number;
  kept: number;
  max: number;
  snap: EdgeSnap;
}

function roomFor(edge: HTMLElement, options: ResizeEdgeOptions): number {
  const { bounds } = options;
  const own = bounds.MAX ?? Number.POSITIVE_INFINITY;
  const container = edge.parentElement?.parentElement;
  const room = container?.getBoundingClientRect().width ?? 0;
  if (container == null || room <= 0) return own;
  return Math.max(bounds.MIN, Math.min(own, Math.round(room - options.reserve(container))));
}

function snapFor(asked: number, drag: Drag, options: ResizeEdgeOptions): EdgeSnap {
  const give = (snap: EdgeSnap) => (drag.snap === snap ? SNAP_HYSTERESIS : 0);
  const shutBelow = options.bounds.MIN - COLLAPSE_OVERSHOOT + give(EDGE_SNAP.COLLAPSE);
  const growAbove = drag.max + EXPAND_OVERSHOOT - give(EDGE_SNAP.EXPAND);
  if (options.onToggleCollapsed !== undefined && asked < shutBelow) return EDGE_SNAP.COLLAPSE;
  if (options.onToggleExpanded !== undefined && asked > growAbove) return EDGE_SNAP.EXPAND;
  return EDGE_SNAP.NONE;
}

function askedWidth(drag: Drag, x: number, side: ResizeEdgeSide): number {
  const moved = side === RESIZE_EDGE_SIDE.LEFT ? drag.x - x : x - drag.x;
  return drag.from + moved;
}

function toggleSnap(snap: EdgeSnap, options: ResizeEdgeOptions): void {
  if (snap === EDGE_SNAP.COLLAPSE) options.onToggleCollapsed?.();
  if (snap === EDGE_SNAP.EXPAND) options.onToggleExpanded?.();
}

function follow(drag: Drag, x: number, options: ResizeEdgeOptions): void {
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

function keyedWidth(
  key: string,
  width: number,
  max: number,
  options: ResizeEdgeOptions,
): number | undefined {
  const widens = options.side === RESIZE_EDGE_SIDE.LEFT ? "ArrowLeft" : "ArrowRight";
  const narrows = options.side === RESIZE_EDGE_SIDE.LEFT ? "ArrowRight" : "ArrowLeft";
  if (key === widens) return width + KEY_STEP;
  if (key === narrows) return width - KEY_STEP;
  if (key === "Home") return options.bounds.MIN;
  if (key === "End") return max;
  if (key === "Enter") return options.bounds.DEFAULT;
  return undefined;
}

export function useResizeEdge(options: ResizeEdgeOptions): ResizeEdgeHandle {
  const { bounds, width, onResize } = options;
  const latest = useRef(options);
  const drag = useRef<Drag | undefined>(undefined);
  const release = useRef<(() => void) | undefined>(undefined);

  useLayoutEffect(() => {
    latest.current = options;
  });
  useEffect(() => () => release.current?.(), []);

  const roomOf = useCallback((edge: HTMLElement) => {
    const max = roomFor(edge, latest.current);
    return Number.isFinite(max) ? max : undefined;
  }, []);

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
    const move = (moved: PointerEvent) => {
      if (moved.pointerId === pointerId) follow(held, moved.clientX, latest.current);
    };
    const end = (ended: PointerEvent) => {
      if (ended.pointerId !== pointerId) return;
      release.current?.();
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
    kept: width,
    greatest: bounds.MAX,
    roomOf,
    "data-side": options.side,
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": options.label,
    "aria-valuemin": bounds.MIN,
    tabIndex: 0,
    onPointerDown: (event) => {
      if (event.button !== 0 || drag.current !== undefined) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      begin(event, roomFor(event.currentTarget, options));
    },
    onDoubleClick: () => onResize(bounds.DEFAULT),
    onKeyDown: (event) => {
      const max = roomFor(event.currentTarget, options);
      const asked = keyedWidth(event.key, Math.min(width, max), max, options);
      if (asked === undefined) return;
      event.preventDefault();
      onResize(Math.min(max, Math.max(bounds.MIN, asked)));
    },
  };
}

export function ResizeEdge({ edge }: { edge: ResizeEdgeHandle }): React.JSX.Element {
  const { kept, greatest, roomOf, ...drawn } = edge;
  const [room, setRoom] = useState<number | undefined>(undefined);
  const measure = useCallback(
    (element: HTMLElement | null) => {
      const container = element?.parentElement?.parentElement;
      if (element == null || container == null) return undefined;
      const observer = new ResizeObserver(() => setRoom(roomOf(element)));
      observer.observe(container);
      return () => observer.disconnect();
    },
    [roomOf],
  );
  const valueMax = room ?? greatest;
  const range = {
    "aria-valuemax": valueMax,
    "aria-valuenow": Math.min(kept, valueMax ?? kept),
  };
  return <div ref={measure} className="ui-resize-edge" {...drawn} {...range} />;
}
