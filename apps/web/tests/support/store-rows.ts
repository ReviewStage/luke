import * as SqlClient from "@effect/sql/SqlClient";
import { Effect, Schema } from "effect";
import { CONVERSATION_KIND } from "../../server/db/storage-schema";
import type { HostedStoreRun } from "../../server/hosted/store";

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
  readonly runtimeSessionId?: string | null;
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
        parent_conversation_id, spawned_by_message_id, runtime_session_id, deleted_at,
        next_message_seq, next_event_seq
      )
      values (
        ${row.userId}, ${row.kind ?? CONVERSATION_KIND.MAIN},
        ${row.providerId ?? null}, ${row.providerSessionId ?? null},
        ${row.parentConversationId ?? null}, ${row.spawnedByMessageId ?? null},
        ${row.runtimeSessionId ?? null}, ${row.deletedAt ?? null},
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

export function readEventsByConversation(run: HostedStoreRun, conversationId: string) {
  return run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      return yield* sql`select * from events where conversation_id = ${conversationId} order by seq`;
    }),
  );
}

export interface DeviceRow {
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

export function insertDevice(run: HostedStoreRun, row: DeviceRow): Promise<void> {
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
