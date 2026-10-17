/**
 * image-zoom.ts -- a picture opened over the window, magnified and moved about as Preview's is: how far it is zoomed over the size that fits the window, where it stands, and what a pinch, a scroll, a drag, a press, or a key makes of that.
 *
 * The picture is first drawn fitted to its frame (`FITTED_VIEW`). A view is
 * a scale over that fitted size and the offset of the picture's centre from
 * the frame's, in the page's own pixels. A zoom keeps the point under the
 * pointer where it stands, as a pinch does on every Mac. A picture is never
 * moved further than to bring its edge to the frame's, so it cannot be lost
 * off a side, and one narrower than its frame along an axis stays centred
 * along it. Nothing here reads the page: the place drawing the picture
 * measures the frame and hands it in.
 */

/** A width and a height, in the page's pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Where the picture is seen: the frame that draws it, and the picture's size fitted in it before any zoom. */
export interface ImageFrame {
  readonly frame: ImageSize;
  readonly fitted: ImageSize;
}

/** A point measured from the frame's centre, rightward and downward. */
export interface FramePoint {
  readonly x: number;
  readonly y: number;
}

/** How far the picture is zoomed over its fitted size, and how far its centre stands from the frame's. */
export interface ImageView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** The picture fitted to its frame and centred in it, as it opens. */
export const FITTED_VIEW: ImageView = { scale: 1, x: 0, y: 0 };

/** The frame's centre, where a key's or a button's zoom is taken about. */
export const FRAME_CENTRE: FramePoint = { x: 0, y: 0 };

/** How far each way of zooming goes. */
export const IMAGE_ZOOM = {
  /** The most a picture is magnified over its fitted size. */
  MOST: 8,
  /** What one press of a zoom key or button multiplies the scale by. */
  STEP: 1.5,
  /** How much a scroll pixel of a pinch zooms, on an exponential, so a pinch in and out again comes back where it began. */
  PER_WHEEL_PIXEL: 0.01,
  /** The most scroll pixels one wheel event counts, so a mouse wheel's notch of a hundred zooms by a step rather than a leap. */
  WHEEL_MOST_PIXELS: 40,
  /** The least a press on a fitted picture zooms it to, for one already drawn at about its own size. */
  PRESS_LEAST: 2,
} as const;

/** Note that a scale this close to fitted is fitted, because an exponential pinch out never quite lands on one. */
const FITTED_SLACK = 0.01;

/** `value` held between `least` and `most`, with no negative zero, so a centred picture's offset reads 0. */
function clamp(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value)) + 0;
}

/** How far the picture's centre may stand from the frame's along one axis at `scale`: none where it fits. */
function slack(fitted: number, frame: number, scale: number): number {
  return Math.max(0, (fitted * scale - frame) / 2);
}

/** Whether the picture is magnified past its fitted size, and so may be moved about. */
export function isZoomed(view: ImageView): boolean {
  return view.scale > 1;
}

/** `view` with the picture's edges held to the frame's, and fitted outright where it is all but fitted. */
function heldInFrame(view: ImageView, frame: ImageFrame): ImageView {
  if (view.scale <= 1 + FITTED_SLACK) return FITTED_VIEW;
  const width = slack(frame.fitted.width, frame.frame.width, view.scale);
  const height = slack(frame.fitted.height, frame.frame.height, view.scale);
  return { scale: view.scale, x: clamp(view.x, -width, width), y: clamp(view.y, -height, height) };
}

/** `view` zoomed to `scale`, between fitted and the most, keeping the picture's point under `at` where it stands. */
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

/** `view` zoomed by a pinch, or a scroll with Control held, of `deltaY` pixels at `at`: a pinch apart scrolls up and zooms in. */
export function zoomedByWheel(
  view: ImageView,
  frame: ImageFrame,
  deltaY: number,
  at: FramePoint,
): ImageView {
  const counted = clamp(deltaY, -IMAGE_ZOOM.WHEEL_MOST_PIXELS, IMAGE_ZOOM.WHEEL_MOST_PIXELS);
  return zoomedTo(view, frame, view.scale * Math.exp(-counted * IMAGE_ZOOM.PER_WHEEL_PIXEL), at);
}

/** `view` zoomed one step in (`1`) or out (`-1`) about the frame's centre. */
export function zoomedByStep(view: ImageView, frame: ImageFrame, direction: 1 | -1): ImageView {
  return zoomedTo(view, frame, view.scale * IMAGE_ZOOM.STEP ** direction, FRAME_CENTRE);
}

/** `view` moved by `dx` and `dy` pixels, as a drag or a two-finger scroll moves it, no further than its edges. */
export function pannedBy(view: ImageView, frame: ImageFrame, dx: number, dy: number): ImageView {
  return heldInFrame({ scale: view.scale, x: view.x + dx, y: view.y + dy }, frame);
}

/**
 * What a press on the picture at `at` makes of `view`, as a press on a
 * picture in a browser's own tab does: a fitted picture is zoomed to its own
 * pixels there (twice its fitted size at least, for one fitted at about its
 * own size), and a zoomed one goes back to fitted.
 */
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
