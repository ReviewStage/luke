import { MessageRoleSchema } from "@luke/wire";
import type { StoredUIMessage } from "@luke/wire/ui-messages";
import { count, eq, getColumnTable } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { Database } from "../core/query.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "../models/columns.js";
import { user } from "../schemas/auth.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { voiceSessions, voiceTranscriptSegments } from "../schemas/voice.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import type { HostedStoreTestRun } from "./hosted-store-database.js";

/**
 * Rows over the ambient `SqlClient`, for the setup and assertions a test
 * still needs beneath the store's own effects: the same tables `writer.ts`
 * and its neighbors write, reached through the shared Drizzle handle over
 * the tables their own `schemas/*.ts` modules declare, so a column renamed
 * under `db/` is a type error in this file rather than a statement that
 * still parses. Every insert answers the row's minted id where the table has
 * one; every read answers the row (or rows) as the builder maps them, which
 * is the schema module's own field names and the column's own reading —
 * undecoded beyond what a caller's own assertion needs, and Schema-decoded
 * where a caller reads a whole row as the store's writers build it.
 *
 * A write's fields are the table's own insert type rather than loose strings,
 * which is how a vocabulary the schema module pins (`$type<>()`) is pinned
 * here too.
 */

const IdRowSchema = Schema.Struct({ id: Schema.String });

type ConversationInsert = typeof conversations.$inferInsert;
type MessageInsert = typeof messages.$inferInsert;
type TurnInsert = typeof turns.$inferInsert;
type VoiceSessionInsert = typeof voiceSessions.$inferInsert;
type VoiceSegmentInsert = typeof voiceTranscriptSegments.$inferInsert;

export interface ConversationRow {
  readonly userId: string;
  readonly kind?: ConversationInsert["kind"];
  readonly parentConversationId?: string | null;
  readonly runtimeSessionId?: string | null;
  readonly createdAt?: Date;
  readonly deletedAt?: Date | null;
  readonly nextMessageSeq?: number;
  readonly label?: string | null;
  readonly title?: string | null;
  /** Whether a child's delegation waits on its completion; the column's own default, true, where absent. */
  readonly expectsCompletion?: boolean;
}

export function insertConversation(run: HostedStoreTestRun, row: ConversationRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .insert(conversations)
        .values({
          userId: row.userId,
          kind: row.kind ?? CONVERSATION_KIND.MAIN,
          parentConversationId: row.parentConversationId ?? null,
          runtimeSessionId: row.runtimeSessionId ?? null,
          createdAt: row.createdAt ?? new Date(),
          deletedAt: row.deletedAt ?? null,
          nextMessageSeq: row.nextMessageSeq ?? 1,
          label: row.label ?? null,
          title: row.title ?? null,
          expectsCompletion: row.expectsCompletion ?? true,
        })
        .returning({ id: conversations.id });
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
    Effect.asVoid(
      Database.use((db) =>
        db.update(conversations).set({ deletedAt }).where(eq(conversations.id, conversationId)),
      ),
    ),
  );
}

export function readConversationById(run: HostedStoreTestRun, id: string) {
  return run(Database.use((db) => db.select().from(conversations).where(eq(conversations.id, id))));
}

export interface MessageRow {
  readonly userId: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly turnId?: string | null;
  readonly clientId: string;
  readonly role: MessageInsert["role"];
  /**
   * The parts and the metadata stay `unknown` where every other field is the
   * column's own type, because writing a row the column type forbids is one
   * of the things this helper is for: `storage-reads.test.ts` writes the row
   * a corrupt write would leave and asserts the page is refused as malformed.
   * They are handed to the builder as the column's type on that account, and
   * that is the whole of the trust — a column renamed under `db/` is still a
   * type error here.
   */
  readonly parts: unknown;
  readonly metadata?: unknown;
  readonly createdAt?: Date;
  /** Where the row stands in the Conversation; where it was written unless the test places it elsewhere. */
  readonly placedAt?: Date;
  readonly finishedAt?: Date | null;
}

export function insertMessage(run: HostedStoreTestRun, row: MessageRow): Promise<string> {
  const createdAt = row.createdAt ?? new Date();
  return run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .insert(messages)
        .values({
          userId: row.userId,
          conversationId: row.conversationId,
          seq: row.seq,
          turnId: row.turnId ?? null,
          clientId: row.clientId,
          role: row.role,
          // SAFETY: the column's own type is what a well-formed row carries,
          // and writing a row that is not one is what this helper is for —
          // `storage-reads.test.ts` writes the row a corrupt write would leave
          // and asserts the page is refused as malformed. Nothing reads the
          // value back through this type.
          parts: row.parts as MessageInsert["parts"],
          // SAFETY: the same, for the metadata beside them.
          metadata: (row.metadata ?? null) as MessageInsert["metadata"],
          createdAt,
          placedAt: row.placedAt ?? createdAt,
          finishedAt: row.finishedAt ?? null,
        })
        .returning({ id: messages.id });
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

export function readMessagesByConversation(run: HostedStoreTestRun, conversationId: string) {
  return run(
    Database.use((db) =>
      db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.seq),
    ),
  );
}

export interface TurnInsertRow {
  readonly userId: string;
  readonly conversationId: string;
  readonly origin: TurnInsert["origin"];
  readonly status: TurnInsert["status"];
  readonly eveTurnId?: string | null;
  readonly queuedAt?: Date;
  readonly startedAt?: Date | null;
  readonly settledAt?: Date | null;
  readonly responseIds?: readonly string[] | null;
  readonly usage?: TurnInsert["usage"];
  readonly failure?: string | null;
}

export function insertTurn(run: HostedStoreTestRun, row: TurnInsertRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .insert(turns)
        .values({
          userId: row.userId,
          conversationId: row.conversationId,
          origin: row.origin,
          status: row.status,
          eveTurnId: row.eveTurnId ?? null,
          queuedAt: row.queuedAt ?? new Date(),
          startedAt: row.startedAt ?? null,
          settledAt: row.settledAt ?? null,
          responseIds: row.responseIds ? [...row.responseIds] : null,
          usage: row.usage ?? null,
          failure: row.failure ?? null,
        })
        .returning({ id: turns.id });
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

/** A turn row, decoded to the same shape the store's own writer builds it under. */
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
  failureDetail: Schema.NullOr(Schema.String),
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
});
export type TurnRow = Schema.Schema.Type<typeof TurnRowSchema>;
const decodeTurnRow = Schema.decodeUnknownSync(TurnRowSchema);

export function readTurnsByConversation(
  run: HostedStoreTestRun,
  conversationId: string,
): Promise<readonly TurnRow[]> {
  return run(
    Effect.map(
      Database.use((db) => db.select().from(turns).where(eq(turns.conversationId, conversationId))),
      (rows) => rows.map((row) => decodeTurnRow(row)),
    ),
  );
}

export function readTurnById(run: HostedStoreTestRun, id: string): Promise<TurnRow | undefined> {
  return run(
    Effect.map(
      Database.use((db) => db.select().from(turns).where(eq(turns.id, id))),
      (rows) => (rows[0] === undefined ? undefined : decodeTurnRow(rows[0])),
    ),
  );
}

/** Every part this build stores carries at least a `type`, the same shape `writer.ts`'s own column schema checks. */
const readsPartsShape = Schema.is(Schema.Array(Schema.Struct({ type: Schema.String })));
const StoredPartsColumnSchema: Schema.Codec<StoredUIMessage["parts"]> = Schema.declare(
  (input): input is StoredUIMessage["parts"] => readsPartsShape(input),
);

/** A message row, decoded to the same shape the store's own writer builds it under. */
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
  placedAt: InstantColumnSchema,
  finishedAt: Schema.NullOr(InstantColumnSchema),
  revision: Schema.NullOr(EpochMillisColumnSchema),
});
export type MessageRowFull = Schema.Schema.Type<typeof MessageRowFullSchema>;
const decodeMessageRow = Schema.decodeUnknownSync(MessageRowFullSchema);

export function readMessagesByConversationTyped(
  run: HostedStoreTestRun,
  conversationId: string,
): Promise<readonly MessageRowFull[]> {
  return run(
    Effect.map(
      Database.use((db) =>
        db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(messages.seq),
      ),
      (rows) => rows.map((row) => decodeMessageRow(row)),
    ),
  );
}

export interface VoiceSessionInsertRow {
  readonly userId: string;
  readonly liveSessionId: string;
  readonly delegationMode: VoiceSessionInsert["delegationMode"];
  readonly deviceId?: string | null | undefined;
  readonly closedAt?: Date | null | undefined;
  readonly closeReason?: VoiceSessionInsert["closeReason"];
  readonly usage?: VoiceSessionInsert["usage"];
}

export function insertVoiceSession(
  run: HostedStoreTestRun,
  row: VoiceSessionInsertRow,
): Promise<string> {
  return run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .insert(voiceSessions)
        .values({
          userId: row.userId,
          deviceId: row.deviceId ?? null,
          liveSessionId: row.liveSessionId,
          delegationMode: row.delegationMode,
          closedAt: row.closedAt ?? null,
          closeReason: row.closeReason ?? null,
          usage: row.usage ?? null,
        })
        .returning({ id: voiceSessions.id });
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

const VoiceSessionRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  deviceId: Schema.NullOr(Schema.String),
  liveSessionId: Schema.String,
  agentId: Schema.NullOr(Schema.String),
  delegationMode: Schema.String,
  startedAt: InstantColumnSchema,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Schema.Unknown),
  detachedAt: Schema.NullOr(InstantColumnSchema),
});
export type VoiceSessionRow = Schema.Schema.Type<typeof VoiceSessionRowSchema>;
const decodeVoiceSessionRow = Schema.decodeUnknownSync(VoiceSessionRowSchema);

export function readVoiceSessionsByUserTyped(
  run: HostedStoreTestRun,
  userId: string,
): Promise<readonly VoiceSessionRow[]> {
  return run(
    Effect.map(
      Database.use((db) => db.select().from(voiceSessions).where(eq(voiceSessions.userId, userId))),
      (rows) => rows.map((row) => decodeVoiceSessionRow(row)),
    ),
  );
}

export interface VoiceSegmentInsertRow {
  readonly voiceSessionId: string;
  readonly seq: number;
  readonly role: VoiceSegmentInsert["role"];
  readonly text: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function insertVoiceTranscriptSegment(
  run: HostedStoreTestRun,
  row: VoiceSegmentInsertRow,
): Promise<void> {
  return run(
    Effect.asVoid(
      Database.use((db) =>
        db.insert(voiceTranscriptSegments).values({
          voiceSessionId: row.voiceSessionId,
          seq: row.seq,
          role: row.role,
          text: row.text,
          startMs: row.startMs,
          endMs: row.endMs,
        }),
      ),
    ),
  );
}

export function readVoiceSessionByLiveSessionId(run: HostedStoreTestRun, liveSessionId: string) {
  return run(
    Database.use((db) =>
      db.select().from(voiceSessions).where(eq(voiceSessions.liveSessionId, liveSessionId)),
    ),
  );
}

export function readVoiceTranscriptSegmentsBySession(
  run: HostedStoreTestRun,
  voiceSessionId: string,
) {
  return run(
    Database.use((db) =>
      db
        .select()
        .from(voiceTranscriptSegments)
        .where(eq(voiceTranscriptSegments.voiceSessionId, voiceSessionId))
        .orderBy(voiceTranscriptSegments.seq),
    ),
  );
}

export function deleteUser(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(Effect.asVoid(Database.use((db) => db.delete(user).where(eq(user.id, id)))));
}

/**
 * A count of the rows one column equals a value on, by the column itself
 * rather than by its name and its table's: a column carries the table it
 * belongs to, so one argument names both, and a column renamed under `db/`
 * is a type error at the call site rather than a count that reads zero.
 */
function countRows(column: PgColumn, value: string) {
  return Effect.map(
    Database.use((db) =>
      db.select({ count: count() }).from(getColumnTable(column)).where(eq(column, value)),
    ),
    (rows) => Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Number }))(rows[0]).count,
  );
}

/** `countRows` through the promise door, for a suite still written against one. */
export function countRowsWhere(
  run: HostedStoreTestRun,
  column: PgColumn,
  value: string,
): Promise<number> {
  return run(countRows(column, value));
}
