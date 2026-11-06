import { githubAppAvatarUrl, githubAvatarUrl } from "@repo/features/account-picture";
import {
  type AgentChangedFile,
  CHANGED_FILE_STATUS,
  CHANGES_BOUNDS,
  CHECK_STATE,
  CHECK_SUMMARY,
  type ChangedFileStatus,
  type CheckState,
  type CheckSummary,
  CONVERSATION_ENTRY,
  DEPLOYMENT_STATE,
  type DeploymentState,
  DIFF_SIDE,
  type DiffSide,
  MERGE_STATE,
  type MergeState,
  OVERVIEW_BOUNDS,
  PATCH_OMITTED,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestDeployment,
  type PullRequestState,
  REVIEW_STATE,
  type ReviewState,
} from "@repo/features/agent-wire";
import { githubImageOf, imageTypeOfPath } from "@repo/features/github-image";
import { REACTION, type Reaction } from "@repo/features/pull-request-write-wire";
import {
  GITHUB_CHECK_CONCLUSION,
  type GitHubCheckConclusion,
  isFailingConclusion,
} from "@repo/wire";
import { Duration, Effect, Fiber, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  GITHUB_HTTP_STATUS,
  type GitHubUnavailable,
  githubPost,
  githubRead,
  readBody,
  send,
} from "./github-app.js";
import { rateLimited } from "./github-rate-gate.js";
import { type StackCandidate, type StackEntry, stackOf } from "./pull-request-stack.js";

export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: PullRequestState;
  readonly headRef: string;
  readonly headSha: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
  readonly openedAt?: number;
  readonly mergedAt?: number;
  readonly closedAt?: number;
  readonly baseRef?: string;
  readonly baseSha?: string;
  readonly labels?: readonly GitHubLabel[];
  readonly comments?: number;
  readonly commits?: number;
  readonly body?: string;
}

interface GitHubLabel {
  readonly name: string;
  readonly color: string;
}

export type PullRequestReadFailure = GitHubUnavailable;

type Read<A> = Effect.Effect<A, PullRequestReadFailure, HttpClient.HttpClient>;

const GITHUB_PULL_STATE = { OPEN: "open", CLOSED: "closed" } as const;

const NEWEST_ONE = "1";
const SORT = { CREATED: "created", DESCENDING: "desc" } as const;
const ANY_STATE = "all";

const CHECKS_PER_PAGE = "100";

const FAILING_STATUS_STATES: ReadonlySet<string> = new Set(["failure", "error"]);

const COMPLETED = "completed";
const PENDING_STATUS_STATE = "pending";

const RUN_CONCLUSION: ReadonlyMap<string, GitHubCheckConclusion> = new Map(
  Object.values(GITHUB_CHECK_CONCLUSION).map((conclusion) => [conclusion, conclusion]),
);

const STATUS_CONCLUSION: ReadonlyMap<string, GitHubCheckConclusion> = new Map([
  ["success", GITHUB_CHECK_CONCLUSION.SUCCESS],
  ["failure", GITHUB_CHECK_CONCLUSION.FAILURE],
  ["error", GITHUB_CHECK_CONCLUSION.FAILURE],
]);

const DEFAULT_STATUS_CONTEXT = "default";

export const GitHubOpenerSchema = Schema.Struct({
  login: Schema.String,
  type: Schema.optional(Schema.String),
  avatar_url: Schema.optional(Schema.String),
});

interface OpenerFields {
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
}

export function openerFieldsOf(
  user: typeof GitHubOpenerSchema.Type | null | undefined,
): OpenerFields {
  if (user == null) return {};
  const avatarUrl = githubAvatarUrl(user.avatar_url);
  return {
    author: user.login,
    authorBot: user.type === GITHUB_BOT_TYPE || user.login.endsWith(BOT_LOGIN_SUFFIX),
    ...(avatarUrl === undefined ? undefined : { authorAvatarUrl: avatarUrl }),
  };
}

const PullRequestSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.String,
  draft: Schema.Boolean,
  merged: Schema.Boolean,
  additions: Schema.Number,
  deletions: Schema.Number,
  changed_files: Schema.Number,
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  user: Schema.optional(Schema.NullOr(GitHubOpenerSchema)),
  created_at: Schema.optional(Schema.String),
  merged_at: Schema.optional(Schema.NullOr(Schema.String)),
  closed_at: Schema.optional(Schema.NullOr(Schema.String)),
  base: Schema.optional(Schema.Struct({ ref: Schema.String, sha: Schema.optional(Schema.String) })),
  labels: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String })),
  ),
  comments: Schema.optional(Schema.Number),
  review_comments: Schema.optional(Schema.Number),
  commits: Schema.optional(Schema.Number),
  body: Schema.optional(Schema.NullOr(Schema.String)),
});

const ListedPullRequestSchema = Schema.Struct({ number: Schema.Number });
const ListedPullRequestsSchema = Schema.Array(ListedPullRequestSchema);

const CheckRunsSchema = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({
      id: Schema.optionalKey(Schema.Number),
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      html_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
      details_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

const FILES_PER_PAGE = 100;

const GIT_OBJECT = /^[0-9a-f]{40}$/u;

const GITHUB_FILE_STATUS = new Map<string, ChangedFileStatus>([
  ["added", CHANGED_FILE_STATUS.ADDED],
  ["removed", CHANGED_FILE_STATUS.DELETED],
  ["renamed", CHANGED_FILE_STATUS.RENAMED],
]);

const PullRequestFilesSchema = Schema.Array(
  Schema.Struct({
    filename: Schema.String,
    previous_filename: Schema.optionalKey(Schema.String),
    status: Schema.String,
    additions: Schema.Number,
    deletions: Schema.Number,
    changes: Schema.Number,
    patch: Schema.optionalKey(Schema.String),
    sha: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);

const CombinedStatusSchema = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      state: Schema.String,
      context: Schema.optionalKey(Schema.String),
      target_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
      updated_at: Schema.optionalKey(Schema.String),
    }),
  ),
});

const GitHubAccountSchema = Schema.Struct({
  login: Schema.String,
  id: Schema.Number,
  type: Schema.String,
  avatar_url: Schema.optionalKey(Schema.String),
});

const PullRequestPeopleSchema = Schema.Struct({
  user: Schema.NullOr(GitHubAccountSchema),
  requested_reviewers: Schema.optionalKey(Schema.Array(GitHubAccountSchema)),
});

const ReviewsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Number),
    user: Schema.NullOr(GitHubAccountSchema),
    state: Schema.String,
    body: Schema.NullOr(Schema.String),
    submitted_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
    html_url: Schema.optionalKey(Schema.String),
    body_html: Schema.optionalKey(Schema.NullOr(Schema.String)),
    node_id: Schema.optionalKey(Schema.String),
  }),
);

const GITHUB_REVIEW_STATE = new Map<string, ReviewState>([
  ["APPROVED", REVIEW_STATE.APPROVED],
  ["CHANGES_REQUESTED", REVIEW_STATE.CHANGES_REQUESTED],
  ["DISMISSED", REVIEW_STATE.DISMISSED],
  ["COMMENTED", REVIEW_STATE.COMMENTED],
]);

const GITHUB_BOT_TYPE = "Bot";

const BOT_LOGIN_SUFFIX = "[bot]";

const PEOPLE_PER_PAGE = 100;

const PEOPLE_MAX_PAGES = { REVIEWS: 30 } as const;

function segment(value: string): string {
  return encodeURIComponent(value);
}

export function repositoryPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${segment(owner)}/${segment(name)}`;
}

function readOptional<A>(
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
): Read<Option.Option<A>> {
  return Effect.scoped(
    Effect.flatMap(
      send(request),
      (response): Effect.Effect<Option.Option<A>, GitHubUnavailable> =>
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND
          ? Effect.succeed(Option.none())
          : Effect.map(readBody(response, schema), Option.some),
    ),
  );
}

function momentOf(spelled: string | null | undefined): number | undefined {
  if (spelled == null) return undefined;
  const at = Date.parse(spelled);
  return Number.isNaN(at) ? undefined : at;
}

function commentCountOf(record: typeof PullRequestSchema.Type): number | undefined {
  if (record.comments === undefined && record.review_comments === undefined) return undefined;
  return (record.comments ?? 0) + (record.review_comments ?? 0);
}

function pullRequestOf(record: typeof PullRequestSchema.Type): GitHubPullRequest {
  const state = record.merged
    ? PULL_REQUEST_STATE.MERGED
    : record.state === GITHUB_PULL_STATE.CLOSED
      ? PULL_REQUEST_STATE.CLOSED
      : record.draft
        ? PULL_REQUEST_STATE.DRAFT
        : PULL_REQUEST_STATE.OPEN;
  const openedAt = momentOf(record.created_at);
  const mergedAt = momentOf(record.merged_at);
  const closedAt = momentOf(record.closed_at);
  const comments = commentCountOf(record);
  return {
    number: record.number,
    title: record.title,
    url: record.html_url,
    state,
    headRef: record.head.ref,
    headSha: record.head.sha,
    additions: record.additions,
    deletions: record.deletions,
    changedFiles: record.changed_files,
    ...openerFieldsOf(record.user),
    ...(openedAt === undefined ? undefined : { openedAt }),
    ...(mergedAt === undefined ? undefined : { mergedAt }),
    ...(closedAt === undefined ? undefined : { closedAt }),
    ...(record.base === undefined ? undefined : { baseRef: record.base.ref }),
    ...(record.base?.sha === undefined ? undefined : { baseSha: record.base.sha }),
    ...(record.labels === undefined ? undefined : { labels: record.labels }),
    ...(comments === undefined ? undefined : { comments }),
    ...(record.commits === undefined ? undefined : { commits: record.commits }),
    ...(record.body == null || record.body === "" ? undefined : { body: record.body }),
  };
}

export function pullRequestByNumber(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Read<Option.Option<GitHubPullRequest>> {
  return Effect.map(
    readOptional(
      githubRead(`${repositoryPath(fullName)}/pulls/${number}`, token),
      PullRequestSchema,
    ),
    Option.map(pullRequestOf),
  );
}

export function pullRequestOfBranch(
  token: Redacted.Redacted,
  fullName: string,
  branch: string,
): Read<Option.Option<GitHubPullRequest>> {
  const [owner = ""] = fullName.split("/");
  const listing = githubRead(`${repositoryPath(fullName)}/pulls`, token).pipe(
    HttpClientRequest.setUrlParams({
      head: `${owner}:${branch}`,
      state: ANY_STATE,
      sort: SORT.CREATED,
      direction: SORT.DESCENDING,
      per_page: NEWEST_ONE,
    }),
  );
  return Effect.flatMap(readOptional(listing, ListedPullRequestsSchema), (listed) => {
    const [newest] = Option.getOrElse(listed, () => []);
    return newest === undefined
      ? Effect.succeed(Option.none())
      : pullRequestByNumber(token, fullName, newest.number);
  });
}

export function branchStands(
  token: Redacted.Redacted,
  fullName: string,
  branch: string,
): Read<boolean> {
  return Effect.map(
    readOptional(
      githubRead(`${repositoryPath(fullName)}/branches/${segment(branch)}`, token),
      Schema.Struct({ name: Schema.String }),
    ),
    Option.isSome,
  );
}

export const HEAD_CHECK_KIND = {
  RUN: "run",
  STATUS: "status",
} as const;

type HeadCheckKind = (typeof HEAD_CHECK_KIND)[keyof typeof HEAD_CHECK_KIND];

export interface HeadCheck {
  readonly kind: HeadCheckKind;
  readonly name: string;
  readonly conclusion: GitHubCheckConclusion | null;
  readonly url: string | null;
}

export interface HeadChecks {
  readonly failing: boolean;
  readonly pending: boolean;
  readonly any: boolean;
  readonly outcomes: readonly string[];
  readonly checks: readonly HeadCheck[];
}

export function headCheckFailed(check: HeadCheck): boolean {
  return check.conclusion !== null && isFailingConclusion(check.conclusion);
}

function summaryOf(checks: HeadChecks): CheckSummary {
  if (checks.failing) return CHECK_SUMMARY.FAILING;
  if (checks.pending) return CHECK_SUMMARY.PENDING;
  return checks.any ? CHECK_SUMMARY.PASSING : CHECK_SUMMARY.NONE;
}

function forbiddenNotLimited(
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<boolean> {
  return response.status === GITHUB_HTTP_STATUS.FORBIDDEN
    ? Effect.map(rateLimited(response), (limited) => !limited)
    : Effect.succeed(false);
}

function runConclusionOf(status: string, conclusion: string | null): GitHubCheckConclusion | null {
  if (status !== COMPLETED || conclusion === null) return null;
  return RUN_CONCLUSION.get(conclusion) ?? null;
}

function readChecks<A>(
  what: string,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
  tally: (answer: A) => HeadChecks,
): Read<HeadChecks> {
  const none: HeadChecks = {
    failing: false,
    pending: false,
    any: false,
    outcomes: [],
    checks: [],
  };
  return Effect.scoped(
    Effect.flatMap(send(request), (response: HttpClientResponse.HttpClientResponse) => {
      if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Effect.succeed(none);
      return Effect.flatMap(forbiddenNotLimited(response), (forbidden) =>
        forbidden
          ? Effect.as(
              Effect.logWarning(
                `the GitHub App may not read a head's ${what}; the checks read as none`,
              ),
              none,
            )
          : Effect.map(readBody(response, schema), tally),
      );
    }),
  );
}

export function headChecksOf(
  token: Redacted.Redacted,
  fullName: string,
  sha: string,
): Read<HeadChecks> {
  const commit = `${repositoryPath(fullName)}/commits/${segment(sha)}`;
  const perPage = HttpClientRequest.setUrlParams({ per_page: CHECKS_PER_PAGE });
  const runs = readChecks(
    "check runs",
    githubRead(`${commit}/check-runs`, token).pipe(perPage),
    CheckRunsSchema,
    (answer) => ({
      failing: answer.check_runs.some(
        (run) => run.conclusion !== null && isFailingConclusion(run.conclusion),
      ),
      pending: answer.check_runs.some((run) => run.status !== COMPLETED),
      any: answer.check_runs.length > 0,
      outcomes: answer.check_runs.map((run) =>
        JSON.stringify(["run", run.id ?? null, run.status, run.conclusion]),
      ),
      checks: answer.check_runs.map((run) => ({
        kind: HEAD_CHECK_KIND.RUN,
        name: run.name,
        conclusion: runConclusionOf(run.status, run.conclusion),
        url: run.html_url ?? run.details_url ?? null,
      })),
    }),
  );
  const statuses = readChecks(
    "commit statuses",
    githubRead(`${commit}/status`, token).pipe(perPage),
    CombinedStatusSchema,
    (answer) => ({
      failing: answer.statuses.some((status) => FAILING_STATUS_STATES.has(status.state)),
      pending: answer.statuses.some((status) => status.state === PENDING_STATUS_STATE),
      any: answer.statuses.length > 0,
      outcomes: answer.statuses.map((status) =>
        JSON.stringify(["status", status.context ?? null, status.state, status.updated_at ?? null]),
      ),
      checks: answer.statuses.map((status) => ({
        kind: HEAD_CHECK_KIND.STATUS,
        name: status.context ?? DEFAULT_STATUS_CONTEXT,
        conclusion: STATUS_CONCLUSION.get(status.state) ?? null,
        url: status.target_url ?? null,
      })),
    }),
  );
  return Effect.map(Effect.all([runs, statuses]), ([a, b]) => ({
    failing: a.failing || b.failing,
    pending: a.pending || b.pending,
    any: a.any || b.any,
    outcomes: [...a.outcomes, ...b.outcomes].toSorted(),
    checks: [...a.checks, ...b.checks],
  }));
}

export function checkSummaryOf(
  token: Redacted.Redacted,
  fullName: string,
  sha: string,
): Read<CheckSummary> {
  return Effect.map(headChecksOf(token, fullName, sha), summaryOf);
}

function changedFileOf(file: (typeof PullRequestFilesSchema.Type)[number]): AgentChangedFile {
  const status = GITHUB_FILE_STATUS.get(file.status) ?? CHANGED_FILE_STATUS.MODIFIED;
  const movedOnly = status === CHANGED_FILE_STATUS.RENAMED && file.changes === 0;
  const patch = file.patch ?? (movedOnly ? "" : null);
  const omitted =
    patch === null
      ? file.changes === 0
        ? PATCH_OMITTED.BINARY
        : PATCH_OMITTED.TOO_LARGE
      : patch.length > CHANGES_BOUNDS.MAX_PATCH_CHARS
        ? PATCH_OMITTED.TOO_LARGE
        : null;
  return {
    path: file.filename,
    previousPath: file.previous_filename ?? null,
    status,
    additions: file.additions,
    deletions: file.deletions,
    patch: omitted === null ? patch : null,
    omitted,
    ...(status === CHANGED_FILE_STATUS.DELETED || file.sha == null || !GIT_OBJECT.test(file.sha)
      ? undefined
      : { blobSha: file.sha }),
  };
}

export interface PullRequestFiles {
  readonly files: readonly AgentChangedFile[];
  readonly truncated: boolean;
}

export const pullRequestFiles = /* @__PURE__ */ Effect.fn("web/pullRequestFiles")(function* (
  token: Redacted.Redacted,
  fullName: string,
  pullRequest: { readonly number: number; readonly changedFiles: number },
): Effect.fn.Return<PullRequestFiles, PullRequestReadFailure, HttpClient.HttpClient> {
  const files: AgentChangedFile[] = [];
  const path = `${repositoryPath(fullName)}/pulls/${pullRequest.number}/files`;
  for (let page = 1; files.length < CHANGES_BOUNDS.MAX_FILES; page += 1) {
    const request = githubRead(path, token).pipe(
      HttpClientRequest.setUrlParams({ per_page: String(FILES_PER_PAGE), page: String(page) }),
    );
    const read = Option.getOrElse(yield* readOptional(request, PullRequestFilesSchema), () => []);
    files.push(...read.map(changedFileOf));
    if (read.length < FILES_PER_PAGE) break;
  }
  const kept = files.slice(0, CHANGES_BOUNDS.MAX_FILES);
  return { files: kept, truncated: pullRequest.changedFiles > kept.length };
});

const PullRequestCommitsSchema = Schema.Array(
  Schema.Struct({ commit: Schema.Struct({ message: Schema.String }) }),
);

const MAX_COMMIT_MESSAGES = 100;

export function pullRequestCommitMessages(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Read<readonly string[]> {
  const request = githubRead(`${repositoryPath(fullName)}/pulls/${number}/commits`, token).pipe(
    HttpClientRequest.setUrlParams({ per_page: String(MAX_COMMIT_MESSAGES) }),
  );
  return Effect.map(readOptional(request, PullRequestCommitsSchema), (read) =>
    Option.getOrElse(read, () => []).map(({ commit }) => commit.message),
  );
}

const CompareSchema = Schema.Struct({ merge_base_commit: Schema.Struct({ sha: Schema.String }) });

export interface ReadCommits {
  readonly headSha?: string;
  readonly baseSha?: string;
}

function readAtBase(file: AgentChangedFile): boolean {
  if (file.status === CHANGED_FILE_STATUS.ADDED) return false;
  return (
    imageTypeOfPath(file.previousPath ?? file.path) !== undefined ||
    file.omitted === PATCH_OMITTED.TOO_LARGE
  );
}

export const readCommits = /* @__PURE__ */ Effect.fn("web/readCommits")(function* (
  token: Redacted.Redacted,
  fullName: string,
  pullRequest: Option.Option<Pick<GitHubPullRequest, "headSha" | "baseSha">>,
  files: readonly AgentChangedFile[],
): Effect.fn.Return<ReadCommits, never, HttpClient.HttpClient> {
  if (Option.isNone(pullRequest)) return {};
  const { headSha, baseSha } = pullRequest.value;
  if (baseSha === undefined || !files.some(readAtBase)) return { headSha };
  const request = githubRead(
    `${repositoryPath(fullName)}/compare/${segment(baseSha)}...${segment(headSha)}`,
    token,
  ).pipe(HttpClientRequest.setUrlParams({ per_page: "1" }));
  const compared = yield* readOptional(request, CompareSchema).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`a pull request's merge base could not be read: ${failure._tag}`),
        Option.none(),
      ),
    ),
  );
  return Option.match(compared, {
    onNone: () => ({ headSha }),
    onSome: (compare) => ({ headSha, baseSha: compare.merge_base_commit.sha }),
  });
});

export interface GitHubAccount {
  readonly id: number;
  readonly login: string;
  readonly bot: boolean;
  readonly avatarUrl: string | undefined;
}

export interface GitHubReviewer {
  readonly account: GitHubAccount;
  readonly state: ReviewState;
}

export interface GitHubReviewComment {
  readonly account: GitHubAccount;
  readonly state: ReviewState;
  readonly excerpt: string;
  readonly at: number;
}

export interface PullRequestPeople {
  readonly author: GitHubAccount | undefined;
  readonly reviewers: readonly GitHubReviewer[];
  readonly comments: readonly GitHubReviewComment[];
}

function accountOf(record: typeof GitHubAccountSchema.Type): GitHubAccount {
  return {
    id: record.id,
    login: record.login,
    bot: record.type === GITHUB_BOT_TYPE || record.login.endsWith(BOT_LOGIN_SUFFIX),
    avatarUrl: githubAvatarUrl(record.avatar_url),
  };
}

function distinctAccounts(accounts: readonly GitHubAccount[]): readonly GitHubAccount[] {
  const seen = new Map<number, GitHubAccount>();
  for (const account of accounts) if (!seen.has(account.id)) seen.set(account.id, account);
  return [...seen.values()].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
}

function excerptOf(body: string): string {
  return body.replace(/\s+/gu, " ").trim().slice(0, CHANGES_BOUNDS.MAX_EXCERPT_CHARS).trimEnd();
}

function reviewersOf(
  reviews: typeof ReviewsSchema.Type,
  requested: readonly GitHubAccount[],
): readonly GitHubReviewer[] {
  const standing = new Map<number, GitHubReviewer>();
  for (const review of reviews) {
    const state = GITHUB_REVIEW_STATE.get(review.state);
    if (review.user === null || state === undefined) continue;
    const account = accountOf(review.user);
    const held = standing.get(account.id);
    if (state === REVIEW_STATE.COMMENTED && held !== undefined) continue;
    standing.set(account.id, { account, state });
  }
  for (const account of requested)
    standing.set(account.id, { account, state: REVIEW_STATE.REQUESTED });
  return [...standing.values()].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
}

function commentsOf(reviews: typeof ReviewsSchema.Type): readonly GitHubReviewComment[] {
  return reviews
    .flatMap((review) => {
      const state = GITHUB_REVIEW_STATE.get(review.state);
      const words = review.body?.trim() ?? "";
      if (review.user === null || state === undefined || words === "") return [];
      const at = Date.parse(review.submitted_at ?? "");
      return [
        {
          account: accountOf(review.user),
          state,
          excerpt: excerptOf(words),
          at: Number.isNaN(at) ? 0 : at,
        },
      ];
    })
    .slice(-CHANGES_BOUNDS.MAX_PEOPLE);
}

const NOBODY: PullRequestPeople = {
  author: undefined,
  reviewers: [],
  comments: [],
};

const everyPage = /* @__PURE__ */ Effect.fnUntraced(function* <A>(
  token: Redacted.Redacted,
  path: string,
  schema: Schema.Codec<readonly A[], unknown>,
  maxPages: number,
  rendered = false,
) {
  const listed: A[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const request = githubRead(path, token).pipe(
      HttpClientRequest.setUrlParams({ per_page: String(PEOPLE_PER_PAGE), page: String(page) }),
      rendered ? withRendering : (each) => each,
    );
    const read = Option.getOrElse(yield* readOptional(request, schema), () => []);
    listed.push(...read);
    if (read.length < PEOPLE_PER_PAGE) break;
  }
  return listed;
});

export const pullRequestPeople = /* @__PURE__ */ Effect.fn("web/pullRequestPeople")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.fn.Return<PullRequestPeople, PullRequestReadFailure, HttpClient.HttpClient> {
  const path = `${repositoryPath(fullName)}/pulls/${number}`;
  const [pull, reviews] = yield* Effect.all(
    [
      readOptional(githubRead(path, token), PullRequestPeopleSchema),
      everyPage(token, `${path}/reviews`, ReviewsSchema, PEOPLE_MAX_PAGES.REVIEWS),
    ],
    { concurrency: "unbounded" },
  );
  if (Option.isNone(pull)) return NOBODY;
  const requested = (pull.value.requested_reviewers ?? []).map(accountOf);
  return {
    author: pull.value.user === null ? undefined : accountOf(pull.value.user),
    reviewers: reviewersOf(reviews, requested),
    comments: commentsOf(reviews),
  };
});

export interface GitHubReviewLineComment {
  readonly path: string;
  readonly line: number | undefined;
  readonly body: string;
  readonly url: string;
}

const ReviewLineCommentsSchema = Schema.Array(
  Schema.Struct({
    path: Schema.String,
    line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    original_line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    body: Schema.String,
    html_url: Schema.String,
  }),
);

const REVIEW_COMMENTS_MAX_PAGES = 3;

export const reviewLineComments = /* @__PURE__ */ Effect.fn("web/reviewLineComments")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
  reviewId: number,
): Effect.fn.Return<
  readonly GitHubReviewLineComment[],
  PullRequestReadFailure,
  HttpClient.HttpClient
> {
  const comments = yield* everyPage(
    token,
    `${repositoryPath(fullName)}/pulls/${number}/reviews/${reviewId}/comments`,
    ReviewLineCommentsSchema,
    REVIEW_COMMENTS_MAX_PAGES,
  );
  return comments.map((comment) => ({
    path: comment.path,
    line: comment.line ?? comment.original_line ?? undefined,
    body: comment.body,
    url: comment.html_url,
  }));
});

const FULL_MEDIA_TYPE = "application/vnd.github.full+json";

function withRendering(
  request: HttpClientRequest.HttpClientRequest,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.setHeader(request, "accept", FULL_MEDIA_TYPE);
}

const TeamSchema = Schema.Struct({ slug: Schema.String, name: Schema.String });

interface GitHubTeam {
  readonly slug: string;
  readonly name: string;
}

const OverviewPullSchema = Schema.Struct({
  ...PullRequestSchema.fields,
  body: Schema.NullOr(Schema.String),
  body_html: Schema.optionalKey(Schema.NullOr(Schema.String)),
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    repo: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({
          id: Schema.Number,
          owner: Schema.optionalKey(Schema.Struct({ login: Schema.String })),
        }),
      ),
    ),
  }),
  base: Schema.Struct({
    ref: Schema.String,
    repo: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
  }),
  created_at: Schema.String,
  merged_at: Schema.NullOr(Schema.String),
  mergeable_state: Schema.optionalKey(Schema.String),
  user: Schema.NullOr(GitHubAccountSchema),
  requested_reviewers: Schema.optionalKey(Schema.Array(GitHubAccountSchema)),
  requested_teams: Schema.optionalKey(Schema.Array(TeamSchema)),
});

const ListedCheckRunsSchema = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      status: Schema.String,
      conclusion: Schema.NullOr(Schema.String),
      html_url: Schema.NullOr(Schema.String),
      details_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
      started_at: Schema.NullOr(Schema.String),
      completed_at: Schema.NullOr(Schema.String),
      app: Schema.NullOr(Schema.Struct({ id: Schema.Number, name: Schema.String })),
    }),
  ),
});

const ListedStatusesSchema = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      state: Schema.String,
      target_url: Schema.NullOr(Schema.String),
      created_at: Schema.String,
      updated_at: Schema.String,
      avatar_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

const ReactionRollupSchema = Schema.Struct({
  "+1": Schema.optionalKey(Schema.Number),
  "-1": Schema.optionalKey(Schema.Number),
  laugh: Schema.optionalKey(Schema.Number),
  hooray: Schema.optionalKey(Schema.Number),
  confused: Schema.optionalKey(Schema.Number),
  heart: Schema.optionalKey(Schema.Number),
  rocket: Schema.optionalKey(Schema.Number),
  eyes: Schema.optionalKey(Schema.Number),
});

type ReactionRollup = typeof ReactionRollupSchema.Type;

const ROLLUP_KEY = {
  [REACTION.THUMBS_UP]: "+1",
  [REACTION.THUMBS_DOWN]: "-1",
  [REACTION.LAUGH]: "laugh",
  [REACTION.HOORAY]: "hooray",
  [REACTION.CONFUSED]: "confused",
  [REACTION.HEART]: "heart",
  [REACTION.ROCKET]: "rocket",
  [REACTION.EYES]: "eyes",
} as const satisfies Record<Reaction, keyof ReactionRollup>;

const IssueCommentsSchema = Schema.Array(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Number),
    user: Schema.NullOr(GitHubAccountSchema),
    body: Schema.optionalKey(Schema.NullOr(Schema.String)),
    body_html: Schema.optionalKey(Schema.NullOr(Schema.String)),
    created_at: Schema.String,
    html_url: Schema.String,
    node_id: Schema.optionalKey(Schema.String),
    reactions: Schema.optionalKey(ReactionRollupSchema),
  }),
);

const COMMENTS_MAX_PAGES = 10;

const GITHUB_MERGE_STATE = new Map<string, MergeState>([
  ["clean", MERGE_STATE.CLEAN],
  ["has_hooks", MERGE_STATE.CLEAN],
  ["unstable", MERGE_STATE.UNSTABLE],
  ["blocked", MERGE_STATE.BLOCKED],
  ["behind", MERGE_STATE.BEHIND],
  ["dirty", MERGE_STATE.CONFLICTS],
  ["draft", MERGE_STATE.DRAFT],
]);

const SKIPPED_CONCLUSIONS: ReadonlySet<string> = new Set(["skipped", "neutral", "stale"]);

const SUCCESS = "success";

export interface GitHubOverviewPullRequest {
  readonly pullRequest: GitHubPullRequest;
  readonly body: string;
  readonly html: string;
  readonly base: string;
  readonly head: string;
  readonly headOwner?: string;
  readonly createdAt: number;
  readonly mergedAt: number | null;
  readonly merge: MergeState;
  readonly author: GitHubAccount | undefined;
  readonly requested: readonly GitHubAccount[];
  readonly requestedTeams: readonly GitHubTeam[];
  readonly labels: readonly GitHubLabel[];
  readonly stack: readonly StackEntry[];
}

export interface GitHubOverviewConversation {
  readonly reviewers: readonly GitHubReviewer[];
  readonly conversation: readonly GitHubConversationEntry[];
  readonly earlier: number;
  readonly descriptionReactions: readonly GitHubReaction[];
  readonly descriptionSubject: string | undefined;
}

export interface GitHubReaction {
  readonly content: Reaction;
  readonly count: number;
  readonly accounts: readonly GitHubAccount[] | undefined;
  readonly mine: boolean | undefined;
}

export type ViewerReactions = ReadonlyMap<string, ReadonlySet<Reaction>>;

interface GitHubConversationEntry {
  readonly kind: (typeof CONVERSATION_ENTRY)[keyof typeof CONVERSATION_ENTRY];
  readonly account: GitHubAccount;
  readonly state: ReviewState | undefined;
  readonly html: string | null;
  readonly body: string;
  readonly at: number;
  readonly url: string;
  readonly threads: readonly GitHubReviewThread[];
  readonly reactions: readonly GitHubReaction[];
  readonly subject: string | undefined;
}

interface GitHubThreadComment {
  readonly account: GitHubAccount;
  readonly html: string | null;
  readonly body: string;
  readonly at: number;
  readonly url: string;
  readonly reactions: readonly GitHubReaction[];
  readonly subject: string | undefined;
}

interface GitHubReviewThread {
  readonly reviewId: number | null;
  readonly id: string;
  readonly path: string;
  readonly line: number | null;
  readonly startLine: number | null;
  readonly originalLine: number | null;
  readonly originalStartLine: number | null;
  readonly side: DiffSide;
  readonly startSide: DiffSide | null;
  readonly diffHunk: string;
  readonly resolved: boolean;
  readonly outdated: boolean;
  readonly comments: readonly GitHubThreadComment[];
  readonly more: number;
}

function timeOf(spelled: string | null | undefined): number | null {
  const at = Date.parse(spelled ?? "");
  return Number.isNaN(at) ? null : at;
}

function nameOf(name: string): string {
  return name.slice(0, OVERVIEW_BOUNDS.MAX_NAME_CHARS);
}

function runStateOf(status: string, conclusion: string | null): CheckState {
  if (status !== COMPLETED || conclusion === null) return CHECK_STATE.PENDING;
  if (conclusion === SUCCESS) return CHECK_STATE.PASSED;
  return SKIPPED_CONCLUSIONS.has(conclusion) ? CHECK_STATE.SKIPPED : CHECK_STATE.FAILED;
}

function statusStateOf(state: string): CheckState {
  if (state === SUCCESS) return CHECK_STATE.PASSED;
  return FAILING_STATUS_STATES.has(state) ? CHECK_STATE.FAILED : CHECK_STATE.PENDING;
}

function checkAvatarOf(spelled: string | null | undefined): string | undefined {
  if (spelled === null || spelled === undefined) return undefined;
  return githubAvatarUrl(spelled) ?? (githubImageOf(spelled) === undefined ? undefined : spelled);
}

function withAvatar(check: PullRequestCheck, avatarUrl: string | undefined): PullRequestCheck {
  return avatarUrl === undefined ? check : { ...check, avatarUrl };
}

const CHECK_RANK = {
  [CHECK_STATE.FAILED]: 0,
  [CHECK_STATE.PENDING]: 1,
  [CHECK_STATE.PASSED]: 2,
  [CHECK_STATE.SKIPPED]: 3,
} as const satisfies Record<CheckState, number>;

function pullHeadRef(number: number): string {
  return `refs/pull/${number}/head`;
}

export function pullRequestChecks(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Read<readonly PullRequestCheck[]> {
  const commit = `${repositoryPath(fullName)}/commits/${segment(pullHeadRef(number))}`;
  const perPage = HttpClientRequest.setUrlParams({ per_page: CHECKS_PER_PAGE });
  const runs = readListed(
    "check runs",
    githubRead(`${commit}/check-runs`, token).pipe(perPage),
    ListedCheckRunsSchema,
    (answer): readonly PullRequestCheck[] =>
      answer.check_runs.map((run) =>
        withAvatar(
          {
            name: nameOf(run.name),
            app: run.app === null ? null : nameOf(run.app.name),
            state: runStateOf(run.status, run.conclusion),
            url: run.html_url ?? run.details_url ?? null,
            startedAt: timeOf(run.started_at),
            completedAt: timeOf(run.completed_at),
          },
          run.app === null ? undefined : githubAppAvatarUrl(run.app.id),
        ),
      ),
  );
  const statuses = readListed(
    "commit statuses",
    githubRead(`${commit}/status`, token).pipe(perPage),
    ListedStatusesSchema,
    (answer): readonly PullRequestCheck[] =>
      answer.statuses.map((status) => {
        const state = statusStateOf(status.state);
        const check: PullRequestCheck = {
          name: nameOf(status.context),
          app: null,
          state,
          url: status.target_url,
          startedAt: timeOf(status.created_at),
          completedAt: state === CHECK_STATE.PENDING ? null : timeOf(status.updated_at),
        };
        return withAvatar(check, checkAvatarOf(status.avatar_url));
      }),
  );
  return Effect.map(Effect.all([runs, statuses], { concurrency: "unbounded" }), ([a, b]) =>
    [...a, ...b]
      .sort((one, other) => CHECK_RANK[one.state] - CHECK_RANK[other.state])
      .slice(0, OVERVIEW_BOUNDS.MAX_CHECKS),
  );
}

function readListed<A>(
  what: string,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
  listed: (answer: A) => readonly PullRequestCheck[],
): Read<readonly PullRequestCheck[]> {
  return Effect.scoped(
    Effect.flatMap(send(request), (response: HttpClientResponse.HttpClientResponse) => {
      if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Effect.succeed([]);
      return Effect.flatMap(forbiddenNotLimited(response), (forbidden) =>
        forbidden
          ? Effect.as(
              Effect.logWarning(`the GitHub App may not read a head's ${what}; none are listed`),
              [],
            )
          : Effect.map(readBody(response, schema), listed),
      );
    }),
  );
}

interface EntryWords {
  readonly html: string | null;
  readonly body: string;
  readonly said: boolean;
}

function wordsOf(body: string | null | undefined, html: string | null | undefined): EntryWords {
  const words = body?.trim() ?? "";
  const rendered = html?.trim() ?? "";
  return rendered === ""
    ? { html: null, body: words, said: words !== "" }
    : { html: rendered, body: "", said: words !== "" };
}

const CONVERSATION_QUERY = `query Conversation($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      reactionGroups { ...Reaction }
      comments(last: ${OVERVIEW_BOUNDS.MAX_ENTRIES}) {
        nodes { databaseId reactionGroups { ...Reaction } }
      }
      reviews(last: ${OVERVIEW_BOUNDS.MAX_ENTRIES}) {
        nodes { databaseId reactionGroups { ...Reaction } }
      }
      reviewThreads(last: ${OVERVIEW_BOUNDS.MAX_THREADS}) {
        totalCount
        nodes {
          id
          path
          line
          startLine
          originalLine
          originalStartLine
          diffSide
          startDiffSide
          isResolved
          isOutdated
          comments(first: ${OVERVIEW_BOUNDS.MAX_THREAD_COMMENTS}) {
            totalCount
            nodes {
              author { __typename login avatarUrl ... on User { databaseId } ... on Bot { databaseId } }
              body
              bodyHTML
              createdAt
              url
              diffHunk
              pullRequestReview { databaseId state }
              id
              reactionGroups { content reactors { totalCount } }
            }
          }
        }
      }
    }
  }
}

fragment Reaction on ReactionGroup {
  content
  reactors(first: ${OVERVIEW_BOUNDS.MAX_REACTORS}) {
    totalCount
    nodes {
      __typename
      ... on Actor { login avatarUrl }
      ... on User { databaseId }
      ... on Bot { databaseId }
    }
  }
}`;

const GRAPHQL_PATH = "/graphql";

const STACK_CANDIDATES = 100;

const STACK_PAGES = 5;

const GRAPHQL_BOT = "Bot";
const GRAPHQL_LEFT = "LEFT";

const GRAPHQL_PENDING = "PENDING";

const GHOST: GitHubAccount = { id: 10_137, login: "ghost", bot: false, avatarUrl: undefined };

const GRAPHQL_REACTION_CONTENT = {
  THUMBS_UP: "THUMBS_UP",
  THUMBS_DOWN: "THUMBS_DOWN",
  LAUGH: "LAUGH",
  HOORAY: "HOORAY",
  CONFUSED: "CONFUSED",
  HEART: "HEART",
  ROCKET: "ROCKET",
  EYES: "EYES",
} as const;

type GraphqlReactionContent =
  (typeof GRAPHQL_REACTION_CONTENT)[keyof typeof GRAPHQL_REACTION_CONTENT];

export const GRAPHQL_REACTION_OF = {
  [REACTION.THUMBS_UP]: GRAPHQL_REACTION_CONTENT.THUMBS_UP,
  [REACTION.THUMBS_DOWN]: GRAPHQL_REACTION_CONTENT.THUMBS_DOWN,
  [REACTION.LAUGH]: GRAPHQL_REACTION_CONTENT.LAUGH,
  [REACTION.HOORAY]: GRAPHQL_REACTION_CONTENT.HOORAY,
  [REACTION.CONFUSED]: GRAPHQL_REACTION_CONTENT.CONFUSED,
  [REACTION.HEART]: GRAPHQL_REACTION_CONTENT.HEART,
  [REACTION.ROCKET]: GRAPHQL_REACTION_CONTENT.ROCKET,
  [REACTION.EYES]: GRAPHQL_REACTION_CONTENT.EYES,
} as const satisfies Record<Reaction, GraphqlReactionContent>;

const GRAPHQL_REACTION = new Map<string, Reaction>(
  Object.values(REACTION).map((reaction) => [GRAPHQL_REACTION_OF[reaction], reaction]),
);

const REACTION_ORDER: readonly Reaction[] = Object.values(REACTION);

const GraphActorSchema = Schema.Struct({
  __typename: Schema.String,
  login: Schema.String,
  avatarUrl: Schema.optionalKey(Schema.String),
  databaseId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

const ReactionGroupSchema = Schema.Struct({
  content: Schema.String,
  reactors: Schema.Struct({
    totalCount: Schema.Number,
    nodes: Schema.optionalKey(Schema.Array(Schema.NullOr(GraphActorSchema))),
  }),
});

const ReactionGroupsSchema = Schema.optionalKey(Schema.NullOr(Schema.Array(ReactionGroupSchema)));

const ReactedSchema = Schema.Struct({
  databaseId: Schema.NullOr(Schema.Number),
  reactionGroups: ReactionGroupsSchema,
});

const ReactedListSchema = Schema.optionalKey(
  Schema.Struct({ nodes: Schema.Array(Schema.NullOr(ReactedSchema)) }),
);

const ThreadCommentSchema = Schema.Struct({
  author: Schema.NullOr(GraphActorSchema),
  body: Schema.String,
  bodyHTML: Schema.optionalKey(Schema.NullOr(Schema.String)),
  createdAt: Schema.String,
  url: Schema.String,
  diffHunk: Schema.optionalKey(Schema.NullOr(Schema.String)),
  pullRequestReview: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({ databaseId: Schema.NullOr(Schema.Number), state: Schema.String }),
    ),
  ),
  id: Schema.optionalKey(Schema.String),
  reactionGroups: ReactionGroupsSchema,
});

const ThreadSchema = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  line: Schema.NullOr(Schema.Number),
  startLine: Schema.NullOr(Schema.Number),
  originalLine: Schema.NullOr(Schema.Number),
  originalStartLine: Schema.NullOr(Schema.Number),
  diffSide: Schema.String,
  startDiffSide: Schema.NullOr(Schema.String),
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  comments: Schema.Struct({
    totalCount: Schema.Number,
    nodes: Schema.Array(Schema.NullOr(ThreadCommentSchema)),
  }),
});

const ConversationAnswerSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(
              Schema.Struct({
                id: Schema.optionalKey(Schema.String),
                reactionGroups: ReactionGroupsSchema,
                comments: ReactedListSchema,
                reviews: ReactedListSchema,
                reviewThreads: Schema.Struct({
                  totalCount: Schema.Number,
                  nodes: Schema.Array(Schema.NullOr(ThreadSchema)),
                }),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

type ReactionsById = ReadonlyMap<number, readonly GitHubReaction[]>;

interface ReadGraph {
  readonly threads: readonly GitHubReviewThread[];
  readonly left: number;
  readonly descriptionReactions: readonly GitHubReaction[];
  readonly descriptionSubject: string | undefined;
  readonly commentReactions: ReactionsById;
  readonly reviewReactions: ReactionsById;
}

const NO_GRAPH: ReadGraph = {
  threads: [],
  left: 0,
  descriptionReactions: [],
  descriptionSubject: undefined,
  commentReactions: new Map(),
  reviewReactions: new Map(),
};

function threadAccountOf(author: typeof GraphActorSchema.Type | null): GitHubAccount {
  if (author === null) return GHOST;
  const bot = author.__typename === GRAPHQL_BOT;
  return {
    id: author.databaseId ?? 0,
    login:
      bot && !author.login.endsWith(BOT_LOGIN_SUFFIX)
        ? `${author.login}${BOT_LOGIN_SUFFIX}`
        : author.login,
    bot,
    avatarUrl: githubAvatarUrl(author.avatarUrl),
  };
}

function reactionsOf(
  groups: readonly (typeof ReactionGroupSchema.Type)[] | null | undefined,
): readonly GitHubReaction[] {
  const given = (groups ?? []).flatMap((group): GitHubReaction[] => {
    const content = GRAPHQL_REACTION.get(group.content);
    const { totalCount, nodes } = group.reactors;
    if (content === undefined || totalCount === 0) return [];
    const accounts = nodes?.flatMap((node) => (node === null ? [] : [threadAccountOf(node)]));
    return [{ content, count: totalCount, accounts, mine: undefined }];
  });
  return given.sort(
    (a, b) => REACTION_ORDER.indexOf(a.content) - REACTION_ORDER.indexOf(b.content),
  );
}

function reactionsById(
  list: { readonly nodes: readonly (typeof ReactedSchema.Type | null)[] } | undefined,
): ReactionsById {
  const byId = new Map<number, readonly GitHubReaction[]>();
  for (const node of list?.nodes ?? []) {
    if (node?.databaseId != null) byId.set(node.databaseId, reactionsOf(node.reactionGroups));
  }
  return byId;
}

function reactionsAt(byId: ReactionsById, id: number | undefined): readonly GitHubReaction[] {
  return (id === undefined ? undefined : byId.get(id)) ?? [];
}

function rolledUpReactions(rollup: ReactionRollup | undefined): readonly GitHubReaction[] {
  if (rollup === undefined) return [];
  return REACTION_ORDER.flatMap((content): GitHubReaction[] => {
    const count = rollup[ROLLUP_KEY[content]] ?? 0;
    return count === 0 ? [] : [{ content, count, accounts: undefined, mine: undefined }];
  });
}

function sideOf(side: string): DiffSide {
  return side === GRAPHQL_LEFT ? DIFF_SIDE.LEFT : DIFF_SIDE.RIGHT;
}

function threadOf(node: typeof ThreadSchema.Type): GitHubReviewThread | undefined {
  const read = node.comments.nodes.flatMap((comment) => (comment === null ? [] : [comment]));
  const published = read.filter((comment) => comment.pullRequestReview?.state !== GRAPHQL_PENDING);
  const [first] = published;
  if (first === undefined) return undefined;
  return {
    reviewId: first.pullRequestReview?.databaseId ?? null,
    id: node.id,
    path: node.path,
    line: node.line,
    startLine: node.startLine,
    originalLine: node.originalLine,
    originalStartLine: node.originalStartLine,
    side: sideOf(node.diffSide),
    startSide: node.startDiffSide === null ? null : sideOf(node.startDiffSide),
    diffHunk: first.diffHunk ?? "",
    resolved: node.isResolved,
    outdated: node.isOutdated,
    comments: published.map((comment) => {
      const { said: _said, ...words } = wordsOf(comment.body, comment.bodyHTML);
      return {
        account: threadAccountOf(comment.author),
        ...words,
        at: timeOf(comment.createdAt) ?? 0,
        url: comment.url,
        reactions: reactionsOf(comment.reactionGroups),
        subject: comment.id,
      };
    }),
    more: Math.max(0, node.comments.totalCount - read.length),
  };
}

function conversationGraphOf(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<ReadGraph, never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost(GRAPHQL_PATH, token, {
    query: CONVERSATION_QUERY,
    variables: { owner, name, number },
  });
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, ConversationAnswerSchema)),
  ).pipe(
    Effect.flatMap((answer) => {
      const pullRequest = answer.data?.repository?.pullRequest;
      if (pullRequest == null) {
        return Effect.as(
          Effect.logWarning(
            `GitHub answered no review threads of pull request ${number} (${answer.errors?.length ?? 0} errors)`,
          ),
          NO_GRAPH,
        );
      }
      const listed = pullRequest.reviewThreads;
      const nodes = listed.nodes.flatMap((node) => (node === null ? [] : [node]));
      return Effect.succeed({
        threads: nodes.flatMap((node) => threadOf(node) ?? []),
        left: Math.max(0, listed.totalCount - listed.nodes.length),
        descriptionReactions: reactionsOf(pullRequest.reactionGroups),
        descriptionSubject: pullRequest.id,
        commentReactions: reactionsById(pullRequest.comments),
        reviewReactions: reactionsById(pullRequest.reviews),
      });
    }),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `the review threads of pull request ${number} were not read: ${failure._tag}`,
        ),
        NO_GRAPH,
      ),
    ),
  );
}

function threadAt(thread: GitHubReviewThread): number {
  return thread.comments[0]?.at ?? 0;
}

function threadEntryOf(thread: GitHubReviewThread, pageUrl: string): GitHubConversationEntry {
  const first = thread.comments[0];
  return {
    kind: CONVERSATION_ENTRY.REVIEW,
    account: first?.account ?? GHOST,
    state: REVIEW_STATE.COMMENTED,
    html: null,
    body: "",
    at: threadAt(thread),
    url: first?.url ?? pageUrl,
    threads: [thread],
    reactions: [],
    subject: undefined,
  };
}

interface KeptConversation {
  readonly conversation: readonly GitHubConversationEntry[];
  readonly earlier: number;
}

function conversationOf(
  comments: typeof IssueCommentsSchema.Type,
  reviews: typeof ReviewsSchema.Type,
  read: ReadGraph,
  pageUrl: string,
): KeptConversation {
  const byReview = new Map<number, GitHubReviewThread[]>();
  for (const thread of [...read.threads].sort((a, b) => threadAt(a) - threadAt(b))) {
    if (thread.reviewId === null) continue;
    byReview.set(thread.reviewId, [...(byReview.get(thread.reviewId) ?? []), thread]);
  }
  const placed = new Set<number>();
  const said = comments.flatMap((comment): GitHubConversationEntry[] => {
    const { said, ...words } = wordsOf(comment.body, comment.body_html);
    if (comment.user === null || !said) return [];
    return [
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        account: accountOf(comment.user),
        state: undefined,
        ...words,
        at: timeOf(comment.created_at) ?? 0,
        url: comment.html_url,
        threads: [],
        reactions:
          comment.id !== undefined && read.commentReactions.has(comment.id)
            ? reactionsAt(read.commentReactions, comment.id)
            : rolledUpReactions(comment.reactions),
        subject: comment.node_id,
      },
    ];
  });
  const reviewed = reviews.flatMap((review): GitHubConversationEntry[] => {
    const state = GITHUB_REVIEW_STATE.get(review.state);
    const { said, ...words } = wordsOf(review.body, review.body_html);
    if (review.user === null || state === undefined) return [];
    const threads = review.id === undefined ? [] : (byReview.get(review.id) ?? []);
    if (state === REVIEW_STATE.COMMENTED && !said && threads.length === 0) return [];
    if (review.id !== undefined) placed.add(review.id);
    return [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        account: accountOf(review.user),
        state,
        ...words,
        at: timeOf(review.submitted_at) ?? 0,
        url: review.html_url ?? pageUrl,
        threads,
        reactions: reactionsAt(read.reviewReactions, review.id),
        subject: review.node_id,
      },
    ];
  });
  const unplaced = read.threads
    .filter((thread) => thread.reviewId === null || !placed.has(thread.reviewId))
    .map((thread) => threadEntryOf(thread, pageUrl));
  const entries = [...said, ...reviewed, ...unplaced].sort((a, b) => a.at - b.at);
  const conversation = entries.slice(-OVERVIEW_BOUNDS.MAX_ENTRIES);
  return { conversation, earlier: entries.length - conversation.length + read.left };
}

const OPEN_PULL_REQUESTS_QUERY = `query OpenPullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${STACK_CANDIDATES}, after: $after) {
      nodes { number title url isDraft headRefName baseRefName isCrossRepository mergeQueueEntry { position } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const OpenPullRequestsAnswerSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequests: Schema.Struct({
              nodes: Schema.Array(
                Schema.NullOr(
                  Schema.Struct({
                    number: Schema.Number,
                    title: Schema.String,
                    url: Schema.String,
                    isDraft: Schema.Boolean,
                    headRefName: Schema.String,
                    baseRefName: Schema.String,
                    isCrossRepository: Schema.Boolean,
                    mergeQueueEntry: Schema.optional(
                      Schema.NullOr(Schema.Struct({ position: Schema.Number })),
                    ),
                  }),
                ),
              ),
              pageInfo: Schema.Struct({
                hasNextPage: Schema.Boolean,
                endCursor: Schema.NullOr(Schema.String),
              }),
            }),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

type OpenPullRequestNodes = NonNullable<
  NonNullable<NonNullable<typeof OpenPullRequestsAnswerSchema.Type.data>["repository"]>
>["pullRequests"]["nodes"];

function candidatesOf(nodes: OpenPullRequestNodes): readonly StackCandidate[] {
  return nodes.flatMap((node) =>
    node === null
      ? []
      : [
          {
            number: node.number,
            title: node.title,
            url: node.url,
            draft: node.isDraft,
            head: node.headRefName,
            base: node.baseRefName,
            crossRepository: node.isCrossRepository,
            ...(node.mergeQueueEntry == null || node.isDraft ? undefined : { queued: true }),
          },
        ],
  );
}

function openPullRequestsOf(
  token: Redacted.Redacted,
  fullName: string,
): Effect.Effect<readonly StackCandidate[] | undefined, never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const page = (
    after: string | null,
    held: readonly StackCandidate[],
    pages: number,
  ): Effect.Effect<
    readonly StackCandidate[] | undefined,
    PullRequestReadFailure,
    HttpClient.HttpClient
  > => {
    const request = githubPost(GRAPHQL_PATH, token, {
      query: OPEN_PULL_REQUESTS_QUERY,
      variables: { owner, name, after },
    });
    return Effect.scoped(
      Effect.flatMap(send(request), (response) => readBody(response, OpenPullRequestsAnswerSchema)),
    ).pipe(
      Effect.flatMap((answer) => {
        const listed = answer.data?.repository?.pullRequests;
        if (listed === undefined) {
          return Effect.as(
            Effect.logWarning(
              `GitHub answered no open pull requests of the repository (${answer.errors?.length ?? 0} errors)`,
            ),
            undefined,
          );
        }
        const read = [...held, ...candidatesOf(listed.nodes)];
        const { hasNextPage, endCursor } = listed.pageInfo;
        if (!hasNextPage || endCursor === null) return Effect.succeed(read);
        if (pages + 1 >= STACK_PAGES) {
          return Effect.as(
            Effect.logWarning(`the repository holds more open pull requests than a stack reads`),
            undefined,
          );
        }
        return page(endCursor, read, pages + 1);
      }),
    );
  };
  return page(null, [], 0).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`the repository's open pull requests were not read: ${failure._tag}`),
        undefined,
      ),
    ),
  );
}

export const pullRequestOverview = /* @__PURE__ */ Effect.fn("web/pullRequestOverview")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
  stacked: boolean,
): Effect.fn.Return<
  Option.Option<GitHubOverviewPullRequest>,
  PullRequestReadFailure,
  HttpClient.HttpClient
> {
  const path = `${repositoryPath(fullName)}/pulls/${number}`;
  const [read, open] = yield* Effect.all(
    [
      readOptional(withRendering(githubRead(path, token)), OverviewPullSchema),
      stacked ? openPullRequestsOf(token, fullName) : Effect.succeed(undefined),
    ],
    { concurrency: "unbounded" },
  );
  if (Option.isNone(read)) return Option.none();
  const pull = read.value;
  const pullRequest = pullRequestOf(pull);
  const current: StackCandidate = {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    draft: pullRequest.state === PULL_REQUEST_STATE.DRAFT,
    head: pull.head.ref,
    base: pull.base.ref,
    crossRepository: pull.head.repo?.id !== pull.base.repo?.id,
    ...(open?.some((each) => each.number === pullRequest.number && each.queued === true)
      ? { queued: true }
      : undefined),
  };
  const stands =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  const forkOwner = current.crossRepository ? pull.head.repo?.owner?.login : undefined;
  return Option.some({
    pullRequest,
    body: pull.body ?? "",
    html: pull.body_html?.trim() ?? "",
    base: nameOf(pull.base.ref),
    head: nameOf(pull.head.ref),
    ...(forkOwner === undefined ? undefined : { headOwner: nameOf(forkOwner) }),
    createdAt: timeOf(pull.created_at) ?? 0,
    mergedAt: timeOf(pull.merged_at),
    merge: GITHUB_MERGE_STATE.get(pull.mergeable_state ?? "") ?? MERGE_STATE.UNKNOWN,
    author: pull.user === null ? undefined : accountOf(pull.user),
    requested: distinctAccounts((pull.requested_reviewers ?? []).map(accountOf)),
    requestedTeams: (pull.requested_teams ?? [])
      .map(({ slug, name }) => ({ slug: nameOf(slug), name }))
      .slice(0, CHANGES_BOUNDS.MAX_PEOPLE),
    labels: (pull.labels ?? []).slice(0, OVERVIEW_BOUNDS.MAX_LABELS),
    stack: stands && open !== undefined ? stackOf(current, open) : [],
  });
});

export const pullRequestConversation = /* @__PURE__ */ Effect.fn("web/pullRequestConversation")(
  function* <R = never>(
    token: Redacted.Redacted,
    fullName: string,
    pullRequest: { readonly number: number; readonly url: string },
    viewer: Effect.Effect<ViewerReactions | undefined, never, R> = Effect.succeed(undefined),
  ): Effect.fn.Return<
    GitHubOverviewConversation,
    PullRequestReadFailure,
    HttpClient.HttpClient | R
  > {
    const { number } = pullRequest;
    const viewing = yield* Effect.forkChild(viewer);
    const [comments, reviews, graph] = yield* Effect.all(
      [
        everyPage(
          token,
          `${repositoryPath(fullName)}/issues/${number}/comments`,
          IssueCommentsSchema,
          COMMENTS_MAX_PAGES,
          true,
        ),
        everyPage(
          token,
          `${repositoryPath(fullName)}/pulls/${number}/reviews`,
          ReviewsSchema,
          PEOPLE_MAX_PAGES.REVIEWS,
          true,
        ),
        conversationGraphOf(token, fullName, number),
      ],
      { concurrency: "unbounded" },
    );
    const viewed = yield* Fiber.join(viewing).pipe(
      Effect.timeoutOption(VIEWER_GRACE),
      Effect.map(Option.getOrUndefined),
    );
    const kept = conversationOf(comments, reviews, graph, pullRequest.url);
    const mark = viewerMarks(viewed);
    return {
      reviewers: reviewersOf(reviews, []),
      earlier: kept.earlier,
      conversation: kept.conversation.map(({ threads, reactions, subject, ...entry }) => ({
        ...entry,
        subject,
        reactions: mark(subject, reactions),
        threads: threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((comment) => ({
            ...comment,
            reactions: mark(comment.subject, comment.reactions),
          })),
        })),
      })),
      descriptionReactions: mark(graph.descriptionSubject, graph.descriptionReactions),
      descriptionSubject: graph.descriptionSubject,
    };
  },
);

const VIEWER_GRACE = Duration.millis(750);

function viewerMarks(
  viewer: ViewerReactions | undefined,
): (
  subject: string | undefined,
  reactions: readonly GitHubReaction[],
) => readonly GitHubReaction[] {
  return (subject, reactions) => {
    const given = subject === undefined ? undefined : viewer?.get(subject);
    if (given === undefined) return reactions;
    return reactions.map((reaction) => ({ ...reaction, mine: given.has(reaction.content) }));
  };
}

const ViewerGroupsSchema = Schema.optionalKey(
  Schema.NullOr(
    Schema.Array(Schema.Struct({ content: Schema.String, viewerHasReacted: Schema.Boolean })),
  ),
);

const ViewedSchema = Schema.Struct({ id: Schema.String, reactionGroups: ViewerGroupsSchema });

const ViewedListSchema = Schema.optionalKey(
  Schema.Struct({ nodes: Schema.Array(Schema.NullOr(ViewedSchema)) }),
);

const VIEWER_REACTIONS_QUERY = `query ViewerReactions($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id
      reactionGroups { content viewerHasReacted }
      comments(last: ${OVERVIEW_BOUNDS.MAX_ENTRIES}) {
        nodes { id reactionGroups { content viewerHasReacted } }
      }
      reviews(last: ${OVERVIEW_BOUNDS.MAX_ENTRIES}) {
        nodes { id reactionGroups { content viewerHasReacted } }
      }
      reviewThreads(last: ${OVERVIEW_BOUNDS.MAX_THREADS}) {
        nodes {
          comments(first: ${OVERVIEW_BOUNDS.MAX_THREAD_COMMENTS}) {
            nodes { id reactionGroups { content viewerHasReacted } }
          }
        }
      }
    }
  }
}`;

const ViewerAnswerSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(
              Schema.Struct({
                id: Schema.String,
                reactionGroups: ViewerGroupsSchema,
                comments: ViewedListSchema,
                reviews: ViewedListSchema,
                reviewThreads: Schema.optionalKey(
                  Schema.Struct({
                    nodes: Schema.Array(
                      Schema.NullOr(Schema.Struct({ comments: ViewedListSchema })),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
});

function givenOf(groups: (typeof ViewedSchema.Type)["reactionGroups"]): ReadonlySet<Reaction> {
  return new Set(
    (groups ?? []).flatMap((group) => {
      const content = GRAPHQL_REACTION.get(group.content);
      return group.viewerHasReacted && content !== undefined ? [content] : [];
    }),
  );
}

export function viewerReactionsOf(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<ViewerReactions | undefined, never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost(GRAPHQL_PATH, token, {
    query: VIEWER_REACTIONS_QUERY,
    variables: { owner, name, number },
  });
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, ViewerAnswerSchema)),
  ).pipe(
    Effect.map((answer) => {
      const pullRequest = answer.data?.repository?.pullRequest;
      if (pullRequest == null) return undefined;
      const viewed = [
        ...(pullRequest.comments?.nodes ?? []),
        ...(pullRequest.reviews?.nodes ?? []),
        ...(pullRequest.reviewThreads?.nodes ?? []).flatMap(
          (thread) => thread?.comments?.nodes ?? [],
        ),
      ];
      const given = new Map<string, ReadonlySet<Reaction>>([
        [pullRequest.id, givenOf(pullRequest.reactionGroups)],
      ]);
      for (const node of viewed)
        if (node !== null) given.set(node.id, givenOf(node.reactionGroups));
      return given;
    }),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `the member's own reactions on pull request ${number} were not read: ${failure._tag}`,
        ),
        undefined,
      ),
    ),
  );
}

const DEPLOYMENTS_ASKED = 100;

const DEPLOYMENTS_QUERY = `query Deployments($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(last: 1) {
        nodes {
          commit {
            deployments(first: ${DEPLOYMENTS_ASKED}, orderBy: { field: CREATED_AT, direction: DESC }) {
              nodes {
                environment
                state
                creator { avatarUrl }
                latestStatus { state environmentUrl }
              }
            }
          }
        }
      }
    }
  }
}`;

const DeploymentSchema = Schema.Struct({
  environment: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  creator: Schema.NullOr(Schema.Struct({ avatarUrl: Schema.String })),
  latestStatus: Schema.NullOr(
    Schema.Struct({ state: Schema.String, environmentUrl: Schema.NullOr(Schema.String) }),
  ),
});

const DeploymentsAnswerSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(
              Schema.Struct({
                commits: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.NullOr(
                      Schema.Struct({
                        commit: Schema.Struct({
                          deployments: Schema.NullOr(
                            Schema.Struct({ nodes: Schema.Array(Schema.NullOr(DeploymentSchema)) }),
                          ),
                        }),
                      }),
                    ),
                  ),
                }),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
});

const GITHUB_DEPLOYMENT_STATE = new Map<string, DeploymentState>([
  ["SUCCESS", DEPLOYMENT_STATE.READY],
  ["ACTIVE", DEPLOYMENT_STATE.READY],
  ["FAILURE", DEPLOYMENT_STATE.FAILED],
  ["ERROR", DEPLOYMENT_STATE.FAILED],
  ["INACTIVE", DEPLOYMENT_STATE.INACTIVE],
  ["DESTROYED", DEPLOYMENT_STATE.INACTIVE],
  ["ABANDONED", DEPLOYMENT_STATE.INACTIVE],
]);

function deploymentUrlOf(spelled: string | null | undefined): string | null {
  if (spelled === null || spelled === undefined) return null;
  try {
    return new URL(spelled).protocol === "https:" ? spelled : null;
  } catch {
    return null;
  }
}

function deploymentOf(node: typeof DeploymentSchema.Type): PullRequestDeployment | undefined {
  if (node.environment === null || node.environment === "") return undefined;
  const spelled = node.latestStatus?.state ?? node.state ?? "";
  const deployment: PullRequestDeployment = {
    environment: nameOf(node.environment),
    state: GITHUB_DEPLOYMENT_STATE.get(spelled) ?? DEPLOYMENT_STATE.PENDING,
    url: deploymentUrlOf(node.latestStatus?.environmentUrl),
  };
  const avatarUrl = githubAvatarUrl(node.creator?.avatarUrl);
  return avatarUrl === undefined ? deployment : { ...deployment, avatarUrl };
}

function newestOfEach(
  deployments: readonly PullRequestDeployment[],
): readonly PullRequestDeployment[] {
  const seen = new Set<string>();
  return deployments
    .filter((deployment) => {
      if (seen.has(deployment.environment)) return false;
      seen.add(deployment.environment);
      return true;
    })
    .slice(0, OVERVIEW_BOUNDS.MAX_DEPLOYMENTS);
}

export function pullRequestDeployments(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<readonly PullRequestDeployment[], never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost(GRAPHQL_PATH, token, {
    query: DEPLOYMENTS_QUERY,
    variables: { owner, name, number },
  });
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, DeploymentsAnswerSchema)),
  ).pipe(
    Effect.flatMap((answer) => {
      const head = answer.data?.repository?.pullRequest?.commits.nodes.at(-1);
      const listed = head?.commit.deployments;
      if (listed === undefined || listed === null) {
        return Effect.as(
          Effect.logWarning(
            `GitHub answered no deployments of pull request ${number} (${answer.errors?.length ?? 0} errors)`,
          ),
          [],
        );
      }
      const deployments = listed.nodes.flatMap((node) =>
        node === null ? [] : (deploymentOf(node) ?? []),
      );
      return Effect.succeed(newestOfEach(deployments));
    }),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `the deployments of pull request ${number} were not read: ${failure._tag}`,
        ),
        [],
      ),
    ),
  );
}

interface GitHubPendingComment {
  readonly id: string;
  readonly threadId: string | undefined;
  readonly account: GitHubAccount;
  readonly path: string;
  readonly line: number | null;
  readonly startLine: number | null;
  readonly side: DiffSide;
  readonly startSide: DiffSide | null;
  readonly html: string | null;
  readonly body: string;
  readonly at: number;
}

export interface ViewerPendingReview {
  readonly comments: number;
  readonly drafts: readonly GitHubPendingComment[];
}

const VIEWER_PENDING_READ = 10;

const VIEWER_PENDING_QUERY = `query ViewerPendingReview($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(states: PENDING, first: ${VIEWER_PENDING_READ}) {
        nodes { id viewerDidAuthor comments { totalCount } }
      }
      reviewThreads(last: ${OVERVIEW_BOUNDS.MAX_THREADS}) {
        nodes {
          id path line startLine diffSide startDiffSide
          opening: comments(first: 1) { nodes { state } }
          comments(last: ${OVERVIEW_BOUNDS.MAX_THREAD_COMMENTS}) {
            nodes {
              id state body bodyHTML createdAt
              author { __typename login avatarUrl ... on User { databaseId } ... on Bot { databaseId } }
              pullRequestReview { id }
            }
          }
        }
      }
    }
  }
}`;

const GraphQLSideSchema = Schema.Literals(["LEFT", "RIGHT"]);

const ViewerPendingAnswerSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(
              Schema.Struct({
                reviews: Schema.Struct({
                  nodes: Schema.Array(
                    Schema.NullOr(
                      Schema.Struct({
                        id: Schema.String,
                        viewerDidAuthor: Schema.Boolean,
                        comments: Schema.Struct({ totalCount: Schema.Number }),
                      }),
                    ),
                  ),
                }),
                reviewThreads: Schema.optionalKey(
                  Schema.Struct({
                    nodes: Schema.Array(
                      Schema.NullOr(
                        Schema.Struct({
                          id: Schema.String,
                          path: Schema.String,
                          line: Schema.NullOr(Schema.Number),
                          startLine: Schema.NullOr(Schema.Number),
                          diffSide: GraphQLSideSchema,
                          startDiffSide: Schema.NullOr(GraphQLSideSchema),
                          opening: Schema.optionalKey(
                            Schema.Struct({
                              nodes: Schema.Array(
                                Schema.NullOr(Schema.Struct({ state: Schema.String })),
                              ),
                            }),
                          ),
                          comments: Schema.Struct({
                            nodes: Schema.Array(
                              Schema.NullOr(
                                Schema.Struct({
                                  id: Schema.String,
                                  state: Schema.String,
                                  body: Schema.String,
                                  bodyHTML: Schema.optionalKey(Schema.NullOr(Schema.String)),
                                  createdAt: Schema.String,
                                  author: Schema.NullOr(
                                    Schema.Struct({
                                      __typename: Schema.String,
                                      login: Schema.String,
                                      avatarUrl: Schema.optionalKey(Schema.String),
                                      databaseId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
                                    }),
                                  ),
                                  pullRequestReview: Schema.NullOr(
                                    Schema.Struct({ id: Schema.String }),
                                  ),
                                }),
                              ),
                            ),
                          }),
                        }),
                      ),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
});

type PendingAnswerPull = NonNullable<
  NonNullable<NonNullable<typeof ViewerPendingAnswerSchema.Type.data>["repository"]>["pullRequest"]
>;

const SIDE_OF_GRAPHQL = { LEFT: DIFF_SIDE.LEFT, RIGHT: DIFF_SIDE.RIGHT } as const satisfies Record<
  "LEFT" | "RIGHT",
  DiffSide
>;

const PENDING_STATE = "PENDING";

function pendingCommentsOf(pull: PendingAnswerPull, reviewId: string): GitHubPendingComment[] {
  const drafts = (pull.reviewThreads?.nodes ?? []).flatMap((thread) => {
    if (thread === null) return [];
    const side = SIDE_OF_GRAPHQL[thread.diffSide];
    const startSide = thread.startDiffSide === null ? null : SIDE_OF_GRAPHQL[thread.startDiffSide];
    const oneLine = thread.startLine === thread.line && (startSide === null || startSide === side);
    const published = [...(thread.opening?.nodes ?? []), ...thread.comments.nodes].some(
      (each) => each !== null && each.state !== PENDING_STATE,
    );
    return thread.comments.nodes.flatMap((comment) => {
      if (comment?.state !== PENDING_STATE || comment.pullRequestReview?.id !== reviewId) return [];
      const author = comment.author;
      const account: GitHubAccount = {
        id: author?.databaseId ?? 0,
        login: author?.login ?? "",
        bot: author?.__typename === GITHUB_BOT_TYPE,
        avatarUrl: githubAvatarUrl(author?.avatarUrl),
      };
      return [
        {
          id: comment.id,
          threadId: published ? thread.id : undefined,
          account,
          path: thread.path,
          line: thread.line,
          startLine: oneLine ? null : thread.startLine,
          side,
          startSide: oneLine ? null : startSide,
          html: comment.bodyHTML ?? null,
          body: comment.body,
          at: timeOf(comment.createdAt) ?? 0,
        },
      ];
    });
  });
  return drafts.toSorted((a, b) => a.at - b.at).slice(0, OVERVIEW_BOUNDS.MAX_PENDING_COMMENTS);
}

export function viewerPendingReviewOf(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<ViewerPendingReview | null, never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost(GRAPHQL_PATH, token, {
    query: VIEWER_PENDING_QUERY,
    variables: { owner, name, number },
  });
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, ViewerPendingAnswerSchema)),
  ).pipe(
    Effect.map((answer) => {
      const pull = answer.data?.repository?.pullRequest;
      const own = pull?.reviews.nodes.find((node) => node?.viewerDidAuthor === true);
      if (pull == null || own == null) return null;
      return { comments: own.comments.totalCount, drafts: pendingCommentsOf(pull, own.id) };
    }),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `the member's own pending review on pull request ${number} was not read: ${failure._tag}`,
        ),
        null,
      ),
    ),
  );
}

const VIEWER_CAN_UPDATE_QUERY = `query ViewerCanUpdate($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { viewerCanUpdate } }
}`;

const ViewerCanUpdateAnswerSchema = Schema.Struct({
  data: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        repository: Schema.NullOr(
          Schema.Struct({
            pullRequest: Schema.NullOr(Schema.Struct({ viewerCanUpdate: Schema.Boolean })),
          }),
        ),
      }),
    ),
  ),
});

export function viewerCanUpdateOf(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<boolean, never, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const request = githubPost(GRAPHQL_PATH, token, {
    query: VIEWER_CAN_UPDATE_QUERY,
    variables: { owner, name, number },
  });
  return Effect.scoped(
    Effect.flatMap(send(request), (response) => readBody(response, ViewerCanUpdateAnswerSchema)),
  ).pipe(
    Effect.map((answer) => answer.data?.repository?.pullRequest?.viewerCanUpdate === true),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `whether the member may edit pull request ${number} was not read: ${failure._tag}`,
        ),
        false,
      ),
    ),
  );
}

const LabelsSchema = Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String }));

const AssigneesSchema = Schema.Array(GitHubAccountSchema);

const TeamsSchema = Schema.Array(TeamSchema);

const OPTIONS_MAX_PAGES = Math.ceil(OVERVIEW_BOUNDS.MAX_OPTIONS / PEOPLE_PER_PAGE);

export interface GitHubReviewOptions {
  readonly labels: readonly GitHubLabel[];
  readonly users: readonly GitHubAccount[];
  readonly teams: readonly GitHubTeam[];
}

function optionsListing<A>(
  token: Redacted.Redacted,
  path: string,
  schema: Schema.Codec<readonly A[], unknown>,
  what: string,
): Read<readonly A[]> {
  return everyPage(token, path, schema, OPTIONS_MAX_PAGES).pipe(
    Effect.map((listed) => listed.slice(0, OVERVIEW_BOUNDS.MAX_OPTIONS)),
    Effect.catch((failure) =>
      failure.status === GITHUB_HTTP_STATUS.FORBIDDEN
        ? Effect.as(Effect.logWarning(`the App may not read the repository's ${what}`), [])
        : Effect.fail(failure),
    ),
  );
}

export const pullRequestReviewOptions = /* @__PURE__ */ Effect.fn("web/pullRequestReviewOptions")(
  function* (
    token: Redacted.Redacted,
    fullName: string,
  ): Effect.fn.Return<GitHubReviewOptions, PullRequestReadFailure, HttpClient.HttpClient> {
    const path = repositoryPath(fullName);
    const [labels, users, teams] = yield* Effect.all(
      [
        optionsListing(token, `${path}/labels`, LabelsSchema, "labels"),
        optionsListing(token, `${path}/assignees`, AssigneesSchema, "assignees"),
        optionsListing(token, `${path}/teams`, TeamsSchema, "teams"),
      ],
      { concurrency: "unbounded" },
    );
    return {
      labels,
      users: users.map(accountOf),
      teams: teams.map(({ slug, name }) => ({ slug: nameOf(slug), name })),
    };
  },
);
