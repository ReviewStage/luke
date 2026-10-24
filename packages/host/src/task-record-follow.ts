import {
  type TaskRecordLiveAnswer,
  type TaskRecordLiveRows,
  taskRecordLiveRowsSchema,
} from "@luke/features/live-wire";
import { type Effect, Stream } from "effect";
import { decodedLiveRows, type LiveBroken, type LiveClient } from "./live-follow.js";

/**
 * task-record-follow.ts -- where an open task's plan, pages, and agents' code stand, followed by the host over a Neon Realtime subscription, so a part is read again only once its mark moved.
 *
 * The service seals one statement a part (`task-record-live.ts`), each a
 * mark that moves as its rows do and carries none of their words. The host
 * subscribes to them (`live-follow.ts`) for as long as the task stands open,
 * as it does the board (`board-follow.ts`), and answers each delivery with
 * the parts it moved, which the caller reads again from the service. The
 * calls part the service still seals is read by no one: every call speaks
 * into an agent, whose own transcript says what was said. The sealed
 * statements stay here, beside the account's own bearer; only which
 * parts moved leaves.
 */

/** A part of the record the panel reads again once its mark moves. */
export const TASK_RECORD_PART = {
  PLAN: "plan",
  PAGES: "pages",
  CODE: "code",
} as const;

export type TaskRecordPart = (typeof TASK_RECORD_PART)[keyof typeof TASK_RECORD_PART];

/** Every part, which the first delivery moves, since the reads the task opened with may have missed what it says. */
const EVERY_TASK_RECORD_PART: readonly TaskRecordPart[] = Object.values(TASK_RECORD_PART);

/** What a delivery moved: its parts, and when the plan was last saved as it delivered it, none for a task the account no longer reaches. */
export interface TaskRecordMove {
  readonly parts: readonly TaskRecordPart[];
  readonly planSavedAt: number | undefined;
}

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

/**
 * The parts a delivery moved from the one before: the plan where its last
 * save moved, the pages where their rows differ, and the code where the `show_code` calls the agents'
 * journals answered do. The first delivery moves every part.
 */
function movedParts(
  before: TaskRecordLiveRows | undefined,
  rows: TaskRecordLiveRows,
): readonly TaskRecordPart[] {
  if (before === undefined) return EVERY_TASK_RECORD_PART;
  const planOf = (read: TaskRecordLiveRows) => markOf(read.plan, (plan) => plan.taskId);
  const pagesOf = (read: TaskRecordLiveRows) => markOf(read.pages, (page) => page.pageId);
  const codeOf = (read: TaskRecordLiveRows) => markOf(read.code, (journal) => journal.id);
  return [
    ...(planOf(before) === planOf(rows) ? [] : [TASK_RECORD_PART.PLAN]),
    ...(pagesOf(before) === pagesOf(rows) ? [] : [TASK_RECORD_PART.PAGES]),
    ...(codeOf(before) === codeOf(rows) ? [] : [TASK_RECORD_PART.CODE]),
  ];
}

/**
 * The parts of the record each delivery moved, with the plan's last save as
 * it delivered it, from the first seal for as
 * long as the caller's scope stands, a delivery that moved none left out.
 * It fails where the subscription stops for good or a row does not decode,
 * which the caller answers by sealing it again.
 */
export function taskRecordMoves(
  dependencies: TaskRecordFollowDependencies,
  first: TaskRecordLiveAnswer,
): Stream.Stream<TaskRecordMove, LiveBroken> {
  return decodedLiveRows(
    {
      openLive: dependencies.openLive,
      reseal: dependencies.seal,
      poll: dependencies.poll,
      now: dependencies.now,
    },
    first,
    taskRecordLiveRowsSchema,
  ).pipe(
    Stream.mapAccum(
      (): TaskRecordLiveRows | undefined => undefined,
      (before: TaskRecordLiveRows | undefined, rows: TaskRecordLiveRows) => {
        const parts = movedParts(before, rows);
        const planSavedAt = rows.plan[0]?.savedAt;
        return [rows, parts.length === 0 ? [] : [{ parts, planSavedAt }]] as const;
      },
    ),
  );
}
