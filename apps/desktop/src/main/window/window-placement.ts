/**
 * window-placement.ts -- where the window stood when it last closed: kept in a file, and put back on a display that is still connected.
 *
 * A Mac app opens where it was left: on the same display, at the same size,
 * zoomed or full screen as it was. The frame kept is the window's normal one,
 * so a window closed zoomed or full screen comes back to that state over the
 * frame it would return to. A display unplugged since is not a place a
 * window may open on, so a frame no display holds any longer opens at the
 * first frame instead, and a frame only partly on one is brought within it.
 */

import fs from "node:fs";
import { Option, Schema } from "effect";
import type { Rectangle } from "electron";

/** The window as it closed: its normal frame, and whether it stood zoomed or full screen over it. */
export interface WindowPlacement {
  bounds: Rectangle;
  zoomed: boolean;
  fullScreen: boolean;
}

const decodePlacement = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      bounds: Schema.Struct({
        x: Schema.Finite,
        y: Schema.Finite,
        width: Schema.Finite,
        height: Schema.Finite,
      }),
      zoomed: Schema.Boolean,
      fullScreen: Schema.Boolean,
    }),
  ),
);

/** How much of one frame lies over another, in square points. */
function overlap(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** A value held between two ends, the lower winning where they cross. */
function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest));
}

/** A frame moved and, if need be, shrunk until the whole of it lies in the area. */
function within(bounds: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: clamp(bounds.x, area.x, area.x + area.width - width),
    y: clamp(bounds.y, area.y, area.y + area.height - height),
    width,
    height,
  };
}

/**
 * The window as it stands, to be kept: its normal frame, zoomed or full
 * screen over it. Note that a window moved to another display while full
 * screen keeps its normal frame on the display it left, so that frame is
 * centred on the display the window now fills instead, where it would open.
 */
export function placementOf(window: {
  normal: Rectangle;
  shown: Rectangle;
  zoomed: boolean;
  fullScreen: boolean;
}): WindowPlacement {
  const { normal, shown, zoomed, fullScreen } = window;
  const moved = fullScreen && overlap(normal, shown) === 0;
  const bounds = moved
    ? within(
        {
          ...normal,
          x: Math.round(shown.x + (shown.width - normal.width) / 2),
          y: Math.round(shown.y + (shown.height - normal.height) / 2),
        },
        shown,
      )
    : normal;
  return { bounds, zoomed, fullScreen };
}

/** Where the window last stood, or nothing for a first launch or a file that is not one. */
export function readWindowPlacement(file: string): WindowPlacement | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodePlacement(text));
}

/**
 * Keeps where the window stands now. Note that a write the disk refuses is
 * let go, because the window is closing either way and all it costs is the
 * first frame at the next launch.
 */
export function writeWindowPlacement(file: string, placement: WindowPlacement): void {
  try {
    fs.writeFileSync(file, JSON.stringify(placement));
  } catch {
    // The next launch opens at the first frame.
  }
}

/**
 * Where the window opens: the saved frame, within the work area of the
 * display it lies most over, zoomed or full screen as it was; or `first`,
 * the frame a first launch opens at, when nothing is saved or no connected
 * display holds any of the saved frame.
 */
export function placeWindow(options: {
  saved: WindowPlacement | undefined;
  workAreas: readonly Rectangle[];
  first: Rectangle;
}): WindowPlacement {
  const { saved, workAreas, first } = options;
  const opening: WindowPlacement = { bounds: first, zoomed: false, fullScreen: false };
  if (saved === undefined) return opening;
  let area: Rectangle | undefined;
  for (const candidate of workAreas) {
    const covered = overlap(saved.bounds, candidate);
    if (covered > 0 && (area === undefined || covered > overlap(saved.bounds, area))) {
      area = candidate;
    }
  }
  if (area === undefined) return opening;
  return { ...saved, bounds: within(saved.bounds, area) };
}
