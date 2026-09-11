/**
 * The shared half of every on-demand transcript read: the bounds a rendering
 * must fit and the cut that enforces them. Each provider maps its own records
 * into the one line vocabulary — `Developer:` for the person, the agent's own
 * name for its replies, `→` for a tool call, `←` for its answer, `Error:` for
 * a failure the provider recorded — and this module holds every rendering to
 * the same bounds however the records differ: how much of the file one read
 * loads, and how long a tool line may run. A message is rendered whole, line
 * breaks and all, and there is no bound on the total: the reader that asked
 * cuts the rendering from the front to what it can carry, so a second bound
 * here could only lose words it would have kept.
 */

import {
  ACTION_RESULT_STATUS,
  OMISSION_MARKER,
  type ProviderTranscriptResult,
  type ProviderTranscriptSinceResult,
  transcriptReadTailBytes,
} from "@sidecar/session";
import { recordFromJsonLine, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import {
  type FileWindow,
  fileStats,
  readRange,
  readTail,
  readTailWindow,
  tailRecords,
} from "./local-files.js";
import { runAdapterRead } from "./promise-face.js";

export const TRANSCRIPT_BOUNDS = {
  /** How much of the file's end one read may load. */
  READ_TAIL_BYTES: transcriptReadTailBytes,
  /** A rendered tool call or its result: the gist, never the payload. */
  MAXIMUM_TOOL_LENGTH: 200,
} as const;

/**
 * Joins rendered lines into one rendering, or nothing when there are no lines
 * to render. With no maximum the whole rendering stands, bounded only by the
 * tail the read loaded and the tool-line cuts already applied. When a caller
 * asks for one, the newest turns win the space: a question about a session is
 * almost always about where it is now, so the rendering is cut from the
 * front, at a line, and says so.
 */
export function boundedTranscript(
  lines: readonly string[],
  maximumLength?: number,
): string | undefined {
  if (lines.length === 0) return undefined;
  let rendered = lines.join("\n");
  if (maximumLength !== undefined && rendered.length > maximumLength) {
    const kept = rendered.slice(rendered.length - maximumLength);
    const firstWholeLine = kept.indexOf("\n");
    rendered = `${OMISSION_MARKER}\n${firstWholeLine >= 0 ? kept.slice(firstWholeLine + 1) : kept}`;
  }
  return rendered;
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

export function readRecordsSince(
  filePath: string,
  cursor: string | undefined,
  maximumBytes: number,
): Effect.Effect<RecordsSince> {
  return Effect.gen(function* () {
    const offset = cursorOffset(cursor);
    if (offset !== undefined) {
      const window = yield* Effect.promise(() => readRange(filePath, offset, maximumBytes));
      if (offset <= window.fileSize) return recordsFromWindow(window, false);
    }
    const tail = yield* Effect.promise(() => readTailWindow(filePath, maximumBytes));
    return recordsFromWindow(tail, true);
  });
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

  resolve(
    providerSessionId: string,
    locate: () => Effect.Effect<string | undefined>,
  ): Effect.Effect<string | undefined> {
    return Effect.gen(this, function* () {
      const remembered = this.#paths.get(providerSessionId);
      if (remembered !== undefined) {
        const stats = yield* Effect.promise(() => fileStats(remembered));
        if (stats?.isFile()) return remembered;
      }
      this.#paths.delete(providerSessionId);
      const located = yield* locate();
      if (located === undefined) return undefined;
      this.#paths.set(providerSessionId, located);
      const oldest = this.#paths.keys().next();
      if (this.#paths.size > TranscriptPathCache.MAXIMUM_ENTRIES && !oldest.done) {
        this.#paths.delete(oldest.value);
      }
      return located;
    });
  }
}

/**
 * The transcript-not-found refusal. It is the same answer for a session this
 * provider never wrote a record file for and for one whose file has since
 * gone: what a reader learns is that there is nothing to render, and nothing
 * about the provider's own directory.
 */
const TRANSCRIPT_NOT_FOUND = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: "That session's transcript could not be found.",
} as const;

/** How one provider's stored records become transcript lines. */
export interface JsonlTranscriptInput {
  /** Where this session's record file is, or nothing when there is none. */
  locate(providerSessionId: string): Effect.Effect<string | undefined>;
  /**
   * Why this build will not render a file it did find, when the provider has
   * a reason — Codex compresses an old rollout, and a bounded window cannot
   * be cut from one. Naming the reason is what keeps the refusal honest: a
   * located file answered as missing would send the ask on to the next
   * observer of the same provider.
   */
  refuses?(filePath: string): string | undefined;
  /** The attributed lines one stored record yields, or none. */
  lines(record: WireRecord): readonly string[];
}

export interface JsonlTranscriptReader {
  read(providerSessionId: string): Effect.Effect<ProviderTranscriptResult>;
  readSince(
    providerSessionId: string,
    cursor?: string,
  ): Effect.Effect<ProviderTranscriptSinceResult>;
}

/** The two transcript reads a plugin advertises, as the plugin seam takes them. */
export interface PromiseTranscriptReads {
  transcript(providerSessionId: string): Promise<ProviderTranscriptResult>;
  transcriptSince(
    providerSessionId: string,
    cursor?: string,
  ): Promise<ProviderTranscriptSinceResult>;
}

/**
 * @deprecated The promise face of a {@link JsonlTranscriptReader}, for the
 * plugin seam the host still holds; deleted with P7-05.
 */
export function promiseTranscriptReads(reader: JsonlTranscriptReader): PromiseTranscriptReads {
  return {
    transcript: (providerSessionId) => runAdapterRead(reader.read(providerSessionId)),
    transcriptSince: (providerSessionId, cursor) =>
      runAdapterRead(reader.readSince(providerSessionId, cursor)),
  };
}

/**
 * Every on-demand read of a JSONL-backed transcript: the bounded tail read,
 * the cursor arithmetic, the path cache an incremental read walks by, and the
 * bounds every rendering is held to — the tail the build fixes, and the
 * tool-line cuts, with no bound on the total, so a reader sees the whole
 * rendering the tail it read produces. A provider supplies only where its
 * records live and what one of them says; nothing here opens a file for
 * writing, and the rendering is kept nowhere.
 */
export function jsonlTranscriptReader(input: JsonlTranscriptInput): JsonlTranscriptReader {
  const paths = new TranscriptPathCache();
  return {
    read: (providerSessionId) =>
      Effect.gen(function* () {
        // A whole-tail read walks the provider's directory itself: it happens
        // once at a developer's ask, where the incremental read repeats on
        // every wake and is what the path cache exists for.
        const filePath = yield* input.locate(providerSessionId);
        if (filePath === undefined) return TRANSCRIPT_NOT_FOUND;
        const refusal = input.refuses?.(filePath);
        if (refusal !== undefined) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: refusal };
        }
        const tail = yield* Effect.promise(() =>
          readTail(filePath, TRANSCRIPT_BOUNDS.READ_TAIL_BYTES),
        );
        const transcript = boundedTranscript(
          tailRecords(tail).flatMap((record) => input.lines(record)),
        );
        return transcript === undefined
          ? TRANSCRIPT_NOT_FOUND
          : { status: ACTION_RESULT_STATUS.ACCEPTED, transcript };
      }),

    readSince: (providerSessionId, cursor) =>
      Effect.gen(function* () {
        const filePath = yield* paths.resolve(providerSessionId, () =>
          input.locate(providerSessionId),
        );
        if (filePath === undefined) return TRANSCRIPT_NOT_FOUND;
        const refusal = input.refuses?.(filePath);
        if (refusal !== undefined) {
          return { status: ACTION_RESULT_STATUS.REJECTED, reason: refusal };
        }
        const since = yield* readRecordsSince(filePath, cursor, TRANSCRIPT_BOUNDS.READ_TAIL_BYTES);
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          text: boundedTranscript(since.records.flatMap((record) => input.lines(record))) ?? "",
          cursor: since.cursor,
          truncated: since.truncated,
        };
      }),
  };
}
