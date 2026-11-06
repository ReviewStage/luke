export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export interface ImageFrame {
  readonly frame: ImageSize;
  readonly fitted: ImageSize;
}

export interface FramePoint {
  readonly x: number;
  readonly y: number;
}

export interface ImageView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

export const FITTED_VIEW: ImageView = { scale: 1, x: 0, y: 0 };

export const FRAME_CENTER: FramePoint = { x: 0, y: 0 };

export const IMAGE_ZOOM = {
  MOST: 8,
  STEP: 1.5,
  PER_WHEEL_PIXEL: 0.01,
  WHEEL_MOST_PIXELS: 40,
  PRESS_LEAST: 2,
} as const;

const FITTED_SLACK = 0.01;

function clamp(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value)) + 0;
}

function slack(fitted: number, frame: number, scale: number): number {
  return Math.max(0, (fitted * scale - frame) / 2);
}

export function isZoomed(view: ImageView): boolean {
  return view.scale > 1;
}

function heldInFrame(view: ImageView, frame: ImageFrame): ImageView {
  if (view.scale <= 1 + FITTED_SLACK) return FITTED_VIEW;
  const width = slack(frame.fitted.width, frame.frame.width, view.scale);
  const height = slack(frame.fitted.height, frame.frame.height, view.scale);
  return { scale: view.scale, x: clamp(view.x, -width, width), y: clamp(view.y, -height, height) };
}

export function zoomedTo(
  view: ImageView,
  frame: ImageFrame,
  scale: number,
  at: FramePoint,
): ImageView {
  const next = clamp(scale, 1, IMAGE_ZOOM.MOST);
  const ratio = next / view.scale;
  return heldInFrame(
    { scale: next, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio },
    frame,
  );
}

export function zoomedByWheel(
  view: ImageView,
  frame: ImageFrame,
  deltaY: number,
  at: FramePoint,
): ImageView {
  const counted = clamp(deltaY, -IMAGE_ZOOM.WHEEL_MOST_PIXELS, IMAGE_ZOOM.WHEEL_MOST_PIXELS);
  return zoomedTo(view, frame, view.scale * Math.exp(-counted * IMAGE_ZOOM.PER_WHEEL_PIXEL), at);
}

export function zoomedByStep(view: ImageView, frame: ImageFrame, direction: 1 | -1): ImageView {
  return zoomedTo(view, frame, view.scale * IMAGE_ZOOM.STEP ** direction, FRAME_CENTER);
}

export function pannedBy(view: ImageView, frame: ImageFrame, dx: number, dy: number): ImageView {
  return heldInFrame({ scale: view.scale, x: view.x + dx, y: view.y + dy }, frame);
}

export function pressedAt(
  view: ImageView,
  frame: ImageFrame,
  natural: ImageSize,
  at: FramePoint,
): ImageView {
  if (isZoomed(view)) return FITTED_VIEW;
  const own = frame.fitted.width > 0 ? natural.width / frame.fitted.width : 1;
  return zoomedTo(view, frame, Math.max(own, IMAGE_ZOOM.PRESS_LEAST), at);
}
