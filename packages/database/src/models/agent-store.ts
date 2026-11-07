import {
  AGENT_ARCHIVER,
  AGENT_AUTHOR,
  AGENT_BRIEF,
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentAuthor,
  type AgentBrief,
  type AgentKind,
  type AgentMachineKind,
  type AgentPayer,
  type AgentPullRequest,
  type AgentSource,
  type AgentSubagentTitle,
  agentPayerSchema,
  agentPullRequestSchema,
  agentSourceSchema,
  CONTEXT_WINDOW,
  type ContextWindow,
  contextWindowSchema,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { automationFiringSchema } from "@repo/features/automation-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import { INBOX_STATUS } from "@repo/features/inbox-wire";
import {
  integrationConnectionNameSchema,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import { READ_MARK, type ReadMark } from "@repo/features/read-mark";
import { type TaskStatus, taskStatusSchema } from "@repo/features/task-wire";
import { TURN_STATUS, type WireValue, WireValueSchema } from "@repo/wire";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  not,
  notExists,
  notInArray,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Exit, Option, Schema, SchemaTransformation } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, queryBuilder, type StoreFailure } from "../core/query.js";
import {
  agentDelegationTable,
  agentTable,
  type StoredAgentStep,
  type StoredArchive,
  type StoredAutomationOrigin,
  type StoredPublishedRead,
  type StoredPullRequest,
  type StoredStartedFrom,
} from "../schemas/agent.js";
import { agentPin } from "../schemas/agent-pin.js";
import { agentRead } from "../schemas/agent-read.js";
import { agentRepository } from "../schemas/agent-repository.js";
import { organization, user } from "../schemas/auth.js";
import { automationRun } from "../schemas/automation.js";
import { inboxItem } from "../schemas/inbox.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import {
  CONVERSATION_KIND,
  CONVERSATION_RUNTIME,
  type ConversationRuntime,
  MESSAGE_SENDER,
  messageSenderSchema,
} from "../storage-vocabulary.js";
import { agentAutomationNameSql, agentAutomationRunSql } from "./agent-name.js";
import { ArchivedByColumnSchema, InstantColumnSchema } from "./columns.js";
import { reopenAgentInboxItems, settleAgentInboxItems } from "./inbox-settle.js";
import {
  awaitingLinesOf,
  awaitingLinesOfReached,
  type LatestTurn,
  lastSettledTurnsOfReached,
  latestTurnsOf,
  latestTurnsOfReached,
  type TurnUsageRow,
  turnUsagesOf,
} from "./message-reads.js";
import { stampConversationsDeleted } from "./soft-delete.js";
import { TaskAgentUnstopped } from "./task-store.js";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  agentVisibleTo,
  reachableTask,
  taskReachableBy,
  workspaceReachableBy,
} from "./workspace-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * agent-store.ts -- the coding agents started on a workspace's tasks, each one conversation and one row linking it to its task.
 *
 * An agent belongs to its workspace, its task's or, for an agent an
 * automation started with no task, its own: every member reads, renames,
 * and re-chooses it, whichever of them started it. Every statement names the
 * account beside the task or the agent and gates on that account's
 * membership of that workspace (`workspace-store.ts`), so an agent of
 * a workspace the account is not in reads and starts exactly as an id that
 * names nothing. The one read keyed by the account alone is a Start's retry
 * key, which is the starter's own. Starting an agent is one transaction
 * under the task's own row lock: the lock is the membership check and what
 * serializes two Starts of one task, so a retry carrying the key of a Start
 * already made finds that agent rather than opening a second conversation
 * beside it, and says which it did, since only a Start that made the agent
 * opens its runtime session. The agent's conversation is a `coding_agent`
 * conversation of the account that started it, opened here and named on the
 * row, which carries that account as `userId`, so a member reads the
 * conversation under its starter; its messages and turns are the
 * relay's to write, and the newest turn is what the agent's status is read
 * from. A Start whose session could not be opened discards the agent
 * again, rows and conversation, so a retry under the same key starts afresh
 * rather than finding an agent nothing runs. The model, effort, and context
 * window on the row are read at every step, so a change to them is the next
 * step's. The
 * branch is the head of the pull request the agent opened, written as it
 * opens one (`coder-host/pull-request.ts`) and read where the agent's pull
 * request is looked up (`coder-host/published.ts`). A delegation is a child
 * conversation under the agent's, which `delegate` opened for an agent on the retired runtime
 * ahead of its worker's session with the model and effort the agent chose
 * for it written beside it here, so the tabs read the worker's transcript
 * under the agent's; the worker's title stands on its child conversation
 * (`child-titles.ts`) and is read back here by the call that delegated it,
 * which is kept on the delegation for that. The
 * title is written two ways: filled where none stands, which is how the
 * one generated as the agent starts lands without ever covering a name the
 * developer gave, and renamed, which replaces whatever stands. The newest
 * model step of the agent's own conversation and its harness's last compaction of
 * it are written by the runner events route as the harness tells them, and read back with
 * the transcript, which is what the tab's context ring draws. The pull
 * request from the agent's branch is written as GitHub answered each read
 * of it (`coder-host/published.ts`), and read back beside the agents of
 * every task the list names, so the list asks GitHub nothing, as the wire
 * carries it; the row keeps more than that, the head it was read at, when
 * it merged, and its lines by directory, read back whole by the next read
 * of it alone. An agent
 * the developer archived is a stamp on its row: every list leaves it out
 * but the task's own where it asks for archived agents, and a read of the
 * agent by its id still finds it, so its transcript and pull request stand.
 * A pin of an agent, on a plan or with none, is the reading member's own
 * (`agent-pin.ts`), as a plan's is, so one member's pin reads pinned for
 * them alone, and is kept apart from the archive, so an agent archived and
 * brought back is pinned again.
 * Who the agent writes as on GitHub is settled once, by its first session,
 * and a later session's word is answered with the one standing rather than
 * written over it; it is written over only where the developer's token was
 * refused as the service opened the agent's pull request, with why.
 * Every function is an effect over the ambient `SqlClient` and names no
 * database of its own.
 */

/** What a coding agent store operation answers: an effect over the ambient client, composed into whatever called it. */
export type AgentStoreEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** One coding agent as the service holds it: what the tabs read, and what the agent's own turns run on. */
export interface Agent {
  readonly id: string;
  /** The account that started the agent, whose conversation it runs in and whose provider key pays for it. */
  readonly userId: string;
  /** The task the agent works on; null for an agent an automation started with no task. */
  readonly taskId: string | null;
  /** The workspace the agent belongs to: its own, or its task's on a row the backfill has not reached. */
  readonly organizationId: string;
  /** The automation whose run started the agent; null for one started by hand or once that automation is deleted. */
  readonly automationId: string | null;
  /** The run of an automation that started the agent, as it stood then, kept once that automation is deleted; null for one started by hand. */
  readonly automationOrigin: StoredAutomationOrigin | null;
  /** The automation run the agent belongs to: the run that started it, or the run whose agent started it on no task; null for one no run owns, and once that run is deleted. */
  readonly automationRunId: string | null;
  /** The agent of the same plan this one was started from, with its replay's counts; null for one started afresh. */
  readonly startedFrom: StoredStartedFrom | null;
  /** What outside the app the agent was started from, a Slack message; null for one started in the app, and absent where a caller built the agent without it. */
  readonly source?: AgentSource | null;
  /** The account's coding agent whose `start_agent` started this one; null for any other starter, and once that agent's row is gone. */
  readonly startedByAgentId: string | null;
  readonly conversationId: string;
  readonly model: string;
  readonly effort: string;
  readonly contextWindow: ContextWindow;
  /** The description text the agent was handed; null where it was handed a prompt instead. */
  readonly descriptionSnapshot: string | null;
  /** The developer's words the agent was handed in the description's place; null where it was handed the description. */
  readonly prompt: string | null;
  /** The GitHub repository the agent works in, as `owner/name`; null for an agent with none, which does no repository work. */
  readonly repository: string | null;
  /** The branch checked out in the sandbox as the last turn ended; null before one ends or where the checkout stood detached. */
  readonly branch: string | null;
  /** The branch the agent's checkout is cloned at, as its starter named it; null for the repository's default branch. */
  readonly startBranch: string | null;
  /** The agent's title as its tab shows it; null falls back to the model's name. */
  readonly title: string | null;
  /** When the developer archived the agent; null while it is not. */
  readonly archivedAt: Date | null;
  /** Who archived the agent, and why; null while it is not, and for an archive no one was recorded for. */
  readonly archivedBy: StoredArchive | null;
  /** The MCP servers switched off for this agent, which its next turns are not handed; empty where none is. */
  readonly disabledServers: readonly string[];
  /** Who the agent's commits are by and its pull request is opened as; null until its first session settles it. */
  readonly author: AgentAuthor | null;
  /** How its repository was reached as it started: the workspace's GitHub App, or its starter's own token. */
  readonly githubAccess: GitHubAccess;
  /** What the agent is: a coder, or a task's pilot. */
  readonly kind: AgentKind;
  readonly createdAt: Date;
  /** Where its runner runs: a Vercel Sandbox, or its starter's Mac; a Vercel Sandbox where unsaid. */
  readonly machine?: AgentMachineKind;
  /** The Mac a local agent is pinned to; null for one in a sandbox, or once that Mac is gone. */
  readonly deviceId?: string | null;
}

/**
 * One coding agent as a list line reads it (`AGENT_LINE_COLUMNS`):
 * the agent without what it was handed, the description's text or the developer's
 * prompt, and without the run that started it, which only its own page and
 * its own turns read; which of the two it was handed, or neither, which its
 * tab's brief is drawn from, and its automation's name stand in their place.
 */
export interface AgentLine
  extends Omit<Agent, "automationOrigin" | "descriptionSnapshot" | "prompt"> {
  /** The name of the automation whose run started the agent, as it stood then; null for one started by hand. */
  readonly automationName: string | null;
  /** What the agent was handed as its first message: the description, the developer's prompt, or nothing, for one started blank. */
  readonly brief: AgentBrief;
}

/** One agent with no plan as the sidebar lists it for its reader: the agent's line, when the reader pinned it, and where they dragged the pin; null where they hold no pin of it, or it stands by that instant. Beside it, the reader's read mark: the instant they read it through, and whether they marked it unread. */
export interface TasklessAgentRow extends AgentLine {
  readonly pinnedAt: Date | null;
  readonly pinPosition: string | null;
  readonly readThrough: Date;
  readonly markedUnread: boolean;
}

/** What a Start answered: the agent, and whether this Start made it or a retry found it. */
export interface AgentStarted {
  readonly agent: Agent;
  readonly created: boolean;
  /** The transaction the agent's row was written in, where this Start wrote it. */
  readonly txid?: string;
}

/** The newest turn of an agent's conversation, as its status is read from it; nothing before the first turn. The read is the store's own (`message-reads.ts`), re-exported here beside the agents it is read for. */
export type AgentLatestTurn = LatestTurn;
export {
  awaitingLinesOf,
  awaitingLinesOfReached,
  lastSettledTurnsOfReached,
  latestTurnsOf,
  latestTurnsOfReached,
  type TurnUsageRow,
  turnUsagesOf,
};

/** An agent, or a line of one, that works in a repository: every agent that does repository work, its checkout, its pull request, and its reach on GitHub, is one. */
export type WithRepository<A extends { readonly repository: string | null }> = A & {
  readonly repository: string;
};

/** Whether the agent works in a repository; one with none does no repository work. */
export function hasRepository<A extends { readonly repository: string | null }>(
  agent: A,
): agent is WithRepository<A> {
  return agent.repository !== null;
}

/** What a Start hands the agent as its first message: the description's text as it stands now, the developer's prompt in its place, or nothing for an agent started blank, whose first words come later. */
export type AgentBriefText =
  | { readonly descriptionSnapshot: string; readonly prompt: null }
  | { readonly descriptionSnapshot: null; readonly prompt: string }
  | { readonly descriptionSnapshot: null; readonly prompt: null };

/**
 * Where a Start puts the agent: on a task, whose workspace it joins and
 * whose text or the developer's prompt it is handed, a coder or the task's
 * pilot; or in a workspace with no task, as an automation's run puts one,
 * handed a prompt, since there is no description to hand it.
 */
export type AgentPlace =
  | (AgentBriefText & {
      readonly taskId: string;
      readonly organizationId?: undefined;
      readonly kind?: typeof AGENT_KIND.CODER | typeof AGENT_KIND.PILOT | undefined;
    })
  | {
      readonly taskId: null;
      readonly organizationId: string;
      readonly descriptionSnapshot: null;
      readonly prompt: string;
      readonly kind?: typeof AGENT_KIND.CODER | undefined;
    };

/** A Start: where it goes, the request's own key, what to run on, what the agent is handed, and the repository as it stands now. */
export type NewAgent = AgentPlace & {
  /** The automation whose run starts the agent; none for one started by hand. */
  readonly automationId?: string | undefined;
  /** That automation's run as it starts the agent; none for one started by hand. */
  readonly automationOrigin?: StoredAutomationOrigin | undefined;
  /** The automation run the agent belongs to; none for one no run owns. */
  readonly automationRunId?: string | undefined;
  /** The agent of the same plan this one is started from, with its replay's counts; none for one started afresh. */
  readonly startedFrom?: StoredStartedFrom | undefined;
  /** What outside the app starts the agent, a Slack message; none for a Start in the app. */
  readonly source?: AgentSource | undefined;
  /** The coding agent whose `start_agent` starts this one; none for a Start by a member, the brain, or an automation. */
  readonly startedByAgentId?: string | undefined;
  /** The pilot this one continues, whose unarchived agents of the account now report to this one; none for any other Start. */
  readonly takesOverFrom?: string | undefined;
  /** The agent's title from the start, a run's fixed name; none where it is named later. */
  readonly title?: string | undefined;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly effort: string;
  /** The model's whole window, the long one, where the Start names none. */
  readonly contextWindow?: ContextWindow | undefined;
  /** The repository the agent works in; null for one with none. */
  readonly repository: string | null;
  /** The branch the agent's checkout is cloned at; none for the repository's default branch. */
  readonly startBranch?: string | undefined;
  /** The repositories the agent works in beside its own, in the order the Start named them; none for an agent in one or none. */
  readonly extraRepositories?: readonly NewAgentRepository[] | undefined;
  /** The MCP servers the draft switched off before it started; none where the Start names none. */
  readonly disabledServers?: readonly string[] | undefined;
  /** The MCP servers the prompt mentions, which the first turn is handed whatever the switches say; none where it mentions none. */
  readonly mentionedServers?: readonly string[] | undefined;
  /** How the repository was reached for the Start; the App's where none is named. */
  readonly githubAccess?: GitHubAccess | undefined;
  /** What answers the agent's conversation. */
  readonly runtime: ConversationRuntime;
  /** Who pays for the agent's model calls; none recorded where none is named. */
  readonly payer?: AgentPayer | undefined;
  /** Where its runner runs; a Vercel Sandbox where none is named. */
  readonly machine?: AgentMachineKind | undefined;
  /** The account's Mac a local agent is pinned to; none for one in a sandbox. */
  readonly deviceId?: string | undefined;
};

/** A repository a Start names for the agent beside its own: `owner/name` as reached, and the branch its checkout is cloned at, none for its default branch. */
export interface NewAgentRepository {
  readonly repository: string;
  readonly baseBranch?: string | undefined;
}

/**
 * How an agent is run, as its rows hold it: what answers its conversation,
 * the retired runtime for a conversation from before the column, the harness's own session
 * or thread id, the digest of its runner's bearer, and who pays for it.
 */
export interface AgentRouting {
  readonly runtime: ConversationRuntime;
  /** The harness's session or thread id; null on the retired runtime and before the harness answers one. */
  readonly nativeSession: string | null;
  /** The digest of the runner's bearer at our MCP server; null where no runner holds one. */
  readonly runnerTokenHash: string | null;
  /** Who pays for the agent's model calls; null for an agent from before the column. */
  readonly payer: AgentPayer | null;
}

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const AGENT_COLUMNS = {
  id: agentTable.id,
  userId: agentTable.userId,
  taskId: agentTable.taskId,
  organizationId: AGENT_WORKSPACE,
  automationId: agentTable.automationId,
  automationOrigin: agentTable.automationOrigin,
  automationRunId: agentTable.automationRunId,
  startedFrom: agentTable.startedFrom,
  source: agentTable.source,
  startedByAgentId: agentTable.startedByAgentId,
  conversationId: agentTable.conversationId,
  model: agentTable.model,
  effort: agentTable.effort,
  contextWindow: agentTable.contextWindow,
  descriptionSnapshot: agentTable.descriptionSnapshot,
  prompt: agentTable.prompt,
  repository: agentTable.repository,
  branch: agentTable.branch,
  startBranch: agentTable.startBranch,
  title: agentTable.title,
  archivedAt: agentTable.archivedAt,
  archivedBy: agentTable.archivedBy,
  disabledServers: agentTable.disabledServers,
  author: agentTable.author,
  githubAccess: agentTable.githubAccess,
  kind: agentTable.kind,
  createdAt: agentTable.createdAt,
  machine: agentTable.machine,
  deviceId: agentTable.deviceId,
};

/**
 * The columns a list line projects (`AgentLine`): every one of
 * `AGENT_COLUMNS` but the description's text, the prompt, and the run that
 * started the agent, whose prompt and webhook body it carries, with whether
 * a prompt was handed and the run's automation name read in their place.
 * Note that the lists read these, because they read every agent of every
 * listed task on every refresh, and the text columns are the bulk of a row.
 */
const AGENT_LINE_COLUMNS = {
  id: agentTable.id,
  userId: agentTable.userId,
  taskId: agentTable.taskId,
  organizationId: AGENT_WORKSPACE,
  automationId: agentTable.automationId,
  automationName: agentAutomationNameSql(agentTable),
  automationRunId: agentTable.automationRunId,
  startedFrom: agentTable.startedFrom,
  source: agentTable.source,
  startedByAgentId: agentTable.startedByAgentId,
  conversationId: agentTable.conversationId,
  model: agentTable.model,
  effort: agentTable.effort,
  contextWindow: agentTable.contextWindow,
  brief: sql<AgentBrief>`case
    when ${agentTable.prompt} is not null then ${AGENT_BRIEF.PROMPT}
    when ${agentTable.descriptionSnapshot} is not null then ${AGENT_BRIEF.DESCRIPTION}
    else ${AGENT_BRIEF.BLANK}
  end`,
  repository: agentTable.repository,
  branch: agentTable.branch,
  startBranch: agentTable.startBranch,
  title: agentTable.title,
  archivedAt: agentTable.archivedAt,
  archivedBy: agentTable.archivedBy,
  disabledServers: agentTable.disabledServers,
  author: agentTable.author,
  githubAccess: agentTable.githubAccess,
  kind: agentTable.kind,
  createdAt: agentTable.createdAt,
  machine: agentTable.machine,
  deviceId: agentTable.deviceId,
} as const;

/** What an agent was handed as its first message, as `AGENT_LINE_COLUMNS` reads it from the row: its prompt, else the description, else nothing. */
export function agentBriefOf(agent: Pick<Agent, "descriptionSnapshot" | "prompt">): AgentBrief {
  if (agent.prompt !== null) return AGENT_BRIEF.PROMPT;
  return agent.descriptionSnapshot === null ? AGENT_BRIEF.BLANK : AGENT_BRIEF.DESCRIPTION;
}

/** The line a full read of an agent draws, as `AGENT_LINE_COLUMNS` reads it from the row. */
export function agentLineOf(agent: Agent): AgentLine {
  const {
    automationOrigin,
    descriptionSnapshot: _descriptionSnapshot,
    prompt: _prompt,
    ...line
  } = agent;
  return {
    ...line,
    automationName: automationOrigin?.name ?? null,
    brief: agentBriefOf(agent),
  };
}

/**
 * The `disabled_servers` column as an agent reads it: connection names
 * (`notion`, `notion-2`), null for none, and a name of a provider no longer
 * offered is left out rather than failing the row, so a provider retired
 * from the list never takes an agent's reads down with it. A name stored
 * before a second account was possible is the provider's own, which is its
 * first account's.
 */
const DisabledServersColumnSchema = Schema.NullOr(Schema.Array(Schema.String)).pipe(
  Schema.decodeTo(
    Schema.Array(integrationConnectionNameSchema),
    SchemaTransformation.transform({
      decode: (stored): readonly string[] =>
        (stored ?? []).filter((name) => integrationConnectionOf(name) !== undefined),
      encode: (servers): readonly string[] | null => servers,
    }),
  ),
);

/** The column as a write stores it: each connection once, and null for none, which is what a row from before the column reads as. */
function storedServers(servers: readonly string[]): readonly string[] | null {
  return servers.length === 0 ? null : [...new Set(servers)];
}

/** The `automation_origin` column as a row holds it. */
const AutomationOriginColumnSchema = Schema.NullOr(
  Schema.Struct({
    name: Schema.String,
    firing: automationFiringSchema,
    prompt: Schema.String,
    body: Schema.optionalKey(Schema.String),
  }),
);
/** The `started_from` column as a row holds it. */
const StartedFromColumnSchema = Schema.NullOr(
  Schema.Struct({
    agentId: Schema.String,
    messageId: Schema.optionalKey(Schema.String),
    messageSteps: Schema.optionalKey(Schema.Number),
    messageStepParts: Schema.optionalKey(Schema.Number),
    steps: Schema.Number,
    totalSteps: Schema.Number,
    branch: Schema.optionalKey(Schema.String),
    sandbox: Schema.optionalKey(Schema.String),
    session: Schema.optionalKey(Schema.String),
  }),
);
/** An author as the agent's row holds it. */
const AuthorColumnSchema = Schema.Literals(Object.values(AGENT_AUTHOR));

const AgentRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationOrigin: AutomationOriginColumnSchema,
  automationRunId: Schema.NullOr(Schema.String),
  startedFrom: StartedFromColumnSchema,
  source: Schema.NullOr(agentSourceSchema),
  startedByAgentId: Schema.NullOr(Schema.String),
  conversationId: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  contextWindow: contextWindowSchema,
  descriptionSnapshot: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  startBranch: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  archivedBy: ArchivedByColumnSchema,
  disabledServers: DisabledServersColumnSchema,
  author: Schema.NullOr(AuthorColumnSchema),
  githubAccess: Schema.Literals(Object.values(GITHUB_ACCESS)),
  kind: Schema.Literals(Object.values(AGENT_KIND)),
  createdAt: InstantColumnSchema,
  machine: Schema.Literals(Object.values(AGENT_MACHINE)),
  deviceId: Schema.NullOr(Schema.String),
});

const {
  automationOrigin: _automationOrigin,
  descriptionSnapshot: _descriptionSnapshot,
  prompt: _prompt,
  ...LINE_ROW_FIELDS
} = AgentRowSchema.fields;

/** An agent's row as a list line reads it (`AGENT_LINE_COLUMNS`). */
const AgentLineRowSchema = Schema.Struct({
  ...LINE_ROW_FIELDS,
  automationName: Schema.NullOr(Schema.String),
  brief: Schema.Literals(Object.values(AGENT_BRIEF)),
});

/** An agent's line with the reader's own pin beside it; null where they hold none. */
const TasklessAgentRowSchema = Schema.Struct({
  ...AgentLineRowSchema.fields,
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  pinPosition: Schema.NullOr(Schema.String),
  readThrough: InstantColumnSchema,
  markedUnread: Schema.Boolean,
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** The agent under this id, where the account is a member of its workspace; any other id reads as no agent. */
function reachableAgent(userId: string, agentId: string): SQL | undefined {
  return and(eq(agentTable.id, agentId), agentReachableBy(userId));
}

/** The task row under its own lock, where the account is a member of its workspace. */
const lockReachableTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, organizationId: task.organizationId })
        .from(task)
        .where(reachableTask(userId, taskId))
        .for("update"),
    ),
});

/** The workspace, locked, where the account is a member of it: the lock serializes two Starts in it under one key, as the task's own lock does for a task. */
const lockReachableWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: organization.id })
        .from(organization)
        .where(
          and(eq(organization.id, organizationId), workspaceReachableBy(userId, organization.id)),
        )
        .for("update"),
    ),
});

/** The workspace a Start puts its agent in, locked: the task's, or the workspace named; nothing where the account reaches neither. */
const lockedPlace = Effect.fnUntraced(function* (userId: string, place: AgentPlace) {
  if (place.taskId === null) {
    const reached = yield* lockReachableWorkspace({ userId, organizationId: place.organizationId });
    return Option.map(reached, (workspace) => ({ organizationId: workspace.id }));
  }
  return yield* lockReachableTask({ userId, taskId: place.taskId });
});

const findAgentByKey = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    idempotencyKey: Schema.String,
  }),
  Result: AgentRowSchema,
  execute: ({ userId, idempotencyKey }) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .where(and(eq(agentTable.userId, userId), eq(agentTable.idempotencyKey, idempotencyKey)))
        .limit(1),
    ),
});

/** Where an agent runs, as a Start naming no place reads it off the account's newest agent on its task. */
const AgentPlaceRowSchema = Schema.Struct({
  machine: Schema.Literals(Object.values(AGENT_MACHINE)),
  deviceId: Schema.NullOr(Schema.String),
});

const findNewestAgentPlace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: AgentPlaceRowSchema,
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ machine: agentTable.machine, deviceId: agentTable.deviceId })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.userId, userId),
            eq(agentTable.taskId, taskId),
            not(agentAutomationRunSql(agentTable)),
          ),
        )
        .orderBy(desc(agentTable.createdAt), desc(agentTable.id))
        .limit(1),
    ),
});

const findOwnAgentId = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId))),
    ),
});

/** The pilots that took over from the agent before, by continuing it. */
const earlierPilot = alias(agentTable, "earlier_pilot");

/**
 * The account's unarchived agents a pilot started, or any pilot that took
 * over from it before, moved to the one that takes over from it now. Note
 * that the earlier pilots' are moved too, because a pilot continued again
 * is taken over by its latest continue, which its agents report to.
 */
const updateTakenOver = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, from: Schema.String, to: Schema.String }),
  execute: ({ userId, from, to }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ startedByAgentId: to })
        .where(
          and(
            or(
              eq(agentTable.startedByAgentId, from),
              inArray(
                agentTable.startedByAgentId,
                db
                  .select({ id: earlierPilot.id })
                  .from(earlierPilot)
                  .where(
                    and(
                      eq(earlierPilot.kind, AGENT_KIND.PILOT),
                      sql`${earlierPilot.startedFrom} ->> 'agentId' = ${from}`,
                      sql`${earlierPilot.startedFrom} ->> 'messageId' is null`,
                    ),
                  ),
              ),
            ),
            eq(agentTable.userId, userId),
            isNull(agentTable.archivedAt),
          ),
        ),
    ),
});

/** The account's unarchived agents one agent started, moved to another as their starter. */
const updateStartedBy = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, from: Schema.String, to: Schema.String }),
  execute: ({ userId, from, to }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ startedByAgentId: to })
        .where(
          and(
            eq(agentTable.startedByAgentId, from),
            eq(agentTable.userId, userId),
            isNull(agentTable.archivedAt),
          ),
        ),
    ),
});

/**
 * The starter a Start records: the account's own agent under the id it
 * names, and none for no id or another account's agent. Note that only the
 * account's own agent is recorded, because the starter is told how this
 * agent's run ends, and no account's agent is told of another's.
 */
const ownStarterOf = Effect.fnUntraced(function* (userId: string, agentId: string | undefined) {
  if (agentId === undefined) return null;
  const own = yield* findOwnAgentId({ userId, agentId });
  return Option.isSome(own) ? own.value.id : null;
});

/** A runtime as a conversation's row holds it. */
const RuntimeColumnSchema = Schema.Literals(Object.values(CONVERSATION_RUNTIME));
/** A payer as the agent's row holds it. */
const PayerColumnSchema = agentPayerSchema;

const insertAgentConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, runtime: RuntimeColumnSchema, now: Schema.Date }),
  Result: IdRowSchema,
  execute: ({ userId, runtime, now }) =>
    Database.use((db) =>
      db
        .insert(conversations)
        .values({
          userId,
          kind: CONVERSATION_KIND.AGENT,
          runtime,
          createdAt: now,
          lastActivityAt: now,
        })
        .returning({ id: conversations.id }),
    ),
});

/**
 * The id of the transaction a write committed in, read in the write's own
 * `RETURNING`, as Neon's mutations guide says, so a client following the
 * task list waits for that transaction to arrive before it confirms the
 * write.
 */
const TXID = sql<string>`pg_current_xact_id()::text`;

/** An agent's row as a write returned it, with the transaction it committed in. */
const CommittedAgentRowSchema = Schema.Struct({
  ...AgentRowSchema.fields,
  txid: Schema.String,
});

/** The transaction a pin's write committed in; none where the pin stood as asked already. */
const TxidRowSchema = Schema.Struct({ txid: Schema.String });

/**
 * The task's pilot standing unarchived, any but the one named, by the task's
 * id alone: a pilot is the task's whoever started it and whoever asks, so no
 * reader's reach narrows it, and a caller has reached the task before asking.
 */
const findLivePilot = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String, besides: Schema.NullOr(Schema.String) }),
  Result: IdRowSchema,
  execute: ({ taskId, besides }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.taskId, taskId),
            eq(agentTable.kind, AGENT_KIND.PILOT),
            isNull(agentTable.archivedAt),
            besides === null ? undefined : ne(agentTable.id, besides),
          ),
        )
        .limit(1),
    ),
});

const insertAgent = SqlSchema.findOne({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    taskId: Schema.NullOr(Schema.String),
    organizationId: Schema.String,
    automationId: Schema.NullOr(Schema.String),
    automationOrigin: AutomationOriginColumnSchema,
    automationRunId: Schema.NullOr(Schema.String),
    startedFrom: StartedFromColumnSchema,
    source: Schema.NullOr(agentSourceSchema),
    startedByAgentId: Schema.NullOr(Schema.String),
    title: Schema.NullOr(Schema.String),
    idempotencyKey: Schema.String,
    model: Schema.String,
    effort: Schema.String,
    contextWindow: contextWindowSchema,
    descriptionSnapshot: Schema.NullOr(Schema.String),
    prompt: Schema.NullOr(Schema.String),
    repository: Schema.NullOr(Schema.String),
    startBranch: Schema.NullOr(Schema.String),
    disabledServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
    mentionedServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
    githubAccess: Schema.Literals(Object.values(GITHUB_ACCESS)),
    payer: Schema.NullOr(PayerColumnSchema),
    kind: Schema.Literals(Object.values(AGENT_KIND)),
    machine: Schema.Literals(Object.values(AGENT_MACHINE)),
    deviceId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: CommittedAgentRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(agentTable)
        .values({
          userId: write.userId,
          taskId: write.taskId,
          organizationId: write.organizationId,
          automationId: write.automationId,
          automationOrigin: write.automationOrigin,
          automationRunId: write.automationRunId,
          startedFrom: write.startedFrom,
          source: write.source,
          startedByAgentId: write.startedByAgentId,
          title: write.title,
          conversationId: write.conversationId,
          model: write.model,
          effort: write.effort,
          contextWindow: write.contextWindow,
          descriptionSnapshot: write.descriptionSnapshot,
          prompt: write.prompt,
          repository: write.repository,
          startBranch: write.startBranch,
          disabledServers: write.disabledServers,
          mentionedServers: write.mentionedServers,
          githubAccess: write.githubAccess,
          payer: write.payer,
          kind: write.kind,
          machine: write.machine,
          deviceId: write.deviceId,
          idempotencyKey: write.idempotencyKey,
          createdAt: write.now,
        })
        .returning({ ...AGENT_COLUMNS, txid: TXID }),
    ),
});

/** The extra repositories a Start names, at positions 1 and on, written beside the agent in its transaction. */
const insertAgentRepositories = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    repositories: Schema.Array(
      Schema.Struct({ repository: Schema.String, baseBranch: Schema.NullOr(Schema.String) }),
    ),
  }),
  execute: ({ agentId, repositories }) =>
    Database.use((db) =>
      db.insert(agentRepository).values(
        repositories.map((extra, index) => ({
          agentId,
          position: index + 1,
          repository: extra.repository,
          baseBranch: extra.baseBranch,
        })),
      ),
    ),
});

const updateAgentChoiceRow = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    model: Schema.String,
    effort: Schema.String,
    contextWindow: contextWindowSchema,
  }),
  Result: CommittedAgentRowSchema,
  execute: ({ userId, agentId, model, effort, contextWindow }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ model, effort, contextWindow })
        .where(reachableAgent(userId, agentId))
        .returning({ ...AGENT_COLUMNS, txid: TXID }),
    ),
});

const updateAgentServersRow = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    disabledServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
  }),
  Result: CommittedAgentRowSchema,
  execute: ({ userId, agentId, disabledServers }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ disabledServers })
        .where(reachableAgent(userId, agentId))
        .returning({ ...AGENT_COLUMNS, txid: TXID }),
    ),
});

/** The agent of a conversation under its own lock, as far as a turn taking its mentioned servers reads it. */
const lockAgentMentionedServers = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, mentionedServers: DisabledServersColumnSchema }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id, mentionedServers: agentTable.mentionedServers })
        .from(agentTable)
        .where(and(eq(agentTable.conversationId, conversationId), agentReachableBy(userId)))
        .limit(1)
        .for("update"),
    ),
});

/** The agent as far as a send adding to its mentioned servers reads it. */
const readReachableMentionedServers = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, mentionedServers: DisabledServersColumnSchema }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id, mentionedServers: agentTable.mentionedServers })
        .from(agentTable)
        .where(reachableAgent(userId, agentId)),
    ),
});

const MentionedServersChangeSchema = Schema.Struct({
  agentId: Schema.String,
  names: Schema.Array(integrationConnectionNameSchema),
});

/** How far past those standing an added name's place is counted, so it sorts after them; no agent is mentioned this many servers. */
const ADDED_AFTER = 1_000_000;

/** The agent's mentioned servers as they stand, each with its place, in the statement that changes them. */
const STANDING_SERVERS = sql`jsonb_array_elements_text(coalesce(${agentTable.mentionedServers}, '[]'::jsonb)) with ordinality as stood(name, place)`;

/**
 * Adds the names to the agent's mentioned servers in the one statement,
 * after those standing and each once, so nothing a turn took meanwhile is
 * written back.
 */
const addMentionedServers = SqlSchema.void({
  Request: MentionedServersChangeSchema,
  execute: ({ agentId, names }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({
          mentionedServers: sql`(select jsonb_agg(merged.name order by merged.place) from (select every.name, min(every.place) as place from (select stood.name, stood.place from ${STANDING_SERVERS} union all select added.name, added.place + ${ADDED_AFTER} from jsonb_array_elements_text(${JSON.stringify(names)}::jsonb) with ordinality as added(name, place)) as every group by every.name) as merged)`,
        })
        .where(eq(agentTable.id, agentId)),
    ),
});

/** Takes the names out of the agent's mentioned servers in the one statement, leaving every other as it now stands, none as none. */
const removeMentionedServers = SqlSchema.void({
  Request: MentionedServersChangeSchema,
  execute: ({ agentId, names }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({
          mentionedServers: sql`(select jsonb_agg(stood.name order by stood.place) from ${STANDING_SERVERS} where not exists (select 1 from jsonb_array_elements_text(${JSON.stringify(names)}::jsonb) as gone(name) where gone.name = stood.name))`,
        })
        .where(eq(agentTable.id, agentId)),
    ),
});

const setAgentMentionedServers = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    mentionedServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
  }),
  execute: ({ agentId, mentionedServers }) =>
    Database.use((db) =>
      db.update(agentTable).set({ mentionedServers }).where(eq(agentTable.id, agentId)),
    ),
});

const updateAgentBranchRow = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    branch: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, agentId, branch }) =>
    Database.use((db) =>
      db.update(agentTable).set({ branch }).where(reachableAgent(userId, agentId)),
    ),
});

const markTurnFastRefused = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, turnId: Schema.String }),
  execute: ({ userId, turnId }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ fastRefused: true })
        .where(and(eq(turns.userId, userId), eq(turns.id, turnId))),
    ),
});

/** The turn a reservation of description notes is held against, as the subquery of the update names it apart from the row it updates. */
const runningTurn = alias(turns, "running_turn");

const reserveTurnNotes = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    requested: Schema.Int,
  }),
  Result: Schema.Struct({ turnId: Schema.String, taken: Schema.Int }),
  execute: ({ userId, conversationId, requested }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({ descriptionNotesTaken: sql`${turns.descriptionNotesTaken} + ${requested}` })
        .where(
          and(
            eq(turns.userId, userId),
            inArray(
              turns.id,
              db
                .select({ id: runningTurn.id })
                .from(runningTurn)
                .where(
                  and(
                    eq(runningTurn.userId, userId),
                    eq(runningTurn.conversationId, conversationId),
                    eq(runningTurn.status, TURN_STATUS.RUNNING),
                  ),
                )
                .orderBy(desc(runningTurn.queuedAt), desc(runningTurn.id))
                .limit(1),
            ),
          ),
        )
        .returning({ turnId: turns.id, taken: turns.descriptionNotesTaken }),
    ),
});

const releaseTurnNotes = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, turnId: Schema.String, released: Schema.Int }),
  execute: ({ userId, turnId, released }) =>
    Database.use((db) =>
      db
        .update(turns)
        .set({
          descriptionNotesTaken: sql`greatest(0, ${turns.descriptionNotesTaken} - ${released})`,
        })
        .where(and(eq(turns.userId, userId), eq(turns.id, turnId))),
    ),
});

const updateAgentTitle = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    title: Schema.NullOr(Schema.String),
  }),
  Result: CommittedAgentRowSchema,
  execute: ({ userId, agentId, title }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ title })
        .where(reachableAgent(userId, agentId))
        .returning({ ...AGENT_COLUMNS, txid: TXID }),
    ),
});

/**
 * The agent archived where it stands unarchived and its conversation's
 * lines have run no further than `seenSeq`, so an agent a message woke
 * after the caller read it is left standing.
 */
/**
 * An agent with no pull request open or in draft, as GitHub last answered:
 * what an archive the developer did not ask for waits on, since an archived
 * agent is woken by no review, comment, or check on its pull request.
 */
export const noOpenPullRequest: SQL = notInArray(
  sql`coalesce(${agentTable.published}->>'state', '')`,
  [PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.DRAFT],
);

/**
 * An agent holding no inbox item open: what an archive the developer did not
 * ask for waits on too, since an archive would settle the question or the
 * notice the agent is waiting on.
 */
export const noOpenInboxItem: SQL = notExists(
  queryBuilder
    .select({ one: inboxItem.id })
    .from(inboxItem)
    .where(and(eq(inboxItem.agentId, agentTable.id), eq(inboxItem.status, INBOX_STATUS.OPEN))),
);

const updateUnmovedArchived = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    seenSeq: Schema.Number,
    archivedAt: Schema.Date,
    archivedBy: ArchivedByColumnSchema,
  }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, seenSeq, archivedAt, archivedBy }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ archivedAt, archivedBy })
        .where(
          and(
            reachableAgent(userId, agentId),
            isNull(agentTable.archivedAt),
            // Note that a pull request reopened or an inbox item posted since the read moves no line, so both are read again here.
            noOpenPullRequest,
            noOpenInboxItem,
            exists(
              queryBuilder
                .select({ one: conversations.id })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, agentTable.conversationId),
                    eq(conversations.nextMessageSeq, seenSeq),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: agentTable.id }),
    ),
});

/**
 * The task the agent works on, locked against its status changing until
 * the caller commits, as bringing the agent back takes it before the
 * agent's own row: the order a task's write takes the two in, so an
 * unarchive and a task moved off Done never wait on each other in a cycle,
 * while each still sees the other's settle (`inbox-settle.ts`).
 */
const lockAgentTask = SqlSchema.void({
  Request: Schema.String,
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ id: task.id })
        .from(task)
        .where(
          inArray(
            task.id,
            db.select({ id: agentTable.taskId }).from(agentTable).where(eq(agentTable.id, agentId)),
          ),
        )
        .for("share"),
    ),
});

const updateAgentArchived = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    archivedAt: Schema.NullOr(Schema.Date),
    archivedBy: ArchivedByColumnSchema,
  }),
  Result: CommittedAgentRowSchema,
  execute: ({ userId, agentId, archivedAt, archivedBy }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ archivedAt, archivedBy })
        .where(reachableAgent(userId, agentId))
        .returning({ ...AGENT_COLUMNS, txid: TXID }),
    ),
});

const fillAgentTitleRows = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, title: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, title }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ title })
        .where(and(reachableAgent(userId, agentId), isNull(agentTable.title)))
        .returning({ id: agentTable.id }),
    ),
});

const settleAgentAuthorRow = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    author: AuthorColumnSchema,
  }),
  Result: Schema.Struct({ author: AuthorColumnSchema }),
  execute: ({ userId, agentId, author }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        // Note that the author standing is kept, so the first session's word is the agent's for good.
        .set({ author: sql`coalesce(${agentTable.author}, ${author})` })
        .where(reachableAgent(userId, agentId))
        .returning({ author: agentTable.author }),
    ),
});

const updateAgentAuthor = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    author: AuthorColumnSchema,
  }),
  execute: ({ userId, agentId, author }) =>
    Database.use((db) =>
      db.update(agentTable).set({ author }).where(reachableAgent(userId, agentId)),
    ),
});

const findAgentRouting = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({
    runtime: Schema.NullOr(RuntimeColumnSchema),
    nativeSession: Schema.NullOr(Schema.String),
    runnerTokenHash: Schema.NullOr(Schema.String),
    payer: Schema.NullOr(PayerColumnSchema),
  }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          runtime: conversations.runtime,
          nativeSession: conversations.nativeSession,
          runnerTokenHash: agentTable.runnerTokenHash,
          payer: agentTable.payer,
        })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(reachableAgent(userId, agentId))
        .limit(1),
    ),
});

const findVisibleAgentWorkspace = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ organizationId: agentTable.organizationId })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentVisibleTo(userId)))
        .limit(1),
    ),
});

/** The agent's conversation, where the account reaches the agent, as a write to the conversation's own columns picks it. */
function reachableAgentConversation(userId: string, agentId: string): SQL {
  return inArray(
    conversations.id,
    queryBuilder
      .select({ id: agentTable.conversationId })
      .from(agentTable)
      .where(reachableAgent(userId, agentId)),
  );
}

const updateAgentNativeSession = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    nativeSession: Schema.String,
  }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, nativeSession }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeSession })
        .where(reachableAgentConversation(userId, agentId))
        .returning({ id: conversations.id }),
    ),
});

const findNativeHanded = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ handed: Schema.NullOr(WireValueSchema) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ handed: conversations.nativeHanded })
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

const updateNativeHanded = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    handed: WireValueSchema,
  }),
  execute: ({ userId, conversationId, handed }) =>
    Database.use((db) =>
      db
        .update(conversations)
        .set({ nativeHanded: handed })
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

/**
 * The coding agent's conversation whose runner holds the bearer of this
 * digest, read with no account in hand, because the digest is what admits
 * the runner; a deleted conversation is found by none.
 */
const findRunnerTokenConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ runnerTokenHash: Schema.String }),
  Result: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    runtimeSessionId: Schema.NullOr(Schema.String),
  }),
  execute: ({ runnerTokenHash }) =>
    Database.use((db) =>
      db
        .select({
          userId: conversations.userId,
          conversationId: conversations.id,
          runtimeSessionId: conversations.runtimeSessionId,
        })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(
          and(
            eq(agentTable.runnerTokenHash, runnerTokenHash),
            eq(conversations.kind, CONVERSATION_KIND.AGENT),
            isNull(conversations.deletedAt),
          ),
        )
        .limit(1),
    ),
});

/** The runtimes whose sandbox we open ourselves, with a runner in it: the native harnesses. */
const NATIVE_RUNTIMES = [CONVERSATION_RUNTIME.CLAUDE_CODE, CONVERSATION_RUNTIME.CODEX] as const;

/** The turn statuses a turn ends in; a queued or running one has not ended. */
export const ENDED_TURN_STATUSES = [
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELED,
  TURN_STATUS.FAILED,
] as const;

/** A sandbox's agent id as its tag spells it, before a query takes it as a `uuid`. */
const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * The conversation of the agent under this id, where it stands undeleted on a
 * native harness, read with no account in hand, because the sweep that asks
 * acts for every account at once.
 */
const findNativeAgentConversations = SqlSchema.findAll({
  Request: Schema.Struct({ agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    agentId: Schema.String,
    conversationId: Schema.String,
    userId: Schema.String,
  }),
  execute: ({ agentIds }) =>
    Database.use((db) =>
      db
        .select({
          agentId: agentTable.id,
          conversationId: conversations.id,
          userId: agentTable.userId,
        })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(
          and(
            inArray(agentTable.id, [...agentIds]),
            inArray(conversations.runtime, [...NATIVE_RUNTIMES]),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

/**
 * The native runtime of each conversation named that runs on one, read with
 * no account in hand: only for ids a gate already read, as
 * `latestTurnsOfReached`, such as the agents a member's workspace reaches.
 */
const findNativeRuntimes = SqlSchema.findAll({
  Request: Schema.Struct({ conversationIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    conversationId: Schema.String,
    runtime: Schema.Literals(NATIVE_RUNTIMES),
  }),
  execute: ({ conversationIds }) =>
    Database.use((db) =>
      db
        .select({ conversationId: conversations.id, runtime: conversations.runtime })
        .from(conversations)
        .where(
          and(
            inArray(conversations.id, [...conversationIds]),
            inArray(conversations.runtime, [...NATIVE_RUNTIMES]),
          ),
        ),
    ),
});

const findNativeRoute = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: Schema.Struct({
    runtime: Schema.Literals(NATIVE_RUNTIMES),
    payer: Schema.NullOr(PayerColumnSchema),
  }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ runtime: conversations.runtime, payer: agentTable.payer })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(
          and(
            eq(conversations.id, conversationId),
            inArray(conversations.runtime, [...NATIVE_RUNTIMES]),
          ),
        )
        .limit(1),
    ),
});

const updateAgentRunnerToken = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    runnerTokenHash: Schema.NullOr(Schema.String),
  }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, runnerTokenHash }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ runnerTokenHash })
        .where(reachableAgent(userId, agentId))
        .returning({ id: agentTable.id }),
    ),
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
    Database.use((db) =>
      db.update(agentTable).set({ lastStep }).where(reachableAgent(userId, agentId)),
    ),
});

const updateAgentCompaction = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, at: Schema.Date }),
  execute: ({ userId, agentId, at }) =>
    Database.use((db) =>
      db.update(agentTable).set({ compactedAt: at }).where(reachableAgent(userId, agentId)),
    ),
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
    Database.use((db) =>
      db
        .select({
          model: agentTable.model,
          contextWindow: agentTable.contextWindow,
          lastStep: agentTable.lastStep,
          compactedAt: agentTable.compactedAt,
        })
        .from(agentTable)
        .where(reachableAgent(userId, agentId))
        .limit(1),
    ),
});

const AgentsOfTaskSchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.String,
  includeArchived: Schema.Boolean,
});

/** The condition that an agent stands on the task the account reaches, and is one the account may read (`agentVisibleTo`), archived only where asked for; read joined to its task. */
function ofReachedTask({ userId, taskId, includeArchived }: typeof AgentsOfTaskSchema.Type) {
  return and(
    reachableTask(userId, taskId),
    agentVisibleTo(userId),
    includeArchived ? undefined : isNull(agentTable.archivedAt),
  );
}

const findAgentsOfTask = SqlSchema.findAll({
  Request: AgentsOfTaskSchema,
  Result: AgentRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(ofReachedTask(request))
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

const findAgentLinesOfTask = SqlSchema.findAll({
  Request: AgentsOfTaskSchema,
  Result: AgentLineRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(AGENT_LINE_COLUMNS)
        .from(agentTable)
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(ofReachedTask(request))
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

/** A `LIKE` pattern finding the words anywhere, its own `%`, `_`, and `\\` matched as themselves. */
function containing(words: string): string {
  return `%${words.replace(/[\\%_]/gu, (special) => `\\${special}`)}%`;
}

/**
 * The name an agent is shown by, as `agentName` names it: its title, else the name of the automation whose run started
 * it, else its model. Note that the model is named as `modelLabel` spells an
 * id the catalog has not been read for, its provider dropped and its words
 * spaced, because the catalog's own names live with the client.
 */
const AGENT_SHOWN_NAME = sql<string>`coalesce(
  ${agentTable.title},
  ${agentTable.automationOrigin} ->> 'name',
  replace(regexp_replace(${agentTable.model}, '^[^/]*/', ''), '-', ' ')
)`;

/**
 * The condition that every word of the query is held by the name an agent is
 * shown by or its task's name, each word by either, whatever its case; none
 * for a query of no words. Note that the query is split as the panel's
 * `matchingRows` splits one, so a row matches on the service where it matches
 * in a menu.
 */
function agentNamed(query: string): SQL | undefined {
  const words = query.split(/\s+/u).filter(Boolean);
  if (words.length === 0) return undefined;
  return and(
    ...words.map((word) => {
      const pattern = containing(word);
      return or(
        ilike(AGENT_SHOWN_NAME, pattern),
        exists(
          queryBuilder
            .select({ one: task.id })
            .from(task)
            .where(and(eq(task.id, agentTable.taskId), ilike(task.name, pattern))),
        ),
      );
    }),
  );
}

/** The agent a list is read around: the one asking, by its id, its task, and the agent that started it. */
const AgentAroundSchema = Schema.Struct({
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  startedByAgentId: Schema.NullOr(Schema.String),
});

const AgentsOfWorkspaceSchema = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
  repository: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  words: Schema.NullOr(Schema.String),
  includeArchived: Schema.Boolean,
  archivedOnly: Schema.Boolean,
  ownOnly: Schema.Boolean,
  startedBy: Schema.NullOr(Schema.String),
  automation: Schema.NullOr(Schema.Boolean),
  automationId: Schema.NullOr(Schema.String),
  taskStatus: Schema.NullOr(taskStatusSchema),
  except: Schema.NullOr(Schema.String),
  around: Schema.NullOr(AgentAroundSchema),
  offset: Schema.Number,
  limit: Schema.Number,
});

/** The condition that an automation's run started the agent, or that it belongs to a run, as a helper a run's agent started does. */
function ofAnyAutomation(): SQL {
  return sql`(${agentAutomationRunSql(agentTable)} or ${agentTable.automationRunId} is not null)`;
}

/**
 * The condition that the automation named started the agent, or that it
 * belongs to one of that automation's runs. Note that the run is read too,
 * because a helper a run's agent started, and an agent a same-agent
 * automation adopted, name the run but not the automation.
 */
function ofAutomation(automationId: string): SQL {
  return (
    or(
      eq(agentTable.automationId, automationId),
      exists(
        queryBuilder
          .select({ one: automationRun.id })
          .from(automationRun)
          .where(
            and(
              eq(automationRun.id, agentTable.automationRunId),
              eq(automationRun.automationId, automationId),
            ),
          ),
      ),
    ) ?? eq(agentTable.automationId, automationId)
  );
}

/** The condition that an agent is one of the workspace's the account reaches, narrowed as the request asks. */
function ofReachedWorkspace(request: typeof AgentsOfWorkspaceSchema.Type) {
  const { userId, organizationId, repository, taskId, words, except } = request;
  return and(
    agentVisibleTo(userId),
    eq(AGENT_WORKSPACE, organizationId),
    request.ownOnly ? eq(agentTable.userId, userId) : undefined,
    request.startedBy === null ? undefined : eq(agentTable.userId, request.startedBy),
    request.includeArchived ? undefined : isNull(agentTable.archivedAt),
    request.archivedOnly ? isNotNull(agentTable.archivedAt) : undefined,
    request.automation === null
      ? undefined
      : request.automation
        ? ofAnyAutomation()
        : sql`not ${ofAnyAutomation()}`,
    request.automationId === null ? undefined : ofAutomation(request.automationId),
    // Note that an agent on no task stands on no status, so it never matches one.
    request.taskStatus === null
      ? undefined
      : exists(
          queryBuilder
            .select({ one: task.id })
            .from(task)
            .where(and(eq(task.id, agentTable.taskId), eq(task.status, request.taskStatus))),
        ),
    taskId === null ? undefined : eq(agentTable.taskId, taskId),
    words === null ? undefined : agentNamed(words),
    except === null ? undefined : ne(agentTable.id, except),
    // Note that a repository is matched as GitHub matches one, its case aside.
    repository === null
      ? undefined
      : eq(sql`lower(${agentTable.repository})`, repository.toLowerCase()),
  );
}

/** The condition that an agent is the asking agent's own: its starter, or one it started. */
function ownOfAgent(around: typeof AgentAroundSchema.Type): SQL {
  const started = eq(agentTable.startedByAgentId, around.agentId);
  return around.startedByAgentId === null
    ? started
    : (or(started, eq(agentTable.id, around.startedByAgentId)) ?? started);
}

/**
 * How a workspace's list is ordered: where the request names the agent
 * asking, its starter and the agents it started first, then the agents on
 * its task, and only then the rest of the workspace, each run newest
 * started first; the newest first alone where it names none. So the agents
 * an agent works beside are never pushed out of a list cut at its bound by
 * every newer agent of the workspace, and its starter not even by its task.
 */
function workspaceListOrder(request: typeof AgentsOfWorkspaceSchema.Type): SQL[] {
  const { around } = request;
  if (around === null) return [desc(agentTable.createdAt), desc(agentTable.id)];
  const onTask = around.taskId === null ? sql`false` : eq(agentTable.taskId, around.taskId);
  const nearness = sql`case when ${ownOfAgent(around)} then 0 when ${onTask} then 1 else 2 end`;
  return [nearness, desc(agentTable.createdAt), desc(agentTable.id)];
}

const findAgentsOfWorkspace = SqlSchema.findAll({
  Request: AgentsOfWorkspaceSchema,
  Result: AgentRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .where(ofReachedWorkspace(request))
        .orderBy(...workspaceListOrder(request))
        .offset(request.offset)
        .limit(request.limit),
    ),
});

/**
 * One page of every agent of the workspace not archived, any member's,
 * oldest started first, read by the workspace alone: no account's reach
 * gates it, since what reads it has already held the caller to the
 * workspace's owner.
 */
const findAgentsOfDeletedWorkspace = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    offset: Schema.Number,
    limit: Schema.Number,
  }),
  Result: AgentRowSchema,
  execute: ({ organizationId, offset, limit }) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .where(and(eq(agentTable.organizationId, organizationId), isNull(agentTable.archivedAt)))
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id))
        .offset(offset)
        .limit(limit),
    ),
});

const findAgentLinesOfWorkspace = SqlSchema.findAll({
  Request: AgentsOfWorkspaceSchema,
  Result: AgentLineRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(AGENT_LINE_COLUMNS)
        .from(agentTable)
        .where(ofReachedWorkspace(request))
        .orderBy(...workspaceListOrder(request))
        .offset(request.offset)
        .limit(request.limit),
    ),
});

/** Every agent with no plan in the account's workspaces, newest started first, each with the account's own pin and read mark of it. */
const findTasklessAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, includeArchived: Schema.Boolean }),
  Result: TasklessAgentRowSchema,
  execute: ({ userId, includeArchived }) =>
    Database.use((db) =>
      db
        .select({
          ...AGENT_LINE_COLUMNS,
          pinnedAt: agentPin.pinnedAt,
          pinPosition: agentPin.position,
          // Note that with no mark of the reader's own, the agent reads through the instant marks moved to the service, or its start.
          readThrough: sql<Date>`coalesce(${agentRead.readThrough}, ${agentTable.readThrough}, ${agentTable.createdAt})`,
          markedUnread: sql<boolean>`coalesce(${agentRead.markedUnread}, false)`,
        })
        .from(agentTable)
        .leftJoin(agentPin, and(eq(agentPin.agentId, agentTable.id), eq(agentPin.userId, userId)))
        .leftJoin(
          agentRead,
          and(eq(agentRead.agentId, agentTable.id), eq(agentRead.userId, userId)),
        )
        .where(
          and(
            isNull(agentTable.taskId),
            agentVisibleTo(userId),
            includeArchived ? undefined : isNull(agentTable.archivedAt),
          ),
        )
        .orderBy(desc(agentTable.createdAt), desc(agentTable.id)),
    ),
});

/** The `published` column as the service writes it (`StoredPullRequest`): the wire's pull request, and what the service alone reads, absent from a row written before it was kept. */
export const PublishedColumnSchema = Schema.Struct({
  ...agentPullRequestSchema.fields,
  headSha: Schema.optionalKey(Schema.String),
  mergedAt: Schema.optionalKey(Schema.Number),
});

/** The `published_read` column (`StoredPublishedRead`). */
export const PublishedReadColumnSchema = Schema.Struct({
  at: Schema.Number,
  branch: Schema.NullOr(Schema.String),
  pushed: Schema.Boolean,
});

const updateAgentPublished = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    published: Schema.NullOr(PublishedColumnSchema),
    publishedRead: Schema.NullOr(PublishedReadColumnSchema),
  }),
  execute: ({ userId, agentId, published, publishedRead }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ published, publishedRead })
        .where(reachableAgent(userId, agentId)),
    ),
});

const updateAgentPublishedReadForgotten = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db.update(agentTable).set({ publishedRead: null }).where(reachableAgent(userId, agentId)),
    ),
});

const findAgentPublished = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({
    published: Schema.NullOr(PublishedColumnSchema),
    publishedRead: Schema.NullOr(PublishedReadColumnSchema),
  }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ published: agentTable.published, publishedRead: agentTable.publishedRead })
        .from(agentTable)
        .where(reachableAgent(userId, agentId))
        .limit(1),
    ),
});

/** The pull request the agent's row keeps, under the row's lock, as a write of a new one reads it. */
const lockAgentPublished = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ published: Schema.NullOr(PublishedColumnSchema) }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ published: agentTable.published })
        .from(agentTable)
        .where(reachableAgent(userId, agentId))
        .limit(1)
        .for("update", { of: agentTable }),
    ),
});

const findAgentsOfTasks = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    taskIds: Schema.Array(Schema.String),
    includeArchived: Schema.Boolean,
  }),
  Result: Schema.Struct({
    ...AgentLineRowSchema.fields,
    published: Schema.NullOr(agentPullRequestSchema),
  }),
  execute: ({ userId, taskIds, includeArchived }) =>
    Database.use((db) =>
      db
        .select({ ...AGENT_LINE_COLUMNS, published: agentTable.published })
        .from(agentTable)
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(
          and(
            inArray(task.id, [...taskIds]),
            agentVisibleTo(userId),
            includeArchived ? undefined : isNull(agentTable.archivedAt),
          ),
        )
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

/**
 * One agent of the task, archived or not, whose pull request GitHub reported
 * merged, where the account reaches the task. Note that every agent of the
 * task counts, one on a teammate's token the account does not see among
 * them, because the answer is one bit about the task and names no agent,
 * and the migration that settled the archived tasks counted them all.
 */
const findMergedAgentOfTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, taskId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, taskId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(
          and(
            eq(task.id, taskId),
            taskReachableBy(userId),
            or(
              isNotNull(sql`${agentTable.published} ->> 'mergedAt'`),
              // Note that a pull request in a repository the agent works in beside its own counts as its own does.
              exists(
                queryBuilder
                  .select({ one: agentRepository.agentId })
                  .from(agentRepository)
                  .where(
                    and(
                      eq(agentRepository.agentId, agentTable.id),
                      isNotNull(sql`${agentRepository.published} ->> 'mergedAt'`),
                    ),
                  ),
              ),
            ),
          ),
        )
        .limit(1),
    ),
});

const findPublishedAgentsById = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    ...AgentRowSchema.fields,
    published: Schema.NullOr(agentPullRequestSchema),
  }),
  execute: ({ userId, agentIds }) =>
    Database.use((db) =>
      db
        .select({ ...AGENT_COLUMNS, published: agentTable.published })
        .from(agentTable)
        .where(and(inArray(agentTable.id, [...agentIds]), agentVisibleTo(userId)))
        .orderBy(asc(agentTable.createdAt), asc(agentTable.id)),
    ),
});

const findStartedFrom = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentIds: Schema.Array(Schema.String),
    perSource: Schema.Number,
  }),
  Result: Schema.Struct({
    id: Schema.String,
    title: Schema.NullOr(Schema.String),
    startedFrom: StartedFromColumnSchema,
  }),
  execute: ({ userId, agentIds, perSource }) =>
    Database.use((db) => {
      // Each source's own oldest are kept, so a source started from many hides none of another's.
      const ranked = db
        .select({
          id: agentTable.id,
          title: agentTable.title,
          startedFrom: agentTable.startedFrom,
          createdAt: agentTable.createdAt,
          rank: sql<number>`row_number() over (partition by (${agentTable.startedFrom}->>'agentId') order by ${agentTable.createdAt}, ${agentTable.id})`.as(
            "rank",
          ),
        })
        .from(agentTable)
        .where(
          and(
            // Note that the source is matched on the expression its index is built on.
            inArray(sql`(${agentTable.startedFrom}->>'agentId')`, [...agentIds]),
            agentVisibleTo(userId),
          ),
        )
        .as("ranked");
      return db
        .select({ id: ranked.id, title: ranked.title, startedFrom: ranked.startedFrom })
        .from(ranked)
        .where(lte(ranked.rank, perSource))
        .orderBy(asc(ranked.createdAt), asc(ranked.id));
    }),
});

/**
 * The condition that a repository column names the repository a delivery
 * names, as GitHub matches one, its case aside: the one expression every
 * lookup by a delivery's repository is written in, so each is served by the
 * index built on it (`agent_on_branch`, `agent_repository_on_head`,
 * `agent_repository_on_pull_request`).
 */
function namesDeliveredRepository(column: SQLWrapper, repository: string): SQL {
  return eq(sql`lower(${column})`, repository.toLowerCase());
}

/** The number of the pull request a `published` column keeps, as its lookup's index is built on it. */
function publishedNumber(column: SQLWrapper): SQL {
  return sql`(${column}->>'number')::int`;
}

/** An agent a delivery found, with the repository of its it was found on: its own, or one it works in beside it, and that repository's head branch. */
const AgentOnRepositoryRowSchema = Schema.Struct({
  ...AgentRowSchema.fields,
  onRepository: Schema.String,
  onBranch: Schema.NullOr(Schema.String),
});

const OnBranchesSchema = Schema.Struct({
  repository: Schema.String,
  branches: Schema.Array(Schema.String),
  limit: Schema.Number,
});

const OnPullRequestSchema = Schema.Struct({
  repository: Schema.String,
  number: Schema.Number,
  limit: Schema.Number,
});

const findAgentsOnBranches = SqlSchema.findAll({
  Request: OnBranchesSchema,
  Result: AgentOnRepositoryRowSchema,
  execute: ({ repository, branches, limit }) =>
    Database.use((db) =>
      db
        .select({
          ...AGENT_COLUMNS,
          userId: agentTable.userId,
          onRepository: sql<string>`${agentTable.repository}`,
          onBranch: agentTable.branch,
        })
        .from(agentTable)
        .where(
          and(
            namesDeliveredRepository(agentTable.repository, repository),
            inArray(agentTable.branch, [...branches]),
          ),
        )
        .orderBy(desc(agentTable.createdAt), asc(agentTable.id))
        .limit(limit),
    ),
});

/** The agents whose extra repository a delivery names stands on one of its branches, as `findAgentsOnBranches` finds them by their own. */
const findAgentsOnExtraBranches = SqlSchema.findAll({
  Request: OnBranchesSchema,
  Result: AgentOnRepositoryRowSchema,
  execute: ({ repository, branches, limit }) =>
    Database.use((db) =>
      db
        .select({
          ...AGENT_COLUMNS,
          userId: agentTable.userId,
          onRepository: agentRepository.repository,
          onBranch: agentRepository.headBranch,
        })
        .from(agentRepository)
        .innerJoin(agentTable, eq(agentTable.id, agentRepository.agentId))
        .where(
          and(
            namesDeliveredRepository(agentRepository.repository, repository),
            inArray(agentRepository.headBranch, [...branches]),
          ),
        )
        .orderBy(desc(agentTable.createdAt), asc(agentTable.id))
        .limit(limit),
    ),
});

const findAgentsOnPullRequest = SqlSchema.findAll({
  Request: OnPullRequestSchema,
  Result: AgentOnRepositoryRowSchema,
  execute: ({ repository, number, limit }) =>
    Database.use((db) =>
      db
        .select({
          ...AGENT_COLUMNS,
          userId: agentTable.userId,
          onRepository: sql<string>`${agentTable.repository}`,
          onBranch: agentTable.branch,
        })
        .from(agentTable)
        .where(
          and(
            namesDeliveredRepository(agentTable.repository, repository),
            eq(publishedNumber(agentTable.published), number),
          ),
        )
        .orderBy(desc(agentTable.createdAt), asc(agentTable.id))
        .limit(limit),
    ),
});

/** The agents whose extra repository a delivery names keeps its pull request numbered, as `findAgentsOnPullRequest` finds them by their own. */
const findAgentsOnExtraPullRequest = SqlSchema.findAll({
  Request: OnPullRequestSchema,
  Result: AgentOnRepositoryRowSchema,
  execute: ({ repository, number, limit }) =>
    Database.use((db) =>
      db
        .select({
          ...AGENT_COLUMNS,
          userId: agentTable.userId,
          onRepository: agentRepository.repository,
          onBranch: agentRepository.headBranch,
        })
        .from(agentRepository)
        .innerJoin(agentTable, eq(agentTable.id, agentRepository.agentId))
        .where(
          and(
            namesDeliveredRepository(agentRepository.repository, repository),
            eq(publishedNumber(agentRepository.published), number),
          ),
        )
        .orderBy(desc(agentTable.createdAt), asc(agentTable.id))
        .limit(limit),
    ),
});

const findAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db.select(AGENT_COLUMNS).from(agentTable).where(reachableAgent(userId, agentId)).limit(1),
    ),
});

const findVisibleAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentVisibleTo(userId)))
        .limit(1),
    ),
});

/** The most continues of a pilot a message follows to the pilot that took over from it, every one archived but the last. */
const TAKEOVER_HOPS = 10;

/** The newest pilot that continued the agent, where the account may read it (`agentVisibleTo`), archived or not; a fork is none. */
const findTakingOverPilot = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .where(
          and(
            // Note that the source is matched on the expression its index is built on.
            sql`(${agentTable.startedFrom}->>'agentId') = ${agentId}`,
            sql`${agentTable.startedFrom}->>'messageId' is null`,
            eq(agentTable.kind, AGENT_KIND.PILOT),
            agentVisibleTo(userId),
          ),
        )
        .orderBy(desc(agentTable.createdAt), desc(agentTable.id))
        .limit(1),
    ),
});

/** The account's pin of the agent, from now; one already standing keeps its instant. */
const insertAgentPin = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, now }) =>
    Database.use((db) =>
      db
        .insert(agentPin)
        .values({ userId, agentId: agentId, pinnedAt: now })
        .onConflictDoNothing()
        .returning({ txid: TXID }),
    ),
});

/** The account's pin of the agent at the position given, from now where it was not pinned; one already standing keeps its instant and moves. */
const placeAgentPin = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    position: Schema.String,
    now: Schema.Date,
  }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, position, now }) =>
    Database.use((db) =>
      db
        .insert(agentPin)
        .values({ userId, agentId: agentId, position, pinnedAt: now })
        .onConflictDoUpdate({
          target: [agentPin.userId, agentPin.agentId],
          set: { position },
        })
        .returning({ txid: TXID }),
    ),
});

/** The account's pin of the agent taken away; every other member's stands. */
const deleteAgentPin = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .delete(agentPin)
        .where(and(eq(agentPin.userId, userId), eq(agentPin.agentId, agentId)))
        .returning({ txid: TXID }),
    ),
});

/** The account's read mark of the agent read through now, a mark by hand taken back. */
const markAgentRead = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, now }) =>
    Database.use((db) =>
      db
        .insert(agentRead)
        .values({ userId, agentId, readThrough: now })
        .onConflictDoUpdate({
          target: [agentRead.userId, agentRead.agentId],
          set: { readThrough: now, markedUnread: false },
        })
        .returning({ txid: TXID }),
    ),
});

/** The account's read mark of the agent read through now, a mark by hand left standing. */
const markAgentSeen = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, now }) =>
    Database.use((db) =>
      db
        .insert(agentRead)
        .values({ userId, agentId, readThrough: now })
        .onConflictDoUpdate({
          target: [agentRead.userId, agentRead.agentId],
          set: { readThrough: now },
        })
        .returning({ txid: TXID }),
    ),
});

/** The account's read mark of the agent marked unread, the instant it was read through left standing; nothing where it stands marked already. */
const markAgentUnread = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .insert(agentRead)
        .values({ userId, agentId, markedUnread: true })
        .onConflictDoUpdate({
          target: [agentRead.userId, agentRead.agentId],
          set: { markedUnread: true },
          setWhere: sql`not ${agentRead.markedUnread}`,
        })
        .returning({ txid: TXID }),
    ),
});

/**
 * The columns of an agent that a caller holding only its conversation most
 * often needs: who it is, who started it, its task, repository, title, and
 * archive. Note that these leave out the description's text and the prompt, the bulk
 * of a row, since every tool call of ours an agent makes reads its agent.
 */
const AGENT_HEADER_COLUMNS = {
  id: agentTable.id,
  userId: agentTable.userId,
  organizationId: agentTable.organizationId,
  taskId: agentTable.taskId,
  repository: agentTable.repository,
  title: agentTable.title,
  archivedAt: agentTable.archivedAt,
  machine: agentTable.machine,
} as const;

const AgentHeaderRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  organizationId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  machine: Schema.Literals(Object.values(AGENT_MACHINE)),
});

const findAgentHeaderOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: AgentHeaderRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select(AGENT_HEADER_COLUMNS)
        .from(agentTable)
        .where(and(eq(agentTable.conversationId, conversationId), agentReachableBy(userId))),
    ),
});

const findAgentOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: AgentRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select(AGENT_COLUMNS)
        .from(agentTable)
        .where(and(eq(agentTable.conversationId, conversationId), agentReachableBy(userId)))
        .limit(1),
    ),
});

const deleteAgentRow = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String, txid: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .delete(agentTable)
        .where(reachableAgent(userId, agentId))
        .returning({ conversationId: agentTable.conversationId, txid: TXID }),
    ),
});

/** By id alone, because the agent row the delete before it took passed the task's gate and named this conversation. */
const deleteConversationRow = SqlSchema.void({
  Request: Schema.String,
  execute: (conversationId) =>
    Database.use((db) => db.delete(conversations).where(eq(conversations.id, conversationId))),
});

/** The kind a Start makes, read under its task's lock: the kind asked, bar a pilot where another pilot of the task stands, which makes a coder. */
const kindUnderLock = Effect.fnUntraced(function* (started: NewAgent) {
  if (started.kind !== AGENT_KIND.PILOT) return started.kind ?? AGENT_KIND.CODER;
  const besides = started.startedFrom?.agentId ?? null;
  const standing = yield* findLivePilot({ taskId: started.taskId, besides });
  return Option.isSome(standing) ? AGENT_KIND.CODER : AGENT_KIND.PILOT;
});

/**
 * Starts an agent on a task of the account's workspace, or in a workspace
 * of the account's with no task: a `coding_agent` conversation of the
 * account's and the row that binds it to the task or the workspace, with
 * the description text or the prompt, the repository, the automation whose run
 * started it with that run, and the account's own agent whose `start_agent`
 * started it, as handed. A continue of a pilot takes over its agents in the
 * same transaction: the account's agents it started, or any pilot that
 * took over from it before started, that stand unarchived report to the
 * new pilot from then on. A Start whose key the account has already used answers the agent
 * that Start made, whatever else the retry carries, and writes nothing.
 * A task has one pilot, so a pilot
 * asked of a task another stands on unarchived, as a Start that raced
 * another finds under the task's lock, is made a coder; the pilot a
 * continue goes on from is no other.
 * Nothing where the account reaches no such task or is no member of the
 * workspace.
 */
export function createAgent(
  userId: string,
  started: NewAgent,
): Effect.Effect<Option.Option<AgentStarted>, StoreFailure, DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const reached = yield* lockedPlace(userId, started);
        if (Option.isNone(reached)) return Option.none();
        const existing = yield* findAgentByKey({
          userId,
          idempotencyKey: started.idempotencyKey,
        });
        if (Option.isSome(existing)) {
          return Option.some({ agent: existing.value, created: false });
        }
        const organizationId = reached.value.organizationId;
        const kind = yield* kindUnderLock(started);
        const now = yield* DateTime.nowAsDate;
        const conversation = yield* insertAgentConversation({
          userId,
          runtime: started.runtime,
          now,
        }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        const { txid, ...row } = yield* insertAgent({
          userId,
          conversationId: conversation.id,
          taskId: started.taskId,
          organizationId,
          automationId: started.automationId ?? null,
          automationOrigin: started.automationOrigin ?? null,
          automationRunId: started.automationRunId ?? null,
          startedFrom: started.startedFrom ?? null,
          source: started.source ?? null,
          startedByAgentId: yield* ownStarterOf(userId, started.startedByAgentId),
          title: started.title ?? null,
          idempotencyKey: started.idempotencyKey,
          model: started.model,
          effort: started.effort,
          contextWindow: started.contextWindow ?? CONTEXT_WINDOW.LONG,
          descriptionSnapshot: started.descriptionSnapshot,
          prompt: started.prompt,
          repository: started.repository,
          startBranch: started.startBranch ?? null,
          disabledServers: storedServers(started.disabledServers ?? []),
          mentionedServers: storedServers(started.mentionedServers ?? []),
          githubAccess: started.githubAccess ?? GITHUB_ACCESS.APP,
          payer: started.payer ?? null,
          kind,
          machine: started.machine ?? AGENT_MACHINE.VERCEL,
          deviceId: started.deviceId ?? null,
          now,
        }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        // Note that an agent in one repository or none writes no row here, so its rows are as they were.
        const extras = started.extraRepositories ?? [];
        if (extras.length > 0) {
          yield* insertAgentRepositories({
            agentId: row.id,
            repositories: extras.map((extra) => ({
              repository: extra.repository,
              baseBranch: extra.baseBranch ?? null,
            })),
          });
        }
        // The pilot's agents report to the one that continues it from the moment it stands.
        if (started.takesOverFrom !== undefined) {
          yield* updateTakenOver({ userId, from: started.takesOverFrom, to: row.id });
        }
        return Option.some({ agent: row, created: true, txid });
      }),
    ),
  );
}

/**
 * Discards an agent a Start could not open a session for: its row and
 * its conversation, with every message and turn the conversation holds,
 * which is none. The agents a continue of a pilot took over go back to the
 * pilot it was started from first, since the row's delete would leave them
 * reporting to no one. Answers whether the account reached such an agent.
 */
export function discardAgent(userId: string, agentId: string): AgentStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // Note that an agent never run started none of its own, so every agent it starts was taken over.
        const source = Option.getOrUndefined(yield* findAgent({ userId, agentId }))?.startedFrom;
        if (source !== undefined && source !== null) {
          yield* updateStartedBy({ userId, from: agentId, to: source.agentId });
        }
        const [deleted] = yield* deleteAgentRow({ userId, agentId });
        if (deleted === undefined) return false;
        yield* deleteConversationRow(deleted.conversationId);
        return true;
      }),
    ),
  );
}

/** What a delete that stopped the agent first tells it. */
export interface AgentDeleteGuard<R> {
  /** Whether the agent, read under its conversation's lock, still stands as the caller's Stop left it; false refuses the delete. */
  readonly standsStopped: (agent: Agent) => Effect.Effect<boolean, StoreFailure, R>;
  /** Run under that lock before anything is deleted, given the agent's conversation. */
  readonly beforeDelete: (
    conversationIds: readonly string[],
  ) => Effect.Effect<void, StoreFailure, R>;
}

/**
 * Deletes the agent for good: its row, which takes its pins and its inbox
 * with it and leaves what else named it naming no one; and its
 * conversation stamped deleted, so the purge takes its transcript seven days on, as a task's delete does
 * for each of its agents. Answers the transaction its row went in, as a
 * task's delete does; none where the account reaches no such agent.
 *
 * Everything runs under the agent's conversation lock, the one every write
 * of its lines and turns takes, and the agent is read again under it, so a
 * message handed over after the caller stopped it either landed first, its
 * line standing from before its runtime hears it (`dispatch-claim.ts`), and
 * `standsStopped` refuses with `TaskAgentUnstopped`, nothing written, or
 * waits on the lock and finds no agent.
 */
export function deleteAgent<R = never>(
  userId: string,
  agentId: string,
  guard: AgentDeleteGuard<R>,
): Effect.Effect<
  Option.Option<{ readonly txid: string }>,
  StoreFailure | TaskAgentUnstopped,
  DatabaseServices | R
> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const found = yield* findAgent({ userId, agentId });
        if (Option.isNone(found)) return Option.none();
        const locked = yield* lockAgentConversation({
          conversationId: found.value.conversationId,
        });
        if (Option.isNone(locked)) return Option.none();
        const agent = yield* findAgent({ userId, agentId });
        if (Option.isNone(agent)) return Option.none();
        if (!(yield* guard.standsStopped(agent.value))) return yield* new TaskAgentUnstopped();
        yield* guard.beforeDelete([agent.value.conversationId]);
        const [deleted] = yield* deleteAgentRow({ userId, agentId });
        if (deleted === undefined) return Option.none();
        yield* stampConversationsDeleted([deleted.conversationId]);
        return Option.some({ txid: deleted.txid });
      }),
    ),
  );
}

/** Every agent started on the task, by any member, in the order they were started, the archived ones only where `includeArchived` asks; empty where the account reaches no such task. */
export function listAgents(
  userId: string,
  taskId: string,
  options: { readonly includeArchived?: boolean } = {},
): AgentStoreEffect<readonly Agent[]> {
  return findAgentsOfTask({ userId, taskId, includeArchived: options.includeArchived ?? false });
}

/** Every agent started on the task as its line reads, by any member, in the order they were started, the archived ones only where `includeArchived` asks; empty where the account reaches no such task. */
export function listAgentLines(
  userId: string,
  taskId: string,
  options: { readonly includeArchived?: boolean } = {},
): AgentStoreEffect<readonly AgentLine[]> {
  return findAgentLinesOfTask({
    userId,
    taskId,
    includeArchived: options.includeArchived ?? false,
  });
}

/** The agent a list is read around, where one asks: its id, its task, and the agent that started it. */
type AgentAround = typeof AgentAroundSchema.Type;

/** What a list of a workspace's agents is narrowed to, and how many it answers at most. */
interface WorkspaceAgentsAsked {
  readonly repository?: string;
  readonly taskId?: string;
  readonly words?: string;
  readonly includeArchived?: boolean;
  /** Only the archived agents; `includeArchived` must ask for them too. */
  readonly archivedOnly?: boolean;
  /** Only the agents the account started, by hand or through any of its agents; every member's where unsaid. */
  readonly ownOnly?: boolean;
  /** Only the agents this member started, by their account's id; every member's where unsaid. */
  readonly startedBy?: string;
  /** Only the agents an automation's run started where true, only those started otherwise where false; both where unsaid. */
  readonly automation?: boolean;
  /** Only the agents the runs of this automation started, by its id. */
  readonly automationId?: string;
  /** Only the agents on a task standing at this status; an agent on no task matches none. */
  readonly taskStatus?: TaskStatus;
  /** The one agent left out, the one asking. */
  readonly except?: string;
  /** The agent whose own come first: those on its task, its starter, and those it started. */
  readonly around?: AgentAround;
  /** How many of the list to pass over before the first answered; none where unsaid. */
  readonly offset?: number;
  readonly limit: number;
}

/** A workspace list's request as its statement reads it, every narrowing it was not given read as none. */
function workspaceRequest(userId: string, organizationId: string, options: WorkspaceAgentsAsked) {
  return {
    userId,
    organizationId,
    repository: options.repository ?? null,
    taskId: options.taskId ?? null,
    words: options.words ?? null,
    includeArchived: options.includeArchived ?? false,
    archivedOnly: options.archivedOnly ?? false,
    ownOnly: options.ownOnly ?? false,
    startedBy: options.startedBy ?? null,
    automation: options.automation ?? null,
    automationId: options.automationId ?? null,
    taskStatus: options.taskStatus ?? null,
    except: options.except ?? null,
    around: options.around ?? null,
    offset: options.offset ?? 0,
    limit: options.limit,
  };
}

/**
 * The workspace's agents, on a task or with none, by any member or only the
 * account's own where `ownOnly` asks, newest started first, the agents
 * around the one `around` names before the rest, an archived one
 * left out unless `includeArchived` asks, the one `except` names left out,
 * only those on the repository named where one is, on the plan named
 * where one is, and whose shown name (`agentName`) or task's name holds each of
 * the words where some are given, the first `offset` passed over, and at most `limit`; a workspace the account is not in has
 * none.
 */
export function listWorkspaceAgents(
  userId: string,
  organizationId: string,
  options: WorkspaceAgentsAsked,
): AgentStoreEffect<readonly Agent[]> {
  return findAgentsOfWorkspace(workspaceRequest(userId, organizationId, options));
}

/**
 * Every agent of the workspace a delete stops, not archived, any member's,
 * whether or not the owner deleting it sees it, oldest started first, the
 * first `offset` passed over, and at most `limit`. Read by the workspace
 * alone, as `workspaceConversationIds` reads it: the caller holds the
 * account to the workspace's owner first, since everything in it goes.
 */
export function listAgentsOfDeletedWorkspace(
  organizationId: string,
  page: { readonly offset: number; readonly limit: number },
): AgentStoreEffect<readonly Agent[]> {
  return findAgentsOfDeletedWorkspace({ organizationId, ...page });
}

/** The workspace's agents as `listWorkspaceAgents` lists them, each as its line reads. */
export function listWorkspaceAgentLines(
  userId: string,
  organizationId: string,
  options: WorkspaceAgentsAsked,
): AgentStoreEffect<readonly AgentLine[]> {
  return findAgentLinesOfWorkspace(workspaceRequest(userId, organizationId, options));
}

/**
 * Every agent with no plan in the account's workspaces, by any member,
 * newest started first, the archived ones only where `includeArchived` asks,
 * each as its line reads with the account's own pin of it: what the plan
 * list carries beside the plans, read by the same gate.
 */
export function listTasklessAgentRows(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): AgentStoreEffect<readonly TasklessAgentRow[]> {
  return findTasklessAgents({ userId, includeArchived: options.includeArchived ?? false });
}

/** The plan an agent stands on, as a list of agents names it: its name. */
export interface AgentTaskName {
  readonly name: string;
}

const findTaskNames = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, taskIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({ id: Schema.String, name: Schema.String }),
  execute: ({ userId, taskIds }) =>
    Database.use((db) =>
      db
        .select({ id: task.id, name: task.name })
        .from(task)
        .where(and(inArray(task.id, [...taskIds]), taskReachableBy(userId))),
    ),
});

/** The plans named, by id, each with its name; a plan of a workspace the account is not in names nothing. None asked, none read. */
export function taskNamesOf(
  userId: string,
  taskIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, AgentTaskName>> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findTaskNames({ userId, taskIds: ids }),
    (rows) => new Map(rows.map((row) => [row.id, { name: row.name }])),
  );
}

/** One agent, and the pull request from its branch as GitHub last answered; null before a read found one. */
export interface PublishedAgent {
  readonly agent: Agent;
  readonly published: AgentPullRequest | null;
}

/** One agent's line, and the pull request from its branch as GitHub last answered; null before a read found one. */
export interface PublishedAgentLine {
  readonly agent: AgentLine;
  readonly published: AgentPullRequest | null;
}

/** Every agent standing on the plans named, by any member, each as its line reads with what it published, in the order they were started, an archived one left out unless `includeArchived` asks for it; a plan of a workspace the account is not in names none. */
export function listPublishedAgents(
  userId: string,
  taskIds: readonly string[],
  options: { readonly includeArchived?: boolean } = {},
): AgentStoreEffect<readonly PublishedAgentLine[]> {
  if (taskIds.length === 0) return Effect.succeed([]);
  const includeArchived = options.includeArchived === true;
  return Effect.map(findAgentsOfTasks({ userId, taskIds, includeArchived }), (rows) =>
    rows.map(({ published, ...agent }) => ({ agent, published })),
  );
}

/** The agents named, by id, on a plan or with none, archived or not, each with what it published, in the order they were started: the read opening an agent's tab makes, so one of a workspace the account is not in names none. None asked, none read. */
export function listPublishedAgentsById(
  userId: string,
  agentIds: readonly string[],
): AgentStoreEffect<readonly PublishedAgent[]> {
  if (agentIds.length === 0) return Effect.succeed([]);
  return Effect.map(findPublishedAgentsById({ userId, agentIds }), (rows) =>
    rows.map(({ published, ...agent }) => ({ agent, published })),
  );
}

/** How many agents started from one agent its summary names, the oldest first. */
const CONTINUATIONS_PER_AGENT = 20;

/** One agent started from another: its id, its title, null before it has one, and the message it forked the other at where it was forked rather than continued. */
export interface AgentStartedFromIt {
  readonly agentId: string;
  readonly title: string | null;
  readonly messageId?: string;
}

/**
 * The agents started from each agent named, archived or not, oldest first
 * and at most `CONTINUATIONS_PER_AGENT` of each, by the id of the agent
 * they were started from; one of a workspace the account is not in is left
 * out. None asked, none read.
 */
export function continuationsOf(
  userId: string,
  agentIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, readonly AgentStartedFromIt[]>> {
  if (agentIds.length === 0) return Effect.succeed(new Map());
  const perSource = CONTINUATIONS_PER_AGENT;
  return Effect.map(findStartedFrom({ userId, agentIds, perSource }), (rows) => {
    const bySource = new Map<string, AgentStartedFromIt[]>();
    for (const { id, title, startedFrom } of rows) {
      if (startedFrom === null) continue;
      const each = bySource.get(startedFrom.agentId) ?? [];
      each.push(
        startedFrom.messageId === undefined
          ? { agentId: id, title }
          : { agentId: id, title, messageId: startedFrom.messageId },
      );
      bySource.set(startedFrom.agentId, each);
    }
    return bySource;
  });
}

/** Whether a pull request is a merge the row did not already keep as that pull request merged. */
export function newlyMerged(
  kept: StoredPullRequest | null,
  published: StoredPullRequest | null,
): boolean {
  if (published?.state !== PULL_REQUEST_STATE.MERGED) return false;
  return kept?.number !== published.number || kept.state !== PULL_REQUEST_STATE.MERGED;
}

/**
 * The pull request from the agent's branch as GitHub just answered, or null
 * where it answered none, with the read that found it where one is named;
 * nothing written for an agent of a workspace the account is not in.
 * Answers whether this write is the one that first kept it merged: the row
 * is locked as it is read, so of two reads that find the same merge at once
 * (the webhook's and the sweep's) only the first to write says so.
 */
export function recordAgentPublished(
  userId: string,
  agentId: string,
  published: StoredPullRequest | null,
  read?: StoredPublishedRead,
): AgentStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const kept = yield* lockAgentPublished({ userId, agentId });
        if (Option.isNone(kept)) return false;
        yield* updateAgentPublished({ userId, agentId, published, publishedRead: read ?? null });
        return newlyMerged(kept.value.published, published);
      }),
    ),
  );
}

/** The row's read of GitHub let go, so its pull request is no longer answered in GitHub's place; nothing written for an agent of a workspace the account is not in. */
export function forgetAgentPublishedRead(userId: string, agentId: string): AgentStoreEffect<void> {
  return updateAgentPublishedReadForgotten({ userId, agentId });
}

/** Whether any coding agent on the task, archived ones and a teammate's on their own token among them, has a pull request GitHub reported merged, in its own repository or one it works in beside it; false for a task the account does not reach. */
export function taskHasMergedPullRequest(
  userId: string,
  taskId: string,
): AgentStoreEffect<boolean> {
  return Effect.map(findMergedAgentOfTask({ userId, taskId }), Option.isSome);
}

/** The pull request the agent's row keeps as GitHub last answered, whole; null before a read found one, and for an agent the account does not reach. */
export function readAgentPublished(
  userId: string,
  agentId: string,
): AgentStoreEffect<StoredPullRequest | null> {
  return Effect.map(findAgentPublished({ userId, agentId }), (row) =>
    Option.isSome(row) ? row.value.published : null,
  );
}

/** What the agent's row keeps of GitHub's last answer: the pull request, null where it found none, and the read that found it. */
export interface KeptPublished {
  readonly published: StoredPullRequest | null;
  readonly read: StoredPublishedRead;
}

/** The row's pull request with the read that wrote it; null where no read is kept, and for an agent the account does not reach. */
export function readAgentKeptPublished(
  userId: string,
  agentId: string,
): AgentStoreEffect<KeptPublished | null> {
  return Effect.map(findAgentPublished({ userId, agentId }), (row) =>
    Option.isSome(row) && row.value.publishedRead !== null
      ? { published: row.value.published, read: row.value.publishedRead }
      : null,
  );
}

/** Which of an agent's repositories a delivery from GitHub found it on: its own, or one it works in beside it, as `owner/name` the agent keeps it, with that repository's pull request head branch, none before one opened. */
export interface AgentFoundOn {
  readonly repository: string;
  readonly branch: string | null;
  /** Whether it is a repository the agent works in beside its own (`agent-repositories.ts`). */
  readonly extra: boolean;
}

/** One agent and the account that owns it, as a delivery from GitHub that names a repository and a branch finds it, with the repository of its it was found on. */
export interface OwnedAgent {
  readonly userId: string;
  readonly agent: Agent;
  readonly on: AgentFoundOn;
}

/**
 * The agents found on their own repository, then those found on an extra
 * one, as one list newest started first and at most `limit` long, as one
 * query ordered so would have answered it.
 */
function ownedNewestFirst(
  own: readonly (typeof AgentOnRepositoryRowSchema.Type)[],
  extra: readonly (typeof AgentOnRepositoryRowSchema.Type)[],
  limit: number,
): readonly OwnedAgent[] {
  const found = [
    ...own.map((row) => ({ row, extra: false })),
    ...extra.map((row) => ({ row, extra: true })),
  ];
  found.sort(
    (a, b) =>
      b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
      (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0),
  );
  return found.slice(0, limit).map(({ row, extra: onExtra }) => {
    const { onRepository, onBranch, ...agent } = row;
    return {
      userId: agent.userId,
      agent,
      on: { repository: onRepository, branch: onBranch, extra: onExtra },
    };
  });
}

/**
 * The agents of any account with a repository on one of the repository's
 * branches named, newest started first and at most `limit` of them; none for
 * no branch: the row's own repository and branch, and each extra repository
 * it works in beside it and that one's pull request head branch, the
 * repository matched as GitHub matches one, its case aside, and the branch
 * exactly. This is the one read that names no account, since GitHub's
 * delivery names a repository and a branch and nothing of who started an
 * agent on them; what each answers is read again on its owner's own token.
 */
export function listAgentsOnBranches(
  repository: string,
  branches: readonly string[],
  limit: number,
): AgentStoreEffect<readonly OwnedAgent[]> {
  if (branches.length === 0) return Effect.succeed([]);
  const request = { repository, branches, limit };
  return Effect.map(
    Effect.all([findAgentsOnBranches(request), findAgentsOnExtraBranches(request)]),
    ([own, extra]) => ownedNewestFirst(own, extra, limit),
  );
}

/**
 * The agents of any account with a pull request, as GitHub last answered
 * it, that is the repository's one numbered, newest started first and at
 * most `limit` of them: what a delivery about a pull request finds them by
 * where it names no branch, as a comment's does, on their own repository or
 * an extra one, matched as the read by branches matches. Like that read, it
 * names no account.
 */
export function listAgentsOnPullRequest(
  repository: string,
  number: number,
  limit: number,
): AgentStoreEffect<readonly OwnedAgent[]> {
  const request = { repository, number, limit };
  return Effect.map(
    Effect.all([findAgentsOnPullRequest(request), findAgentsOnExtraPullRequest(request)]),
    ([own, extra]) => ownedNewestFirst(own, extra, limit),
  );
}

/** The account's agent a Start made under its key, or nothing where no Start under it made one. */
export function readAgentByKey(
  userId: string,
  idempotencyKey: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return findAgentByKey({ userId, idempotencyKey });
}

/**
 * Where the account's newest agent on the task runs, archived ones among
 * them, or nothing where the account started none there; a teammate's
 * agents on the task are never read, since a device is one member's, nor an
 * automation's run's, which runs in the cloud rather than where the account
 * chose.
 */
export function readNewestAgentPlace(
  userId: string,
  taskId: string,
): AgentStoreEffect<Option.Option<typeof AgentPlaceRowSchema.Type>> {
  return findNewestAgentPlace({ userId, taskId });
}

/** The agent under this id, or nothing for an agent of a workspace the account is not in: the read an agent makes of itself, under the member who started it. */
export function readAgent(userId: string, agentId: string): AgentStoreEffect<Option.Option<Agent>> {
  return findAgent({ userId, agentId });
}

/**
 * The agent under this id, where the account may read and write it
 * (`agentVisibleTo`), its task included; nothing otherwise. The read every
 * door a member, or another agent, names an agent by its id through makes
 * first, so an agent on a task they do not see is none to them.
 */
export function readVisibleAgent(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return findVisibleAgent({ userId, agentId });
}

/**
 * The pilot that took over from the agent, where the account may read it:
 * the newest pilot that continued it, or, where that one is archived too,
 * the newest that continued that one, and so on for at most
 * `TAKEOVER_HOPS` continues; nothing where the chain ends archived or no
 * pilot continued the agent.
 */
export function readTakeoverPilot(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.gen(function* () {
    let from = agentId;
    for (let hop = 0; hop < TAKEOVER_HOPS; hop += 1) {
      const next = yield* findTakingOverPilot({ userId, agentId: from });
      if (Option.isNone(next) || next.value.archivedAt === null) return next;
      from = next.value.id;
    }
    return Option.none();
  });
}

/** The agent given another model, effort, and context window, which its next step runs on, the model's whole window where the choice names none; nothing for an agent of a workspace the account is not in. */
export function updateAgentChoice(
  userId: string,
  agentId: string,
  choice: ModelChoice,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(updateAgentChoiceCommitted(userId, agentId, choice), Option.map(agentOf));
}

/** The agent given another model, as `updateAgentChoice` gives it, and the transaction its row was written in. */
export function updateAgentChoiceCommitted(
  userId: string,
  agentId: string,
  choice: ModelChoice,
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.map(
    updateAgentChoiceRow({
      userId,
      agentId,
      model: choice.model,
      effort: choice.effort,
      contextWindow: choice.contextWindow ?? CONTEXT_WINDOW.LONG,
    }),
    Option.map(({ txid, ...agent }) => ({ agent, txid })),
  );
}

/** The MCP servers switched off for the agent, the whole list, which its next turn on is not handed; nothing for an agent of a workspace the account is not in. */
export function updateAgentServers(
  userId: string,
  agentId: string,
  disabledServers: readonly string[],
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(
    updateAgentServersCommitted(userId, agentId, disabledServers),
    Option.map(agentOf),
  );
}

/** The agent's MCP servers switched, as `updateAgentServers` switches them, and the transaction its row was written in. */
export function updateAgentServersCommitted(
  userId: string,
  agentId: string,
  disabledServers: readonly string[],
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.map(
    updateAgentServersRow({ userId, agentId, disabledServers: storedServers(disabledServers) }),
    Option.map(({ txid, ...agent }) => ({ agent, txid })),
  );
}

/**
 * The hand-over of a message mentioning MCP servers to the runtime, run with those
 * servers standing among the ones the agent's next turn takes whatever its
 * switches say, and left standing only where the hand-over answers that the runtime
 * took the message. The servers not already standing are added, the
 * hand-over run, and those same servers taken out again for one that
 * answered nothing, failed, or was interrupted at its deadline, so a send
 * the runtime did not take leaves no server for a later turn.
 * No transaction is open across the hand-over, so a turn may take the
 * servers meanwhile; each change is one statement over the row as it then
 * stands, so the take-out never writes back what that turn took. Note that
 * the caller runs this as the dispatch under the conversation's dispatch claim
 * (`writeAwaitingLine`), after its repeat check, so a send's servers are
 * added only for a send the runtime hears, and no other send's hand-over stands
 * between this one's servers and its message. Nothing is added for no
 * server, or for an agent of a workspace the account is not in.
 */
export function dispatchMentioningServers<E, R>(
  userId: string,
  agentId: string,
  mentioned: readonly string[],
  dispatch: Effect.Effect<boolean, E, R>,
): Effect.Effect<boolean, E | StoreFailure, R | DatabaseServices> {
  if (mentioned.length === 0) return dispatch;
  return Effect.gen(function* () {
    const read = yield* readReachableMentionedServers({ userId, agentId });
    if (Option.isNone(read)) return yield* dispatch;
    const standing = new Set(read.value.mentionedServers);
    const added = [...new Set(mentioned)].filter((name) => !standing.has(name));
    // The servers come out again however the hand-over ends short of taken, a deadline's interruption among them.
    return yield* Effect.acquireUseRelease(
      addMentionedServers({ agentId, names: added }),
      () => dispatch,
      (_, exit) =>
        Exit.isSuccess(exit) && exit.value
          ? Effect.void
          : removeMentionedServers({ agentId, names: added }),
    );
  });
}

/**
 * The MCP servers mentioned since the agent of the conversation last started
 * a turn, taken by the turn starting now: read and cleared under the row's
 * lock, so a mention landing meanwhile is either taken here or left for the
 * next turn, never lost. None for a conversation of no agent the account
 * reaches.
 */
export function takeAgentMentionedServers(
  userId: string,
  conversationId: string,
): AgentStoreEffect<readonly string[]> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const locked = yield* lockAgentMentionedServers({ userId, conversationId });
        if (Option.isNone(locked) || locked.value.mentionedServers.length === 0) return [];
        yield* setAgentMentionedServers({ agentId: locked.value.id, mentionedServers: null });
        return locked.value.mentionedServers;
      }),
    ),
  );
}

/** The branch the agent opened its pull request from, or null for none; nothing written for an agent of a workspace the account is not in. */
export function updateAgentBranch(
  userId: string,
  agentId: string,
  branch: string | null,
): AgentStoreEffect<void> {
  return updateAgentBranchRow({ userId, agentId, branch });
}

/** The account's turn marked as one a step of ran at standard speed because Anthropic refused it Fast; nothing written for a turn the account does not own. */
export function recordTurnFastRefused(userId: string, turnId: string): AgentStoreEffect<void> {
  return markTurnFastRefused({ userId, turnId });
}

/** A turn's count of description notes, as a reservation left it: the turn, and every note it has taken or holds reserved, the reservation's own among them. */
export interface TurnDescriptionNotes {
  readonly turnId: string;
  readonly taken: number;
}

/**
 * Reserves a call's description notes against the conversation's running turn
 * before its save goes out, and answers the turn and its count with them;
 * nothing where no turn of the conversation runs, or the account does not
 * hold it. Note that the count is raised in one statement, because a
 * native agent's calls of one step run at once, and each must see the
 * other's reservation (`description-edit.ts`).
 */
export function reserveTurnDescriptionNotes(
  userId: string,
  conversationId: string,
  requested: number,
): AgentStoreEffect<Option.Option<TurnDescriptionNotes>> {
  return reserveTurnNotes({ userId, conversationId, requested });
}

/** Settles a reservation once its save answered: the notes it reserved and did not take given back, which is all of them for a refused call. */
export function settleTurnDescriptionNotes(
  userId: string,
  turnId: string,
  requested: number,
  saved: number,
): AgentStoreEffect<void> {
  return releaseTurnNotes({ userId, turnId, released: requested - saved });
}

/** The agent under another title, or none, which its tab shows in place of the model's name; nothing for an agent of a workspace the account is not in. */
export function renameAgent(
  userId: string,
  agentId: string,
  title: string | null,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(renameAgentCommitted(userId, agentId, title), Option.map(agentOf));
}

/** An agent as a write left it, and the transaction it committed in; none where it changed no row. */
export interface AgentCommitted {
  readonly agent: Agent;
  readonly txid?: string;
}

/** The agent's row without the transaction it was returned with. */
function agentOf({ agent }: AgentCommitted): Agent {
  return agent;
}

/** The agent renamed, as `renameAgent` renames it, and the transaction its row was written in. */
export function renameAgentCommitted(
  userId: string,
  agentId: string,
  title: string | null,
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.map(
    updateAgentTitle({ userId, agentId, title }),
    Option.map(({ txid, ...agent }) => ({ agent, txid })),
  );
}

/** The account's agent archived, stamped now with who archived it, by default the account itself, or brought back, which clears who did; its conversation and what it published are kept either way. An archive, this one and every other below, settles the agent's open inbox items that ask, its notices left open, in the same transaction, and bringing the agent back opens again those its archive settled (`inbox-settle.ts`). Nothing for an agent of a workspace the account is not in. */
export function archiveAgent(
  userId: string,
  agentId: string,
  archived: boolean,
  archivedBy: StoredArchive = { by: AGENT_ARCHIVER.MEMBER, userId },
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(
    archiveAgentCommitted(userId, agentId, archived, archivedBy),
    Option.map(agentOf),
  );
}

/** Whether a pilot of the task stands unarchived, whoever started it, read by the task's id alone for a caller that has reached the task. */
export function taskPilotStands(taskId: string): AgentStoreEffect<boolean> {
  return Effect.map(findLivePilot({ taskId, besides: null }), Option.isSome);
}

/** An archive's or a bring-back's write: the agent as it then stands, and whether this write archived one that stood unarchived. */
export interface AgentArchiveCommitted extends AgentCommitted {
  readonly archivedNow: boolean;
}

/** The agent's archive stamp under its row's lock, as an archive reads it before it writes its own. */
const lockAgentArchivedAt = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ archivedAt: Schema.NullOr(InstantColumnSchema) }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ archivedAt: agentTable.archivedAt })
        .from(agentTable)
        .where(reachableAgent(userId, agentId))
        .limit(1)
        .for("update", { of: agentTable }),
    ),
});

/**
 * The agent archived or brought back, as `archiveAgent` does it, and the
 * transaction its row was written in; an archive reads the row under its
 * lock first, so of two archives at once only the first answers that it
 * archived the agent, and an archive already standing is kept as it stands,
 * its stamp and record unmoved, so bringing the agent back opens again every
 * item it settled.
 */
export function archiveAgentCommitted(
  userId: string,
  agentId: string,
  archived: boolean,
  archivedBy: StoredArchive = { by: AGENT_ARCHIVER.MEMBER, userId },
): AgentStoreEffect<Option.Option<AgentArchiveCommitted>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        if (!archived) yield* lockAgentTask(agentId);
        const archivedBefore = archived
          ? Option.getOrUndefined(yield* lockAgentArchivedAt({ userId, agentId }))?.archivedAt
          : undefined;
        // An archive already standing is kept as it stands, so its stamp still names the items it settled.
        if (archived && archivedBefore !== undefined && archivedBefore !== null) {
          const kept = yield* findAgent({ userId, agentId });
          return Option.map(kept, (agent) => ({ agent, archivedNow: false }));
        }
        // The archive standing before the write, whose stamp names the items it settled.
        const standing = archived ? Option.none() : yield* findAgent({ userId, agentId });
        const written = yield* updateAgentArchived({
          userId,
          agentId,
          archivedAt: archived ? now : null,
          archivedBy: archived ? archivedBy : null,
        });
        if (Option.isNone(written)) return Option.none();
        // An archive settles the agent's open inbox items that ask, and bringing it back opens again those that archive settled.
        if (archived) yield* settleAgentInboxItems([agentId], now);
        const standingArchive = Option.getOrUndefined(standing)?.archivedAt;
        if (standingArchive !== undefined && standingArchive !== null) {
          yield* reopenAgentInboxItems(agentId, standingArchive);
        }
        const { txid, ...agent } = written.value;
        return Option.some({ agent, txid, archivedNow: archived && archivedBefore === null });
      }),
    ),
  );
}

/** The agent's conversation row under its own lock, the one every write of its lines and turns takes; nothing where no such conversation stands. */
const lockAgentConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for("update"),
    ),
});

const unarchiveIfStamped = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    archivedAt: Schema.Date,
  }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, archivedAt }) =>
    Database.use((db) =>
      db
        .update(agentTable)
        .set({ archivedAt: null, archivedBy: null })
        .where(and(reachableAgent(userId, agentId), eq(agentTable.archivedAt, archivedAt)))
        .returning({ id: agentTable.id }),
    ),
});

/** Brings the agent back, but only from the archive stamped at `archivedAt`, the one its reader saw, so an archive made since stands; answers whether it was brought back. */
export function unarchiveAgentFrom(
  userId: string,
  agentId: string,
  archivedAt: Date,
): AgentStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* lockAgentTask(agentId);
        const rows = yield* unarchiveIfStamped({ userId, agentId, archivedAt });
        if (rows.length === 0) return false;
        // The items that very archive settled open again with it.
        yield* reopenAgentInboxItems(agentId, archivedAt);
        return true;
      }),
    ),
  );
}

/**
 * The account's own pin of the agent set as asked: from now, or from the
 * instant already standing, so pinning twice moves nothing, at the position
 * given where one is; or taken away.
 * Every other member's pin stands as it was. Nothing for an agent the
 * account cannot read, which is neither pinned nor unpinned. An agent on a
 * plan is pinned as one with none is, and stands in the sidebar's Pinned
 * section beside the plans.
 */
export function pinAgent(
  userId: string,
  agentId: string,
  pinned: boolean,
  position?: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(pinAgentCommitted(userId, agentId, pinned, position), Option.map(agentOf));
}

/** The account's pin of the agent set, as `pinAgent` sets it, and the transaction the pin was written in; none where it stood as asked. */
export function pinAgentCommitted(
  userId: string,
  agentId: string,
  pinned: boolean,
  position?: string,
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.gen(function* () {
    // Note that a pin is the member's reading of the agent, so it is gated as their read of it is, its task's reach among it.
    const found = yield* findVisibleAgent({ userId, agentId });
    if (Option.isNone(found)) return Option.none();
    const now = yield* DateTime.nowAsDate;
    const written = !pinned
      ? yield* deleteAgentPin({ userId, agentId })
      : position === undefined
        ? yield* insertAgentPin({ userId, agentId, now })
        : yield* placeAgentPin({ userId, agentId, position, now });
    const txid = Option.getOrUndefined(written)?.txid;
    return Option.some(txid === undefined ? { agent: found.value } : { agent: found.value, txid });
  });
}

/**
 * The account's read mark of the agent set as asked (`READ_MARK`), and the
 * transaction it was written in; none where the account may not read the
 * agent, or where it works on a task, whose mark is the task's. Every other member's mark stands as it was.
 */
export function markAgentReadCommitted(
  userId: string,
  agentId: string,
  mark: ReadMark,
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.gen(function* () {
    // Note that a read mark is gated as the member's read of the agent is, as a pin is, and kept only for an agent with no task, the one a list reads it on.
    const found = yield* findVisibleAgent({ userId, agentId });
    if (Option.isNone(found) || found.value.taskId !== null) return Option.none();
    const now = yield* DateTime.nowAsDate;
    const written =
      mark === READ_MARK.READ
        ? yield* markAgentRead({ userId, agentId, now })
        : mark === READ_MARK.SEEN
          ? yield* markAgentSeen({ userId, agentId, now })
          : yield* markAgentUnread({ userId, agentId });
    const txid = Option.getOrUndefined(written)?.txid;
    return Option.some(txid === undefined ? { agent: found.value } : { agent: found.value, txid });
  });
}

const findAgentConversation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ userId: agentTable.userId, conversationId: agentTable.conversationId })
        .from(agentTable)
        .where(eq(agentTable.id, agentId)),
    ),
});

/**
 * The agent's conversation under the member who started it, whoever asks;
 * nothing where no such agent stands. Only for an id the service recorded
 * itself, such as the agent a run was claimed for, because it reads past
 * any account's gate.
 */
export function agentConversation(
  agentId: string,
): AgentStoreEffect<Option.Option<ConversationTarget>> {
  return findAgentConversation(agentId);
}

const SettledTurnAgentSchema = Schema.Struct({
  kind: Schema.Literals(Object.values(AGENT_KIND)),
  organizationId: Schema.String,
});

const findSettledTurnAgent = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: SettledTurnAgentSchema,
  execute: (turnId) =>
    Database.use((db) =>
      db
        .select({ kind: agentTable.kind, organizationId: agentTable.organizationId })
        .from(turns)
        .innerJoin(agentTable, eq(agentTable.conversationId, turns.conversationId))
        .where(
          and(
            eq(turns.id, turnId),
            inArray(turns.status, [TURN_STATUS.SETTLED, TURN_STATUS.CANCELED, TURN_STATUS.FAILED]),
          ),
        ),
    ),
});

/** What the agent whose turn settled is, and the workspace it belongs to. */
export type SettledTurnAgent = typeof SettledTurnAgentSchema.Type;

/**
 * What the agent whose turn this is is, and its workspace, where the turn
 * stands ended; nothing where no agent stands on its conversation or the
 * turn's end was rolled back with the transaction that wrote it. Only for a
 * turn the service settled itself, because it reads past any account's gate.
 */
export function settledTurnAgent(
  turnId: string,
): AgentStoreEffect<Option.Option<SettledTurnAgent>> {
  return findSettledTurnAgent(turnId);
}

/**
 * Archives the agent as `archiveAgent` does, but only where it stands
 * unarchived, its conversation's lines have run no further than the
 * `seenSeq` its reader saw, so an agent a message woke since stands, and it
 * has no pull request open (`noOpenPullRequest`) and no inbox item open
 * (`noOpenInboxItem`); answers whether it was archived.
 */
export function archiveUnmovedAgent(
  userId: string,
  agentId: string,
  seenSeq: number,
): AgentStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const archivedAt = yield* DateTime.nowAsDate;
        const rows = yield* updateUnmovedArchived({
          userId,
          agentId,
          seenSeq,
          archivedAt,
          archivedBy: null,
        });
        yield* settleAgentInboxItems(
          rows.map(({ id }) => id),
          archivedAt,
        );
        return rows.length > 0;
      }),
    ),
  );
}

const findConversationSeq = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ seq: conversations.nextMessageSeq })
        .from(agentTable)
        .innerJoin(conversations, eq(conversations.id, agentTable.conversationId))
        .where(reachableAgent(userId, agentId)),
    ),
});

/** How far the agent's conversation's lines have run, as `archiveUnmovedAgent` is handed it; nothing for an agent the account cannot read. */
export function agentConversationSeq(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<number>> {
  return Effect.map(
    findConversationSeq({ userId, agentId }),
    Option.map((row) => row.seq),
  );
}

/** The title written where the agent has none yet, so a name the developer gave stands whatever this carries; answers whether it was written. */
export function fillAgentTitle(
  userId: string,
  agentId: string,
  title: string,
): AgentStoreEffect<boolean> {
  return Effect.map(fillAgentTitleRows({ userId, agentId, title }), (rows) => rows.length > 0);
}

/**
 * The agent's author settled: the one given where none stands, and the one
 * standing otherwise, which is answered either way so a second session's
 * word never moves what the first one's instructions and checkout used;
 * nothing for an agent of a workspace the account is not in.
 */
export function settleAgentAuthor(
  userId: string,
  agentId: string,
  author: AgentAuthor,
): AgentStoreEffect<Option.Option<AgentAuthor>> {
  return Effect.map(settleAgentAuthorRow({ userId, agentId, author }), (row) =>
    Option.map(row, (settled) => settled.author),
  );
}

/**
 * The agent's author recorded over whatever stood, which is how an agent
 * that wrote as its developer records why the App opened its pull request
 * once their token was refused; nothing for an agent of a workspace the
 * account is not in.
 */
export function recordAgentAuthor(
  userId: string,
  agentId: string,
  author: AgentAuthor,
): AgentStoreEffect<void> {
  return updateAgentAuthor({ userId, agentId, author });
}

/** How the agent is run (`AgentRouting`); nothing for an agent of a workspace the account is not in. */
export function readAgentRouting(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<AgentRouting>> {
  return Effect.map(
    findAgentRouting({ userId, agentId }),
    // Note that a conversation from before the runtime column ran on the retired runtime, so it reads as that one.
    Option.map((row) => ({ ...row, runtime: row.runtime ?? CONVERSATION_RUNTIME.RETIRED })),
  );
}

/** The workspace of the agent under this id, where the account sees it whole (`agentVisibleTo`); nothing otherwise. */
export function readVisibleAgentWorkspace(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<string>> {
  return Effect.map(
    findVisibleAgentWorkspace({ userId, agentId }),
    Option.map((row) => row.organizationId),
  );
}

/**
 * The native runtime of each conversation named, keyed by conversation;
 * one on the retired runtime, or from before the column, is absent. Only for ids a gate
 * already read, as above.
 */
export function nativeRuntimesOfReached(
  conversationIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, (typeof NATIVE_RUNTIMES)[number]>> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findNativeRuntimes({ conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row.runtime])),
  );
}

/** A native agent's runtime and who pays for it, which together decide the models it may move to (`runtimeModelRule`). */
export interface NativeRoute {
  readonly runtime: (typeof NATIVE_RUNTIMES)[number];
  /** Null for an agent from before the column. */
  readonly payer: AgentPayer | null;
}

/**
 * The native runtime of the agent of the conversation named and its payer;
 * none on the retired runtime, or from before the column. Only for an id a gate already
 * read, as above.
 */
export function nativeRouteOfReached(
  conversationId: string,
): AgentStoreEffect<Option.Option<NativeRoute>> {
  return findNativeRoute({ conversationId });
}

/** The harness's own session or thread id recorded on the agent's conversation, over whatever stood; answers whether the account reached the agent. */
export function recordAgentNativeSession(
  userId: string,
  agentId: string,
  nativeSession: string,
): AgentStoreEffect<boolean> {
  return Effect.map(
    updateAgentNativeSession({ userId, agentId, nativeSession }),
    (rows) => rows.length > 0,
  );
}

/**
 * What the turns' messages of a Claude Code or Codex conversation have
 * handed its harness's session, as the JSON it was handed
 * (`coder-host/turn-context.ts`'s `TurnHanded`, whose shape is the service's
 * and is read back unread here); null before the first turn's message, and
 * for a conversation the account does not hold.
 */
export function readNativeHanded(target: ConversationTarget): AgentStoreEffect<WireValue | null> {
  return Effect.map(findNativeHanded(target), (row) =>
    Option.match(row, { onNone: () => null, onSome: ({ handed }) => handed }),
  );
}

/** What the turns' messages have handed the harness's session, written over whatever stood; nothing for a conversation the account does not hold. */
export function recordNativeHanded(
  target: ConversationTarget,
  handed: WireValue,
): AgentStoreEffect<void> {
  return updateNativeHanded({ ...target, handed });
}

/** The digest of the runner's bearer recorded on the agent's conversation, or null to retire it; answers whether the account reached the agent. */
export function recordAgentRunnerToken(
  userId: string,
  agentId: string,
  runnerTokenHash: string | null,
): AgentStoreEffect<boolean> {
  return Effect.map(
    updateAgentRunnerToken({ userId, agentId, runnerTokenHash }),
    (rows) => rows.length > 0,
  );
}

/** A coding agent's conversation, as the runner whose bearer has this digest reaches it. */
export interface RunnerTokenConversation {
  /** The account that started the agent and opened its conversation, which the runner's tools act as. */
  readonly userId: string;
  readonly conversationId: string;
  readonly runtimeSessionId: string | null;
}

/**
 * The coding agent's conversation whose runner was handed the bearer of this
 * digest (`recordAgentRunnerToken`), where its starter still reaches the
 * agent; nothing for a digest no standing conversation holds, a retired
 * bearer's among them, and nothing once the starter left the agent's
 * workspace, since the runner acts as them.
 */
export function readRunnerTokenConversation(
  runnerTokenHash: string,
): AgentStoreEffect<Option.Option<RunnerTokenConversation>> {
  return Effect.gen(function* () {
    const found = yield* findRunnerTokenConversation({ runnerTokenHash });
    if (Option.isNone(found)) return found;
    const { userId, conversationId } = found.value;
    const agent = yield* findAgentHeaderOfConversation({ userId, conversationId });
    return Option.isSome(agent) ? found : Option.none();
  });
}

/** When the newest turn ended, or null where it has not or there is none. */
function endedAtOf(
  newest: Option.Option<{ readonly status: string; readonly settledAt: Date | null }>,
): Date | null {
  const ended = Option.filter(newest, (turn) =>
    ENDED_TURN_STATUSES.some((status) => status === turn.status),
  );
  // An ended turn with no settle time stamped reads as ended long ago, so the sweep takes it at once.
  return Option.isSome(ended) ? (ended.value.settledAt ?? new Date(0)) : null;
}

/** Where a native agent's run stands, as the sweep reads it from its sandbox's agent tag. */
export interface NativeRunStanding {
  /** The agent's conversation, which a Terminal's lease is held on. */
  readonly conversationId: string;
  /** The agent's starter, whose account a line to its runner is queued under. */
  readonly userId: string;
  /** When its newest turn ended; null while that turn is queued or running (a runner waiting on a wakeup among it), or before it has any turn. */
  readonly endedAt: Date | null;
}

/**
 * Where the run of the agent under this id stands, read with no account in
 * hand, because the scheduled sweep stops ended native sandboxes for every
 * account: its conversation, and when its newest turn ended. Nothing for an
 * id that names no agent, an agent on the retired runtime, or one whose conversation was
 * deleted. Only for an id a sandbox we opened carries; it answers nothing
 * a member wrote.
 */
export function readNativeRunStanding(
  agentId: string,
): AgentStoreEffect<Option.Option<NativeRunStanding>> {
  return Effect.map(readNativeRunStandings([agentId]), (standings) =>
    Option.fromUndefinedOr(standings.get(agentId)),
  );
}

/** Where the run of each agent under these ids stands, as `readNativeRunStanding` reads one, in two statements for the lot, keyed by agent id; an id it answers nothing for is absent. */
export function readNativeRunStandings(
  agentIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, NativeRunStanding>> {
  return Effect.gen(function* () {
    const ids = agentIds.filter((agentId) => AGENT_ID_PATTERN.test(agentId));
    if (ids.length === 0) return new Map();
    const found = yield* findNativeAgentConversations({ agentIds: ids });
    const newest = yield* latestTurnsOfReached(found.map((row) => row.conversationId));
    return new Map(
      found.map(({ agentId, conversationId, userId }): [string, NativeRunStanding] => [
        agentId,
        {
          conversationId,
          userId,
          endedAt: endedAtOf(Option.fromUndefinedOr(newest.get(conversationId))),
        },
      ]),
    );
  });
}

/** The agent whose conversation this is, which is what a session admitted for the conversation runs; nothing for an agent of a workspace the account is not in, or no agent's. */
export function readAgentOfConversation(
  userId: string,
  conversationId: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return findAgentOfConversation({ userId, conversationId });
}

/** An agent as far as its header reads it (`AGENT_HEADER_COLUMNS`). */
export type AgentHeader = Pick<
  Agent,
  "id" | "userId" | "organizationId" | "taskId" | "repository" | "title" | "archivedAt"
> & { readonly machine: AgentMachineKind };

/**
 * The header of the agent whose conversation this is, for a caller that needs
 * no more of it than who it is, its workspace, task, repository, title,
 * archive, and machine; nothing where `readAgentOfConversation` answers nothing.
 */
export function readAgentHeaderOfConversation(
  userId: string,
  conversationId: string,
): AgentStoreEffect<Option.Option<AgentHeader>> {
  return findAgentHeaderOfConversation({ userId, conversationId });
}

/** What the agent's own conversation holds in its model's context: the model it runs on now, its newest step, and when its harness last compacted it; null for each of the last two before it happens. */
export interface AgentContextRow {
  readonly model: string;
  readonly contextWindow: ContextWindow;
  readonly lastStep: StoredAgentStep | null;
  readonly compactedAt: Date | null;
}

/** The newest model step of the agent's own conversation, which replaces the one before it; nothing written for an agent of a workspace the account is not in. */
export function recordAgentStep(
  userId: string,
  agentId: string,
  lastStep: StoredAgentStep,
): AgentStoreEffect<void> {
  return updateAgentStep({ userId, agentId, lastStep });
}

/** When the harness compacted the agent's own conversation; nothing written for an agent of a workspace the account is not in. */
export function recordAgentCompaction(
  userId: string,
  agentId: string,
  at: Date,
): AgentStoreEffect<void> {
  return updateAgentCompaction({ userId, agentId, at });
}

/** What the agent's own conversation holds in its model's context, or nothing for an agent of a workspace the account is not in. */
export function readAgentContext(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<AgentContextRow>> {
  return findAgentContext({ userId, agentId });
}

/** What an agent chose for one worker, and when the delegation was recorded. */
export interface AgentDelegation extends ModelChoice {
  readonly createdAt: Date;
}

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
    Database.use((db) =>
      db
        .select({
          model: agentDelegationTable.model,
          effort: agentDelegationTable.effort,
          createdAt: conversations.createdAt,
        })
        .from(agentDelegationTable)
        .innerJoin(conversations, eq(conversations.id, agentDelegationTable.childConversationId))
        .where(
          and(
            eq(agentDelegationTable.childConversationId, childConversationId),
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

/** The delegation recorded under this child of the account's conversation, or nothing where none stands: another account's, another agent's, or no delegation at all. */
export function readDelegation(
  parent: ConversationTarget,
  childConversationId: string,
): AgentStoreEffect<Option.Option<AgentDelegation>> {
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
    Database.use((db) =>
      db
        .select({
          childConversationId: agentDelegationTable.childConversationId,
          createdAt: conversations.createdAt,
        })
        .from(agentDelegationTable)
        .innerJoin(conversations, eq(conversations.id, agentDelegationTable.childConversationId))
        .where(
          and(
            inArray(agentDelegationTable.childConversationId, [...childConversationIds]),
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

/** When each of these children of the account's conversation was delegated, by child, for those a delegation was recorded under; none asked, none read. */
export function delegationStartsOf(
  parent: ConversationTarget,
  childConversationIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, Date>> {
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

/**
 * What sent one of the developer's lines to an agent, as a reader names it:
 * a member by their account's id and the name it holds now, or nobody where
 * their account is gone; the brain; an automation by the name its run kept; or
 * GitHub by the login the line kept; or another coding agent by the name
 * its send kept, and the model it ran on then, which its harness is read
 * off, where the line kept one, and the agent itself, by its id and the
 * task it works on, where the line kept it and it still stands. Note that
 * the model is only ever the one the line kept, never the agent's now,
 * because a byline names who sent it as it was, whatever the agent runs on
 * since.
 */
export type LineSent =
  | {
      readonly kind: typeof MESSAGE_SENDER.MEMBER;
      readonly member: { readonly userId: string; readonly name: string } | undefined;
    }
  | { readonly kind: typeof MESSAGE_SENDER.APP }
  | {
      readonly kind: typeof MESSAGE_SENDER.AUTOMATION;
      readonly name: string;
      /** The automation's id, where the line kept it. */
      readonly automationId: string | undefined;
    }
  | { readonly kind: typeof MESSAGE_SENDER.GITHUB; readonly login: string }
  | {
      readonly kind: typeof MESSAGE_SENDER.AGENT;
      readonly name: string;
      readonly model: string | undefined;
      readonly agent: SendingAgent | undefined;
    };

/** The coding agent that sent a line, as it stands now, by its id. */
interface SendingAgent {
  readonly id: string;
}

/** A line's sender as its row keeps it, with the member's account where it still stands. */
const LineSenderRowSchema = Schema.Struct({
  id: Schema.String,
  sender: messageSenderSchema,
  memberId: Schema.NullOr(Schema.String),
  memberName: Schema.NullOr(Schema.String),
  senderName: Schema.NullOr(Schema.String),
  senderModel: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  automationId: Schema.NullOr(Schema.String),
});

const findLineSenders = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    messageIds: Schema.Array(Schema.String),
  }),
  Result: LineSenderRowSchema,
  execute: ({ userId, conversationId, messageIds }) =>
    Database.use((db) =>
      db
        .select({
          id: messages.id,
          sender: messages.sender,
          memberId: user.id,
          memberName: user.name,
          senderName: messages.senderName,
          senderModel: messages.senderModel,
          agentId: agentTable.id,
          automationId: messages.senderAutomationId,
        })
        .from(messages)
        .leftJoin(user, eq(user.id, messages.senderUserId))
        .leftJoin(agentTable, eq(agentTable.id, messages.senderAgentId))
        .where(
          and(
            inArray(messages.id, [...messageIds]),
            eq(messages.userId, userId),
            eq(messages.conversationId, conversationId),
            isNotNull(messages.sender),
          ),
        ),
    ),
});

/** A sender's row as a reader names it; an automation's, GitHub's, or an agent's that kept no name names nothing. */
function lineSentOf(row: typeof LineSenderRowSchema.Type): LineSent | undefined {
  switch (row.sender) {
    case MESSAGE_SENDER.MEMBER:
      return {
        kind: MESSAGE_SENDER.MEMBER,
        member:
          row.memberId === null || row.memberName === null
            ? undefined
            : { userId: row.memberId, name: row.memberName },
      };
    case MESSAGE_SENDER.APP:
      return { kind: MESSAGE_SENDER.APP };
    case MESSAGE_SENDER.AUTOMATION:
      return row.senderName === null
        ? undefined
        : {
            kind: MESSAGE_SENDER.AUTOMATION,
            name: row.senderName,
            automationId: row.automationId ?? undefined,
          };
    case MESSAGE_SENDER.GITHUB:
      return row.senderName === null
        ? undefined
        : { kind: MESSAGE_SENDER.GITHUB, login: row.senderName };
    case MESSAGE_SENDER.AGENT:
      return row.senderName === null
        ? undefined
        : {
            kind: MESSAGE_SENDER.AGENT,
            name: row.senderName,
            model: row.senderModel ?? undefined,
            agent: row.agentId === null ? undefined : { id: row.agentId },
          };
  }
}

/**
 * What sent each of these rows of the account's conversation, by row, for
 * the lines whose sender was kept: every row but a developer's line to an
 * agent, and a line written before senders were, names none. None asked,
 * none read.
 */
export function lineSendersOf(
  target: ConversationTarget,
  messageIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, LineSent>> {
  if (messageIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLineSenders({ userId: target.userId, conversationId: target.conversationId, messageIds }),
    (rows) =>
      new Map(
        rows.flatMap((row) => {
          const sent = lineSentOf(row);
          return sent === undefined ? [] : [[row.id, sent] as const];
        }),
      ),
  );
}

/** Where in a turn under way one of the developer's lines arrived: the turn's journal, by its row, and the steps it had begun before the line. */
export interface LinePlace {
  readonly journalId: string;
  readonly afterStep: number;
}

/** The journal of the turn that took a line in, which shares the turn's id as its client id. */
const takingJournal = alias(messages, "taking_journal");

const findLinePlaces = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    messageIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({ id: Schema.String, journalId: Schema.String, afterStep: Schema.Int }),
  execute: ({ userId, conversationId, messageIds }) =>
    Database.use((db) =>
      db
        .select({
          id: messages.id,
          journalId: takingJournal.id,
          afterStep: sql<number>`${messages.takenAfterStep}`.mapWith(Number),
        })
        .from(messages)
        .innerJoin(
          takingJournal,
          and(
            eq(takingJournal.conversationId, messages.conversationId),
            eq(takingJournal.clientId, sql`${messages.turnId}::text`),
          ),
        )
        .where(
          and(
            inArray(messages.id, [...messageIds]),
            eq(messages.userId, userId),
            eq(messages.conversationId, conversationId),
            isNotNull(messages.takenAfterStep),
          ),
        ),
    ),
});

/**
 * Where each of these rows of the account's conversation arrived in the
 * turn that took it in, by row, for the developer's lines a turn under way
 * took after its first step: every other row, a line that opened its turn,
 * and one taken before places were kept, names none. None asked, none read.
 */
export function linePlacesOf(
  target: ConversationTarget,
  messageIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, LinePlace>> {
  if (messageIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLinePlaces({ userId: target.userId, conversationId: target.conversationId, messageIds }),
    (rows) =>
      new Map(rows.map(({ id, journalId, afterStep }) => [id, { journalId, afterStep }] as const)),
  );
}

/** One worker an agent delegated to, as its delegation recorded it: the call, its child conversation, and the pair it runs on. */
export interface DelegationRecord {
  readonly callId: string;
  readonly childConversationId: string;
  readonly model: string;
  readonly effort: string;
  /** When the worker's conversation was opened, which is when its delegation was made. */
  readonly createdAt: Date;
}

const findDelegations = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, parentConversationId: Schema.String }),
  Result: Schema.Struct({
    callId: Schema.String,
    childConversationId: Schema.String,
    model: Schema.String,
    effort: Schema.String,
    createdAt: InstantColumnSchema,
  }),
  execute: ({ userId, parentConversationId }) =>
    Database.use((db) =>
      db
        .select({
          callId: agentDelegationTable.callId,
          childConversationId: agentDelegationTable.childConversationId,
          model: agentDelegationTable.model,
          effort: agentDelegationTable.effort,
          createdAt: conversations.createdAt,
        })
        .from(agentDelegationTable)
        .innerJoin(conversations, eq(conversations.id, agentDelegationTable.childConversationId))
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNotNull(agentDelegationTable.callId),
            isNull(conversations.deletedAt),
          ),
        )
        .orderBy(asc(conversations.createdAt)),
    ),
});

/** Every worker the account's conversation delegated to by a call it kept, oldest first. */
export function delegationsOf(
  parent: ConversationTarget,
): AgentStoreEffect<readonly DelegationRecord[]> {
  return findDelegations({ userId: parent.userId, parentConversationId: parent.conversationId });
}

const findDelegationTitles = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, parentConversationId: Schema.String }),
  Result: Schema.Struct({ callId: Schema.String, title: Schema.String }),
  execute: ({ userId, parentConversationId }) =>
    Database.use((db) =>
      db
        .select({ callId: agentDelegationTable.callId, title: conversations.title })
        .from(agentDelegationTable)
        .innerJoin(conversations, eq(conversations.id, agentDelegationTable.childConversationId))
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNotNull(agentDelegationTable.callId),
            isNotNull(conversations.title),
            isNull(conversations.deletedAt),
          ),
        )
        .orderBy(asc(conversations.createdAt)),
    ),
});

/** Every titled worker of the account's conversation by the call that delegated it, oldest first; one recorded before its call was kept reads as untitled. */
export function delegationTitlesOf(
  parent: ConversationTarget,
): AgentStoreEffect<readonly AgentSubagentTitle[]> {
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
    Database.use((db) =>
      db
        .select({ childConversationId: agentDelegationTable.childConversationId })
        .from(agentDelegationTable)
        .innerJoin(conversations, eq(conversations.id, agentDelegationTable.childConversationId))
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNull(conversations.title),
            gt(conversations.createdAt, since),
            isNull(conversations.deletedAt),
          ),
        ),
    ),
});

/** The children of the account's conversation delegated after `since` that have no title yet, which is where a title may still land. */
export function untitledDelegationsSince(
  parent: ConversationTarget,
  since: Date,
): AgentStoreEffect<ReadonlySet<string>> {
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
