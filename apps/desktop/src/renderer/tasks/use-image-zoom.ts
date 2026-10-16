/**
 * use-image-zoom.ts -- a picture in the attachment viewer zoomed and moved about as Preview's is: a pinch, a press, or a key zooms it, and a drag or a two-finger scroll moves it while it is zoomed.
 *
 * The view itself, and what each gesture makes of it, is `@luke/ui/image-zoom`'s;
 * this measures the frame and the fitted picture as each gesture lands and
 * hands them in. A pinch on the trackpad reaches the page as a scroll with
 * Control held, which is how Chromium tells one, and a mouse's Control-scroll
 * zooms the same. The view is drawn as a transform on the picture, so the
 * frame's layout never changes under it. A change from a press or a key
 * glides, while one following the fingers or the pointer lands at once,
 * because a glide behind a gesture would trail it.
 */

import {
  FITTED_VIEW,
  type FramePoint,
  type ImageFrame,
  type ImageView,
  isZoomed,
  pannedBy,
  pressedAt,
  zoomedByStep,
  zoomedByWheel,
} from "@luke/ui/image-zoom";
import { useCallback, useRef, useState } from "react";

/** How far a press may wander, in pixels, and still be a press rather than a drag. */
const PRESS_SLACK_PX = 4;

/** The keys that zoom, bare of any modifier: in, out, and back to fitted. */
const ZOOM_KEY = {
  IN: new Set(["=", "+"]),
  OUT: new Set(["-", "_"]),
  FIT: "0",
} as const;

/** A press on the picture while it is held: where it began and where the pointer was last. */
interface Press {
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  moved: boolean;
}

/** What a wheel's delta counts, as its `deltaMode` says: pixels, lines, or pages. */
const WHEEL_DELTA = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2,
} as const;

/** The CSS pixels a wheel's line stands for. */
const WHEEL_LINE_PX = 16;

/** The view of the picture `subject` names, and whether it glides to it from the last. */
interface Shown {
  readonly subject: string;
  readonly view: ImageView;
  readonly glide: boolean;
}

/** What the viewer wears to zoom the picture it draws. */
export interface ImageZoom {
  /** Whether the picture is zoomed past fitted. */
  readonly zoomed: boolean;
  /** The frame the picture is drawn in, which hears the pinch and the scroll. */
  readonly frameRef: (element: HTMLDivElement | null) => (() => void) | undefined;
  /** What the picture itself wears: its element, its transform, and its presses and drags. */
  readonly imageProps: React.ImgHTMLAttributes<HTMLImageElement> & {
    ref: React.RefObject<HTMLImageElement | null>;
    "data-zoom": string;
    "data-glide": string;
  };
  /** Zooms one step in (`1`) or out (`-1`) about the frame's centre. */
  readonly step: (direction: 1 | -1) => void;
  /** Zooms on a bare `=`, `+`, `-`, or `0`, and answers whether the key was one. */
  readonly keyDown: (event: React.KeyboardEvent) => boolean;
}

/** The frame and the picture fitted in it, as laid out now; none where no picture is drawn yet. */
function measured(
  frame: HTMLElement | null,
  image: HTMLImageElement | null,
): ImageFrame | undefined {
  if (frame === null || image === null || image.offsetWidth === 0) return undefined;
  return {
    frame: { width: frame.clientWidth, height: frame.clientHeight },
    fitted: { width: image.offsetWidth, height: image.offsetHeight },
  };
}

/** A wheel's delta in CSS pixels, whatever its `deltaMode` counts: a page is the frame's height. */
function wheelPixels(event: WheelEvent, delta: number, frame: HTMLElement): number {
  if (event.deltaMode === WHEEL_DELTA.LINE) return delta * WHEEL_LINE_PX;
  if (event.deltaMode === WHEEL_DELTA.PAGE) return delta * frame.clientHeight;
  return delta;
}

/** Whether two views draw the picture alike. */
function sameView(first: ImageView, second: ImageView): boolean {
  return first.scale === second.scale && first.x === second.x && first.y === second.y;
}

/** Where a pointer at `clientX`, `clientY` stands from the frame's centre. */
function pointIn(frame: HTMLElement, clientX: number, clientY: number): FramePoint {
  const box = frame.getBoundingClientRect();
  return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
}

/**
 * The zoom of the picture `subject` names, fitted until a gesture says
 * otherwise. Note that the zoom belongs to the picture rather than to its
 * place among the files, so another picture shown, however it came to be,
 * opens fitted, and the same picture moved along the files as an earlier one
 * lands keeps its zoom.
 */
export function useImageZoom(subject: string): ImageZoom {
  const [stored, setShown] = useState<Shown>({ subject, view: FITTED_VIEW, glide: false });
  const shown: Shown =
    stored.subject === subject ? stored : { subject, view: FITTED_VIEW, glide: false };
  const frame = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const press = useRef<Press | undefined>(undefined);

  // Note that every change measures the frame as it lands, because the
  // window may have changed size since the last one.
  const change = useCallback(
    (glide: boolean, next: (view: ImageView, sizes: ImageFrame) => ImageView) => {
      const sizes = measured(frame.current, image.current);
      if (sizes === undefined) return;
      setShown((last) => {
        const from = last.subject === subject ? last.view : FITTED_VIEW;
        const view = next(from, sizes);
        // A change that moves nothing, a resize's or a scroll's on a fitted picture, draws nothing.
        return last.subject === subject && sameView(view, from) ? last : { subject, view, glide };
      });
    },
    [subject],
  );

  // Note that the scroll is heard on the element itself rather than through
  // React, because React's own wheel listener is passive and could not keep
  // a pinch from reaching the window.
  const frameRef = useCallback(
    (element: HTMLDivElement | null) => {
      frame.current = element;
      if (element === null) return undefined;
      const wheel = (event: WheelEvent) => {
        const at = pointIn(element, event.clientX, event.clientY);
        const dx = wheelPixels(event, event.deltaX, element);
        const dy = wheelPixels(event, event.deltaY, element);
        if (event.ctrlKey) {
          event.preventDefault();
          change(false, (view, sizes) => zoomedByWheel(view, sizes, dy, at));
          return;
        }
        change(false, (view, sizes) => pannedBy(view, sizes, -dx, -dy));
      };
      // A frame or a fitted picture resized holds the picture's edges to the frame's again.
      const resized = new ResizeObserver(() =>
        change(false, (view, sizes) => pannedBy(view, sizes, 0, 0)),
      );
      resized.observe(element);
      if (image.current !== null) resized.observe(image.current);
      element.addEventListener("wheel", wheel, { passive: false });
      return () => {
        resized.disconnect();
        element.removeEventListener("wheel", wheel);
      };
    },
    [change],
  );

  const step = (direction: 1 | -1) =>
    change(true, (view, sizes) => zoomedByStep(view, sizes, direction));

  const keyDown = (event: React.KeyboardEvent): boolean => {
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (ZOOM_KEY.IN.has(event.key)) step(1);
    else if (ZOOM_KEY.OUT.has(event.key)) step(-1);
    else if (event.key === ZOOM_KEY.FIT) change(true, () => FITTED_VIEW);
    else return false;
    return true;
  };

  const { view, glide } = shown;
  return {
    zoomed: isZoomed(view),
    frameRef,
    imageProps: {
      ref: image,
      draggable: false,
      style: {
        transform: `translate(${String(view.x)}px, ${String(view.y)}px) scale(${String(view.scale)})`,
      },
      "data-zoom": isZoomed(view) ? "zoomed" : "fitted",
      "data-glide": String(glide),
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        press.current = {
          startX: event.clientX,
          startY: event.clientY,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      },
      onPointerMove: (event) => {
        const held = press.current;
        if (held === undefined || (event.buttons & 1) === 0) return;
        const dx = event.clientX - held.x;
        const dy = event.clientY - held.y;
        held.x = event.clientX;
        held.y = event.clientY;
        const wandered = Math.hypot(event.clientX - held.startX, event.clientY - held.startY);
        if (wandered > PRESS_SLACK_PX) held.moved = true;
        change(false, (last, sizes) => pannedBy(last, sizes, dx, dy));
      },
      onClick: (event) => {
        const held = press.current;
        press.current = undefined;
        // A drag that ends on the picture moved it, and is no press.
        if (held?.moved === true || frame.current === null) return;
        const at = pointIn(frame.current, event.clientX, event.clientY);
        const natural = {
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        };
        change(true, (last, sizes) => pressedAt(last, sizes, natural, at));
      },
    },
    step,
    keyDown,
  };
}
