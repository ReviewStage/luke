import { and, asc, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { runnerLine } from "../schemas/runner-line.js";

type RunnerLineEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const RUNNER_LINE_EXPIRY = Duration.days(1);

export const ANY_LAUNCH = 0;

const LINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const RunnerLineSchema = Schema.Struct({ seq: Schema.Number, text: Schema.String });
export type RunnerLine = typeof RunnerLineSchema.Type;

const insertLine = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    launch: Schema.Number,
    text: Schema.String,
    lineId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: ({ userId, agentId, launch, text, lineId, now }) =>
    Database.use((db) =>
      db
        .insert(runnerLine)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`gen_random_uuid()`.as("id"),
              agentId: sql<string>`${agentTable.id}`.as("agent_id"),
              userId: sql<string>`${agentTable.userId}`.as("user_id"),
              launch: sql<number>`${launch}::bigint`.as("launch"),
              text: sql<string>`${text}::text`.as("text"),
              lineId: sql<string | null>`${lineId}::uuid`.as("line_id"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
              acceptedAt: sql<Date | null>`null::timestamptz`.as("accepted_at"),
            })
            .from(agentTable)
            .where(and(eq(agentTable.id, agentId), eq(agentTable.userId, userId))),
        )
        .onConflictDoUpdate({
          target: [runnerLine.agentId, runnerLine.lineId],
          targetWhere: isNotNull(runnerLine.lineId),
          set: {
            launch: sql`case when ${runnerLine.launch} = ${ANY_LAUNCH} then excluded.launch else ${runnerLine.launch} end`,
          },
        })
        .returning({ seq: runnerLine.seq }),
    ),
});

const deleteExpired = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, before: Schema.Date }),
  execute: ({ userId, agentId, before }) =>
    Database.use((db) =>
      db
        .delete(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            lt(runnerLine.createdAt, before),
          ),
        ),
    ),
});

const findLinesPast = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    launch: Schema.Number,
    after: Schema.Number,
    since: Schema.Date,
    limit: Schema.Number,
  }),
  Result: RunnerLineSchema,
  execute: ({ userId, agentId, launch, after, since, limit }) =>
    Database.use((db) =>
      db
        .select({ seq: runnerLine.seq, text: runnerLine.text })
        .from(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            gt(runnerLine.seq, after),
            or(isNull(runnerLine.lineId), isNull(runnerLine.acceptedAt)),
            or(
              eq(runnerLine.launch, launch),
              and(
                lt(runnerLine.launch, launch),
                isNotNull(runnerLine.lineId),
                gte(runnerLine.createdAt, since),
              ),
            ),
          ),
        )
        .orderBy(asc(runnerLine.seq))
        .limit(limit),
    ),
});

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ seq: Schema.Number }),
  execute: ({ userId, agentId, since }) =>
    Database.use((db) =>
      db
        .select({ seq: runnerLine.seq })
        .from(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            isNotNull(runnerLine.lineId),
            isNull(runnerLine.acceptedAt),
            gte(runnerLine.createdAt, since),
          ),
        )
        .limit(1),
    ),
});

const deleteHandedOn = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, since: Schema.Date }),
  execute: ({ userId, agentId, since }) =>
    Database.use((db) =>
      db
        .delete(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            or(
              isNull(runnerLine.lineId),
              and(isNull(runnerLine.acceptedAt), lt(runnerLine.createdAt, since)),
            ),
          ),
        ),
    ),
});

const deleteLine = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, lineId: Schema.String }),
  execute: ({ userId, agentId, lineId }) =>
    Database.use((db) =>
      db
        .delete(runnerLine)
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            eq(runnerLine.lineId, lineId),
            isNull(runnerLine.acceptedAt),
          ),
        ),
    ),
});

const writeAccepted = SqlSchema.void({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    lineId: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ userId, agentId, lineId, now }) =>
    Database.use((db) =>
      db
        .update(runnerLine)
        .set({ acceptedAt: now })
        .where(
          and(
            eq(runnerLine.userId, userId),
            eq(runnerLine.agentId, agentId),
            eq(runnerLine.lineId, lineId),
            isNull(runnerLine.acceptedAt),
          ),
        ),
    ),
});

export function queueRunnerLine(
  userId: string,
  line: {
    readonly agentId: string;
    readonly launch: number;
    readonly text: string;
    readonly lineId?: string;
  },
): RunnerLineEffect<Option.Option<number>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* client`select pg_advisory_xact_lock(hashtextextended(${line.agentId}, 0))`;
        const now = yield* DateTime.nowAsDate;
        const before = new Date(now.getTime() - Duration.toMillis(RUNNER_LINE_EXPIRY));
        yield* deleteExpired({ userId, agentId: line.agentId, before });
        const rows = yield* insertLine({
          userId,
          agentId: line.agentId,
          launch: line.launch,
          text: line.text,
          lineId: line.lineId ?? null,
          now,
        });
        return Option.map(Option.fromNullishOr(rows[0]), (row) => row.seq);
      }),
    ),
  );
}

export function runnerLinesPast(
  userId: string,
  agentId: string,
  read: {
    readonly launch: number;
    readonly after: number;
    readonly since: Date;
    readonly limit: number;
  },
): RunnerLineEffect<readonly RunnerLine[]> {
  return findLinesPast({ userId, agentId, ...read });
}

export function runnerLinesWaiting(
  userId: string,
  agentId: string,
  since: Date,
): RunnerLineEffect<boolean> {
  return Effect.map(findWaiting({ userId, agentId, since }), (rows) => rows.length > 0);
}

export function clearRunnerLines(
  userId: string,
  agentId: string,
  since: Date,
): RunnerLineEffect<void> {
  return deleteHandedOn({ userId, agentId, since });
}

export function withdrawRunnerLine(
  userId: string,
  agentId: string,
  lineId: string,
): RunnerLineEffect<void> {
  return deleteLine({ userId, agentId, lineId });
}

export function acceptRunnerLine(
  userId: string,
  agentId: string,
  lineId: string,
): RunnerLineEffect<void> {
  if (!LINE_ID.test(lineId)) return Effect.void;
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    writeAccepted({ userId, agentId, lineId, now }),
  );
}
