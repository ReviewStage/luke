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
  type ImageSize,
  type ImageView,
  isZoomed,
  pannedBy,
  pressedAt,
  zoomedByStep,
  zoomedByWheel,
  zoomedTo,
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
  readonly pointerId: number;
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

/** Where a pointer on the frame stood last, in the page's pixels. */
interface Spot {
  readonly x: number;
  readonly y: number;
}

/** How the picture is first drawn: fitted to the frame, or at its own pixels from its top left corner, as a diagram too fine to read fitted opens. */
export const IMAGE_OPENING = {
  FITTED: "fitted",
  OWN_PIXELS: "own-pixels",
} as const;

export type ImageOpening = (typeof IMAGE_OPENING)[keyof typeof IMAGE_OPENING];

/** The CSS pixels a wheel's line stands for. */
const WHEEL_LINE_PX = 16;

/** The picture a view is of: its file's name and its address, since two files may hold the same bytes. */
interface Subject {
  readonly name: string;
  readonly url: string;
}

/** The view of the picture `subject` names, and whether it glides to it from the last. */
interface Shown {
  readonly subject: Subject;
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

/** A wheel's delta in CSS pixels, whatever its `deltaMode` counts: a page is the frame's own length along the delta's axis, `page`. */
function wheelPixels(event: WheelEvent, delta: number, page: number): number {
  if (event.deltaMode === WHEEL_DELTA.LINE) return delta * WHEEL_LINE_PX;
  if (event.deltaMode === WHEEL_DELTA.PAGE) return delta * page;
  return delta;
}

/** Whether two views draw the picture alike. */
function sameView(first: ImageView, second: ImageView): boolean {
  return first.scale === second.scale && first.x === second.x && first.y === second.y;
}

/** The point halfway between two spots. */
function between(first: Spot, second: Spot): Spot {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

/**
 * `view` as two fingers moved it: one finger from `was` to `now` while the
 * other held at `held`, scaled by how far apart they moved about the point
 * between them, and moved as that point moved, so what was under each finger
 * stays under it. Points are the frame's, from its centre.
 */
function pinched(
  view: ImageView,
  sizes: ImageFrame,
  fingers: { readonly was: FramePoint; readonly now: FramePoint; readonly held: FramePoint },
): ImageView {
  const { was, now, held } = fingers;
  const apartBefore = Math.hypot(was.x - held.x, was.y - held.y);
  if (apartBefore === 0) return view;
  const apartAfter = Math.hypot(now.x - held.x, now.y - held.y);
  const from = between(was, held);
  const to = between(now, held);
  const zoomed = zoomedTo(view, sizes, (view.scale * apartAfter) / apartBefore, from);
  return pannedBy(zoomed, sizes, to.x - from.x, to.y - from.y);
}

/** The view a picture opening at its own pixels is drawn at: its own size over its fitted one, its top left corner where the fitted picture's stood. */
function ownPixels(view: ImageView, sizes: ImageFrame, natural: ImageSize): ImageView {
  if (sizes.fitted.width <= 0) return view;
  const corner = { x: -sizes.fitted.width / 2, y: -sizes.fitted.height / 2 };
  return zoomedTo(view, sizes, natural.width / sizes.fitted.width, corner);
}

/** Where a pointer at `clientX`, `clientY` stands from the frame's centre. */
function pointIn(frame: HTMLElement, clientX: number, clientY: number): FramePoint {
  const box = frame.getBoundingClientRect();
  return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
}

/**
 * The zoom of the file named `name` at `url`, fitted until a gesture says
 * otherwise, or at its own pixels once it has loaded where `opening` asks.
 * Two fingers on the frame pinch it about the point between them, as a
 * trackpad's pinch does, and move it as that point moves. Note that the zoom belongs to the picture rather than to its
 * place among the files, so another picture shown, however it came to be,
 * opens fitted, and the same picture moved along the files as an earlier one
 * lands keeps its zoom.
 */
export function useImageZoom(
  name: string,
  url: string,
  opening: ImageOpening = IMAGE_OPENING.FITTED,
): ImageZoom {
  const [stored, setShown] = useState<Shown>({
    subject: { name, url },
    view: FITTED_VIEW,
    glide: false,
  });
  const isShown = (subject: Subject) => subject.name === name && subject.url === url;
  const shown: Shown = isShown(stored.subject)
    ? stored
    : { subject: { name, url }, view: FITTED_VIEW, glide: false };
  const frame = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const press = useRef<Press | undefined>(undefined);
  // Every pointer down on the frame, by its id, where it stood last.
  const fingers = useRef(new Map<number, Spot>());

  // Note that every change measures the frame as it lands, because the
  // window may have changed size since the last one.
  const change = useCallback(
    (glide: boolean, next: (view: ImageView, sizes: ImageFrame) => ImageView) => {
      const sizes = measured(frame.current, image.current);
      if (sizes === undefined) return;
      setShown((last) => {
        const same = last.subject.name === name && last.subject.url === url;
        const from = same ? last.view : FITTED_VIEW;
        const view = next(from, sizes);
        // A change that moves nothing, a resize's or a scroll's on a fitted picture, draws nothing.
        return same && sameView(view, from) ? last : { subject: { name, url }, view, glide };
      });
    },
    [name, url],
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
        const dx = wheelPixels(event, event.deltaX, element.clientWidth);
        const dy = wheelPixels(event, event.deltaY, element.clientHeight);
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
      const down = (event: PointerEvent) => {
        fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // A second finger, on the picture or the frame around it, makes the press a pinch, which is no press.
        if (fingers.current.size > 1 && press.current !== undefined) press.current.moved = true;
      };
      // Note that a finger is heard on the frame rather than the picture, so
      // a pinch begun on the frame's ground around a small picture still
      // zooms it, and before the picture's own handlers, which leave a pinch alone.
      const move = (event: PointerEvent) => {
        const was = fingers.current.get(event.pointerId);
        if (was === undefined) return;
        const now = { x: event.clientX, y: event.clientY };
        fingers.current.set(event.pointerId, now);
        if (fingers.current.size !== 2) return;
        const held = [...fingers.current].find(([id]) => id !== event.pointerId)?.[1];
        if (held === undefined) return;
        const at = (spot: Spot) => pointIn(element, spot.x, spot.y);
        change(false, (view, sizes) =>
          pinched(view, sizes, { was: at(was), now: at(now), held: at(held) }),
        );
      };
      const up = (event: PointerEvent) => {
        fingers.current.delete(event.pointerId);
      };
      element.addEventListener("wheel", wheel, { passive: false });
      element.addEventListener("pointerdown", down);
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", up);
      return () => {
        resized.disconnect();
        element.removeEventListener("wheel", wheel);
        element.removeEventListener("pointerdown", down);
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", up);
        fingers.current.clear();
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
      onLoad: (event) => {
        if (opening !== IMAGE_OPENING.OWN_PIXELS) return;
        const natural = {
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        };
        change(false, (view, sizes) => (isZoomed(view) ? view : ownPixels(view, sizes, natural)));
      },
      onPointerDown: (event) => {
        if (event.button !== 0) return;
        // A second finger down makes the press a pinch, which is no press.
        if (fingers.current.size > 1) {
          if (press.current !== undefined) press.current.moved = true;
          return;
        }
        press.current = {
          pointerId: event.pointerId,
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
        // A pinch zooms on the frame (above); the finger that began the press
        // keeps its place, so lifting the other drags on from where it stands.
        if (fingers.current.size > 1 || event.pointerId !== held.pointerId) {
          held.moved = true;
          if (event.pointerId === held.pointerId) {
            held.x = event.clientX;
            held.y = event.clientY;
          }
          return;
        }
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
