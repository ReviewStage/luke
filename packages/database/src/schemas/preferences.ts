import type { AgentMachineKind, ContextWindow } from "@repo/features/agent-wire";
import type { ChaptersModelId } from "@repo/features/chapters-model-choice";
import type { LinkOpen } from "@repo/features/link-open";
import type { AgentEnter, CommitAuthor, ExperimentChoices } from "@repo/settings";
import { boolean, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";

export const accountPreference = pgTable("account_preference", {
  userId: text("user_id")
    .primaryKey()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  linkOpen: text("link_open").$type<LinkOpen>(),
  agentEnter: text("agent_enter").$type<AgentEnter>(),
  commitAuthor: text("commit_author").$type<CommitAuthor>(),
  setupFinished: boolean("setup_finished"),
  setupPlace: text("setup_place"),
  agentModel: text("agent_model"),
  agentEffort: text("agent_effort"),
  agentContextWindow: text("agent_context_window").$type<ContextWindow>(),
  chaptersModel: text("chapters_model").$type<ChaptersModelId>(),
  experiments: jsonb("experiments").$type<ExperimentChoices>(),
  slackNotifications: boolean("slack_notifications"),
  runsOnMachine: text("runs_on_machine").$type<AgentMachineKind>(),
  runsOnDeviceId: uuid("runs_on_device_id"),
  createdAt: createdAt(),
  updatedAt: timestamptz("updated_at"),
});
