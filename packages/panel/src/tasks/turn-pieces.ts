import { sameShape, TURN_ROW_DEPTH, type TurnRow } from "@repo/features/turn-rows";
import type { AgentPart, TurnStretch } from "./agent-model.js";

export const PIECE_ROWS = 6;

export interface TurnPiece {
  readonly stretches: readonly TurnStretch[];
  readonly first: boolean;
  readonly last: boolean;
  readonly continues: boolean;
}

type Unit =
  | { readonly stretch: number; readonly line: TurnStretch["line"] & object }
  | { readonly stretch: number; readonly row: TurnRow<AgentPart> };

function unitsOf(stretches: readonly TurnStretch[]): readonly Unit[] {
  return stretches.flatMap((stretch, at): Unit[] =>
    stretch.line !== undefined
      ? [{ stretch: at, line: stretch.line }]
      : stretch.rows.map((row) => ({ stretch: at, row })),
  );
}

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

export function turnPieces(
  stretches: readonly TurnStretch[],
  size: number = PIECE_ROWS,
): readonly TurnPiece[] {
  const units = unitsOf(stretches);
  if (units.length <= size * 2 || !units.some((unit) => "row" in unit)) {
    return [{ stretches, first: true, last: true, continues: false }];
  }
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

export function pieceKey(turnKey: string, at: number): string {
  return at === 0 ? turnKey : `${turnKey}/${String(at)}`;
}

function samePiece(a: TurnPiece, b: TurnPiece): boolean {
  return sameShape(a, b, TURN_ROW_DEPTH + 2);
}

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
