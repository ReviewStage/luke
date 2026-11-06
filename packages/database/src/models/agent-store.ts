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

export type AgentStoreEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

export interface Agent {
  readonly id: string;
  readonly userId: string;
  readonly taskId: string | null;
  readonly organizationId: string;
  readonly automationId: string | null;
  readonly automationOrigin: StoredAutomationOrigin | null;
  readonly automationRunId: string | null;
  readonly startedFrom: StoredStartedFrom | null;
  readonly source?: AgentSource | null;
  readonly startedByAgentId: string | null;
  readonly conversationId: string;
  readonly model: string;
  readonly effort: string;
  readonly contextWindow: ContextWindow;
  readonly descriptionSnapshot: string | null;
  readonly prompt: string | null;
  readonly repository: string | null;
  readonly branch: string | null;
  readonly startBranch: string | null;
  readonly title: string | null;
  readonly archivedAt: Date | null;
  readonly archivedBy: StoredArchive | null;
  readonly disabledServers: readonly string[];
  readonly author: AgentAuthor | null;
  readonly githubAccess: GitHubAccess;
  readonly kind: AgentKind;
  readonly createdAt: Date;
  readonly machine?: AgentMachineKind;
  readonly deviceId?: string | null;
}

export interface AgentLine
  extends Omit<Agent, "automationOrigin" | "descriptionSnapshot" | "prompt"> {
  readonly automationName: string | null;
  readonly brief: AgentBrief;
}

export interface TasklessAgentRow extends AgentLine {
  readonly pinnedAt: Date | null;
  readonly pinPosition: string | null;
  readonly readThrough: Date;
  readonly markedUnread: boolean;
}

export interface AgentStarted {
  readonly agent: Agent;
  readonly created: boolean;
  readonly txid?: string;
}

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

export type WithRepository<A extends { readonly repository: string | null }> = A & {
  readonly repository: string;
};

export function hasRepository<A extends { readonly repository: string | null }>(
  agent: A,
): agent is WithRepository<A> {
  return agent.repository !== null;
}

export type AgentBriefText =
  | { readonly descriptionSnapshot: string; readonly prompt: null }
  | { readonly descriptionSnapshot: null; readonly prompt: string }
  | { readonly descriptionSnapshot: null; readonly prompt: null };

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

export type NewAgent = AgentPlace & {
  readonly automationId?: string | undefined;
  readonly automationOrigin?: StoredAutomationOrigin | undefined;
  readonly automationRunId?: string | undefined;
  readonly startedFrom?: StoredStartedFrom | undefined;
  readonly source?: AgentSource | undefined;
  readonly startedByAgentId?: string | undefined;
  readonly takesOverFrom?: string | undefined;
  readonly title?: string | undefined;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly effort: string;
  readonly contextWindow?: ContextWindow | undefined;
  readonly repository: string | null;
  readonly startBranch?: string | undefined;
  readonly extraRepositories?: readonly NewAgentRepository[] | undefined;
  readonly disabledServers?: readonly string[] | undefined;
  readonly mentionedServers?: readonly string[] | undefined;
  readonly githubAccess?: GitHubAccess | undefined;
  readonly runtime: ConversationRuntime;
  readonly payer?: AgentPayer | undefined;
  readonly machine?: AgentMachineKind | undefined;
  readonly deviceId?: string | undefined;
};

export interface NewAgentRepository {
  readonly repository: string;
  readonly baseBranch?: string | undefined;
}

export interface AgentRouting {
  readonly runtime: ConversationRuntime;
  readonly nativeSession: string | null;
  readonly runnerTokenHash: string | null;
  readonly payer: AgentPayer | null;
}

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

export function agentBriefOf(agent: Pick<Agent, "descriptionSnapshot" | "prompt">): AgentBrief {
  if (agent.prompt !== null) return AGENT_BRIEF.PROMPT;
  return agent.descriptionSnapshot === null ? AGENT_BRIEF.BLANK : AGENT_BRIEF.DESCRIPTION;
}

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

function storedServers(servers: readonly string[]): readonly string[] | null {
  return servers.length === 0 ? null : [...new Set(servers)];
}

const AutomationOriginColumnSchema = Schema.NullOr(
  Schema.Struct({
    name: Schema.String,
    firing: automationFiringSchema,
    prompt: Schema.String,
    body: Schema.optionalKey(Schema.String),
  }),
);
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

const AgentLineRowSchema = Schema.Struct({
  ...LINE_ROW_FIELDS,
  automationName: Schema.NullOr(Schema.String),
  brief: Schema.Literals(Object.values(AGENT_BRIEF)),
});

const TasklessAgentRowSchema = Schema.Struct({
  ...AgentLineRowSchema.fields,
  pinnedAt: Schema.NullOr(InstantColumnSchema),
  pinPosition: Schema.NullOr(Schema.String),
  readThrough: InstantColumnSchema,
  markedUnread: Schema.Boolean,
});

const IdRowSchema = Schema.Struct({ id: Schema.String });

function reachableAgent(userId: string, agentId: string): SQL | undefined {
  return and(eq(agentTable.id, agentId), agentReachableBy(userId));
}

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

const earlierPilot = alias(agentTable, "earlier_pilot");

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

const ownStarterOf = Effect.fnUntraced(function* (userId: string, agentId: string | undefined) {
  if (agentId === undefined) return null;
  const own = yield* findOwnAgentId({ userId, agentId });
  return Option.isSome(own) ? own.value.id : null;
});

const RuntimeColumnSchema = Schema.Literals(Object.values(CONVERSATION_RUNTIME));
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

const TXID = sql<string>`pg_current_xact_id()::text`;

const CommittedAgentRowSchema = Schema.Struct({
  ...AgentRowSchema.fields,
  txid: Schema.String,
});

const TxidRowSchema = Schema.Struct({ txid: Schema.String });

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

const ADDED_AFTER = 1_000_000;

const STANDING_SERVERS = sql`jsonb_array_elements_text(coalesce(${agentTable.mentionedServers}, '[]'::jsonb)) with ordinality as stood(name, place)`;

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

export const noOpenPullRequest: SQL = notInArray(
  sql`coalesce(${agentTable.published}->>'state', '')`,
  [PULL_REQUEST_STATE.OPEN, PULL_REQUEST_STATE.DRAFT],
);

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

const NATIVE_RUNTIMES = [CONVERSATION_RUNTIME.CLAUDE_CODE, CONVERSATION_RUNTIME.CODEX] as const;

export const ENDED_TURN_STATUSES = [
  TURN_STATUS.SETTLED,
  TURN_STATUS.CANCELED,
  TURN_STATUS.FAILED,
] as const;

const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

const findEveAgentsOfSession = SqlSchema.findAll({
  Request: Schema.Struct({ runtimeSessionId: Schema.String }),
  Result: Schema.Struct({ agentId: Schema.String, conversationId: Schema.String }),
  execute: ({ runtimeSessionId }) =>
    Database.use((db) =>
      db
        .select({ agentId: agentTable.id, conversationId: conversations.id })
        .from(conversations)
        .innerJoin(agentTable, eq(agentTable.conversationId, conversations.id))
        .where(
          and(
            eq(conversations.runtimeSessionId, runtimeSessionId),
            or(isNull(conversations.runtime), eq(conversations.runtime, CONVERSATION_RUNTIME.EVE)),
          ),
        )
        .limit(2),
    ),
});

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
        .update(agentTable)
        .set({ runnerTokenHash })
        .where(reachableAgent(userId, agentId))
        .returning({ id: agentTable.id }),
    ),
});

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

function containing(words: string): string {
  return `%${words.replace(/[\\%_]/gu, (special) => `\\${special}`)}%`;
}

const AGENT_SHOWN_NAME = sql<string>`coalesce(
  ${agentTable.title},
  ${agentTable.automationOrigin} ->> 'name',
  replace(regexp_replace(${agentTable.model}, '^[^/]*/', ''), '-', ' ')
)`;

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

function ofAnyAutomation(): SQL {
  return sql`(${agentAutomationRunSql(agentTable)} or ${agentTable.automationRunId} is not null)`;
}

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
    repository === null
      ? undefined
      : eq(sql`lower(${agentTable.repository})`, repository.toLowerCase()),
  );
}

function ownOfAgent(around: typeof AgentAroundSchema.Type): SQL {
  const started = eq(agentTable.startedByAgentId, around.agentId);
  return around.startedByAgentId === null
    ? started
    : (or(started, eq(agentTable.id, around.startedByAgentId)) ?? started);
}

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

export const PublishedColumnSchema = Schema.Struct({
  ...agentPullRequestSchema.fields,
  headSha: Schema.optionalKey(Schema.String),
  mergedAt: Schema.optionalKey(Schema.Number),
});

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

function namesDeliveredRepository(column: SQLWrapper, repository: string): SQL {
  return eq(sql`lower(${column})`, repository.toLowerCase());
}

function publishedNumber(column: SQLWrapper): SQL {
  return sql`(${column}->>'number')::int`;
}

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

const TAKEOVER_HOPS = 10;

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

const deleteConversationRow = SqlSchema.void({
  Request: Schema.String,
  execute: (conversationId) =>
    Database.use((db) => db.delete(conversations).where(eq(conversations.id, conversationId))),
});

const kindUnderLock = Effect.fnUntraced(function* (started: NewAgent) {
  if (started.kind !== AGENT_KIND.PILOT) return started.kind ?? AGENT_KIND.CODER;
  const besides = started.startedFrom?.agentId ?? null;
  const standing = yield* findLivePilot({ taskId: started.taskId, besides });
  return Option.isSome(standing) ? AGENT_KIND.CODER : AGENT_KIND.PILOT;
});

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
        }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
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
        }).pipe(Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)));
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
        if (started.takesOverFrom !== undefined) {
          yield* updateTakenOver({ userId, from: started.takesOverFrom, to: row.id });
        }
        return Option.some({ agent: row, created: true, txid });
      }),
    ),
  );
}

export function discardAgent(userId: string, agentId: string): AgentStoreEffect<boolean> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
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

export interface AgentDeleteGuard<R> {
  readonly standsStopped: (agent: Agent) => Effect.Effect<boolean, StoreFailure, R>;
  readonly beforeDelete: (
    conversationIds: readonly string[],
  ) => Effect.Effect<void, StoreFailure, R>;
}

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

export function listAgents(
  userId: string,
  taskId: string,
  options: { readonly includeArchived?: boolean } = {},
): AgentStoreEffect<readonly Agent[]> {
  return findAgentsOfTask({ userId, taskId, includeArchived: options.includeArchived ?? false });
}

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

type AgentAround = typeof AgentAroundSchema.Type;

interface WorkspaceAgentsAsked {
  readonly repository?: string;
  readonly taskId?: string;
  readonly words?: string;
  readonly includeArchived?: boolean;
  readonly archivedOnly?: boolean;
  readonly ownOnly?: boolean;
  readonly startedBy?: string;
  readonly automation?: boolean;
  readonly automationId?: string;
  readonly taskStatus?: TaskStatus;
  readonly except?: string;
  readonly around?: AgentAround;
  readonly offset?: number;
  readonly limit: number;
}

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

export function listWorkspaceAgents(
  userId: string,
  organizationId: string,
  options: WorkspaceAgentsAsked,
): AgentStoreEffect<readonly Agent[]> {
  return findAgentsOfWorkspace(workspaceRequest(userId, organizationId, options));
}

export function listWorkspaceAgentLines(
  userId: string,
  organizationId: string,
  options: WorkspaceAgentsAsked,
): AgentStoreEffect<readonly AgentLine[]> {
  return findAgentLinesOfWorkspace(workspaceRequest(userId, organizationId, options));
}

export function listTasklessAgentRows(
  userId: string,
  options: { readonly includeArchived?: boolean } = {},
): AgentStoreEffect<readonly TasklessAgentRow[]> {
  return findTasklessAgents({ userId, includeArchived: options.includeArchived ?? false });
}

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

export interface PublishedAgent {
  readonly agent: Agent;
  readonly published: AgentPullRequest | null;
}

export interface PublishedAgentLine {
  readonly agent: AgentLine;
  readonly published: AgentPullRequest | null;
}

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

export function listPublishedAgentsById(
  userId: string,
  agentIds: readonly string[],
): AgentStoreEffect<readonly PublishedAgent[]> {
  if (agentIds.length === 0) return Effect.succeed([]);
  return Effect.map(findPublishedAgentsById({ userId, agentIds }), (rows) =>
    rows.map(({ published, ...agent }) => ({ agent, published })),
  );
}

const CONTINUATIONS_PER_AGENT = 20;

export interface AgentStartedFromIt {
  readonly agentId: string;
  readonly title: string | null;
  readonly messageId?: string;
}

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

export function newlyMerged(
  kept: StoredPullRequest | null,
  published: StoredPullRequest | null,
): boolean {
  if (published?.state !== PULL_REQUEST_STATE.MERGED) return false;
  return kept?.number !== published.number || kept.state !== PULL_REQUEST_STATE.MERGED;
}

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

export function forgetAgentPublishedRead(userId: string, agentId: string): AgentStoreEffect<void> {
  return updateAgentPublishedReadForgotten({ userId, agentId });
}

export function taskHasMergedPullRequest(
  userId: string,
  taskId: string,
): AgentStoreEffect<boolean> {
  return Effect.map(findMergedAgentOfTask({ userId, taskId }), Option.isSome);
}

export function readAgentPublished(
  userId: string,
  agentId: string,
): AgentStoreEffect<StoredPullRequest | null> {
  return Effect.map(findAgentPublished({ userId, agentId }), (row) =>
    Option.isSome(row) ? row.value.published : null,
  );
}

export interface KeptPublished {
  readonly published: StoredPullRequest | null;
  readonly read: StoredPublishedRead;
}

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

export interface AgentFoundOn {
  readonly repository: string;
  readonly branch: string | null;
  readonly extra: boolean;
}

export interface OwnedAgent {
  readonly userId: string;
  readonly agent: Agent;
  readonly on: AgentFoundOn;
}

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

export function readAgentByKey(
  userId: string,
  idempotencyKey: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return findAgentByKey({ userId, idempotencyKey });
}

export function readNewestAgentPlace(
  userId: string,
  taskId: string,
): AgentStoreEffect<Option.Option<typeof AgentPlaceRowSchema.Type>> {
  return findNewestAgentPlace({ userId, taskId });
}

export function readAgent(userId: string, agentId: string): AgentStoreEffect<Option.Option<Agent>> {
  return findAgent({ userId, agentId });
}

export function readVisibleAgent(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return findVisibleAgent({ userId, agentId });
}

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

export function updateAgentChoice(
  userId: string,
  agentId: string,
  choice: ModelChoice,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(updateAgentChoiceCommitted(userId, agentId, choice), Option.map(agentOf));
}

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

export function updateAgentBranch(
  userId: string,
  agentId: string,
  branch: string | null,
): AgentStoreEffect<void> {
  return updateAgentBranchRow({ userId, agentId, branch });
}

export function recordTurnFastRefused(userId: string, turnId: string): AgentStoreEffect<void> {
  return markTurnFastRefused({ userId, turnId });
}

export interface TurnDescriptionNotes {
  readonly turnId: string;
  readonly taken: number;
}

export function reserveTurnDescriptionNotes(
  userId: string,
  conversationId: string,
  requested: number,
): AgentStoreEffect<Option.Option<TurnDescriptionNotes>> {
  return reserveTurnNotes({ userId, conversationId, requested });
}

export function settleTurnDescriptionNotes(
  userId: string,
  turnId: string,
  requested: number,
  saved: number,
): AgentStoreEffect<void> {
  return releaseTurnNotes({ userId, turnId, released: requested - saved });
}

export function renameAgent(
  userId: string,
  agentId: string,
  title: string | null,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(renameAgentCommitted(userId, agentId, title), Option.map(agentOf));
}

export interface AgentCommitted {
  readonly agent: Agent;
  readonly txid?: string;
}

function agentOf({ agent }: AgentCommitted): Agent {
  return agent;
}

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

export function taskPilotStands(taskId: string): AgentStoreEffect<boolean> {
  return Effect.map(findLivePilot({ taskId, besides: null }), Option.isSome);
}

export interface AgentArchiveCommitted extends AgentCommitted {
  readonly archivedNow: boolean;
}

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
        if (archived && archivedBefore !== undefined && archivedBefore !== null) {
          const kept = yield* findAgent({ userId, agentId });
          return Option.map(kept, (agent) => ({ agent, archivedNow: false }));
        }
        const standing = archived ? Option.none() : yield* findAgent({ userId, agentId });
        const written = yield* updateAgentArchived({
          userId,
          agentId,
          archivedAt: archived ? now : null,
          archivedBy: archived ? archivedBy : null,
        });
        if (Option.isNone(written)) return Option.none();
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
        yield* reopenAgentInboxItems(agentId, archivedAt);
        return true;
      }),
    ),
  );
}

export function pinAgent(
  userId: string,
  agentId: string,
  pinned: boolean,
  position?: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return Effect.map(pinAgentCommitted(userId, agentId, pinned, position), Option.map(agentOf));
}

export function pinAgentCommitted(
  userId: string,
  agentId: string,
  pinned: boolean,
  position?: string,
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.gen(function* () {
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

export function markAgentReadCommitted(
  userId: string,
  agentId: string,
  mark: ReadMark,
): AgentStoreEffect<Option.Option<AgentCommitted>> {
  return Effect.gen(function* () {
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

export type SettledTurnAgent = typeof SettledTurnAgentSchema.Type;

export function settledTurnAgent(
  turnId: string,
): AgentStoreEffect<Option.Option<SettledTurnAgent>> {
  return findSettledTurnAgent(turnId);
}

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

export function agentConversationSeq(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<number>> {
  return Effect.map(
    findConversationSeq({ userId, agentId }),
    Option.map((row) => row.seq),
  );
}

export function fillAgentTitle(
  userId: string,
  agentId: string,
  title: string,
): AgentStoreEffect<boolean> {
  return Effect.map(fillAgentTitleRows({ userId, agentId, title }), (rows) => rows.length > 0);
}

export function settleAgentAuthor(
  userId: string,
  agentId: string,
  author: AgentAuthor,
): AgentStoreEffect<Option.Option<AgentAuthor>> {
  return Effect.map(settleAgentAuthorRow({ userId, agentId, author }), (row) =>
    Option.map(row, (settled) => settled.author),
  );
}

export function recordAgentAuthor(
  userId: string,
  agentId: string,
  author: AgentAuthor,
): AgentStoreEffect<void> {
  return updateAgentAuthor({ userId, agentId, author });
}

export function readAgentRouting(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<AgentRouting>> {
  return Effect.map(
    findAgentRouting({ userId, agentId }),
    Option.map((row) => ({ ...row, runtime: row.runtime ?? CONVERSATION_RUNTIME.EVE })),
  );
}

export function readVisibleAgentWorkspace(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<string>> {
  return Effect.map(
    findVisibleAgentWorkspace({ userId, agentId }),
    Option.map((row) => row.organizationId),
  );
}

export function nativeRuntimesOfReached(
  conversationIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, (typeof NATIVE_RUNTIMES)[number]>> {
  if (conversationIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findNativeRuntimes({ conversationIds }),
    (rows) => new Map(rows.map((row) => [row.conversationId, row.runtime])),
  );
}

export interface NativeRoute {
  readonly runtime: (typeof NATIVE_RUNTIMES)[number];
  readonly payer: AgentPayer | null;
}

export function nativeRouteOfReached(
  conversationId: string,
): AgentStoreEffect<Option.Option<NativeRoute>> {
  return findNativeRoute({ conversationId });
}

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

export function readNativeHanded(target: ConversationTarget): AgentStoreEffect<WireValue | null> {
  return Effect.map(findNativeHanded(target), (row) =>
    Option.match(row, { onNone: () => null, onSome: ({ handed }) => handed }),
  );
}

export function recordNativeHanded(
  target: ConversationTarget,
  handed: WireValue,
): AgentStoreEffect<void> {
  return updateNativeHanded({ ...target, handed });
}

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

export interface RunnerTokenConversation {
  readonly userId: string;
  readonly conversationId: string;
  readonly runtimeSessionId: string | null;
}

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

function endedAtOf(
  newest: Option.Option<{ readonly status: string; readonly settledAt: Date | null }>,
): Date | null {
  const ended = Option.filter(newest, (turn) =>
    ENDED_TURN_STATUSES.some((status) => status === turn.status),
  );
  return Option.isSome(ended) ? (ended.value.settledAt ?? new Date(0)) : null;
}

function newestTurnEndedAt(conversationId: string): AgentStoreEffect<Date | null> {
  return Effect.map(findNewestTurnStanding({ conversationId }), endedAtOf);
}

export interface NativeRunStanding {
  readonly conversationId: string;
  readonly userId: string;
  readonly endedAt: Date | null;
}

export function readNativeRunStanding(
  agentId: string,
): AgentStoreEffect<Option.Option<NativeRunStanding>> {
  return Effect.map(readNativeRunStandings([agentId]), (standings) =>
    Option.fromUndefinedOr(standings.get(agentId)),
  );
}

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

export interface EveRunStanding {
  readonly agentId: string;
  readonly conversationId: string;
  readonly endedAt: Date | null;
}

export function readEveRunStanding(
  runtimeSessionId: string,
): AgentStoreEffect<Option.Option<EveRunStanding>> {
  return Effect.gen(function* () {
    const found = yield* findEveAgentsOfSession({ runtimeSessionId });
    const [only] = found;
    if (only === undefined || found.length > 1) return Option.none();
    return Option.some({ ...only, endedAt: yield* newestTurnEndedAt(only.conversationId) });
  });
}

export function readAgentOfConversation(
  userId: string,
  conversationId: string,
): AgentStoreEffect<Option.Option<Agent>> {
  return findAgentOfConversation({ userId, conversationId });
}

export type AgentHeader = Pick<
  Agent,
  "id" | "userId" | "organizationId" | "taskId" | "repository" | "title" | "archivedAt"
> & { readonly machine: AgentMachineKind };

export function readAgentHeaderOfConversation(
  userId: string,
  conversationId: string,
): AgentStoreEffect<Option.Option<AgentHeader>> {
  return findAgentHeaderOfConversation({ userId, conversationId });
}

export interface AgentContextRow {
  readonly model: string;
  readonly contextWindow: ContextWindow;
  readonly lastStep: StoredAgentStep | null;
  readonly compactedAt: Date | null;
}

export function recordAgentStep(
  userId: string,
  agentId: string,
  lastStep: StoredAgentStep,
): AgentStoreEffect<void> {
  return updateAgentStep({ userId, agentId, lastStep });
}

export function recordAgentCompaction(
  userId: string,
  agentId: string,
  at: Date,
): AgentStoreEffect<void> {
  return updateAgentCompaction({ userId, agentId, at });
}

export function readAgentContext(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<AgentContextRow>> {
  return findAgentContext({ userId, agentId });
}

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

export type LineSent =
  | {
      readonly kind: typeof MESSAGE_SENDER.MEMBER;
      readonly member: { readonly userId: string; readonly name: string } | undefined;
    }
  | { readonly kind: typeof MESSAGE_SENDER.APP }
  | {
      readonly kind: typeof MESSAGE_SENDER.AUTOMATION;
      readonly name: string;
      readonly automationId: string | undefined;
    }
  | { readonly kind: typeof MESSAGE_SENDER.GITHUB; readonly login: string }
  | {
      readonly kind: typeof MESSAGE_SENDER.AGENT;
      readonly name: string;
      readonly model: string | undefined;
      readonly agent: SendingAgent | undefined;
    };

interface SendingAgent {
  readonly id: string;
}

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

export interface LinePlace {
  readonly journalId: string;
  readonly afterStep: number;
}

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

export interface DelegationRecord {
  readonly callId: string;
  readonly childConversationId: string;
  readonly model: string;
  readonly effort: string;
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

export const RUNNING_TURN_STATUSES: ReadonlySet<string> = new Set([
  TURN_STATUS.QUEUED,
  TURN_STATUS.RUNNING,
]);
