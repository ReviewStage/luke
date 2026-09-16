import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  type ConversationViewMessage,
  type ConversationViewSnapshot,
  type LiveConversationLine,
} from "@sidecar/session";
import { MESSAGE_ROLE, type MessageRole } from "@sidecar/wire";

/**
 * The hand-off from a line still being said to the record of it. The voice
 * window reports every row of the standing call, settled or not, with the
 * span each stands in on the session's timeline; the service writes each row
 * behind its fragments and flushes what is left when the call closes; and
 * this device reads the record on a poll. A reported line is drawn until the
 * record holds a row of the same speaker whose span overlaps the line's on
 * the same voice session, and then the row is drawn and the line is not. The
 * words are matched by nothing: the two ledgers group the same fragments, so
 * a row a fragment short of the caption still stands for it, and the same
 * word said twice is two spans. No clock bounds a line here: a line whose
 * row never comes is drawn for as long as the call reports it, and the
 * call's report ending drops every line with it, since the close flushed
 * whatever was owed.
 *
 * The record names a voice session by the store's own row id, which this
 * device never learns, so the call's session is read off the record instead:
 * it is the newest voice session that had no row on record when the call
 * opened, since one device's calls run one after another and a session's
 * first row is written only after its first fragment has been reported here.
 * Its start on the service's clock is where any of its rows is placed, less
 * the row's offset into the session, and that is what puts a line still
 * being said where its row will land.
 *
 * Pure over what it is handed, so the panel's hook keeps the state and the
 * test drives it by hand.
 */

/** The record as it stood when the call opened: the voice sessions that already had a row on it. */
interface RecordBefore {
  readonly sessionIds: ReadonlySet<string>;
}

export interface LiveLineHold {
  /** The voice window's last report. */
  readonly lines: readonly LiveConversationLine[];
  /**
   * What was on record when the call's first line was reported, taken from
   * the first settled read while the call stands and let go with the call;
   * nothing while no call is reported or no read has landed since it opened.
   */
  readonly before: RecordBefore | undefined;
}

export const NO_LIVE_LINES: LiveLineHold = { lines: [], before: undefined };

/** One line drawn ahead of the record, and where on the thread its row will land. */
export interface PlacedLiveEntry {
  readonly entry: ConversationEntry;
  /**
   * The instant the row will be placed at, on the service's clock: the
   * session's start plus the line's offset into it. Nothing while no row of
   * the call has yet told the record where the session started, in which
   * case the line is drawn after everything recorded, which is where a line
   * of a call with nothing on record yet belongs.
   */
  readonly at: number | undefined;
}

/** One voice row of the record as the lines are matched against it: whose it is, which session, and the span it was cut from. */
interface RecordedSpan {
  readonly role: MessageRole;
  readonly sessionId: string;
  /** Where the session started on the service's clock: the row's place, less its offset into the session. */
  readonly sessionStart: number;
  readonly fromMs: number;
  readonly toMs: number;
}

function sameLines(
  left: readonly LiveConversationLine[],
  right: readonly LiveConversationLine[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((line, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      line.rowId === other.rowId &&
      line.settled === other.settled &&
      line.startMs === other.startMs &&
      line.endMs === other.endMs &&
      line.entry.kind === other.entry.kind &&
      line.entry.words === other.entry.words
    );
  });
}

/** The stored role a spoken kind is written as; the two kinds a live line can be, and nothing for the rest. */
function roleOfKind(kind: ConversationEntryKind): MessageRole | undefined {
  switch (kind) {
    case CONVERSATION_ENTRY_KIND.ASK:
      return MESSAGE_ROLE.USER;
    case CONVERSATION_ENTRY_KIND.REPLY:
      return MESSAGE_ROLE.ASSISTANT;
    default:
      return undefined;
  }
}

/**
 * A stored row as a span of a voice session, or nothing for a row that was
 * not cut from one: a typed ask, a note, a written reply, a system row. The
 * two speaking roles carry the voice fields under their own metadata shapes,
 * so each is read under its role.
 */
function recordedSpanOf(view: ConversationViewMessage): RecordedSpan | undefined {
  const { message } = view;
  if (message.role !== MESSAGE_ROLE.USER && message.role !== MESSAGE_ROLE.ASSISTANT) {
    return undefined;
  }
  const { metadata } = message;
  if (!("voice_session_id" in metadata)) return undefined;
  const sessionId = metadata.voice_session_id;
  const fromMs = metadata.from_ms;
  const toMs = metadata.to_ms;
  if (sessionId === undefined || fromMs === undefined || toMs === undefined) return undefined;
  return {
    role: message.role,
    sessionId,
    sessionStart: view.placedAt - fromMs,
    fromMs,
    toMs,
  };
}

function recordedSpans(view: ConversationViewSnapshot): RecordedSpan[] {
  const spans: RecordedSpan[] = [];
  for (const group of view.groups) {
    for (const message of group.messages) {
      const span = recordedSpanOf(message);
      if (span) spans.push(span);
    }
  }
  return spans;
}

/** The call's session as the record shows it: the newest session with no row on record when the call opened, by its start. */
function callSession(
  spans: readonly RecordedSpan[],
  before: RecordBefore,
): { id: string; start: number } | undefined {
  let newest: { id: string; start: number } | undefined;
  for (const span of spans) {
    if (before.sessionIds.has(span.sessionId)) continue;
    if (newest === undefined || span.sessionStart > newest.start) {
      newest = { id: span.sessionId, start: span.sessionStart };
    }
  }
  return newest;
}

/** Whether a row's span and a line's share an instant, the ends included, since a fragment's end is the next one's start. */
function overlaps(row: RecordedSpan, line: LiveConversationLine): boolean {
  return row.fromMs <= line.endMs && line.startMs <= row.toMs;
}

/**
 * Takes the voice window's next report into the hold beside the record as
 * it stands. A report with no line ends the call here, whatever was drawn: a
 * line with no row by then had its row flushed at the close or is not
 * getting one. The first report of a call stamps what the record already
 * held, once a read has landed, so the call's own session is told from the
 * last call's. Answers the same hold where nothing moved, so a report that
 * changed nothing here redraws nothing.
 */
export function foldLiveLines(
  hold: LiveLineHold,
  lines: readonly LiveConversationLine[],
  view: ConversationViewSnapshot,
): LiveLineHold {
  if (lines.length === 0) return NO_LIVE_LINES;
  const before =
    hold.before ??
    (view.settled
      ? { sessionIds: new Set(recordedSpans(view).map((span) => span.sessionId)) }
      : undefined);
  if (before === hold.before && sameLines(hold.lines, lines)) return hold;
  return { lines, before };
}

/**
 * The lines the Conversation tab draws ahead of the record, each where its
 * row will land: the reported lines less every one a row of the call's
 * session already stands for, by speaker and span. Before the record has
 * been read since the call opened, no session is the call's, and every line
 * is drawn.
 */
export function shownLiveEntries(
  hold: LiveLineHold,
  view: ConversationViewSnapshot,
): readonly PlacedLiveEntry[] {
  if (hold.lines.length === 0) return [];
  const spans = recordedSpans(view);
  const session = hold.before === undefined ? undefined : callSession(spans, hold.before);
  const rows = session === undefined ? [] : spans.filter((span) => span.sessionId === session.id);
  return hold.lines.flatMap((line): PlacedLiveEntry[] => {
    const role = roleOfKind(line.entry.kind);
    if (role !== undefined && rows.some((row) => row.role === role && overlaps(row, line))) {
      return [];
    }
    return [
      { entry: line.entry, at: session === undefined ? undefined : session.start + line.startMs },
    ];
  });
}
