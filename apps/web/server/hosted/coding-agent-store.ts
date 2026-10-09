import { and, asc, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { codingAgent } from "../db/coding-agent-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import { conversations } from "../db/storage-schema.js";
import { CONVERSATION_KIND } from "../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * coding-agent-store.ts -- the coding agents started on an account's plans, each one conversation and one row linking it to its plan.
 *
 * Every statement names the account beside the plan or the agent, so an id
 * another account owns reads and starts exactly as one that names nothing.
 * Starting an agent is one transaction under the plan's own row lock: the
 * lock is the ownership check and what serialises two Starts of one plan,
 * so a retry carrying the key of a Start already made finds that agent
 * rather than opening a second conversation beside it. The agent's
 * conversation is a `coding_agent` conversation of the same account, opened
 * here and named on the row; its messages and turns are the relay's to
 * write. Every function is an effect over the ambient `SqlClient` and names
 * no database of its own.
 */

type CodingAgentStoreFailure = SqlError | Schema.SchemaError;

/** What a coding agent store operation answers: an effect over the ambient client, composed into whatever called it. */
export type CodingAgentStoreEffect<A> = Effect.Effect<
  A,
  CodingAgentStoreFailure,
  SqlClient.SqlClient
>;

/** One coding agent as the service holds it: what the tabs read, and what the agent's own turns run on. */
export interface CodingAgent {
  readonly id: string;
  readonly planId: string;
  readonly conversationId: string;
  readonly model: string;
  readonly effort: string;
  readonly planSnapshot: string;
  readonly repository: string;
  readonly createdAt: Date;
}

/** A Start: the plan, the request's own key, what to run on, and the plan text and repository as they stand now. */
export interface NewCodingAgent {
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly effort: string;
  readonly planSnapshot: string;
  readonly repository: string;
}

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const CODING_AGENT_COLUMNS = {
  id: codingAgent.id,
  planId: codingAgent.planId,
  conversationId: codingAgent.conversationId,
  model: codingAgent.model,
  effort: codingAgent.effort,
  planSnapshot: codingAgent.planSnapshot,
  repository: codingAgent.repository,
  createdAt: codingAgent.createdAt,
};

const CodingAgentRowSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  conversationId: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  planSnapshot: Schema.String,
  repository: Schema.String,
  createdAt: InstantColumnSchema,
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** The plan row under its own lock, where the account owns it. */
const lockOwnedPlan = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select({ id: plan.id })
      .from(plan)
      .where(and(eq(plan.id, planId), eq(plan.userId, userId)))
      .for("update"),
});

const findAgentByKey = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    idempotencyKey: Schema.String,
  }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, idempotencyKey }) =>
    db
      .select(CODING_AGENT_COLUMNS)
      .from(codingAgent)
      .where(and(eq(codingAgent.userId, userId), eq(codingAgent.idempotencyKey, idempotencyKey)))
      .limit(1),
});

const insertAgentConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  Result: IdRowSchema,
  execute: ({ userId, now }) =>
    db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.CODING_AGENT, createdAt: now, lastActivityAt: now })
      .returning({ id: conversations.id }),
});

const insertAgent = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    planId: Schema.String,
    idempotencyKey: Schema.String,
    model: Schema.String,
    effort: Schema.String,
    planSnapshot: Schema.String,
    repository: Schema.String,
    now: Schema.Date,
  }),
  Result: CodingAgentRowSchema,
  execute: (write) =>
    db
      .insert(codingAgent)
      .values({
        userId: write.userId,
        planId: write.planId,
        conversationId: write.conversationId,
        model: write.model,
        effort: write.effort,
        planSnapshot: write.planSnapshot,
        repository: write.repository,
        idempotencyKey: write.idempotencyKey,
        createdAt: write.now,
      })
      .returning(CODING_AGENT_COLUMNS),
});

const findAgentsOfPlan = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, planId }) =>
    db
      .select(CODING_AGENT_COLUMNS)
      .from(codingAgent)
      .where(and(eq(codingAgent.userId, userId), eq(codingAgent.planId, planId)))
      .orderBy(asc(codingAgent.createdAt), asc(codingAgent.id)),
});

const findAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, agentId }) =>
    db
      .select(CODING_AGENT_COLUMNS)
      .from(codingAgent)
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId)))
      .limit(1),
});

/**
 * Starts an agent on the account's plan: a `coding_agent` conversation and
 * the row that binds it to the plan, with the plan text and repository as
 * handed. A Start whose key the account has already used answers the agent
 * that Start made, whatever else the retry carries, and writes nothing.
 * Nothing where the account owns no such plan.
 */
export function createCodingAgent(
  userId: string,
  started: NewCodingAgent,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const owned = yield* lockOwnedPlan({ userId, planId: started.planId });
        if (Option.isNone(owned)) return Option.none();
        const existing = yield* findAgentByKey({
          userId,
          idempotencyKey: started.idempotencyKey,
        });
        if (Option.isSome(existing)) return existing;
        const now = yield* DateTime.nowAsDate;
        const conversation = yield* insertAgentConversation({ userId, now }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        const row = yield* insertAgent({
          userId,
          conversationId: conversation.id,
          planId: started.planId,
          idempotencyKey: started.idempotencyKey,
          model: started.model,
          effort: started.effort,
          planSnapshot: started.planSnapshot,
          repository: started.repository,
          now,
        }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
        return Option.some(row);
      }),
    ),
  );
}

/** Every agent started on the account's plan, in the order they were started; empty where the account owns no such plan. */
export function listCodingAgents(
  userId: string,
  planId: string,
): CodingAgentStoreEffect<readonly CodingAgent[]> {
  return findAgentsOfPlan({ userId, planId });
}

/** The account's agent under this id, or nothing for an agent the account does not own. */
export function readCodingAgent(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgent({ userId, agentId });
}
