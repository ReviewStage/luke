/**
 * call-thread.ts -- the Call tab's one thread: what was said on the task's calls, each brain turn's work placed under the line that asked for it.
 *
 * The thread reads as a coding agent's transcript reads, the way a voice
 * call lands in a chat thread: the developer's lines and Luke's, call after
 * call, and the work Luke did for a line drawn right under it. The tie is
 * the record's own: a turn names the spoken lines it took as its ask by the
 * row id the voice's ledger minted for each (`asked`), and a line read back
 * from the record names its rows the same way (`lineTies`). A line heard
 * on the call standing now carries the voice window's own row id, which the
 * service never sees, so it is tied by where on the call it was said: the
 * turn says where each of its lines began (`askedAt`), and the heard line
 * says the span its words cover. A turn whose ask spans several lines
 * stands under the last of them, since that is where the ask was complete,
 * and stays there however many lines are said after it. A turn no line on
 * screen asked for, one typed, one whose lines are not read yet, or one
 * whose lines are past what the transcript holds, stands where it started:
 * inside the call it started on, by time among its lines, after the last
 * line that began before it and at the call's top where none had, while
 * that call stands or before its recorded end; between calls once it had
 * ended, or where its end is not on record; or ahead of every call. The
 * look around that opens every call, which the voice asks before the
 * developer has said anything, is such a turn, and stands at the call's
 * top. A line that says no time keeps the turn after it, as every line
 * read from a service older than the span does, so such a transcript
 * reads as it did. A turn's words are Luke's to say where the voice asked
 * for the turn, whether a line on screen did or not, so they are folded
 * with its work either way (`spoken`).
 * Nothing here draws or knows what a turn is beyond its key, start, ask,
 * and whether the voice asked for it, so the thread takes a turn in
 * whatever shape its wire reads it.
 */

import { TRANSCRIPT_SPEAKER } from "@luke/live";
import type { UIMessage } from "ai";
import { Option, Schema } from "effect";
import { callStart, type TranscriptCallRow } from "./transcript-model.js";

/** What the thread is made of: a call with its lines and the work under them, a line, and a turn's work. */
export const THREAD_ITEM = {
  CALL: "call",
  LINE: "line",
  WORK: "work",
} as const;

/** Where a line a turn took as its ask began: the call it was said on, by the store's id for its session, and the milliseconds into it. */
interface AskedAt {
  readonly voiceSessionId: string;
  readonly fromMs: number;
}

/** A brain turn as the thread places it: its key, when it started, the rows of the lines it took as its ask and where each began, whether the voice asked for it, and the turn itself. */
export interface CallTurn<T> {
  readonly key: string;
  readonly startedAt: number;
  readonly asked: readonly string[];
  readonly askedAt: readonly AskedAt[];
  /** Whether the voice asked for the turn, so Luke says its words aloud though no line on screen asked for it. */
  readonly spoken: boolean;
  readonly turn: T;
}

/** A turn's work as the thread draws it, and whether Luke says its words aloud: the voice asked for it, or a line on screen did. */
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

/** What a line's metadata says of where it stands: its rows, as the transcript's wire writes them, or its span on the call, as a line heard on the call standing now carries it. */
const LineTiesSchema = Schema.Struct({
  rowIds: Schema.optionalKey(Schema.Array(Schema.String)),
  span: Schema.optionalKey(Schema.Struct({ startMs: Schema.Number, endMs: Schema.Number })),
});

type LineTies = typeof LineTiesSchema.Type;

const readLineTies = Schema.decodeUnknownOption(LineTiesSchema);

/** The rows a line was written as and the span it covers, each where it says; nothing for a line that says neither. */
function lineTies(line: UIMessage): LineTies {
  return Option.getOrElse(readLineTies(line.metadata), () => ({}));
}

/** A line on screen with its place in the whole thread, which orders the lines a turn took as its ask. */
interface PlacedLine {
  readonly line: UIMessage;
  readonly place: number;
}

/** A developer's line heard on a call with the span its words cover. */
interface HeardLine extends PlacedLine {
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * The line each turn stands under, by the turn's key: the last line on
 * screen it took as its ask, found by its row where the line names its rows
 * and by where it began where the line was heard on the call standing now.
 */
function anchorsOf<T>(
  calls: readonly TranscriptCallRow[],
  turns: readonly CallTurn<T>[],
): ReadonlyMap<string, UIMessage> {
  const lineOfRow = new Map<string, PlacedLine>();
  const heardOn = new Map<string, HeardLine[]>();
  let place = 0;
  for (const call of calls) {
    for (const line of call.messages) {
      const { rowIds = [], span } = lineTies(line);
      for (const rowId of rowIds) lineOfRow.set(rowId, { line, place });
      // Note that only the developer's lines are kept, because the speakers' spans may overlap and an ask is the developer's.
      if (span !== undefined && line.role === TRANSCRIPT_SPEAKER.USER) {
        heardOn.set(call.key, [...(heardOn.get(call.key) ?? []), { line, place, ...span }]);
      }
      place += 1;
    }
  }
  const heardAt = ({ voiceSessionId, fromMs }: AskedAt) =>
    (heardOn.get(voiceSessionId) ?? []).filter(
      (heard) => fromMs >= heard.startMs && fromMs <= heard.endMs,
    );
  const anchors = new Map<string, UIMessage>();
  for (const turn of turns) {
    const lines = [
      ...turn.asked.flatMap((rowId) => lineOfRow.get(rowId) ?? []),
      ...turn.askedAt.flatMap(heardAt),
    ];
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

/** When a line began, in epoch milliseconds, as the call's start and the line's span on it say; nothing for a line that says no span. */
function lineStart(call: TranscriptCallRow, line: UIMessage): number | undefined {
  const { span } = lineTies(line);
  return span === undefined ? undefined : call.startedAt + span.startMs;
}

/**
 * The last of the call's lines that began before the turn started, which a
 * turn no line asked for stands after; none where no line had, which puts
 * the turn at the call's top. Note that a line that says no time counts as
 * begun before, because a transcript from a service older than the span
 * then reads as it did, the turn after its lines.
 */
function lineBefore<T>(call: TranscriptCallRow, turn: CallTurn<T>): UIMessage | undefined {
  return call.messages.findLast((line) => {
    const began = lineStart(call, line);
    return began === undefined || began <= turn.startedAt;
  });
}

/** The thread: each call with its lines and the work under them, and the work that stands between calls, oldest first. */
export function callThread<T>(
  calls: readonly TranscriptCallRow[],
  turns: readonly CallTurn<T>[],
): readonly ThreadSection<T>[] {
  const anchors = anchorsOf(calls, turns);
  const byStart = turns.toSorted((left, right) => left.startedAt - right.startedAt);
  const placed = byStart.filter((turn) => !anchors.has(turn.key));
  const work = (turn: CallTurn<T>): ThreadWork<T> => ({
    kind: THREAD_ITEM.WORK,
    turn,
    spoken: turn.spoken || anchors.has(turn.key),
  });
  const between = (call: number, after: boolean) =>
    placed.filter((turn) => {
      const slot = slotOf(calls, turn);
      return slot.call === call && slot.after === after;
    });
  const sections: ThreadSection<T>[] = between(-1, false).map(work);
  for (const [index, call] of calls.entries()) {
    // A turn no line asked for stands by time among the lines: after the last that began before it, at the top where none had.
    const after = new Map<UIMessage | undefined, CallTurn<T>[]>();
    for (const turn of between(index, false)) {
      const line = lineBefore(call, turn);
      after.set(line, [...(after.get(line) ?? []), turn]);
    }
    const entries: CallEntry<T>[] = (after.get(undefined) ?? []).map(work);
    for (const line of call.messages) {
      entries.push({ kind: THREAD_ITEM.LINE, line });
      // Under one line stand the turns it asked for and those that fall after it by time, in the order they started.
      const under = [
        ...byStart.filter((turn) => anchors.get(turn.key) === line),
        ...(after.get(line) ?? []),
      ].toSorted((left, right) => left.startedAt - right.startedAt);
      entries.push(...under.map(work));
    }
    sections.push({ kind: THREAD_ITEM.CALL, call, entries });
    sections.push(...between(index, true).map(work));
  }
  return sections;
}
