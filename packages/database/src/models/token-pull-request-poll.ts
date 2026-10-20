/**
 * token-pull-request-poll.ts -- the scheduled sweep's claim of the token agents' pull requests due a poll, and what each poll read.
 *
 * The agents polled are those on their starter's own GitHub token, not
 * archived, whose pull request GitHub last answered as open or a draft. A
 * claim first gives each such agent a row of its own, due at once, then
 * takes the rows due, the longest due first and at most a batch, under row
 * locks a concurrent claim skips rather than waits on, and moves each one's
 * next poll on before the locks go: Vercel may call the minute's sweep
 * twice, and the second claim must find nothing left. A poll's reads are
 * written back on the row whole. The row keeps the number of the pull
 * request it read; a claim answers the state only where that is still the
 * agent's pull request, so a new one is polled afresh.
 */

import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { type StoredPollEtags, tokenPullRequestPoll } from "../schemas/token-pull-request-poll.js";

type PollEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** What one poll read of a pull request, as the next poll starts from it. */
export interface TokenPullRequestPollState {
  readonly etags: StoredPollEtags;
  readonly lastReviewId: number | null;
  readonly lastCommentId: number | null;
  readonly headSha: string | null;
  readonly checkConclusion: string | null;
}

/** One agent's pull request a claim took: whose agent it is, its number now, and what the last poll of it read, null where none has. */
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
  /** The number the row's state was read on. */
  polled: Schema.Number,
  /** The agent's pull request's number as GitHub last answered it. */
  published: Schema.Number,
  ...StateFields,
});

/** The pull request's number as the agent's row keeps it. */
const publishedNumber = () => sql<number>`(${codingAgent.published}->>'number')::int`;

/** An agent polled: on its starter's token, not archived, its pull request open or a draft. */
const polledAgent = and(
  eq(codingAgent.githubAccess, GITHUB_ACCESS.TOKEN),
  isNull(codingAgent.archivedAt),
  inArray(sql`${codingAgent.published}->>'state'`, [
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
              agentId: codingAgent.id,
              pullRequest: publishedNumber().as("pull_request"),
              nextPollAt: sql<Date>`${now.toISOString()}::timestamptz`.as("next_poll_at"),
            })
            .from(codingAgent)
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
          userId: codingAgent.userId,
          polled: tokenPullRequestPoll.pullRequest,
          published: publishedNumber(),
          etags: tokenPullRequestPoll.etags,
          lastReviewId: tokenPullRequestPoll.lastReviewId,
          lastCommentId: tokenPullRequestPoll.lastCommentId,
          headSha: tokenPullRequestPoll.headSha,
          checkConclusion: tokenPullRequestPoll.checkConclusion,
        })
        .from(tokenPullRequestPoll)
        .innerJoin(codingAgent, eq(codingAgent.id, tokenPullRequestPoll.agentId))
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

/** Claims at most `limit` of the token agents' pull requests due a poll at `now`, each next due at `next`. */
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

/** Writes what a poll of the agent's pull request numbered `pullRequest` read, whole. */
export function recordTokenPullRequestPoll(
  agentId: string,
  pullRequest: number,
  state: TokenPullRequestPollState,
): PollEffect<void> {
  return writeState({ agentId, pullRequest, ...state });
}
