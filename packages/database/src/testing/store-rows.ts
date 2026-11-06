import { MessageRoleSchema } from "@repo/wire";
import type { StoredUIMessage } from "@repo/wire/ui-messages";
import { count, eq, getColumnTable } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect, Schema } from "effect";
import { Database } from "../core/query.js";
import { EpochMillisColumnSchema, InstantColumnSchema } from "../models/columns.js";
import { user } from "../schemas/auth.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import type { HostedStoreTestRun } from "./hosted-store-database.js";

const IdRowSchema = Schema.Struct({ id: Schema.String });

type ConversationInsert = typeof conversations.$inferInsert;
type MessageInsert = typeof messages.$inferInsert;
type TurnInsert = typeof turns.$inferInsert;

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
  readonly parts: unknown;
  readonly metadata?: unknown;
  readonly createdAt?: Date;
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
          parts: row.parts as MessageInsert["parts"],
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

const readsPartsShape = Schema.is(Schema.Array(Schema.Struct({ type: Schema.String })));
const StoredPartsColumnSchema: Schema.Codec<StoredUIMessage["parts"]> = Schema.declare(
  (input): input is StoredUIMessage["parts"] => readsPartsShape(input),
);

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

export function deleteUser(run: HostedStoreTestRun, id: string): Promise<void> {
  return run(Effect.asVoid(Database.use((db) => db.delete(user).where(eq(user.id, id)))));
}

function countRows(column: PgColumn, value: string) {
  return Effect.map(
    Database.use((db) =>
      db.select({ count: count() }).from(getColumnTable(column)).where(eq(column, value)),
    ),
    (rows) => Schema.decodeUnknownSync(Schema.Struct({ count: Schema.Number }))(rows[0]).count,
  );
}

export function countRowsWhere(
  run: HostedStoreTestRun,
  column: PgColumn,
  value: string,
): Promise<number> {
  return run(countRows(column, value));
}
