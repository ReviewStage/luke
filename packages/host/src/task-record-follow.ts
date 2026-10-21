import {
  type TaskRecordLiveAnswer,
  type TaskRecordLiveRows,
  taskRecordLiveRowsSchema,
} from "@luke/features/live-wire";
import { Effect, Option, Schema, Stream } from "effect";
import { LiveBroken, type LiveClient, liveRows } from "./live-follow.js";

/**
 * task-record-follow.ts -- where an open task's pages and calls stand, followed by the host over a Neon Realtime subscription, so a part is read again only once its mark moved.
 *
 * The service seals one statement a part (`task-record-live.ts`), each a
 * mark that moves as its rows do and carries none of their words. The host
 * subscribes to them (`live-follow.ts`) for as long as the task stands open,
 * as it does the board (`board-follow.ts`), and answers each delivery with
 * the parts it moved, which the caller reads again from the service. The
 * sealed statements stay here, beside the account's own bearer; only which
 * parts moved leaves.
 */

/** A part of the record the panel reads again once its mark moves. */
export const TASK_RECORD_PART = {
  PAGES: "pages",
  CALLS: "calls",
} as const;

export type TaskRecordPart = (typeof TASK_RECORD_PART)[keyof typeof TASK_RECORD_PART];

/** Every part, which the first delivery moves, since the reads the task opened with may have missed what it says. */
const EVERY_TASK_RECORD_PART: readonly TaskRecordPart[] = Object.values(TASK_RECORD_PART);

/** A seal the service did not answer, `gone` where the task is no longer the account's. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

export interface TaskRecordFollowDependencies {
  /** The record sealed again, for renewing; a failure where the service sealed none. */
  readonly seal: () => Effect.Effect<TaskRecordLiveAnswer | Unsealed>;
  /** The record's rows inline, polled while Realtime fails or is off, held past `after`; failures as `seal`'s. */
  readonly poll: (after: string | undefined) => Effect.Effect<TaskRecordLiveAnswer | Unsealed>;
  /** Realtime's client at the address the service named, loaded where it must be. */
  readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
  readonly now: () => number;
}

/** A part's rows as one comparable value. */
function markOf<Row>(rows: readonly Row[], key: (row: Row) => string): string {
  return JSON.stringify(rows.toSorted((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)));
}

/** The calls whose words the record now holds whole: each that ended, since a call that stands tells its own as it goes. */
function endedCalls(rows: TaskRecordLiveRows): string {
  return markOf(
    rows.calls.filter((call) => call.closedAt !== null),
    (call) => call.id,
  );
}

/**
 * The parts a delivery moved from the one before: the pages where their
 * rows differ, and the calls where an ended call's do, so a call's words
 * landing as it stands read nothing and its end, its last words, and its
 * metering each read the calls again. The first delivery moves every part.
 */
function movedParts(
  before: TaskRecordLiveRows | undefined,
  rows: TaskRecordLiveRows,
): readonly TaskRecordPart[] {
  if (before === undefined) return EVERY_TASK_RECORD_PART;
  const pagesOf = (read: TaskRecordLiveRows) => markOf(read.pages, (page) => page.pageId);
  return [
    ...(pagesOf(before) === pagesOf(rows) ? [] : [TASK_RECORD_PART.PAGES]),
    ...(endedCalls(before) === endedCalls(rows) ? [] : [TASK_RECORD_PART.CALLS]),
  ];
}

/**
 * The parts of the record each delivery moved, from the first seal for as
 * long as the caller's scope stands, a delivery that moved none left out.
 * It fails where the subscription stops for good or a row does not decode,
 * which the caller answers by sealing it again.
 */
export function taskRecordMoves(
  dependencies: TaskRecordFollowDependencies,
  first: TaskRecordLiveAnswer,
): Stream.Stream<readonly TaskRecordPart[], LiveBroken> {
  const decode = Schema.decodeUnknownOption(taskRecordLiveRowsSchema);
  return liveRows(
    {
      openLive: dependencies.openLive,
      reseal: dependencies.seal,
      poll: dependencies.poll,
      now: dependencies.now,
    },
    first,
  ).pipe(
    Stream.mapEffect((read) =>
      Option.match(decode(read), {
        onNone: () => Effect.fail(new LiveBroken({ reason: "a row did not decode" })),
        onSome: Effect.succeed,
      }),
    ),
    Stream.mapAccum(
      (): TaskRecordLiveRows | undefined => undefined,
      (before: TaskRecordLiveRows | undefined, rows: TaskRecordLiveRows) => {
        const moved = movedParts(before, rows);
        return [rows, moved.length === 0 ? [] : [moved]] as const;
      },
    ),
  );
}
