import {
  AGENT_KIND,
  AGENT_MACHINE,
  type AgentArchiver,
  type AgentAuthor,
  type AgentKind,
  type AgentMachineKind,
  type AgentPayer,
  type AgentPullRequest,
  type AgentSource,
  CONTEXT_WINDOW,
  type ContextWindow,
} from "@repo/features/agent-wire";
import type { AutomationFiring } from "@repo/features/automation-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";
import { automation, automationRun } from "./automation.js";
import { device } from "./device.js";
import { conversations } from "./storage.js";
import { task } from "./task.js";

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

export interface StoredAutomationOrigin {
  readonly name: string;
  readonly firing: AutomationFiring;
  readonly prompt: string;
  readonly body?: string;
}

export interface StoredStartedFrom {
  readonly agentId: string;
  readonly messageId?: string;
  readonly messageSteps?: number;
  readonly messageStepParts?: number;
  readonly steps: number;
  readonly totalSteps: number;
  readonly branch?: string;
}

export interface StoredArchive {
  readonly by: AgentArchiver;
  readonly userId: string;
  readonly agentId?: string;
  readonly agentName?: string;
  readonly reason?: string;
  readonly withTask?: boolean;
}

export interface StoredPullRequest extends AgentPullRequest {
  readonly headSha?: string;
  readonly mergedAt?: number;
}

export interface StoredPublishedRead {
  readonly at: number;
  readonly branch: string | null;
  readonly pushed: boolean;
}

export const agentTable = pgTable(
  "agent",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id").references((): AnyPgColumn => automation.id, {
      onDelete: "set null",
    }),
    automationRunId: uuid("automation_run_id").references((): AnyPgColumn => automationRun.id, {
      onDelete: "set null",
    }),
    automationOrigin: jsonb("automation_origin").$type<StoredAutomationOrigin>(),
    startedFrom: jsonb("started_from").$type<StoredStartedFrom>(),
    source: jsonb("source").$type<AgentSource>(),
    startedByAgentId: uuid("started_by_agent_id").references((): AnyPgColumn => agentTable.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    effort: text("effort").notNull(),
    contextWindow: text("context_window")
      .$type<ContextWindow>()
      .notNull()
      .default(CONTEXT_WINDOW.LONG),
    descriptionSnapshot: text("description_snapshot"),
    prompt: text("prompt"),
    repository: text("repository"),
    branch: text("branch"),
    startBranch: text("start_branch"),
    title: text("title"),
    lastStep: jsonb("last_step").$type<StoredAgentStep>(),
    compactedAt: timestamptz("compacted_at"),
    published: jsonb("published").$type<StoredPullRequest>(),
    publishedRead: jsonb("published_read").$type<StoredPublishedRead>(),
    archivedAt: timestamptz("archived_at"),
    archivedBy: jsonb("archived_by").$type<StoredArchive>(),
    disabledServers: jsonb("disabled_servers").$type<readonly string[]>(),
    mentionedServers: jsonb("mentioned_servers").$type<readonly string[]>(),
    author: text("author").$type<AgentAuthor>(),
    githubAccess: text("github_access").$type<GitHubAccess>().notNull().default(GITHUB_ACCESS.APP),
    payer: text("payer").$type<AgentPayer>(),
    runnerTokenHash: text("runner_token_hash"),
    kind: text("kind").$type<AgentKind>().notNull().default(AGENT_KIND.CODER),
    machine: text("machine").$type<AgentMachineKind>().notNull().default(AGENT_MACHINE.VERCEL),
    deviceId: uuid("device_id").references(() => device.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: createdAt(),
    readThrough: timestamptz("read_through"),
  },
  (table) => [
    uniqueIndex("agent_user_idempotency").on(table.userId, table.idempotencyKey),
    index("agent_task_created").on(table.taskId, table.createdAt),
    uniqueIndex("agent_conversation").on(table.conversationId),
    index("agent_org_created").on(table.organizationId, table.createdAt),
    index("agent_org_taskless_created")
      .on(table.organizationId, table.createdAt)
      .where(sql`${table.taskId} is null`),
    index("agent_automation_run")
      .on(table.automationRunId)
      .where(sql`${table.automationRunId} is not null`),
    index("agent_started_from_agent").on(sql`(${table.startedFrom}->>'agentId')`),
    uniqueIndex("agent_runner_token_hash")
      .on(table.runnerTokenHash)
      .where(sql`${table.runnerTokenHash} is not null`),
    index("agent_device_live")
      .on(table.deviceId)
      .where(sql`${table.deviceId} is not null and ${table.archivedAt} is null`),
    index("agent_on_branch")
      .on(sql`lower(${table.repository})`, table.branch)
      .where(sql`${table.branch} is not null`),
  ],
);

export const agentDelegationTable = pgTable("agent_delegation", {
  childConversationId: uuid("child_conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  callId: text("call_id"),
  model: text("model").notNull(),
  effort: text("effort").notNull(),
});
