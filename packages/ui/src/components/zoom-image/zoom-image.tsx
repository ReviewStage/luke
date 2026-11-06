import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { cssCustomProperties } from "../../css.js";
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
} from "../../image-zoom.js";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";

const PRESS_SLACK_PX = 4;

const ZOOM_KEY = {
  IN: new Set(["=", "+"]),
  OUT: new Set(["-", "_"]),
  FIT: "0",
} as const;

interface Press {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  x: number;
  y: number;
  moved: boolean;
}

const WHEEL_DELTA = {
  PIXEL: 0,
  LINE: 1,
  PAGE: 2,
} as const;

interface Spot {
  readonly x: number;
  readonly y: number;
}

export const IMAGE_OPENING = {
  FITTED: "fitted",
  OWN_PIXELS: "own-pixels",
} as const;

export type ImageOpening = (typeof IMAGE_OPENING)[keyof typeof IMAGE_OPENING];

const WHEEL_LINE_PX = 16;

interface Subject {
  readonly name: string;
  readonly url: string;
}

interface Shown {
  readonly subject: Subject;
  readonly view: ImageView;
  readonly glide: boolean;
}

export interface ImageZoom {
  readonly zoomed: boolean;
  readonly frameRef: (element: HTMLDivElement | null) => (() => void) | undefined;
  readonly imageProps: React.ImgHTMLAttributes<HTMLImageElement> & {
    ref: React.RefObject<HTMLImageElement | null>;
    "data-zoom": string;
    "data-glide": string;
  };
  readonly step: (direction: 1 | -1) => void;
  readonly keyDown: (event: React.KeyboardEvent) => boolean;
}

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

function wheelPixels(event: WheelEvent, delta: number, page: number): number {
  if (event.deltaMode === WHEEL_DELTA.LINE) return delta * WHEEL_LINE_PX;
  if (event.deltaMode === WHEEL_DELTA.PAGE) return delta * page;
  return delta;
}

function sameView(first: ImageView, second: ImageView): boolean {
  return first.scale === second.scale && first.x === second.x && first.y === second.y;
}

function between(first: Spot, second: Spot): Spot {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

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

function ownPixels(view: ImageView, sizes: ImageFrame, natural: ImageSize): ImageView {
  if (sizes.fitted.width <= 0) return view;
  const corner = { x: -sizes.fitted.width / 2, y: -sizes.fitted.height / 2 };
  return zoomedTo(view, sizes, natural.width / sizes.fitted.width, corner);
}

function pointIn(frame: HTMLElement, clientX: number, clientY: number): FramePoint {
  const box = frame.getBoundingClientRect();
  return { x: clientX - box.left - box.width / 2, y: clientY - box.top - box.height / 2 };
}

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
  const [loaded, setLoaded] = useState<ImageSize>();
  const press = useRef<Press | undefined>(undefined);
  const fingers = useRef(new Map<number, Spot>());

  const change = useCallback(
    (glide: boolean, next: (view: ImageView, sizes: ImageFrame) => ImageView) => {
      const sizes = measured(frame.current, image.current);
      if (sizes === undefined) return;
      setShown((last) => {
        const same = last.subject.name === name && last.subject.url === url;
        const from = same ? last.view : FITTED_VIEW;
        const view = next(from, sizes);
        return same && sameView(view, from) ? last : { subject: { name, url }, view, glide };
      });
    },
    [name, url],
  );

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
      const resized = new ResizeObserver(() =>
        change(false, (view, sizes) => pannedBy(view, sizes, 0, 0)),
      );
      resized.observe(element);
      if (image.current !== null) resized.observe(image.current);
      const down = (event: PointerEvent) => {
        fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (fingers.current.size > 1 && press.current !== undefined) press.current.moved = true;
      };
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

  useLayoutEffect(() => {
    const element = image.current;
    if (element === null || !element.complete || element.naturalWidth === 0) return;
    setLoaded({ width: element.naturalWidth, height: element.naturalHeight });
  }, [url]);

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
        ...(loaded !== undefined && opening === IMAGE_OPENING.FITTED
          ? cssCustomProperties({
              "--ui-zoom-natural-width": loaded.width,
              "--ui-zoom-natural-height": loaded.height,
            })
          : {}),
      },
      "data-zoom": isZoomed(view) ? "zoomed" : "fitted",
      "data-glide": String(glide),
      onLoad: (event) => {
        const natural = {
          width: event.currentTarget.naturalWidth,
          height: event.currentTarget.naturalHeight,
        };
        setLoaded(natural);
        if (opening !== IMAGE_OPENING.OWN_PIXELS) return;
        change(false, (view, sizes) => (isZoomed(view) ? view : ownPixels(view, sizes, natural)));
      },
      onPointerDown: (event) => {
        if (event.button !== 0) return;
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
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove: (event) => {
        const held = press.current;
        if (held === undefined || (event.buttons & 1) === 0) return;
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
        if (held?.moved === true) return;
        pulsePress(event.currentTarget, PRESS_PULSE.QUIET);
        if (frame.current === null) return;
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

export function ZoomImage({
  zoom,
  src,
  alt,
}: {
  zoom: ImageZoom;
  src: string;
  alt: string;
}): React.JSX.Element {
  return <img className="ui-zoom-image" src={src} alt={alt} {...zoom.imageProps} />;
}
