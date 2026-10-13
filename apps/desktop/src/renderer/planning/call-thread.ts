/**
 * call-thread.ts -- the Call tab's one thread: what was said on the plan's calls, each planning turn's work placed under the line that asked for it.
 *
 * The thread reads as a coding agent's transcript reads, the way a voice
 * call lands in a chat thread: the developer's lines and Luke's, call after
 * call, and the work Luke did for a line drawn right under it. The tie is
 * the record's own: a turn names the spoken lines it took as its ask by the
 * row id the voice's ledger minted for each (`asked`), and a line names its
 * rows the same way (`lineRowIds`), whether it was read back from the
 * record or heard on the call standing now. A turn whose ask spans several lines
 * stands under the last of them, since that is where the ask was complete.
 * A turn no line on screen asked for, one typed, one whose lines are not
 * read yet, or one whose lines are past what the transcript holds, stands
 * where it started: inside the call it started on, after its lines, while
 * that call stands or before its recorded end; between calls once it had
 * ended, or where its end is not on record; or ahead of every call.
 * Nothing here draws or knows what a turn is beyond its key, start, and
 * ask, so the thread takes a turn in whatever shape its wire reads it.
 */

import type { UIMessage } from "ai";
import { Option, Schema } from "effect";
import { callStart, type TranscriptCallRow } from "./transcript-model";

/** What the thread is made of: a call with its lines and the work under them, a line, and a turn's work. */
export const THREAD_ITEM = {
  CALL: "call",
  LINE: "line",
  WORK: "work",
} as const;

/** A planning turn as the thread places it: its key, when it started, the rows of the lines it took as its ask, and the turn itself. */
export interface CallTurn<T> {
  readonly key: string;
  readonly startedAt: number;
  readonly asked: readonly string[];
  readonly turn: T;
}

/** A turn's work as the thread draws it, and whether a line on screen asked for it, which is when Luke said its words aloud. */
interface ThreadWork<T> {
  readonly kind: typeof THREAD_ITEM.WORK;
  readonly turn: CallTurn<T>;
  readonly spoken: boolean;
}

/** One entry of a call: a line said on it, or a turn's work. */
type CallEntry<T> =
  | { readonly kind: typeof THREAD_ITEM.LINE; readonly line: UIMessage }
  | ThreadWork<T>;

/** One section of the thread: a call and what stands inside it, or a turn's work between calls. */
export type ThreadSection<T> =
  | {
      readonly kind: typeof THREAD_ITEM.CALL;
      readonly call: TranscriptCallRow;
      readonly entries: readonly CallEntry<T>[];
    }
  | ThreadWork<T>;

/** What a line's metadata says of its rows, as the transcript's wire and the live call's report both write it. */
const LineRowsSchema = Schema.Struct({ rowIds: Schema.Array(Schema.String) });

const readLineRows = Schema.decodeUnknownOption(LineRowsSchema);

/** The rows a line was written as, which a turn names its ask by; none for a line whose rows the record does not hold. */
function lineRowIds(line: UIMessage): readonly string[] {
  return Option.match(readLineRows(line.metadata), {
    onNone: () => [],
    onSome: (rows) => rows.rowIds,
  });
}

/** The line each turn stands under, by the turn's key: the last line on screen it took as its ask. */
function anchorsOf<T>(
  calls: readonly TranscriptCallRow[],
  turns: readonly CallTurn<T>[],
): ReadonlyMap<string, UIMessage> {
  // Each line on screen by its row, with its place in the whole thread.
  const lineOfRow = new Map<string, { readonly line: UIMessage; readonly place: number }>();
  for (const [place, line] of calls.flatMap((call) => call.messages).entries()) {
    for (const rowId of lineRowIds(line)) lineOfRow.set(rowId, { line, place });
  }
  const anchors = new Map<string, UIMessage>();
  for (const turn of turns) {
    const lines = turn.asked.flatMap((rowId) => lineOfRow.get(rowId) ?? []);
    const last = lines.toSorted((left, right) => left.place - right.place).at(-1);
    if (last !== undefined) anchors.set(turn.key, last.line);
  }
  return anchors;
}

/** Where a turn no line asked for stands: the index of the last call that started before it, and whether it stands after that call rather than inside it. */
interface Slot {
  readonly call: number;
  readonly after: boolean;
}

/**
 * The slot a turn no line asked for takes. Note that a call that ended with
 * no end on record holds none, because a turn spoken on it would have named
 * its lines, so one that did not is the developer's or Luke's own, after it.
 */
function slotOf<T>(calls: readonly TranscriptCallRow[], turn: CallTurn<T>): Slot {
  const index = calls.findLastIndex((each) => callStart(each) <= turn.startedAt);
  const call = calls[index];
  const endedAt = call?.record?.endedAt;
  const inside = call?.live === true || (endedAt !== undefined && turn.startedAt <= endedAt);
  return { call: index, after: call !== undefined && !inside };
}

/** The thread: each call with its lines and the work under them, and the work that stands between calls, oldest first. */
export function callThread<T>(
  calls: readonly TranscriptCallRow[],
  turns: readonly CallTurn<T>[],
): readonly ThreadSection<T>[] {
  const anchors = anchorsOf(calls, turns);
  const byStart = turns.toSorted((left, right) => left.startedAt - right.startedAt);
  const placed = byStart.filter((turn) => !anchors.has(turn.key));
  const work = (turn: CallTurn<T>, spoken: boolean): ThreadWork<T> => ({
    kind: THREAD_ITEM.WORK,
    turn,
    spoken,
  });
  const between = (call: number, after: boolean) =>
    placed.filter((turn) => {
      const slot = slotOf(calls, turn);
      return slot.call === call && slot.after === after;
    });
  const sections: ThreadSection<T>[] = between(-1, false).map((turn) => work(turn, false));
  for (const [index, call] of calls.entries()) {
    const entries: CallEntry<T>[] = [];
    for (const line of call.messages) {
      entries.push({ kind: THREAD_ITEM.LINE, line });
      const under = byStart.filter((turn) => anchors.get(turn.key) === line);
      entries.push(...under.map((turn) => work(turn, true)));
    }
    entries.push(...between(index, false).map((turn) => work(turn, false)));
    sections.push({ kind: THREAD_ITEM.CALL, call, entries });
    sections.push(...between(index, true).map((turn) => work(turn, false)));
  }
  return sections;
}
