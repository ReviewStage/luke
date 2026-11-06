import {
  type TaskRecordLiveAnswer,
  type TaskRecordLiveRows,
  taskRecordLiveRowsSchema,
} from "@repo/features/live-wire";
import { type Effect, Stream } from "effect";
import { decodedLiveRows, type LiveBroken, type TxWait } from "./live-follow.js";

export interface TaskRecordMove {
  readonly descriptionSavedAt: number | undefined;
}

type Unsealed = { readonly failure: string; readonly gone?: boolean };

export interface TaskRecordFollowDependencies {
  readonly poll: (after: string | undefined) => Effect.Effect<TaskRecordLiveAnswer | Unsealed>;
  readonly onTxWait?: (wait: TxWait | undefined) => void;
}

function descriptionMarkOf(rows: TaskRecordLiveRows): string {
  return JSON.stringify(
    rows.description.toSorted((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0)),
  );
}

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
        const moved = mark === before ? [] : [{ descriptionSavedAt: rows.description[0]?.savedAt }];
        return [mark, moved] as const;
      },
    ),
  );
}
