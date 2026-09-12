import assert from "node:assert/strict";
import * as SqlClient from "@effect/sql/SqlClient";
import { MessageRoleSchema } from "@sidecar/wire";
import { Cause, Effect, Option, Runtime, Schema } from "effect";
import type { StoredUIMessage } from "../../server/core";
import { CONVERSATION_KIND } from "../../server/db/storage-vocabulary";
import type { HostedStoreRun } from "../../server/hosted/store";
import { EpochMillisColumnSchema } from "../../server/hosted/store/database";

/**
 * Raw rows over the ambient `SqlClient`, for the setup and assertions a test
 * still needs beneath the store's own effects: the same tables `writer.ts`
 * and its neighbors write, reached by name rather than by the Drizzle handle
 * P10-14c2 removed. Every insert answers the row's minted id where the table
 * has one; every read answers the row (or rows) as the driver hands them
 * back, undecoded beyond what a caller's own assertion needs.
 */

const IdRowSchema = Schema.Struct({ id: Schema.String });

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
}

export function insertConversation(run: HostedStoreRun, row: ConversationRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into conversations (
        user_id, kind, provider_id, provider_session_id,
        parent_conversation_id, spawned_by_message_id, fork_of_seq, runtime_session_id,
        created_at, deleted_at, next_message_seq, next_event_seq
      )
      values (
        ${row.userId}, ${row.kind ?? CONVERSATION_KIND.MAIN},
        ${row.providerId ?? null}, ${row.providerSessionId ?? null},
        ${row.parentConversationId ?? null}, ${row.spawnedByMessageId ?? null}, ${row.forkOfSeq ?? null},
        ${row.runtimeSessionId ?? null}, ${row.createdAt ?? new Date()}, ${row.deletedAt ?? null},
        ${row.nextMessageSeq ?? 1}, ${row.nextEventSeq ?? 1}
      )
      returning id
    `;
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

export function setConversationDeletedAt(
  run: HostedStoreRun,
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

export function readConversationById(run: HostedStoreRun, id: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from conversations where id = ${id}`;
    }),
  );
}

export function readStandingConversations(run: HostedStoreRun, userId: string, kind: string) {
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

export function deleteConversation(run: HostedStoreRun, id: string): Promise<void> {
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

export function insertMessage(run: HostedStoreRun, row: MessageRow): Promise<string> {
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

export function readMessagesByConversation(run: HostedStoreRun, conversationId: string) {
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
}

export function insertTurn(run: HostedStoreRun, row: TurnInsertRow): Promise<string> {
  const responseIds = row.responseIds ?? null;
  const usage = row.usage === undefined ? null : JSON.stringify(row.usage);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
      insert into turns (
        user_id, conversation_id, origin, status, queued_at, started_at, settled_at,
        response_ids, usage
      )
      values (
        ${row.userId}, ${row.conversationId}, ${row.origin}, ${row.status},
        ${row.queuedAt ?? new Date()}, ${row.startedAt ?? null}, ${row.settledAt ?? null},
        ${responseIds}, ${usage}::jsonb
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
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  origin: Schema.String,
  status: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("reasoning_effort"),
  ),
  promptHash: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("prompt_hash"),
  ),
  toolSetHash: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("tool_set_hash"),
  ),
  responseIds: Schema.propertySignature(Schema.NullOr(Schema.Array(Schema.String))).pipe(
    Schema.fromKey("response_ids"),
  ),
  usage: Schema.NullOr(Schema.Unknown),
  queuedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("queued_at")),
  startedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("started_at"),
  ),
  settledAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("settled_at"),
  ),
  failure: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("cancel_requested_at"),
  ),
});
export type TurnRow = Schema.Schema.Type<typeof TurnRowSchema>;
const decodeTurnRow = Schema.decodeUnknownSync(TurnRowSchema);

export function readTurnsByConversation(
  run: HostedStoreRun,
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

export function readTurnById(run: HostedStoreRun, id: string): Promise<TurnRow | undefined> {
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
const StoredPartsColumnSchema: Schema.Schema<StoredUIMessage["parts"]> = Schema.declare(
  (input): input is StoredUIMessage["parts"] => readsPartsShape(input),
);

/** A message row, decoded to the same camelCase shape the store's own writer builds it under. */
const MessageRowFullSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  conversationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("conversation_id")),
  seq: EpochMillisColumnSchema,
  turnId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(Schema.fromKey("turn_id")),
  clientId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("client_id")),
  role: MessageRoleSchema,
  parts: StoredPartsColumnSchema,
  metadata: Schema.NullOr(Schema.Unknown),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
  finishedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("finished_at"),
  ),
});
export type MessageRowFull = Schema.Schema.Type<typeof MessageRowFullSchema>;
const decodeMessageRow = Schema.decodeUnknownSync(MessageRowFullSchema);

export function readMessagesByConversationTyped(
  run: HostedStoreRun,
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

export function readMessageById(
  run: HostedStoreRun,
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

export function insertEvent(run: HostedStoreRun, row: EventInsertRow): Promise<string> {
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

export function readEventsByConversation(run: HostedStoreRun, conversationId: string) {
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

export function insertDevice(run: HostedStoreRun, row: DeviceInsertRow): Promise<void> {
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

export function readDevicesByUser(run: HostedStoreRun, userId: string) {
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
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  installationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("installation_id")),
  platform: Schema.String,
  lastSeenAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("last_seen_at")),
  activeUntil: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("active_until"),
  ),
  quietUntil: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("quiet_until"),
  ),
  pushToken: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("push_token"),
  ),
  pushEnvironment: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("push_environment"),
  ),
});
export type DeviceRow = Schema.Schema.Type<typeof DeviceRowSchema>;
const decodeDeviceRow = Schema.decodeUnknownSync(DeviceRowSchema);

export function readDeviceById(run: HostedStoreRun, id: string): Promise<DeviceRow | undefined> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`select * from devices where id = ${id}`;
      return rows[0] === undefined ? undefined : decodeDeviceRow(rows[0]);
    }),
  );
}

export function setVoiceSessionDeviceId(
  run: HostedStoreRun,
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
  run: HostedStoreRun,
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
  run: HostedStoreRun,
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

export function readEventsByMessage(run: HostedStoreRun, messageId: string) {
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
  run: HostedStoreRun,
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
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  deviceId: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("device_id"),
  ),
  liveSessionId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("live_session_id")),
  delegationMode: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("delegation_mode")),
  startedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("started_at")),
  closedAt: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("closed_at"),
  ),
  closeReason: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("close_reason"),
  ),
  usage: Schema.NullOr(Schema.Unknown),
});
export type VoiceSessionRow = Schema.Schema.Type<typeof VoiceSessionRowSchema>;
const decodeVoiceSessionRow = Schema.decodeUnknownSync(VoiceSessionRowSchema);

export function readVoiceSessionByIdTyped(
  run: HostedStoreRun,
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
  run: HostedStoreRun,
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
  run: HostedStoreRun,
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

export function deleteVoiceSession(run: HostedStoreRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from voice_sessions where id = ${id}`;
    }),
  );
}

export function deleteDevice(run: HostedStoreRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from devices where id = ${id}`;
    }),
  );
}

export function readVoiceSessionByLiveSessionId(run: HostedStoreRun, liveSessionId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from voice_sessions where live_session_id = ${liveSessionId}`;
    }),
  );
}

export function readVoiceTranscriptSegmentsBySession(run: HostedStoreRun, voiceSessionId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`
      select * from voice_transcript_segments where voice_session_id = ${voiceSessionId} order by seq
    `;
    }),
  );
}

export function deleteUser(run: HostedStoreRun, id: string): Promise<void> {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`delete from "user" where id = ${id}`;
    }),
  );
}

/** A count of a table's rows for one user, by the table's own name; every table this reaches keys its rows by `user_id`. */
export function countRowsForUser(
  run: HostedStoreRun,
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
  run: HostedStoreRun,
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

export function insertToolSet(run: HostedStoreRun, row: ToolSetRow): Promise<void> {
  const schemas = JSON.stringify(row.schemas);
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`insert into tool_sets (hash, schemas) values (${row.hash}, ${schemas}::jsonb)`;
    }),
  );
}

export function insertToolSetIgnoringConflict(run: HostedStoreRun, row: ToolSetRow): Promise<void> {
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

export function readToolSetsByHash(run: HostedStoreRun, hash: string) {
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

export function insertProviderCursor(run: HostedStoreRun, row: ProviderCursorRow): Promise<void> {
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

export function upsertProviderCursor(run: HostedStoreRun, row: ProviderCursorRow): Promise<void> {
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

export function readProviderCursorsByUser(run: HostedStoreRun, userId: string) {
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
 * unique violation) off a rejected `database.run(...)` promise: the runtime
 * rejects with a `FiberFailure` wrapping the `SqlError`'s `Cause`, and the
 * `SqlError` itself carries the driver's error as its own `cause`, the way
 * Drizzle's wrapped error once did.
 */
const DriverErrorSchema = Schema.Struct({
  cause: Schema.Struct({ code: Schema.String }),
});

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the boundary: the value node:assert's own `rejects` caught, parsed immediately below by Runtime.isFiberFailure and then Schema.
function sqlErrorCode(error: unknown): string | undefined {
  if (!Runtime.isFiberFailure(error)) return undefined;
  const failure = Cause.squash(error[Runtime.FiberFailureCauseId]);
  return Option.map(
    Schema.decodeUnknownOption(DriverErrorSchema)(failure),
    (decoded) => decoded.cause.code,
  ).pipe(Option.getOrUndefined);
}

/** A statement's promise is refused for exactly the Postgres code named, whatever wraps it now. */
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
