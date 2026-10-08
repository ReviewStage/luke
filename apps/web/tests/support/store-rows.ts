import assert from "node:assert/strict";
import { MessageRoleSchema } from "@sidecar/wire";
import { count, eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import type { StoredUIMessage } from "../../server/core";
import { user } from "../../server/db/auth-schema";
import { db } from "../../server/db/query";
import { conversations, messages, turns } from "../../server/db/storage-schema";
import { CONVERSATION_KIND } from "../../server/db/storage-vocabulary";
import { voiceSessions, voiceTranscriptSegments } from "../../server/db/voice-schema";
import { EpochMillisColumnSchema, InstantColumnSchema } from "../../server/hosted/store/database";
import type { HostedStoreTestRun } from "./hosted-store-database";

/**
 * Rows over the ambient `SqlClient`, for the setup and assertions a test
 * still needs beneath the store's own effects: the same tables `writer.ts`
 * and its neighbors write, reached through the shared Drizzle handle over
 * the tables their own `db/*-schema.ts` modules declare, so a column renamed
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
  readonly runtimeSessionId?: string | null;
  readonly createdAt?: Date;
  readonly deletedAt?: Date | null;
  readonly nextMessageSeq?: number;
}

export function insertConversation(run: HostedStoreTestRun, row: ConversationRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const rows = yield* db
        .insert(conversations)
        .values({
          userId: row.userId,
          kind: row.kind ?? CONVERSATION_KIND.PLAN,
          runtimeSessionId: row.runtimeSessionId ?? null,
          createdAt: row.createdAt ?? new Date(),
          deletedAt: row.deletedAt ?? null,
          nextMessageSeq: row.nextMessageSeq ?? 1,
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
      db.update(conversations).set({ deletedAt }).where(eq(conversations.id, conversationId)),
    ),
  );
}

export function readConversationById(run: HostedStoreTestRun, id: string) {
  return run(db.select().from(conversations).where(eq(conversations.id, id)));
}

export function deleteConversation(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(Effect.asVoid(db.delete(conversations).where(eq(conversations.id, id))));
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
    db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.seq),
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
});
export type TurnRow = Schema.Schema.Type<typeof TurnRowSchema>;
const decodeTurnRow = Schema.decodeUnknownSync(TurnRowSchema);

export function readTurnsByConversation(
  run: HostedStoreTestRun,
  conversationId: string,
): Promise<readonly TurnRow[]> {
  return run(
    Effect.map(db.select().from(turns).where(eq(turns.conversationId, conversationId)), (rows) =>
      rows.map((row) => decodeTurnRow(row)),
    ),
  );
}

export function readTurnById(run: HostedStoreTestRun, id: string): Promise<TurnRow | undefined> {
  return run(
    Effect.map(db.select().from(turns).where(eq(turns.id, id)), (rows) =>
      rows[0] === undefined ? undefined : decodeTurnRow(rows[0]),
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
      db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(messages.seq),
      (rows) => rows.map((row) => decodeMessageRow(row)),
    ),
  );
}

export interface VoiceSessionInsertRow {
  readonly userId: string;
  readonly liveSessionId: string;
  readonly delegationMode: VoiceSessionInsert["delegationMode"];
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
      const rows = yield* db
        .insert(voiceSessions)
        .values({
          userId: row.userId,
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
  liveSessionId: Schema.String,
  delegationMode: Schema.String,
  startedAt: InstantColumnSchema,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Schema.Unknown),
  detachedAt: Schema.NullOr(InstantColumnSchema),
});
export type VoiceSessionRow = Schema.Schema.Type<typeof VoiceSessionRowSchema>;
const decodeVoiceSessionRow = Schema.decodeUnknownSync(VoiceSessionRowSchema);

export function readVoiceSessionByIdTyped(
  run: HostedStoreTestRun,
  id: string,
): Promise<VoiceSessionRow | undefined> {
  return run(
    Effect.map(db.select().from(voiceSessions).where(eq(voiceSessions.id, id)), (rows) =>
      rows[0] === undefined ? undefined : decodeVoiceSessionRow(rows[0]),
    ),
  );
}

export function readVoiceSessionsByUserTyped(
  run: HostedStoreTestRun,
  userId: string,
): Promise<readonly VoiceSessionRow[]> {
  return run(
    Effect.map(db.select().from(voiceSessions).where(eq(voiceSessions.userId, userId)), (rows) =>
      rows.map((row) => decodeVoiceSessionRow(row)),
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
      db.insert(voiceTranscriptSegments).values({
        voiceSessionId: row.voiceSessionId,
        seq: row.seq,
        role: row.role,
        text: row.text,
        startMs: row.startMs,
        endMs: row.endMs,
      }),
    ),
  );
}

export function deleteVoiceSession(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(Effect.asVoid(db.delete(voiceSessions).where(eq(voiceSessions.id, id))));
}

export function readVoiceSessionByLiveSessionId(run: HostedStoreTestRun, liveSessionId: string) {
  return run(db.select().from(voiceSessions).where(eq(voiceSessions.liveSessionId, liveSessionId)));
}

export function readVoiceTranscriptSegmentsBySession(
  run: HostedStoreTestRun,
  voiceSessionId: string,
) {
  return run(
    db
      .select()
      .from(voiceTranscriptSegments)
      .where(eq(voiceTranscriptSegments.voiceSessionId, voiceSessionId))
      .orderBy(voiceTranscriptSegments.seq),
  );
}

export function deleteUser(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(Effect.asVoid(db.delete(user).where(eq(user.id, id))));
}

/**
 * A count of the rows one column equals a value on, by the column itself
 * rather than by its name and its table's: a column carries the table it
 * belongs to, so one argument names both, and a column renamed under `db/`
 * is a type error at the call site rather than a count that reads zero.
 */
function countRows(column: PgColumn, value: string) {
  return Effect.map(
    db.select({ count: count() }).from(column.table).where(eq(column, value)),
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
  NOT_NULL_VIOLATION: "23502",
  UNIQUE_VIOLATION: "23505",
} as const;
