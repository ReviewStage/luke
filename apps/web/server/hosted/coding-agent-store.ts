import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { and, asc, eq, isNull } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { TURN_STATUS } from "../core.js";
import { codingAgent, codingAgentDelegation } from "../db/coding-agent-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import { conversations } from "../db/storage-schema.js";
import { CONVERSATION_KIND } from "../db/storage-vocabulary.js";
import { InstantColumnSchema } from "./store/database.js";
import type { ConversationTarget } from "./store/index.js";
import {
  awaitingLinesOf,
  type LatestTurn,
  latestTurnsOf,
  type TurnUsageRow,
  turnUsagesOf,
} from "./store/message-reads.js";

/**
 * coding-agent-store.ts -- the coding agents started on an account's plans, each one conversation and one row linking it to its plan.
 *
 * Every statement names the account beside the plan or the agent, so an id
 * another account owns reads and starts exactly as one that names nothing.
 * Starting an agent is one transaction under the plan's own row lock: the
 * lock is the ownership check and what serialises two Starts of one plan,
 * so a retry carrying the key of a Start already made finds that agent
 * rather than opening a second conversation beside it, and says which it
 * did, since only a Start that made the agent opens its eve session. The
 * agent's conversation is a `coding_agent` conversation of the same
 * account, opened here and named on the row; its messages and turns are the
 * relay's to write, and the newest turn is what the agent's status is read
 * from. A Start whose eve session could not be opened discards the agent
 * again, rows and conversation, so a retry under the same key starts afresh
 * rather than finding an agent nothing runs. The model and effort on the
 * row are read at every step, so a change to them is the next step's. The
 * branch is what stood checked out in the agent's sandbox as its last turn
 * ended, written by the session's turn-end hook (`coder-host/host.ts`) and
 * read where the agent's pull request is looked up (`coder-host/published.ts`). A
 * delegation is a child conversation under the agent's, opened ahead of the
 * worker's session (`coder-host/delegation.ts`) with the model and effort
 * the agent chose for it written beside it here, so the worker's steps read
 * the pair under the child and the tabs read the worker's transcript under
 * the agent's. Note that nothing here reaches the brain host's modules,
 * because the routes bundle this module and the brain host's modules reach
 * eve, which runs in a service of its own (`function-bundles.ts`). Every function is an effect
 * over the ambient `SqlClient` and names no database of its own.
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
  /** The plan text the agent was handed; null where it was handed a task instead. */
  readonly planSnapshot: string | null;
  /** The developer's words the agent was handed in the plan's place; null where it was handed the plan. */
  readonly task: string | null;
  readonly repository: string;
  /** The branch checked out in the sandbox as the last turn ended; null before one ends or where the checkout stood detached. */
  readonly branch: string | null;
  readonly createdAt: Date;
}

/** What a Start answered: the agent, and whether this Start made it or a retry found it. */
export interface CodingAgentStarted {
  readonly agent: CodingAgent;
  readonly created: boolean;
}

/** The newest turn of an agent's conversation, as its status is read from it; nothing before the first turn. The read is the store's own (`store/message-reads.ts`), re-exported here beside the agents it is read for. */
export type CodingAgentLatestTurn = LatestTurn;
export { awaitingLinesOf, latestTurnsOf, type TurnUsageRow, turnUsagesOf };

/** What a Start hands the agent as its first message: the plan's text as it stands now, or the developer's task in its place. */
export type CodingAgentBriefText =
  | { readonly planSnapshot: string; readonly task: null }
  | { readonly planSnapshot: null; readonly task: string };

/** A Start: the plan, the request's own key, what to run on, what the agent is handed, and the repository as it stands now. */
export type NewCodingAgent = CodingAgentBriefText & {
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly effort: string;
  readonly repository: string;
};

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const CODING_AGENT_COLUMNS = {
  id: codingAgent.id,
  planId: codingAgent.planId,
  conversationId: codingAgent.conversationId,
  model: codingAgent.model,
  effort: codingAgent.effort,
  planSnapshot: codingAgent.planSnapshot,
  task: codingAgent.task,
  repository: codingAgent.repository,
  branch: codingAgent.branch,
  createdAt: codingAgent.createdAt,
};

const CodingAgentRowSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  conversationId: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  planSnapshot: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  repository: Schema.String,
  branch: Schema.NullOr(Schema.String),
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
    planSnapshot: Schema.NullOr(Schema.String),
    task: Schema.NullOr(Schema.String),
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
        task: write.task,
        repository: write.repository,
        idempotencyKey: write.idempotencyKey,
        createdAt: write.now,
      })
      .returning(CODING_AGENT_COLUMNS),
});

const updateAgentChoice = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    model: Schema.String,
    effort: Schema.String,
  }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, agentId, model, effort }) =>
    db
      .update(codingAgent)
      .set({ model, effort })
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId)))
      .returning(CODING_AGENT_COLUMNS),
});

const updateAgentBranch = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    branch: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, agentId, branch }) =>
    db
      .update(codingAgent)
      .set({ branch })
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId))),
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

const findAgentOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, conversationId }) =>
    db
      .select(CODING_AGENT_COLUMNS)
      .from(codingAgent)
      .where(and(eq(codingAgent.conversationId, conversationId), eq(codingAgent.userId, userId)))
      .limit(1),
});

const deleteAgentRow = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ userId, agentId }) =>
    db
      .delete(codingAgent)
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId)))
      .returning({ conversationId: codingAgent.conversationId }),
});

const deleteConversationRow = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  execute: ({ userId, conversationId }) =>
    db
      .delete(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId))),
});

/**
 * Starts an agent on the account's plan: a `coding_agent` conversation and
 * the row that binds it to the plan, with the plan text or the task, and
 * the repository, as handed. A Start whose key the account has already used answers the agent
 * that Start made, whatever else the retry carries, and writes nothing.
 * Nothing where the account owns no such plan.
 */
export function createCodingAgent(
  userId: string,
  started: NewCodingAgent,
): CodingAgentStoreEffect<Option.Option<CodingAgentStarted>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const owned = yield* lockOwnedPlan({ userId, planId: started.planId });
        if (Option.isNone(owned)) return Option.none();
        const existing = yield* findAgentByKey({
          userId,
          idempotencyKey: started.idempotencyKey,
        });
        if (Option.isSome(existing)) {
          return Option.some({ agent: existing.value, created: false });
        }
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
          task: started.task,
          repository: started.repository,
          now,
        }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
        return Option.some({ agent: row, created: true });
      }),
    ),
  );
}

/**
 * Discards an agent a Start could not open an eve session for: its row and
 * its conversation, with every message and turn the conversation holds,
 * which is none. Answers whether the account held such an agent.
 */
export function discardCodingAgent(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const [deleted] = yield* deleteAgentRow({ userId, agentId });
        if (deleted === undefined) return false;
        yield* deleteConversationRow({ userId, conversationId: deleted.conversationId });
        return true;
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

/** The account's agent given another model and effort, which its next step runs on; nothing for an agent the account does not own. */
export function updateCodingAgentChoice(
  userId: string,
  agentId: string,
  choice: { readonly model: string; readonly effort: string },
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return updateAgentChoice({ userId, agentId, model: choice.model, effort: choice.effort });
}

/** The branch checked out in the account's agent's sandbox as its turn ended, null for a detached HEAD; nothing written for an agent the account does not own. */
export function updateCodingAgentBranch(
  userId: string,
  agentId: string,
  branch: string | null,
): CodingAgentStoreEffect<void> {
  return updateAgentBranch({ userId, agentId, branch });
}

/** The account's agent whose conversation this is, which is what an eve session admitted for the conversation runs; nothing for another account's or no agent's. */
export function readCodingAgentOfConversation(
  userId: string,
  conversationId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgentOfConversation({ userId, conversationId });
}

/** What an agent chose for one worker, and when the delegation was recorded. */
export interface CodingAgentDelegation extends ModelChoice {
  readonly createdAt: Date;
}

const insertDelegation = SqlSchema.void({
  Request: Schema.Struct({
    childConversationId: Schema.String,
    model: Schema.String,
    effort: Schema.String,
  }),
  execute: ({ childConversationId, model, effort }) =>
    db
      .insert(codingAgentDelegation)
      .values({ childConversationId, model, effort })
      .onConflictDoNothing({ target: codingAgentDelegation.childConversationId }),
});

const findDelegation = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    childConversationId: Schema.String,
  }),
  Result: Schema.Struct({
    model: Schema.String,
    effort: Schema.String,
    createdAt: InstantColumnSchema,
  }),
  execute: ({ userId, parentConversationId, childConversationId }) =>
    db
      .select({
        model: codingAgentDelegation.model,
        effort: codingAgentDelegation.effort,
        createdAt: conversations.createdAt,
      })
      .from(codingAgentDelegation)
      .innerJoin(conversations, eq(conversations.id, codingAgentDelegation.childConversationId))
      .where(
        and(
          eq(codingAgentDelegation.childConversationId, childConversationId),
          eq(conversations.userId, userId),
          eq(conversations.parentConversationId, parentConversationId),
          isNull(conversations.deletedAt),
        ),
      ),
});

/** Writes the pair a worker runs on under its child conversation, which must already stand; a pair written twice under one child stands as first written, since the worker may already be reading it. */
export function writeDelegation(
  childConversationId: string,
  choice: ModelChoice,
): CodingAgentStoreEffect<void> {
  return insertDelegation({ childConversationId, model: choice.model, effort: choice.effort });
}

/** The delegation recorded under this child of the account's conversation, or nothing where none stands: another account's, another agent's, or no delegation at all. */
export function readDelegation(
  parent: ConversationTarget,
  childConversationId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgentDelegation>> {
  return findDelegation({
    userId: parent.userId,
    parentConversationId: parent.conversationId,
    childConversationId,
  });
}

/** The turn statuses under which an agent is still at work, which is when a Stop has something to stop. */
export const RUNNING_TURN_STATUSES: ReadonlySet<string> = new Set([
  TURN_STATUS.QUEUED,
  TURN_STATUS.RUNNING,
]);
