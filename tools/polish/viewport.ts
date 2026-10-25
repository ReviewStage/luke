/**
 * viewport.ts -- the frame a picture is taken at, and the page script that says whether the page has laid out at it yet.
 *
 * A desktop window is sized and zoomed from the main process, and its page
 * hears of both a moment later, so a picture taken at once can still show the
 * window's earlier size. The page lays out at the window's size divided by
 * its zoom: the least window, 760×520 at 125%, is 608×416 CSS px. It lives
 * apart from `polish-shots.ts`, which runs the whole capture the moment it
 * is imported, so a test can hand the script to a page of its own.
 */

/** A window or viewport, the zoom it is drawn at, and whether a finger works it. */
export interface Frame {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly phone: boolean;
}

/** A page expression that is true once the page lays out at `frame`'s size in CSS px, its zoom taken out; within a pixel, as Chromium rounds a zoomed size. */
export function sizedScript(frame: Frame): string {
  const width = frame.width / frame.zoom;
  const height = frame.height / frame.zoom;
  return `Math.abs(innerWidth - ${width}) < 1 && Math.abs(innerHeight - ${height}) < 1`;
}
