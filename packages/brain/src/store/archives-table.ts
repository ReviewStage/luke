import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import {
  type ArchiveEncoding,
  type ConversationArchiveRecord,
  type ConversationKind,
  conversationArchiveRecordFromWire,
  conversationKindOf,
  isConversationKind,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import { Effect, Option, Schema } from "effect";
import type { StoreDatabase } from "./database.js";
import { changedRows, columnsDecoded } from "./rows.js";

/**
 * The archive registry: one row per recoverable deletion, committed into the
 * transaction that removes a conversation's rows and holding its payload
 * until publication lets it go. The registry never reads its own payload
 * back for anyone but the publisher: `archivePayloadEffect` is that one
 * reader, and every other caller reads the record `conversationArchiveRecordFromWire`
 * builds, the same shared shape the directory answers with.
 */

const ArchiveRow = Schema.Struct({
  archive_id: Schema.String,
  session_key: Schema.String,
  kind: Schema.String,
  name: Schema.String,
  created_at: Schema.Number,
  deleted_at: Schema.Number,
  encoding: Schema.String,
  sha256: Schema.String,
  byte_length: Schema.Number,
  file_name: Schema.String,
  published_at: Schema.NullOr(Schema.Number),
  conversation_lines: Schema.Number,
  transcript_events: Schema.Number,
  previous_cutoff: Schema.NullOr(Schema.Number),
});

type ArchiveRow = Schema.Schema.Type<typeof ArchiveRow>;

const ARCHIVE_COLUMNS = `archive_id, session_key, kind, name, created_at, deleted_at, encoding, sha256,
  byte_length, file_name, published_at, conversation_lines, transcript_events, previous_cutoff`;

function recordFromRow(row: ArchiveRow): ConversationArchiveRecord | undefined {
  return conversationArchiveRecordFromWire({
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
    conversationLines: row.conversation_lines,
    transcriptEvents: row.transcript_events,
  });
}

const everyArchiveRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: ArchiveRow,
  execute: () =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT ${sql.literal(ARCHIVE_COLUMNS)} FROM conversation_archives
            ORDER BY deleted_at DESC, archive_id`,
    ),
});

const archiveRowAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: ArchiveRow,
  execute: (archiveId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT ${sql.literal(ARCHIVE_COLUMNS)} FROM conversation_archives
            WHERE archive_id = ${archiveId}`,
    ),
});

const archivePayloadAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ payload: Schema.NullOr(Schema.Uint8ArrayFromSelf) }),
  execute: (archiveId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) => sql`SELECT payload FROM conversation_archives WHERE archive_id = ${archiveId}`,
    ),
});

/** Every registered archive, most recently deleted first. */
export const listArchivesEffect: Effect.Effect<
  readonly ConversationArchiveRecord[],
  SqlError,
  Client.SqlClient
> = Effect.map(columnsDecoded(everyArchiveRow()), (rows) => {
  const records: ConversationArchiveRecord[] = [];
  for (const row of rows) {
    const record = recordFromRow(row);
    if (record) records.push(record);
  }
  return records;
});

/** The one archive registered at `archiveId`, or nothing when no row names it. */
export const archiveRecordEffect = (
  archiveId: string,
): Effect.Effect<ConversationArchiveRecord | undefined, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(archiveRowAt(archiveId)), (row) =>
    Option.match(row, { onNone: () => undefined, onSome: recordFromRow }),
  );

/**
 * The bytes a registered archive still holds, or nothing once it is
 * published and the column has gone to NULL. The publisher is the only
 * reader of this column: nothing else reads an archive's payload back.
 */
export const archivePayloadEffect = (
  archiveId: string,
): Effect.Effect<Uint8Array | undefined, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(archivePayloadAt(archiveId)), (row) =>
    Option.flatMapNullable(row, ({ payload }) => payload).pipe(Option.getOrUndefined),
  );

export interface ArchiveInsertion {
  readonly archiveId: string;
  readonly sessionKey: SessionKey;
  readonly kind: ConversationKind;
  readonly name: string;
  readonly createdAt: number;
  readonly deletedAt: number;
  readonly encoding: ArchiveEncoding;
  readonly sha256: string;
  readonly byteLength: number;
  readonly fileName: string;
  readonly conversationLines: number;
  readonly transcriptEvents: number;
  readonly previousCutoff: number | undefined;
  readonly payload: Uint8Array;
}

/**
 * Commits one archive's registry row with its payload still attached and
 * `published_at` unset, in the same transaction the caller removes the
 * conversation's rows in: the durable seam a crash the instant after leaves
 * standing.
 */
export const insertArchiveEffect = (
  insertion: ArchiveInsertion,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`INSERT INTO conversation_archives
            (archive_id, session_key, kind, name, created_at, deleted_at, encoding, sha256,
             byte_length, file_name, published_at, conversation_lines, transcript_events,
             previous_cutoff, payload)
          VALUES (${insertion.archiveId}, ${insertion.sessionKey}, ${insertion.kind}, ${insertion.name},
                  ${insertion.createdAt}, ${insertion.deletedAt}, ${insertion.encoding}, ${insertion.sha256},
                  ${insertion.byteLength}, ${insertion.fileName}, NULL, ${insertion.conversationLines},
                  ${insertion.transcriptEvents}, ${insertion.previousCutoff ?? null}, ${insertion.payload})`,
  ).pipe(Effect.asVoid);

/**
 * Marks a registered archive published and lets its payload go: only a
 * publication whose every durability operation succeeded reaches this call.
 */
export const markArchivePublishedEffect = (
  archiveId: string,
  publishedAt: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`UPDATE conversation_archives SET published_at = ${publishedAt}, payload = NULL
          WHERE archive_id = ${archiveId}`,
  ).pipe(Effect.asVoid);

/** The ids of every archive a launch still owes a publication, oldest deletion first. */
export const pendingArchiveIdsEffect: Effect.Effect<readonly string[], SqlError, Client.SqlClient> =
  Effect.map(
    columnsDecoded(
      SqlSchema.findAll({
        Request: Schema.Void,
        Result: Schema.Struct({ archive_id: Schema.String }),
        execute: () =>
          Effect.flatMap(
            Client.SqlClient,
            (sql) =>
              sql`SELECT archive_id FROM conversation_archives
                WHERE published_at IS NULL ORDER BY deleted_at`,
          ),
      })(),
    ),
    (rows) => rows.map((row) => row.archive_id),
  );

/** Forgets one archive's registry row; answers whether a row stood at that id. */
export const removeArchiveRowEffect = (
  archiveId: string,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    const changes = yield* changedRows(
      sql`DELETE FROM conversation_archives WHERE archive_id = ${archiveId}`.raw,
    );
    return changes > 0;
  });

/**
 * The synchronous doors onto the effects above, for `archives.ts`, which
 * stays a port in OpenClaw's shape and imports nothing from `effect`.
 *
 * @deprecated Each goes with `archives.ts`'s own callers: P5-11 runs every
 * remaining one on the worker's own runtime edge.
 */
export function listArchives(database: StoreDatabase): readonly ConversationArchiveRecord[] {
  return database.run(listArchivesEffect);
}

/** @deprecated The synchronous door onto {@link archiveRecordEffect}; see {@link listArchives}. */
export function archiveRecord(
  database: StoreDatabase,
  archiveId: string,
): ConversationArchiveRecord | undefined {
  return database.run(archiveRecordEffect(archiveId));
}

/** @deprecated The synchronous door onto {@link archivePayloadEffect}; see {@link listArchives}. */
export function archivePayload(database: StoreDatabase, archiveId: string): Uint8Array | undefined {
  return database.run(archivePayloadEffect(archiveId));
}

/** @deprecated The synchronous door onto {@link insertArchiveEffect}; see {@link listArchives}. */
export function insertArchive(database: StoreDatabase, insertion: ArchiveInsertion): void {
  database.run(insertArchiveEffect(insertion));
}

/** @deprecated The synchronous door onto {@link markArchivePublishedEffect}; see {@link listArchives}. */
export function markArchivePublished(
  database: StoreDatabase,
  archiveId: string,
  publishedAt: number,
): void {
  database.run(markArchivePublishedEffect(archiveId, publishedAt));
}

/** @deprecated The synchronous door onto {@link pendingArchiveIdsEffect}; see {@link listArchives}. */
export function pendingArchiveIds(database: StoreDatabase): readonly string[] {
  return database.run(pendingArchiveIdsEffect);
}

/** @deprecated The synchronous door onto {@link removeArchiveRowEffect}; see {@link listArchives}. */
export function removeArchiveRow(database: StoreDatabase, archiveId: string): boolean {
  return database.run(removeArchiveRowEffect(archiveId));
}
