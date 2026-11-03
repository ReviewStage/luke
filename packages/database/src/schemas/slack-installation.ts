import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";

/**
 * slack-installation.ts -- the Slack workspace a workspace's bot is connected to, and who each member is there.
 *
 * Our Slack bot is one app whose token Vercel Connect holds; an owner
 * or admin connects it to a workspace, which stores the Slack team the
 * token answers for. A workspace holds at most one, so the row is keyed on
 * the workspace. `linked_by_user_id` is the member who connected it, null
 * once their account is gone. The row leaves with its workspace, and a
 * Disconnect deletes it.
 *
 * A member's Slack user id is looked up by email the first time the bot
 * writes to them and kept here, per workspace; a lookup that matched no one
 * is kept too, as a null id, so a member with no match is not asked about
 * on every message. Each row leaves with its installation, so a Disconnect
 * forgets every member, and with its account.
 *
 * A Slack thread a member started an agent from, by mentioning the bot in a
 * channel or writing to it directly, is kept against that agent, so a later
 * mention in the thread is sent to the agent rather than starting another,
 * and each of the agent's settled turns is posted back in the thread once.
 * Each row leaves with its installation, its agent, and its member.
 */
export const slackInstallation = pgTable("slack_installation", {
  organizationId: text("organization_id")
    .primaryKey()
    .references(() => organization.id, { onDelete: "cascade" }),
  /** Slack's id for the team the bot token answers for (`T…`). */
  teamId: text("team_id").notNull(),
  /** The team's name as Slack answered it, which the settings row shows. */
  teamName: text("team_name").notNull(),
  linkedByUserId: text("linked_by_user_id").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamptz("created_at").notNull(),
  updatedAt: timestamptz("updated_at").notNull(),
});

/** One member's Slack user id in the workspace's connected team, or null where their email matched no one when it was looked up. */
export const slackMember = pgTable(
  "slack_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Slack's id for the member (`U…`); null where their email matched no one in the team. */
    slackUserId: text("slack_user_id"),
    /** When Slack was last asked, which is what lets a miss be asked again later. */
    lookedUpAt: timestamptz("looked_up_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

/** A Slack thread an agent was started from, which its later mentions are sent to and its final messages are posted in. */
export const slackAgentThread = pgTable(
  "slack_agent_thread",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    /** Slack's id for the conversation the thread is in (`C…`, `G…`, or `D…`). */
    channelId: text("channel_id").notNull(),
    /** The timestamp of the thread's first message, which Slack names a thread by. */
    threadTs: text("thread_ts").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The member who started the agent from the thread. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The agent's latest turn whose outcome was posted in the thread; null before the first. */
    postedTurnId: text("posted_turn_id"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.channelId, t.threadTs] }),
    index("slack_agent_thread_agent_id").on(t.agentId),
  ],
);
