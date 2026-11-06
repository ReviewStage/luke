import type { FileDiff } from "@pierre/diffs";
import { sameLines } from "./contract.js";

type DrawnFile = Pick<FileDiff<string, undefined>, "fileDiff" | "isLineRenderable">;

export function drawnAmong(drawn: DrawnFile, hidden: readonly number[]): readonly number[] {
  if (hidden.length === 0 || drawn.fileDiff?.isPartial !== false) return [];
  return hidden.filter((line) => drawn.isLineRenderable(line));
}

const NO_LINES: readonly number[] = [];

export interface DrawnTeller {
  readonly tell: (path: string, lines: readonly number[]) => void;
  readonly forget: (kept: ReadonlySet<string>) => void;
  readonly told: (path: string) => readonly number[];
}

export function drawnTeller(
  onDrawn: (path: string, lines: readonly number[]) => void,
): DrawnTeller {
  const told = new Map<string, readonly number[]>();
  const tell = (path: string, lines: readonly number[]) => {
    if (sameLines(told.get(path) ?? NO_LINES, lines)) return;
    if (lines.length === 0) told.delete(path);
    else told.set(path, lines);
    onDrawn(path, lines);
  };
  return {
    tell,
    forget: (kept) => {
      for (const path of [...told.keys()]) if (!kept.has(path)) tell(path, NO_LINES);
    },
    told: (path) => told.get(path) ?? NO_LINES,
  };
}
