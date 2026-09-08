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
  type SessionKey,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
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
  removeConversationRow,
  touchConversation,
} from "./conversations-table.js";
import { nullable, type RuntimeDatabase } from "./database.js";
import { historyEntryFromPayload } from "./history.js";
import { listTranscript, removeTranscript, transcriptEventFromRow } from "./transcript-table.js";

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

interface ArchiveRow {
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
}

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
    .all() as unknown as ArchiveRow[];
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
    .get(archiveId) as unknown as ArchiveRow | undefined;
}

export interface DeletionOptions {
  /** Whether the conversation row itself goes with its history; the directory keeps it otherwise. */
  removeConversation?: boolean;
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
  archiveId: string = randomUUID(),
  options: DeletionOptions = {},
): DeletionOutcome | undefined {
  const committed = database.transaction(() => {
    const record = conversationRecord(database, sessionKey);
    if (!record) return undefined;
    const standing = standingGeneration(database, sessionKey);
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
      ...(database.historyCutoff(sessionKey) !== undefined
        ? { previousCutoff: database.historyCutoff(sessionKey) }
        : undefined),
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
    database.raiseHistoryCutoff(sessionKey, now);
    database.prepare("DELETE FROM history_events WHERE session_key = ?").run(sessionKey);
    removeTranscript(database, sessionKey);
    database.prepare("DELETE FROM conversation_sessions WHERE session_key = ?").run(sessionKey);
    if (options.removeConversation && record.kind !== CONVERSATION_KIND.MAIN) {
      removeConversationRow(database, sessionKey);
    }
    return archiveId;
  });
  if (!committed) return undefined;
  const published = publishArchive(database, agentRoot, committed);
  const row = archiveRow(database, committed);
  const archive = row ? recordFromRow(row) : undefined;
  if (!archive) throw new Error(`archive ${committed} was not registered`);
  return { archive, published };
}

/**
 * Writes one registered archive to its file and verifies it: exclusive
 * staging write, fsync, link into place, read back against the hash. A file
 * already there with the same hash is the same publication landing twice;
 * one with another hash is a collision this build refuses to paper over.
 * Answers whether the archive is now published; a failure leaves the payload
 * in the registry for the next attempt.
 */
export function publishArchive(
  database: RuntimeDatabase,
  agentRoot: string,
  archiveId: string,
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
      syncDirectory(directory);
    }
    if (hashBytes(fs.readFileSync(target)) !== row.sha256) return false;
  } catch {
    return false;
  }
  database
    .prepare("UPDATE history_archives SET published_at = ?, payload = NULL WHERE archive_id = ?")
    .run(Date.now(), archiveId);
  return true;
}

function syncDirectory(directory: string): void {
  try {
    const fd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // A file system that refuses to sync a directory has already made the file durable in its own way.
  }
}

/** Retries every publication a crash interrupted; answers the ids still unpublished. */
export function publishPendingArchives(database: RuntimeDatabase, agentRoot: string): string[] {
  // SAFETY: one text column selected.
  const rows = database
    .prepare(
      "SELECT archive_id FROM history_archives WHERE published_at IS NULL ORDER BY deleted_at",
    )
    .all() as { archive_id: string }[];
  return rows
    .map((row) => row.archive_id)
    .filter((archiveId) => !publishArchive(database, agentRoot, archiveId));
}

export const RESTORE_OUTCOME = {
  RESTORED: "restored",
  /** The conversation already holds lines newer than the archive; nothing was changed. */
  NEWER_LIVE: "newer-live",
  MISSING: "missing",
  /** The file is gone or does not match its hash and the registry no longer holds the payload. */
  UNREADABLE: "unreadable",
} as const;

export type RestoreOutcome = (typeof RESTORE_OUTCOME)[keyof typeof RESTORE_OUTCOME];

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
        insertHistoryLine(
          database,
          sessionKey,
          isWireString(line.sessionId) ? line.sessionId : undefined,
          { ...entry, recordedAt: entry.recordedAt },
        );
        historyLines += 1;
        latest = Math.max(latest, entry.recordedAt);
      } else if (line.type === ARCHIVE_LINE.TRANSCRIPT && isRecord(line.event)) {
        const event = transcriptEventFromRow(
          isWireString(line.event.kind) ? line.event.kind : "",
          isWireNumber(line.event.recordedAt) ? line.event.recordedAt : 0,
          JSON.stringify(
            line.event.kind === TRANSCRIPT_EVENT_KIND.COMPACTION
              ? { boundary: line.event.boundary }
              : { input: line.event.input },
          ),
        );
        if (!event) continue;
        insertTranscriptLine(
          database,
          sessionKey,
          isWireString(line.sessionId) ? line.sessionId : undefined,
          event,
        );
        transcriptEvents += 1;
        latest = Math.max(latest, event.recordedAt);
      }
    }
    touchConversation(database, sessionKey, Math.max(latest, now));
    return { outcome: RESTORE_OUTCOME.RESTORED, sessionKey, historyLines, transcriptEvents };
  });
}

function insertHistoryLine(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  entry: ReturnType<typeof historyEntryFromPayload> & { recordedAt: number },
): void {
  // SAFETY: RETURNING yields the one integer expression named `sequence`.
  const row = database
    .prepare(
      `UPDATE conversations SET next_history_sequence = next_history_sequence + 1
       WHERE session_key = ? RETURNING next_history_sequence - 1 AS sequence`,
    )
    .get(sessionKey) as { sequence: number };
  const eventKey = entry.eventId !== undefined ? `event:${entry.eventId}` : `value:${row.sequence}`;
  database
    .prepare(
      `INSERT OR IGNORE INTO history_events
         (session_key, sequence, session_id, event_key, kind, words, recorded_at, request_id,
          provider_id, provider_session_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionKey,
      row.sequence,
      nullable(sessionId),
      eventKey,
      entry.kind,
      entry.words,
      entry.recordedAt,
      nullable(entry.requestId),
      nullable(entry.identity?.providerId),
      nullable(entry.identity?.providerSessionId),
      JSON.stringify(entry),
    );
}

function insertTranscriptLine(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  event: TranscriptEvent,
): void {
  // SAFETY: RETURNING yields the one integer expression named `sequence`.
  const row = database
    .prepare(
      `UPDATE conversations SET next_transcript_sequence = next_transcript_sequence + 1
       WHERE session_key = ? RETURNING next_transcript_sequence - 1 AS sequence`,
    )
    .get(sessionKey) as { sequence: number };
  database
    .prepare(
      `INSERT INTO transcript_events (session_key, sequence, session_id, kind, recorded_at, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionKey,
      row.sequence,
      nullable(sessionId),
      event.kind,
      event.recordedAt,
      JSON.stringify(
        event.kind === TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT
          ? { input: event.input }
          : { boundary: event.boundary },
      ),
    );
  if (event.kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
    database
      .prepare(
        `INSERT INTO compaction_boundaries
           (session_key, transcript_sequence, session_id, source, dropped, checkpoint_format, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionKey,
        row.sequence,
        nullable(sessionId),
        event.boundary.source,
        event.boundary.dropped,
        nullable(event.boundary.checkpointFormat),
        event.recordedAt,
      );
  }
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

export interface PhysicalUsage {
  databaseBytes: number;
  walBytes: number;
  archiveBytes: number;
  totalBytes: number;
}

function sizeOf(file: string): number {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

/**
 * What the agent's history weighs on disk: the database's main file, its
 * WAL, and every published archive. Staging files still being written are
 * left out, as OpenClaw leaves its rollback staging out, so an archive
 * half-published cannot evict a live conversation; a sweep removes stale
 * staging on its own terms.
 */
export function measurePhysicalUsage(agentRoot: string, databaseFile: string): PhysicalUsage {
  const databasePath = path.join(agentRoot, databaseFile);
  const databaseBytes = sizeOf(databasePath);
  const walBytes = sizeOf(`${databasePath}-wal`);
  let archiveBytes = 0;
  for (const file of listArchiveFiles(agentRoot)) archiveBytes += file.size;
  return {
    databaseBytes,
    walBytes,
    archiveBytes,
    totalBytes: databaseBytes + walBytes + archiveBytes,
  };
}

export interface ArchiveFileStat {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export function listArchiveFiles(agentRoot: string): ArchiveFileStat[] {
  const directory = archiveDirectory(agentRoot);
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return [];
  }
  const files: ArchiveFileStat[] = [];
  for (const name of names) {
    if (isArchiveStagingName(name)) continue;
    const filePath = path.join(directory, name);
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile())
        files.push({ name, path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // Removed between the listing and the stat: not on disk, not counted.
    }
  }
  return files;
}

/** Removes staging files older than the stale window; a fresh one may be another publication in flight. */
export function removeStaleStaging(agentRoot: string, now: number): number {
  const directory = archiveDirectory(agentRoot);
  let names: string[];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (!isArchiveStagingName(name)) continue;
    const filePath = path.join(directory, name);
    try {
      if (now - fs.statSync(filePath).mtimeMs <= ARCHIVE_STAGING_STALE_MS) continue;
      fs.rmSync(filePath, { force: true });
      removed += 1;
    } catch {
      // Gone already, or unreadable: either way not this sweep's to count.
    }
  }
  return removed;
}
