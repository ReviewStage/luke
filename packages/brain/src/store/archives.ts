import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type ArchiveEncoding,
  CONVERSATION_KIND,
  type ConversationArchiveRecord,
  type ConversationKind,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  archivePayload,
  archiveRecord,
  insertArchive,
  listArchives as listArchiveRecords,
  markArchivePublished,
  pendingArchiveIds,
  removeArchiveRow,
} from "./archives-table.js";
import { standingGeneration } from "./brain-envelope.js";
import { archiveEncodingSuffix, encodeArchiveContent } from "./compression.js";
import {
  conversationCutoff,
  conversationRecord,
  raiseConversationCutoff,
  removeConversationRow,
  removeConversationRows,
  removeConversationRowsAtOrBefore,
} from "./conversations-table.js";
import type { StoreDatabase } from "./database.js";
import { listTranscript } from "./transcript-table.js";

/**
 * The recoverable deletion of a conversation's history, ported in shape from
 * OpenClaw's `session-accessor.sqlite-archive*.ts` at the pinned revision.
 * Deleting history is two steps with one durable seam between them. First,
 * in the transaction that removes the rows, the whole conversation — its
 * history lines, its transcript, its compaction boundaries — is serialized
 * as JSONL, compressed, hashed, and committed into the archive registry, so
 * a crash the instant after leaves nothing lost. Second, the bytes are
 * published to a file under the agent's own archive directory, written
 * exclusively, synced, linked into place, and read back against the hash;
 * only then is the payload let go of in the database and the deletion
 * reported complete. A registry row still holding its payload is a
 * publication a launch retries. Nothing reads an archive back: it stands on
 * the developer's own disk for the developer alone.
 */

const ARCHIVE_DIRECTORY = "archives";
const ARCHIVE_STAGING_SUFFIX = ".tmp";
const ARCHIVE_REASON_DELETED = "deleted";
/** Room under the 255-byte component limit for the timestamp, the id, and the suffixes. */
const MAXIMUM_NAME_COMPONENT_BYTES = 96;
/** How long a staging file may stand before a sweep may call it abandoned. */
export const ARCHIVE_STAGING_STALE_MS = 5 * 60 * 1000;

export function archiveDirectory(agentRoot: string): string {
  return path.join(agentRoot, ARCHIVE_DIRECTORY);
}

/** A session key as a file name component: safe characters kept, the rest replaced, and a long one hashed to a stable name. */
function nameComponent(sessionKey: string): string {
  const safe = sessionKey.replaceAll(/[^A-Za-z0-9._-]/g, "_");
  if (Buffer.byteLength(safe, "utf8") <= MAXIMUM_NAME_COMPONENT_BYTES) return safe;
  return `conversation-${createHash("sha256").update(sessionKey).digest("hex")}`;
}

function archiveTimestamp(ms: number): string {
  return new Date(ms).toISOString().replaceAll(":", "-");
}

function archiveFileName(
  sessionKey: string,
  deletedAt: number,
  archiveId: string,
  encoding: ArchiveEncoding,
): string {
  const generation = archiveId.replaceAll("-", "");
  return `${nameComponent(sessionKey)}.jsonl.${ARCHIVE_REASON_DELETED}.${archiveTimestamp(deletedAt)}.${generation}${archiveEncodingSuffix(encoding)}`;
}

export function isArchiveStagingName(fileName: string): boolean {
  return fileName.endsWith(ARCHIVE_STAGING_SUFFIX);
}

/** The JSONL record kinds an archive is made of; the header first, then the lines in their order. */
const ARCHIVE_LINE = {
  HEADER: "header",
  CONVERSATION: "conversation",
  TRANSCRIPT: "transcript",
} as const;

interface ArchiveHeader {
  sessionKey: string;
  kind: ConversationKind;
  name: string;
  createdAt: number;
  deletedAt: number;
  sessionId?: string;
  checkpointFormat?: string;
  previousCutoff?: number;
}

function hashBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The registry's own directory, most recently deleted first. */
export function listArchives(database: StoreDatabase): readonly ConversationArchiveRecord[] {
  return listArchiveRecords(database);
}

/**
 * The durability operations a publication requires beyond writing bytes: the
 * directory entry that names the file must reach the disk too, or a crash
 * after the rows were removed could leave a name that resolves to nothing.
 * Injected so a test can make one fail; the default is the file system's own
 * fsync, and a failure there is a failure of the publication, never a case
 * assumed durable.
 */
export interface PublicationDurability {
  /** Makes the directory's entries durable; throws when the platform could not. */
  syncDirectory(directory: string): void;
}

export const FILE_SYSTEM_DURABILITY: PublicationDurability = {
  syncDirectory: (directory) => {
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  },
};

export interface DeletionOptions {
  /** The archive's own id, minted here unless the caller names one. */
  archiveId?: string;
  /** Whether the conversation row itself goes with its history; the directory keeps it otherwise. */
  removeConversation?: boolean;
  /**
   * The lifetime that stands at the deletion's instant and is not the
   * deletion's to remove: the empty successor the brain's fence began at the
   * same instant. Unnamed, every lifetime goes.
   */
  keepSessionId?: string;
  /**
   * The conversation's cutoff as it stood before the press, when the caller
   * fenced the brain first: that fence raised the durable cutoff to the
   * deletion's own instant, so reading it here would make a restore hide the
   * very lines it brings back. Unnamed, the cutoff as it stands is the one.
   */
  cutoffBefore?: { value: number | undefined };
  durability?: PublicationDurability;
}

export interface DeletionOutcome {
  archive: ConversationArchiveRecord;
  /** Whether the archive file is published and verified; false means the payload still waits in the registry. */
  published: boolean;
}

/**
 * Removes the conversation's history behind a committed archive. The rows
 * go in one transaction with the archive's payload, the conversation's
 * cutoff is raised to the deletion's instant so a late writer cannot stand
 * an erased line back up, and the standing lifetime goes with its
 * checkpoint, requests, and receipts. Publication follows, outside the
 * transaction, and its outcome is the answer.
 */
export function deleteConversation(
  database: StoreDatabase,
  agentRoot: string,
  sessionKey: SessionKey,
  now: number,
  {
    archiveId = randomUUID(),
    removeConversation = false,
    keepSessionId,
    cutoffBefore,
    durability = FILE_SYSTEM_DURABILITY,
  }: DeletionOptions = {},
): DeletionOutcome | undefined {
  const committed = database.transaction(() => {
    const record = conversationRecord(database, sessionKey);
    if (!record) return undefined;
    const standing = standingGeneration(database, sessionKey);
    const previousCutoff = cutoffBefore
      ? cutoffBefore.value
      : conversationCutoff(database, sessionKey);
    const header: ArchiveHeader = {
      sessionKey,
      kind: record.kind,
      name: record.name,
      createdAt: record.createdAt,
      deletedAt: now,
      ...(standing ? { sessionId: standing.sessionId } : undefined),
      ...(standing?.checkpointFormat !== undefined
        ? { checkpointFormat: standing.checkpointFormat }
        : undefined),
      ...(previousCutoff !== undefined ? { previousCutoff } : undefined),
    };
    // Only what stood at or before the instant is archived and removed: a
    // line accepted after the press, while the deletion waited on the disk,
    // is the conversation's next line and stays.
    // SAFETY: the columns selected are the ones the row type names.
    const conversationRows = database
      .prepare(
        `SELECT payload, session_id FROM conversation_events
         WHERE session_key = ? AND recorded_at <= ? ORDER BY sequence`,
      )
      .all(sessionKey, now) as { payload: string; session_id: string | null }[];
    const transcript = listTranscript(database, sessionKey, {
      limit: Number.MAX_SAFE_INTEGER,
    }).filter((stored) => stored.event.recordedAt <= now);
    const lines: string[] = [JSON.stringify({ type: ARCHIVE_LINE.HEADER, ...header })];
    for (const row of conversationRows) {
      lines.push(
        JSON.stringify({
          type: ARCHIVE_LINE.CONVERSATION,
          ...(row.session_id !== null ? { sessionId: row.session_id } : undefined),
          entry: JSON.parse(row.payload),
        }),
      );
    }
    for (const stored of transcript) {
      lines.push(
        JSON.stringify({
          type: ARCHIVE_LINE.TRANSCRIPT,
          ...(stored.sessionId !== undefined ? { sessionId: stored.sessionId } : undefined),
          event: stored.event,
        }),
      );
    }
    const content = `${lines.join("\n")}\n`;
    const encoded = encodeArchiveContent(content);
    const fileName = archiveFileName(sessionKey, now, archiveId, encoded.encoding);
    insertArchive(database, {
      archiveId,
      sessionKey,
      kind: record.kind,
      name: record.name,
      createdAt: record.createdAt,
      deletedAt: now,
      encoding: encoded.encoding,
      sha256: hashBytes(encoded.bytes),
      byteLength: encoded.bytes.length,
      fileName,
      conversationLines: conversationRows.length,
      transcriptEvents: transcript.length,
      previousCutoff: header.previousCutoff,
      payload: encoded.bytes,
    });
    raiseConversationCutoff(database, sessionKey, now);
    if (removeConversation && record.kind !== CONVERSATION_KIND.MAIN) {
      removeConversationRows(database, sessionKey);
      removeConversationRow(database, sessionKey);
    } else {
      removeConversationRowsAtOrBefore(database, sessionKey, now, keepSessionId);
    }
    return archiveId;
  });
  if (!committed) return undefined;
  const published = publishArchive(database, agentRoot, committed, durability);
  const archive = archiveRecord(database, committed);
  if (!archive) throw new Error(`archive ${committed} was not registered`);
  return { archive, published };
}

/**
 * Writes one registered archive to its file and verifies it: exclusive
 * staging write, fsync, link into place, the directory synced, the file read
 * back against the hash. A file already there with the same hash is the same
 * publication landing twice — an earlier attempt that linked the name and
 * then failed — and it is taken through the same file sync, directory sync,
 * and readback before it counts, so the durability step that failed last
 * time is never skipped this time; one with another hash is a collision
 * this build refuses to paper over. Only a publication whose every
 * durability operation succeeded lets the payload go from the registry; any
 * failure, the directory sync's included, leaves it there for the next
 * attempt, because a name the disk may not hold is not a recovery copy.
 */
function publishArchive(
  database: StoreDatabase,
  agentRoot: string,
  archiveId: string,
  durability: PublicationDurability = FILE_SYSTEM_DURABILITY,
): boolean {
  const record = archiveRecord(database, archiveId);
  if (!record) return false;
  if (record.publishedAt !== undefined) return true;
  const payload = archivePayload(database, archiveId);
  if (!payload) return false;
  const directory = archiveDirectory(agentRoot);
  const target = path.resolve(directory, record.fileName);
  if (path.dirname(target) !== path.resolve(directory)) return false;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(target)) {
      const staging = `${target}.${randomUUID()}${ARCHIVE_STAGING_SUFFIX}`;
      try {
        const fd = fs.openSync(staging, "wx", 0o600);
        try {
          fs.writeFileSync(fd, payload);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        try {
          fs.linkSync(staging, target);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        }
      } finally {
        fs.rmSync(staging, { force: true });
      }
    }
    syncFile(target);
    durability.syncDirectory(directory);
    if (hashBytes(fs.readFileSync(target)) !== record.sha256) return false;
  } catch {
    return false;
  }
  markArchivePublished(database, archiveId, Date.now());
  return true;
}

/** Makes the file's own bytes durable, on the retry path where they were written by an earlier attempt. */
function syncFile(target: string): void {
  const fd = fs.openSync(target, "r");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** Retries every publication a crash interrupted; answers the ids still unpublished. */
export function publishPendingArchives(
  database: StoreDatabase,
  agentRoot: string,
  durability: PublicationDurability = FILE_SYSTEM_DURABILITY,
): string[] {
  return pendingArchiveIds(database).filter(
    (archiveId) => !publishArchive(database, agentRoot, archiveId, durability),
  );
}

/** Forgets one archive's registry row and removes its file; the disk budget's own removal path. */
export function removeArchive(
  database: StoreDatabase,
  agentRoot: string,
  archiveId: string,
): boolean {
  const record = archiveRecord(database, archiveId);
  if (!record) return false;
  const target = path.resolve(archiveDirectory(agentRoot), record.fileName);
  try {
    fs.rmSync(target, { force: true });
  } catch {
    return false;
  }
  return removeArchiveRow(database, archiveId);
}
