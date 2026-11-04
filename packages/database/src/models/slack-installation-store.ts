import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { type LiveStatement, liveSelection, liveStatementOf } from "../core/live-statement.js";
import { Database, queryBuilder } from "../core/query.js";
import { INTEGRATION_ROW_STATUS } from "../integration-vocabulary.js";
import { agentTable } from "../schemas/agent.js";
import { member, user } from "../schemas/auth.js";
import { integrationConnection } from "../schemas/integration.js";
import { accountPreference } from "../schemas/preferences.js";
import {
  slackAgentThread,
  slackChannelRepository,
  slackInstallation,
  slackMember,
} from "../schemas/slack-installation.js";
import { SLACK_THREAD_ORIGIN, type SlackThreadOrigin } from "../storage-vocabulary.js";
import type { TaskStoreEffect } from "./task-store.js";
import { workspaceReachableBy } from "./workspace-store.js";

/**
 * slack-installation-store.ts -- the Slack team a workspace's bot is connected to, and its members' Slack user ids.
 *
 * A workspace holds at most one installation. Linking writes the team the
 * bot token answered for; linking a different team first deletes the one
 * standing, so no member's id from the old team is kept. Disconnecting
 * deletes it, and every member's id with it. A member's id is read only
 * through the installation it was looked up under, and is kept as found or
 * as a miss (`slackUserId` null), and a press in Slack finds its member
 * back by that id under the team connected. A member with no id kept may
 * still be found through a Slack account they connected themselves
 * (`slackUnresolvedConnections`), which the bot asks Slack about. Whether a member is written at all is
 * their own switch (`account_preference.slack_notifications`), on until they
 * turn it off, in every workspace alike. Whether the account may connect or
 * disconnect is the caller's to check. Every function is an effect over the
 * ambient `SqlClient`.
 *
 * A message to the bot is read against every workspace connected to its
 * team, oldest connection first, and its writer found as a member by the
 * email Slack holds for them (`slackMemberByEmail`); an agent it starts
 * works in the repository the member's latest agent in the workspace worked
 * in (`slackStartRepository`) unless the message names one. A thread that
 * speaks for an agent, one it was started from or its automation run's result
 * was sent in, is kept against it (`slackAgentThread`), and moved to the
 * agent that continues it where that one ended (`moveSlackAgentThread`). The
 * thread kept, moved, or written in latest is the agent's current one
 * (`touchSlackAgentThread`), and each of the agent's settled turns is claimed
 * there once (`claimSlackThreadTurn`); the task an agent started from Slack
 * stands on is the one its message made (`isSlackTask`).
 * An owner or admin names the repository Slack starts default to, for the
 * workspace and for each channel (`slackStartRepositories`); a channel's is
 * forgotten when the bot leaves it.
 *
 * Settings holds the installation and the channels' repositories as a live
 * read (`slackInstallationLiveStatement`,
 * `slackChannelRepositoriesLiveStatement`), so each write Settings makes
 * answers the transaction it committed in, which a reader holding them
 * waits for before it confirms the write.
 */

/** The id of the transaction a write committed in, read in its own `RETURNING`. */
const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

/** What a write that answers its transaction returns. */
const TxidSchema = Schema.Struct({ txid: Schema.String });

/** The transaction the first row a write returned committed in; none where it wrote none. */
function txidOf(rows: readonly { readonly txid: string }[]): Option.Option<string> {
  return Option.map(Option.fromNullishOr(rows[0]), (row) => row.txid);
}

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

const upsertNotifications = SqlSchema.findOne({
  Request: Schema.Struct({ userId: Schema.String, on: Schema.Boolean }),
  Result: Schema.Struct({ txid: Schema.String }),
  execute: ({ userId, on }) =>
    Database.use((db) =>
      db
        .insert(accountPreference)
        .values({ userId, slackNotifications: on })
        .onConflictDoUpdate({
          target: accountPreference.userId,
          set: { slackNotifications: on },
        })
        .returning({ txid: sql<string>`pg_current_xact_id()::text` }),
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

const upsertInstallation = SqlSchema.findOne({
  Request: Schema.Struct({
    organizationId: Schema.String,
    teamId: Schema.String,
    teamName: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
  }),
  Result: TxidSchema,
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
        })
        .returning(TXID),
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
  Result: TxidSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .delete(slackInstallation)
        .where(eq(slackInstallation.organizationId, organizationId))
        .returning(TXID),
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

/** The member whose kept Slack id in the workspace is the one given, where the workspace's bot stands connected to the team given. */
const findMemberBySlackId = SqlSchema.findOneOption({
  Request: Schema.Struct({
    organizationId: Schema.String,
    teamId: Schema.String,
    slackUserId: Schema.String,
  }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ organizationId, teamId, slackUserId }) =>
    Database.use((db) =>
      db
        .select({ userId: slackMember.userId })
        .from(slackMember)
        .innerJoin(
          slackInstallation,
          eq(slackInstallation.organizationId, slackMember.organizationId),
        )
        .where(
          and(
            eq(slackMember.organizationId, organizationId),
            eq(slackInstallation.teamId, teamId),
            eq(slackMember.slackUserId, slackUserId),
          ),
        )
        .limit(1),
    ),
});

/** The workspaces connected to the Slack team, the oldest connection first. */
const findTeamWorkspaces = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (teamId) =>
    Database.use((db) =>
      db
        .select({ organizationId: slackInstallation.organizationId })
        .from(slackInstallation)
        .where(eq(slackInstallation.teamId, teamId))
        .orderBy(asc(slackInstallation.createdAt), asc(slackInstallation.organizationId)),
    ),
});

/** The member of the workspace whose account's email is the one given, whatever its case. */
const findMemberByEmail = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, email: Schema.String }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ organizationId, email }) =>
    Database.use((db) =>
      db
        .select({ userId: member.userId })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(sql`lower(${user.email})`, email.toLowerCase()),
          ),
        )
        .limit(1),
    ),
});

/** The Slack accounts the workspace's members connected themselves, of each member whose Slack id is not kept: never looked up, or missed. */
const findUnresolvedConnections = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ userId: Schema.String, connectSubject: Schema.String }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ userId: member.userId, connectSubject: integrationConnection.connectSubject })
        .from(member)
        .innerJoin(
          integrationConnection,
          and(
            eq(integrationConnection.userId, member.userId),
            eq(integrationConnection.provider, INTEGRATION_PROVIDER.SLACK),
            eq(integrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED),
          ),
        )
        .leftJoin(
          slackMember,
          and(
            eq(slackMember.organizationId, member.organizationId),
            eq(slackMember.userId, member.userId),
          ),
        )
        .where(and(eq(member.organizationId, organizationId), isNull(slackMember.slackUserId)))
        .orderBy(asc(member.userId), asc(integrationConnection.connectionName)),
    ),
});

/** The repository of the member's latest agent in the workspace that worked in one. */
const findLatestRepository = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, userId: Schema.String }),
  Result: Schema.Struct({ repository: Schema.String }),
  execute: ({ organizationId, userId }) =>
    Database.use((db) =>
      db
        .select({ repository: sql<string>`${agentTable.repository}` })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.organizationId, organizationId),
            eq(agentTable.userId, userId),
            isNotNull(agentTable.repository),
          ),
        )
        .orderBy(desc(agentTable.createdAt))
        .limit(1),
    ),
});

const SlackThreadSchema = Schema.Struct({
  organizationId: Schema.String,
  channelId: Schema.String,
  threadTs: Schema.String,
});

/** Where a Slack thread is: its workspace, its conversation, and its first message's timestamp. */
export type SlackThread = typeof SlackThreadSchema.Type;

/** A Slack thread that speaks for an agent: where it is, and the agent and member it was kept for. */
export type SlackAgentThread = SlackThread & {
  readonly agentId: string;
  readonly userId: string;
};

/** A thread to keep for an agent: where it came from, and the turn its first message posted where it posted one. */
export type NewSlackAgentThread = SlackAgentThread & {
  readonly origin: SlackThreadOrigin;
  readonly postedTurnId?: string;
};

const insertAgentThread = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    channelId: Schema.String,
    threadTs: Schema.String,
    agentId: Schema.String,
    userId: Schema.String,
    postedTurnId: Schema.NullOr(Schema.String),
    origin: Schema.Literals(Object.values(SLACK_THREAD_ORIGIN)),
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(slackAgentThread)
        .values({
          organizationId: row.organizationId,
          channelId: row.channelId,
          threadTs: row.threadTs,
          agentId: row.agentId,
          userId: row.userId,
          postedTurnId: row.postedTurnId,
          origin: row.origin,
          createdAt: row.now,
          activeAt: row.now,
        })
        .onConflictDoNothing(),
    ),
});

const updateAgentThread = SqlSchema.void({
  Request: Schema.Struct({
    ...SlackThreadSchema.fields,
    fromAgentId: Schema.String,
    agentId: Schema.String,
    userId: Schema.String,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(slackAgentThread)
        .set({ agentId: row.agentId, userId: row.userId, postedTurnId: null, activeAt: row.now })
        .where(
          and(
            eq(slackAgentThread.organizationId, row.organizationId),
            eq(slackAgentThread.channelId, row.channelId),
            eq(slackAgentThread.threadTs, row.threadTs),
            eq(slackAgentThread.agentId, row.fromAgentId),
          ),
        ),
    ),
});

const findAgentThread = SqlSchema.findOneOption({
  Request: SlackThreadSchema,
  Result: Schema.Struct({ agentId: Schema.String, userId: Schema.String }),
  execute: ({ organizationId, channelId, threadTs }) =>
    Database.use((db) =>
      db
        .select({ agentId: slackAgentThread.agentId, userId: slackAgentThread.userId })
        .from(slackAgentThread)
        .where(
          and(
            eq(slackAgentThread.organizationId, organizationId),
            eq(slackAgentThread.channelId, channelId),
            eq(slackAgentThread.threadTs, threadTs),
          ),
        ),
    ),
});

const touchAgentThread = SqlSchema.void({
  Request: Schema.Struct({ ...SlackThreadSchema.fields, now: Schema.Date }),
  execute: (row) =>
    Database.use((db) =>
      db
        .update(slackAgentThread)
        .set({ activeAt: row.now })
        .where(
          and(
            eq(slackAgentThread.organizationId, row.organizationId),
            eq(slackAgentThread.channelId, row.channelId),
            eq(slackAgentThread.threadTs, row.threadTs),
          ),
        ),
    ),
});

/** The agent's threads read again inside a claim, as one already posting the turn. */
const postedThread = alias(slackAgentThread, "posted_thread");

/**
 * The agent's current thread, the one active latest, where none of its
 * threads posted this turn last, marked as posting it in the same
 * statement, so a turn is posted once however often its settle is heard,
 * even after another thread became current.
 */
const claimThreadTurn = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String, turnId: Schema.String }),
  Result: SlackThreadSchema,
  execute: ({ agentId, turnId }) =>
    Database.use((db) =>
      db
        .update(slackAgentThread)
        .set({ postedTurnId: turnId })
        .where(
          and(
            sql`(${slackAgentThread.organizationId}, ${slackAgentThread.channelId}, ${slackAgentThread.threadTs}) = (${db
              .select({
                organizationId: slackAgentThread.organizationId,
                channelId: slackAgentThread.channelId,
                threadTs: slackAgentThread.threadTs,
              })
              .from(slackAgentThread)
              .where(eq(slackAgentThread.agentId, agentId))
              .orderBy(desc(slackAgentThread.activeAt), desc(slackAgentThread.threadTs))
              .limit(1)})`,
            sql`not exists (${db
              .select({ posted: sql`1` })
              .from(postedThread)
              .where(
                and(eq(postedThread.agentId, agentId), eq(postedThread.postedTurnId, turnId)),
              )})`,
          ),
        )
        .returning({
          organizationId: slackAgentThread.organizationId,
          channelId: slackAgentThread.channelId,
          threadTs: slackAgentThread.threadTs,
        }),
    ),
});

const findSlackMadeTask = SqlSchema.findOneOption({
  Request: Schema.Struct({ taskId: Schema.String }),
  Result: Schema.Struct({ agentId: Schema.String }),
  execute: ({ taskId }) =>
    Database.use((db) =>
      db
        .select({ agentId: slackAgentThread.agentId })
        .from(slackAgentThread)
        .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
        .where(
          and(
            eq(agentTable.taskId, taskId),
            eq(slackAgentThread.origin, SLACK_THREAD_ORIGIN.START),
          ),
        )
        .limit(1),
    ),
});

const findSlackStart = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String }),
  Result: Schema.Struct({ threadTs: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .select({ threadTs: slackAgentThread.threadTs })
        .from(slackAgentThread)
        .where(
          and(
            eq(slackAgentThread.agentId, agentId),
            eq(slackAgentThread.origin, SLACK_THREAD_ORIGIN.START),
          ),
        )
        .limit(1),
    ),
});

/** The workspace's default repository for Slack starts. */
const findDefaultRepository = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ repository: Schema.NullOr(Schema.String) }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({ repository: slackInstallation.defaultRepository })
        .from(slackInstallation)
        .where(eq(slackInstallation.organizationId, organizationId)),
    ),
});

const updateDefaultRepository = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    repository: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: TxidSchema,
  execute: ({ organizationId, repository, now }) =>
    Database.use((db) =>
      db
        .update(slackInstallation)
        .set({ defaultRepository: repository, updatedAt: now })
        .where(eq(slackInstallation.organizationId, organizationId))
        .returning(TXID),
    ),
});

const ChannelRepositorySchema = Schema.Struct({
  channelId: Schema.String,
  repository: Schema.String,
});

/** One channel's default repository for Slack starts. */
export type SlackChannelRepository = typeof ChannelRepositorySchema.Type;

const findChannelRepositories = SqlSchema.findAll({
  Request: Schema.String,
  Result: ChannelRepositorySchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          channelId: slackChannelRepository.channelId,
          repository: slackChannelRepository.repository,
        })
        .from(slackChannelRepository)
        .where(eq(slackChannelRepository.organizationId, organizationId))
        .orderBy(asc(slackChannelRepository.channelId)),
    ),
});

const upsertChannelRepository = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    channelId: Schema.String,
    repository: Schema.String,
    now: Schema.Date,
  }),
  Result: TxidSchema,
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(slackChannelRepository)
        .values({
          organizationId: row.organizationId,
          channelId: row.channelId,
          repository: row.repository,
          updatedAt: row.now,
        })
        .onConflictDoUpdate({
          target: [slackChannelRepository.organizationId, slackChannelRepository.channelId],
          set: {
            repository: sql`excluded.repository`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning(TXID),
    ),
});

const deleteChannelRepository = SqlSchema.findAll({
  Request: Schema.Struct({ organizationId: Schema.String, channelId: Schema.String }),
  Result: TxidSchema,
  execute: ({ organizationId, channelId }) =>
    Database.use((db) =>
      db
        .delete(slackChannelRepository)
        .where(
          and(
            eq(slackChannelRepository.organizationId, organizationId),
            eq(slackChannelRepository.channelId, channelId),
          ),
        )
        .returning(TXID),
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

/**
 * Connects the workspace's bot to the Slack team, answering the transaction
 * the installation was written in; a different team's installation, and its
 * members' ids, are replaced first.
 */
export function linkSlackInstallation(link: SlackInstallationToLink): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* deleteOtherTeam({ organizationId: link.organizationId, teamId: link.teamId });
    const written = yield* upsertInstallation({ ...link, now }).pipe(
      // Note that an upsert writes its row whatever stood, so it always returns one.
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return written.txid;
  });
}

/** The Slack team the workspace's bot is connected to, or nothing. */
export function workspaceSlackInstallation(
  organizationId: string,
): TaskStoreEffect<Option.Option<SlackInstallation>> {
  return findInstallation(organizationId);
}

/** Disconnects the workspace's bot, forgetting every member's Slack id, answering the transaction it was deleted in; none where none was connected. */
export function deleteSlackInstallation(
  organizationId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(deleteInstallation(organizationId), txidOf);
}

/** The member's Slack id as last looked up in the workspace's team, a miss included; nothing where it was never looked up. */
export function slackMemberLookup(
  organizationId: string,
  userId: string,
): TaskStoreEffect<Option.Option<SlackMemberLookup>> {
  return findMember({ organizationId, userId });
}

/**
 * The member of the workspace a Slack user of its connected team is, as
 * the bot's lookups kept them; nothing where the team is not the one
 * connected, or no member was found as that user. Note that only a member
 * the bot has written is known, which is every member a DM's button can
 * reach.
 */
export function slackMemberOf(
  organizationId: string,
  teamId: string,
  slackUserId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findMemberBySlackId({ organizationId, teamId, slackUserId }),
    Option.map((row) => row.userId),
  );
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

/** Turns the member's switch on or off, every workspace's bot alike, answering the transaction it was written in. */
export function writeSlackNotifications(userId: string, on: boolean): TaskStoreEffect<string> {
  return upsertNotifications({ userId, on }).pipe(
    Effect.map(({ txid }) => txid),
    // An upsert that returned no row is the database breaking its own contract, not an outcome.
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
}

/** The workspaces connected to the Slack team, the oldest connection first; none where no workspace connected it. */
export function slackTeamWorkspaces(teamId: string): TaskStoreEffect<readonly string[]> {
  return Effect.map(findTeamWorkspaces(teamId), (rows) => rows.map((row) => row.organizationId));
}

/** The member of the workspace whose account's email is the one Slack holds for a user, whatever its case; nothing where none is. */
export function slackMemberByEmail(
  organizationId: string,
  email: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findMemberByEmail({ organizationId, email }),
    Option.map((row) => row.userId),
  );
}

/** A Slack account a member connected themselves, by the subject Connect holds its grant under. */
export interface SlackMemberConnection {
  readonly userId: string;
  readonly connectSubject: string;
}

/** The Slack accounts the workspace's members connected under Settings › Integrations, of each member whose Slack id the bot does not keep. */
export function slackUnresolvedConnections(
  organizationId: string,
): TaskStoreEffect<readonly SlackMemberConnection[]> {
  return findUnresolvedConnections(organizationId);
}

/** The repository an agent the member starts from Slack works in where the message names none: their latest agent's in the workspace; nothing where none worked in one. */
export function slackStartRepository(
  organizationId: string,
  userId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findLatestRepository({ organizationId, userId }),
    Option.map((row) => row.repository),
  );
}

/**
 * Keeps the thread as one that speaks for the agent, made its current one,
 * with where it came from and the turn already posted in it where its first
 * message posted one; a thread already kept keeps its first agent.
 */
export function recordSlackAgentThread(thread: NewSlackAgentThread): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertAgentThread({ ...thread, postedTurnId: thread.postedTurnId ?? null, now }),
  );
}

/** Moves the thread from the agent it was kept for to the one that continues it, started by the member named, as that agent's current thread, so its later messages and settled turns go there; a thread moved to another agent since stands. */
export function moveSlackAgentThread(
  thread: SlackAgentThread & { readonly fromAgentId: string },
): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => updateAgentThread({ ...thread, now }));
}

/** Makes the thread its agent's current one, as a member's message in it does, so the turn it starts is posted there. */
export function touchSlackAgentThread(thread: SlackThread): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => touchAgentThread({ ...thread, now }));
}

/** The agent the thread was started from, and the member who started it; nothing for a thread no agent was started from. */
export function slackAgentThreadAt(
  organizationId: string,
  channelId: string,
  threadTs: string,
): TaskStoreEffect<Option.Option<{ readonly agentId: string; readonly userId: string }>> {
  return findAgentThread({ organizationId, channelId, threadTs });
}

/** The agent's current thread where this turn has not yet been posted in it, claimed for the turn as it is read; nothing for an agent no thread speaks for, or a turn posted already. */
export function claimSlackThreadTurn(
  agentId: string,
  turnId: string,
): TaskStoreEffect<Option.Option<SlackThread>> {
  return claimThreadTurn({ agentId, turnId });
}

/**
 * Whether the task is one a Slack message made for the agent it started,
 * which is an agent a started thread is kept for standing on it; a Slack
 * start makes its agent's task, and its continue lands on that same task,
 * so no other task holds such an agent. A run's result thread makes no task
 * Slack's, whatever agent its run went to.
 */
export function isSlackTask(taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(findSlackMadeTask({ taskId }), Option.isSome);
}

/** Whether the agent was started from a Slack message, or continues one that was: a started thread is kept for it. */
export function isSlackStartedAgent(agentId: string): TaskStoreEffect<boolean> {
  return Effect.map(findSlackStart({ agentId }), Option.isSome);
}

/** The workspace's default repository for Slack starts, and each channel's, as an owner or admin named them. */
export function slackStartRepositories(organizationId: string): TaskStoreEffect<{
  readonly defaultRepository: string | null;
  readonly channels: readonly SlackChannelRepository[];
}> {
  return Effect.gen(function* () {
    const found = yield* findDefaultRepository(organizationId);
    const channels = yield* findChannelRepositories(organizationId);
    const defaultRepository = Option.getOrNull(
      Option.flatMapNullishOr(found, (row) => row.repository),
    );
    return { defaultRepository, channels };
  });
}

/** Names the workspace's default repository for Slack starts, or clears it with null, answering the transaction it was written in; none where the bot is not connected. */
export function writeSlackDefaultRepository(
  organizationId: string,
  repository: string | null,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(updateDefaultRepository({ organizationId, repository, now }), txidOf),
  );
}

/**
 * Names a channel's default repository for Slack starts, or forgets it with
 * null, answering the transaction it was written in; none where a forget
 * found none named. Fails where the bot is not connected, since the row is
 * keyed under its installation.
 */
export function writeSlackChannelRepository(
  organizationId: string,
  channelId: string,
  repository: string | null,
): TaskStoreEffect<Option.Option<string>> {
  if (repository === null) {
    return Effect.map(deleteChannelRepository({ organizationId, channelId }), txidOf);
  }
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(upsertChannelRepository({ organizationId, channelId, repository, now }), txidOf),
  );
}

/**
 * The workspace's Slack bot as one member's held read answers it: the
 * workspace it stands in, the team it is connected to, and the default
 * repository for Slack starts, null where none is named; no row while it is
 * not connected, and none at all once the reader is no member of the
 * workspace, so a subscription stays bound to the rule its endpoint
 * checked. Every column is under the key the wire reads it by
 * (`@repo/features/workspace-integrations-live`). None where a statement
 * names a value Realtime cannot carry.
 */
export function slackInstallationLiveStatement(
  readerId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          workspaceId: slackInstallation.organizationId,
          teamId: slackInstallation.teamId,
          teamName: slackInstallation.teamName,
          defaultRepository: slackInstallation.defaultRepository,
        }),
      )
      .from(slackInstallation)
      .where(
        and(
          eq(slackInstallation.organizationId, organizationId),
          workspaceReachableBy(readerId, organizationId),
        ),
      ),
  );
}

/**
 * Each Slack channel's default repository the workspace names, as one
 * member's held read answers them: Slack's id for the channel and the
 * repository, while the reader is a member of the workspace. Every column
 * is under the key the wire reads it by, and the order is the reader's to
 * keep. None where a statement names a value Realtime cannot carry.
 */
export function slackChannelRepositoriesLiveStatement(
  readerId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          channelId: slackChannelRepository.channelId,
          repository: slackChannelRepository.repository,
        }),
      )
      .from(slackChannelRepository)
      .where(
        and(
          eq(slackChannelRepository.organizationId, organizationId),
          workspaceReachableBy(readerId, organizationId),
        ),
      ),
  );
}
