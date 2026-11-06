import { type WireValue, WireValueSchema } from "@repo/wire";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { conversations } from "../schemas/storage.js";
import type { ConversationTarget } from "./writer.js";

export interface NativeProjectionRow {
  readonly sequence: number | null;
  readonly projection: WireValue | null;
}

const lockProjectionRow = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    runnerTokenHash: Schema.String,
  }),
  Result: Schema.Struct({
    sequence: Schema.NullOr(Schema.Number),
    projection: Schema.NullOr(WireValueSchema),
  }),
  execute: ({ userId, conversationId, runnerTokenHash }) =>
    Database.use((db) =>
      db
        .select({
          sequence: conversations.nativeSequence,
          projection: conversations.nativeProjection,
        })
        .from(conversations)
        .innerJoin(agentTable, eq(agentTable.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            eq(agentTable.runnerTokenHash, runnerTokenHash),
            isNull(conversations.deletedAt),
          ),
        )
        .for("update"),
    ),
});

const findProjectionSequence = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ sequence: Schema.NullOr(Schema.Number) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ sequence: conversations.nativeSequence })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const findProjection = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ projection: Schema.NullOr(WireValueSchema) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ projection: conversations.nativeProjection })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const saveProjectionRow = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    sequence: Schema.Number,
    projection: WireValueSchema,
  }),
  execute: ({ userId, conversationId, sequence, projection }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeSequence: sequence, nativeProjection: projection })
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
    ),
});

export interface NativeProjectionApplied<A> {
  readonly result: A;
  readonly saved?: { readonly sequence: number; readonly projection: WireValue };
}

export function withNativeProjection<A, E, R>(
  target: ConversationTarget,
  runnerTokenHash: string,
  apply: (held: NativeProjectionRow) => Effect.Effect<NativeProjectionApplied<A>, E, R>,
): Effect.Effect<Option.Option<A>, E | StoreFailure, R | DatabaseServices> {
  const locked = Effect.gen(function* () {
    const held = yield* lockProjectionRow({ ...target, runnerTokenHash });
    if (Option.isNone(held)) return Option.none<A>();
    const applied = yield* apply(held.value);
    if (applied.saved !== undefined) {
      yield* saveProjectionRow({ ...target, ...applied.saved });
    }
    return Option.some(applied.result);
  });
  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(locked));
}

export function readNativeSequence(
  target: ConversationTarget,
): Effect.Effect<Option.Option<number>, StoreFailure, DatabaseServices> {
  return Effect.map(findProjectionSequence(target), (row) =>
    Option.flatMap(row, ({ sequence }) => Option.fromNullishOr(sequence)),
  );
}

export function readNativeProjection(
  target: ConversationTarget,
): Effect.Effect<Option.Option<WireValue>, StoreFailure, DatabaseServices> {
  return Effect.map(findProjection(target), (row) =>
    Option.flatMap(row, ({ projection }) => Option.fromNullishOr(projection)),
  );
}

const dropProjectionTurn = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, turnIds: Schema.Array(Schema.String) }),
  execute: ({ conversationId, turnIds }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeProjection: sql`${conversations.nativeProjection} - 'turn'` })
        .where(
          and(
            eq(conversations.id, conversationId),
            inArray(sql<string>`${conversations.nativeProjection}->'turn'->>'id'`, [...turnIds]),
          ),
        ),
    ),
});

export function dropNativeProjectionTurns(
  conversationId: string,
  turnIds: readonly string[],
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return turnIds.length === 0 ? Effect.void : dropProjectionTurn({ conversationId, turnIds });
}
