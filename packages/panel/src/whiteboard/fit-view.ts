/**
 * fit-view.ts -- the view a board opens on: the whole drawing, as large as the room the toolbars leave will hold it.
 *
 * Excalidraw's own fit runs the drawing edge to edge of the canvas, while its
 * toolbars float over that canvas. In a room as narrow as a phone's, the top
 * toolbar then hides the diagram's first labels and the side tools cover its
 * last shape. Here a bar wider than it is tall is read as the top's or the
 * bottom's, whichever is nearer, so the drawing stands between them, a gap
 * clear of each. A tall bar, the side tools, holds its side clear only if the
 * drawing so placed would come within the gap of it, so a board whose side tools stand above
 * the drawing keeps the room beside them.
 *
 * Note that the zoom is the exact one that fits, where Excalidraw's own rounds
 * down to a tenth, which at a phone's zoom of a third gives up a quarter of the
 * room. And that this module holds no Excalidraw value and reads no DOM, so
 * the panel's tests read it without the canvas Excalidraw needs to load.
 *
 * A fitted view follows its canvas: while no one has moved it, a canvas that
 * changes size is fitted again (`followFit`). A window opened large and then
 * made small, or a pane that takes its width only after the board loaded,
 * would otherwise keep the first size's view, too large and off the canvas's
 * edges. Once the developer scrolls or zooms, the view is theirs and stays.
 */

/** A box in the canvas's own pixels. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** A view as Excalidraw's app state holds one: the scene point at the canvas's corner, and the scale. */
export interface View {
  readonly zoom: number;
  readonly scrollX: number;
  readonly scrollY: number;
}

/** The drawing's bounds in the scene, as Excalidraw's `getCommonBounds` answers them. */
export type SceneBounds = readonly [left: number, top: number, right: number, bottom: number];

/** Excalidraw's own limits on a zoom: no larger than the drawing's own size, and no smaller than a tenth of it. */
const ZOOM = { MIN: 0.1, MAX: 1 } as const;

interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Whether `a` stands within `gap` of `b`, or over it. */
function reaches(a: Rect, b: Rect, gap: number): boolean {
  return (
    a.left < b.right + gap &&
    b.left - gap < a.right &&
    a.top < b.bottom + gap &&
    b.top - gap < a.bottom
  );
}

interface Canvas {
  readonly width: number;
  readonly height: number;
}

/** The drawing fitted into what `inset` leaves of `canvas`, and the box it then stands in. */
function placeIn(canvas: Canvas, inset: Insets, bounds: SceneBounds) {
  const [left, top, right, bottom] = bounds;
  const size = { width: Math.max(right - left, 1), height: Math.max(bottom - top, 1) };
  const room = {
    width: canvas.width - inset.left - inset.right,
    height: canvas.height - inset.top - inset.bottom,
  };
  const fit = Math.min(room.width / size.width, room.height / size.height, ZOOM.MAX);
  const zoom = Math.max(fit, ZOOM.MIN);
  const centre = { x: inset.left + room.width / 2, y: inset.top + room.height / 2 };
  const view: View = {
    zoom,
    scrollX: centre.x / zoom - (left + right) / 2,
    scrollY: centre.y / zoom - (top + bottom) / 2,
  };
  const half = { x: (size.width * zoom) / 2, y: (size.height * zoom) / 2 };
  const placed: Rect = {
    left: centre.x - half.x,
    top: centre.y - half.y,
    right: centre.x + half.x,
    bottom: centre.y + half.y,
  };
  return { view, placed };
}

/** The view that fits `bounds` into `canvas`, a `gap` clear of the bars that float over it. */
export function fitView(
  canvas: Canvas,
  bars: readonly Rect[],
  bounds: SceneBounds,
  gap: number,
): View {
  const inset: Insets = { top: gap, right: gap, bottom: gap, left: gap };
  const sides = bars.filter((bar) => bar.right - bar.left <= bar.bottom - bar.top);
  for (const bar of bars) {
    if (sides.includes(bar)) continue;
    if ((bar.top + bar.bottom) / 2 < canvas.height / 2)
      inset.top = Math.max(inset.top, bar.bottom + gap);
    else inset.bottom = Math.max(inset.bottom, canvas.height - bar.top + gap);
  }
  let fit = placeIn(canvas, inset, bounds);
  // A side bar moves its side in only when the drawing, so placed, would come within the gap of it: at most one move a bar.
  for (const _ of sides) {
    const hit = sides.find((bar) => reaches(fit.placed, bar, gap));
    if (hit === undefined) break;
    if ((hit.left + hit.right) / 2 < canvas.width / 2)
      inset.left = Math.max(inset.left, hit.right + gap);
    else inset.right = Math.max(inset.right, canvas.width - hit.left + gap);
    fit = placeIn(canvas, inset, bounds);
  }
  return fit.view;
}

/** A view the board fitted, and the canvas size it was fitted at. */
export interface Fitted {
  readonly view: View;
  readonly width: number;
  readonly height: number;
}

/** What a fitted view does on a change to the canvas: stays, is fitted again, or is the developer's from now on. */
export const FOLLOW = { HOLD: "hold", REFIT: "refit", RELEASE: "release" } as const;
export type Follow = (typeof FOLLOW)[keyof typeof FOLLOW];

/** What `fitted` does now that the canvas stands at `now`: fitted again where only its size changed, released where its view moved. */
export function followFit(fitted: Fitted, now: Fitted): Follow {
  const { view } = fitted;
  const moved =
    now.view.zoom !== view.zoom ||
    now.view.scrollX !== view.scrollX ||
    now.view.scrollY !== view.scrollY;
  if (moved) return FOLLOW.RELEASE;
  return now.width === fitted.width && now.height === fitted.height ? FOLLOW.HOLD : FOLLOW.REFIT;
}
