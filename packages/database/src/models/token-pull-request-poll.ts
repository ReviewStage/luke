import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { type StoredPollEtags, tokenPullRequestPoll } from "../schemas/token-pull-request-poll.js";

type PollEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

export interface TokenPullRequestPollState {
  readonly etags: StoredPollEtags;
  readonly lastReviewId: number | null;
  readonly lastCommentId: number | null;
  readonly headSha: string | null;
  readonly checkConclusion: string | null;
}

export interface ClaimedTokenPullRequest {
  readonly agentId: string;
  readonly userId: string;
  readonly pullRequest: number;
  readonly state: TokenPullRequestPollState | null;
}

const EtagsSchema = Schema.Struct({
  pullRequest: Schema.optional(Schema.String),
  reviews: Schema.optional(Schema.String),
  comments: Schema.optional(Schema.String),
  checkRuns: Schema.optional(Schema.String),
  statuses: Schema.optional(Schema.String),
});

const StateFields = {
  etags: EtagsSchema,
  lastReviewId: Schema.NullOr(Schema.Number),
  lastCommentId: Schema.NullOr(Schema.Number),
  headSha: Schema.NullOr(Schema.String),
  checkConclusion: Schema.NullOr(Schema.String),
};

const DueRowSchema = Schema.Struct({
  agentId: Schema.String,
  userId: Schema.String,
  polled: Schema.Number,
  published: Schema.Number,
  ...StateFields,
});

const publishedNumber = () => sql<number>`(${agentTable.published}->>'number')::int`;

const polledAgent = and(
  eq(agentTable.githubAccess, GITHUB_ACCESS.TOKEN),
  isNull(agentTable.archivedAt),
  inArray(sql`${agentTable.published}->>'state'`, [
    PULL_REQUEST_STATE.OPEN,
    PULL_REQUEST_STATE.DRAFT,
  ]),
);

const insertMissing = SqlSchema.void({
  Request: Schema.Struct({ now: Schema.Date }),
  execute: ({ now }) =>
    Database.use((db) =>
      db
        .insert(tokenPullRequestPoll)
        .select(
          db
            .select({
              agentId: agentTable.id,
              pullRequest: publishedNumber().as("pull_request"),
              nextPollAt: sql<Date>`${now.toISOString()}::timestamptz`.as("next_poll_at"),
            })
            .from(agentTable)
            .where(polledAgent),
        )
        .onConflictDoNothing({ target: tokenPullRequestPoll.agentId }),
    ),
});

const lockDue = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date, limit: Schema.Int }),
  Result: DueRowSchema,
  execute: ({ now, limit }) =>
    Database.use((db) =>
      db
        .select({
          agentId: tokenPullRequestPoll.agentId,
          userId: agentTable.userId,
          polled: tokenPullRequestPoll.pullRequest,
          published: publishedNumber(),
          etags: tokenPullRequestPoll.etags,
          lastReviewId: tokenPullRequestPoll.lastReviewId,
          lastCommentId: tokenPullRequestPoll.lastCommentId,
          headSha: tokenPullRequestPoll.headSha,
          checkConclusion: tokenPullRequestPoll.checkConclusion,
        })
        .from(tokenPullRequestPoll)
        .innerJoin(agentTable, eq(agentTable.id, tokenPullRequestPoll.agentId))
        .where(and(polledAgent, lte(tokenPullRequestPoll.nextPollAt, now)))
        .orderBy(asc(tokenPullRequestPoll.nextPollAt), asc(tokenPullRequestPoll.agentId))
        .limit(limit)
        .for("update", { of: tokenPullRequestPoll, skipLocked: true }),
    ),
});

const writeNextPoll = SqlSchema.void({
  Request: Schema.Struct({ agentIds: Schema.Array(Schema.String), next: Schema.Date }),
  execute: ({ agentIds, next }) =>
    Database.use((db) =>
      db
        .update(tokenPullRequestPoll)
        .set({ nextPollAt: next })
        .where(inArray(tokenPullRequestPoll.agentId, agentIds)),
    ),
});

const writeState = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String, pullRequest: Schema.Number, ...StateFields }),
  execute: ({ agentId, ...state }) =>
    Database.use((db) =>
      db.update(tokenPullRequestPoll).set(state).where(eq(tokenPullRequestPoll.agentId, agentId)),
    ),
});

export function claimTokenPullRequestPolls(
  now: Date,
  next: Date,
  limit: number,
): PollEffect<readonly ClaimedTokenPullRequest[]> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* insertMissing({ now });
        const due = yield* lockDue({ now, limit });
        if (due.length > 0) yield* writeNextPoll({ agentIds: due.map((row) => row.agentId), next });
        return due.map(({ agentId, userId, polled, published, ...state }) => ({
          agentId,
          userId,
          pullRequest: published,
          state: polled === published ? state : null,
        }));
      }),
    ),
  );
}

export function recordTokenPullRequestPoll(
  agentId: string,
  pullRequest: number,
  state: TokenPullRequestPollState,
): PollEffect<void> {
  return writeState({ agentId, pullRequest, ...state });
}
