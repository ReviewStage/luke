import fs from "node:fs";
import { Option, Schema } from "effect";
import type { Rectangle } from "electron";

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

function overlap(a: Rectangle, b: Rectangle): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

function clamp(value: number, lowest: number, highest: number): number {
  return Math.max(lowest, Math.min(value, highest));
}

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

export function readWindowPlacement(file: string): WindowPlacement | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  return Option.getOrUndefined(decodePlacement(text));
}

export function writeWindowPlacement(file: string, placement: WindowPlacement): void {
  try {
    fs.writeFileSync(file, JSON.stringify(placement));
  } catch {}
}

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
