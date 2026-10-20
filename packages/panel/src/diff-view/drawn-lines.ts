import type { FileDiff } from "@pierre/diffs";
import { sameLines } from "./contract.js";

/**
 * drawn-lines.ts -- which lines between a file's hunks Pierre draws now, as the gaps between them are opened.
 *
 * Pierre keeps what a gap's arrows opened on the file's own drawing, and
 * says of a line of the new side whether it stands in a row
 * (`isLineRenderable`) rather than handing out what was opened. It answers
 * yes for every line of a file it has not read whole, whose gaps open
 * nothing yet, so such a file is taken to draw none of the lines between
 * its hunks; once read whole, a line is drawn where a gap was opened over
 * it, up, down, or all at once, or where Pierre draws a gap too short to
 * fold. The view is told what each file draws only as it changes, and
 * that a file the list no longer holds, or a list taken down, draws none
 * (`drawnTeller`), since its next drawing opens no gap.
 */

/** A file as Pierre draws it, as far as what it draws is read. */
type DrawnFile = Pick<FileDiff<string, undefined>, "fileDiff" | "isLineRenderable">;

/** The lines of `hidden`, lines of the new side between the file's hunks, that `drawn` draws now, in their order. */
export function drawnAmong(drawn: DrawnFile, hidden: readonly number[]): readonly number[] {
  if (hidden.length === 0 || drawn.fileDiff?.isPartial !== false) return [];
  return hidden.filter((line) => drawn.isLineRenderable(line));
}

/** No lines. */
const NO_LINES: readonly number[] = [];

/** What tells the view which hidden lines each file draws: told one file's lines, and told which files the list still holds. */
export interface DrawnTeller {
  readonly tell: (path: string, lines: readonly number[]) => void;
  /** Tells every file told some lines and not among `kept` that it draws none; none kept for a list taken down. */
  readonly forget: (kept: ReadonlySet<string>) => void;
  /** The lines a file was last told to draw. */
  readonly told: (path: string) => readonly number[];
}

/** Tells `onDrawn` each file's drawn lines as they change, a file drawing none until told otherwise. */
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
