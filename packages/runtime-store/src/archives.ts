import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type AgentId,
  type ArchiveEncoding,
  CONVERSATION_KIND,
  type ConversationKind,
  conversationKindOf,
  type HistoryArchiveRecord,
  historyArchiveRecordFromWire,
  isArchiveEncoding,
  isConversationKind,
  RESTORE_OUTCOME,
  type RestoreOutcome,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { standingGeneration } from "./brain-envelope.js";
import {
  archiveEncodingSuffix,
  decodeArchiveContent,
  encodeArchiveContent,
} from "./compression.js";
import {
  conversationRecord,
  createConversation,
  historyCutoff,
  raiseHistoryCutoff,
  removeConversationRow,
  removeConversationRows,
  touchConversation,
} from "./conversations-table.js";
import { nullable, type RuntimeDatabase } from "./database.js";
import { historyEntryFromPayload } from "./history.js";
import { restoreHistoryLine } from "./history-table.js";
import {
  appendTranscript,
  listTranscript,
  transcriptEventFromPayload,
} from "./transcript-table.js";

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
 * publication a launch retries.
 *
 * Restoring is the mirror, bounded on one side: an archive is restored only
 * into a conversation that holds no history newer than the archive, so a
 * live conversation is never overwritten by an older copy of itself.
 */

export const ARCHIVE_DIRECTORY = "archives";
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

export function archiveFileName(
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
  HISTORY: "history",
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

type ArchiveRow = {
  archive_id: string;
  session_key: string;
  kind: string;
  name: string;
  created_at: number;
  deleted_at: number;
  encoding: string;
  sha256: string;
  byte_length: number;
  file_name: string;
  published_at: number | null;
  history_lines: number;
  transcript_events: number;
  previous_cutoff: number | null;
};

const ARCHIVE_COLUMNS = `archive_id, session_key, kind, name, created_at, deleted_at, encoding, sha256,
  byte_length, file_name, published_at, history_lines, transcript_events, previous_cutoff`;

function recordFromRow(row: ArchiveRow): HistoryArchiveRecord | undefined {
  return historyArchiveRecordFromWire({
    archiveId: row.archive_id,
    sessionKey: row.session_key,
    kind: isConversationKind(row.kind) ? row.kind : conversationKindOf(row.session_key),
    name: row.name,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    encoding: row.encoding,
    sha256: row.sha256,
    byteLength: row.byte_length,
    fileName: row.file_name,
    ...(row.published_at !== null ? { publishedAt: row.published_at } : undefined),
    historyLines: row.history_lines,
    transcriptEvents: row.transcript_events,
  });
}

export function listArchives(database: RuntimeDatabase): readonly HistoryArchiveRecord[] {
  // SAFETY: the columns selected are the ones the row type names, typed by the schema.
  const rows = database
    .prepare(`SELECT ${ARCHIVE_COLUMNS} FROM history_archives ORDER BY deleted_at DESC, archive_id`)
    .all() as ArchiveRow[];
  const records: HistoryArchiveRecord[] = [];
  for (const row of rows) {
    const record = recordFromRow(row);
    if (record) records.push(record);
  }
  return records;
}

function archiveRow(database: RuntimeDatabase, archiveId: string): ArchiveRow | undefined {
  // SAFETY: as above, for one row or none.
  return database
    .prepare(`SELECT ${ARCHIVE_COLUMNS} FROM history_archives WHERE archive_id = ?`)
    .get(archiveId) as ArchiveRow | undefined;
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
  durability?: PublicationDurability;
}

export interface DeletionOutcome {
  archive: HistoryArchiveRecord;
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
export function deleteConversationHistory(
  database: RuntimeDatabase,
  agentRoot: string,
  sessionKey: SessionKey,
  now: number,
  {
    archiveId = randomUUID(),
    removeConversation = false,
    durability = FILE_SYSTEM_DURABILITY,
  }: DeletionOptions = {},
): DeletionOutcome | undefined {
  const committed = database.transaction(() => {
    const record = conversationRecord(database, sessionKey);
    if (!record) return undefined;
    const standing = standingGeneration(database, sessionKey);
    const previousCutoff = historyCutoff(database, sessionKey);
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
    // SAFETY: the columns selected are the ones the row type names.
    const historyRows = database
      .prepare(
        "SELECT payload, session_id FROM history_events WHERE session_key = ? ORDER BY sequence",
      )
      .all(sessionKey) as { payload: string; session_id: string | null }[];
    const transcript = listTranscript(database, sessionKey, { limit: Number.MAX_SAFE_INTEGER });
    const lines: string[] = [JSON.stringify({ type: ARCHIVE_LINE.HEADER, ...header })];
    for (const row of historyRows) {
      lines.push(
        JSON.stringify({
          type: ARCHIVE_LINE.HISTORY,
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
    database
      .prepare(
        `INSERT INTO history_archives
           (archive_id, session_key, kind, name, created_at, deleted_at, encoding, sha256, byte_length,
            file_name, published_at, history_lines, transcript_events, previous_cutoff, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(
        archiveId,
        sessionKey,
        record.kind,
        record.name,
        record.createdAt,
        now,
        encoded.encoding,
        hashBytes(encoded.bytes),
        encoded.bytes.length,
        fileName,
        historyRows.length,
        transcript.length,
        nullable(header.previousCutoff),
        encoded.bytes,
      );
    raiseHistoryCutoff(database, sessionKey, now);
    removeConversationRows(database, sessionKey);
    if (removeConversation && record.kind !== CONVERSATION_KIND.MAIN) {
      removeConversationRow(database, sessionKey);
    }
    return archiveId;
  });
  if (!committed) return undefined;
  const published = publishArchive(database, agentRoot, committed, durability);
  const row = archiveRow(database, committed);
  const archive = row ? recordFromRow(row) : undefined;
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
export function publishArchive(
  database: RuntimeDatabase,
  agentRoot: string,
  archiveId: string,
  durability: PublicationDurability = FILE_SYSTEM_DURABILITY,
): boolean {
  const row = archiveRow(database, archiveId);
  if (!row) return false;
  if (row.published_at !== null) return true;
  // SAFETY: the payload column is the BLOB the deletion wrote, or NULL once published.
  const payload = database
    .prepare("SELECT payload FROM history_archives WHERE archive_id = ?")
    .get(archiveId) as { payload: Uint8Array | null } | undefined;
  if (!payload?.payload) return false;
  const directory = archiveDirectory(agentRoot);
  const target = path.resolve(directory, row.file_name);
  if (path.dirname(target) !== path.resolve(directory)) return false;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(target)) {
      const staging = `${target}.${randomUUID()}${ARCHIVE_STAGING_SUFFIX}`;
      try {
        const fd = fs.openSync(staging, "wx", 0o600);
        try {
          fs.writeFileSync(fd, payload.payload);
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
    if (hashBytes(fs.readFileSync(target)) !== row.sha256) return false;
  } catch {
    return false;
  }
  database
    .prepare("UPDATE history_archives SET published_at = ?, payload = NULL WHERE archive_id = ?")
    .run(Date.now(), archiveId);
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
  database: RuntimeDatabase,
  agentRoot: string,
  durability: PublicationDurability = FILE_SYSTEM_DURABILITY,
): string[] {
  // SAFETY: one text column selected.
  const rows = database
    .prepare(
      "SELECT archive_id FROM history_archives WHERE published_at IS NULL ORDER BY deleted_at",
    )
    .all() as { archive_id: string }[];
  return rows
    .map((row) => row.archive_id)
    .filter((archiveId) => !publishArchive(database, agentRoot, archiveId, durability));
}

export interface RestoreResult {
  outcome: RestoreOutcome;
  sessionKey?: SessionKey;
  historyLines?: number;
  transcriptEvents?: number;
}

/** The archive's content, from the registry's payload while it holds one, else from the verified file. */
function readArchiveContent(
  database: RuntimeDatabase,
  agentRoot: string,
  row: ArchiveRow,
): string | undefined {
  if (!isArchiveEncoding(row.encoding)) return undefined;
  // SAFETY: the payload column is the BLOB the deletion wrote, or NULL once published.
  const held = database
    .prepare("SELECT payload FROM history_archives WHERE archive_id = ?")
    .get(row.archive_id) as { payload: Uint8Array | null } | undefined;
  let bytes: Uint8Array | undefined = held?.payload ?? undefined;
  if (!bytes) {
    const target = path.resolve(archiveDirectory(agentRoot), row.file_name);
    try {
      bytes = fs.readFileSync(target);
    } catch {
      return undefined;
    }
  }
  if (hashBytes(bytes) !== row.sha256) return undefined;
  try {
    return decodeArchiveContent(bytes, row.encoding);
  } catch {
    return undefined;
  }
}

function parsedLines(content: string): UnparsedWireValue[] {
  const lines: UnparsedWireValue[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      // SAFETY: JSON.parse returns a wire value; each reader below validates its line.
      lines.push(JSON.parse(line) as UnparsedWireValue);
    } catch {
      // A line this build cannot parse drops the line, not the archive.
    }
  }
  return lines;
}

/**
 * Restores a deleted conversation's history from its archive. The identities
 * are the archive's own — the same session key, kind, name, and creation
 * instant, and each line's own id — so what comes back is the conversation
 * that was deleted rather than a copy. It never overwrites a newer live
 * conversation: a key that holds any history or transcript written since the
 * deletion is refused, and nothing is changed.
 */
export function restoreArchive(
  database: RuntimeDatabase,
  agentRoot: string,
  archiveId: string,
  agentId: AgentId,
  now: number,
): RestoreResult {
  const row = archiveRow(database, archiveId);
  if (!row) return { outcome: RESTORE_OUTCOME.MISSING };
  const content = readArchiveContent(database, agentRoot, row);
  if (content === undefined) return { outcome: RESTORE_OUTCOME.UNREADABLE };
  const lines = parsedLines(content);
  const header = lines.find((line) => isRecord(line) && line.type === ARCHIVE_LINE.HEADER);
  if (!isRecord(header) || !isWireString(header.sessionKey)) {
    return { outcome: RESTORE_OUTCOME.UNREADABLE };
  }
  // SAFETY: a non-empty string is what the session key constructor admits; the header wrote its own key.
  const sessionKey = header.sessionKey as SessionKey;
  return database.transaction(() => {
    // SAFETY: COUNT(*) is one integer column named `count`.
    const live = database
      .prepare(
        `SELECT (SELECT COUNT(*) FROM history_events WHERE session_key = ?) +
                (SELECT COUNT(*) FROM transcript_events WHERE session_key = ?) AS count`,
      )
      .get(sessionKey, sessionKey) as { count: number };
    if (live.count > 0) return { outcome: RESTORE_OUTCOME.NEWER_LIVE, sessionKey };
    const kind: ConversationKind = isConversationKind(header.kind)
      ? header.kind
      : conversationKindOf(sessionKey);
    createConversation(database, {
      agentId,
      sessionKey,
      kind,
      name: isWireString(header.name) ? header.name : row.name,
      now: isWireNumber(header.createdAt) ? header.createdAt : row.created_at,
    });
    if (row.previous_cutoff === null) {
      database
        .prepare("UPDATE conversations SET history_cleared_at = NULL WHERE session_key = ?")
        .run(sessionKey);
    } else {
      database
        .prepare("UPDATE conversations SET history_cleared_at = ? WHERE session_key = ?")
        .run(row.previous_cutoff, sessionKey);
    }
    let historyLines = 0;
    let transcriptEvents = 0;
    let latest = 0;
    for (const line of lines) {
      if (!isRecord(line)) continue;
      if (line.type === ARCHIVE_LINE.HISTORY) {
        const entry = historyEntryFromPayload(JSON.stringify(line.entry));
        if (!entry || entry.recordedAt === undefined) continue;
        restoreHistoryLine(
          database,
          sessionKey,
          isWireString(line.sessionId) ? line.sessionId : undefined,
          { ...entry, recordedAt: entry.recordedAt },
        );
        historyLines += 1;
        latest = Math.max(latest, entry.recordedAt);
      } else if (line.type === ARCHIVE_LINE.TRANSCRIPT && isRecord(line.event)) {
        const event = transcriptEventFromPayload(
          isWireString(line.event.kind) ? line.event.kind : "",
          isWireNumber(line.event.recordedAt) ? line.event.recordedAt : 0,
          line.event,
        );
        if (!event) continue;
        appendTranscript(
          database,
          sessionKey,
          isWireString(line.sessionId) ? line.sessionId : undefined,
          [event],
        );
        transcriptEvents += 1;
        latest = Math.max(latest, event.recordedAt);
      }
    }
    touchConversation(database, sessionKey, Math.max(latest, now));
    return { outcome: RESTORE_OUTCOME.RESTORED, sessionKey, historyLines, transcriptEvents };
  });
}

/** Forgets one archive's registry row and removes its file; the disk budget's own removal path. */
export function removeArchive(
  database: RuntimeDatabase,
  agentRoot: string,
  archiveId: string,
): boolean {
  const row = archiveRow(database, archiveId);
  if (!row) return false;
  const target = path.resolve(archiveDirectory(agentRoot), row.file_name);
  try {
    fs.rmSync(target, { force: true });
  } catch {
    return false;
  }
  database.prepare("DELETE FROM history_archives WHERE archive_id = ?").run(archiveId);
  return true;
}
