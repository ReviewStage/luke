import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { SLACK_THREAD_ORIGIN, type SlackThreadOrigin } from "../storage-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";

export const slackInstallation = pgTable("slack_installation", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  teamId: text("team_id").notNull(),
  teamName: text("team_name").notNull(),
  defaultRepository: text("default_repository"),
  linkedByUserId: text("linked_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

export const slackMember = pgTable(
  "slack_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slackUserId: text("slack_user_id"),
    lookedUpAt: timestamptz("looked_up_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

export const slackAgentThread = pgTable(
  "slack_agent_thread",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    threadTs: text("thread_ts").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postedTurnId: text("posted_turn_id"),
    createdAt: timestamptz("created_at").notNull(),
    origin: text("origin").$type<SlackThreadOrigin>().notNull().default(SLACK_THREAD_ORIGIN.START),
    activeAt: timestamptz("active_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.channelId, t.threadTs] }),
    index("slack_agent_thread_agent_id").on(t.agentId),
  ],
);

export const slackChannelRepository = pgTable(
  "slack_channel_repository",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    channelId: text("channel_id").notNull(),
    repository: text("repository").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.channelId] })],
);
