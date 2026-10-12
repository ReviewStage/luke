import {
  CONTEXT_WINDOW,
  type CodingAgentPullRequest,
  type CodingAgentSubagentTitle,
  type ContextWindow,
  codingAgentPullRequestSchema,
  contextWindowSchema,
} from "@sidecar/hosted/coding-agent-wire";
import type { ModelChoice } from "@sidecar/hosted/models-wire";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { TURN_STATUS } from "../core.js";
import {
  codingAgent,
  codingAgentDelegation,
  type StoredAgentStep,
} from "../db/coding-agent-schema.js";
import { plan } from "../db/plan-schema.js";
import { db } from "../db/query.js";
import { conversations } from "../db/storage-schema.js";
import { CONVERSATION_KIND } from "../db/storage-vocabulary.js";
import { PlanArchived } from "./plan-store.js";
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
 * rather than finding an agent nothing runs. The model, effort, and context
 * window on the row are read at every step, so a change to them is the next
 * step's. The
 * branch is what stood checked out in the agent's sandbox as its last turn
 * ended, written by the session's turn-end hook (`coder-host/host.ts`) and
 * read where the agent's pull request is looked up (`coder-host/published.ts`). A
 * delegation is a child conversation under the agent's, opened ahead of the
 * worker's session (`coder-host/delegation.ts`) with the model and effort
 * the agent chose for it written beside it here, so the worker's steps read
 * the pair under the child and the tabs read the worker's transcript under
 * the agent's; the worker's title stands on its child conversation
 * (`child-titles.ts`) and is read back here by the call that delegated it,
 * which is kept on the delegation for that. Note that nothing here reaches the brain host's modules,
 * because the routes bundle this module and the brain host's modules reach
 * eve, which runs in a service of its own (`function-bundles.ts`). The
 * title is written two ways: filled where none stands, which is how the
 * one generated as the agent starts lands without ever covering a name the
 * developer gave, and renamed, which replaces whatever stands. The newest
 * model step of the agent's own conversation and eve's last compaction of
 * it are written by the coder host as eve tells them, and read back with
 * the transcript, which is what the tab's context ring draws. The pull
 * request from the agent's branch is written as GitHub answered each read
 * of it (`coder-host/published.ts`), and read back beside the agents of
 * every plan the list names, so the list asks GitHub nothing. Every
 * function is an effect over the ambient `SqlClient` and names no database
 * of its own.
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
  readonly contextWindow: ContextWindow;
  /** The plan text the agent was handed; null where it was handed a task instead. */
  readonly planSnapshot: string | null;
  /** The developer's words the agent was handed in the plan's place; null where it was handed the plan. */
  readonly task: string | null;
  readonly repository: string;
  /** The branch checked out in the sandbox as the last turn ended; null before one ends or where the checkout stood detached. */
  readonly branch: string | null;
  /** The agent's title as its tab shows it; null falls back to the model's name. */
  readonly title: string | null;
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
  /** The model's whole window, the long one, where the Start names none. */
  readonly contextWindow?: ContextWindow | undefined;
  readonly repository: string;
};

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const CODING_AGENT_COLUMNS = {
  id: codingAgent.id,
  planId: codingAgent.planId,
  conversationId: codingAgent.conversationId,
  model: codingAgent.model,
  effort: codingAgent.effort,
  contextWindow: codingAgent.contextWindow,
  planSnapshot: codingAgent.planSnapshot,
  task: codingAgent.task,
  repository: codingAgent.repository,
  branch: codingAgent.branch,
  title: codingAgent.title,
  createdAt: codingAgent.createdAt,
};

const CodingAgentRowSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  conversationId: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  contextWindow: contextWindowSchema,
  planSnapshot: Schema.NullOr(Schema.String),
  task: Schema.NullOr(Schema.String),
  repository: Schema.String,
  branch: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** The plan row under its own lock, where the account owns it, with whether it is archived. */
const lockOwnedPlan = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, planId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, archived: Schema.Boolean }),
  execute: ({ userId, planId }) =>
    db
      .select({ id: plan.id, archived: sql<boolean>`${plan.archivedAt} is not null` })
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
    contextWindow: contextWindowSchema,
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
        contextWindow: write.contextWindow,
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
    contextWindow: contextWindowSchema,
  }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, agentId, model, effort, contextWindow }) =>
    db
      .update(codingAgent)
      .set({ model, effort, contextWindow })
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

const updateAgentTitle = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, agentId, title }) =>
    db
      .update(codingAgent)
      .set({ title })
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId)))
      .returning(CODING_AGENT_COLUMNS),
});

const fillAgentTitle = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, title: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, title }) =>
    db
      .update(codingAgent)
      .set({ title })
      .where(
        and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId), isNull(codingAgent.title)),
      )
      .returning({ id: codingAgent.id }),
});

/** The `last_step` column as the coder host writes it (`StoredAgentStep`). */
const AgentStepColumnSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.optionalKey(Schema.Number),
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
  systemPromptTokens: Schema.Number,
  toolDefinitionTokens: Schema.Number,
  briefTokens: Schema.Number,
  at: Schema.Number,
});

const updateAgentStep = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    lastStep: AgentStepColumnSchema,
  }),
  execute: ({ userId, agentId, lastStep }) =>
    db
      .update(codingAgent)
      .set({ lastStep })
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId))),
});

const updateAgentCompaction = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, at: Schema.Date }),
  execute: ({ userId, agentId, at }) =>
    db
      .update(codingAgent)
      .set({ compactedAt: at })
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId))),
});

const findAgentContext = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({
    model: Schema.String,
    contextWindow: contextWindowSchema,
    lastStep: Schema.NullOr(AgentStepColumnSchema),
    compactedAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: ({ userId, agentId }) =>
    db
      .select({
        model: codingAgent.model,
        contextWindow: codingAgent.contextWindow,
        lastStep: codingAgent.lastStep,
        compactedAt: codingAgent.compactedAt,
      })
      .from(codingAgent)
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId)))
      .limit(1),
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

const updateAgentPublished = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    published: Schema.NullOr(codingAgentPullRequestSchema),
  }),
  execute: ({ userId, agentId, published }) =>
    db
      .update(codingAgent)
      .set({ published })
      .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId))),
});

const findAgentsOfPlans = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, planIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    ...CodingAgentRowSchema.fields,
    published: Schema.NullOr(codingAgentPullRequestSchema),
  }),
  execute: ({ userId, planIds }) =>
    db
      .select({ ...CODING_AGENT_COLUMNS, published: codingAgent.published })
      .from(codingAgent)
      .where(and(eq(codingAgent.userId, userId), inArray(codingAgent.planId, [...planIds])))
      .orderBy(asc(codingAgent.createdAt), asc(codingAgent.id)),
});

const findAgentsOnBranches = SqlSchema.findAll({
  Request: Schema.Struct({
    repository: Schema.String,
    branches: Schema.Array(Schema.String),
    limit: Schema.Number,
  }),
  Result: Schema.Struct({ ...CodingAgentRowSchema.fields, userId: Schema.String }),
  execute: ({ repository, branches, limit }) =>
    db
      .select({ ...CODING_AGENT_COLUMNS, userId: codingAgent.userId })
      .from(codingAgent)
      .where(
        and(eq(codingAgent.repository, repository), inArray(codingAgent.branch, [...branches])),
      )
      .orderBy(desc(codingAgent.createdAt), asc(codingAgent.id))
      .limit(limit),
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
 * Nothing where the account owns no such plan. An archived plan starts no
 * agent, read under the same lock, though a retry still answers the agent
 * its Start made before the archive.
 */
export function createCodingAgent(
  userId: string,
  started: NewCodingAgent,
): Effect.Effect<
  Option.Option<CodingAgentStarted>,
  CodingAgentStoreFailure | PlanArchived,
  SqlClient.SqlClient
> {
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
        if (owned.value.archived) return yield* new PlanArchived();
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
          contextWindow: started.contextWindow ?? CONTEXT_WINDOW.LONG,
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

/** One agent, and the pull request from its branch as GitHub last answered; null before a read found one. */
export interface PublishedCodingAgent {
  readonly agent: CodingAgent;
  readonly published: CodingAgentPullRequest | null;
}

/** Every agent started on the account's plans named, each with what it published, in the order they were started; a plan another account owns names none. */
export function listPublishedCodingAgents(
  userId: string,
  planIds: readonly string[],
): CodingAgentStoreEffect<readonly PublishedCodingAgent[]> {
  if (planIds.length === 0) return Effect.succeed([]);
  return Effect.map(findAgentsOfPlans({ userId, planIds }), (rows) =>
    rows.map(({ published, ...agent }) => ({ agent, published })),
  );
}

/** The pull request from the account's agent's branch as GitHub just answered, or null where it answered none; nothing written for an agent the account does not own. */
export function recordCodingAgentPublished(
  userId: string,
  agentId: string,
  published: CodingAgentPullRequest | null,
): CodingAgentStoreEffect<void> {
  return updateAgentPublished({ userId, agentId, published });
}

/** One agent and the account that owns it, as a delivery from GitHub that names a repository and a branch finds it. */
export interface OwnedCodingAgent {
  readonly userId: string;
  readonly agent: CodingAgent;
}

/**
 * The agents of any account whose row stands on one of the repository's
 * branches named, newest started first and at most `limit` of them; none for
 * no branch. This is the one read that names no account, since GitHub's
 * delivery names a repository and a branch and nothing of who started an
 * agent on them; what each answers is read again on its owner's own token.
 */
export function listCodingAgentsOnBranches(
  repository: string,
  branches: readonly string[],
  limit: number,
): CodingAgentStoreEffect<readonly OwnedCodingAgent[]> {
  if (branches.length === 0) return Effect.succeed([]);
  return Effect.map(findAgentsOnBranches({ repository, branches, limit }), (rows) =>
    rows.map(({ userId, ...agent }) => ({ userId, agent })),
  );
}

/** The account's agent under this id, or nothing for an agent the account does not own. */
export function readCodingAgent(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgent({ userId, agentId });
}

/** The account's agent given another model, effort, and context window, which its next step runs on, the model's whole window where the choice names none; nothing for an agent the account does not own. */
export function updateCodingAgentChoice(
  userId: string,
  agentId: string,
  choice: ModelChoice,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return updateAgentChoice({
    userId,
    agentId,
    model: choice.model,
    effort: choice.effort,
    contextWindow: choice.contextWindow ?? CONTEXT_WINDOW.LONG,
  });
}

/** The branch checked out in the account's agent's sandbox as its turn ended, null for a detached HEAD; nothing written for an agent the account does not own. */
export function updateCodingAgentBranch(
  userId: string,
  agentId: string,
  branch: string | null,
): CodingAgentStoreEffect<void> {
  return updateAgentBranch({ userId, agentId, branch });
}

/** The account's agent under another title, or none, which its tab shows in place of the model's name; nothing for an agent the account does not own. */
export function renameCodingAgent(
  userId: string,
  agentId: string,
  title: string | null,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return updateAgentTitle({ userId, agentId, title });
}

/** The title written where the agent has none yet, so a name the developer gave stands whatever this carries; answers whether it was written. */
export function fillCodingAgentTitle(
  userId: string,
  agentId: string,
  title: string,
): CodingAgentStoreEffect<boolean> {
  return Effect.map(fillAgentTitle({ userId, agentId, title }), (rows) => rows.length > 0);
}

/** The account's agent whose conversation this is, which is what an eve session admitted for the conversation runs; nothing for another account's or no agent's. */
export function readCodingAgentOfConversation(
  userId: string,
  conversationId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgentOfConversation({ userId, conversationId });
}

/** What the agent's own conversation holds in its model's context: the model it runs on now, its newest step, and when eve last compacted it; null for each of the last two before it happens. */
export interface CodingAgentContextRow {
  readonly model: string;
  readonly contextWindow: ContextWindow;
  readonly lastStep: StoredAgentStep | null;
  readonly compactedAt: Date | null;
}

/** The newest model step of the account's agent's own conversation, which replaces the one before it; nothing written for an agent the account does not own. */
export function recordCodingAgentStep(
  userId: string,
  agentId: string,
  lastStep: StoredAgentStep,
): CodingAgentStoreEffect<void> {
  return updateAgentStep({ userId, agentId, lastStep });
}

/** When eve compacted the account's agent's own conversation; nothing written for an agent the account does not own. */
export function recordCodingAgentCompaction(
  userId: string,
  agentId: string,
  at: Date,
): CodingAgentStoreEffect<void> {
  return updateAgentCompaction({ userId, agentId, at });
}

/** What the account's agent's own conversation holds in its model's context, or nothing for an agent the account does not own. */
export function readCodingAgentContext(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgentContextRow>> {
  return findAgentContext({ userId, agentId });
}

/** What an agent chose for one worker, and when the delegation was recorded. */
export interface CodingAgentDelegation extends ModelChoice {
  readonly createdAt: Date;
}

const insertDelegation = SqlSchema.void({
  Request: Schema.Struct({
    childConversationId: Schema.String,
    callId: Schema.String,
    model: Schema.String,
    effort: Schema.String,
  }),
  execute: ({ childConversationId, callId, model, effort }) =>
    db
      .insert(codingAgentDelegation)
      .values({ childConversationId, callId, model, effort })
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

/** Writes the pair a worker runs on under its child conversation, which must already stand, with the call that delegated it; a pair written twice under one child stands as first written, since the worker may already be reading it. */
export function writeDelegation(
  childConversationId: string,
  callId: string,
  choice: ModelChoice,
): CodingAgentStoreEffect<void> {
  return insertDelegation({
    childConversationId,
    callId,
    model: choice.model,
    effort: choice.effort,
  });
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

const findDelegationStarts = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    childConversationIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ childConversationId: Schema.String, createdAt: InstantColumnSchema }),
  execute: ({ userId, parentConversationId, childConversationIds }) =>
    db
      .select({
        childConversationId: codingAgentDelegation.childConversationId,
        createdAt: conversations.createdAt,
      })
      .from(codingAgentDelegation)
      .innerJoin(conversations, eq(conversations.id, codingAgentDelegation.childConversationId))
      .where(
        and(
          inArray(codingAgentDelegation.childConversationId, [...childConversationIds]),
          eq(conversations.userId, userId),
          eq(conversations.parentConversationId, parentConversationId),
          isNull(conversations.deletedAt),
        ),
      ),
});

/** When each of these children of the account's conversation was delegated, by child, for those a delegation was recorded under; none asked, none read. */
export function delegationStartsOf(
  parent: ConversationTarget,
  childConversationIds: readonly string[],
): CodingAgentStoreEffect<ReadonlyMap<string, Date>> {
  if (childConversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findDelegationStarts({
      userId: parent.userId,
      parentConversationId: parent.conversationId,
      childConversationIds,
    }),
    (rows) => new Map(rows.map((row) => [row.childConversationId, row.createdAt])),
  );
}

const findDelegationTitles = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, parentConversationId: Schema.String }),
  Result: Schema.Struct({ callId: Schema.String, title: Schema.String }),
  execute: ({ userId, parentConversationId }) =>
    db
      .select({ callId: codingAgentDelegation.callId, title: conversations.title })
      .from(codingAgentDelegation)
      .innerJoin(conversations, eq(conversations.id, codingAgentDelegation.childConversationId))
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.parentConversationId, parentConversationId),
          isNotNull(codingAgentDelegation.callId),
          isNotNull(conversations.title),
          isNull(conversations.deletedAt),
        ),
      )
      .orderBy(asc(conversations.createdAt)),
});

/** Every titled worker of the account's conversation by the call that delegated it, oldest first; one recorded before its call was kept reads as untitled. */
export function delegationTitlesOf(
  parent: ConversationTarget,
): CodingAgentStoreEffect<readonly CodingAgentSubagentTitle[]> {
  return findDelegationTitles({
    userId: parent.userId,
    parentConversationId: parent.conversationId,
  });
}

const findUntitledDelegations = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    parentConversationId: Schema.String,
    since: Schema.Date,
  }),
  Result: Schema.Struct({ childConversationId: Schema.String }),
  execute: ({ userId, parentConversationId, since }) =>
    db
      .select({ childConversationId: codingAgentDelegation.childConversationId })
      .from(codingAgentDelegation)
      .innerJoin(conversations, eq(conversations.id, codingAgentDelegation.childConversationId))
      .where(
        and(
          eq(conversations.userId, userId),
          eq(conversations.parentConversationId, parentConversationId),
          isNull(conversations.title),
          gt(conversations.createdAt, since),
          isNull(conversations.deletedAt),
        ),
      ),
});

/** The children of the account's conversation delegated after `since` that have no title yet, which is where a title may still land. */
export function untitledDelegationsSince(
  parent: ConversationTarget,
  since: Date,
): CodingAgentStoreEffect<ReadonlySet<string>> {
  return Effect.map(
    findUntitledDelegations({
      userId: parent.userId,
      parentConversationId: parent.conversationId,
      since,
    }),
    (rows) => new Set(rows.map((row) => row.childConversationId)),
  );
}

/** The turn statuses under which an agent is still at work, which is when a Stop has something to stop. */
export const RUNNING_TURN_STATUSES: ReadonlySet<string> = new Set([
  TURN_STATUS.QUEUED,
  TURN_STATUS.RUNNING,
]);
