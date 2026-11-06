import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  not,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { conversations } from "../schemas/storage.js";
import { CONVERSATION_KIND } from "../storage-vocabulary.js";
import { agentReachableBy } from "./workspace-store.js";
import type { ConversationTarget } from "./writer.js";

const StandingSessionSchema = Schema.Struct({
  runtimeSessionId: Schema.NullOr(Schema.String),
});

const ClaimSchema = Schema.Struct({
  userId: Schema.String,
  conversationId: Schema.String,
  runtimeSessionId: Schema.String,
  now: Schema.Date,
});

const findStandingSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: StandingSessionSchema,
  execute: (target) =>
    Database.use((db) =>
      db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, target.conversationId),
            eq(conversations.userId, target.userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

const parentConversation = alias(conversations, "parent_conversation");

function namedByWork(conversationId: SQLWrapper): SQL {
  return exists(
    queryBuilder
      .select({ one: agentTable.id })
      .from(agentTable)
      .where(eq(agentTable.conversationId, conversationId)),
  );
}

function parentStands(): SQL {
  return exists(
    queryBuilder
      .select({ one: parentConversation.id })
      .from(parentConversation)
      .where(
        and(
          eq(parentConversation.id, conversations.parentConversationId),
          isNull(parentConversation.deletedAt),
        ),
      ),
  );
}

function namedByReachableWork(userId: string, conversationId: SQLWrapper): SQL {
  return exists(
    queryBuilder
      .select({ one: agentTable.id })
      .from(agentTable)
      .where(and(eq(agentTable.conversationId, conversationId), agentReachableBy(userId))),
  );
}

function reachableConversation(userId: string): SQL | undefined {
  return and(
    isNull(conversations.deletedAt),
    or(
      and(
        eq(conversations.userId, userId),
        not(namedByWork(conversations.id)),
        or(
          isNull(conversations.parentConversationId),
          not(namedByWork(conversations.parentConversationId)),
        ),
      ),
      namedByReachableWork(userId, conversations.id),
      and(parentStands(), namedByReachableWork(userId, conversations.parentConversationId)),
    ),
  );
}

const findReachableConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.id, conversationId), reachableConversation(userId))),
    ),
});

const findReachableSession = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, runtimeSessionId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, runtimeSessionId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(eq(conversations.runtimeSessionId, runtimeSessionId), reachableConversation(userId)),
        )
        .limit(1),
    ),
});

const claimSession = SqlSchema.void({
  Request: ClaimSchema,
  execute: (claim) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ runtimeSessionId: claim.runtimeSessionId, lastActivityAt: claim.now })
        .where(
          and(
            eq(conversations.id, claim.conversationId),
            eq(conversations.userId, claim.userId),
            isNull(conversations.deletedAt),
            or(
              isNull(conversations.runtimeSessionId),
              lt(conversations.runtimeSessionId, claim.runtimeSessionId),
            ),
          ),
        ),
    ),
});

const findRecordedSession = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: StandingSessionSchema,
  execute: (conversationId) =>
    Database.use((db) =>
      db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.id, conversationId)),
    ),
});

const StandingSessionRowSchema = Schema.Struct({
  sessionId: Schema.String,
  kind: Schema.Literals(Object.values(CONVERSATION_KIND)),
});

const findStandingSessions = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.NullOr(Schema.String),
    conversationIds: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Result: StandingSessionRowSchema,
  execute: ({ userId, conversationIds }) =>
    Database.use((db) =>
      db
        .select({
          sessionId: sql<string>`${conversations.runtimeSessionId}`,
          kind: conversations.kind,
        })
        .from(conversations)
        .where(
          and(
            userId === null ? undefined : eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
            isNotNull(conversations.runtimeSessionId),
            conversationIds === undefined ? undefined : inArray(conversations.id, conversationIds),
          ),
        ),
    ),
});

type ConversationKind = (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND];

export interface StandingSession {
  readonly sessionId: string;
  readonly kind: ConversationKind;
}

export function standingSessionsOf(
  userId: string,
  conversationIds?: readonly string[],
): Effect.Effect<readonly StandingSession[], QueryError | Schema.SchemaError, DatabaseServices> {
  if (conversationIds !== undefined && conversationIds.length === 0) return Effect.succeed([]);
  return findStandingSessions({
    userId,
    ...(conversationIds === undefined ? undefined : { conversationIds }),
  });
}

export function standingSessionsNamed(
  conversationIds: readonly string[],
): Effect.Effect<readonly StandingSession[], QueryError | Schema.SchemaError, DatabaseServices> {
  if (conversationIds.length === 0) return Effect.succeed([]);
  return findStandingSessions({ userId: null, conversationIds });
}

export function recordedRuntimeSession(
  target: ConversationTarget,
): Effect.Effect<string | undefined, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findStandingSession(target), (row) =>
    Option.isSome(row) ? (row.value.runtimeSessionId ?? undefined) : undefined,
  );
}

export function conversationReachableBy(
  userId: string,
  conversationId: string,
): Effect.Effect<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findReachableConversation({ userId, conversationId }), Option.isSome);
}

export function runtimeSessionReachableBy(
  userId: string,
  runtimeSessionId: string,
): Effect.Effect<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(findReachableSession({ userId, runtimeSessionId }), Option.isSome);
}

export const claimRuntimeSession = Effect.fn("web/claimRuntimeSession")(function* (
  target: ConversationTarget,
  runtimeSessionId: string,
  now: Date,
): Effect.fn.Return<boolean, QueryError | Schema.SchemaError, DatabaseServices> {
  yield* claimSession({ ...target, runtimeSessionId, now });
  const recorded = yield* findRecordedSession(target.conversationId);
  return Option.isSome(recorded) && recorded.value.runtimeSessionId === runtimeSessionId;
});
