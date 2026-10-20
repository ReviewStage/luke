/**
 * token-pull-request-sweep.ts -- the scheduled sweep's poll of the pull requests of agents on a member's own GitHub token, which no webhook reaches.
 *
 * An agent on its starter's personal access token works on a repository no
 * installation of the Luke GitHub App reaches, so GitHub sends no delivery
 * of a review, a comment, or a check on its pull request. Each minute the
 * sweep claims a batch of those pull requests still open
 * (`token-pull-request-poll.ts`) and reads each on its owner's token, with
 * the REST calls the webhook path's deliveries stand for: the pull request,
 * its reviews, its conversation comments, and the check runs and combined
 * status of its head. Every read is conditional on the ETag GitHub last
 * answered it with, and a 304 is the whole answer: GitHub counts no 304
 * against the rate limit
 * (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate).
 *
 * What changed is handed to the webhook path's own functions: the pull
 * request read again onto the agent's row (`agentPublished`), and each new
 * review, comment, and failed check told to the agent (`wakeAgents`) under a
 * key of its own in place of a delivery's id, so a poll that reads it again
 * tells it once. The agent writes on GitHub as its member, so a review or a
 * comment by the member's login is told only where the agent was not at work
 * when it was made, as one by the App's login is on the webhook path. A 401
 * marks the member's token invalid, which leaves the agent unpolled until a
 * token is saved again. Each listing is read as its first hundred.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  type CodingAgent,
  hasRepository,
  readCodingAgent,
  type WithRepository,
} from "@luke/database/models/coding-agent-store";
import {
  type ClaimedTokenPullRequest,
  claimTokenPullRequestPolls,
  recordTokenPullRequestPoll,
} from "@luke/database/models/token-pull-request-poll";
import { Data, Duration, Effect, Option, type Redacted, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { agentPublished } from "../agents/coder-host/published.js";
import type { EveForAccount } from "../automations/automation-runs.js";
import { AGENT_WAKE, type AgentWake, wakeAgents } from "./agent-wakes.js";
import {
  GITHUB_HTTP_STATUS,
  type GitHubApp,
  type GitHubUnavailable,
  githubRead,
  readBody,
  send,
} from "./github-app.js";
import { type MemberGitHubToken, openMemberGitHubToken } from "./github-token.js";
import { repositoryPath } from "./pull-requests.js";

const TOKEN_PULL_REQUEST_SWEEP = {
  /** How often each pull request is polled. */
  EVERY: Duration.minutes(1),
  /** The most pull requests one sweep polls; the rest wait for the next minute. */
  MAX_POLLS: 20,
  CONCURRENCY: 5,
} as const;

/** What one sweep came to: pull requests polled, and agents told of something. */
export interface TokenPullRequestSweepOutcome {
  polled: number;
  told: number;
}

/** What GitHub answers a conditional read whose ETag still matches (https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate). */
const NOT_MODIFIED = 304;

/** GitHub's most items to a page. */
const FIRST_HUNDRED = { per_page: "100" } as const;

/** A check run's conclusions and a commit status's states told as failed, as the webhook path tells them. */
const GITHUB_CHECK = {
  COMPLETED: "completed",
  FAILURE: "failure",
  TIMED_OUT: "timed_out",
  ERROR: "error",
} as const;
const FAILED_CONCLUSIONS: ReadonlySet<string> = new Set([
  GITHUB_CHECK.FAILURE,
  GITHUB_CHECK.TIMED_OUT,
]);
const FAILED_STATES: ReadonlySet<string> = new Set([GITHUB_CHECK.FAILURE, GITHUB_CHECK.ERROR]);

/** What a wake's key names, in place of a delivery's id. */
const WAKE_KEY = {
  REVIEW: "review",
  COMMENT: "comment",
  CHECK: "check",
  STATUS: "status",
} as const;

/** A review its author has not submitted, which no one else sees. */
const PENDING_REVIEW = "PENDING";

/** Who GitHub names for an account since deleted. */
const GHOST = "ghost";

/** GitHub refused the member's token. */
class TokenRefused extends Data.TaggedError("TokenRefused") {}

type PollFailure = GitHubUnavailable | TokenRefused | QueryError | Schema.SchemaError;

type PollServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

const AuthorSchema = Schema.NullOr(Schema.Struct({ login: Schema.String }));

const PullSchema = Schema.Struct({ head: Schema.Struct({ sha: Schema.String }) });

const ReviewsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    user: AuthorSchema,
    state: Schema.String,
    body: Schema.NullOr(Schema.String),
    html_url: Schema.String,
    submitted_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

const CommentsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.Number,
    user: AuthorSchema,
    body: Schema.optionalKey(Schema.String),
    html_url: Schema.String,
    created_at: Schema.String,
  }),
);

const CheckRunsSchema = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      completed_at: Schema.NullOr(Schema.String),
      app: Schema.optionalKey(Schema.NullOr(Schema.Struct({ slug: Schema.String }))),
    }),
  ),
});

const StatusSchema = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      state: Schema.String,
      context: Schema.String,
      updated_at: Schema.String,
      creator: Schema.optionalKey(AuthorSchema),
    }),
  ),
});

/** A conditional read's answer: none where GitHub answered 304, else what it read and the ETag it answered with. */
type Changed<A> = Option.Option<{ readonly body: A; readonly etag: string | undefined }>;

/** One pull request's poll: the agent, its owner's token, its number, and what the last poll read. */
interface Poll {
  readonly agent: WithRepository<CodingAgent>;
  readonly member: MemberGitHubToken;
  readonly number: number;
  readonly claimed: ClaimedTokenPullRequest;
  readonly eveFor: EveForAccount;
  /** The sweep's instant, in epoch milliseconds. */
  readonly now: number;
}

/** One read on the member's token, conditional on the ETag given where there is one. */
function readIfChanged<A>(
  poll: Poll,
  path: string,
  etag: string | undefined,
  schema: Schema.Codec<A, unknown>,
  params: Readonly<Record<string, string>> = {},
): Effect.Effect<Changed<A>, GitHubUnavailable | TokenRefused, HttpClient.HttpClient> {
  const asked = githubRead(path, poll.member.token).pipe(HttpClientRequest.setUrlParams(params));
  const request =
    etag === undefined ? asked : HttpClientRequest.setHeader(asked, "if-none-match", etag);
  return Effect.scoped(
    Effect.flatMap(
      send(request),
      (response): Effect.Effect<Changed<A>, GitHubUnavailable | TokenRefused> => {
        if (response.status === NOT_MODIFIED) return Effect.succeed(Option.none());
        if (response.status === GITHUB_HTTP_STATUS.UNAUTHORIZED)
          return Effect.fail(new TokenRefused());
        return Effect.map(readBody(response, schema), (body) =>
          Option.some({ body, etag: response.headers.etag }),
        );
      },
    ),
  );
}

/** A wake's key, its kind and GitHub's ids encoded so no part can run into the next. */
function wakeKey(
  kind: (typeof WAKE_KEY)[keyof typeof WAKE_KEY],
  ...ids: readonly string[]
): string {
  return JSON.stringify([kind, ...ids]);
}

/** An instant GitHub wrote, in epoch milliseconds, or the poll's own where it wrote none it can read. */
function instantOf(poll: Poll, written: string | null | undefined): number {
  const at = written == null ? Number.NaN : Date.parse(written);
  return Number.isNaN(at) ? poll.now : at;
}

/** Tells the agents on the pull request of one wake under its key, the member's login standing where the webhook path stands the App's; answers how many were told. */
function tell(
  poll: Poll,
  wake: Omit<AgentWake, "repository" | "branches" | "pullRequest">,
  key: string,
) {
  const { agent, number } = poll;
  const branches = agent.branch === null ? [] : [agent.branch];
  return wakeAgents(
    poll.eveFor,
    { ...wake, repository: agent.repository, branches, pullRequest: number },
    key,
    poll.member.githubLogin,
  );
}

/** The page of a head's checks, as the webhook path names a failed one. */
function checksUrl(poll: Poll, sha: string): string {
  return `https://github.com/${poll.agent.repository}/commit/${sha}/checks`;
}

/**
 * A listing of the pull request, reviews or comments, read where it changed
 * and each item past the newest seen told; answers its ETag, the newest id
 * now seen, and how many agents were told.
 */
const pollListing = /* @__PURE__ */ Effect.fnUntraced(function* <A extends { readonly id: number }>(
  poll: Poll,
  read: { readonly path: string; readonly etag: string | undefined; readonly seen: number | null },
  schema: Schema.Codec<readonly A[], unknown>,
  wakeOf: (
    item: A,
  ) => readonly [Omit<AgentWake, "repository" | "branches" | "pullRequest">, string] | undefined,
): Effect.fn.Return<
  { readonly etag: string | undefined; readonly seen: number | null; readonly told: number },
  PollFailure,
  PollServices
> {
  const changed = yield* readIfChanged(poll, read.path, read.etag, schema, FIRST_HUNDRED);
  if (Option.isNone(changed)) return { etag: read.etag, seen: read.seen, told: 0 };
  // Note that an item told of nothing, a review its author has not submitted, is not seen, so its submission is told.
  const wakes = changed.value.body.flatMap((item) => {
    const wake = wakeOf(item);
    return wake === undefined ? [] : [{ id: item.id, wake }];
  });
  const fresh = wakes.filter(({ id }) => id > (read.seen ?? 0));
  const counts = yield* Effect.forEach(fresh, ({ wake }) => tell(poll, ...wake));
  const seen = Math.max(read.seen ?? 0, ...wakes.map(({ id }) => id));
  return {
    etag: changed.value.etag,
    seen: seen === 0 ? read.seen : seen,
    told: counts.reduce((sum, count) => sum + count, 0),
  };
});

/**
 * The head's check runs, read where they changed, and the first that failed
 * told where the head or its conclusion moved since; answers the ETag, the
 * failed conclusion now seen, and how many agents were told.
 */
const pollCheckRuns = /* @__PURE__ */ Effect.fnUntraced(function* (
  poll: Poll,
  sha: string,
  kept: { readonly etag: string | undefined; readonly conclusion: string | null },
): Effect.fn.Return<
  { readonly etag: string | undefined; readonly conclusion: string | null; readonly told: number },
  PollFailure,
  PollServices
> {
  const path = `${repositoryPath(poll.agent.repository)}/commits/${sha}/check-runs`;
  const changed = yield* readIfChanged(poll, path, kept.etag, CheckRunsSchema, FIRST_HUNDRED);
  if (Option.isNone(changed)) return { ...kept, told: 0 };
  const failed = changed.value.body.check_runs.find(
    (run) => run.status === GITHUB_CHECK.COMPLETED && FAILED_CONCLUSIONS.has(run.conclusion ?? ""),
  );
  const conclusion = failed?.conclusion ?? null;
  const etag = changed.value.etag;
  if (failed === undefined || conclusion === kept.conclusion) return { etag, conclusion, told: 0 };
  const told = yield* tell(
    poll,
    {
      kind: AGENT_WAKE.CHECK_FAILED,
      url: checksUrl(poll, sha),
      by: `${failed.app?.slug ?? "github"}[bot]`,
      at: instantOf(poll, failed.completed_at),
    },
    wakeKey(WAKE_KEY.CHECK, sha, failed.conclusion ?? ""),
  );
  return { etag, conclusion, told };
});

/** The head's commit statuses, read where they changed, each failed one told; answers the ETag and how many agents were told. */
const pollStatuses = /* @__PURE__ */ Effect.fnUntraced(function* (
  poll: Poll,
  sha: string,
  etag: string | undefined,
): Effect.fn.Return<
  { readonly etag: string | undefined; readonly told: number },
  PollFailure,
  PollServices
> {
  const path = `${repositoryPath(poll.agent.repository)}/commits/${sha}/status`;
  const changed = yield* readIfChanged(poll, path, etag, StatusSchema, FIRST_HUNDRED);
  if (Option.isNone(changed)) return { etag, told: 0 };
  const failed = changed.value.body.statuses.filter((status) => FAILED_STATES.has(status.state));
  const counts = yield* Effect.forEach(failed, (status) =>
    tell(
      poll,
      {
        kind: AGENT_WAKE.CHECK_FAILED,
        url: checksUrl(poll, sha),
        by: status.creator?.login ?? GHOST,
        at: instantOf(poll, status.updated_at),
      },
      wakeKey(WAKE_KEY.STATUS, sha, status.context, status.state),
    ),
  );
  return { etag: changed.value.etag, told: counts.reduce((sum, count) => sum + count, 0) };
});

/** The pull request read again onto the agent's row, as a delivery about its branch reads it; a failure is logged by its kind and the poll goes on. */
function republish(poll: Poll) {
  return agentPublished(poll.agent.userId, poll.agent).pipe(
    Effect.catch((failure) =>
      Effect.logWarning("token poll: a pull request could not be read again", {
        failure: failure._tag,
      }),
    ),
  );
}

/** One pull request polled, every read in turn and what they read written back; answers how many agents were told. */
const pollPullRequest = /* @__PURE__ */ Effect.fnUntraced(function* (
  poll: Poll,
): Effect.fn.Return<number, PollFailure, PollServices> {
  const { agent, number } = poll;
  const kept = poll.claimed.state;
  const etags = kept?.etags ?? {};
  const pulls = `${repositoryPath(agent.repository)}/pulls/${number}`;
  const pull = yield* readIfChanged(poll, pulls, etags.pullRequest, PullSchema);
  if (Option.isSome(pull)) yield* republish(poll);
  const headSha = Option.isSome(pull) ? pull.value.body.head.sha : (kept?.headSha ?? null);
  const reviews = yield* pollListing(
    poll,
    { path: `${pulls}/reviews`, etag: etags.reviews, seen: kept?.lastReviewId ?? null },
    ReviewsSchema,
    (review) =>
      review.state === PENDING_REVIEW
        ? undefined
        : [
            {
              kind: AGENT_WAKE.REVIEW,
              url: review.html_url,
              by: review.user?.login ?? GHOST,
              at: instantOf(poll, review.submitted_at),
              verdict: review.state.toLowerCase(),
              words: review.body ?? "",
              reviewId: review.id,
            },
            wakeKey(WAKE_KEY.REVIEW, String(review.id)),
          ],
  );
  const comments = yield* pollListing(
    poll,
    {
      path: `${repositoryPath(agent.repository)}/issues/${number}/comments`,
      etag: etags.comments,
      seen: kept?.lastCommentId ?? null,
    },
    CommentsSchema,
    (comment) => [
      {
        kind: AGENT_WAKE.COMMENT,
        url: comment.html_url,
        by: comment.user?.login ?? GHOST,
        at: instantOf(poll, comment.created_at),
        words: comment.body ?? "",
      },
      wakeKey(WAKE_KEY.COMMENT, String(comment.id)),
    ],
  );
  // The checks' ETags and conclusion stand for the head they were read on, so another head reads afresh.
  const sameHead = headSha !== null && headSha === kept?.headSha;
  const checkRuns =
    headSha === null
      ? { etag: undefined, conclusion: null, told: 0 }
      : yield* pollCheckRuns(poll, headSha, {
          etag: sameHead ? etags.checkRuns : undefined,
          conclusion: sameHead ? (kept?.checkConclusion ?? null) : null,
        });
  const statuses =
    headSha === null
      ? { etag: undefined, told: 0 }
      : yield* pollStatuses(poll, headSha, sameHead ? etags.statuses : undefined);
  yield* recordTokenPullRequestPoll(agent.id, number, {
    etags: {
      pullRequest: Option.isSome(pull) ? pull.value.etag : etags.pullRequest,
      reviews: reviews.etag,
      comments: comments.etag,
      checkRuns: checkRuns.etag,
      statuses: statuses.etag,
    },
    lastReviewId: reviews.seen,
    lastCommentId: comments.seen,
    headSha,
    checkConclusion: checkRuns.conclusion,
  });
  return reviews.told + comments.told + checkRuns.told + statuses.told;
});

/**
 * One claimed pull request polled on its owner's token: none where the
 * agent or a token GitHub accepts is gone, the token marked invalid where
 * GitHub answers 401, and any other failure logged by its kind and left for
 * the next minute. Answers how many agents were told.
 */
const pollClaimed = /* @__PURE__ */ Effect.fnUntraced(function* (
  claimed: ClaimedTokenPullRequest,
  ring: Redacted.Redacted | undefined,
  eveFor: EveForAccount,
  now: number,
): Effect.fn.Return<number, never, PollServices> {
  return yield* Effect.gen(function* () {
    const agent = yield* readCodingAgent(claimed.userId, claimed.agentId);
    // An agent with no repository has no pull request to poll.
    if (Option.isNone(agent) || !hasRepository(agent.value)) return 0;
    const held = yield* openMemberGitHubToken(ring, claimed.userId);
    if (Result.isFailure(held)) return 0;
    const member = held.success;
    const poll: Poll = {
      agent: agent.value,
      member,
      number: claimed.pullRequest,
      claimed,
      eveFor,
      now,
    };
    return yield* pollPullRequest(poll).pipe(
      Effect.catchTag("TokenRefused", () => Effect.as(member.markInvalid, 0)),
    );
  }).pipe(
    // The kind alone: nothing of the pull request or the token rides the line.
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("token poll: a pull request was not polled", { failure: failure._tag }),
        0,
      ),
    ),
  );
});

/** Claims the next batch of token agents' pull requests due a poll at `now` and polls each, `CONCURRENCY` at a time. */
export const sweepTokenPullRequests = /* @__PURE__ */ Effect.fn("web/sweepTokenPullRequests")(
  function* (
    eveFor: EveForAccount,
    ring: Redacted.Redacted | undefined,
    now: Date,
  ): Effect.fn.Return<TokenPullRequestSweepOutcome, QueryError | Schema.SchemaError, PollServices> {
    const next = new Date(now.getTime() + Duration.toMillis(TOKEN_PULL_REQUEST_SWEEP.EVERY));
    const claimed = yield* claimTokenPullRequestPolls(
      now,
      next,
      TOKEN_PULL_REQUEST_SWEEP.MAX_POLLS,
    );
    const told = yield* Effect.forEach(
      claimed,
      (each) => pollClaimed(each, ring, eveFor, now.getTime()),
      {
        concurrency: TOKEN_PULL_REQUEST_SWEEP.CONCURRENCY,
      },
    );
    return { polled: claimed.length, told: told.reduce((sum, count) => sum + count, 0) };
  },
);
