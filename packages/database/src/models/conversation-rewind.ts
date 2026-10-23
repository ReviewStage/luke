import { MESSAGE_ROLE } from "@luke/wire";
import { and, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { holdConversationDispatch } from "./dispatch-lock.js";
import type { ConversationTarget } from "./writer.js";

/**
 * conversation-rewind.ts -- a coding agent's conversation cut back to just before one of the developer's lines.
 *
 * A rewind drops the line named and everything after it: the turn it
 * opened and every later turn, with every row they wrote, and every row no
 * turn owns from the line on. It counts the journal revision up and marks
 * the conversation rewound at it, so a reader holding an older cursor
 * reads the transcript afresh rather than joining what it holds, and
 * keeps the line's client id for the next launch of a Claude Code or
 * Codex runner to cut the harness's own session before. A line no turn
 * took yet never reached the harness's session, so a cut at one leaves a
 * cut still waiting for a launch as it stands, since that one is earlier.
 *
 * Only a line that opened its turn, or awaits one, can be cut at: a line
 * a turn under way took in after its first step sits inside that turn's
 * work, which no harness can cut through.
 */

/** Why a line cannot be cut at. */
export const REWIND_REFUSAL = {
  /** No developer's line of that id stands in the conversation. */
  NOT_FOUND: "not_found",
  /** The line was taken into a turn already under way, or shares its turn with an earlier line. */
  INSIDE_TURN: "inside_turn",
} as const;

export type RewindRefusal = (typeof REWIND_REFUSAL)[keyof typeof REWIND_REFUSAL];

/** What a rewind cut: the line's client id and words' place, and the turns it dropped. */
export interface ConversationRewound {
  readonly clientId: string;
  readonly turnIds: readonly string[];
}

type RewindFailure = QueryError | Schema.SchemaError;

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

/** The developer's lines a turn took, oldest first, which tells the line that opened it. */
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
        .where(and(eq(turns.conversationId, conversationId), gte(turns.queuedAt, from))),
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

/** The journal counted up and the conversation marked rewound at it, the harness's cut set unless the line was never heard and an earlier cut waits, and a dropped turn the projection held let go. */
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
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
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

/** The cut, under the conversation's dispatch and row locks, answering what it cut or why it could not. */
const cut = (target: ConversationTarget, messageId: string) =>
  Effect.gen(function* () {
    const { conversationId } = target;
    // A hand-over under way finishes first, so a line it is writing is cut with the rest or not at all.
    yield* holdConversationDispatch(conversationId);
    const held = yield* lockConversation(target);
    if (Option.isNone(held)) return Result.fail(REWIND_REFUSAL.NOT_FOUND);
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
    const turnIds = (yield* findTurnsFrom({ conversationId, from })).map((turn) => turn.id);
    yield* deleteMessagesFrom({ conversationId, seq, turnIds });
    if (turnIds.length > 0) yield* deleteTurns({ conversationId, turnIds });
    yield* markRewound({ conversationId, clientId, heard: turnId !== null, turnIds });
    return Result.succeed<ConversationRewound>({ clientId, turnIds });
  });

/**
 * Cuts the conversation back to just before the developer's line named, as
 * above, in one transaction; refused where the account holds no such line,
 * or the line sits inside a turn.
 */
export function rewindConversation(
  target: ConversationTarget,
  messageId: string,
): Effect.Effect<
  Result.Result<ConversationRewound, RewindRefusal>,
  RewindFailure,
  DatabaseServices
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(cut(target, messageId)),
  );
}

/** The client id of the line a harness's session is still to be cut before, where a rewind left one; none otherwise. */
export function readNativeRewind(
  target: ConversationTarget,
): Effect.Effect<Option.Option<string>, RewindFailure, DatabaseServices> {
  return Effect.map(findNativeRewind(target), (row) =>
    Option.flatMap(row, ({ nativeRewind }) => Option.fromNullishOr(nativeRewind)),
  );
}

/** Lets the harness's cut go once a launch has handed it over, unless a newer rewind replaced it meanwhile. */
export function clearNativeRewindHanded(
  conversationId: string,
  clientId: string,
): Effect.Effect<void, RewindFailure, DatabaseServices> {
  return clearNativeRewind({ conversationId, clientId });
}

/** The journal revision the conversation was last rewound at, which a cursor read before it is stale past; none for one never rewound. */
export function readRewoundRevision(
  target: ConversationTarget,
): Effect.Effect<number | undefined, RewindFailure, DatabaseServices> {
  return Effect.map(findRewoundRevision(target), (row) =>
    Option.getOrUndefined(
      Option.flatMap(row, ({ rewoundRevision }) => Option.fromNullishOr(rewoundRevision)),
    ),
  );
}
