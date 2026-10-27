import {
  type TaskBoardLiveAnswer,
  type TaskBoardLiveRows,
  taskBoardLiveRowsSchema,
} from "@luke/features/live-wire";
import { type Effect, Stream } from "effect";
import { decodedLiveRows, type LiveBroken, type TxWait } from "./live-follow.js";

/**
 * board-follow.ts -- where the open task's whiteboard stands, followed by the host over the service's held poll, so the board is read again the moment it moves.
 *
 * The service answers one statement that marks the board
 * (`boardLiveStatement` in the database's board store): Luke's latest
 * drawing's number, the drawing the scene holds, and whether the scene holds
 * its image. The host follows it (`live-follow.ts`) for as long as the task
 * stands open, and answers each delivery whose mark moved, the first among
 * them, which the caller answers by reading the board again from the
 * service. Only that the board moved leaves.
 */

export interface BoardFollowDependencies {
  /** The board's rows inline, held past `after`; a failure where the service answered none, `gone` where the task is no longer the account's. */
  readonly poll: (
    after: string | undefined,
  ) => Effect.Effect<TaskBoardLiveAnswer | { readonly failure: string; readonly gone?: boolean }>;
  /** Handed a wait on a save's transaction where the follow has one, and `undefined` once it is let go (`liveRows`). */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The board's mark as one comparable value, its rows in order of the task they name. */
function markOf(rows: TaskBoardLiveRows): string {
  return JSON.stringify(
    rows.board
      .map((row) => [row.taskId, row.drawingNumber, row.appliedDrawing, row.imaged] as const)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * The board's rows each time its mark moves, the first delivery among
 * them, since the read the task opened with may have missed what it says,
 * for as long as the caller's scope stands. It fails where the read is gone
 * or a row does not decode, which the caller answers by reading it again.
 */
export function boardMoves(
  dependencies: BoardFollowDependencies,
  first: TaskBoardLiveAnswer,
): Stream.Stream<TaskBoardLiveRows, LiveBroken> {
  return decodedLiveRows(
    { poll: dependencies.poll, onTxWait: dependencies.onTxWait },
    first,
    taskBoardLiveRowsSchema,
  ).pipe(Stream.changesWith((before, rows) => markOf(before) === markOf(rows)));
}
