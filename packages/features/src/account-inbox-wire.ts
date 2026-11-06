import { Schema as EffectSchema } from "effect";
import { automationRunReasonSchema } from "./automation-wire.js";
import { countedNumber, wireUuidSchema } from "./service-wire.js";

export const ACCOUNT_INBOX_ARCHIVED = {
  INCLUDE: "include",
} as const;

export const ACCOUNT_INBOX_REPOSITORYLESS = {
  QUERY: "repositoryless",
  INCLUDE: "include",
} as const;

export const accountInboxEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  planId: wireUuidSchema,
  agentId: wireUuidSchema,
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  agentModel: EffectSchema.String,
  startedBy: EffectSchema.optionalKey(EffectSchema.String),
  waitsOn: EffectSchema.optionalKey(EffectSchema.String),
  title: EffectSchema.String,
  revision: countedNumber,
  postedAt: countedNumber,
  updatedAt: countedNumber,
  unread: EffectSchema.optionalKey(EffectSchema.Boolean),
  asking: EffectSchema.optionalKey(EffectSchema.Boolean),
  remindAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  snoozedUntil: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
});

export type AccountInboxEntry = typeof accountInboxEntrySchema.Type;

export const accountInboxTaskSchema = EffectSchema.Struct({
  planId: wireUuidSchema,
  items: countedNumber,
  toDo: EffectSchema.optionalKey(countedNumber),
  updatedAt: countedNumber,
});

export type AccountInboxTask = typeof accountInboxTaskSchema.Type;

export const accountTasklessEntrySchema = EffectSchema.Struct({
  id: wireUuidSchema,
  agentId: wireUuidSchema,
  agentTitle: EffectSchema.NullOr(EffectSchema.String),
  agentModel: EffectSchema.String,
  startedBy: EffectSchema.optionalKey(EffectSchema.String),
  waitsOn: EffectSchema.optionalKey(EffectSchema.String),
  automationId: EffectSchema.NullOr(wireUuidSchema),
  automationName: EffectSchema.NullOr(EffectSchema.String),
  repository: EffectSchema.NullOr(EffectSchema.String),
  workspaceId: EffectSchema.optionalKey(EffectSchema.String),
  title: EffectSchema.String,
  revision: countedNumber,
  postedAt: countedNumber,
  updatedAt: countedNumber,
  unread: EffectSchema.optionalKey(EffectSchema.Boolean),
  asking: EffectSchema.optionalKey(EffectSchema.Boolean),
  remindAt: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
  snoozedUntil: EffectSchema.optionalKey(EffectSchema.NullOr(countedNumber)),
});

export type AccountTasklessEntry = typeof accountTasklessEntrySchema.Type;

export const accountInboxAutomationSchema = EffectSchema.Struct({
  automationId: EffectSchema.NullOr(wireUuidSchema),
  items: countedNumber,
  updatedAt: countedNumber,
});

export type AccountInboxAutomation = typeof accountInboxAutomationSchema.Type;

export const accountInboxAgentSchema = EffectSchema.Struct({
  agentId: wireUuidSchema,
  items: countedNumber,
  toDo: countedNumber,
  updatedAt: countedNumber,
  agentTitle: accountTasklessEntrySchema.fields.agentTitle,
  agentModel: accountTasklessEntrySchema.fields.agentModel,
  automationId: accountTasklessEntrySchema.fields.automationId,
  automationName: accountTasklessEntrySchema.fields.automationName,
  repository: accountTasklessEntrySchema.fields.repository,
  workspaceId: accountTasklessEntrySchema.fields.workspaceId,
});

export type AccountInboxAgent = typeof accountInboxAgentSchema.Type;

export const accountFailedRunSchema = EffectSchema.Struct({
  id: wireUuidSchema,
  automationId: wireUuidSchema,
  automationName: EffectSchema.String,
  workspaceId: EffectSchema.String,
  reason: EffectSchema.NullOr(automationRunReasonSchema),
  failedAt: countedNumber,
});

export type AccountFailedRun = typeof accountFailedRunSchema.Type;

export const accountInboxAnswerSchema = EffectSchema.Struct({
  items: EffectSchema.Array(accountInboxEntrySchema),
  plans: EffectSchema.Array(accountInboxTaskSchema),
  planless: EffectSchema.optionalKey(EffectSchema.Array(accountTasklessEntrySchema)),
  automations: EffectSchema.optionalKey(EffectSchema.Array(accountInboxAutomationSchema)),
  agents: EffectSchema.optionalKey(EffectSchema.Array(accountInboxAgentSchema)),
  failedRuns: EffectSchema.optionalKey(EffectSchema.Array(accountFailedRunSchema)),
  cursor: EffectSchema.String,
  readAt: countedNumber,
});

export type AccountInboxAnswer = typeof accountInboxAnswerSchema.Type;
