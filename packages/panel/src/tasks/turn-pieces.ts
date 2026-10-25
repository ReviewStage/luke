/**
 * turn-pieces.ts -- a turn too long to draw at once, cut into pieces the log draws one at a time.
 *
 * The log draws only the rows near its view (`ConversationRows`), a row a
 * message, so a turn is drawn whole or not at all. An orchestrator's turn is
 * its whole run, days of it: a thousand parts in one message, a row taller
 * than many screens, drawn whole on every page it gains and whenever it
 * comes back into view. So a turn whose rows run past a piece is cut into
 * pieces of `PIECE_ROWS` of its rows and the lines that reached it, each a
 * row of the log of its own, cut always at the same places so a page that
 * adds rows at the end leaves every earlier piece as it was. A piece holds
 * whole stretches where it can (`turnStretches`); a stretch it cuts goes on
 * in the next piece, which then `continues` it, so the log stands it a
 * row's step from the last rather than a message's.
 */

import { sameTurnRow, type TurnRow } from "@luke/features/turn-rows";
import type { AgentPart, TurnStretch } from "./coding-agent-model.js";

/** How many of a turn's rows, and lines that reached it, one piece of it holds. */
export const PIECE_ROWS = 6;

/** One piece of a turn, as the log draws it in a row of its own. */
export interface TurnPiece {
  /** Its stretches: whole lines, and runs of the turn's rows. */
  readonly stretches: readonly TurnStretch[];
  /** Whether it is the turn's first piece, which names its sender and carries its id. */
  readonly first: boolean;
  /** Whether it is the turn's last piece, which ends on its foot. */
  readonly last: boolean;
  /** Whether it goes on with a run of rows the piece before it cut. */
  readonly continues: boolean;
}

/** One of a turn's rows or lines, with the stretch it stands in. */
type Unit =
  | { readonly stretch: number; readonly line: TurnStretch["line"] & object }
  | { readonly stretch: number; readonly row: TurnRow<AgentPart> };

/** A turn's stretches as the rows and lines they hold, in order. */
function unitsOf(stretches: readonly TurnStretch[]): readonly Unit[] {
  return stretches.flatMap((stretch, at): Unit[] =>
    stretch.line !== undefined
      ? [{ stretch: at, line: stretch.line }]
      : stretch.rows.map((row) => ({ stretch: at, row })),
  );
}

/** Units gathered back into stretches: a line each, and each run of one stretch's rows. */
function stretchesOf(units: readonly Unit[]): readonly TurnStretch[] {
  const stretches: TurnStretch[] = [];
  let run: TurnRow<AgentPart>[] | undefined;
  let runOf = -1;
  for (const unit of units) {
    if ("line" in unit) {
      run = undefined;
      stretches.push({ line: unit.line });
      continue;
    }
    if (run === undefined || runOf !== unit.stretch) {
      run = [];
      runOf = unit.stretch;
      stretches.push({ rows: run });
    }
    run.push(unit.row);
  }
  return stretches;
}

/**
 * A turn's stretches as the pieces the log draws: one piece holding them
 * all where they hold no more than two pieces' worth, so only a long turn
 * is ever cut; otherwise `size` rows or lines to a piece, the last holding
 * what is left.
 */
export function turnPieces(
  stretches: readonly TurnStretch[],
  size: number = PIECE_ROWS,
): readonly TurnPiece[] {
  const units = unitsOf(stretches);
  if (units.length <= size * 2 || !units.some((unit) => "row" in unit)) {
    return [{ stretches, first: true, last: true, continues: false }];
  }
  // Note that the last piece holds a run of rows, never lines alone, because the turn's foot stands under its last rows.
  const lastRow = units.findLastIndex((unit) => "row" in unit);
  const lastFrom = Math.floor(lastRow / size) * size;
  const pieces: TurnPiece[] = [];
  for (let from = 0; from < units.length; from += size) {
    const held = units.slice(from, from === lastFrom ? units.length : from + size);
    const before = units[from - 1];
    const head = held[0];
    pieces.push({
      stretches: stretchesOf(held),
      first: from === 0,
      last: from === lastFrom,
      continues:
        before !== undefined &&
        head !== undefined &&
        "row" in before &&
        "row" in head &&
        before.stretch === head.stretch,
    });
    if (from === lastFrom) break;
  }
  return pieces;
}

/**
 * The key a piece's row is kept by, which its measured height is kept by
 * too: the turn's own for its first piece, so a link to the turn and the
 * height it measured whole land where they did, and the turn's with the
 * piece's place after it for each later one. Note that the log's run names
 * its rows by one string each (`VirtualRows`), and a piece's place never
 * moves as a page adds rows, since pieces are cut from the turn's start.
 */
export function pieceKey(turnKey: string, at: number): string {
  return at === 0 ? turnKey : `${turnKey}/${String(at)}`;
}

/** Whether two pieces draw alike: the same place in the turn, the same lines, and rows that read alike. */
function samePiece(a: TurnPiece, b: TurnPiece): boolean {
  return (
    a.first === b.first &&
    a.last === b.last &&
    a.continues === b.continues &&
    a.stretches.length === b.stretches.length &&
    a.stretches.every((stretch, at) => {
      const theirs = b.stretches[at];
      if (theirs === undefined) return false;
      if (stretch.line !== undefined || theirs.line !== undefined)
        return stretch.line === theirs.line;
      return (
        stretch.rows.length === theirs.rows.length &&
        stretch.rows.every((row, index) => {
          const other = theirs.rows[index];
          return other !== undefined && sameTurnRow(row, other);
        })
      );
    })
  );
}

/** The pieces handed, each the one held before at its place where it draws alike, so a page that touched only a turn's end leaves its earlier pieces the same values. */
export function keptPieces(
  held: readonly TurnPiece[] | undefined,
  pieces: readonly TurnPiece[],
): readonly TurnPiece[] {
  if (held === undefined) return pieces;
  return pieces.map((piece, at) => {
    const was = held[at];
    return was !== undefined && samePiece(was, piece) ? was : piece;
  });
}
