/**
 * runner-line-store.ts -- the lines the service queues for a cloud agent's runner, read past the runner's cursor and acknowledged as it takes them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account queues for, reads, or acknowledges another's
 * agent. A line is queued only for an agent of the account, in a
 * transaction that holds the agent's own advisory lock from before its
 * place is drawn until it commits: the sequence is shared by every agent and
 * holds no lock, so the lock is what keeps one agent's lines committed in
 * their order, whoever writes them and whether or not they hold the agent's
 * runner lease, and a runner that read up to one never passes over a line
 * below it (`../schemas/runner-line.ts`).
 *
 * A launch reads its own lines past its cursor, and beside them the
 * agent's message lines an earlier launch was written but never said it
 * took, so a launch that ended before it took a message hands it to the
 * next, within the window the read names. A line acknowledged is never
 * handed again; what an earlier launch was written of any other kind (a
 * stop, a model change, a retire) was that launch's alone, and the next
 * launch drops it as it starts, with the messages none took and none will
 * be handed. A launch's own lines stand whatever their age. A queue drops
 * the agent's lines past their expiry, which no launch would be handed any
 * more.
 */

import { and, asc, eq, gt, gte, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { runnerLine } from "../schemas/runner-line.js";

type RunnerLineEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * How long a line stands before a queue drops it: well past the longest a
 * launch runs and the window an unacknowledged message is handed on in, so
 * nothing a launch could still be handed goes.
 */
const RUNNER_LINE_EXPIRY = Duration.days(1);

/**
 * The launch a message queued before any launch reads it is written for:
 * one below every launch's first event number, or that number itself for an
 * agent's first launch, so whichever launch runs next is handed it while no
 * launch took it, and takes it over as it queues it again (`queueRunnerLine`).
 */
export const ANY_LAUNCH = 0;

/** A message line's id as the column holds it: a UUID. */
const LINE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One line as a runner reads it: its place in the order, and the line itself. */
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
              agentId: sql<string>`${codingAgent.id}`.as("agent_id"),
              userId: sql<string>`${codingAgent.userId}`.as("user_id"),
              launch: sql<number>`${launch}::bigint`.as("launch"),
              text: sql<string>`${text}::text`.as("text"),
              lineId: sql<string | null>`${lineId}::uuid`.as("line_id"),
              createdAt: sql<Date>`${now}::timestamptz`.as("created_at"),
              acceptedAt: sql<Date | null>`null::timestamptz`.as("accepted_at"),
            })
            .from(codingAgent)
            .where(and(eq(codingAgent.id, agentId), eq(codingAgent.userId, userId))),
        )
        // Note that a send repeated under its key is answered the line it queued first, in its
        // place. A message queued for whichever launch runs next (launch 0) is taken over by the
        // launch that queues it again, as a Start's launch does its first message; any other line
        // keeps its launch, so a repeat rewrites nothing the capture watches and notifies nothing.
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
            // Note that a message line a launch took is never handed again, whichever launch it was written for.
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

/**
 * Queues one line for the account's agent's runner, written for the launch
 * named by its first event number, under the agent's advisory lock, and
 * drops the agent's lines past their expiry; answers the line's
 * place, the place it was queued at first for a message line queued again
 * under its id, or none where the account holds no such agent.
 */
export function queueRunnerLine(
  userId: string,
  line: {
    readonly agentId: string;
    readonly launch: number;
    readonly text: string;
    /** A message line's own id, the send's key; none for any other kind. */
    readonly lineId?: string;
  },
): RunnerLineEffect<Option.Option<number>> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        // Note that the lock is taken before the insert draws its place, so the agent's next line draws a later one.
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

/**
 * The account's agent's lines the launch named is handed past its cursor,
 * in order, at most `limit`: those written for the launch, and the message
 * lines an earlier launch was written, never acknowledged, and queued since
 * `since`.
 */
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

/** Whether a message line of the account's agent queued since `since` stands that no launch acknowledged, which a launch would be handed. */
export function runnerLinesWaiting(
  userId: string,
  agentId: string,
  since: Date,
): RunnerLineEffect<boolean> {
  return Effect.map(findWaiting({ userId, agentId, since }), (rows) => rows.length > 0);
}

/**
 * The account's agent's lines dropped as a new launch starts, its caller
 * holding the agent's runner lease: every line an earlier launch was
 * written that is no message (a stop, a model change, a retire), which was
 * that launch's alone, and every message no launch took that was queued
 * before `since`, which none will be handed. Note that a launch that
 * applied no event before it ended leaves the next its first event number,
 * so such a line would otherwise read as the new launch's own, which a
 * launch reads whatever its age.
 */
export function clearRunnerLines(
  userId: string,
  agentId: string,
  since: Date,
): RunnerLineEffect<void> {
  return deleteHandedOn({ userId, agentId, since });
}

/** The account's agent's message line under its id withdrawn, where no launch took it, as for a launch that failed before its runner could read it, whose send answered failed. */
export function withdrawRunnerLine(
  userId: string,
  agentId: string,
  lineId: string,
): RunnerLineEffect<void> {
  return deleteLine({ userId, agentId, lineId });
}

/**
 * The account's agent's message line under its id stamped acknowledged, as
 * its runner said it took it; nothing where it already was, or none stands.
 * Note that an id no line could carry is passed over before the statement,
 * because a runner names it in an event of its own, and the column would
 * refuse it, failing the batch it came in.
 */
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
