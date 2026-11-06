import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import {
  type Agent,
  hasRepository,
  readAgent,
  type WithRepository,
} from "@repo/database/models/agent-store";
import {
  type ClaimedTokenPullRequest,
  claimTokenPullRequestPolls,
  recordTokenPullRequestPoll,
} from "@repo/database/models/token-pull-request-poll";
import { Data, Duration, Effect, Option, type Redacted, Ref, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { agentPublished } from "../agents/coder-host/published.js";
import type { SessionsForAccount } from "../automations/automation-runs.js";
import {
  AGENT_WAKE,
  type AgentWake,
  appAvatarOf,
  githubAvatarOf,
  githubIdOf,
  type HeadChecksRead,
  headChecksFor,
  wakeAgents,
} from "./agent-wakes.js";
import {
  GITHUB_HTTP_STATUS,
  type GitHubApp,
  type GitHubUnavailable,
  githubRead,
  readBody,
  send,
} from "./github-app.js";
import { type MemberGitHubToken, openMemberGitHubToken } from "./github-token.js";
import { type HeadChecks, repositoryPath } from "./pull-requests.js";

const TOKEN_PULL_REQUEST_SWEEP = {
  EVERY: Duration.minutes(1),
  MAX_POLLS: 20,
  CONCURRENCY: 5,
} as const;

export interface TokenPullRequestSweepOutcome {
  polled: number;
  told: number;
}

const NOT_MODIFIED = 304;

const FIRST_HUNDRED = { per_page: "100" } as const;

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

const WAKE_KEY = {
  REVIEW: "review",
  COMMENT: "comment",
  CHECK: "check",
  STATUS: "status",
  CHECKS_MOVED: "checks-moved",
} as const;

const PENDING_REVIEW = "PENDING";

const GHOST = "ghost";

const GITHUB_BOT = "github[bot]";

class TokenRefused extends Data.TaggedError("TokenRefused") {}

type PollFailure = GitHubUnavailable | TokenRefused | QueryError | Schema.SchemaError;

type PollServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

const AuthorSchema = Schema.NullOr(
  Schema.Struct({
    login: Schema.String,
    id: Schema.optionalKey(Schema.Number),
    avatar_url: Schema.optionalKey(Schema.String),
  }),
);

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
      app: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({ slug: Schema.String, id: Schema.optionalKey(Schema.Number) }),
        ),
      ),
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

type Changed<A> = Option.Option<{ readonly body: A; readonly etag: string | undefined }>;

interface Poll {
  readonly agent: WithRepository<Agent>;
  readonly member: MemberGitHubToken;
  readonly number: number;
  readonly claimed: ClaimedTokenPullRequest;
  readonly sessionsFor: SessionsForAccount;
  readonly now: number;
  readonly readFailedChecks: HeadChecksRead;
}

const failedChecksReadOnce = Effect.map(
  Ref.make(Option.none<HeadChecks>()),
  (kept): HeadChecksRead =>
    (told, sha) =>
      Effect.flatMap(Ref.get(kept), (held) =>
        Option.isSome(held)
          ? Effect.succeed(held)
          : Effect.tap(headChecksFor(told, sha), (read) => Ref.set(kept, read)),
      ),
);

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

function wakeKey(
  kind: (typeof WAKE_KEY)[keyof typeof WAKE_KEY],
  ...ids: readonly string[]
): string {
  return JSON.stringify([kind, ...ids]);
}

function instantOf(poll: Poll, written: string | null | undefined): number {
  const at = written == null ? Number.NaN : Date.parse(written);
  return Number.isNaN(at) ? poll.now : at;
}

function tell(
  poll: Poll,
  wake: Omit<AgentWake, "repository" | "branches" | "pullRequest">,
  key: string,
) {
  const { agent, number } = poll;
  const branches = agent.branch === null ? [] : [agent.branch];
  return wakeAgents(
    poll.sessionsFor,
    { ...wake, repository: agent.repository, branches, pullRequest: number },
    key,
    poll.member.githubLogin,
    wake.kind === AGENT_WAKE.CHECK_FAILED ? poll.readFailedChecks : headChecksFor,
  );
}

function checksUrl(poll: Poll, sha: string): string {
  return `https://github.com/${poll.agent.repository}/commit/${sha}/checks`;
}

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

const pollCheckRuns = /* @__PURE__ */ Effect.fnUntraced(function* (
  poll: Poll,
  sha: string,
  kept: { readonly etag: string | undefined; readonly conclusion: string | null },
): Effect.fn.Return<
  {
    readonly etag: string | undefined;
    readonly conclusion: string | null;
    readonly told: number;
    readonly changed: boolean;
  },
  PollFailure,
  PollServices
> {
  const path = `${repositoryPath(poll.agent.repository)}/commits/${sha}/check-runs`;
  const changed = yield* readIfChanged(poll, path, kept.etag, CheckRunsSchema, FIRST_HUNDRED);
  if (Option.isNone(changed)) return { ...kept, told: 0, changed: false };
  const failed = changed.value.body.check_runs.find(
    (run) => run.status === GITHUB_CHECK.COMPLETED && FAILED_CONCLUSIONS.has(run.conclusion ?? ""),
  );
  const conclusion = failed?.conclusion ?? null;
  const etag = changed.value.etag;
  if (failed === undefined || conclusion === kept.conclusion) {
    return { etag, conclusion, told: 0, changed: true };
  }
  const told = yield* tell(
    poll,
    {
      kind: AGENT_WAKE.CHECK_FAILED,
      url: checksUrl(poll, sha),
      by: `${failed.app?.slug ?? "github"}[bot]`,
      ...appAvatarOf(failed.app),
      at: instantOf(poll, failed.completed_at),
      sha,
    },
    wakeKey(WAKE_KEY.CHECK, sha, failed.conclusion ?? ""),
  );
  return { etag, conclusion, told, changed: true };
});

const pollStatuses = /* @__PURE__ */ Effect.fnUntraced(function* (
  poll: Poll,
  sha: string,
  etag: string | undefined,
): Effect.fn.Return<
  { readonly etag: string | undefined; readonly told: number; readonly changed: boolean },
  PollFailure,
  PollServices
> {
  const path = `${repositoryPath(poll.agent.repository)}/commits/${sha}/status`;
  const changed = yield* readIfChanged(poll, path, etag, StatusSchema, FIRST_HUNDRED);
  if (Option.isNone(changed)) return { etag, told: 0, changed: false };
  const failed = changed.value.body.statuses.filter((status) => FAILED_STATES.has(status.state));
  const counts = yield* Effect.forEach(failed, (status) =>
    tell(
      poll,
      {
        kind: AGENT_WAKE.CHECK_FAILED,
        url: checksUrl(poll, sha),
        by: status.creator?.login ?? GHOST,
        ...githubAvatarOf(status.creator ?? {}),
        at: instantOf(poll, status.updated_at),
        sha,
      },
      wakeKey(WAKE_KEY.STATUS, sha, status.context, status.state),
    ),
  );
  return {
    etag: changed.value.etag,
    told: counts.reduce((sum, count) => sum + count, 0),
    changed: true,
  };
});

function tellChecksMoved(poll: Poll, sha: string) {
  return tell(
    poll,
    {
      kind: AGENT_WAKE.CHECKS_COMPLETED,
      url: checksUrl(poll, sha),
      by: GITHUB_BOT,
      at: poll.now,
      sha,
    },
    wakeKey(WAKE_KEY.CHECKS_MOVED, sha),
  );
}

function republish(poll: Poll) {
  return agentPublished(poll.agent.userId, poll.agent).pipe(
    Effect.catch((failure) =>
      Effect.logWarning("token poll: a pull request could not be read again", {
        failure: failure._tag,
      }),
    ),
  );
}

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
              ...githubIdOf(review.user ?? {}),
              ...githubAvatarOf(review.user ?? {}),
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
        ...githubIdOf(comment.user ?? {}),
        ...githubAvatarOf(comment.user ?? {}),
        at: instantOf(poll, comment.created_at),
        words: comment.body ?? "",
      },
      wakeKey(WAKE_KEY.COMMENT, String(comment.id)),
    ],
  );
  const sameHead = headSha !== null && headSha === kept?.headSha;
  const checkRuns =
    headSha === null
      ? { etag: undefined, conclusion: null, told: 0, changed: false }
      : yield* pollCheckRuns(poll, headSha, {
          etag: sameHead ? etags.checkRuns : undefined,
          conclusion: sameHead ? (kept?.checkConclusion ?? null) : null,
        });
  const statuses =
    headSha === null
      ? { etag: undefined, told: 0, changed: false }
      : yield* pollStatuses(poll, headSha, sameHead ? etags.statuses : undefined);
  const checksMoved =
    headSha !== null && (checkRuns.changed || statuses.changed)
      ? yield* tellChecksMoved(poll, headSha)
      : 0;
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
  return reviews.told + comments.told + checkRuns.told + statuses.told + checksMoved;
});

const pollClaimed = /* @__PURE__ */ Effect.fnUntraced(function* (
  claimed: ClaimedTokenPullRequest,
  ring: Redacted.Redacted | undefined,
  sessionsFor: SessionsForAccount,
  now: number,
): Effect.fn.Return<number, never, PollServices> {
  return yield* Effect.gen(function* () {
    const agent = yield* readAgent(claimed.userId, claimed.agentId);
    if (Option.isNone(agent) || !hasRepository(agent.value)) return 0;
    const held = yield* openMemberGitHubToken(ring, claimed.userId);
    if (Result.isFailure(held)) return 0;
    const member = held.success;
    const poll: Poll = {
      agent: agent.value,
      member,
      number: claimed.pullRequest,
      claimed,
      sessionsFor,
      now,
      readFailedChecks: yield* failedChecksReadOnce,
    };
    return yield* pollPullRequest(poll).pipe(
      Effect.catchTag("TokenRefused", () => Effect.as(member.markInvalid, 0)),
    );
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("token poll: a pull request was not polled", { failure: failure._tag }),
        0,
      ),
    ),
  );
});

export const sweepTokenPullRequests = /* @__PURE__ */ Effect.fn("web/sweepTokenPullRequests")(
  function* (
    sessionsFor: SessionsForAccount,
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
      (each) => pollClaimed(each, ring, sessionsFor, now.getTime()),
      {
        concurrency: TOKEN_PULL_REQUEST_SWEEP.CONCURRENCY,
      },
    );
    return { polled: claimed.length, told: told.reduce((sum, count) => sum + count, 0) };
  },
);
