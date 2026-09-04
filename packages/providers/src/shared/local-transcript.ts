/**
 * The shared half of every on-demand transcript read: the bounds a rendering
 * must fit and the cut that enforces them. Each provider maps its own records
 * into the one line vocabulary — `Developer:` for the person, the agent's own
 * name for its replies, `→` for a tool call, `←` for its answer, `Error:` for
 * a failure the provider recorded — and this module holds every rendering to
 * the same bounds however the records differ: how much of the file one read
 * loads, and how long any one line may run. There is no bound on the total:
 * a reader sees the whole rendering the tail it read produces.
 */

import { cutFront, transcriptReadTailBytes } from "@sidecar/session";
import { isRecord, isWireString, recordFromJsonLine, text, type WireRecord } from "@sidecar/wire";
import { type FileWindow, fileStats, readRange, readTailWindow } from "./local-session-adapter.js";

export const transcriptLine = {
  developer: (words: string) => `Developer: ${words}`,
  agent: (name: string, words: string) => `${name}: ${words}`,
  toolCall: (name: string, detail?: string) => (detail ? `→ ${name}: ${detail}` : `→ ${name}`),
  toolResult: (answer: string) => `← ${answer}`,
  error: (reason: string) => `Error: ${reason}`,
} as const;

export const TRANSCRIPT_BOUNDS = {
  /** How much of the file's end one read may load. */
  READ_TAIL_BYTES: transcriptReadTailBytes,
  /** A rendered message line: enough to carry meaning, not a document. */
  MAXIMUM_MESSAGE_LENGTH: 400,
  /** A rendered tool call or its result: the gist, never the payload. */
  MAXIMUM_TOOL_LENGTH: 200,
} as const;

export function transcriptContentBlocks(
  record: WireRecord,
  fallbackToRecordContent: boolean,
): WireRecord[] {
  const message = record.message;
  const content = isRecord(message)
    ? message.content
    : fallbackToRecordContent
      ? record.content
      : undefined;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

export function transcriptMessageText(
  record: WireRecord,
  fallbackToRecordContent: boolean,
): string | undefined {
  const message = record.message;
  const content = isRecord(message)
    ? message.content
    : fallbackToRecordContent
      ? record.content
      : undefined;
  if (isWireString(content)) return text(content);
  const parts = transcriptContentBlocks(record, fallbackToRecordContent)
    .filter((block) => block.type === "text")
    .map((block) => text(block.text))
    .filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * Joins rendered lines into one rendering, or nothing when there are no lines
 * to render. With no maximum the whole rendering stands, bounded only by the
 * tail the read loaded and the per-line cuts already applied. When a caller
 * asks for one, the newest turns win the space: a question about a session is
 * almost always about where it is now, so the rendering is cut from the
 * front, at a line, and says so.
 */
export function boundedTranscript(
  lines: readonly string[],
  maximumLength?: number,
): string | undefined {
  if (lines.length === 0) return undefined;
  const rendered = lines.join("\n");
  return maximumLength === undefined ? rendered : cutFront(rendered, maximumLength).text;
}

/**
 * The whole records a file has gained since a cursor, for a reader that walks
 * a transcript incrementally rather than re-reading its tail. The cursor is a
 * byte offset the previous read minted: the byte after the last newline it
 * consumed, so a record still being appended is left for the next read to
 * find whole. Without a cursor, or with one the file no longer reaches — a
 * rotation, a rewrite, a cursor minted against another file — the read falls
 * back to the tail and reports itself truncated, because whatever stood
 * before the window is not what it gained since. A tail that begins mid-file
 * drops its leading partial line; a window that begins at the cursor trusts
 * that the cursor was minted at a line start.
 */
export interface RecordsSince {
  records: WireRecord[];
  cursor: string;
  truncated: boolean;
}

const NEWLINE_BYTE = 0x0a;
const CURSOR_PATTERN = /^(0|[1-9][0-9]*)$/;

function cursorOffset(cursor: string | undefined): number | undefined {
  if (cursor === undefined || !CURSOR_PATTERN.test(cursor)) return undefined;
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) ? offset : undefined;
}

function recordsFromWindow(window: FileWindow, isTail: boolean): RecordsSince {
  const { bytes, offset, fileSize } = window;
  const dropsLeadingPartial = isTail && offset > 0;
  const firstNewline = bytes.indexOf(NEWLINE_BYTE);
  const lastNewline = bytes.lastIndexOf(NEWLINE_BYTE);
  const parseFrom = dropsLeadingPartial ? (firstNewline >= 0 ? firstNewline + 1 : bytes.length) : 0;
  const parseTo = lastNewline >= 0 ? lastNewline + 1 : 0;
  const records =
    parseTo > parseFrom
      ? bytes
          .subarray(parseFrom, parseTo)
          .toString("utf8")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map(recordFromJsonLine)
          .filter((record): record is WireRecord => record !== undefined)
      : [];
  const windowEnd = offset + bytes.length;
  const reachedEnd = windowEnd >= fileSize;
  // With no newline at all, the window is one line: unfinished when it
  // reaches the end, so it is left for the next read, or wider than the
  // window itself, which no read could ever consume and which is skipped
  // rather than stalled on; a mid-file tail's first line can never be read
  // whole either, so that one skips to the end.
  const nextOffset =
    lastNewline >= 0
      ? offset + lastNewline + 1
      : !reachedEnd || dropsLeadingPartial
        ? windowEnd
        : offset;
  return {
    records,
    cursor: String(nextOffset),
    truncated: isTail ? offset > 0 : !reachedEnd,
  };
}

export async function readRecordsSince(
  filePath: string,
  cursor: string | undefined,
  maximumBytes: number,
): Promise<RecordsSince> {
  const offset = cursorOffset(cursor);
  if (offset !== undefined) {
    const window = await readRange(filePath, offset, maximumBytes);
    if (offset <= window.fileSize) return recordsFromWindow(window, false);
  }
  return recordsFromWindow(await readTailWindow(filePath, maximumBytes), true);
}

/**
 * Remembers where a session's transcript file was found, so a read repeated
 * on every wake does not walk the provider's directory tree each time. A
 * remembered path is trusted only while a file still stands there; a file
 * that moved is looked up again, and the map stays small however many
 * sessions a day sees.
 */
export class TranscriptPathCache {
  static readonly MAXIMUM_ENTRIES = 64;

  readonly #paths = new Map<string, string>();

  async resolve(
    providerSessionId: string,
    locate: () => Promise<string | undefined>,
  ): Promise<string | undefined> {
    const remembered = this.#paths.get(providerSessionId);
    if (remembered !== undefined && (await fileStats(remembered))?.isFile()) return remembered;
    this.#paths.delete(providerSessionId);
    const located = await locate();
    if (located === undefined) return undefined;
    this.#paths.set(providerSessionId, located);
    const oldest = this.#paths.keys().next();
    if (this.#paths.size > TranscriptPathCache.MAXIMUM_ENTRIES && !oldest.done) {
      this.#paths.delete(oldest.value);
    }
    return located;
  }
}
