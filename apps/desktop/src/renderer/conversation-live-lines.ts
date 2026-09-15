import {
  CONVERSATION_ENTRY_KIND,
  type ConversationEntry,
  type ConversationEntryKind,
  type ConversationViewSnapshot,
  type LiveConversationLine,
} from "@sidecar/session";
import type { StoredUIMessage } from "@sidecar/session/ui-messages";
import { MESSAGE_ROLE, type MessageRole } from "@sidecar/wire";

/**
 * The hand-off from a line still being said to the record of it. The voice
 * window reports every row of the standing call, settled or not; the service
 * writes a row once it settles; and this device reads the record on a poll.
 * Between the settle and the read the words are on neither feed unless
 * something holds them, and a row that leaves the report with the call —
 * the session closing, the voice window going — has the same gap at its
 * end. So a line is drawn until the record shows it: a reported line is
 * drawn as long as it is reported and not yet on record; a line that left
 * the report is held for {@link LIVE_LINE_HOLD_MS} more, or until the record
 * shows it, whichever is first; and a line the record holds is not drawn
 * twice. Nothing here decides on a clock what the record decides by
 * arriving; the clocks only bound a line whose record never comes — a write
 * the service refused, words it cut into a different row than the ledger's,
 * a session standing open long after the words — since a line drawn with no
 * row behind it has no time, no copy, and no rating, and stands under every
 * row that lands after it: a settled line still reported is let go
 * {@link LIVE_LINE_SETTLED_HOLD_MS} after it settled.
 *
 * Pure over what it is handed, so the panel's hook keeps the state and the
 * test drives it by hand.
 */

/** How long a line that left the voice window's report is still drawn while the record catches up. */
export const LIVE_LINE_HOLD_MS = 15_000;

/**
 * How long a settled line the report still carries is drawn without a row
 * behind it. The service writes a row as the line settles and this device
 * polls at once, so a record that has not shown the line by then is not
 * coming for it, and a line with no row is not left standing under the rows
 * that do land.
 */
export const LIVE_LINE_SETTLED_HOLD_MS = 30_000;

/**
 * How far before the call's first reported line a stored row may have been
 * created and still be read as this call's. The record's instants are the
 * service's clock and the call's is this Mac's, and a row is written only
 * after its words were heard here, so the slack stands for skew alone.
 */
export const LIVE_LINE_RECORD_SLACK_MS = 120_000;

/** A line that left the report, and when it did on this device's clock. */
interface HeldLiveLine {
  readonly entry: ConversationEntry;
  readonly since: number;
}

export interface LiveLineHold {
  /** The voice window's last report. */
  readonly lines: readonly LiveConversationLine[];
  /** When the standing call's first line was reported; nothing while no line stands or is held. */
  readonly openedAt: number | undefined;
  /** The lines that left the report and are still drawn, oldest first. */
  readonly held: readonly HeldLiveLine[];
  /** When each reported row was first seen settled, by row id, for the bound on a settled line the record never shows. */
  readonly settledAt: ReadonlyMap<number, number>;
  /**
   * The lines drawn ahead of the record as of the last fold: the held lines,
   * then the reported ones still inside their bound. What the record already
   * shows is taken off at drawing time, since the record moves on its own.
   */
  readonly entries: readonly ConversationEntry[];
  /**
   * The next instant a drawn line is let go on the clock — the oldest held
   * line's bound, or the oldest drawn settled line's — for the clock that
   * re-reads the hold; nothing while no drawn line stands under a bound. A
   * line already let go names no bound, so the clock re-arms for the next.
   */
  readonly expiresAt: number | undefined;
}

export const NO_LIVE_LINES: LiveLineHold = {
  lines: [],
  openedAt: undefined,
  held: [],
  settledAt: new Map(),
  entries: [],
  expiresAt: undefined,
};

/** Whether `next` is `previous` grown: the same kind, and the words so far a prefix of the words now. */
function continues(previous: ConversationEntry, next: ConversationEntry): boolean {
  return previous.kind === next.kind && next.words.startsWith(previous.words);
}

/** Whether the two are one row of one call: the same id, and the words grown rather than replaced by another call's row 1. */
function sameRow(previous: LiveConversationLine, next: LiveConversationLine): boolean {
  return previous.rowId === next.rowId && continues(previous.entry, next.entry);
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
      line.entry.kind === other.entry.kind &&
      line.entry.words === other.entry.words
    );
  });
}

function sameEntries(left: readonly ConversationEntry[], right: readonly ConversationEntry[]) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return other !== undefined && entry.kind === other.kind && entry.words === other.words;
  });
}

/** Whether a settled line the report still carries is still inside its bound, by when it was first seen settled. */
function settledLineDrawn(
  line: LiveConversationLine,
  settledAt: ReadonlyMap<number, number>,
  now: number,
): boolean {
  const since = settledAt.get(line.rowId);
  return since === undefined || now - since < LIVE_LINE_SETTLED_HOLD_MS;
}

/**
 * Takes the voice window's next report into the hold: a row the report no
 * longer carries is held from now, a held line the report carries again is
 * let go for the reported one, a held line past its bound is let go, a row
 * first seen settled is stamped, and a settled row past its own bound leaves
 * the drawn lines. Answers the same hold where nothing moved, so a report
 * that changed nothing here redraws nothing.
 */
export function foldLiveLines(
  hold: LiveLineHold,
  lines: readonly LiveConversationLine[],
  now: number,
): LiveLineHold {
  const left = hold.lines
    .filter((previous) => !lines.some((line) => sameRow(previous, line)))
    .map((line): HeldLiveLine => ({ entry: line.entry, since: now }));
  const kept = hold.held.filter(
    (held) =>
      now - held.since < LIVE_LINE_HOLD_MS &&
      !lines.some((line) => continues(held.entry, line.entry)),
  );
  const held =
    left.length === 0 && kept.length === hold.held.length ? hold.held : [...kept, ...left];
  const openedAt =
    lines.length > 0 ? (hold.openedAt ?? now) : held.length > 0 ? hold.openedAt : undefined;
  const settledAt = new Map<number, number>();
  for (const line of lines) {
    if (!line.settled) continue;
    const previous = hold.lines.find((standing) => sameRow(standing, line));
    const since = previous?.settled ? hold.settledAt.get(line.rowId) : undefined;
    settledAt.set(line.rowId, since ?? now);
  }
  const drawn = lines.filter((line) => settledLineDrawn(line, settledAt, now));
  const entries = [...held.map((line) => line.entry), ...drawn.map((line) => line.entry)];
  const bounds = [
    ...held.map((line) => line.since + LIVE_LINE_HOLD_MS),
    ...drawn.flatMap((line) => {
      const since = settledAt.get(line.rowId);
      return since === undefined ? [] : [since + LIVE_LINE_SETTLED_HOLD_MS];
    }),
  ];
  const expiresAt = bounds.length === 0 ? undefined : Math.min(...bounds);
  if (
    held === hold.held &&
    openedAt === hold.openedAt &&
    expiresAt === hold.expiresAt &&
    sameLines(hold.lines, lines) &&
    sameEntries(hold.entries, entries)
  ) {
    return hold;
  }
  return { lines, openedAt, held, settledAt, entries, expiresAt };
}

/** The hold's next bound, for the clock that re-reads it; nothing while no drawn line stands under one. */
export function liveLinesExpireAt(hold: LiveLineHold): number | undefined {
  return hold.expiresAt;
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

type StoredPart = StoredUIMessage["parts"][number];

/**
 * The one part type whose words a spoken line can be, as the SDK spells it.
 * Restated against the SDK's own type rather than imported at run time, as
 * the turn renderer does, because the session barrel reaches the SDK for its
 * types alone.
 */
const UI_PART_TYPE = {
  TEXT: "text",
} as const satisfies Record<string, StoredPart["type"]>;

type TextPart = Extract<StoredPart, { type: typeof UI_PART_TYPE.TEXT }>;

function isTextPart(part: StoredPart): part is TextPart {
  return part.type === UI_PART_TYPE.TEXT;
}

/**
 * Words as they compare between the transcript and the record: each word its
 * letters and digits alone, lower-cased, one space between words. A spoken
 * row is cut from the same transcript the line was drawn from, so the two
 * differ at most in the ends the ledger trimmed; the spaces stay so a match
 * lands on whole words, and a short line is never found inside a longer word
 * of another row.
 */
function comparable(words: string): string {
  return words
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0)
    .join(" ");
}

/**
 * One row of the record as the lines are matched against it: its words with
 * a space at either end, so every word boundary is a space, and how far along
 * them the lines matched so far reach.
 */
interface RecordedWords {
  readonly role: MessageRole;
  readonly words: string;
  covered: number;
}

/** The record's rows created at or after an instant, in the view's order, each as its comparable words. */
function recordedSince(view: ConversationViewSnapshot, since: number): RecordedWords[] {
  const rows: RecordedWords[] = [];
  for (const group of view.groups) {
    for (const message of group.messages) {
      if (message.createdAt < since) continue;
      const words = comparable(
        message.message.parts
          .filter(isTextPart)
          .map((part) => part.text)
          .join("\n"),
      );
      if (words.length > 0) {
        rows.push({ role: message.message.role, words: ` ${words} `, covered: 0 });
      }
    }
  }
  return rows;
}

/** One coverage a stored row gives a spoken line: the comparable words it took, and whether nothing of the line is left. */
interface TakenWords {
  readonly words: number;
  readonly complete: boolean;
}

function comparableWordCount(words: string): number {
  return words.length === 0 ? 0 : words.split(" ").length;
}

/**
 * What of one line is still ahead of the record after its first `covered`
 * comparable words: the same line where none were taken, nothing where all
 * were, or the remaining tail from the next whole word on. The live row's
 * original punctuation is kept on that tail, since what is left is still the
 * row the transcript drew rather than a re-rendering of its normalized copy.
 */
function unmatchedTail(entry: ConversationEntry, covered: number): ConversationEntry | undefined {
  if (covered <= 0) return entry;
  let seen = 0;
  for (const match of entry.words.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (seen === covered) {
      const tail = entry.words.slice(match.index ?? 0).trimStart();
      return tail.length === 0 ? undefined : { ...entry, words: tail };
    }
    seen += 1;
  }
  return undefined;
}

/**
 * Whether the row's words, past what earlier lines covered, cover a spoken
 * line's remaining whole words, and how many they took if so: the remainder
 * inside what is left — one utterance of an ask the delegation cut wider —
 * or what is left the first words of that remainder, where a cut ended
 * inside the utterance and the rest went to the next ask. Walking the row
 * forward is what lets one wide row cover each utterance inside it once,
 * keeps one short row from covering the same word said twice, and leaves any
 * suffix not yet on record standing on screen.
 */
function takes(row: RecordedWords, spoken: string): TakenWords | undefined {
  const needle = ` ${spoken} `;
  const at = row.words.indexOf(needle, row.covered);
  if (at !== -1) {
    // The trailing space stays uncovered: it is the next word's leading one.
    row.covered = at + needle.length - 1;
    return { words: comparableWordCount(spoken), complete: true };
  }
  const rest = row.words.slice(row.covered).trim();
  if (rest.length > 0 && (spoken === rest || spoken.startsWith(`${rest} `))) {
    row.covered = row.words.length;
    return { words: comparableWordCount(rest), complete: spoken === rest };
  }
  return undefined;
}

/**
 * The lines the Conversation tab draws ahead of the record: the hold's drawn
 * lines less every word a row of this call already shows. Lines are matched
 * oldest first against the rows in the view's order, each row's words walked
 * forward as its lines are found, so the developer saying the same word
 * twice is two lines until the record holds the word twice, and a line the
 * record only cut a prefix of still leaves its unmatched tail drawn.
 */
export function shownLiveEntries(
  hold: LiveLineHold,
  view: ConversationViewSnapshot,
): readonly ConversationEntry[] {
  if (hold.openedAt === undefined) return hold.entries;
  const recorded = recordedSince(view, hold.openedAt - LIVE_LINE_RECORD_SLACK_MS);
  return hold.entries.flatMap((entry) => {
    const role = roleOfKind(entry.kind);
    if (role === undefined) return [entry];
    const spoken = comparable(entry.words);
    if (spoken.length === 0) return [];
    let covered = 0;
    let remaining = spoken;
    for (const row of recorded) {
      if (row.role !== role || remaining.length === 0) continue;
      const taken = takes(row, remaining);
      if (taken === undefined) continue;
      covered += taken.words;
      if (taken.complete) return [];
      remaining = comparable(unmatchedTail(entry, covered)?.words ?? "");
      if (remaining.length === 0) return [];
    }
    const unmatched = unmatchedTail(entry, covered);
    return unmatched === undefined ? [] : [unmatched];
  });
}
