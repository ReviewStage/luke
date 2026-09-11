import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
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
  sessionKey as sessionKeyOf,
} from "@sidecar/runtime/vocabulary";
import { Effect, Option, Schema } from "effect";
import type { StoreDatabase } from "./database.js";
import { changedRows, columnsDecoded } from "./rows.js";

/**
 * The conversation directory: every logical conversation the agent holds,
 * with its kind and where it stands in its lifecycle. A row outlives every
 * lifetime that runs under it — a Start fresh replaces the session and keeps
 * the row and its history — and leaves the active list by being archived,
 * never by being deleted, until the recoverable deletion removes it with an
 * archive behind it.
 *
 * Every read here decodes its columns through a schema rather than trusting a
 * cast, and the record it answers with is `@sidecar/runtime`'s own
 * `ConversationRecord`, built through that shape's own guards and its session
 * key's own constructor, so the directory has one statement of what a
 * conversation is and this module states none of it a second time.
 */

const ConversationRow = Schema.Struct({
  session_key: Schema.String,
  kind: Schema.String,
  name: Schema.String,
  created_at: Schema.Number,
  last_activity_at: Schema.Number,
  archived_at: Schema.NullOr(Schema.Number),
  archive_reason: Schema.NullOr(Schema.String),
  pinned_at: Schema.NullOr(Schema.Number),
  session_id: Schema.NullOr(Schema.String),
});

type ConversationRow = Schema.Schema.Type<typeof ConversationRow>;

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
    sessionKey: sessionKeyOf(row.session_key),
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

const everyConversationRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: ConversationRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT ${sql.literal(CONVERSATION_COLUMNS)} ${sql.literal(CONVERSATION_FROM)}
            ORDER BY c.created_at, c.session_key`,
    ),
});

const conversationRowAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: ConversationRow,
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT ${sql.literal(CONVERSATION_COLUMNS)} ${sql.literal(CONVERSATION_FROM)}
            WHERE c.session_key = ${key}`,
    ),
});

export const listConversationsEffect: Effect.Effect<
  readonly ConversationRecord[],
  SqlError,
  Client.SqlClient
> = Effect.map(columnsDecoded(everyConversationRow()), (rows) => rows.map(recordFromRow));

export const conversationRecordEffect = (
  key: SessionKey,
): Effect.Effect<ConversationRecord | undefined, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(conversationRowAt(key)), (row) =>
    Option.match(row, { onNone: () => undefined, onSome: recordFromRow }),
  );

export interface ConversationCreation {
  agentId: AgentId;
  sessionKey: SessionKey;
  name: string;
  now: number;
  /** The kind the key says it is unless the caller names one; a caller cannot make a main by naming it. */
  kind?: ConversationKind;
}

/** Creates the conversation, or answers the one that already stands at the key; idempotent. */
export const createConversationEffect = (
  creation: ConversationCreation,
): Effect.Effect<ConversationRecord, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT OR IGNORE INTO agents (agent_id, created_at)
                   VALUES (${creation.agentId}, ${creation.now})`;
        yield* sql`INSERT OR IGNORE INTO conversations
                     (session_key, agent_id, name, created_at, kind, last_activity_at)
                   VALUES (${creation.sessionKey}, ${creation.agentId}, ${creation.name},
                           ${creation.now}, ${creation.kind ?? conversationKindOf(creation.sessionKey)},
                           ${creation.now})`;
        const created = yield* conversationRecordEffect(creation.sessionKey);
        if (!created) {
          return yield* Effect.die(
            new Error(`conversation ${creation.sessionKey} was not created`),
          );
        }
        return created;
      }),
    ),
  );

/** The conversation's durable Clear cutoff, which outlives the generation whose marker raised it. */
export const conversationCutoffEffect = (
  key: SessionKey,
): Effect.Effect<number | undefined, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(cutoffRowAt(key)), (row) =>
    Option.flatMapNullable(row, ({ conversation_cleared_at }) => conversation_cleared_at).pipe(
      Option.getOrUndefined,
    ),
  );

const cutoffRowAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ conversation_cleared_at: Schema.NullOr(Schema.Number) }),
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT conversation_cleared_at FROM conversations WHERE session_key = ${key}`,
    ),
});

/** Raises the conversation's durable cutoff to `clearedAt`; never lowers it. */
export const raiseConversationCutoffEffect = (
  key: SessionKey,
  clearedAt: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`UPDATE conversations
          SET conversation_cleared_at = MAX(COALESCE(conversation_cleared_at, ${clearedAt}), ${clearedAt})
          WHERE session_key = ${key}`,
  ).pipe(Effect.asVoid);

/** Moves the conversation's latest activity forward to `now`; never back. */
export const touchConversationEffect = (
  key: SessionKey,
  now: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`UPDATE conversations SET last_activity_at = MAX(last_activity_at, ${now})
          WHERE session_key = ${key}`,
  ).pipe(Effect.asVoid);

/** Archives the conversation for the reason given; a main conversation cannot be archived at all. */
export const archiveConversationEffect = (
  key: SessionKey,
  now: number,
  reason: ArchiveReason,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const record = yield* conversationRecordEffect(key);
    if (!record || record.kind === CONVERSATION_KIND.MAIN) return false;
    if (record.archivedAt !== undefined) return true;
    yield* sql`UPDATE conversations SET archived_at = ${now}, archive_reason = ${reason}
               WHERE session_key = ${key}`;
    return true;
  });

export const unarchiveConversationEffect = (
  key: SessionKey,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const changes = yield* changedRows(
      sql`UPDATE conversations SET archived_at = NULL, archive_reason = NULL
          WHERE session_key = ${key}`.raw,
    );
    return changes > 0;
  });

export const pinConversationEffect = (
  key: SessionKey,
  pinnedAt: number | undefined,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const changes = yield* changedRows(
      sql`UPDATE conversations SET pinned_at = ${pinnedAt ?? null} WHERE session_key = ${key}`.raw,
    );
    return changes > 0;
  });

/**
 * Removes everything a conversation holds beneath its row: its history
 * lines, its transcript and the boundaries folded into it, and the standing
 * lifetime with the checkpoints, cursors, requests, and receipts that cascade
 * from it. The row itself stays unless the caller removes it too; the
 * recoverable deletion and maintenance are the two callers, and each has
 * committed or needs no archive by the time it gets here.
 */
const removeConversationRowsEffect = (
  key: SessionKey,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    yield* sql`DELETE FROM conversation_events WHERE session_key = ${key}`;
    yield* sql`DELETE FROM compaction_boundaries WHERE session_key = ${key}`;
    yield* sql`DELETE FROM transcript_events WHERE session_key = ${key}`;
    yield* sql`DELETE FROM conversation_sessions WHERE session_key = ${key}`;
  });

/**
 * Removes what stood at or before `instant`: the lines and transcript
 * recorded by then, the boundaries at or before it, and every lifetime but
 * the one named, which is the successor the fence began at the same instant.
 * A line accepted after the instant — a voice line landing while the
 * deletion waited on the disk — is not the deletion's to take.
 */
const removeConversationRowsAtOrBeforeEffect = (
  key: SessionKey,
  instant: number,
  keepSessionId: string | undefined,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    yield* sql`DELETE FROM conversation_events
               WHERE session_key = ${key} AND recorded_at <= ${instant}`;
    yield* sql`DELETE FROM compaction_boundaries
               WHERE session_key = ${key} AND created_at <= ${instant}`;
    yield* sql`DELETE FROM transcript_events
               WHERE session_key = ${key} AND recorded_at <= ${instant}`;
    yield* sql`DELETE FROM conversation_sessions
               WHERE session_key = ${key} AND session_id IS NOT ${keepSessionId ?? null}`;
  });

/** Removes the conversation row itself, after the rows under it are gone. */
const removeConversationRowEffect = (
  key: SessionKey,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) => sql`DELETE FROM conversations WHERE session_key = ${key}`,
  ).pipe(Effect.asVoid);

/**
 * The synchronous doors onto the effects above, for the callers that still
 * hold a handle rather than a client: the envelope's save, the recoverable
 * deletion, the maintenance pass, and the store's own tests.
 *
 * @deprecated Each goes with the caller that holds it: the store's operations
 * run the effects themselves already, and P5-11 runs every remaining one on
 * the worker's own runtime edge.
 */
export function listConversations(database: StoreDatabase): readonly ConversationRecord[] {
  return database.run(listConversationsEffect);
}

/** @deprecated The synchronous door onto {@link conversationRecordEffect}; see {@link listConversations}. */
export function conversationRecord(
  database: StoreDatabase,
  key: SessionKey,
): ConversationRecord | undefined {
  return database.run(conversationRecordEffect(key));
}

/** @deprecated The synchronous door onto {@link createConversationEffect}; see {@link listConversations}. */
export function createConversation(
  database: StoreDatabase,
  creation: ConversationCreation,
): ConversationRecord {
  return database.run(createConversationEffect(creation));
}

/** @deprecated The synchronous door onto {@link conversationCutoffEffect}; see {@link listConversations}. */
export function conversationCutoff(database: StoreDatabase, key: SessionKey): number | undefined {
  return database.run(conversationCutoffEffect(key));
}

/** @deprecated The synchronous door onto {@link raiseConversationCutoffEffect}; see {@link listConversations}. */
export function raiseConversationCutoff(
  database: StoreDatabase,
  key: SessionKey,
  clearedAt: number,
): void {
  database.run(raiseConversationCutoffEffect(key, clearedAt));
}

/** @deprecated The synchronous door onto {@link archiveConversationEffect}; see {@link listConversations}. */
export function archiveConversation(
  database: StoreDatabase,
  key: SessionKey,
  now: number,
  reason: ArchiveReason,
): boolean {
  return database.run(archiveConversationEffect(key, now, reason));
}

/** @deprecated The synchronous door onto {@link pinConversationEffect}; see {@link listConversations}. */
export function pinConversation(
  database: StoreDatabase,
  key: SessionKey,
  pinnedAt: number | undefined,
): boolean {
  return database.run(pinConversationEffect(key, pinnedAt));
}

/** @deprecated The synchronous door onto {@link removeConversationRowsEffect}; see {@link listConversations}. */
export function removeConversationRows(database: StoreDatabase, key: SessionKey): void {
  database.run(removeConversationRowsEffect(key));
}

/** @deprecated The synchronous door onto {@link removeConversationRowsAtOrBeforeEffect}; see {@link listConversations}. */
export function removeConversationRowsAtOrBefore(
  database: StoreDatabase,
  key: SessionKey,
  instant: number,
  keepSessionId: string | undefined,
): void {
  database.run(removeConversationRowsAtOrBeforeEffect(key, instant, keepSessionId));
}

/** @deprecated The synchronous door onto {@link removeConversationRowEffect}; see {@link listConversations}. */
export function removeConversationRow(database: StoreDatabase, key: SessionKey): void {
  database.run(removeConversationRowEffect(key));
}
