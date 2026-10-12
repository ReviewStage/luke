import {
  CONTEXT_WINDOW,
  type CodingAgentPullRequest,
  type ContextWindow,
} from "@sidecar/hosted/coding-agent-wire";
import { foreignKey, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { plan } from "./plan.js";
import { conversations } from "./storage.js";

/**
 * coding-agent-schema.ts -- one coding agent started on a plan, linking its conversation to the plan it works.
 *
 * A coding agent is a `coding_agent` conversation: its transcript is that
 * conversation's `messages` rows and its status its latest `turns` row, so
 * this row holds only what the conversation does not. The model, effort,
 * and context window are read on every step, so switching later is a row
 * update; the window is the model's whole one unless the developer chose
 * the smaller standard one, which is also what an agent started before the
 * window could be chosen ran on and keeps; the snapshot
 * is the exact plan text the agent was handed, kept whole because the plan
 * keeps being edited after, or where the developer started it on a task of
 * their own, the snapshot is null and the task is what it was handed, so
 * exactly one of the two stands; the repository is `owner/name`; the branch
 * is the one checked out in the agent's sandbox as its last turn ended,
 * which is where its pull request is looked up, and null until a turn ends
 * or where the checkout stood detached; the title is the agent's name on
 * its tab, generated once from what it was handed as its first session
 * starts and renamed by the developer, null until either and after a rename
 * that cleared it. The last step is what the provider counted of the
 * newest model step of the agent's own conversation, with the estimates of
 * what it read that no provider counts apart (`StoredAgentStep`), and
 * `compacted_at` when eve last compacted that conversation; both are null
 * until it happens, and both are what the tab's context ring reads.
 * `published` is the pull request from the agent's branch as GitHub last
 * answered a read of it (`coder-host/published.ts`), null before a read
 * found one; the plan list reads it so the sidebar asks GitHub nothing.
 * `archived_at` is when the developer put the agent away, which leaves it
 * out of every list but the one that asks for archived agents, and null
 * while it stands; its conversation and pull request are kept either way.
 * There is no commit column: the
 * checkout's own output is in the transcript, and the pull request on
 * GitHub records its base.
 *
 * `idempotency_key` is the Start request's own key, unique per account, so a
 * network retry of one Start finds the agent it already made rather than
 * starting a second. The row goes with its plan, its account, and its
 * conversation alike.
 */
/**
 * The newest model step of an agent's own conversation, as the coder host
 * relayed it: the tokens its provider counted, the share of them its
 * prefix cache read or wrote, and the estimates of what the step read that
 * the provider does not count apart, the instructions, the tool
 * definitions, and the plan or task the agent was handed, each estimated
 * as eve's own compaction estimates (`coder-host/context-estimate.ts`).
 * `at` is the epoch milliseconds the step's end was relayed.
 */
export interface StoredAgentStep {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly systemPromptTokens: number;
  readonly toolDefinitionTokens: number;
  readonly briefTokens: number;
  readonly at: number;
}

export const codingAgent = pgTable(
  "coding_agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    /** Which of the model's context windows the agent runs on; a model with one window runs on it whatever this says. */
    contextWindow: text("context_window")
      .$type<ContextWindow>()
      .notNull()
      .default(CONTEXT_WINDOW.LONG),
    /** The plan's document exactly as the agent was given it; null for an agent handed a task instead. */
    planSnapshot: text("plan_snapshot"),
    /** The developer's own words the agent was handed in the plan's place; null for an agent handed the plan. */
    task: text("task"),
    /** The GitHub repository the agent works in, as `owner/name`. */
    repository: text("repository").notNull(),
    /** The branch checked out in the sandbox as the last turn ended; null before one ends or on a detached HEAD. */
    branch: text("branch"),
    /** The agent's title as its tab shows it; null falls back to the model's name. */
    title: text("title"),
    /** The newest model step of the agent's own conversation; null before its first. */
    lastStep: jsonb("last_step").$type<StoredAgentStep>(),
    /** When eve last compacted the agent's own conversation; null where it never has. */
    compactedAt: timestamptz("compacted_at"),
    /** The pull request from the agent's branch as GitHub last answered; null before a read found one. */
    published: jsonb("published").$type<CodingAgentPullRequest>(),
    /** When the developer archived the agent; null while it is not. */
    archivedAt: timestamptz("archived_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // One agent per Start: a retry carrying the same key finds this row.
    uniqueIndex("coding_agent_user_idempotency").on(table.userId, table.idempotencyKey),
    // The tabs read one plan's agents in the order they were started.
    index("coding_agent_plan_created").on(table.planId, table.createdAt),
  ],
);

/**
 * One delegation of a coding agent's: the model and effort the agent chose
 * for the worker, keyed by the child conversation the worker's session is
 * recorded in, which is a function of the agent's conversation and the call
 * that started the worker (`@sidecar/database/models/ids`). The worker's own steps
 * read the pair here, since eve hands a child's resolvers no lineage and the
 * pair is per call rather than per agent. The call's own id is kept beside
 * it, since the child's id is a digest no reader can turn back into the
 * call its tool part names, and the agent's page names each worker's title
 * by that call. The row goes with its conversation, which goes with the
 * agent's.
 */
export const codingAgentDelegation = pgTable(
  "coding_agent_delegation",
  {
    childConversationId: uuid("child_conversation_id").primaryKey(),
    /** eve's id for the delegation call; null on a row recorded before migration 0079 kept it. */
    callId: text("call_id"),
    /** AI Gateway's catalog id, such as `anthropic/claude-opus-5.5`. */
    model: text("model").notNull(),
    effort: text("effort").notNull(),
  },
  (table) => [
    // Note that the name is spelled out, because the one Drizzle derives is
    // longer than Postgres's 63 bytes and the database holds it truncated.
    foreignKey({
      name: "coding_agent_delegation_child_conversation_id_conversations_id_",
      columns: [table.childConversationId],
      foreignColumns: [conversations.id],
    }).onDelete("cascade"),
  ],
);
