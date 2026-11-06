import { Database, type DatabaseServices, type QueryError } from "@repo/database/core/query";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { conversations, turns } from "@repo/database/schemas/storage";
import { hostedUsage } from "@repo/database/schemas/usage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import {
  type AdminCost,
  type AdminCostAccountInfo,
  COST_SOURCE,
} from "@repo/features/admin-cost-wire";
import type { AdminMetricsScope, AdminMetricsWindow } from "@repo/features/admin-wire";
import { and, count, eq, gt, gte, isNotNull, type SQLWrapper, sql, sum } from "drizzle-orm";
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
import { dayStart } from "./admin-metrics.js";
import {
  AdminMetricsScopeSchema,
  AggregateColumnSchema,
  findAccountFaces,
  keptByScope,
  NullableAggregateColumnSchema,
} from "./admin-queries.js";

const UsageFilterSchema = Schema.Struct({
  fetchStart: Schema.Date,
  fetchStartDay: Schema.String,
  scope: AdminMetricsScopeSchema,
  userId: Schema.NullOr(Schema.String),
});

type UsageFilter = typeof UsageFilterSchema.Type;

function keptAccounts(filter: UsageFilter) {
  return and(
    keptByScope(filter.scope),
    filter.userId === null ? undefined : eq(user.id, filter.userId),
  );
}

function utcDayOf(instant: SQLWrapper) {
  return sql<string>`to_char(${instant} at time zone 'UTC', 'YYYY-MM-DD')`;
}

function utcDayOfEpochMs(epochMs: SQLWrapper) {
  return sql<string>`to_char(to_timestamp(${epochMs} / 1000.0) at time zone 'UTC', 'YYYY-MM-DD')`;
}

const parentConversation = alias(conversations, "parent_conversation");

const TURN_INSTANT = sql`coalesce(${turns.settledAt}, ${turns.queuedAt})`;

const TURN_SOURCE = sql<string>`case when ${conversations.kind} = ${CONVERSATION_KIND.AGENT} or ${parentConversation.kind} = ${CONVERSATION_KIND.AGENT} then ${COST_SOURCE.AGENTS} else ${COST_SOURCE.APP} end`;

const TURN_SHARES = sql`jsonb_array_elements(case when jsonb_typeof(${turns.usage}->'byModel') = 'array' and jsonb_array_length(${turns.usage}->'byModel') > 0 then ${turns.usage}->'byModel' else jsonb_build_array(${turns.usage} || jsonb_build_object('model', ${turns.model}::text)) end)`;

const TokenRowSchema = Schema.Struct({
  day: Schema.String,
  source: Schema.Literals([COST_SOURCE.AGENTS, COST_SOURCE.APP]),
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

const MERGED_AT = sql<number>`(${agentTable.published}->>'mergedAt')::bigint`;

const MERGED_DAY = utcDayOfEpochMs(MERGED_AT);

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
        .select({ day: MERGED_DAY, userId: agentTable.userId, merged: count() })
        .from(agentTable)
        .innerJoin(user, eq(user.id, agentTable.userId))
        .where(and(gte(MERGED_AT, filter.fetchStart.getTime()), keptAccounts(filter)))
        .groupBy(MERGED_DAY, agentTable.userId),
    ),
});

function secondsRows(
  source: AdminCostSecondsRow["source"],
  rows: readonly (typeof SecondsRowSchema.Type)[],
): AdminCostSecondsRow[] {
  return rows.map((row) => ({ ...row, source, seconds: row.seconds ?? 0 }));
}

export function readAdminCostUsage(input: {
  now: number;
  windowDays: AdminMetricsWindow;
  scope: AdminMetricsScope;
  userId?: string | undefined;
}): Effect.Effect<AdminCostUsage, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    const fetchStartDay = costWindowKeys(input.now, input.windowDays).prior[0] ?? "";
    const filter: UsageFilter = {
      fetchStart: dayStart(fetchStartDay),
      fetchStartDay,
      scope: input.scope,
      userId: input.userId ?? null,
    };
    const [tokens, dictation, merged] = yield* Effect.all(
      [findTokenUsage(filter), findDictationSeconds(filter), findMergedPullRequests(filter)],
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
      seconds: secondsRows(COST_SOURCE.DICTATION, dictation),
      merged,
    };
  });
}

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
    const rows = ids.length === 0 ? [] : yield* findAccountFaces(ids);
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
