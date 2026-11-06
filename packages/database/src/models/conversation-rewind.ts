import { MESSAGE_ROLE, TURN_STATUS } from "@repo/wire";
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import {
  DISPATCH_CLAIM,
  DispatchClaimHeld,
  dispatchClaimStands,
  waitingOutDispatchClaim,
} from "./dispatch-claim.js";
import type { ConversationTarget } from "./writer.js";

export const REWIND_REFUSAL = {
  NOT_FOUND: "not_found",
  INSIDE_TURN: "inside_turn",
  BUSY: "busy",
} as const;

export type RewindRefusal = (typeof REWIND_REFUSAL)[keyof typeof REWIND_REFUSAL];

export interface ConversationRewound {
  readonly clientId: string;
  readonly turnIds: readonly string[];
}

const lockConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        )
        .for("update"),
    ),
});

const findLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, messageId: Schema.String }),
  Result: Schema.Struct({
    seq: Schema.Number,
    clientId: Schema.String,
    turnId: Schema.NullOr(Schema.String),
    takenAfterStep: Schema.NullOr(Schema.Number),
    createdAt: Schema.Date,
  }),
  execute: ({ conversationId, messageId }) =>
    Database.use((db) =>
      db
        .select({
          seq: messages.seq,
          clientId: messages.clientId,
          turnId: messages.turnId,
          takenAfterStep: messages.takenAfterStep,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.id, messageId),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        ),
    ),
});

const findTurnLines = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ seq: messages.seq })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            eq(messages.turnId, turnId),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        )
        .orderBy(messages.seq),
    ),
});

const findTurnQueuedAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  Result: Schema.Struct({ queuedAt: Schema.Date }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .select({ queuedAt: turns.queuedAt })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), eq(turns.id, turnId))),
    ),
});

const findTurnsFrom = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, from: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, from }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), gte(turns.queuedAt, from)))
        .orderBy(asc(turns.queuedAt), asc(turns.id)),
    ),
});

const findTurnBefore = SqlSchema.findAll({
  Request: Schema.Struct({ conversationId: Schema.String, from: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ conversationId, from }) =>
    Database.use((db) =>
      db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, conversationId), lt(turns.queuedAt, from)))
        .limit(1),
    ),
});

const settleKeptTurn = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, turnId: Schema.String }),
  execute: ({ conversationId, turnId }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          status: TURN_STATUS.SETTLED,
          settledAt: sql`now()`,
          cancelRequestedAt: null,
          cancelRequestKey: null,
          cancelRequestedBy: null,
          failure: null,
          failureDetail: null,
        })
        .where(and(eq(turns.conversationId, conversationId), eq(turns.id, turnId))),
    ),
});

const deleteMessagesFrom = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    seq: Schema.Number,
    turnIds: Schema.Array(Schema.String),
  }),
  execute: ({ conversationId, seq, turnIds }) =>
    Database.use((db) =>
      db
        .delete(messages)
        .where(
          and(
            eq(messages.conversationId, conversationId),
            or(
              and(isNull(messages.turnId), gte(messages.seq, seq)),
              turnIds.length === 0 ? sql`false` : inArray(messages.turnId, [...turnIds]),
            ),
          ),
        ),
    ),
});

const deleteTurns = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, turnIds: Schema.Array(Schema.String) }),
  execute: ({ conversationId, turnIds }) =>
    Database.use((db) =>
      db
        .delete(turns)
        .where(and(eq(turns.conversationId, conversationId), inArray(turns.id, [...turnIds]))),
    ),
});

const markRewound = SqlSchema.void({
  Request: Schema.Struct({
    conversationId: Schema.String,
    clientId: Schema.String,
    heard: Schema.Boolean,
    turnIds: Schema.Array(Schema.String),
  }),
  execute: ({ conversationId, clientId, heard, turnIds }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({
          journalRevision: sql`${conversations.journalRevision} + 1`,
          rewoundRevision: sql`${conversations.journalRevision} + 1`,
          nativeRewind: heard
            ? clientId
            : sql`coalesce(${conversations.nativeRewind}, ${clientId})`,
          nativeHanded: null,
          nativeProjection:
            turnIds.length === 0
              ? sql`${conversations.nativeProjection}`
              : sql`case when ${conversations.nativeProjection}->'turn'->>'id' in (${sql.join(
                  turnIds.map((id) => sql`${id}`),
                  sql`, `,
                )}) then ${conversations.nativeProjection} - 'turn' else ${conversations.nativeProjection} end`,
        })
        .where(eq(conversations.id, conversationId)),
    ),
});

const retireWorkersFrom = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, from: Schema.Date }),
  execute: ({ conversationId, from }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ deletedAt: sql`now()` })
        .where(
          and(
            eq(conversations.parentConversationId, conversationId),
            gte(conversations.createdAt, from),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const clearNativeRewind = SqlSchema.void({
  Request: Schema.Struct({ conversationId: Schema.String, clientId: Schema.String }),
  execute: ({ conversationId, clientId }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeRewind: null })
        .where(and(eq(conversations.id, conversationId), eq(conversations.nativeRewind, clientId))),
    ),
});

const findRewoundRevision = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ rewoundRevision: Schema.NullOr(Schema.Number) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ rewoundRevision: conversations.rewoundRevision })
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

const findNativeRewind = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ nativeRewind: Schema.NullOr(Schema.String) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ nativeRewind: conversations.nativeRewind })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
    ),
});

const cutPoint = (conversationId: string, messageId: string) =>
  Effect.gen(function* () {
    const line = yield* findLine({ conversationId, messageId });
    if (Option.isNone(line)) return Result.fail(REWIND_REFUSAL.NOT_FOUND);
    const { seq, clientId, turnId, takenAfterStep, createdAt } = line.value;
    if (takenAfterStep !== null) return Result.fail(REWIND_REFUSAL.INSIDE_TURN);
    let from = createdAt;
    if (turnId !== null) {
      const [opening] = yield* findTurnLines({ conversationId, turnId });
      if (opening !== undefined && opening.seq !== seq) {
        return Result.fail(REWIND_REFUSAL.INSIDE_TURN);
      }
      const turn = yield* findTurnQueuedAt({ conversationId, turnId });
      if (Option.isSome(turn)) from = turn.value.queuedAt;
    }
    return Result.succeed({ seq, clientId, heard: turnId !== null, from });
  });

const cut = (target: ConversationTarget, messageId: string, place: number) =>
  Effect.gen(function* () {
    const { conversationId } = target;
    const held = yield* lockConversation(target);
    if (Option.isNone(held)) return Result.fail(REWIND_REFUSAL.NOT_FOUND);
    if (yield* dispatchClaimStands(conversationId, place)) return yield* new DispatchClaimHeld();
    const point = yield* cutPoint(conversationId, messageId);
    if (Result.isFailure(point)) return Result.fail(point.failure);
    const { seq, clientId, heard, from } = point.success;
    const turnIds = (yield* findTurnsFrom({ conversationId, from })).map((turn) => turn.id);
    yield* deleteMessagesFrom({ conversationId, seq, turnIds });
    const [first, ...later] = turnIds;
    const keepsFirst =
      first !== undefined && (yield* findTurnBefore({ conversationId, from })).length === 0;
    const dropped = keepsFirst ? later : turnIds;
    if (keepsFirst && first !== undefined) yield* settleKeptTurn({ conversationId, turnId: first });
    if (dropped.length > 0) yield* deleteTurns({ conversationId, turnIds: dropped });
    yield* retireWorkersFrom({ conversationId, from });
    yield* markRewound({ conversationId, clientId, heard, turnIds });
    return Result.succeed<ConversationRewound>({ clientId, turnIds });
  });

export function rewindConversation(
  target: ConversationTarget,
  messageId: string,
): Effect.Effect<
  Result.Result<ConversationRewound, RewindRefusal>,
  StoreFailure,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    waitingOutDispatchClaim(
      target.conversationId,
      (place) => client.withTransaction(cut(target, messageId, place)),
      DISPATCH_CLAIM.EXPIRY,
    ),
  ).pipe(
    Effect.catchTag("DispatchClaimHeld", () =>
      Effect.succeed(Result.fail<RewindRefusal>(REWIND_REFUSAL.BUSY)),
    ),
  );
}

export function readNativeRewind(
  target: ConversationTarget,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.map(findNativeRewind(target), (row) =>
    Option.flatMap(row, ({ nativeRewind }) => Option.fromNullishOr(nativeRewind)),
  );
}

export function clearNativeRewindHanded(
  conversationId: string,
  clientId: string,
): Effect.Effect<void, StoreFailure, DatabaseServices> {
  return clearNativeRewind({ conversationId, clientId });
}

export function readRewoundRevision(
  target: ConversationTarget,
): Effect.Effect<number | undefined, StoreFailure, DatabaseServices> {
  return Effect.map(findRewoundRevision(target), (row) =>
    Option.getOrUndefined(
      Option.flatMap(row, ({ rewoundRevision }) => Option.fromNullishOr(rewoundRevision)),
    ),
  );
}

export function readRewindable(
  target: ConversationTarget,
  messageId: string,
): Effect.Effect<Result.Result<void, RewindRefusal>, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const standing = yield* findRewoundRevision(target);
    if (Option.isNone(standing)) return Result.fail(REWIND_REFUSAL.NOT_FOUND);
    return Result.map(yield* cutPoint(target.conversationId, messageId), () => undefined);
  });
}
