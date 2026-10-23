import {
  type TaskBoardLiveAnswer,
  type TaskBoardLiveRows,
  taskBoardLiveRowsSchema,
} from "@luke/features/live-wire";
import { type Effect, Stream } from "effect";
import { decodedLiveRows, type LiveBroken, type LiveClient, type TxWait } from "./live-follow.js";

/**
 * board-follow.ts -- where the open task's whiteboard stands, followed by the host over a Neon Realtime subscription, so the board is read again the moment it moves.
 *
 * The service seals one statement that marks the board (`boardLiveStatement`
 * in the database's board store): Luke's latest drawing's number, the
 * drawing the scene holds, and whether the scene holds its image. The host
 * subscribes to it (`live-follow.ts`) for as long as the task stands open,
 * and answers each delivery whose mark moved, the first among them, which
 * the caller answers by reading the board again from the service. The
 * sealed statement stays here, beside the account's own bearer; only that
 * the board moved leaves.
 */

export interface BoardFollowDependencies {
  /** The board sealed again, for renewing; a failure where the service sealed none, `gone` where the task is no longer the account's. */
  readonly seal: () => Effect.Effect<
    TaskBoardLiveAnswer | { readonly failure: string; readonly gone?: boolean }
  >;
  /** The board's rows inline, polled while Realtime fails or is off, held past `after`; failures as `seal`'s. */
  readonly poll: (
    after: string | undefined,
  ) => Effect.Effect<TaskBoardLiveAnswer | { readonly failure: string; readonly gone?: boolean }>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
  /** Handed a wait on a save's transaction once the board is followed over Realtime, and `undefined` once it is let go or polled (`liveRows`). */
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
 * for as long as the caller's scope stands. It fails where the subscription
 * stops for good or a row does not decode, which the caller answers by
 * sealing it again.
 */
export function boardMoves(
  dependencies: BoardFollowDependencies,
  first: TaskBoardLiveAnswer,
): Stream.Stream<TaskBoardLiveRows, LiveBroken> {
  return decodedLiveRows(
    {
      openLive: dependencies.openLive,
      reseal: dependencies.seal,
      poll: dependencies.poll,
      now: dependencies.now,
      onTxWait: dependencies.onTxWait,
    },
    first,
    taskBoardLiveRowsSchema,
  ).pipe(Stream.changesWith((before, rows) => markOf(before) === markOf(rows)));
}
