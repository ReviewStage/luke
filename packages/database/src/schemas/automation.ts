import {
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  type AutomationActionJson,
  type AutomationFiring,
  type AutomationGuards,
  type AutomationRunReason,
  type AutomationRunStatus,
  type AutomationScope,
  type AutomationTargetKind,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from "@repo/features/automation-wire";
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";
import { task } from "./task.js";

export const automation = pgTable(
  "automation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    scope: text("scope").$type<AutomationScope>().notNull().default(AUTOMATION_SCOPE.PERSONAL),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull(),
    triggerKind: text("trigger_kind").$type<AutomationTriggerKind>().notNull(),
    trigger: jsonb("trigger").$type<AutomationTrigger>().notNull(),
    action: jsonb("action").$type<AutomationActionJson>().notNull(),
    guards: jsonb("guards").$type<AutomationGuards>().notNull(),
    nextRunAt: timestamptz("next_run_at"),
    webhookSecretHash: text("webhook_secret_hash"),
    repositories: jsonb("repositories").$type<readonly string[]>().notNull().default([]),
    targetKind: text("target_kind")
      .$type<AutomationTargetKind>()
      .notNull()
      .default(AUTOMATION_TARGET.NEW_AGENT),
    targetAgentId: uuid("target_agent_id").references(() => agentTable.id, {
      onDelete: "set null",
    }),
    archiveSuccessful: boolean("archive_successful").notNull().default(false),
    slackDelivery: boolean("slack_delivery").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("automation_user_created").on(table.userId, table.createdAt),
    index("automation_next_run").on(table.nextRunAt).where(sql`${table.nextRunAt} is not null`),
    index("automation_trigger_kind").on(table.triggerKind),
    index("automation_org_scope_created").on(table.organizationId, table.scope, table.createdAt),
  ],
);

export const automationRun = pgTable(
  "automation_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    firing: jsonb("firing").$type<AutomationFiring>().notNull(),
    payload: text("payload"),
    status: text("status").$type<AutomationRunStatus>().notNull(),
    reason: text("reason").$type<AutomationRunReason>(),
    agentId: uuid("agent_id").references(() => agentTable.id, {
      onDelete: "set null",
    }),
    firedAt: timestamptz("fired_at").notNull(),
    settledAt: timestamptz("settled_at"),
    claimedAgentId: uuid("claimed_agent_id").references(() => agentTable.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id").references(() => task.id, { onDelete: "set null" }),
    archiveSettledAt: timestamptz("archive_settled_at"),
    slackDeliveredAt: timestamptz("slack_delivered_at"),
  },
  (table) => [
    uniqueIndex("automation_run_dedupe").on(table.automationId, table.dedupeKey),
    index("automation_run_automation_fired").on(table.automationId, table.firedAt),
    index("automation_run_status_fired").on(table.status, table.firedAt),
    index("automation_run_task").on(table.taskId).where(sql`${table.taskId} is not null`),
    index("automation_run_unrecorded_settled")
      .on(table.status, table.settledAt)
      .where(sql`${table.agentId} is null`),
  ],
);
