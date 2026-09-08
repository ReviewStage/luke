import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { ContextInput } from "./execution.js";
import {
  type ConversationKind,
  isConversationKind,
  type SessionId,
  type SessionKey,
} from "./identifiers.js";

/**
 * The storage contracts the runtime store implements and the host composes
 * against. Nothing here names a database: the contracts describe what a
 * durable owner of conversation state must be able to do, and the store that
 * does it lives in its own package behind them.
 */

/**
 * One line of a conversation's history as the store keeps it, separate from
 * whatever projection a surface draws. The payload is the complete event as
 * its writer recorded it; the columns beside it are what the store indexes.
 */
export interface StoredHistoryEvent {
  sessionKey: SessionKey;
  /**
   * The conversation lifetime that stood when the line was written, so lines
   * from different lifetimes of one conversation stay distinguishable once a
   * reset keeps history across them. Absent only for a line written before
   * any lifetime stood — an import from a source whose own lifetime had
   * already ended, or a line recorded before the first generation loaded.
   */
  sessionId?: SessionId;
  /** The store's own ordering, dense per session key and never reused. */
  sequence: number;
  /** The writer's value identity for the line, so an append is idempotent. */
  eventKey: string;
  kind: string;
  recordedAt: number;
  requestId?: string;
  payload: string;
}

/** What an append answered: whether the store changed, and the lines it now holds. */
export interface HistoryAppendOutcome<Entry> {
  changed: boolean;
  entries: readonly Entry[];
}

/**
 * Where a compaction came from. The provider may fold the context inline
 * inside an answer; the host may ask the provider for an explicit compaction
 * and adopt the window it answers whole; or, on a transport that cannot
 * compact, the host folds the older part behind a summary of its own.
 */
export const COMPACTION_SOURCE = {
  PROVIDER_INLINE: "provider_inline",
  PROVIDER_EXPLICIT: "provider_explicit",
  LOCAL_SUMMARY: "local_summary",
  /** A child's context adopted whole from its requester's at its start; nothing was dropped. */
  FORK: "fork",
} as const;

export type CompactionSource = (typeof COMPACTION_SOURCE)[keyof typeof COMPACTION_SOURCE];

const COMPACTION_SOURCE_LIST: readonly CompactionSource[] = Object.values(COMPACTION_SOURCE);

export function isCompactionSource(value: UnparsedWireValue): value is CompactionSource {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && COMPACTION_SOURCE_LIST.includes(value as CompactionSource);
}

/**
 * What one retained transcript event is. The transcript is the conversation
 * as it happened between the host, the model, and the tools — every input the
 * context engine ingested, in order — and every point at which the active
 * projection folded. A compaction changes what the model is shown next; it
 * changes nothing here, which is what makes the transcript the record and the
 * checkpoint the projection.
 */
export const TRANSCRIPT_EVENT_KIND = {
  CONTEXT_INPUT: "context_input",
  COMPACTION: "compaction",
} as const;

export interface CompactionBoundary {
  readonly source: CompactionSource;
  /** How many retained items the fold let go of from the projection. */
  readonly dropped: number;
  /** The checkpoint format the projection was in when it folded, as its tag. */
  readonly checkpointFormat?: string;
}

export type TranscriptEvent =
  | {
      readonly kind: typeof TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT;
      readonly recordedAt: number;
      readonly input: ContextInput;
    }
  | {
      readonly kind: typeof TRANSCRIPT_EVENT_KIND.COMPACTION;
      readonly recordedAt: number;
      readonly boundary: CompactionBoundary;
    };

/** A transcript event as the store hands it back: with its place in the conversation and the lifetime it was written in. */
export interface StoredTranscriptEvent {
  readonly sequence: number;
  readonly sessionId?: string;
  readonly event: TranscriptEvent;
}

/**
 * Why a conversation left the active list. The developer's own press is one
 * reason; the others are maintenance's, ported from OpenClaw's store: a
 * conversation untouched past the stale threshold, a private thread idle past
 * its own shorter one, and the cap on unarchived conversations. Only the cap's
 * victims are ever eligible for the disk budget's permanent deletion.
 */
export const ARCHIVE_REASON = {
  USER: "user",
  AGE_RETENTION: "age-retention",
  IDLE_THREAD: "idle-thread",
  ACTIVE_SESSION_CAP: "active-session-cap",
} as const;

export type ArchiveReason = (typeof ARCHIVE_REASON)[keyof typeof ARCHIVE_REASON];

const ARCHIVE_REASON_LIST: readonly ArchiveReason[] = Object.values(ARCHIVE_REASON);

export function isArchiveReason(value: UnparsedWireValue): value is ArchiveReason {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && ARCHIVE_REASON_LIST.includes(value as ArchiveReason);
}

/** One conversation as the directory lists it: its address, its kind, and where it stands in its lifecycle. */
export interface ConversationRecord {
  readonly sessionKey: SessionKey;
  readonly kind: ConversationKind;
  readonly name: string;
  readonly createdAt: number;
  /** The latest moment anything was written for it: a history line, a checkpoint, a transcript event. */
  readonly lastActivityAt: number;
  readonly archivedAt?: number;
  readonly archiveReason?: ArchiveReason;
  readonly pinnedAt?: number;
  /** The lifetime standing for it, when one does. */
  readonly sessionId?: string;
  /** A thread held in memory alone, gone at the next launch; never stored, so never true on a stored record. */
  readonly temporary?: boolean;
}

function instant(value: UnparsedWireValue): value is number {
  return isWireNumber(value) && Number.isFinite(value) && value >= 0;
}

export function conversationRecordFromWire(
  value: UnparsedWireValue,
): ConversationRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (!isWireString(value.sessionKey) || value.sessionKey.length === 0) return undefined;
  if (!isConversationKind(value.kind) || !isWireString(value.name)) return undefined;
  if (!instant(value.createdAt) || !instant(value.lastActivityAt)) return undefined;
  if (value.archivedAt !== undefined && !instant(value.archivedAt)) return undefined;
  if (value.archiveReason !== undefined && !isArchiveReason(value.archiveReason)) return undefined;
  if (value.pinnedAt !== undefined && !instant(value.pinnedAt)) return undefined;
  if (value.sessionId !== undefined && !isWireString(value.sessionId)) return undefined;
  if (value.temporary !== undefined && value.temporary !== true) return undefined;
  // SAFETY: the session key is a non-empty string; the constructor's check is the one made above.
  const record: ConversationRecord = {
    sessionKey: value.sessionKey as SessionKey,
    kind: value.kind,
    name: value.name,
    createdAt: value.createdAt,
    lastActivityAt: value.lastActivityAt,
    ...(value.archivedAt !== undefined ? { archivedAt: value.archivedAt } : undefined),
    ...(value.archiveReason !== undefined ? { archiveReason: value.archiveReason } : undefined),
    ...(value.pinnedAt !== undefined ? { pinnedAt: value.pinnedAt } : undefined),
    ...(value.sessionId !== undefined ? { sessionId: value.sessionId } : undefined),
    ...(value.temporary === true ? { temporary: true } : undefined),
  };
  return record;
}

/**
 * How an archive's bytes are encoded on disk: zstd through `node:zlib` where
 * the runtime has it, the plain JSONL otherwise. A reader that finds a zstd
 * archive on a runtime without zstd refuses honestly rather than guessing.
 */
export const ARCHIVE_ENCODING = {
  IDENTITY: "identity",
  ZSTD: "zstd",
} as const;

export type ArchiveEncoding = (typeof ARCHIVE_ENCODING)[keyof typeof ARCHIVE_ENCODING];

export function isArchiveEncoding(value: UnparsedWireValue): value is ArchiveEncoding {
  return value === ARCHIVE_ENCODING.IDENTITY || value === ARCHIVE_ENCODING.ZSTD;
}

/**
 * One deleted conversation's recoverable archive as the registry lists it.
 * The payload was committed in the same transaction that removed the rows,
 * then published to a file named here and verified by hash; a registry row
 * with no publication yet is one a launch retries.
 */
export interface HistoryArchiveRecord {
  readonly archiveId: string;
  readonly sessionKey: SessionKey;
  readonly kind: ConversationKind;
  readonly name: string;
  readonly createdAt: number;
  /** The moment the conversation's rows were removed, and the archive's timestamp. */
  readonly deletedAt: number;
  readonly encoding: ArchiveEncoding;
  readonly sha256: string;
  readonly byteLength: number;
  readonly fileName: string;
  readonly publishedAt?: number;
  readonly historyLines: number;
  readonly transcriptEvents: number;
}

export function historyArchiveRecordFromWire(
  value: UnparsedWireValue,
): HistoryArchiveRecord | undefined {
  if (!isRecord(value)) return undefined;
  if (!isWireString(value.archiveId) || value.archiveId.length === 0) return undefined;
  if (!isWireString(value.sessionKey) || value.sessionKey.length === 0) return undefined;
  if (!isConversationKind(value.kind) || !isWireString(value.name)) return undefined;
  if (!instant(value.createdAt) || !instant(value.deletedAt)) return undefined;
  if (!isArchiveEncoding(value.encoding) || !isWireString(value.sha256)) return undefined;
  if (!instant(value.byteLength) || !isWireString(value.fileName)) return undefined;
  if (value.publishedAt !== undefined && !instant(value.publishedAt)) return undefined;
  if (!instant(value.historyLines) || !instant(value.transcriptEvents)) return undefined;
  return {
    archiveId: value.archiveId,
    // SAFETY: a non-empty string, checked above, is what the session key constructor admits.
    sessionKey: value.sessionKey as SessionKey,
    kind: value.kind,
    name: value.name,
    createdAt: value.createdAt,
    deletedAt: value.deletedAt,
    encoding: value.encoding,
    sha256: value.sha256,
    byteLength: value.byteLength,
    fileName: value.fileName,
    ...(value.publishedAt !== undefined ? { publishedAt: value.publishedAt } : undefined),
    historyLines: value.historyLines,
    transcriptEvents: value.transcriptEvents,
  };
}

/** How a restore of a deleted conversation's archive ended. */
export const RESTORE_OUTCOME = {
  RESTORED: "restored",
  /** The conversation already holds lines newer than the archive; nothing was changed. */
  NEWER_LIVE: "newer-live",
  MISSING: "missing",
  /** The file is gone or does not match its hash and the registry no longer holds the payload. */
  UNREADABLE: "unreadable",
} as const;

export type RestoreOutcome = (typeof RESTORE_OUTCOME)[keyof typeof RESTORE_OUTCOME];

const RESTORE_OUTCOME_LIST: readonly RestoreOutcome[] = Object.values(RESTORE_OUTCOME);

export function isRestoreOutcome(value: UnparsedWireValue): value is RestoreOutcome {
  // SAFETY: value is a string; list membership is the vocabulary check.
  return isWireString(value) && RESTORE_OUTCOME_LIST.includes(value as RestoreOutcome);
}
