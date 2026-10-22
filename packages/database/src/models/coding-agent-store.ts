import { pickPersonaName } from "@luke/features/agent-persona";
import { automationFiringSchema } from "@luke/features/automation-wire";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_AUTHOR,
  CODING_AGENT_BRIEF,
  CODING_AGENT_KIND,
  CODING_AGENT_PAYER,
  CONTEXT_WINDOW,
  type CodingAgentAuthor,
  type CodingAgentBrief,
  type CodingAgentKind,
  type CodingAgentPayer,
  type CodingAgentPullRequest,
  type CodingAgentSubagentTitle,
  type ContextWindow,
  codingAgentPullRequestSchema,
  contextWindowSchema,
} from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@luke/features/github-repositories-wire";
import {
  integrationConnectionNameSchema,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import type { ModelChoice } from "@luke/features/models-wire";
import { TURN_STATUS } from "@luke/wire";
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
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Random, Schema, SchemaTransformation } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError, queryBuilder } from "../core/query.js";
import { agentPin } from "../schemas/agent-pin.js";
import { organization, user } from "../schemas/auth.js";
import {
  codingAgent,
  codingAgentDelegation,
  type StoredAgentStep,
  type StoredArchive,
  type StoredAutomationOrigin,
  type StoredPullRequest,
  type StoredStartedFrom,
} from "../schemas/coding-agent.js";
import { asks, conversations, messages, turns } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { voiceSessions, voiceTranscriptSegments } from "../schemas/voice.js";
import {
  CONVERSATION_KIND,
  CONVERSATION_RUNTIME,
  type ConversationRuntime,
  MESSAGE_SENDER,
} from "../storage-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";
import {
  awaitingLinesOf,
  awaitingLinesOfReached,
  type LatestTurn,
  latestTurnsOf,
  latestTurnsOfReached,
  type TurnUsageRow,
  turnUsagesOf,
} from "./message-reads.js";
import { stampConversationsDeleted } from "./soft-delete.js";
import { TaskAgentUnstopped, type TaskDeleteGuard } from "./task-store.js";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  agentSeenBy,
  reachableTask,
  taskReachableBy,
  workspaceReachableBy,
} from "./workspace-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * coding-agent-store.ts -- the coding agents started on a workspace's tasks, each one conversation and one row linking it to its task.
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
 * serialises two Starts of one task, so a retry carrying the key of a Start
 * already made finds that agent rather than opening a second conversation
 * beside it, and says which it did, since only a Start that made the agent
 * opens its eve session. The agent's conversation is a `coding_agent`
 * conversation of the account that started it, opened here and named on the
 * row, which carries that account as `userId`, so a member reads the
 * conversation under its starter; its messages and turns are the
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
 * every task the list names, so the list asks GitHub nothing, as the wire
 * carries it; the row keeps more than that, the head it was read at, when
 * it merged, and its lines by directory, read back whole by the next read
 * of it alone. An agent
 * the developer archived is a stamp on its row: every list leaves it out
 * but the task's own where it asks for archived agents, and a read of the
 * agent by its id still finds it, so its transcript and pull request stand.
 * A pin of an agent with no plan is the reading member's own
 * (`agent-pin.ts`), as a plan's is, so one member's pin reads pinned for
 * them alone, and is kept apart from the archive, so an agent archived and
 * brought back is pinned again.
 * A member's operator is an agent of kind operator with no task and no
 * repository, started blank, of which the member holds at most one standing
 * per workspace: a Start of one under the workspace's lock answers the one
 * standing, and the partial unique index on the row holds it to one where
 * anything else inserted it first (`ensureOperator` in the coder host).
 * Who the agent writes as on GitHub is settled once, by its first session,
 * and a later session's word is answered with the one standing rather than
 * written over it; it is written over only where the developer's token was
 * refused as the service opened the agent's pull request, with why.
 * Every function is an effect over the ambient `SqlClient` and names no
 * database of its own.
 */

type CodingAgentStoreFailure = QueryError | Schema.SchemaError;

/** What a coding agent store operation answers: an effect over the ambient client, composed into whatever called it. */
export type CodingAgentStoreEffect<A> = Effect.Effect<A, CodingAgentStoreFailure, DatabaseServices>;

/** One coding agent as the service holds it: what the tabs read, and what the agent's own turns run on. */
export interface CodingAgent {
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
  /** The agent of the same plan this one was started from, with its replay's counts; null for one started afresh. */
  readonly startedFrom: StoredStartedFrom | null;
  readonly conversationId: string;
  readonly model: string;
  readonly effort: string;
  readonly contextWindow: ContextWindow;
  /** The plan text the agent was handed; null where it was handed a prompt instead. */
  readonly planSnapshot: string | null;
  /** The developer's words the agent was handed in the plan's place; null where it was handed the plan. */
  readonly prompt: string | null;
  /** The GitHub repository the agent works in, as `owner/name`; null for an agent with none, which does no repository work. */
  readonly repository: string | null;
  /** The branch checked out in the sandbox as the last turn ended; null before one ends or where the checkout stood detached. */
  readonly branch: string | null;
  /** The branch the agent's checkout is cloned at, as its starter named it; null for the repository's default branch. */
  readonly startBranch: string | null;
  /** The agent's title as its tab shows it; null falls back to the model's name. */
  readonly title: string | null;
  /** The human name the agent was given as it was created; null for an agent from before names were given. */
  readonly personaName: string | null;
  /** When the developer archived the agent; null while it is not. */
  readonly archivedAt: Date | null;
  /** Who archived the agent, and why; null while it is not, and for an archive no one was recorded for. */
  readonly archivedBy: StoredArchive | null;
  /** The MCP servers switched off for this agent, which its next turns are not handed; empty where none is. */
  readonly disabledServers: readonly string[];
  /** Who the agent's commits are by and its pull request is opened as; null until its first session settles it. */
  readonly author: CodingAgentAuthor | null;
  /** How its repository was reached as it started: the workspace's GitHub App, or its starter's own token. */
  readonly githubAccess: GitHubAccess;
  /** What the agent is: a coder, or its member's operator. */
  readonly kind: CodingAgentKind;
  readonly createdAt: Date;
}

/**
 * One coding agent as a list line reads it (`CODING_AGENT_LINE_COLUMNS`):
 * the agent without what it was handed, the plan's text or the developer's
 * prompt, and without the run that started it, which only its own page and
 * its own turns read; which of the two it was handed, or neither, which its
 * tab's brief is drawn from, and its automation's name stand in their place.
 */
export interface CodingAgentLine
  extends Omit<CodingAgent, "automationOrigin" | "planSnapshot" | "prompt"> {
  /** The name of the automation whose run started the agent, as it stood then; null for one started by hand. */
  readonly automationName: string | null;
  /** What the agent was handed as its first message: the plan, the developer's prompt, or nothing, for one started blank. */
  readonly brief: CodingAgentBrief;
}

/** One agent with no plan as the sidebar lists it for its reader: the agent's line, when the reader pinned it, and where they dragged the pin; null where they hold no pin of it, or it stands by that instant. */
export interface TasklessCodingAgent extends CodingAgentLine {
  readonly pinnedAt: Date | null;
  readonly pinPosition: string | null;
}

/** What a Start answered: the agent, and whether this Start made it or a retry found it. */
export interface CodingAgentStarted {
  readonly agent: CodingAgent;
  readonly created: boolean;
  /** The transaction the agent's row was written in, where this Start wrote it. */
  readonly txid?: string;
}

/** The newest turn of an agent's conversation, as its status is read from it; nothing before the first turn. The read is the store's own (`message-reads.ts`), re-exported here beside the agents it is read for. */
export type CodingAgentLatestTurn = LatestTurn;
export {
  awaitingLinesOf,
  awaitingLinesOfReached,
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

/** What a Start hands the agent as its first message: the plan's text as it stands now, the developer's prompt in its place, or nothing for an agent started blank, whose first words come later. */
export type CodingAgentBriefText =
  | { readonly planSnapshot: string; readonly prompt: null }
  | { readonly planSnapshot: null; readonly prompt: string }
  | { readonly planSnapshot: null; readonly prompt: null };

/**
 * Where a Start puts the agent: on a task, whose workspace it joins and
 * whose text or the developer's prompt it is handed, or in a workspace with
 * no task, as an automation's run puts one, handed a prompt, since there is
 * no plan to hand it; or, as the member's operator alone, in a workspace
 * with no task and handed nothing.
 */
export type CodingAgentPlace =
  | (CodingAgentBriefText & {
      readonly taskId: string;
      readonly organizationId?: undefined;
      readonly kind?: typeof CODING_AGENT_KIND.CODER | undefined;
    })
  | {
      readonly taskId: null;
      readonly organizationId: string;
      readonly planSnapshot: null;
      readonly prompt: string;
      readonly kind?: typeof CODING_AGENT_KIND.CODER | undefined;
    }
  | {
      readonly taskId: null;
      readonly organizationId: string;
      readonly planSnapshot: null;
      readonly prompt: null;
      readonly kind: typeof CODING_AGENT_KIND.OPERATOR;
    };

/** A Start: where it goes, the request's own key, what to run on, what the agent is handed, and the repository as it stands now. */
export type NewCodingAgent = CodingAgentPlace & {
  /** The automation whose run starts the agent; none for one started by hand. */
  readonly automationId?: string | undefined;
  /** That automation's run as it starts the agent; none for one started by hand. */
  readonly automationOrigin?: StoredAutomationOrigin | undefined;
  /** The agent of the same plan this one is started from, with its replay's counts; none for one started afresh. */
  readonly startedFrom?: StoredStartedFrom | undefined;
  /** The agent's title from the start, a run's fixed name; none where it is named later. */
  readonly title?: string | undefined;
  /** The human name the agent keeps, a continued agent's own; none where it is given a new one. */
  readonly personaName?: string | undefined;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly effort: string;
  /** The model's whole window, the long one, where the Start names none. */
  readonly contextWindow?: ContextWindow | undefined;
  /** The repository the agent works in; null for one with none. */
  readonly repository: string | null;
  /** The branch the agent's checkout is cloned at; none for the repository's default branch. */
  readonly startBranch?: string | undefined;
  /** The MCP servers the draft switched off before it started; none where the Start names none. */
  readonly disabledServers?: readonly string[] | undefined;
  /** The MCP servers the prompt mentions, which the first turn is handed whatever the switches say; none where it mentions none. */
  readonly mentionedServers?: readonly string[] | undefined;
  /** How the repository was reached for the Start; the App's where none is named. */
  readonly githubAccess?: GitHubAccess | undefined;
  /** What answers the agent's conversation; eve where none is named. */
  readonly runtime?: ConversationRuntime | undefined;
  /** Who pays for the agent's model calls; none recorded where none is named. */
  readonly payer?: CodingAgentPayer | undefined;
};

/**
 * How an agent is run, as its rows hold it: what answers its conversation,
 * eve for a conversation from before the column, the harness's own session
 * or thread id, the digest of its runner's bearer, and who pays for it.
 */
export interface CodingAgentRouting {
  readonly runtime: ConversationRuntime;
  /** The harness's session or thread id; null on eve and before the harness answers one. */
  readonly nativeSession: string | null;
  /** The digest of the runner's bearer at Luke's MCP server; null where no runner holds one. */
  readonly runnerTokenHash: string | null;
  /** Who pays for the agent's model calls; null for an agent from before the column. */
  readonly payer: CodingAgentPayer | null;
}

/** The columns every read and every `returning` projects, so a row decodes one way whatever wrote it. */
const CODING_AGENT_COLUMNS = {
  id: codingAgent.id,
  userId: codingAgent.userId,
  taskId: codingAgent.taskId,
  organizationId: AGENT_WORKSPACE,
  automationId: codingAgent.automationId,
  automationOrigin: codingAgent.automationOrigin,
  startedFrom: codingAgent.startedFrom,
  conversationId: codingAgent.conversationId,
  model: codingAgent.model,
  effort: codingAgent.effort,
  contextWindow: codingAgent.contextWindow,
  planSnapshot: codingAgent.planSnapshot,
  prompt: codingAgent.prompt,
  repository: codingAgent.repository,
  branch: codingAgent.branch,
  startBranch: codingAgent.startBranch,
  title: codingAgent.title,
  personaName: codingAgent.personaName,
  archivedAt: codingAgent.archivedAt,
  archivedBy: codingAgent.archivedBy,
  disabledServers: codingAgent.disabledServers,
  author: codingAgent.author,
  githubAccess: codingAgent.githubAccess,
  kind: codingAgent.kind,
  createdAt: codingAgent.createdAt,
};

/**
 * The columns a list line projects (`CodingAgentLine`): every one of
 * `CODING_AGENT_COLUMNS` but the plan's text, the prompt, and the run that
 * started the agent, whose prompt and webhook body it carries, with whether
 * a prompt was handed and the run's automation name read in their place.
 * Note that the lists read these, because they read every agent of every
 * listed task on every refresh, and the text columns are the bulk of a row.
 */
const CODING_AGENT_LINE_COLUMNS = {
  id: codingAgent.id,
  userId: codingAgent.userId,
  taskId: codingAgent.taskId,
  organizationId: AGENT_WORKSPACE,
  automationId: codingAgent.automationId,
  automationName: sql<string | null>`${codingAgent.automationOrigin} ->> 'name'`,
  startedFrom: codingAgent.startedFrom,
  conversationId: codingAgent.conversationId,
  model: codingAgent.model,
  effort: codingAgent.effort,
  contextWindow: codingAgent.contextWindow,
  brief: sql<CodingAgentBrief>`case
    when ${codingAgent.prompt} is not null then ${CODING_AGENT_BRIEF.PROMPT}
    when ${codingAgent.planSnapshot} is not null then ${CODING_AGENT_BRIEF.PLAN}
    else ${CODING_AGENT_BRIEF.BLANK}
  end`,
  repository: codingAgent.repository,
  branch: codingAgent.branch,
  startBranch: codingAgent.startBranch,
  title: codingAgent.title,
  personaName: codingAgent.personaName,
  archivedAt: codingAgent.archivedAt,
  archivedBy: codingAgent.archivedBy,
  disabledServers: codingAgent.disabledServers,
  author: codingAgent.author,
  githubAccess: codingAgent.githubAccess,
  kind: codingAgent.kind,
  createdAt: codingAgent.createdAt,
} as const;

/** What an agent was handed as its first message, as `CODING_AGENT_LINE_COLUMNS` reads it from the row: its prompt, else the plan, else nothing. */
export function codingAgentBriefOf(
  agent: Pick<CodingAgent, "planSnapshot" | "prompt">,
): CodingAgentBrief {
  if (agent.prompt !== null) return CODING_AGENT_BRIEF.PROMPT;
  return agent.planSnapshot === null ? CODING_AGENT_BRIEF.BLANK : CODING_AGENT_BRIEF.PLAN;
}

/** The line a full read of an agent draws, as `CODING_AGENT_LINE_COLUMNS` reads it from the row. */
export function codingAgentLineOf(agent: CodingAgent): CodingAgentLine {
  const { automationOrigin, planSnapshot: _planSnapshot, prompt: _prompt, ...line } = agent;
  return {
    ...line,
    automationName: automationOrigin?.name ?? null,
    brief: codingAgentBriefOf(agent),
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
  }),
);
/** The `archived_by` column as a row holds it. */
const ArchivedByColumnSchema = Schema.NullOr(
  Schema.Struct({
    by: Schema.Literals(Object.values(CODING_AGENT_ARCHIVER)),
    userId: Schema.String,
    agentId: Schema.optionalKey(Schema.String),
    agentName: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(Schema.String),
    withTask: Schema.optionalKey(Schema.Boolean),
  }),
);
/** An author as the agent's row holds it. */
const AuthorColumnSchema = Schema.Literals(Object.values(CODING_AGENT_AUTHOR));

const CodingAgentRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  organizationId: Schema.String,
  automationId: Schema.NullOr(Schema.String),
  automationOrigin: AutomationOriginColumnSchema,
  startedFrom: StartedFromColumnSchema,
  conversationId: Schema.String,
  model: Schema.String,
  effort: Schema.String,
  contextWindow: contextWindowSchema,
  planSnapshot: Schema.NullOr(Schema.String),
  prompt: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
  startBranch: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  personaName: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
  archivedBy: ArchivedByColumnSchema,
  disabledServers: DisabledServersColumnSchema,
  author: Schema.NullOr(AuthorColumnSchema),
  githubAccess: Schema.Literals(Object.values(GITHUB_ACCESS)),
  kind: Schema.Literals(Object.values(CODING_AGENT_KIND)),
  createdAt: InstantColumnSchema,
});

const {
  automationOrigin: _automationOrigin,
  planSnapshot: _planSnapshot,
  prompt: _prompt,
  ...LINE_ROW_FIELDS
} = CodingAgentRowSchema.fields;

/** An agent's row as a list line reads it (`CODING_AGENT_LINE_COLUMNS`). */
const CodingAgentLineRowSchema = Schema.Struct({
  ...LINE_ROW_FIELDS,
  automationName: Schema.NullOr(Schema.String),
  brief: Schema.Literals(Object.values(CODING_AGENT_BRIEF)),
});

/** An agent's line with the reader's own pin beside it; null where they hold none. */
const TasklessAgentRowSchema = Schema.Struct({
  ...CodingAgentLineRowSchema.fields,
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  pinPosition: Schema.NullOr(Schema.String),
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

/** The agent under this id, where the account is a member of its workspace; any other id reads as no agent. */
function reachableAgent(userId: string, agentId: string): SQL | undefined {
  return and(eq(codingAgent.id, agentId), agentReachableBy(userId));
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

/** The workspace, locked, where the account is a member of it: the lock serialises two Starts in it under one key, as the task's own lock does for a task. */
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
const lockedPlace = Effect.fnUntraced(function* (userId: string, place: CodingAgentPlace) {
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
  Result: CodingAgentRowSchema,
  execute: ({ userId, idempotencyKey }) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_COLUMNS)
        .from(codingAgent)
        .where(and(eq(codingAgent.userId, userId), eq(codingAgent.idempotencyKey, idempotencyKey)))
        .limit(1),
    ),
});

/** A runtime as a conversation's row holds it. */
const RuntimeColumnSchema = Schema.Literals(Object.values(CONVERSATION_RUNTIME));
/** A payer as the agent's row holds it. */
const PayerColumnSchema = Schema.Literals(Object.values(CODING_AGENT_PAYER));

const insertAgentConversation = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, runtime: RuntimeColumnSchema, now: Schema.Date }),
  Result: IdRowSchema,
  execute: ({ userId, runtime, now }) =>
    Database.use((db) =>
      db
        .insert(conversations)
        .values({
          userId,
          kind: CONVERSATION_KIND.CODING_AGENT,
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
  ...CodingAgentRowSchema.fields,
  txid: Schema.String,
});

/** The transaction a pin's write committed in; none where the pin stood as asked already. */
const TxidRowSchema = Schema.Struct({ txid: Schema.String });

/** The member's operator standing in the workspace, archived ones left out. */
function liveOperatorOf(userId: string, organizationId: string): SQL | undefined {
  return and(
    eq(codingAgent.organizationId, organizationId),
    eq(codingAgent.userId, userId),
    eq(codingAgent.kind, CODING_AGENT_KIND.OPERATOR),
    isNull(codingAgent.archivedAt),
  );
}

/** Read under the workspace's lock a Start takes, by the member alone, since only they reach their operator. */
const findLiveOperator = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_COLUMNS)
        .from(codingAgent)
        .where(
          and(
            liveOperatorOf(userId, organizationId),
            workspaceReachableBy(userId, codingAgent.organizationId),
          ),
        )
        .limit(1),
    ),
});

/**
 * Whether bringing the agent back would stand a second operator of its
 * member in its workspace: it is an operator, and another of that member's
 * stands there, as after a Reset. Every unarchive is held to this
 * (`operatorReplaced`), since the partial unique index would refuse it.
 */
function replacedOperator(): SQL {
  const standing = alias(codingAgent, "standing_operator");
  const another = exists(
    queryBuilder
      .select({ id: standing.id })
      .from(standing)
      .where(
        and(
          eq(standing.organizationId, codingAgent.organizationId),
          eq(standing.userId, codingAgent.userId),
          eq(standing.kind, CODING_AGENT_KIND.OPERATOR),
          isNull(standing.archivedAt),
          ne(standing.id, codingAgent.id),
        ),
      ),
  );
  return sql`(${eq(codingAgent.kind, CODING_AGENT_KIND.OPERATOR)} and ${another})`;
}

const findReplacedOperator = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id })
        .from(codingAgent)
        .where(and(reachableAgent(userId, agentId), replacedOperator())),
    ),
});

/**
 * Note that a row the partial unique index already holds is answered as no
 * row rather than a failure, because the operator a concurrent Start made
 * first is the answer, which the Start then reads.
 */
const insertAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    taskId: Schema.NullOr(Schema.String),
    organizationId: Schema.String,
    automationId: Schema.NullOr(Schema.String),
    automationOrigin: AutomationOriginColumnSchema,
    startedFrom: StartedFromColumnSchema,
    title: Schema.NullOr(Schema.String),
    personaName: Schema.String,
    idempotencyKey: Schema.String,
    model: Schema.String,
    effort: Schema.String,
    contextWindow: contextWindowSchema,
    planSnapshot: Schema.NullOr(Schema.String),
    prompt: Schema.NullOr(Schema.String),
    repository: Schema.NullOr(Schema.String),
    startBranch: Schema.NullOr(Schema.String),
    disabledServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
    mentionedServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
    githubAccess: Schema.Literals(Object.values(GITHUB_ACCESS)),
    payer: Schema.NullOr(PayerColumnSchema),
    kind: Schema.Literals(Object.values(CODING_AGENT_KIND)),
    now: Schema.Date,
  }),
  Result: CommittedAgentRowSchema,
  execute: (write) =>
    Database.use((db) =>
      db
        .insert(codingAgent)
        .values({
          userId: write.userId,
          taskId: write.taskId,
          organizationId: write.organizationId,
          automationId: write.automationId,
          automationOrigin: write.automationOrigin,
          startedFrom: write.startedFrom,
          title: write.title,
          personaName: write.personaName,
          conversationId: write.conversationId,
          model: write.model,
          effort: write.effort,
          contextWindow: write.contextWindow,
          planSnapshot: write.planSnapshot,
          prompt: write.prompt,
          repository: write.repository,
          repositories: write.repository === null ? [] : [write.repository],
          startBranch: write.startBranch,
          disabledServers: write.disabledServers,
          mentionedServers: write.mentionedServers,
          githubAccess: write.githubAccess,
          payer: write.payer,
          kind: write.kind,
          idempotencyKey: write.idempotencyKey,
          createdAt: write.now,
        })
        .onConflictDoNothing({
          target: [codingAgent.organizationId, codingAgent.userId],
          // Note that the predicate spells its literal, because Postgres infers the index from it at plan time.
          where: sql`${codingAgent.kind} = ${sql.raw(`'${CODING_AGENT_KIND.OPERATOR}'`)} and ${codingAgent.archivedAt} is null`,
        })
        .returning({ ...CODING_AGENT_COLUMNS, txid: TXID }),
    ),
});

/** The human names the agents of a task were given, read under the task's lock as a Start takes it, so a new one is given a first name none of them wears. */
const findTaskPersonaNames = SqlSchema.findAll({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ personaName: Schema.NullOr(Schema.String) }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ personaName: codingAgent.personaName })
        .from(codingAgent)
        .where(eq(codingAgent.taskId, taskId)),
    ),
});

/** A human name for a new agent of the task, or of no task, whose first name none of the task's agents wears while one is left. */
function newPersonaName(taskId: string | null) {
  return Effect.gen(function* () {
    const taken =
      taskId === null
        ? []
        : (yield* findTaskPersonaNames({ taskId })).flatMap((row) => row.personaName ?? []);
    const draw = yield* Random.next;
    return pickPersonaName(taken, () => draw);
  });
}

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
    Database.use((db) =>
      db
        .update(codingAgent)
        .set({ model, effort, contextWindow })
        .where(reachableAgent(userId, agentId))
        .returning(CODING_AGENT_COLUMNS),
    ),
});

const updateAgentServers = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    disabledServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
  }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, agentId, disabledServers }) =>
    Database.use((db) =>
      db
        .update(codingAgent)
        .set({ disabledServers })
        .where(reachableAgent(userId, agentId))
        .returning(CODING_AGENT_COLUMNS),
    ),
});

/** The agent of a conversation under its own lock, as far as a turn taking its mentioned servers reads it. */
const lockAgentMentionedServers = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, mentionedServers: DisabledServersColumnSchema }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, mentionedServers: codingAgent.mentionedServers })
        .from(codingAgent)
        .where(and(eq(codingAgent.conversationId, conversationId), agentReachableBy(userId)))
        .limit(1)
        .for("update"),
    ),
});

/** The agent under its own lock, as far as a send adding to its mentioned servers reads it. */
const lockReachableMentionedServers = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String, mentionedServers: DisabledServersColumnSchema }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: codingAgent.id, mentionedServers: codingAgent.mentionedServers })
        .from(codingAgent)
        .where(reachableAgent(userId, agentId))
        .for("update"),
    ),
});

const setAgentMentionedServers = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    mentionedServers: Schema.NullOr(Schema.Array(integrationConnectionNameSchema)),
  }),
  execute: ({ agentId, mentionedServers }) =>
    Database.use((db) =>
      db.update(codingAgent).set({ mentionedServers }).where(eq(codingAgent.id, agentId)),
    ),
});

const updateAgentBranch = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    branch: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, agentId, branch }) =>
    Database.use((db) =>
      db.update(codingAgent).set({ branch }).where(reachableAgent(userId, agentId)),
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
        .update(codingAgent)
        .set({ title })
        .where(reachableAgent(userId, agentId))
        .returning({ ...CODING_AGENT_COLUMNS, txid: TXID }),
    ),
});

/**
 * The agent archived where it stands unarchived and its conversation's
 * lines have run no further than `seenSeq`, so an agent a message woke
 * after the caller read it is left standing.
 */
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
        .update(codingAgent)
        .set({ archivedAt, archivedBy })
        .where(
          and(
            reachableAgent(userId, agentId),
            isNull(codingAgent.archivedAt),
            exists(
              queryBuilder
                .select({ one: conversations.id })
                .from(conversations)
                .where(
                  and(
                    eq(conversations.id, codingAgent.conversationId),
                    eq(conversations.nextMessageSeq, seenSeq),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: codingAgent.id }),
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
        .update(codingAgent)
        .set({ archivedAt, archivedBy })
        .where(
          archivedAt === null
            ? and(reachableAgent(userId, agentId), not(replacedOperator()))
            : reachableAgent(userId, agentId),
        )
        .returning({ ...CODING_AGENT_COLUMNS, txid: TXID }),
    ),
});

const fillAgentTitle = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, title: Schema.String }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, title }) =>
    Database.use((db) =>
      db
        .update(codingAgent)
        .set({ title })
        .where(and(reachableAgent(userId, agentId), isNull(codingAgent.title)))
        .returning({ id: codingAgent.id }),
    ),
});

const settleAgentAuthor = SqlSchema.findOneOption({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    author: AuthorColumnSchema,
  }),
  Result: Schema.Struct({ author: AuthorColumnSchema }),
  execute: ({ userId, agentId, author }) =>
    Database.use((db) =>
      db
        .update(codingAgent)
        // Note that the author standing is kept, so the first session's word is the agent's for good.
        .set({ author: sql`coalesce(${codingAgent.author}, ${author})` })
        .where(reachableAgent(userId, agentId))
        .returning({ author: codingAgent.author }),
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
      db.update(codingAgent).set({ author }).where(reachableAgent(userId, agentId)),
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
          runnerTokenHash: codingAgent.runnerTokenHash,
          payer: codingAgent.payer,
        })
        .from(codingAgent)
        .innerJoin(conversations, eq(conversations.id, codingAgent.conversationId))
        .where(reachableAgent(userId, agentId))
        .limit(1),
    ),
});

/** The agent's conversation, where the account reaches the agent, as a write to the conversation's own columns picks it. */
function reachableAgentConversation(userId: string, agentId: string): SQL {
  return inArray(
    conversations.id,
    queryBuilder
      .select({ id: codingAgent.conversationId })
      .from(codingAgent)
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
        .from(codingAgent)
        .innerJoin(conversations, eq(conversations.id, codingAgent.conversationId))
        .where(
          and(
            eq(codingAgent.runnerTokenHash, runnerTokenHash),
            eq(conversations.kind, CONVERSATION_KIND.CODING_AGENT),
            isNull(conversations.deletedAt),
          ),
        )
        .limit(1),
    ),
});

/** The runtimes whose sandbox Luke opens itself, with a runner in it: the native harnesses. */
const NATIVE_RUNTIMES = [CONVERSATION_RUNTIME.CLAUDE_CODE, CONVERSATION_RUNTIME.CODEX] as const;

/** The turn statuses a turn ends in; a queued or running one has not ended. */
const ENDED_TURN_STATUSES = [
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELLED,
  TURN_STATUS.FAILED,
] as const;

/** A sandbox's agent id as its tag spells it, before a query takes it as a `uuid`. */
const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * The conversation of the agent under this id, where it stands undeleted on a
 * native harness, read with no account in hand, because the sweep that asks
 * acts for every account at once.
 */
const findNativeAgentConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({ conversationId: conversations.id })
        .from(codingAgent)
        .innerJoin(conversations, eq(conversations.id, codingAgent.conversationId))
        .where(
          and(
            eq(codingAgent.id, agentId),
            inArray(conversations.runtime, [...NATIVE_RUNTIMES]),
            isNull(conversations.deletedAt),
          ),
        )
        .limit(1),
    ),
});

/**
 * The agents whose conversation runs on eve in the session named, read with
 * no account in hand, because the sweep that asks acts for every account at
 * once. Note that a conversation from before the runtime column runs on eve
 * too, and that a deleted conversation is still its agent's: its sandbox is
 * no less the agent's to stop once its turn ended. At most two, which is
 * enough to tell one from several.
 */
const findEveAgentsOfSession = SqlSchema.findAll({
  Request: Schema.Struct({ runtimeSessionId: Schema.String }),
  Result: Schema.Struct({ agentId: Schema.String, conversationId: Schema.String }),
  execute: ({ runtimeSessionId }) =>
    Database.use((db) =>
      db
        .select({ agentId: codingAgent.id, conversationId: conversations.id })
        .from(conversations)
        .innerJoin(codingAgent, eq(codingAgent.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.runtimeSessionId, runtimeSessionId),
            or(isNull(conversations.runtime), eq(conversations.runtime, CONVERSATION_RUNTIME.EVE)),
          ),
        )
        .limit(2),
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

/** The conversation's newest turn: where it stands, and when it settled. */
const findNewestTurnStanding = SqlSchema.findOneOption({
  Request: Schema.Struct({ conversationId: Schema.String }),
  Result: Schema.Struct({
    status: Schema.String,
    settledAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: ({ conversationId }) =>
    Database.use((db) =>
      db
        .select({ status: turns.status, settledAt: turns.settledAt })
        .from(turns)
        .where(eq(turns.conversationId, conversationId))
        .orderBy(desc(turns.queuedAt), desc(turns.id))
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
        .update(codingAgent)
        .set({ runnerTokenHash })
        .where(reachableAgent(userId, agentId))
        .returning({ id: codingAgent.id }),
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
      db.update(codingAgent).set({ lastStep }).where(reachableAgent(userId, agentId)),
    ),
});

const updateAgentCompaction = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, at: Schema.Date }),
  execute: ({ userId, agentId, at }) =>
    Database.use((db) =>
      db.update(codingAgent).set({ compactedAt: at }).where(reachableAgent(userId, agentId)),
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
          model: codingAgent.model,
          contextWindow: codingAgent.contextWindow,
          lastStep: codingAgent.lastStep,
          compactedAt: codingAgent.compactedAt,
        })
        .from(codingAgent)
        .where(reachableAgent(userId, agentId))
        .limit(1),
    ),
});

const AgentsOfTaskSchema = Schema.Struct({
  userId: Schema.String,
  taskId: Schema.String,
  includeArchived: Schema.Boolean,
});

/** The condition that an agent stands on the task the account reaches, and is one the account sees as its GitHub access allows, archived only where asked for; read joined to its task. */
function ofReachedTask({ userId, taskId, includeArchived }: typeof AgentsOfTaskSchema.Type) {
  return and(
    reachableTask(userId, taskId),
    agentSeenBy(userId),
    includeArchived ? undefined : isNull(codingAgent.archivedAt),
  );
}

const findAgentsOfTask = SqlSchema.findAll({
  Request: AgentsOfTaskSchema,
  Result: CodingAgentRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_COLUMNS)
        .from(codingAgent)
        .innerJoin(task, eq(task.id, codingAgent.taskId))
        .where(ofReachedTask(request))
        .orderBy(asc(codingAgent.createdAt), asc(codingAgent.id)),
    ),
});

const findAgentLinesOfTask = SqlSchema.findAll({
  Request: AgentsOfTaskSchema,
  Result: CodingAgentLineRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_LINE_COLUMNS)
        .from(codingAgent)
        .innerJoin(task, eq(task.id, codingAgent.taskId))
        .where(ofReachedTask(request))
        .orderBy(asc(codingAgent.createdAt), asc(codingAgent.id)),
    ),
});

/** A `LIKE` pattern finding the words anywhere, its own `%`, `_`, and `\\` matched as themselves. */
function containing(words: string): string {
  return `%${words.replace(/[\\%_]/gu, (special) => `\\${special}`)}%`;
}

/** The condition that an agent's title, or its task's name, holds the words, whatever their case. */
function agentNamed(words: string): SQL | undefined {
  const pattern = containing(words);
  return or(
    ilike(codingAgent.title, pattern),
    exists(
      queryBuilder
        .select({ one: task.id })
        .from(task)
        .where(and(eq(task.id, codingAgent.taskId), ilike(task.name, pattern))),
    ),
  );
}

const AgentsOfWorkspaceSchema = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
  repository: Schema.NullOr(Schema.String),
  taskId: Schema.NullOr(Schema.String),
  words: Schema.NullOr(Schema.String),
  includeArchived: Schema.Boolean,
  limit: Schema.Number,
});

/** The condition that an agent is one of the workspace's the account reaches, narrowed as the request asks. */
function ofReachedWorkspace(request: typeof AgentsOfWorkspaceSchema.Type) {
  const { userId, organizationId, repository, taskId, words, includeArchived } = request;
  return and(
    agentReachableBy(userId),
    eq(AGENT_WORKSPACE, organizationId),
    includeArchived ? undefined : isNull(codingAgent.archivedAt),
    taskId === null ? undefined : eq(codingAgent.taskId, taskId),
    words === null ? undefined : agentNamed(words),
    // Note that a repository is matched as GitHub matches one, its case aside.
    repository === null
      ? undefined
      : eq(sql`lower(${codingAgent.repository})`, repository.toLowerCase()),
  );
}

const findAgentsOfWorkspace = SqlSchema.findAll({
  Request: AgentsOfWorkspaceSchema,
  Result: CodingAgentRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_COLUMNS)
        .from(codingAgent)
        .where(ofReachedWorkspace(request))
        .orderBy(desc(codingAgent.createdAt), desc(codingAgent.id))
        .limit(request.limit),
    ),
});

const findAgentLinesOfWorkspace = SqlSchema.findAll({
  Request: AgentsOfWorkspaceSchema,
  Result: CodingAgentLineRowSchema,
  execute: (request) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_LINE_COLUMNS)
        .from(codingAgent)
        .where(ofReachedWorkspace(request))
        .orderBy(desc(codingAgent.createdAt), desc(codingAgent.id))
        .limit(request.limit),
    ),
});

/** Every agent with no plan in the account's workspaces, newest started first, each with the account's own pin of it. */
const findTasklessAgents = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, includeArchived: Schema.Boolean }),
  Result: TasklessAgentRowSchema,
  execute: ({ userId, includeArchived }) =>
    Database.use((db) =>
      db
        .select({
          ...CODING_AGENT_LINE_COLUMNS,
          pinnedAt: agentPin.pinnedAt,
          pinPosition: agentPin.position,
        })
        .from(codingAgent)
        .leftJoin(
          agentPin,
          and(eq(agentPin.codingAgentId, codingAgent.id), eq(agentPin.userId, userId)),
        )
        .where(
          and(
            isNull(codingAgent.taskId),
            agentReachableBy(userId),
            includeArchived ? undefined : isNull(codingAgent.archivedAt),
          ),
        )
        .orderBy(desc(codingAgent.createdAt), desc(codingAgent.id)),
    ),
});

/** The `published` column as the service writes it (`StoredPullRequest`): the wire's pull request, and what the service alone reads, absent from a row written before it was kept. */
const PublishedColumnSchema = Schema.Struct({
  ...codingAgentPullRequestSchema.fields,
  headSha: Schema.optionalKey(Schema.String),
  mergedAt: Schema.optionalKey(Schema.Number),
});

const updateAgentPublished = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    published: Schema.NullOr(PublishedColumnSchema),
  }),
  execute: ({ userId, agentId, published }) =>
    Database.use((db) =>
      db.update(codingAgent).set({ published }).where(reachableAgent(userId, agentId)),
    ),
});

const findAgentPublished = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ published: Schema.NullOr(PublishedColumnSchema) }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ published: codingAgent.published })
        .from(codingAgent)
        .where(reachableAgent(userId, agentId))
        .limit(1),
    ),
});

const findAgentsOfTasks = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    taskIds: Schema.Array(Schema.String),
    includeArchived: Schema.Boolean,
  }),
  Result: Schema.Struct({
    ...CodingAgentLineRowSchema.fields,
    published: Schema.NullOr(codingAgentPullRequestSchema),
  }),
  execute: ({ userId, taskIds, includeArchived }) =>
    Database.use((db) =>
      db
        .select({ ...CODING_AGENT_LINE_COLUMNS, published: codingAgent.published })
        .from(codingAgent)
        .innerJoin(task, eq(task.id, codingAgent.taskId))
        .where(
          and(
            inArray(task.id, [...taskIds]),
            taskReachableBy(userId),
            agentSeenBy(userId),
            includeArchived ? undefined : isNull(codingAgent.archivedAt),
          ),
        )
        .orderBy(asc(codingAgent.createdAt), asc(codingAgent.id)),
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
        .select({ id: codingAgent.id })
        .from(codingAgent)
        .innerJoin(task, eq(task.id, codingAgent.taskId))
        .where(
          and(
            eq(task.id, taskId),
            taskReachableBy(userId),
            isNotNull(sql`${codingAgent.published} ->> 'mergedAt'`),
          ),
        )
        .limit(1),
    ),
});

const findPublishedAgentsById = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    ...CodingAgentRowSchema.fields,
    published: Schema.NullOr(codingAgentPullRequestSchema),
  }),
  execute: ({ userId, agentIds }) =>
    Database.use((db) =>
      db
        .select({ ...CODING_AGENT_COLUMNS, published: codingAgent.published })
        .from(codingAgent)
        .where(and(inArray(codingAgent.id, [...agentIds]), agentReachableBy(userId)))
        .orderBy(asc(codingAgent.createdAt), asc(codingAgent.id)),
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
          id: codingAgent.id,
          title: codingAgent.title,
          startedFrom: codingAgent.startedFrom,
          createdAt: codingAgent.createdAt,
          rank: sql<number>`row_number() over (partition by (${codingAgent.startedFrom}->>'agentId') order by ${codingAgent.createdAt}, ${codingAgent.id})`.as(
            "rank",
          ),
        })
        .from(codingAgent)
        .where(
          and(
            // Note that the source is matched on the expression its index is built on.
            inArray(sql`(${codingAgent.startedFrom}->>'agentId')`, [...agentIds]),
            agentReachableBy(userId),
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

const findAgentsOnBranches = SqlSchema.findAll({
  Request: Schema.Struct({
    repository: Schema.String,
    branches: Schema.Array(Schema.String),
    limit: Schema.Number,
  }),
  Result: CodingAgentRowSchema,
  execute: ({ repository, branches, limit }) =>
    Database.use((db) =>
      db
        .select({ ...CODING_AGENT_COLUMNS, userId: codingAgent.userId })
        .from(codingAgent)
        .where(
          and(eq(codingAgent.repository, repository), inArray(codingAgent.branch, [...branches])),
        )
        .orderBy(desc(codingAgent.createdAt), asc(codingAgent.id))
        .limit(limit),
    ),
});

const findAgentsOnPullRequest = SqlSchema.findAll({
  Request: Schema.Struct({
    repository: Schema.String,
    number: Schema.Number,
    limit: Schema.Number,
  }),
  Result: CodingAgentRowSchema,
  execute: ({ repository, number, limit }) =>
    Database.use((db) =>
      db
        .select({ ...CODING_AGENT_COLUMNS, userId: codingAgent.userId })
        .from(codingAgent)
        .where(
          and(
            eq(sql`lower(${codingAgent.repository})`, repository.toLowerCase()),
            eq(sql`(${codingAgent.published}->>'number')::int`, number),
          ),
        )
        .orderBy(desc(codingAgent.createdAt), asc(codingAgent.id))
        .limit(limit),
    ),
});

const findAgent = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_COLUMNS)
        .from(codingAgent)
        .where(reachableAgent(userId, agentId))
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
        .values({ userId, codingAgentId: agentId, pinnedAt: now })
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
        .values({ userId, codingAgentId: agentId, position, pinnedAt: now })
        .onConflictDoUpdate({
          target: [agentPin.userId, agentPin.codingAgentId],
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
        .where(and(eq(agentPin.userId, userId), eq(agentPin.codingAgentId, agentId)))
        .returning({ txid: TXID }),
    ),
});

/**
 * The columns of an agent that a caller holding only its conversation most
 * often needs: who it is, who started it, its task, repository, title, and
 * archive. Note that these leave out the plan's text and the prompt, the bulk
 * of a row, since every Luke tool call an agent makes reads its agent.
 */
const CODING_AGENT_HEADER_COLUMNS = {
  id: codingAgent.id,
  userId: codingAgent.userId,
  taskId: codingAgent.taskId,
  repository: codingAgent.repository,
  title: codingAgent.title,
  archivedAt: codingAgent.archivedAt,
} as const;

const CodingAgentHeaderRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(InstantColumnSchema),
});

const findAgentHeaderOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: CodingAgentHeaderRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_HEADER_COLUMNS)
        .from(codingAgent)
        .where(and(eq(codingAgent.conversationId, conversationId), agentReachableBy(userId))),
    ),
});

const findAgentOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: CodingAgentRowSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select(CODING_AGENT_COLUMNS)
        .from(codingAgent)
        .where(and(eq(codingAgent.conversationId, conversationId), agentReachableBy(userId)))
        .limit(1),
    ),
});

const deleteAgentRow = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ conversationId: Schema.String, txid: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .delete(codingAgent)
        .where(reachableAgent(userId, agentId))
        .returning({ conversationId: codingAgent.conversationId, txid: TXID }),
    ),
});

/** By id alone, because the agent row the delete before it took passed the task's gate and named this conversation. */
const deleteConversationRow = SqlSchema.void({
  Request: Schema.String,
  execute: (conversationId) =>
    Database.use((db) => db.delete(conversations).where(eq(conversations.id, conversationId))),
});

/**
 * Starts an agent on a task of the account's workspace, or in a workspace
 * of the account's with no task: a `coding_agent` conversation of the
 * account's and the row that binds it to the task or the workspace, with
 * the plan text or the prompt, the repository, and the automation whose run
 * started it with that run, as handed. A Start whose key the account has already used answers the agent
 * that Start made, whatever else the retry carries, and writes nothing.
 * A Start of the member's operator answers the one standing in the
 * workspace where there is one, whatever its key, and writes nothing; one
 * the index finds another Start made first meanwhile is answered too, the
 * conversation opened for it taken back.
 * Nothing where the account reaches no such task or is no member of the
 * workspace.
 */
export function createCodingAgent(
  userId: string,
  started: NewCodingAgent,
): Effect.Effect<Option.Option<CodingAgentStarted>, CodingAgentStoreFailure, DatabaseServices> {
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
        // A member's operator is one per workspace, so a Start of it answers the one standing.
        if (started.kind === CODING_AGENT_KIND.OPERATOR) {
          const standing = yield* findLiveOperator({ userId, organizationId });
          if (Option.isSome(standing))
            return Option.some({ agent: standing.value, created: false });
        }
        const now = yield* DateTime.nowAsDate;
        const conversation = yield* insertAgentConversation({
          userId,
          runtime: started.runtime ?? CONVERSATION_RUNTIME.EVE,
          now,
        }).pipe(
          // An insert that returned no row is the database breaking its own contract, not an outcome.
          Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
        );
        const inserted = yield* insertAgent({
          userId,
          conversationId: conversation.id,
          taskId: started.taskId,
          organizationId,
          automationId: started.automationId ?? null,
          automationOrigin: started.automationOrigin ?? null,
          startedFrom: started.startedFrom ?? null,
          title: started.title ?? null,
          personaName: started.personaName ?? (yield* newPersonaName(started.taskId)),
          idempotencyKey: started.idempotencyKey,
          model: started.model,
          effort: started.effort,
          contextWindow: started.contextWindow ?? CONTEXT_WINDOW.LONG,
          planSnapshot: started.planSnapshot,
          prompt: started.prompt,
          repository: started.repository,
          startBranch: started.startBranch ?? null,
          disabledServers: storedServers(started.disabledServers ?? []),
          mentionedServers: storedServers(started.mentionedServers ?? []),
          githubAccess: started.githubAccess ?? GITHUB_ACCESS.APP,
          payer: started.payer ?? null,
          kind: started.kind ?? CODING_AGENT_KIND.CODER,
          now,
        });
        if (Option.isSome(inserted)) {
          const { txid, ...row } = inserted.value;
          return Option.some({ agent: row, created: true, txid });
        }
        // Only the operator's index answers an insert with no row: the one another Start made stands.
        yield* deleteConversationRow(conversation.id);
        const made = yield* findLiveOperator({ userId, organizationId });
        // A row the index refused and no read then finds is the database breaking its own contract.
        if (Option.isNone(made))
          return yield* Effect.die(new Error("operator conflict found no row"));
        return Option.some({ agent: made.value, created: false });
      }),
    ),
  );
}

/**
 * Discards an agent a Start could not open an eve session for: its row and
 * its conversation, with every message and turn the conversation holds,
 * which is none. Answers whether the account reached such an agent.
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
        yield* deleteConversationRow(deleted.conversationId);
        return true;
      }),
    ),
  );
}

/** What a delete that stopped the agent first tells it. */
export interface CodingAgentDeleteGuard<R> {
  /** Whether the agent, read under its conversation's lock, still stands as the caller's Stop left it; false refuses the delete. */
  readonly standsStopped: (
    agent: CodingAgent,
  ) => Effect.Effect<boolean, CodingAgentStoreFailure, R>;
  /** Run under that lock before anything is deleted, given the agent's conversation, as a task's delete runs its own. */
  readonly beforeDelete: TaskDeleteGuard<R>["beforeDelete"];
}

/** Every call into the agent, open or ended, locked against a segment its voice writes meanwhile, which waits and then finds the conversation stamped (`voice-writer.ts`). */
const lockAgentCalls = SqlSchema.findAll({
  Request: Schema.String,
  Result: IdRowSchema,
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ id: voiceSessions.id })
        .from(voiceSessions)
        .where(eq(voiceSessions.agentId, agentId))
        .for("update"),
    ),
});

/**
 * The words said on every call into the agent, open or ended; the calls
 * themselves stay, their agent set null by the delete, since the admin's
 * activity and cost pages read them.
 */
const deleteAgentCallWords = SqlSchema.void({
  Request: Schema.String,
  execute: (agentId) =>
    Database.use((db) =>
      db
        .delete(voiceTranscriptSegments)
        .where(
          inArray(
            voiceTranscriptSegments.voiceSessionId,
            db
              .select({ id: voiceSessions.id })
              .from(voiceSessions)
              .where(eq(voiceSessions.agentId, agentId)),
          ),
        ),
    ),
});

/**
 * Deletes the agent for good: its row, which takes its pins, its inbox, and
 * its pull request polls with it and leaves what else named it naming no
 * one; the words said on its calls; and its conversation stamped deleted, so
 * the purge takes its transcript thirty days on, as a task's delete does
 * for each of its agents. Answers the transaction its row went in, as a
 * task's delete does; none where the account reaches no such agent.
 *
 * Everything runs under the agent's conversation lock, the one every write
 * of its lines and turns takes, and the agent is read again under it, so a
 * message handed over after the caller stopped it either landed first, and
 * `standsStopped` refuses with `TaskAgentUnstopped`, nothing written, or
 * waits on the lock and finds no agent.
 */
export function deleteCodingAgent<R = never>(
  userId: string,
  agentId: string,
  guard: CodingAgentDeleteGuard<R>,
): Effect.Effect<
  Option.Option<{ readonly txid: string }>,
  CodingAgentStoreFailure | TaskAgentUnstopped,
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
        // Note that the calls are locked before their words go, so a call still open writes no word between.
        yield* lockAgentCalls(agentId);
        yield* deleteAgentCallWords(agentId);
        const [deleted] = yield* deleteAgentRow({ userId, agentId });
        if (deleted === undefined) return Option.none();
        yield* stampConversationsDeleted([deleted.conversationId]);
        return Option.some({ txid: deleted.txid });
      }),
    ),
  );
}

/** Every agent started on the task, by any member, in the order they were started, the archived ones only where `includeArchived` asks; empty where the account reaches no such task. */
export function listCodingAgents(
  userId: string,
  taskId: string,
  options: { readonly includeArchived?: boolean } = {},
): CodingAgentStoreEffect<readonly CodingAgent[]> {
  return findAgentsOfTask({ userId, taskId, includeArchived: options.includeArchived ?? false });
}

/** Every agent started on the task as its line reads, by any member, in the order they were started, the archived ones only where `includeArchived` asks; empty where the account reaches no such task. */
export function listCodingAgentLines(
  userId: string,
  taskId: string,
  options: { readonly includeArchived?: boolean } = {},
): CodingAgentStoreEffect<readonly CodingAgentLine[]> {
  return findAgentLinesOfTask({
    userId,
    taskId,
    includeArchived: options.includeArchived ?? false,
  });
}

/** What a list of a workspace's agents is narrowed to, and how many it answers at most. */
interface WorkspaceAgentsAsked {
  readonly repository?: string;
  readonly taskId?: string;
  readonly words?: string;
  readonly includeArchived?: boolean;
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
    limit: options.limit,
  };
}

/**
 * The workspace's agents, on a task or with none, by any member, newest
 * started first, an archived one left out unless `includeArchived` asks,
 * only those on the repository named where one is, on the plan named
 * where one is, and whose title or task's name holds the words where some
 * are given, and at most `limit`; a workspace the account is not in has
 * none.
 */
export function listWorkspaceCodingAgents(
  userId: string,
  organizationId: string,
  options: WorkspaceAgentsAsked,
): CodingAgentStoreEffect<readonly CodingAgent[]> {
  return findAgentsOfWorkspace(workspaceRequest(userId, organizationId, options));
}

/** The workspace's agents as `listWorkspaceCodingAgents` lists them, each as its line reads. */
export function listWorkspaceCodingAgentLines(
  userId: string,
  organizationId: string,
  options: WorkspaceAgentsAsked,
): CodingAgentStoreEffect<readonly CodingAgentLine[]> {
  return findAgentLinesOfWorkspace(workspaceRequest(userId, organizationId, options));
}

/**
 * Every agent with no plan in the account's workspaces, by any member,
 * newest started first, the archived ones only where `includeArchived` asks,
 * each as its line reads with the account's own pin of it: what the plan
 * list carries beside the plans, read by the same gate.
 */
export function listTasklessCodingAgents(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): CodingAgentStoreEffect<readonly TasklessCodingAgent[]> {
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
): CodingAgentStoreEffect<ReadonlyMap<string, AgentTaskName>> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findTaskNames({ userId, taskIds: ids }),
    (rows) => new Map(rows.map((row) => [row.id, { name: row.name }])),
  );
}

/** One agent, and the pull request from its branch as GitHub last answered; null before a read found one. */
export interface PublishedCodingAgent {
  readonly agent: CodingAgent;
  readonly published: CodingAgentPullRequest | null;
}

/** One agent's line, and the pull request from its branch as GitHub last answered; null before a read found one. */
export interface PublishedCodingAgentLine {
  readonly agent: CodingAgentLine;
  readonly published: CodingAgentPullRequest | null;
}

/** Every agent standing on the plans named, by any member, each as its line reads with what it published, in the order they were started, an archived one left out unless `includeArchived` asks for it; a plan of a workspace the account is not in names none. */
export function listPublishedCodingAgents(
  userId: string,
  taskIds: readonly string[],
  options: { readonly includeArchived?: boolean } = {},
): CodingAgentStoreEffect<readonly PublishedCodingAgentLine[]> {
  if (taskIds.length === 0) return Effect.succeed([]);
  const includeArchived = options.includeArchived === true;
  return Effect.map(findAgentsOfTasks({ userId, taskIds, includeArchived }), (rows) =>
    rows.map(({ published, ...agent }) => ({ agent, published })),
  );
}

/** The agents named, by id, on a plan or with none, archived or not, each with what it published, in the order they were started: the read opening an agent's tab makes, so one of a workspace the account is not in names none. None asked, none read. */
export function listPublishedCodingAgentsById(
  userId: string,
  agentIds: readonly string[],
): CodingAgentStoreEffect<readonly PublishedCodingAgent[]> {
  if (agentIds.length === 0) return Effect.succeed([]);
  return Effect.map(findPublishedAgentsById({ userId, agentIds }), (rows) =>
    rows.map(({ published, ...agent }) => ({ agent, published })),
  );
}

/** How many agents started from one agent its summary names, the oldest first. */
const CONTINUATIONS_PER_AGENT = 20;

/** One agent started from another: its id, its title, null before it has one, and the message it forked the other at where it was forked rather than continued. */
export interface CodingAgentStartedFromIt {
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
): CodingAgentStoreEffect<ReadonlyMap<string, readonly CodingAgentStartedFromIt[]>> {
  if (agentIds.length === 0) return Effect.succeed(new Map());
  const perSource = CONTINUATIONS_PER_AGENT;
  return Effect.map(findStartedFrom({ userId, agentIds, perSource }), (rows) => {
    const bySource = new Map<string, CodingAgentStartedFromIt[]>();
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

/** The pull request from the agent's branch as GitHub just answered, or null where it answered none; nothing written for an agent of a workspace the account is not in. */
export function recordCodingAgentPublished(
  userId: string,
  agentId: string,
  published: StoredPullRequest | null,
): CodingAgentStoreEffect<void> {
  return updateAgentPublished({ userId, agentId, published });
}

/** Whether any coding agent on the task, archived ones and a teammate's on their own token among them, has a pull request GitHub reported merged; false for a task the account does not reach. */
export function taskHasMergedPullRequest(
  userId: string,
  taskId: string,
): CodingAgentStoreEffect<boolean> {
  return Effect.map(findMergedAgentOfTask({ userId, taskId }), Option.isSome);
}

/** The pull request the agent's row keeps as GitHub last answered, whole; null before a read found one, and for an agent the account does not reach. */
export function readCodingAgentPublished(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<StoredPullRequest | null> {
  return Effect.map(findAgentPublished({ userId, agentId }), (row) =>
    Option.isSome(row) ? row.value.published : null,
  );
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
    rows.map((agent) => ({ userId: agent.userId, agent })),
  );
}

/**
 * The agents of any account whose pull request, as GitHub last answered it,
 * is the repository's one numbered, newest started first and at most
 * `limit` of them: what a delivery about a pull request finds them by where
 * it names no branch, as a comment's does. Like the read by branches, it
 * names no account.
 */
export function listCodingAgentsOnPullRequest(
  repository: string,
  number: number,
  limit: number,
): CodingAgentStoreEffect<readonly OwnedCodingAgent[]> {
  return Effect.map(findAgentsOnPullRequest({ repository, number, limit }), (rows) =>
    rows.map((agent) => ({ userId: agent.userId, agent })),
  );
}

/** The account's agent a Start made under its key, or nothing where no Start under it made one. */
export function readCodingAgentByKey(
  userId: string,
  idempotencyKey: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgentByKey({ userId, idempotencyKey });
}

/** The agent under this id, or nothing for an agent of a workspace the account is not in. */
export function readCodingAgent(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgent({ userId, agentId });
}

/** The agent given another model, effort, and context window, which its next step runs on, the model's whole window where the choice names none; nothing for an agent of a workspace the account is not in. */
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

/** The MCP servers switched off for the agent, the whole list, which its next turn on is not handed; nothing for an agent of a workspace the account is not in. */
export function updateCodingAgentServers(
  userId: string,
  agentId: string,
  disabledServers: readonly string[],
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return updateAgentServers({ userId, agentId, disabledServers: storedServers(disabledServers) });
}

/**
 * The hand-over of a message mentioning MCP servers to eve, run with those
 * servers standing among the ones the agent's next turn takes whatever its
 * switches say, and left standing only where the hand-over answers that eve
 * took the message. The row is locked, the servers added, the hand-over
 * run, and the servers as they stood put back for one that answered
 * nothing, so a refused send leaves no server for a later turn. Note that
 * the caller runs this as the dispatch under the conversation's lock
 * (`writeAwaitingLine`), after its repeat check, so a send's servers are
 * added only for a send eve hears, and no other send's hand-over stands
 * between this one's servers and its message. Nothing is added for no
 * server, or for an agent of a workspace the account is not in.
 */
export function dispatchMentioningServers<E, R>(
  userId: string,
  agentId: string,
  mentioned: readonly string[],
  dispatch: Effect.Effect<boolean, E, R>,
): Effect.Effect<boolean, E | CodingAgentStoreFailure, R | DatabaseServices> {
  if (mentioned.length === 0) return dispatch;
  return Effect.gen(function* () {
    const locked = yield* lockReachableMentionedServers({ userId, agentId });
    if (Option.isNone(locked)) return yield* dispatch;
    const before = locked.value.mentionedServers;
    yield* setAgentMentionedServers({
      agentId,
      mentionedServers: storedServers([...before, ...mentioned]),
    });
    const taken = yield* dispatch;
    if (!taken)
      yield* setAgentMentionedServers({ agentId, mentionedServers: storedServers(before) });
    return taken;
  });
}

/**
 * The MCP servers mentioned since the agent of the conversation last started
 * a turn, taken by the turn starting now: read and cleared under the row's
 * lock, so a mention landing meanwhile is either taken here or left for the
 * next turn, never lost. None for a conversation of no agent the account
 * reaches.
 */
export function takeCodingAgentMentionedServers(
  userId: string,
  conversationId: string,
): CodingAgentStoreEffect<readonly string[]> {
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

/** The branch checked out in the agent's sandbox as its turn ended, null for a detached HEAD; nothing written for an agent of a workspace the account is not in. */
export function updateCodingAgentBranch(
  userId: string,
  agentId: string,
  branch: string | null,
): CodingAgentStoreEffect<void> {
  return updateAgentBranch({ userId, agentId, branch });
}

/** The account's turn marked as one a step of ran at standard speed because Anthropic refused it Fast; nothing written for a turn the account does not own. */
export function recordTurnFastRefused(
  userId: string,
  turnId: string,
): CodingAgentStoreEffect<void> {
  return markTurnFastRefused({ userId, turnId });
}

/** The agent under another title, or none, which its tab shows in place of the model's name; nothing for an agent of a workspace the account is not in. */
export function renameCodingAgent(
  userId: string,
  agentId: string,
  title: string | null,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return Effect.map(renameCodingAgentCommitted(userId, agentId, title), Option.map(agentOf));
}

/** An agent as a write left it, and the transaction it committed in; none where it changed no row. */
export interface CodingAgentCommitted {
  readonly agent: CodingAgent;
  readonly txid?: string;
}

/** The agent's row without the transaction it was returned with. */
function agentOf({ agent }: CodingAgentCommitted): CodingAgent {
  return agent;
}

/** The agent renamed, as `renameCodingAgent` renames it, and the transaction its row was written in. */
export function renameCodingAgentCommitted(
  userId: string,
  agentId: string,
  title: string | null,
): CodingAgentStoreEffect<Option.Option<CodingAgentCommitted>> {
  return Effect.map(
    updateAgentTitle({ userId, agentId, title }),
    Option.map(({ txid, ...agent }) => ({ agent, txid })),
  );
}

/** The account's agent archived, stamped now with who archived it, by default the account itself, or brought back, which clears who did; its conversation and what it published are kept either way. Nothing for an agent of a workspace the account is not in. */
export function archiveCodingAgent(
  userId: string,
  agentId: string,
  archived: boolean,
  archivedBy: StoredArchive = { by: CODING_AGENT_ARCHIVER.MEMBER, userId },
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return Effect.map(
    archiveCodingAgentCommitted(userId, agentId, archived, archivedBy),
    Option.map(agentOf),
  );
}

const updateLiveOperatorArchived = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    organizationId: Schema.String,
    agentId: Schema.String,
    archivedAt: Schema.Date,
    archivedBy: ArchivedByColumnSchema,
  }),
  Result: IdRowSchema,
  execute: ({ userId, organizationId, agentId, archivedAt, archivedBy }) =>
    Database.use((db) =>
      db
        .update(codingAgent)
        .set({ archivedAt, archivedBy })
        .where(
          and(
            eq(codingAgent.id, agentId),
            liveOperatorOf(userId, organizationId),
            workspaceReachableBy(userId, codingAgent.organizationId),
          ),
        )
        .returning({ id: codingAgent.id }),
    ),
});

/** The member's operator standing in the workspace; none where none stands or the member is no member of it. */
export function readStandingOperator(
  userId: string,
  organizationId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findLiveOperator({ userId, organizationId });
}

/**
 * Whether the agent is an operator another of its member's has replaced in
 * its workspace, which no unarchive brings back while that one stands: the
 * archive by hand and the agent tool refuse it by this, and their writes
 * change nothing where it holds.
 */
export function operatorReplaced(userId: string, agentId: string): CodingAgentStoreEffect<boolean> {
  return Effect.map(findReplacedOperator({ userId, agentId }), (rows) => rows.length > 0);
}

/**
 * The member's operator standing in the workspace archived by the member,
 * its conversation kept, as a Reset does before it ensures a fresh one; only
 * the one named, read and stopped before, and only while it still stands,
 * so two Resets that read the same one never archive the fresh one the
 * other made. Answers its id where it was archived, or none where it no
 * longer stood or the member is no member of the workspace.
 */
export function archiveOperatorAgent(
  userId: string,
  organizationId: string,
  agentId: string,
): CodingAgentStoreEffect<Option.Option<string>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      updateLiveOperatorArchived({
        userId,
        organizationId,
        agentId,
        archivedAt: now,
        archivedBy: { by: CODING_AGENT_ARCHIVER.MEMBER, userId },
      }),
      ([archived]) => Option.fromNullishOr(archived?.id),
    ),
  );
}

/** The agent archived or brought back, as `archiveCodingAgent` does it, and the transaction its row was written in. */
export function archiveCodingAgentCommitted(
  userId: string,
  agentId: string,
  archived: boolean,
  archivedBy: StoredArchive = { by: CODING_AGENT_ARCHIVER.MEMBER, userId },
): CodingAgentStoreEffect<Option.Option<CodingAgentCommitted>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      updateAgentArchived({
        userId,
        agentId,
        archivedAt: archived ? now : null,
        archivedBy: archived ? archivedBy : null,
      }),
      Option.map(({ txid, ...agent }) => ({ agent, txid })),
    ),
  );
}

/** What an archive of an idle agent came to: archived now, archived already, still working, or no agent the account reaches. */
export const IDLE_ARCHIVE = {
  ARCHIVED: "archived",
  ALREADY: "already",
  WORKING: "working",
  NOT_FOUND: "not-found",
} as const;

export type IdleArchive = (typeof IDLE_ARCHIVE)[keyof typeof IDLE_ARCHIVE];

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

const archiveIfUnarchived = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    archivedAt: Schema.Date,
    archivedBy: ArchivedByColumnSchema,
  }),
  Result: IdRowSchema,
  execute: ({ userId, agentId, archivedAt, archivedBy }) =>
    Database.use((db) =>
      db
        .update(codingAgent)
        .set({ archivedAt, archivedBy })
        .where(and(reachableAgent(userId, agentId), isNull(codingAgent.archivedAt)))
        .returning({ id: codingAgent.id }),
    ),
});

/**
 * Archives the agent under who archived it, but only while `idle` says it
 * is, read under its conversation's lock, the one every write of its lines
 * and turns takes, so no turn queued and no message handed over between
 * the read and the stamp leaves an agent archived at work. An agent
 * archived already keeps the archive standing.
 */
export function archiveIdleCodingAgent(
  userId: string,
  agentId: string,
  archivedBy: StoredArchive,
  idle: (agent: CodingAgent) => CodingAgentStoreEffect<boolean>,
): CodingAgentStoreEffect<IdleArchive> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const found = yield* findAgent({ userId, agentId });
        if (Option.isNone(found)) return IDLE_ARCHIVE.NOT_FOUND;
        const locked = yield* lockAgentConversation({
          conversationId: found.value.conversationId,
        });
        if (Option.isNone(locked)) return IDLE_ARCHIVE.NOT_FOUND;
        // The row is read again under the lock, so an archive made meanwhile is seen.
        const agent = yield* findAgent({ userId, agentId });
        if (Option.isNone(agent)) return IDLE_ARCHIVE.NOT_FOUND;
        if (agent.value.archivedAt !== null) return IDLE_ARCHIVE.ALREADY;
        if (!(yield* idle(agent.value))) return IDLE_ARCHIVE.WORKING;
        const archivedAt = yield* DateTime.nowAsDate;
        const rows = yield* archiveIfUnarchived({ userId, agentId, archivedAt, archivedBy });
        return rows.length > 0 ? IDLE_ARCHIVE.ARCHIVED : IDLE_ARCHIVE.ALREADY;
      }),
    ),
  );
}

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
        .update(codingAgent)
        .set({ archivedAt: null, archivedBy: null })
        .where(
          and(
            reachableAgent(userId, agentId),
            eq(codingAgent.archivedAt, archivedAt),
            not(replacedOperator()),
          ),
        )
        .returning({ id: codingAgent.id }),
    ),
});

/** Brings the agent back, but only from the archive stamped at `archivedAt`, the one its reader saw, so an archive made since stands; answers whether it was brought back. */
export function unarchiveCodingAgentFrom(
  userId: string,
  agentId: string,
  archivedAt: Date,
): CodingAgentStoreEffect<boolean> {
  return Effect.map(unarchiveIfStamped({ userId, agentId, archivedAt }), (rows) => rows.length > 0);
}

/**
 * The account's own pin of the agent set as asked: from now, or from the
 * instant already standing, so pinning twice moves nothing, at the position
 * given where one is; or taken away.
 * Every other member's pin stands as it was. Nothing for an agent of a
 * workspace the account is not in, which is neither pinned nor unpinned,
 * nor for an agent on a plan, which stands under its plan rather than in
 * the sidebar, so a pin of it would be read nowhere.
 */
export function pinCodingAgent(
  userId: string,
  agentId: string,
  pinned: boolean,
  position?: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return Effect.map(
    pinCodingAgentCommitted(userId, agentId, pinned, position),
    Option.map(agentOf),
  );
}

/** The account's pin of the agent set, as `pinCodingAgent` sets it, and the transaction the pin was written in; none where it stood as asked. */
export function pinCodingAgentCommitted(
  userId: string,
  agentId: string,
  pinned: boolean,
  position?: string,
): CodingAgentStoreEffect<Option.Option<CodingAgentCommitted>> {
  return Effect.gen(function* () {
    const found = yield* findAgent({ userId, agentId });
    if (Option.isNone(found) || found.value.taskId !== null) return Option.none();
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

const findAgentConversation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  execute: (agentId) =>
    Database.use((db) =>
      db
        .select({ userId: codingAgent.userId, conversationId: codingAgent.conversationId })
        .from(codingAgent)
        .where(eq(codingAgent.id, agentId)),
    ),
});

/**
 * The agent's conversation under the member who started it, whoever asks;
 * nothing where no such agent stands. Only for an id the service recorded
 * itself, such as the agent a run was claimed for, because it reads past
 * any account's gate.
 */
export function codingAgentConversation(
  agentId: string,
): CodingAgentStoreEffect<Option.Option<ConversationTarget>> {
  return findAgentConversation(agentId);
}

/**
 * Archives the agent as `archiveCodingAgent` does, but only where it stands
 * unarchived and its conversation's lines have run no further than the
 * `seenSeq` its reader saw, so an agent a message woke since stands;
 * answers whether it was archived.
 */
export function archiveUnmovedCodingAgent(
  userId: string,
  agentId: string,
  seenSeq: number,
): CodingAgentStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (archivedAt) =>
    Effect.map(
      updateUnmovedArchived({ userId, agentId, seenSeq, archivedAt, archivedBy: null }),
      (rows) => rows.length > 0,
    ),
  );
}

/** The title written where the agent has none yet, so a name the developer gave stands whatever this carries; answers whether it was written. */
export function fillCodingAgentTitle(
  userId: string,
  agentId: string,
  title: string,
): CodingAgentStoreEffect<boolean> {
  return Effect.map(fillAgentTitle({ userId, agentId, title }), (rows) => rows.length > 0);
}

/**
 * The agent's author settled: the one given where none stands, and the one
 * standing otherwise, which is answered either way so a second session's
 * word never moves what the first one's instructions and checkout used;
 * nothing for an agent of a workspace the account is not in.
 */
export function settleCodingAgentAuthor(
  userId: string,
  agentId: string,
  author: CodingAgentAuthor,
): CodingAgentStoreEffect<Option.Option<CodingAgentAuthor>> {
  return Effect.map(settleAgentAuthor({ userId, agentId, author }), (row) =>
    Option.map(row, (settled) => settled.author),
  );
}

/**
 * The agent's author recorded over whatever stood, which is how an agent
 * that wrote as its developer records why the App opened its pull request
 * once their token was refused; nothing for an agent of a workspace the
 * account is not in.
 */
export function recordCodingAgentAuthor(
  userId: string,
  agentId: string,
  author: CodingAgentAuthor,
): CodingAgentStoreEffect<void> {
  return updateAgentAuthor({ userId, agentId, author });
}

/** How the agent is run (`CodingAgentRouting`); nothing for an agent of a workspace the account is not in. */
export function readCodingAgentRouting(
  userId: string,
  agentId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgentRouting>> {
  return Effect.map(
    findAgentRouting({ userId, agentId }),
    Option.map((row) => ({ ...row, runtime: row.runtime ?? CONVERSATION_RUNTIME.EVE })),
  );
}

/**
 * The native runtime of each conversation named, keyed by conversation;
 * one on eve, or from before the column, is absent. Only for ids a gate
 * already read, as above.
 */
export function nativeRuntimesOfReached(
  conversationIds: readonly string[],
): CodingAgentStoreEffect<ReadonlyMap<string, (typeof NATIVE_RUNTIMES)[number]>> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findNativeRuntimes({ conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row.runtime])),
  );
}

/** The harness's own session or thread id recorded on the agent's conversation, over whatever stood; answers whether the account reached the agent. */
export function recordCodingAgentNativeSession(
  userId: string,
  agentId: string,
  nativeSession: string,
): CodingAgentStoreEffect<boolean> {
  return Effect.map(
    updateAgentNativeSession({ userId, agentId, nativeSession }),
    (rows) => rows.length > 0,
  );
}

/** The digest of the runner's bearer recorded on the agent's conversation, or null to retire it; answers whether the account reached the agent. */
export function recordCodingAgentRunnerToken(
  userId: string,
  agentId: string,
  runnerTokenHash: string | null,
): CodingAgentStoreEffect<boolean> {
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
 * digest (`recordCodingAgentRunnerToken`), where its starter still reaches the
 * agent; nothing for a digest no standing conversation holds, a retired
 * bearer's among them, and nothing once the starter left the agent's
 * workspace, since the runner acts as them.
 */
export function readRunnerTokenConversation(
  runnerTokenHash: string,
): CodingAgentStoreEffect<Option.Option<RunnerTokenConversation>> {
  return Effect.gen(function* () {
    const found = yield* findRunnerTokenConversation({ runnerTokenHash });
    if (Option.isNone(found)) return found;
    const { userId, conversationId } = found.value;
    const agent = yield* findAgentHeaderOfConversation({ userId, conversationId });
    return Option.isSome(agent) ? found : Option.none();
  });
}

/** When the conversation's newest turn ended; null while it is queued or running, or before any turn. */
function newestTurnEndedAt(conversationId: string): CodingAgentStoreEffect<Date | null> {
  return Effect.map(findNewestTurnStanding({ conversationId }), (newest) => {
    const ended = Option.filter(newest, (turn) =>
      ENDED_TURN_STATUSES.some((status) => status === turn.status),
    );
    // An ended turn with no settle time stamped reads as ended long ago, so the sweep takes it at once.
    return Option.isSome(ended) ? (ended.value.settledAt ?? new Date(0)) : null;
  });
}

/** Where a native agent's run stands, as the sweep reads it from its sandbox's agent tag. */
export interface NativeRunStanding {
  /** The agent's conversation, which a Terminal's lease is held on. */
  readonly conversationId: string;
  /** When its newest turn ended; null while that turn is queued or running (a runner waiting on a wakeup among it), or before it has any turn. */
  readonly endedAt: Date | null;
}

/**
 * Where the run of the agent under this id stands, read with no account in
 * hand, because the scheduled sweep stops ended native sandboxes for every
 * account: its conversation, and when its newest turn ended. Nothing for an
 * id that names no agent, an agent on eve, or one whose conversation was
 * deleted. Only for an id a sandbox Luke opened carries; it answers nothing
 * a member wrote.
 */
export function readNativeRunStanding(
  agentId: string,
): CodingAgentStoreEffect<Option.Option<NativeRunStanding>> {
  return Effect.gen(function* () {
    if (!AGENT_ID_PATTERN.test(agentId)) return Option.none();
    const found = yield* findNativeAgentConversation({ agentId });
    if (Option.isNone(found)) return Option.none();
    const { conversationId } = found.value;
    return Option.some({ conversationId, endedAt: yield* newestTurnEndedAt(conversationId) });
  });
}

/** Where an eve agent's run stands, as the sweep reads it from its sandbox's session tag. */
export interface EveRunStanding {
  readonly agentId: string;
  /** The agent's conversation, which a Terminal's or a watched browser's lease is held on. */
  readonly conversationId: string;
  /** When its newest turn ended; null while that turn is queued or running, or before it has any turn. */
  readonly endedAt: Date | null;
}

/**
 * Where the run of the eve agent whose conversation runs in the session
 * named stands, read with no account in hand, because the scheduled sweep
 * stops orphaned eve sandboxes for every account: the agent, its
 * conversation, and when its newest turn ended. Nothing where no agent's
 * eve conversation runs in the session, or where more than one does, since
 * a sandbox the sweep cannot name one agent for is not its to stop. Only
 * for a session id a sandbox's tag carries; it answers nothing a member
 * wrote.
 */
export function readEveRunStanding(
  runtimeSessionId: string,
): CodingAgentStoreEffect<Option.Option<EveRunStanding>> {
  return Effect.gen(function* () {
    const found = yield* findEveAgentsOfSession({ runtimeSessionId });
    const [only] = found;
    if (only === undefined || found.length > 1) return Option.none();
    return Option.some({ ...only, endedAt: yield* newestTurnEndedAt(only.conversationId) });
  });
}

/** The agent whose conversation this is, which is what an eve session admitted for the conversation runs; nothing for an agent of a workspace the account is not in, or no agent's. */
export function readCodingAgentOfConversation(
  userId: string,
  conversationId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgent>> {
  return findAgentOfConversation({ userId, conversationId });
}

/** An agent as far as its header reads it (`CODING_AGENT_HEADER_COLUMNS`). */
export type CodingAgentHeader = Pick<
  CodingAgent,
  "id" | "userId" | "taskId" | "repository" | "title" | "archivedAt"
>;

/**
 * The header of the agent whose conversation this is, for a caller that needs
 * no more of it than who it is, its task, repository, title, and archive;
 * nothing where `readCodingAgentOfConversation` answers nothing.
 */
export function readCodingAgentHeaderOfConversation(
  userId: string,
  conversationId: string,
): CodingAgentStoreEffect<Option.Option<CodingAgentHeader>> {
  return findAgentHeaderOfConversation({ userId, conversationId });
}

/** What the agent's own conversation holds in its model's context: the model it runs on now, its newest step, and when eve last compacted it; null for each of the last two before it happens. */
export interface CodingAgentContextRow {
  readonly model: string;
  readonly contextWindow: ContextWindow;
  readonly lastStep: StoredAgentStep | null;
  readonly compactedAt: Date | null;
}

/** The newest model step of the agent's own conversation, which replaces the one before it; nothing written for an agent of a workspace the account is not in. */
export function recordCodingAgentStep(
  userId: string,
  agentId: string,
  lastStep: StoredAgentStep,
): CodingAgentStoreEffect<void> {
  return updateAgentStep({ userId, agentId, lastStep });
}

/** When eve compacted the agent's own conversation; nothing written for an agent of a workspace the account is not in. */
export function recordCodingAgentCompaction(
  userId: string,
  agentId: string,
  at: Date,
): CodingAgentStoreEffect<void> {
  return updateAgentCompaction({ userId, agentId, at });
}

/** What the agent's own conversation holds in its model's context, or nothing for an agent of a workspace the account is not in. */
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
    Database.use((db) =>
      db
        .insert(codingAgentDelegation)
        .values({ childConversationId, callId, model, effort })
        .onConflictDoNothing({ target: codingAgentDelegation.childConversationId }),
    ),
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
    Database.use((db) =>
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
    Database.use((db) =>
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

/**
 * What sent one of the developer's lines to an agent, as a reader names it:
 * a member by their account's id and the name it holds now, or nobody where
 * their account is gone; Luke; an automation by the name its run kept; or
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
  | { readonly kind: typeof MESSAGE_SENDER.LUKE }
  | { readonly kind: typeof MESSAGE_SENDER.AUTOMATION; readonly name: string }
  | { readonly kind: typeof MESSAGE_SENDER.GITHUB; readonly login: string }
  | {
      readonly kind: typeof MESSAGE_SENDER.AGENT;
      readonly name: string;
      readonly model: string | undefined;
      readonly agent: SendingAgent | undefined;
    };

/** The coding agent that sent a line, as it stands now: its id, and the task it works on, none for one on no task. */
interface SendingAgent {
  readonly id: string;
  readonly taskId: string | undefined;
}

/** A line's sender as its row keeps it, with the member's account where it still stands. */
const LineSenderRowSchema = Schema.Struct({
  id: Schema.String,
  sender: Schema.Literals(Object.values(MESSAGE_SENDER)),
  memberId: Schema.NullOr(Schema.String),
  memberName: Schema.NullOr(Schema.String),
  senderName: Schema.NullOr(Schema.String),
  senderModel: Schema.NullOr(Schema.String),
  agentId: Schema.NullOr(Schema.String),
  agentTaskId: Schema.NullOr(Schema.String),
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
          agentId: codingAgent.id,
          agentTaskId: codingAgent.taskId,
        })
        .from(messages)
        .leftJoin(user, eq(user.id, messages.senderUserId))
        .leftJoin(codingAgent, eq(codingAgent.id, messages.senderAgentId))
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
    case MESSAGE_SENDER.LUKE:
      return { kind: MESSAGE_SENDER.LUKE };
    case MESSAGE_SENDER.AUTOMATION:
      return row.senderName === null
        ? undefined
        : { kind: MESSAGE_SENDER.AUTOMATION, name: row.senderName };
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
            agent:
              row.agentId === null
                ? undefined
                : { id: row.agentId, taskId: row.agentTaskId ?? undefined },
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
): CodingAgentStoreEffect<ReadonlyMap<string, LineSent>> {
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
): CodingAgentStoreEffect<ReadonlyMap<string, LinePlace>> {
  if (messageIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findLinePlaces({ userId: target.userId, conversationId: target.conversationId, messageIds }),
    (rows) =>
      new Map(rows.map(({ id, journalId, afterStep }) => [id, { journalId, afterStep }] as const)),
  );
}

/**
 * The turn an ask the voice handed on ran in, as its binding names it: the
 * turn, and for an ask that joined a typed turn under way how many of that
 * turn's steps had begun before it (`asks.joined_after_step`), from which
 * its answer is read.
 */
export interface AskTurn {
  readonly turnId: string;
  readonly afterStep?: number;
}

const findAskTurns = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    conversationId: Schema.String,
    clientIds: Schema.Array(Schema.String),
  }),
  Result: Schema.Struct({
    clientId: Schema.String,
    turnId: Schema.String,
    afterStep: Schema.NullOr(Schema.Int),
  }),
  execute: ({ userId, conversationId, clientIds }) =>
    Database.use((db) =>
      db
        .select({
          clientId: asks.clientId,
          turnId: sql<string>`${asks.turnId}::text`,
          afterStep: asks.joinedAfterStep,
        })
        .from(asks)
        .where(
          and(
            eq(asks.userId, userId),
            eq(asks.conversationId, conversationId),
            inArray(asks.clientId, [...clientIds]),
            isNotNull(asks.turnId),
          ),
        ),
    ),
});

/**
 * The turn each of these asks of the account's conversation ran in, by the
 * ask's client id, for the asks that have learned one: an ask still unbound,
 * and one of another conversation or account, names none. None asked, none
 * read.
 */
export function askTurnsOf(
  target: ConversationTarget,
  clientIds: readonly string[],
): CodingAgentStoreEffect<ReadonlyMap<string, AskTurn>> {
  if (clientIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findAskTurns({ userId: target.userId, conversationId: target.conversationId, clientIds }),
    (rows) =>
      new Map(
        rows.map(({ clientId, turnId, afterStep }) => [
          clientId,
          afterStep === null ? { turnId } : { turnId, afterStep },
        ]),
      ),
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
          callId: codingAgentDelegation.callId,
          childConversationId: codingAgentDelegation.childConversationId,
          model: codingAgentDelegation.model,
          effort: codingAgentDelegation.effort,
          createdAt: conversations.createdAt,
        })
        .from(codingAgentDelegation)
        .innerJoin(conversations, eq(conversations.id, codingAgentDelegation.childConversationId))
        .where(
          and(
            eq(conversations.userId, userId),
            eq(conversations.parentConversationId, parentConversationId),
            isNotNull(codingAgentDelegation.callId),
            isNull(conversations.deletedAt),
          ),
        )
        .orderBy(asc(conversations.createdAt)),
    ),
});

/** Every worker the account's conversation delegated to by a call it kept, oldest first. */
export function delegationsOf(
  parent: ConversationTarget,
): CodingAgentStoreEffect<readonly DelegationRecord[]> {
  return findDelegations({ userId: parent.userId, parentConversationId: parent.conversationId });
}

const findDelegationTitles = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, parentConversationId: Schema.String }),
  Result: Schema.Struct({ callId: Schema.String, title: Schema.String }),
  execute: ({ userId, parentConversationId }) =>
    Database.use((db) =>
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
    ),
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
    Database.use((db) =>
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
