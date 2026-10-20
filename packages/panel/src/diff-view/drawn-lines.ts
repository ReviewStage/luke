import type { FileDiff } from "@pierre/diffs";

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
 * fold.
 */

/** A file as Pierre draws it, as far as what it draws is read. */
type DrawnFile = Pick<FileDiff<string, undefined>, "fileDiff" | "isLineRenderable">;

/** The lines of `hidden`, lines of the new side between the file's hunks, that `drawn` draws now, in their order. */
export function drawnAmong(drawn: DrawnFile, hidden: readonly number[]): readonly number[] {
  if (hidden.length === 0 || drawn.fileDiff?.isPartial !== false) return [];
  return hidden.filter((line) => drawn.isLineRenderable(line));
}
