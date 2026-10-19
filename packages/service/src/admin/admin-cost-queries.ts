/**
 * admin-cost-queries.ts -- the usage the Cost screen prices, read as day-and-account aggregates of the service's own tables.
 *
 * Turns are summed by UTC day, account, source, and the model each share of
 * their tokens ran on, so the read answers a few rows per active account per
 * day rather than every turn. Seconds are summed the same way from the three
 * ledgers that meter them, and merged pull requests counted by the day
 * GitHub said each merged. Every read is held to the window and the one
 * before it, keeps the dashboard's scope through the account's user row,
 * and may be narrowed to one account, which is how an account's own page
 * reads its spend.
 */

import { Database, type DatabaseServices, type QueryError } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { conversations, turns } from "@luke/database/schemas/storage";
import { hostedUsage, voiceSessionUsage } from "@luke/database/schemas/usage";
import { voiceAvatarSessions, voiceSessions } from "@luke/database/schemas/voice";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import {
  and,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  type SQLWrapper,
  sql,
  sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Result, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { ModelCatalog } from "../providers/model-catalog.js";
import { isAdminRole } from "./admin-access.js";
import {
  type AdminCostSecondsRow,
  type AdminCostUsage,
  buildAdminCost,
  costWindowKeys,
  priceCostUsage,
  topCostAccountIds,
} from "./admin-cost.js";
import { type AdminCost, type AdminCostAccountInfo, COST_SOURCE } from "./admin-cost-wire.js";
import {
  AdminMetricsScopeSchema,
  AggregateColumnSchema,
  keptByScope,
  NullableAggregateColumnSchema,
  UserRoleSchema,
} from "./admin-queries.js";
import type { AdminMetricsScope, AdminMetricsWindow } from "./http.js";

const UsageFilterSchema = Schema.Struct({
  fetchStart: Schema.Date,
  fetchStartDay: Schema.String,
  scope: AdminMetricsScopeSchema,
  userId: Schema.NullOr(Schema.String),
});

type UsageFilter = typeof UsageFilterSchema.Type;

/** The scope, and the one account where a read names one, on the user row every read joins; `and` drops the absent half. */
function keptAccounts(filter: UsageFilter) {
  return and(
    keptByScope(filter.scope),
    filter.userId === null ? undefined : eq(user.id, filter.userId),
  );
}

/** A UTC day key of an instant column, which the builder has no operator for. */
function utcDayOf(instant: SQLWrapper) {
  return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD')`;
}

/** A UTC day key of an epoch-milliseconds expression. */
function utcDayOfEpochMs(epochMs: SQLWrapper) {
  return sql<string>`to_char(to_timestamp(${epochMs} / 1000.0) at time zone 'UTC', 'YYYY-MM-DD')`;
}

const parentConversation = alias(conversations, "parent_conversation");

/** When a turn's usage landed: its settle, or its queue where a row never settled. */
const TURN_INSTANT = sql`coalesce(${turns.settledAt}, ${turns.queuedAt})`;

/**
 * A coding agent's turns are its own conversation's and its workers', which
 * are its conversation's children, as `turnUsagesOf` sums an agent's; every
 * other turn is Luke's own.
 */
const TURN_SOURCE = sql<string>`case when ${conversations.kind} = ${CONVERSATION_KIND.CODING_AGENT} or ${parentConversation.kind} = ${CONVERSATION_KIND.CODING_AGENT} then ${COST_SOURCE.CODING_AGENTS} else ${COST_SOURCE.LUKE} end`;

/**
 * One element per share a turn's tokens were priced in: its by-model
 * breakdown where the row keeps one, and otherwise its whole counts at the
 * row's model, which is none where the row names none. This is the split
 * `usage.ts`'s `sharesOf` reads, spelled in SQL so the shares are summed
 * before they leave the database; the pricing itself stays `usageOfTurns`'s.
 */
const TURN_SHARES = sql`jsonb_array_elements(case when jsonb_typeof(${turns.usage}->'byModel') = 'array' and jsonb_array_length(${turns.usage}->'byModel') > 0 then ${turns.usage}->'byModel' else jsonb_build_array(${turns.usage} || jsonb_build_object('model', ${turns.model}::text)) end)`;

const TokenRowSchema = Schema.Struct({
  day: Schema.String,
  source: Schema.Literals([COST_SOURCE.CODING_AGENTS, COST_SOURCE.LUKE]),
  userId: Schema.String,
  model: Schema.NullOr(Schema.String),
  fastRefused: Schema.Boolean,
  inputTokens: NullableAggregateColumnSchema,
  outputTokens: NullableAggregateColumnSchema,
  cachedInputTokens: NullableAggregateColumnSchema,
  reasoningTokens: NullableAggregateColumnSchema,
  cacheWriteTokens: NullableAggregateColumnSchema,
});

const findTokenUsage = SqlSchema.findAll({
  Request: UsageFilterSchema,
  Result: TokenRowSchema,
  execute: (filter) =>
    Database.use((db) => {
      const shares = db
        .select({
          day: utcDayOf(TURN_INSTANT).as("day"),
          source: TURN_SOURCE.as("source"),
          userId: turns.userId,
          fastRefused: turns.fastRefused,
          share: TURN_SHARES.as("share"),
        })
        .from(turns)
        .innerJoin(user, eq(user.id, turns.userId))
        .innerJoin(conversations, eq(conversations.id, turns.conversationId))
        .leftJoin(parentConversation, eq(parentConversation.id, conversations.parentConversationId))
        .where(
          and(isNotNull(turns.usage), gte(TURN_INSTANT, filter.fetchStart), keptAccounts(filter)),
        )
        .as("shares");
      const counted = (field: string) =>
        sql<number | null>`sum((${shares.share}->>${field})::numeric)`;
      const model = sql<string | null>`${shares.share}->>'model'`;
      return db
        .select({
          day: shares.day,
          source: shares.source,
          userId: shares.userId,
          model,
          fastRefused: shares.fastRefused,
          inputTokens: counted("inputTokens"),
          outputTokens: counted("outputTokens"),
          cachedInputTokens: counted("cachedInputTokens"),
          reasoningTokens: counted("reasoningTokens"),
          cacheWriteTokens: counted("cacheWriteTokens"),
        })
        .from(shares)
        .groupBy(shares.day, shares.source, shares.userId, model, shares.fastRefused);
    }),
});

const SecondsRowSchema = Schema.Struct({
  day: Schema.String,
  userId: Schema.String,
  seconds: NullableAggregateColumnSchema,
});

const VOICE_DAY = utcDayOfEpochMs(voiceSessionUsage.recordedAt);

/**
 * The billed seconds by the Live model each session ran on, which its
 * session row keeps; a row gone with its task, or written before the model
 * was kept, answers none.
 */
const findVoiceSeconds = SqlSchema.findAll({
  Request: UsageFilterSchema,
  Result: Schema.Struct({ ...SecondsRowSchema.fields, model: Schema.NullOr(Schema.String) }),
  execute: (filter) =>
    Database.use((db) =>
      db
        .select({
          day: VOICE_DAY,
          userId: voiceSessionUsage.userId,
          model: voiceSessions.model,
          seconds: sum(voiceSessionUsage.seconds),
        })
        .from(voiceSessionUsage)
        .innerJoin(user, eq(user.id, voiceSessionUsage.userId))
        .leftJoin(voiceSessions, eq(voiceSessions.liveSessionId, voiceSessionUsage.sessionId))
        .where(
          and(gte(voiceSessionUsage.recordedAt, filter.fetchStart.getTime()), keptAccounts(filter)),
        )
        .groupBy(VOICE_DAY, voiceSessionUsage.userId, voiceSessions.model),
    ),
});

const findDictationSeconds = SqlSchema.findAll({
  Request: UsageFilterSchema,
  Result: SecondsRowSchema,
  execute: (filter) =>
    Database.use((db) =>
      db
        .select({
          day: hostedUsage.day,
          userId: hostedUsage.userId,
          seconds: sum(hostedUsage.dictationSeconds),
        })
        .from(hostedUsage)
        .innerJoin(user, eq(user.id, hostedUsage.userId))
        .where(
          and(
            gte(hostedUsage.day, filter.fetchStartDay),
            gt(hostedUsage.dictationSeconds, 0),
            keptAccounts(filter),
          ),
        )
        .groupBy(hostedUsage.day, hostedUsage.userId),
    ),
});

const AVATAR_DAY = utcDayOf(voiceAvatarSessions.startedAt);

const findAvatarSeconds = SqlSchema.findAll({
  Request: UsageFilterSchema,
  Result: SecondsRowSchema,
  execute: (filter) =>
    Database.use((db) =>
      db
        .select({
          day: AVATAR_DAY,
          userId: voiceAvatarSessions.userId,
          seconds: sum(voiceAvatarSessions.seconds),
        })
        .from(voiceAvatarSessions)
        .innerJoin(user, eq(user.id, voiceAvatarSessions.userId))
        .where(
          and(
            isNotNull(voiceAvatarSessions.seconds),
            gte(voiceAvatarSessions.startedAt, filter.fetchStart),
            keptAccounts(filter),
          ),
        )
        .groupBy(AVATAR_DAY, voiceAvatarSessions.userId),
    ),
});

/** When GitHub said the agent's pull request merged, in epoch milliseconds, as its row keeps it. */
const MERGED_AT = sql<number>`(${codingAgent.published}->>'mergedAt')::bigint`;

const MERGED_DAY = utcDayOfEpochMs(MERGED_AT);

/**
 * Pull requests merged, by the account that started the agent. An agent
 * goes with its task, so a deleted task's merges leave the count with it.
 */
const findMergedPullRequests = SqlSchema.findAll({
  Request: UsageFilterSchema,
  Result: Schema.Struct({
    day: Schema.String,
    userId: Schema.String,
    merged: AggregateColumnSchema,
  }),
  execute: (filter) =>
    Database.use((db) =>
      db
        .select({ day: MERGED_DAY, userId: codingAgent.userId, merged: count() })
        .from(codingAgent)
        .innerJoin(user, eq(user.id, codingAgent.userId))
        .where(and(gte(MERGED_AT, filter.fetchStart.getTime()), keptAccounts(filter)))
        .groupBy(MERGED_DAY, codingAgent.userId),
    ),
});

const findAccounts = SqlSchema.findAll({
  Request: Schema.Array(Schema.String),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    email: Schema.String,
    image: Schema.NullOr(Schema.String),
    role: UserRoleSchema,
  }),
  execute: (ids) =>
    Database.use((db) =>
      db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
          role: user.role,
        })
        .from(user)
        .where(inArray(user.id, [...ids])),
    ),
});

function secondsRows(
  source: AdminCostSecondsRow["source"],
  rows: readonly (typeof SecondsRowSchema.Type & { model?: string | null })[],
): AdminCostSecondsRow[] {
  return rows.map((row) => ({
    ...row,
    source,
    model: row.model ?? null,
    seconds: row.seconds ?? 0,
  }));
}

/**
 * Every usage the Cost screen prices, over the window and the one before
 * it, for the accounts the scope keeps, or for the one account named.
 */
export function readAdminCostUsage(input: {
  now: number;
  windowDays: AdminMetricsWindow;
  scope: AdminMetricsScope;
  userId?: string | undefined;
}): Effect.Effect<AdminCostUsage, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    const fetchStartDay = costWindowKeys(input.now, input.windowDays).prior[0] ?? "";
    const filter: UsageFilter = {
      fetchStart: new Date(`${fetchStartDay}T00:00:00.000Z`),
      fetchStartDay,
      scope: input.scope,
      userId: input.userId ?? null,
    };
    const [tokens, voice, dictation, avatar, merged] = yield* Effect.all(
      [
        findTokenUsage(filter),
        findVoiceSeconds(filter),
        findDictationSeconds(filter),
        findAvatarSeconds(filter),
        findMergedPullRequests(filter),
      ],
      { concurrency: "unbounded" },
    );
    return {
      tokens: tokens.map((row) => ({
        ...row,
        inputTokens: row.inputTokens ?? 0,
        outputTokens: row.outputTokens ?? 0,
        cachedInputTokens: row.cachedInputTokens ?? 0,
        reasoningTokens: row.reasoningTokens ?? 0,
        cacheWriteTokens: row.cacheWriteTokens ?? 0,
      })),
      seconds: [
        ...secondsRows(COST_SOURCE.VOICE, voice),
        ...secondsRows(COST_SOURCE.DICTATION, dictation),
        ...secondsRows(COST_SOURCE.AVATAR, avatar),
      ],
      merged,
    };
  });
}

/**
 * The Cost screen's whole read: the usage, priced at the catalog as the
 * instance holds it, and the most expensive accounts' own rows. A catalog
 * that cannot be read prices no token rather than failing the page, and the
 * answer says so, so every model token stands as unpriced and never as $0.
 */
export function readAdminCost(input: {
  now: number;
  windowDays: AdminMetricsWindow;
  scope: AdminMetricsScope;
}): Effect.Effect<AdminCost, QueryError | Schema.SchemaError, DatabaseServices | ModelCatalog> {
  return Effect.gen(function* () {
    const catalog = yield* ModelCatalog;
    const [read, usage] = yield* Effect.all(
      [Effect.result(catalog.read), readAdminCostUsage(input)],
      { concurrency: "unbounded" },
    );
    const offered = Result.isSuccess(read) ? read.success : [];
    const priced = priceCostUsage(usage, offered);
    const ids = topCostAccountIds(priced, input.now, input.windowDays);
    const rows = ids.length === 0 ? [] : yield* findAccounts(ids);
    const accounts = new Map<string, AdminCostAccountInfo>(
      rows.map((row) => [
        row.id,
        {
          id: row.id,
          name: row.name,
          email: row.email,
          image: row.image,
          admin: isAdminRole(row.role),
        },
      ]),
    );
    return buildAdminCost({
      priced,
      merged: usage.merged,
      accounts,
      catalogAvailable: Result.isSuccess(read),
      now: input.now,
      windowDays: input.windowDays,
    });
  });
}
