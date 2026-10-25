import { sql } from "drizzle-orm";
import { boolean, check, pgTable, primaryKey, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { organization, user } from "./auth.js";

/**
 * channel.ts -- a workspace's channels, the topic areas its inbox threads live in, and when each member last looked at each.
 *
 * Every member of a workspace sees every one of its channels: there is no
 * membership. A channel's name is a lowercase slug (`app`, `general`),
 * unique among the workspace's channels still open, so an archived one
 * frees its name. `project` marks a channel for one multi-week effort
 * rather than a standing area. Every workspace has exactly one #general,
 * which every thread that names no channel goes to (`inbox.ts`'s
 * `channel_id`); it is minted on first need (`channel-store.ts`'s
 * `ensureGeneralChannel`, and the insert trigger beside `inbox_item`), and
 * is never archived, which the check below holds. `created_by` is null on a
 * #general the workspace minted itself and once its member's account is
 * gone. Every row goes with its workspace.
 */

/** The workspace's own channel: its name and the purpose it is minted with. */
export const GENERAL_CHANNEL = {
  NAME: "general",
  PURPOSE: "Anything that belongs to no other channel.",
} as const;

export const channel = pgTable(
  "channel",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** A lowercase slug, unique among the workspace's open channels. */
    name: text("name").notNull(),
    /** One line saying what the channel is for, which an agent reads to choose it. */
    purpose: text("purpose").notNull(),
    /** Whether the channel is for one project rather than a standing area. */
    project: boolean("project").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamptz("created_at").notNull(),
    /** When the channel was archived; null while it is open. */
    archivedAt: timestamptz("archived_at"),
  },
  (table) => [
    // One open channel per name per workspace, and the lookup of a workspace's #general.
    uniqueIndex("channel_organization_name_open")
      .on(table.organizationId, table.name)
      .where(sql`${table.archivedAt} is null`),
    check("channel_name_slug", sql`${table.name} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      "channel_general_open",
      sql`${table.name} <> ${sql.raw(`'${GENERAL_CHANNEL.NAME}'`)} or ${table.archivedAt} is null`,
    ),
  ],
);

/**
 * The instant a member last looked at a channel, which marks the threads
 * posted since as new to them. A look only ever moves forward, so two
 * devices stamping out of order keep the later. The row goes with its
 * account and its channel.
 */
export const channelLook = pgTable(
  "channel_look",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channel.id, { onDelete: "cascade" }),
    lookedAt: timestamptz("looked_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.channelId] })],
);
