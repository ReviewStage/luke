import type { AutomationFiring } from "@luke/features/automation-wire";
import {
  CONTEXT_WINDOW,
  type CodingAgentArchiver,
  type CodingAgentAuthor,
  type CodingAgentPullRequest,
  type ContextWindow,
} from "@luke/features/coding-agent-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { automation } from "./automation.js";
import { conversations } from "./storage.js";
import { task } from "./task.js";

/**
 * coding-agent.ts -- one coding agent started on a task, linking its conversation to the task it works.
 *
 * A coding agent is a `coding_agent` conversation: its transcript is that
 * conversation's `messages` rows and its status its latest `turns` row, so
 * this row holds only what the conversation does not. The model, effort,
 * and context window are read on every step, so switching later is a row
 * update; the window is the model's whole one unless the developer chose
 * the smaller standard one, which is also what an agent started before the
 * window could be chosen ran on and keeps; the snapshot
 * is the exact plan text the agent was handed, kept whole because the plan
 * keeps being edited after, or where the developer started it on a prompt of
 * their own, the snapshot is null and the prompt is what it was handed, so
 * exactly one of the two stands; the repository is `owner/name`; the branch
 * is the one checked out in the agent's sandbox as its last turn ended,
 * which is where its pull request is looked up, and null until a turn ends
 * or where the checkout stood detached or on its start branch; the start branch is the one its
 * starter named for its checkout to be cloned at, such as a stacked pull
 * request's, and null for the repository's default branch, which every
 * agent started without one is cloned at; the title is the agent's name on
 * its tab, generated once from what it was handed as its first session
 * starts and renamed by the developer, null until either and after a rename
 * that cleared it. The last step is what the provider counted of the
 * newest model step of the agent's own conversation, with the estimates of
 * what it read that no provider counts apart (`StoredAgentStep`), and
 * `compacted_at` when eve last compacted that conversation; both are null
 * until it happens, and both are what the tab's context ring reads.
 * `published` is the pull request from the agent's branch as GitHub last
 * answered a read of it (`coder-host/published.ts`), null before a read
 * found one; the task list reads it so the sidebar asks GitHub nothing.
 * `archived_at` is when the developer put the agent away, which leaves it
 * out of every list but the one that asks for archived agents, and null
 * while it stands; its conversation and pull request are kept either way.
 * `archived_by` is who archived it (`StoredArchive`), written with
 * `archived_at` and cleared with it; null for an archive from before the
 * column, and for one an automation's sweep made.
 * `disabled_servers` is the MCP servers, by connection name (one account
 * at an integration: `notion`, `notion-2`, the first account's name being
 * its provider's), the developer switched off for this agent from its
 * composer, which its next turns are not handed; null, like an empty list, switches none off, so a
 * server connected later is on for every agent. A provider no longer
 * offered may stand in the list and is ignored where it is read.
 * `mentioned_servers` is the MCP servers a message to the agent mentioned
 * since its last turn started (`@Linear`), which its next turn is handed
 * whatever `disabled_servers` says and then takes back to null, so a mention
 * turns a server on for the one turn and never touches the switch.
 * `automation_origin` is the run of an automation that started the agent,
 * kept as it stood when the run started (`StoredAutomationOrigin`), so the
 * agent still names its automation once that automation is deleted and
 * `automation_id` goes null; null for an agent started by hand.
 * `started_from` is the agent of the same plan this one was started from
 * (`StoredStartedFrom`): the one it continues, or forks at one of its
 * messages, with how many of that agent's steps its first message replayed
 * of how many there were, and the branch that agent's work was copied to
 * for it where it could be; null for an agent started afresh. The source is
 * named by id and held to nothing, so an agent outlives a source discarded
 * after it.
 * `author` is who the agent's commits are by and its pull request is opened
 * as, the developer or the Luke GitHub App with why (`CODING_AGENT_AUTHOR`),
 * settled once as its first session starts and never moved after, so its
 * instructions and its checkout agree; null before then, and for an agent
 * from before the column, which writes as the App.
 * There is no commit column: the
 * checkout's own output is in the transcript, and the pull request on
 * GitHub records its base.
 *
 * `idempotency_key` is the Start request's own key, unique per account, so a
 * network retry of one Start finds the agent it already made rather than
 * starting a second. The row goes with its task, its account, and its
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

/**
 * The run of an automation that started an agent, as the run started it: the
 * automation's name, what fired the run, the automation's prompt alone,
 * without the lines Luke adds of the firing, and a webhook call's body as
 * its caller sent it, cut as the agent was handed it, where the firing was
 * one. The body is the agent's task already, so it is kept nowhere the task
 * is not.
 */
export interface StoredAutomationOrigin {
  readonly name: string;
  readonly firing: AutomationFiring;
  readonly prompt: string;
  readonly body?: string;
}

/**
 * The agent an agent was started from: its id, the assistant message it was
 * forked at where it was forked rather than continued, and how many of that
 * message's steps, and of the last of them how many words and calls, the
 * fork kept where it was a reply still being written,
 * how many of the source's steps the replay kept of how many there were,
 * and the branch its work was copied to where it could be.
 */
export interface StoredStartedFrom {
  readonly agentId: string;
  readonly messageId?: string;
  /** How many of the message's steps the fork kept, as seen when Fork was pressed on a reply still being written; absent where it kept the message whole. */
  readonly messageSteps?: number;
  /** How many words and calls of the last of those steps the fork kept, as seen at that press; absent where it kept that step whole. */
  readonly messageStepParts?: number;
  readonly steps: number;
  readonly totalSteps: number;
  /** The branch the source's work was copied to for this agent, what it had not pushed included; absent where it could not be copied. */
  readonly branch?: string;
}

/**
 * Who archived an agent, and why: a member from the window, or Luke or
 * another coding agent acting for one, the member always, the agent by its
 * id and its title as it stood, and the reason where one was given.
 */
export interface StoredArchive {
  readonly by: CodingAgentArchiver;
  readonly userId: string;
  readonly agentId?: string;
  readonly agentName?: string;
  readonly reason?: string;
}

export const codingAgent = pgTable(
  "coding_agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The task the agent works on; null for an agent an automation started with no task. */
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    /** The workspace the agent belongs to, its task's or its automation's. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** The automation whose run started the agent; null for one started by hand or once that automation is deleted. */
    automationId: uuid("automation_id").references((): AnyPgColumn => automation.id, {
      onDelete: "set null",
    }),
    /** The run of an automation that started the agent, as it stood then; null for one started by hand. */
    automationOrigin: jsonb("automation_origin").$type<StoredAutomationOrigin>(),
    /** The agent of the same plan this one was started from, with its replay's counts; null for one started afresh. */
    startedFrom: jsonb("started_from").$type<StoredStartedFrom>(),
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
    /** The plan's document exactly as the agent was given it; null for an agent handed a prompt instead. */
    planSnapshot: text("plan_snapshot"),
    /** The developer's own words the agent was handed in the plan's place; null for an agent handed the plan. */
    prompt: text("prompt"),
    /** The GitHub repository the agent works in, as `owner/name`: the first of `repositories`. */
    repository: text("repository").notNull(),
    /** Every repository the agent works in, `owner/name` each, the first where it starts; one until full multi-repo. */
    repositories: jsonb("repositories").$type<readonly string[]>().notNull().default([]),
    /** The branch checked out in the sandbox as the last turn ended; null before one ends or on a detached HEAD. */
    branch: text("branch"),
    /** The branch the agent's checkout is cloned at, as its starter named it; null for the repository's default branch. */
    startBranch: text("start_branch"),
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
    /** Who archived the agent, and why; null while it is not, and for an archive no one was recorded for. */
    archivedBy: jsonb("archived_by").$type<StoredArchive>(),
    /** The MCP servers switched off for this agent, by integration provider; null switches none off. */
    disabledServers: jsonb("disabled_servers").$type<readonly string[]>(),
    /** The MCP servers mentioned since the agent's last turn started, by integration provider; null for none. */
    mentionedServers: jsonb("mentioned_servers").$type<readonly string[]>(),
    /** Who the agent's commits are by and its pull request is opened as; null until its first session settles it. */
    author: text("author").$type<CodingAgentAuthor>(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    // One agent per Start: a retry carrying the same key finds this row.
    uniqueIndex("coding_agent_user_idempotency").on(table.userId, table.idempotencyKey),
    // The tabs read one task's agents in the order they were started.
    index("coding_agent_task_created").on(table.taskId, table.createdAt),
    // A workspace's agents with no task are read newest first.
    index("coding_agent_org_created").on(table.organizationId, table.createdAt),
    // An agent's summary names the agents started from it, read by the source's id.
    index("coding_agent_started_from_agent").on(sql`(${table.startedFrom}->>'agentId')`),
  ],
);

/**
 * One delegation of a coding agent's: the model and effort the agent chose
 * for the worker, keyed by the child conversation the worker's session is
 * recorded in, which is a function of the agent's conversation and the call
 * that started the worker (`@luke/database/models/ids`). The worker's own steps
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
