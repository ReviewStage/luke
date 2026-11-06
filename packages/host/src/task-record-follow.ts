import {
  type TaskRecordLiveAnswer,
  type TaskRecordLiveRows,
  taskRecordLiveRowsSchema,
} from "@repo/features/live-wire";
import { type Effect, Stream } from "effect";
import { decodedLiveRows, type LiveBroken, type TxWait } from "./live-follow.js";

/**
 * task-record-follow.ts -- where an open task's plan stands, followed by the host over the service's held poll, so the plan is read again only once its mark moved.
 *
 * The service answers one statement a part (`task-record-live.ts`), each a
 * mark that moves as its rows do and carries none of their words. The host
 * follows them (`live-follow.ts`) for as long as a window holds the task's
 * plan (`description-document-reads.ts`), and answers each delivery that moved the
 * plan with when it was last saved, which the caller reads again from the
 * service, and a write of the plan waits on the record for its transaction. The pages, calls, and code
 * parts the service still answers for a released desktop are compared by no
 * one: a window holds a task's pages on their own read (`LIVE_READ.PAGES`),
 * the app takes no calls, and no window draws the code agents showed. Only
 * the plan's last save leaves.
 */

/** What a delivery that moved the plan says: when the plan was last saved, none for a task the account no longer reaches. */
export interface TaskRecordMove {
  readonly descriptionSavedAt: number | undefined;
}

/** A read the service did not answer, `gone` where the task is no longer the account's. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

export interface TaskRecordFollowDependencies {
  /** The record's rows inline, held past `after`; a failure where the service answered none. */
  readonly poll: (after: string | undefined) => Effect.Effect<TaskRecordLiveAnswer | Unsealed>;
  /** Handed how to wait for a write's transaction on the record once it hands one, and none once it is let go (`live-follow.ts`). */
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

/** The plan's rows as one comparable value. */
function descriptionMarkOf(rows: TaskRecordLiveRows): string {
  return JSON.stringify(
    rows.plan.toSorted((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)),
  );
}

/**
 * Each delivery that moved the plan, with its last save as it delivered it,
 * from the first answer, which always moves it, for as long as the caller's
 * scope stands. It fails where the read is gone or a row does not decode,
 * which the caller answers by reading it again.
 */
export function taskRecordMoves(
  dependencies: TaskRecordFollowDependencies,
  first: TaskRecordLiveAnswer,
): Stream.Stream<TaskRecordMove, LiveBroken> {
  return decodedLiveRows(
    { poll: dependencies.poll, onTxWait: dependencies.onTxWait },
    first,
    taskRecordLiveRowsSchema,
  ).pipe(
    Stream.mapAccum(
      (): string | undefined => undefined,
      (before: string | undefined, rows: TaskRecordLiveRows) => {
        const mark = descriptionMarkOf(rows);
        const moved = mark === before ? [] : [{ descriptionSavedAt: rows.plan[0]?.savedAt }];
        return [mark, moved] as const;
      },
    ),
  );
}
