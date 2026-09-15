import assert from "node:assert/strict";
import { MessageRoleSchema } from "@sidecar/wire";
import { Effect, Option, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { StoredUIMessage } from "../../server/core";
import { CONVERSATION_KIND } from "../../server/db/storage-vocabulary";
import { EpochMillisColumnSchema, InstantColumnSchema } from "../../server/hosted/store/database";
import type { HostedStoreTestRun } from "./hosted-store-database";

/**
 * Raw rows over the ambient `SqlClient`, for the setup and assertions a test
 * still needs beneath the store's own effects: the same tables `writer.ts`
 * and its neighbors write, reached by name rather than by a Drizzle handle —
 * there is none left in this app. Every insert answers the row's minted id
 * where the table has one; every read answers the row (or rows) as the
 * driver hands them back, undecoded beyond what a caller's own assertion
 * needs.
 */

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** A raw row's `timestamptz` column as the instant it holds, whichever of the two readings the dialect gave it. */
export const instantColumn = Schema.decodeUnknownSync(InstantColumnSchema);

export interface ConversationRow {
  readonly userId: string;
  readonly kind?: string;
  readonly providerId?: string | null;
  readonly providerSessionId?: string | null;
  readonly parentConversationId?: string | null;
  readonly spawnedByMessageId?: string | null;
  readonly forkOfSeq?: number | null;
  readonly runtimeSessionId?: string | null;
  readonly createdAt?: Date;
  readonly deletedAt?: Date | null;
  readonly nextMessageSeq?: number;
  readonly nextEventSeq?: number;
  readonly label?: string | null;
  readonly completionDeliveredAt?: Date | null;
}

export function insertConversation(run: HostedStoreTestRun, row: ConversationRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into conversations (
        user_id, kind, provider_id, provider_session_id,
        parent_conversation_id, spawned_by_message_id, fork_of_seq, runtime_session_id,
        created_at, deleted_at, next_message_seq, next_event_seq, label, completion_delivered_at
      )
      values (
        ${row.userId}, ${row.kind ?? CONVERSATION_KIND.MAIN},
        ${row.providerId ?? null}, ${row.providerSessionId ?? null},
        ${row.parentConversationId ?? null}, ${row.spawnedByMessageId ?? null}, ${row.forkOfSeq ?? null},
        ${row.runtimeSessionId ?? null}, ${row.createdAt ?? new Date()}, ${row.deletedAt ?? null},
        ${row.nextMessageSeq ?? 1}, ${row.nextEventSeq ?? 1},
        ${row.label ?? null}, ${row.completionDeliveredAt ?? null}
      )
      returning id
    `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

export function setConversationDeletedAt(
  run: HostedStoreTestRun,
  conversationId: string,
  deletedAt: Date | null,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`update conversations set deleted_at = ${deletedAt} where id = ${conversationId}`;
    }),
  );
}

export function readConversationById(run: HostedStoreTestRun, id: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from conversations where id = ${id}`;
    }),
  );
}

export function readStandingConversations(run: HostedStoreTestRun, userId: string, kind: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
        select id from conversations
        where user_id = ${userId} and kind = ${kind} and deleted_at is null
      `;
    }),
  );
}

export function deleteConversation(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from conversations where id = ${id}`;
    }),
  );
}

export interface MessageRow {
  readonly userId: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId?: string | null;
  readonly clientId: string;
  readonly role: string;
  readonly parts: unknown;
  readonly metadata?: unknown;
  readonly createdAt?: Date;
  readonly finishedAt?: Date | null;
}

export function insertMessage(run: HostedStoreTestRun, row: MessageRow): Promise<string> {
  const parts = JSON.stringify(row.parts);
  const metadata = row.metadata === undefined ? null : JSON.stringify(row.metadata);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into messages (
        user_id, conversation_id, seq, turn_id, client_id, role, parts, metadata, created_at, finished_at
      )
      values (
        ${row.userId}, ${row.conversationId}, ${row.seq}, ${row.turnId ?? null}, ${row.clientId},
        ${row.role}, ${parts}::jsonb, ${metadata}::jsonb, ${row.createdAt ?? new Date()}, ${row.finishedAt ?? null}
      )
      returning id
    `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

export function readMessagesByConversation(run: HostedStoreTestRun, conversationId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from messages where conversation_id = ${conversationId} order by seq`;
    }),
  );
}

export interface TurnInsertRow {
  readonly userId: string;
  readonly conversationId: string;
  readonly origin: string;
  readonly status: string;
  readonly queuedAt?: Date;
  readonly startedAt?: Date | null;
  readonly settledAt?: Date | null;
  readonly responseIds?: readonly string[] | null;
  readonly usage?: unknown;
  readonly failure?: string | null;
}

export function insertTurn(run: HostedStoreTestRun, row: TurnInsertRow): Promise<string> {
  const responseIds = row.responseIds ?? null;
  const usage = row.usage === undefined ? null : JSON.stringify(row.usage);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into turns (
        user_id, conversation_id, origin, status, queued_at, started_at, settled_at,
        response_ids, usage, failure
      )
      values (
        ${row.userId}, ${row.conversationId}, ${row.origin}, ${row.status},
        ${row.queuedAt ?? new Date()}, ${row.startedAt ?? null}, ${row.settledAt ?? null},
        ${responseIds}, ${usage}::jsonb, ${row.failure ?? null}
      )
      returning id
    `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

/** A turn row, decoded to the same camelCase shape the store's own writer builds it under. */
const TurnRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  origin: Schema.String,
  status: Schema.String,
  eveTurnId: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  promptHash: Schema.NullOr(Schema.String),
  toolSetHash: Schema.NullOr(Schema.String),
  responseIds: Schema.NullOr(Schema.Array(Schema.String)),
  usage: Schema.NullOr(Schema.Unknown),
  queuedAt: InstantColumnSchema,
  startedAt: Schema.NullOr(InstantColumnSchema),
  settledAt: Schema.NullOr(InstantColumnSchema),
  failure: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
}).pipe(
  Schema.encodeKeys({
    userId: "user_id",
    conversationId: "conversation_id",
    eveTurnId: "eve_turn_id",
    reasoningEffort: "reasoning_effort",
    promptHash: "prompt_hash",
    toolSetHash: "tool_set_hash",
    responseIds: "response_ids",
    queuedAt: "queued_at",
    startedAt: "started_at",
    settledAt: "settled_at",
    cancelRequestedAt: "cancel_requested_at",
  }),
);
export type TurnRow = Schema.Schema.Type<typeof TurnRowSchema>;
const decodeTurnRow = Schema.decodeUnknownSync(TurnRowSchema);

export function readTurnsByConversation(
  run: HostedStoreTestRun,
  conversationId: string,
): Promise<readonly TurnRow[]> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from turns where conversation_id = ${conversationId}`;
      return rows.map((row) => decodeTurnRow(row));
    }),
  );
}

export function readTurnById(run: HostedStoreTestRun, id: string): Promise<TurnRow | undefined> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from turns where id = ${id}`;
      return rows[0] === undefined ? undefined : decodeTurnRow(rows[0]);
    }),
  );
}

/** Every part this build stores carries at least a `type`, the same shape `writer.ts`'s own column schema checks. */
const readsPartsShape = Schema.is(Schema.Array(Schema.Struct({ type: Schema.String })));
const StoredPartsColumnSchema: Schema.Codec<StoredUIMessage["parts"]> = Schema.declare(
  (input): input is StoredUIMessage["parts"] => readsPartsShape(input),
);

/** A message row, decoded to the same camelCase shape the store's own writer builds it under. */
const MessageRowFullSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  conversationId: Schema.String,
  seq: EpochMillisColumnSchema,
  turnId: Schema.NullOr(Schema.String),
  clientId: Schema.String,
  role: MessageRoleSchema,
  parts: StoredPartsColumnSchema,
  metadata: Schema.NullOr(Schema.Unknown),
  createdAt: InstantColumnSchema,
  finishedAt: Schema.NullOr(InstantColumnSchema),
  revision: Schema.NullOr(EpochMillisColumnSchema),
}).pipe(
  Schema.encodeKeys({
    userId: "user_id",
    conversationId: "conversation_id",
    turnId: "turn_id",
    clientId: "client_id",
    createdAt: "created_at",
    finishedAt: "finished_at",
  }),
);
export type MessageRowFull = Schema.Schema.Type<typeof MessageRowFullSchema>;
const decodeMessageRow = Schema.decodeUnknownSync(MessageRowFullSchema);

export function readMessagesByConversationTyped(
  run: HostedStoreTestRun,
  conversationId: string,
): Promise<readonly MessageRowFull[]> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        select * from messages where conversation_id = ${conversationId} order by seq
      `;
      return rows.map((row) => decodeMessageRow(row));
    }),
  );
}

/**
 * Writes a numbered row in place the way `writer.ts` does: the conversation's
 * journal revision moves and the row takes it, in one statement, so a test
 * that streams or finishes a journal beneath the writer moves the head as the
 * writer would.
 */
export function amendMessageInPlace(
  run: HostedStoreTestRun,
  row: {
    readonly conversationId: string;
    readonly id: string;
    readonly parts: unknown;
    readonly finishedAt?: Date;
  },
): Promise<void> {
  const parts = JSON.stringify(row.parts);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        with bumped as (
          update conversations
          set journal_revision = journal_revision + 1
          where id = ${row.conversationId}
          returning journal_revision
        )
        update messages
        set parts = ${parts}::jsonb,
            finished_at = coalesce(${row.finishedAt ?? null}, finished_at),
            revision = (select journal_revision from bumped)
        where id = ${row.id}
      `;
    }),
  );
}

export function readMessageById(
  run: HostedStoreTestRun,
  id: string,
): Promise<MessageRowFull | undefined> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from messages where id = ${id}`;
      return rows[0] === undefined ? undefined : decodeMessageRow(rows[0]);
    }),
  );
}

export interface EventInsertRow {
  readonly userId: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly kind: string;
  readonly deviceId?: string | null;
  readonly payload?: unknown;
  readonly createdAt?: Date;
}

export function insertEvent(run: HostedStoreTestRun, row: EventInsertRow): Promise<string> {
  const payload = row.payload === undefined ? null : JSON.stringify(row.payload);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into events (user_id, conversation_id, seq, message_id, kind, device_id, payload, created_at)
      values (
        ${row.userId}, ${row.conversationId}, ${row.seq}, ${row.messageId}, ${row.kind},
        ${row.deviceId ?? null}, ${payload}::jsonb, ${row.createdAt ?? new Date()}
      )
      returning id
    `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

export function readEventsByConversation(run: HostedStoreTestRun, conversationId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from events where conversation_id = ${conversationId} order by seq`;
    }),
  );
}

export interface DeviceInsertRow {
  readonly id: string;
  readonly userId: string;
  readonly installationId: string;
  readonly platform: string;
  readonly lastSeenAt?: Date;
  readonly activeUntil?: Date | null;
  readonly quietUntil?: Date | null;
  readonly pushToken?: string | null;
  readonly pushEnvironment?: string | null;
}

export function insertDevice(run: HostedStoreTestRun, row: DeviceInsertRow): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      insert into devices (
        id, user_id, installation_id, platform, last_seen_at, active_until, quiet_until,
        push_token, push_environment
      )
      values (
        ${row.id}, ${row.userId}, ${row.installationId}, ${row.platform}, ${row.lastSeenAt ?? new Date()},
        ${row.activeUntil ?? null}, ${row.quietUntil ?? null}, ${row.pushToken ?? null}, ${row.pushEnvironment ?? null}
      )
    `;
    }),
  );
}

export function readDevicesByUser(run: HostedStoreTestRun, userId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from devices where user_id = ${userId} order by last_seen_at`;
    }),
  );
}

/** A device row, decoded to the same camelCase shape the store's own device seams build it under. */
export const DeviceRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  installationId: Schema.String,
  platform: Schema.String,
  lastSeenAt: InstantColumnSchema,
  activeUntil: Schema.NullOr(InstantColumnSchema),
  quietUntil: Schema.NullOr(InstantColumnSchema),
  pushToken: Schema.NullOr(Schema.String),
  pushEnvironment: Schema.NullOr(Schema.String),
}).pipe(
  Schema.encodeKeys({
    userId: "user_id",
    installationId: "installation_id",
    lastSeenAt: "last_seen_at",
    activeUntil: "active_until",
    quietUntil: "quiet_until",
    pushToken: "push_token",
    pushEnvironment: "push_environment",
  }),
);
export type DeviceRow = Schema.Schema.Type<typeof DeviceRowSchema>;
const decodeDeviceRow = Schema.decodeUnknownSync(DeviceRowSchema);

export function readDeviceById(
  run: HostedStoreTestRun,
  id: string,
): Promise<DeviceRow | undefined> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from devices where id = ${id}`;
      return rows[0] === undefined ? undefined : decodeDeviceRow(rows[0]);
    }),
  );
}

export function setVoiceSessionDeviceId(
  run: HostedStoreTestRun,
  liveSessionId: string,
  deviceId: string | null,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      update voice_sessions set device_id = ${deviceId} where live_session_id = ${liveSessionId}
    `;
    }),
  );
}

export function setDeviceQuietUntil(
  run: HostedStoreTestRun,
  id: string,
  quietUntil: Date | null,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`update devices set quiet_until = ${quietUntil} where id = ${id}`;
    }),
  );
}

export function setDeviceActiveUntil(
  run: HostedStoreTestRun,
  id: string,
  activeUntil: Date | null,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`update devices set active_until = ${activeUntil} where id = ${id}`;
    }),
  );
}

export function readEventsByMessage(run: HostedStoreTestRun, messageId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from events where message_id = ${messageId} order by seq`;
    }),
  );
}

export interface VoiceSessionInsertRow {
  readonly userId: string;
  readonly liveSessionId: string;
  readonly delegationMode: string;
  readonly deviceId?: string | null | undefined;
  readonly closedAt?: Date | null | undefined;
  readonly closeReason?: string | null | undefined;
  readonly usage?: unknown;
}

export function insertVoiceSession(
  run: HostedStoreTestRun,
  row: VoiceSessionInsertRow,
): Promise<string> {
  const usage = row.usage === undefined ? null : JSON.stringify(row.usage);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into voice_sessions (
        user_id, device_id, live_session_id, delegation_mode, closed_at, close_reason, usage
      )
      values (
        ${row.userId}, ${row.deviceId ?? null}, ${row.liveSessionId}, ${row.delegationMode},
        ${row.closedAt ?? null}, ${row.closeReason ?? null}, ${usage}::jsonb
      )
      returning id
    `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

const VoiceSessionRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  deviceId: Schema.NullOr(Schema.String),
  liveSessionId: Schema.String,
  delegationMode: Schema.String,
  startedAt: InstantColumnSchema,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Schema.Unknown),
}).pipe(
  Schema.encodeKeys({
    userId: "user_id",
    deviceId: "device_id",
    liveSessionId: "live_session_id",
    delegationMode: "delegation_mode",
    startedAt: "started_at",
    closedAt: "closed_at",
    closeReason: "close_reason",
  }),
);
export type VoiceSessionRow = Schema.Schema.Type<typeof VoiceSessionRowSchema>;
const decodeVoiceSessionRow = Schema.decodeUnknownSync(VoiceSessionRowSchema);

export function readVoiceSessionByIdTyped(
  run: HostedStoreTestRun,
  id: string,
): Promise<VoiceSessionRow | undefined> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from voice_sessions where id = ${id}`;
      return rows[0] === undefined ? undefined : decodeVoiceSessionRow(rows[0]);
    }),
  );
}

export function readVoiceSessionsByUserTyped(
  run: HostedStoreTestRun,
  userId: string,
): Promise<readonly VoiceSessionRow[]> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from voice_sessions where user_id = ${userId}`;
      return rows.map((row) => decodeVoiceSessionRow(row));
    }),
  );
}

export interface VoiceSegmentInsertRow {
  readonly voiceSessionId: string;
  readonly seq: number;
  readonly role: string;
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function insertVoiceTranscriptSegment(
  run: HostedStoreTestRun,
  row: VoiceSegmentInsertRow,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      insert into voice_transcript_segments (voice_session_id, seq, role, text, start_ms, end_ms)
      values (${row.voiceSessionId}, ${row.seq}, ${row.role}, ${row.text}, ${row.startMs}, ${row.endMs})
    `;
    }),
  );
}

export function deleteVoiceSession(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from voice_sessions where id = ${id}`;
    }),
  );
}

export function deleteDevice(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from devices where id = ${id}`;
    }),
  );
}

export function readVoiceSessionByLiveSessionId(run: HostedStoreTestRun, liveSessionId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from voice_sessions where live_session_id = ${liveSessionId}`;
    }),
  );
}

export function readVoiceTranscriptSegmentsBySession(
  run: HostedStoreTestRun,
  voiceSessionId: string,
) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
      select * from voice_transcript_segments where voice_session_id = ${voiceSessionId} order by seq
    `;
    }),
  );
}

export function deleteUser(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from "user" where id = ${id}`;
    }),
  );
}

/** A count of a table's rows for one user, by the table's own name; every table this reaches keys its rows by `user_id`. */
export function countRowsForUser(
  run: HostedStoreTestRun,
  table: string,
  userId: string,
): Promise<number> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      select count(*)::int as count from ${sql(table)} where user_id = ${userId}
    `;
      return Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Number }))(rows[0]).count;
    }),
  );
}

/** A count of a table's rows matching one column's equality, by the table and column's own names. */
export function countRowsWhere(
  run: HostedStoreTestRun,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      select count(*)::int as count from ${sql(table)} where ${sql(column)} = ${value}
    `;
      return Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Number }))(rows[0]).count;
    }),
  );
}

export interface ToolSetRow {
  readonly hash: string;
  readonly schemas: unknown;
}

export function insertToolSet(run: HostedStoreTestRun, row: ToolSetRow): Promise<void> {
  const schemas = JSON.stringify(row.schemas);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`insert into tool_sets (hash, schemas) values (${row.hash}, ${schemas}::jsonb)`;
    }),
  );
}

export function insertToolSetIgnoringConflict(
  run: HostedStoreTestRun,
  row: ToolSetRow,
): Promise<void> {
  const schemas = JSON.stringify(row.schemas);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      insert into tool_sets (hash, schemas) values (${row.hash}, ${schemas}::jsonb)
      on conflict (hash) do nothing
    `;
    }),
  );
}

export function readToolSetsByHash(run: HostedStoreTestRun, hash: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from tool_sets where hash = ${hash}`;
    }),
  );
}

export interface ProviderCursorRow {
  readonly userId: string;
  readonly providerId: string;
  readonly providerSessionId: string;
  readonly cursor: string;
}

export function insertProviderCursor(
  run: HostedStoreTestRun,
  row: ProviderCursorRow,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      insert into provider_cursors (user_id, provider_id, provider_session_id, cursor)
      values (${row.userId}, ${row.providerId}, ${row.providerSessionId}, ${row.cursor})
    `;
    }),
  );
}

export function upsertProviderCursor(
  run: HostedStoreTestRun,
  row: ProviderCursorRow,
): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
      insert into provider_cursors (user_id, provider_id, provider_session_id, cursor)
      values (${row.userId}, ${row.providerId}, ${row.providerSessionId}, ${row.cursor})
      on conflict (user_id, provider_id, provider_session_id) do update set cursor = excluded.cursor
    `;
    }),
  );
}

export function readProviderCursorsByUser(run: HostedStoreTestRun, userId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
      select provider_session_id, cursor from provider_cursors
      where user_id = ${userId} order by provider_session_id
    `;
    }),
  );
}

/**
 * The driver's own refusal code (Postgres's `SQLSTATE`, e.g. `23505` for a
 * unique violation) off a rejected `database.run(...)` promise: a promise door
 * rejects with the squashed `Cause`, which is the `SqlError` itself, nothing
 * wrapping it. v4's `SqlError` states what went wrong as a structured `reason`
 * of its own and aliases its `cause` to that reason, so the driver's own error
 * — the one carrying the code — is a level further down than it was when the
 * error wrapped it directly.
 */
const DriverErrorSchema = Schema.Struct({
  cause: Schema.Struct({ cause: Schema.Struct({ code: Schema.String }) }),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the boundary: the value node:assert's own `rejects` caught, parsed immediately below by Schema.
function sqlErrorCode(error: unknown): string | undefined {
  return Option.map(
    Schema.decodeUnknownOption(DriverErrorSchema)(error),
    (decoded) => decoded.cause.cause.code,
  ).pipe(Option.getOrUndefined);
}

/** A statement's promise is refused for exactly the Postgres code named. */
export async function assertRefusedWithCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error) => {
    assert.equal(sqlErrorCode(error), code);
    return true;
  });
}

export const POSTGRES_ERROR = {
  UNIQUE_VIOLATION: "23505",
} as const;
