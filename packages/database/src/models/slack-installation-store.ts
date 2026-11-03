import { and, eq, ne, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { accountPreference } from "../schemas/preferences.js";
import { slackInstallation, slackMember } from "../schemas/slack-installation.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * slack-installation-store.ts -- the Slack team a workspace's bot is connected to, and its members' Slack user ids.
 *
 * A workspace holds at most one installation. Linking writes the team the
 * bot token answered for; linking a different team first deletes the one
 * standing, so no member's id from the old team is kept. Disconnecting
 * deletes it, and every member's id with it. A member's id is read only
 * through the installation it was looked up under, and is kept as found or
 * as a miss (`slackUserId` null). Whether a member is written at all is
 * their own switch (`account_preference.slack_notifications`), on until they
 * turn it off, in every workspace alike. Whether the account may connect or
 * disconnect is the caller's to check. Every function is an effect over the
 * ambient `SqlClient`.
 */

/** What linking names: the workspace, the Slack team the bot answers for, and the member connecting it. */
export interface SlackInstallationToLink {
  readonly organizationId: string;
  readonly teamId: string;
  readonly teamName: string;
  readonly userId: string;
}

const SlackInstallationRowSchema = Schema.Struct({
  teamId: Schema.String,
  teamName: Schema.String,
});

/** The Slack team a workspace's bot is connected to. */
export type SlackInstallation = typeof SlackInstallationRowSchema.Type;

const SlackMemberRowSchema = Schema.Struct({
  slackUserId: Schema.NullOr(Schema.String),
  lookedUpAt: Schema.Date,
});

/** A member's Slack user id as last looked up, or null where their email matched no one, and when. */
export type SlackMemberLookup = typeof SlackMemberRowSchema.Type;

const findNotifications = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ on: Schema.NullOr(Schema.Boolean) }),
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({ on: accountPreference.slackNotifications })
        .from(accountPreference)
        .where(eq(accountPreference.userId, userId)),
    ),
});

const upsertNotifications = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, on: Schema.Boolean }),
  execute: ({ userId, on }) =>
    Database.use((db) =>
      db
        .insert(accountPreference)
        .values({ userId, slackNotifications: on })
        .onConflictDoUpdate({
          target: accountPreference.userId,
          set: { slackNotifications: on },
        }),
    ),
});

/** Another team's installation deleted before a link, so its members' ids leave with it. */
const deleteOtherTeam = SqlSchema.void({
  Request: Schema.Struct({ organizationId: Schema.String, teamId: Schema.String }),
  execute: ({ organizationId, teamId }) =>
    Database.use((db) =>
      db
        .delete(slackInstallation)
        .where(
          and(
            eq(slackInstallation.organizationId, organizationId),
            ne(slackInstallation.teamId, teamId),
          ),
        ),
    ),
});

const upsertInstallation = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    teamId: Schema.String,
    teamName: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(slackInstallation)
        .values({
          organizationId: row.organizationId,
          teamId: row.teamId,
          teamName: row.teamName,
          linkedByUserId: row.userId,
          createdAt: row.now,
          updatedAt: row.now,
        })
        .onConflictDoUpdate({
          target: slackInstallation.organizationId,
          set: {
            teamName: sql`excluded.team_name`,
            linkedByUserId: sql`excluded.linked_by_user_id`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    ),
});

const findInstallation = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: SlackInstallationRowSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ teamId: slackInstallation.teamId, teamName: slackInstallation.teamName })
        .from(slackInstallation)
        .where(eq(slackInstallation.organizationId, organizationId)),
    ),
});

const deleteInstallation = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ teamId: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .delete(slackInstallation)
        .where(eq(slackInstallation.organizationId, organizationId))
        .returning({ teamId: slackInstallation.teamId }),
    ),
});

const findMember = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, userId: Schema.String }),
  Result: SlackMemberRowSchema,
  execute: ({ organizationId, userId }) =>
    Database.use((db) =>
      db
        .select({ slackUserId: slackMember.slackUserId, lookedUpAt: slackMember.lookedUpAt })
        .from(slackMember)
        .where(and(eq(slackMember.organizationId, organizationId), eq(slackMember.userId, userId))),
    ),
});

/** A lookup kept, found or missed; the workspace's installation must stand, since the row is keyed under it. */
const upsertMember = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    userId: Schema.String,
    slackUserId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(slackMember)
        .values({
          organizationId: row.organizationId,
          userId: row.userId,
          slackUserId: row.slackUserId,
          lookedUpAt: row.now,
        })
        .onConflictDoUpdate({
          target: [slackMember.organizationId, slackMember.userId],
          set: {
            slackUserId: sql`excluded.slack_user_id`,
            lookedUpAt: sql`excluded.looked_up_at`,
          },
        }),
    ),
});

/** Connects the workspace's bot to the Slack team; a different team's installation, and its members' ids, are replaced. */
export function linkSlackInstallation(link: SlackInstallationToLink): TaskStoreEffect<void> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* deleteOtherTeam({ organizationId: link.organizationId, teamId: link.teamId });
    yield* upsertInstallation({ ...link, now });
  });
}

/** The Slack team the workspace's bot is connected to, or nothing. */
export function workspaceSlackInstallation(
  organizationId: string,
): TaskStoreEffect<Option.Option<SlackInstallation>> {
  return findInstallation(organizationId);
}

/** Disconnects the workspace's bot, forgetting every member's Slack id; false where none was connected. */
export function deleteSlackInstallation(organizationId: string): TaskStoreEffect<boolean> {
  return Effect.map(deleteInstallation(organizationId), (rows) => rows.length > 0);
}

/** The member's Slack id as last looked up in the workspace's team, a miss included; nothing where it was never looked up. */
export function slackMemberLookup(
  organizationId: string,
  userId: string,
): TaskStoreEffect<Option.Option<SlackMemberLookup>> {
  return findMember({ organizationId, userId });
}

/** Keeps what a lookup found for the member, or null for a miss; fails where the workspace holds no installation. */
export function recordSlackMemberLookup(
  organizationId: string,
  userId: string,
  slackUserId: string | null,
): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    upsertMember({ organizationId, userId, slackUserId, now }),
  );
}

/** Whether the member's switch lets our Slack bot write them; on where they never chose. */
export function slackNotificationsOn(userId: string): TaskStoreEffect<boolean> {
  return Effect.map(
    findNotifications(userId),
    Option.match({ onNone: () => true, onSome: ({ on }) => on !== false }),
  );
}

/** Turns the member's switch on or off, every workspace's bot alike. */
export function writeSlackNotifications(userId: string, on: boolean): TaskStoreEffect<void> {
  return upsertNotifications({ userId, on });
}
