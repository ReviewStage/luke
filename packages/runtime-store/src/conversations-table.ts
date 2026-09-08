import type { SQLInputValue } from "node:sqlite";
import {
  type AgentId,
  type ArchiveReason,
  CONVERSATION_KIND,
  type ConversationKind,
  type ConversationRecord,
  conversationKindOf,
  isArchiveReason,
  isConversationKind,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import { nullable, type RuntimeDatabase } from "./database.js";

/**
 * The conversation directory: every logical conversation the agent holds,
 * with its kind and where it stands in its lifecycle. A row outlives every
 * lifetime that runs under it — a Start fresh replaces the session and keeps
 * the row and its history — and leaves the active list by being archived,
 * never by being deleted, until the recoverable deletion removes it with an
 * archive behind it.
 */

interface ConversationRow {
  session_key: string;
  kind: string;
  name: string;
  created_at: number;
  last_activity_at: number;
  archived_at: number | null;
  archive_reason: string | null;
  pinned_at: number | null;
  session_id: string | null;
}

const CONVERSATION_COLUMNS = `c.session_key, c.kind, c.name, c.created_at, c.last_activity_at,
       c.archived_at, c.archive_reason, c.pinned_at, s.session_id`;
const CONVERSATION_FROM = `FROM conversations c
       LEFT JOIN conversation_sessions s ON s.session_key = c.session_key`;

function recordFromRow(row: ConversationRow): ConversationRecord {
  const kind: ConversationKind = isConversationKind(row.kind)
    ? row.kind
    : conversationKindOf(row.session_key);
  const reason: ArchiveReason | undefined = isArchiveReason(row.archive_reason)
    ? row.archive_reason
    : undefined;
  return {
    // SAFETY: the column holds the key the constructor admitted when the row was written.
    sessionKey: row.session_key as SessionKey,
    kind,
    name: row.name,
    createdAt: row.created_at,
    lastActivityAt: Math.max(row.last_activity_at, row.created_at),
    ...(row.archived_at !== null ? { archivedAt: row.archived_at } : undefined),
    ...(row.archived_at !== null && reason ? { archiveReason: reason } : undefined),
    ...(row.pinned_at !== null ? { pinnedAt: row.pinned_at } : undefined),
    ...(row.session_id !== null ? { sessionId: row.session_id } : undefined),
  };
}

export function listConversations(database: RuntimeDatabase): readonly ConversationRecord[] {
  // SAFETY: the columns selected are the ones the row type names, typed by the schema.
  const rows = database
    .prepare(
      `SELECT ${CONVERSATION_COLUMNS} ${CONVERSATION_FROM} ORDER BY c.created_at, c.session_key`,
    )
    .all() as unknown as ConversationRow[];
  return rows.map(recordFromRow);
}

export function conversationRecord(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
): ConversationRecord | undefined {
  // SAFETY: as above, for one row or none.
  const row = database
    .prepare(`SELECT ${CONVERSATION_COLUMNS} ${CONVERSATION_FROM} WHERE c.session_key = ?`)
    .get(sessionKey) as unknown as ConversationRow | undefined;
  return row ? recordFromRow(row) : undefined;
}

export interface ConversationCreation {
  agentId: AgentId;
  sessionKey: SessionKey;
  name: string;
  now: number;
  /** The kind the key says it is unless the caller names one; a caller cannot make a main by naming it. */
  kind?: ConversationKind;
}

/** Creates the conversation, or answers the one that already stands at the key. */
export function createConversation(
  database: RuntimeDatabase,
  creation: ConversationCreation,
): ConversationRecord {
  return database.transaction(() => {
    const standing = conversationRecord(database, creation.sessionKey);
    if (standing) return standing;
    const kind = creation.kind ?? conversationKindOf(creation.sessionKey);
    database
      .prepare("INSERT OR IGNORE INTO agents (agent_id, created_at) VALUES (?, ?)")
      .run(creation.agentId, creation.now);
    database
      .prepare(
        `INSERT INTO conversations (session_key, agent_id, name, created_at, kind, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(creation.sessionKey, creation.agentId, creation.name, creation.now, kind, creation.now);
    const created = conversationRecord(database, creation.sessionKey);
    if (!created) throw new Error(`conversation ${creation.sessionKey} was not created`);
    return created;
  });
}

/** Moves the conversation's latest activity forward to `now`; never back. */
export function touchConversation(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  now: number,
): void {
  database
    .prepare(
      "UPDATE conversations SET last_activity_at = MAX(last_activity_at, ?) WHERE session_key = ?",
    )
    .run(now, sessionKey);
}

/** Archives the conversation for the reason given; a main conversation cannot be archived at all. */
export function archiveConversation(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  now: number,
  reason: ArchiveReason,
): boolean {
  const record = conversationRecord(database, sessionKey);
  if (!record || record.kind === CONVERSATION_KIND.MAIN) return false;
  if (record.archivedAt !== undefined) return true;
  database
    .prepare("UPDATE conversations SET archived_at = ?, archive_reason = ? WHERE session_key = ?")
    .run(now, reason, sessionKey);
  return true;
}

export function unarchiveConversation(database: RuntimeDatabase, sessionKey: SessionKey): boolean {
  const { changes } = database
    .prepare(
      "UPDATE conversations SET archived_at = NULL, archive_reason = NULL WHERE session_key = ?",
    )
    .run(sessionKey);
  return changes > 0;
}

export function pinConversation(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  pinnedAt: number | undefined,
): boolean {
  const pin: SQLInputValue = nullable(pinnedAt);
  const { changes } = database
    .prepare("UPDATE conversations SET pinned_at = ? WHERE session_key = ?")
    .run(pin, sessionKey);
  return changes > 0;
}

export function renameConversation(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  name: string,
): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const { changes } = database
    .prepare("UPDATE conversations SET name = ? WHERE session_key = ?")
    .run(trimmed, sessionKey);
  return changes > 0;
}

/** Removes the conversation row itself; only the recoverable deletion calls it, after the rows under it are gone. */
export function removeConversationRow(database: RuntimeDatabase, sessionKey: SessionKey): void {
  database.prepare("DELETE FROM conversations WHERE session_key = ?").run(sessionKey);
}
