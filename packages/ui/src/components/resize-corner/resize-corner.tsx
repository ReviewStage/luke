/**
 * resize-corner.tsx -- a bracket on a box's top corner, dragged or stepped from the keyboard to grow or shrink the box from that side.
 *
 * A `ResizeFrame` stands around the box and shows its corners while it is
 * revealed (under the pointer, mid-drag) or while the keyboard is on one. A
 * corner is a vertical slider over one number, the box's height: dragging
 * hands the owner the height the drag began at plus what `growth` makes of
 * the pointer's travel, and ↑ or → grows it a `step`, ↓ or ← shrinks it,
 * Home and End take it to its ends. The owner holds the number and its
 * bounds, so every value handed to `onResize` is for the owner to clamp.
 */

import { type ReactNode, useRef } from "react";

/** Which top corner of the box a handle stands on. */
export const RESIZE_CORNER = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type ResizeCornerSide = (typeof RESIZE_CORNER)[keyof typeof RESIZE_CORNER];

/** The pointer's travel from where a drag began, in CSS pixels, rightward and downward positive. */
export interface ResizeTravel {
  x: number;
  y: number;
}

/** A drag under way on a corner: the pointer making it, where it began, and the value the box stood at. */
interface CornerDrag {
  pointerId: number;
  x: number;
  y: number;
  from: number;
}

/** The box's frame: it holds the box and its corners, and shows the corners while `reveal` or while one has the keyboard. */
export function ResizeFrame({
  reveal,
  children,
}: {
  reveal: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-resize-frame" data-reveal={String(reveal)}>
      {children}
    </div>
  );
}

/** One top corner's handle over `value` between `min` and `max`, named by `label`. */
export function ResizeCorner({
  corner,
  label,
  value,
  min,
  max,
  step,
  growth,
  onResize,
  onDragging,
}: {
  corner: ResizeCornerSide;
  /** What the handle does, for a reader ("Resize video from its top-left corner"). */
  label: string;
  value: number;
  min: number;
  max: number;
  /** How far one arrow press moves the value. */
  step: number;
  /** How much a pointer's travel grows the value, from the corner's own side. */
  growth: (travel: ResizeTravel) => number;
  onResize: (value: number) => void;
  onDragging: (dragging: boolean) => void;
}): React.JSX.Element {
  const drag = useRef<CornerDrag | undefined>(undefined);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, from: value };
    onDragging(true);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (held === undefined || held.pointerId !== event.pointerId) return;
    onResize(held.from + growth({ x: event.clientX - held.x, y: event.clientY - held.y }));
  };
  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = undefined;
    onDragging(false);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const asked =
      event.key === "ArrowUp" || event.key === "ArrowRight"
        ? value + step
        : event.key === "ArrowDown" || event.key === "ArrowLeft"
          ? value - step
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : undefined;
    if (asked === undefined) return;
    event.preventDefault();
    onResize(asked);
  };
  return (
    <div
      className="luke-resize-corner"
      data-corner={corner}
      role="slider"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    />
  );
}
