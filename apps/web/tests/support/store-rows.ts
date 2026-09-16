import assert from "node:assert/strict";
import { MessageRoleSchema } from "@sidecar/wire";
import { and, count, eq, isNull, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import type { StoredUIMessage } from "../../server/core";
import { user } from "../../server/db/auth-schema";
import { devices } from "../../server/db/devices-schema";
import { db } from "../../server/db/query";
import {
  conversations,
  events,
  messages,
  providerCursors,
  turns,
} from "../../server/db/storage-schema";
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

/** A `timestamptz` column as the instant it holds, whichever of the two readings the dialect gave it. */
export const instantColumn = Schema.decodeUnknownSync(InstantColumnSchema);

type ConversationInsert = typeof conversations.$inferInsert;
type MessageInsert = typeof messages.$inferInsert;
type TurnInsert = typeof turns.$inferInsert;
type EventInsert = typeof events.$inferInsert;
type VoiceSessionInsert = typeof voiceSessions.$inferInsert;
type VoiceSegmentInsert = typeof voiceTranscriptSegments.$inferInsert;

export interface ConversationRow {
  readonly userId: string;
  readonly kind?: ConversationInsert["kind"];
  readonly providerId?: string | null;
  readonly providerSessionId?: string | null;
  readonly parentConversationId?: string | null;
  readonly spawnedByMessageId?: string | null;
  readonly runtimeSessionId?: string | null;
  readonly createdAt?: Date;
  readonly deletedAt?: Date | null;
  readonly nextMessageSeq?: number;
  readonly nextEventSeq?: number;
  readonly label?: string | null;
  readonly title?: string | null;
  readonly workspace?: string | null;
  readonly completionDeliveredAt?: Date | null;
  /** Whether a child's delegation waits on its completion; the column's own default, true, where absent. */
  readonly expectsCompletion?: boolean;
}

export function insertConversation(run: HostedStoreTestRun, row: ConversationRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const rows = yield* db
        .insert(conversations)
        .values({
          userId: row.userId,
          kind: row.kind ?? CONVERSATION_KIND.MAIN,
          providerId: row.providerId ?? null,
          providerSessionId: row.providerSessionId ?? null,
          parentConversationId: row.parentConversationId ?? null,
          spawnedByMessageId: row.spawnedByMessageId ?? null,
          runtimeSessionId: row.runtimeSessionId ?? null,
          createdAt: row.createdAt ?? new Date(),
          deletedAt: row.deletedAt ?? null,
          nextMessageSeq: row.nextMessageSeq ?? 1,
          nextEventSeq: row.nextEventSeq ?? 1,
          label: row.label ?? null,
          title: row.title ?? null,
          workspace: row.workspace ?? null,
          completionDeliveredAt: row.completionDeliveredAt ?? null,
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
      db.update(conversations).set({ deletedAt }).where(eq(conversations.id, conversationId)),
    ),
  );
}

export function readConversationById(run: HostedStoreTestRun, id: string) {
  return run(db.select().from(conversations).where(eq(conversations.id, id)));
}

export function readStandingConversations(
  run: HostedStoreTestRun,
  userId: string,
  kind: ConversationInsert["kind"],
) {
  return run(
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.kind, kind),
          isNull(conversations.deletedAt),
        ),
      ),
  );
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
  cancelRequestedAt: Schema.NullOr(InstantColumnSchema),
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

/**
 * Writes a numbered row in place the way `writer.ts` does: the conversation's
 * journal revision moves and the row takes it, in one statement, so a test
 * that streams or finishes a journal beneath the writer moves the head as the
 * writer would.
 *
 * Note that the bump is a data-modifying CTE rather than a second statement,
 * because what this stands for is the writer's own single statement; the
 * builder spells one as a `$with` over an update that returns its new value.
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
  const bumped = db.$with("bumped").as(
    db
      .update(conversations)
      .set({ journalRevision: sql`${conversations.journalRevision} + 1` })
      .where(eq(conversations.id, row.conversationId))
      .returning({ journalRevision: conversations.journalRevision }),
  );
  return run(
    Effect.asVoid(
      db
        .with(bumped)
        .update(messages)
        .set({
          // SAFETY: as in `insertMessage` above — a row the column type forbids
          // is one of the rows this helper exists to write.
          parts: row.parts as MessageInsert["parts"],
          revision: sql`(select ${bumped.journalRevision} from ${bumped})`,
          // A finish the caller did not name leaves the column as it stands.
          finishedAt: sql`coalesce(${row.finishedAt ?? null}, ${messages.finishedAt})`,
        })
        .where(eq(messages.id, row.id)),
    ),
  );
}

export function readMessageById(
  run: HostedStoreTestRun,
  id: string,
): Promise<MessageRowFull | undefined> {
  return run(
    Effect.map(db.select().from(messages).where(eq(messages.id, id)), (rows) =>
      rows[0] === undefined ? undefined : decodeMessageRow(rows[0]),
    ),
  );
}

export interface EventInsertRow {
  readonly userId: string;
  readonly conversationId: string;
  readonly seq: number;
  readonly messageId: string;
  readonly kind: EventInsert["kind"];
  readonly deviceId?: string | null;
  readonly payload?: unknown;
  readonly createdAt?: Date;
}

export function insertEvent(run: HostedStoreTestRun, row: EventInsertRow): Promise<string> {
  return run(
    Effect.gen(function* () {
      const rows = yield* db
        .insert(events)
        .values({
          userId: row.userId,
          conversationId: row.conversationId,
          seq: row.seq,
          messageId: row.messageId,
          kind: row.kind,
          deviceId: row.deviceId ?? null,
          payload: row.payload ?? null,
          createdAt: row.createdAt ?? new Date(),
        })
        .returning({ id: events.id });
      return Schema.decodeUnknownSync(IdRowSchema)(rows[0]).id;
    }),
  );
}

export function readEventsByConversation(run: HostedStoreTestRun, conversationId: string) {
  return run(
    db.select().from(events).where(eq(events.conversationId, conversationId)).orderBy(events.seq),
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
    Effect.asVoid(
      db.insert(devices).values({
        id: row.id,
        userId: row.userId,
        installationId: row.installationId,
        platform: row.platform,
        lastSeenAt: row.lastSeenAt ?? new Date(),
        activeUntil: row.activeUntil ?? null,
        quietUntil: row.quietUntil ?? null,
        pushToken: row.pushToken ?? null,
        pushEnvironment: row.pushEnvironment ?? null,
      }),
    ),
  );
}

export function readDevicesByUser(run: HostedStoreTestRun, userId: string) {
  return run(
    db.select().from(devices).where(eq(devices.userId, userId)).orderBy(devices.lastSeenAt),
  );
}

/** A device row, decoded to the same shape the store's own device seams build it under. */
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
});
export type DeviceRow = Schema.Schema.Type<typeof DeviceRowSchema>;
const decodeDeviceRow = Schema.decodeUnknownSync(DeviceRowSchema);

/** The device columns the decoded row names, which is every column but the two a test never reads. */
const DEVICE_FIELDS = {
  id: devices.id,
  userId: devices.userId,
  installationId: devices.installationId,
  platform: devices.platform,
  lastSeenAt: devices.lastSeenAt,
  activeUntil: devices.activeUntil,
  quietUntil: devices.quietUntil,
  pushToken: devices.pushToken,
  pushEnvironment: devices.pushEnvironment,
};

export function readDeviceById(
  run: HostedStoreTestRun,
  id: string,
): Promise<DeviceRow | undefined> {
  return run(
    Effect.map(db.select(DEVICE_FIELDS).from(devices).where(eq(devices.id, id)), (rows) =>
      rows[0] === undefined ? undefined : decodeDeviceRow(rows[0]),
    ),
  );
}

export function setVoiceSessionDeviceId(
  run: HostedStoreTestRun,
  liveSessionId: string,
  deviceId: string | null,
): Promise<void> {
  return run(
    Effect.asVoid(
      db
        .update(voiceSessions)
        .set({ deviceId })
        .where(eq(voiceSessions.liveSessionId, liveSessionId)),
    ),
  );
}

export function setDeviceQuietUntil(
  run: HostedStoreTestRun,
  id: string,
  quietUntil: Date | null,
): Promise<void> {
  return run(Effect.asVoid(db.update(devices).set({ quietUntil }).where(eq(devices.id, id))));
}

export function setDeviceActiveUntil(
  run: HostedStoreTestRun,
  id: string,
  activeUntil: Date | null,
): Promise<void> {
  return run(Effect.asVoid(db.update(devices).set({ activeUntil }).where(eq(devices.id, id))));
}

export function readEventsByMessage(run: HostedStoreTestRun, messageId: string) {
  return run(db.select().from(events).where(eq(events.messageId, messageId)).orderBy(events.seq));
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
  delegationMode: Schema.String,
  startedAt: InstantColumnSchema,
  closedAt: Schema.NullOr(InstantColumnSchema),
  closeReason: Schema.NullOr(Schema.String),
  usage: Schema.NullOr(Schema.Unknown),
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

export function deleteDevice(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(Effect.asVoid(db.delete(devices).where(eq(devices.id, id))));
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
export function countRowsWhere(
  run: HostedStoreTestRun,
  column: PgColumn,
  value: string,
): Promise<number> {
  return run(
    Effect.map(
      db.select({ count: count() }).from(column.table).where(eq(column, value)),
      (rows) => Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Number }))(rows[0]).count,
    ),
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
  return run(Effect.asVoid(db.insert(providerCursors).values(row)));
}

/**
 * Note that the conflicting update sets the cursor the insert carried rather
 * than reading it back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly that value.
 */
export function upsertProviderCursor(
  run: HostedStoreTestRun,
  row: ProviderCursorRow,
): Promise<void> {
  return run(
    Effect.asVoid(
      db
        .insert(providerCursors)
        .values(row)
        .onConflictDoUpdate({
          target: [
            providerCursors.userId,
            providerCursors.providerId,
            providerCursors.providerSessionId,
          ],
          set: { cursor: row.cursor },
        }),
    ),
  );
}

export function readProviderCursorsByUser(run: HostedStoreTestRun, userId: string) {
  return run(
    db
      .select({
        providerSessionId: providerCursors.providerSessionId,
        cursor: providerCursors.cursor,
      })
      .from(providerCursors)
      .where(eq(providerCursors.userId, userId))
      .orderBy(providerCursors.providerSessionId),
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
  NOT_NULL_VIOLATION: "23502",
  UNIQUE_VIOLATION: "23505",
} as const;
