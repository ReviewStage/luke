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

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const TxidSchema = Schema.Struct({ txid: Schema.String });

function txidOf(rows: readonly { readonly txid: string }[]): Option.Option<string> {
  return Option.map(Option.fromNullishOr(rows[0]), (row) => row.txid);
}

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

export type SlackInstallation = typeof SlackInstallationRowSchema.Type;

const SlackMemberRowSchema = Schema.Struct({
  slackUserId: Schema.NullOr(Schema.String),
  lookedUpAt: Schema.Date,
});

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

export type SlackThread = typeof SlackThreadSchema.Type;

export type SlackAgentThread = SlackThread & {
  readonly agentId: string;
  readonly userId: string;
};

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

const postedThread = alias(slackAgentThread, "posted_thread");

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

export function linkSlackInstallation(link: SlackInstallationToLink): TaskStoreEffect<string> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    yield* deleteOtherTeam({ organizationId: link.organizationId, teamId: link.teamId });
    const written = yield* upsertInstallation({ ...link, now }).pipe(
      Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
    );
    return written.txid;
  });
}

export function workspaceSlackInstallation(
  organizationId: string,
): TaskStoreEffect<Option.Option<SlackInstallation>> {
  return findInstallation(organizationId);
}

export function deleteSlackInstallation(
  organizationId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(deleteInstallation(organizationId), txidOf);
}

export function slackMemberLookup(
  organizationId: string,
  userId: string,
): TaskStoreEffect<Option.Option<SlackMemberLookup>> {
  return findMember({ organizationId, userId });
}

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

export function recordSlackMemberLookup(
  organizationId: string,
  userId: string,
  slackUserId: string | null,
): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    upsertMember({ organizationId, userId, slackUserId, now }),
  );
}

export function slackNotificationsOn(userId: string): TaskStoreEffect<boolean> {
  return Effect.map(
    findNotifications(userId),
    Option.match({ onNone: () => true, onSome: ({ on }) => on !== false }),
  );
}

export function writeSlackNotifications(userId: string, on: boolean): TaskStoreEffect<string> {
  return upsertNotifications({ userId, on }).pipe(
    Effect.map(({ txid }) => txid),
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
}

export function slackTeamWorkspaces(teamId: string): TaskStoreEffect<readonly string[]> {
  return Effect.map(findTeamWorkspaces(teamId), (rows) => rows.map((row) => row.organizationId));
}

export function slackMemberByEmail(
  organizationId: string,
  email: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findMemberByEmail({ organizationId, email }),
    Option.map((row) => row.userId),
  );
}

export interface SlackMemberConnection {
  readonly userId: string;
  readonly connectSubject: string;
}

export function slackUnresolvedConnections(
  organizationId: string,
): TaskStoreEffect<readonly SlackMemberConnection[]> {
  return findUnresolvedConnections(organizationId);
}

export function slackStartRepository(
  organizationId: string,
  userId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(
    findLatestRepository({ organizationId, userId }),
    Option.map((row) => row.repository),
  );
}

export function recordSlackAgentThread(thread: NewSlackAgentThread): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertAgentThread({ ...thread, postedTurnId: thread.postedTurnId ?? null, now }),
  );
}

export function moveSlackAgentThread(
  thread: SlackAgentThread & { readonly fromAgentId: string },
): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => updateAgentThread({ ...thread, now }));
}

export function touchSlackAgentThread(thread: SlackThread): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => touchAgentThread({ ...thread, now }));
}

export function slackAgentThreadAt(
  organizationId: string,
  channelId: string,
  threadTs: string,
): TaskStoreEffect<Option.Option<{ readonly agentId: string; readonly userId: string }>> {
  return findAgentThread({ organizationId, channelId, threadTs });
}

export function claimSlackThreadTurn(
  agentId: string,
  turnId: string,
): TaskStoreEffect<Option.Option<SlackThread>> {
  return claimThreadTurn({ agentId, turnId });
}

export function isSlackTask(taskId: string): TaskStoreEffect<boolean> {
  return Effect.map(findSlackMadeTask({ taskId }), Option.isSome);
}

export function isSlackStartedAgent(agentId: string): TaskStoreEffect<boolean> {
  return Effect.map(findSlackStart({ agentId }), Option.isSome);
}

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

export function writeSlackDefaultRepository(
  organizationId: string,
  repository: string | null,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(updateDefaultRepository({ organizationId, repository, now }), txidOf),
  );
}

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
