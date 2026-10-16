/**
 * pull-requests.ts -- what a coding agent published, as GitHub holds it: a pull request by number or by its branch, a branch, the checks on a head, and a pull request's changed files.
 *
 * Every read runs on an installation token the App minted for the agent's
 * one repository on its workspace's installation (`github-app.ts`'s
 * `repositoryPullRequestToken`), the same reach that admits the agent's
 * checkout: the installation's own permissions bound it. A link to a pull
 * request reads it by number on the same mint, for a repository its
 * workspace's installation reaches (`github-repositories-app.ts`). The requests
 * compose over the App module's own kit (`githubRead`, `send`, `readBody`)
 * so a token leaves this module no more than it leaves that one. The checks are read as one word for a dot: GitHub's
 * check runs and its older commit statuses together, since a workflow
 * reports as the one and a deployment may report as the other, and a
 * repository where the App may read neither reads as having none, with a
 * warning, rather than failing the whole answer. A pull request's files
 * are read a hundred to a page up to the changes bound, each with its
 * patch where GitHub sends one; GitHub sends none for a file that is not
 * text, which it counts as changing no line, or for one whose patch is too
 * large to send, and the file says which rather than reading as unchanged.
 * Who a pull request names is read beside its files: who opened it, its
 * reviewers and where each stands, who authored its commits, and its
 * reviews that said something, each the first page GitHub answers.
 * A pull request's overview, which its Pull request tab draws, is read in
 * one go: the pull request whole, its description and its mergeability
 * among it, then at once every check on its head, one by one, its comments,
 * and its reviews, the two made one conversation in time order.
 */

import { githubAvatarUrl, githubUserAvatarUrl } from "@luke/features/account-picture";
import {
  CHANGED_FILE_STATUS,
  CHANGES_BOUNDS,
  CHECK_STATE,
  CHECK_SUMMARY,
  type ChangedFileStatus,
  type CheckState,
  type CheckSummary,
  CONVERSATION_ENTRY,
  type CodingAgentChangedFile,
  MERGE_STATE,
  type MergeState,
  OVERVIEW_BOUNDS,
  PATCH_OMITTED,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestState,
  REVIEW_STATE,
  type ReviewState,
} from "@luke/features/coding-agent-wire";
import { Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  GITHUB_HTTP_STATUS,
  type GitHubUnavailable,
  githubRead,
  readBody,
  send,
} from "./github-app.js";

/** A pull request as much as the agent's pill and its summary row draw: where it stands, its head, and its size. */
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
}

/** What a read fails with: GitHub unreachable or answering off its shape. */
export type PullRequestReadFailure = GitHubUnavailable;

type Read<A> = Effect.Effect<A, PullRequestReadFailure, HttpClient.HttpClient>;

/** GitHub's own two words for an open or closed pull request. */
const GITHUB_PULL_STATE = { OPEN: "open", CLOSED: "closed" } as const;

/** How many pull requests of a branch are asked for: the newest alone, since a branch has at most one open and the newest is the one that stands for it. */
const NEWEST_ONE = "1";
const SORT = { CREATED: "created", DESCENDING: "desc" } as const;
const ANY_STATE = "all";

/** GitHub pages check runs and statuses a hundred to a page; a head with more is read as its first hundred. */
const CHECKS_PER_PAGE = "100";

/** A check run's conclusion that reads as failing; every other conclusion, neutral and skipped among them, does not. */
const FAILING_CONCLUSIONS: ReadonlySet<string> = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

/** A commit status's state that reads as failing. */
const FAILING_STATUS_STATES: ReadonlySet<string> = new Set(["failure", "error"]);

/** The one check-run status that has ended; the others are queued or in progress. */
const COMPLETED = "completed";
const PENDING_STATUS_STATE = "pending";

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
});

/** A pull request as a listing spells it, read for its number alone: the listing carries no sizes. */
const ListedPullRequestSchema = Schema.Struct({ number: Schema.Number });
const ListedPullRequestsSchema = Schema.Array(ListedPullRequestSchema);

const CheckRunsSchema = Schema.Struct({
  check_runs: Schema.Array(
    Schema.Struct({ status: Schema.String, conclusion: Schema.NullOr(Schema.String) }),
  ),
});

/** GitHub pages a pull request's files a hundred to a page. */
const FILES_PER_PAGE = 100;

/** GitHub's own words for what became of a file; any it adds reads as changed in place. */
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
  }),
);

const CombinedStatusSchema = Schema.Struct({
  statuses: Schema.Array(Schema.Struct({ state: Schema.String })),
});

/** A GitHub account as a pull request, a review, or a commit names it. */
const GitHubAccountSchema = Schema.Struct({
  login: Schema.String,
  id: Schema.Number,
  type: Schema.String,
  avatar_url: Schema.optionalKey(Schema.String),
});

/** A pull request read for who it names: who opened it, and who it still asks for a review. */
const PullRequestPeopleSchema = Schema.Struct({
  user: Schema.NullOr(GitHubAccountSchema),
  requested_reviewers: Schema.optionalKey(Schema.Array(GitHubAccountSchema)),
});

/** A pull request's reviews, oldest first, as GitHub lists them. */
const ReviewsSchema = Schema.Array(
  Schema.Struct({
    user: Schema.NullOr(GitHubAccountSchema),
    state: Schema.String,
    body: Schema.NullOr(Schema.String),
    submitted_at: Schema.optionalKey(Schema.NullOr(Schema.String)),
    html_url: Schema.optionalKey(Schema.String),
  }),
);

/** A pull request's commits, as GitHub lists them: the GitHub account each is by, where GitHub links its address to one. */
/** A pull request's commits, as much of each as names who made it: its author's account, and its message for the co-authors it names. */
const CommitsSchema = Schema.Array(
  Schema.Struct({
    author: Schema.NullOr(GitHubAccountSchema),
    commit: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  }),
);

/**
 * A `Co-authored-by` trailer naming an account by the noreply address
 * GitHub links to it, `<id>+<login>@users.noreply.github.com`, which is how
 * a coding agent that writes as its developer names the Luke GitHub App's
 * bot beside them; a trailer at any other address names no account GitHub
 * would show, and is left unread.
 */
const CO_AUTHOR_TRAILER =
  /^co-authored-by:[^<\n]*<(\d+)\+([^@>\s]+)@users\.noreply\.github\.com>\s*$/gimu;

/** GitHub's own words for a review's standing; a pending review is its author's draft, which nobody else sees. */
const GITHUB_REVIEW_STATE = new Map<string, ReviewState>([
  ["APPROVED", REVIEW_STATE.APPROVED],
  ["CHANGES_REQUESTED", REVIEW_STATE.CHANGES_REQUESTED],
  ["DISMISSED", REVIEW_STATE.DISMISSED],
  ["COMMENTED", REVIEW_STATE.COMMENTED],
]);

/** The kind GitHub gives an App's own bot account. */
const GITHUB_BOT_TYPE = "Bot";

/** The suffix GitHub gives an App's bot's login. */
const BOT_LOGIN_SUFFIX = "[bot]";

/** How many reviews and commits a page asks for: GitHub's most. */
const PEOPLE_PER_PAGE = 100;

/**
 * The most pages each listing is read to. GitHub lists a pull request's
 * reviews oldest first, and a reviewer stands by their newest, so its
 * reviews are read to their end, bounded only where no pull request goes,
 * three thousand reviews, rather than holding the changes on a history that
 * does not end; GitHub lists at most 250 commits of a pull request, so three
 * pages hold every one.
 */
const PEOPLE_MAX_PAGES = { REVIEWS: 30, COMMITS: 3 } as const;

/** A path segment as GitHub takes it, so a branch spelled with a slash stays one branch. */
function segment(value: string): string {
  return encodeURIComponent(value);
}

/** The repository's own path under the API, each half a segment of its own. */
function repositoryPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${segment(owner)}/${segment(name)}`;
}

/** One read sent on the token, its answer read and closed; not found is none, and any other status the status it is. */
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

function pullRequestOf(record: typeof PullRequestSchema.Type): GitHubPullRequest {
  const state = record.merged
    ? PULL_REQUEST_STATE.MERGED
    : record.state === GITHUB_PULL_STATE.CLOSED
      ? PULL_REQUEST_STATE.CLOSED
      : record.draft
        ? PULL_REQUEST_STATE.DRAFT
        : PULL_REQUEST_STATE.OPEN;
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
  };
}

/** One pull request of the repository by number, whole; none where the repository has no such one. */
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

/**
 * The newest pull request whose head is the branch, open or not, read
 * whole; none where the branch has had none. The listing names the number
 * and the number names the rest, since the sizes travel only on the one.
 */
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

/** Whether the repository holds the branch now. */
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

/** What one set of outcomes says: failing beats pending beats passing, and nothing at all is none. */
interface CheckTally {
  readonly failing: boolean;
  readonly pending: boolean;
  readonly any: boolean;
}

function summaryOf(tally: CheckTally): CheckSummary {
  if (tally.failing) return CHECK_SUMMARY.FAILING;
  if (tally.pending) return CHECK_SUMMARY.PENDING;
  return tally.any ? CHECK_SUMMARY.PASSING : CHECK_SUMMARY.NONE;
}

/** A head's checks read as one answer, or as none where the App may not read them, said once in the log. */
function readChecks<A>(
  what: string,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
  tally: (answer: A) => CheckTally,
): Read<CheckTally> {
  const none: CheckTally = { failing: false, pending: false, any: false };
  return Effect.scoped(
    Effect.flatMap(send(request), (response: HttpClientResponse.HttpClientResponse) => {
      if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Effect.succeed(none);
      if (response.status === GITHUB_HTTP_STATUS.FORBIDDEN) {
        return Effect.as(
          Effect.logWarning(
            `the GitHub App may not read a head's ${what}; the checks read as none`,
          ),
          none,
        );
      }
      return Effect.map(readBody(response, schema), tally);
    }),
  );
}

/** The checks on one head as one word: its check runs and its commit statuses together. */
export function checkSummaryOf(
  token: Redacted.Redacted,
  fullName: string,
  sha: string,
): Read<CheckSummary> {
  const commit = `${repositoryPath(fullName)}/commits/${segment(sha)}`;
  const perPage = HttpClientRequest.setUrlParams({ per_page: CHECKS_PER_PAGE });
  const runs = readChecks(
    "check runs",
    githubRead(`${commit}/check-runs`, token).pipe(perPage),
    CheckRunsSchema,
    (answer) => ({
      failing: answer.check_runs.some(
        (run) => run.conclusion !== null && FAILING_CONCLUSIONS.has(run.conclusion),
      ),
      pending: answer.check_runs.some((run) => run.status !== COMPLETED),
      any: answer.check_runs.length > 0,
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
    }),
  );
  return Effect.map(Effect.all([runs, statuses]), ([a, b]) =>
    summaryOf({
      failing: a.failing || b.failing,
      pending: a.pending || b.pending,
      any: a.any || b.any,
    }),
  );
}

/**
 * One file as GitHub lists it, as the wire carries it. A file GitHub sent
 * no patch for changed no line where it is not text, and was too large to
 * send otherwise; a patch past the bound is left out on the same terms. A
 * file moved and left as it was has no patch either, and changed no line,
 * so it carries an empty one rather than reading as binary.
 */
function changedFileOf(file: (typeof PullRequestFilesSchema.Type)[number]): CodingAgentChangedFile {
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
  };
}

/** A pull request's files as GitHub lists them, up to the changes bound, and whether there were more. */
export interface PullRequestFiles {
  readonly files: readonly CodingAgentChangedFile[];
  readonly truncated: boolean;
}

/**
 * The pull request's changed files, a page at a time until a page comes
 * back short or the bound is reached, cut short where the pull request
 * counts more files than were read; none where the repository has no such
 * pull request. `changedFiles` is the count the pull request's own read
 * answered.
 */
export const pullRequestFiles = /* @__PURE__ */ Effect.fn("web/pullRequestFiles")(function* (
  token: Redacted.Redacted,
  fullName: string,
  pullRequest: { readonly number: number; readonly changedFiles: number },
): Effect.fn.Return<PullRequestFiles, PullRequestReadFailure, HttpClient.HttpClient> {
  const files: CodingAgentChangedFile[] = [];
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

/** A GitHub account as the people a pull request names hold it: GitHub's id, its login, whether it is an App's bot, and its avatar where GitHub's avatar host serves it. */
export interface GitHubAccount {
  readonly id: number;
  readonly login: string;
  readonly bot: boolean;
  readonly avatarUrl: string | undefined;
}

/** A reviewer and where they stand. */
export interface GitHubReviewer {
  readonly account: GitHubAccount;
  readonly state: ReviewState;
}

/** A review that said something: who, where it left them, the start of its words, and when. */
export interface GitHubReviewComment {
  readonly account: GitHubAccount;
  readonly state: ReviewState;
  readonly excerpt: string;
  readonly at: number;
}

/** Who a pull request names: who opened it, its reviewers, who authored its commits or is named their co-author, and its reviews that said something, each up to the bound. */
export interface PullRequestPeople {
  readonly author: GitHubAccount | undefined;
  readonly reviewers: readonly GitHubReviewer[];
  readonly commitAuthors: readonly GitHubAccount[];
  readonly comments: readonly GitHubReviewComment[];
}

/** An account as GitHub records it, as the people hold it: a bot by its kind or its login's suffix. */
function accountOf(record: typeof GitHubAccountSchema.Type): GitHubAccount {
  return {
    id: record.id,
    login: record.login,
    bot: record.type === GITHUB_BOT_TYPE || record.login.endsWith(BOT_LOGIN_SUFFIX),
    avatarUrl: githubAvatarUrl(record.avatar_url),
  };
}

/**
 * The accounts a commit's message names as co-authors by their noreply
 * addresses, in the order it names them. Note that only the message's last
 * paragraph is read, because that is where git reads trailers from, so a
 * trailer-shaped line quoted in the body names nobody.
 */
function coAuthorsOf(message: string | undefined): readonly GitHubAccount[] {
  if (message === undefined) return [];
  const trailers =
    message
      .trimEnd()
      .split(/\n[ \t]*\n/u)
      .at(-1) ?? "";
  return [...trailers.matchAll(CO_AUTHOR_TRAILER)].map(([, id = "", login = ""]) => {
    const bot = login.endsWith(BOT_LOGIN_SUFFIX);
    // Note that a bot's id is served an identicon, not its App's picture, so a bot co-author keeps its robot.
    const avatarUrl = bot ? undefined : githubUserAvatarUrl({ id: Number(id) });
    return { id: Number(id), login, bot, avatarUrl };
  });
}

/** Each account once, the first time it stands, up to the bound. */
function distinctAccounts(accounts: readonly GitHubAccount[]): readonly GitHubAccount[] {
  const seen = new Map<number, GitHubAccount>();
  for (const account of accounts) if (!seen.has(account.id)) seen.set(account.id, account);
  return [...seen.values()].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
}

/** The start of a review's words, its runs of space one space, cut at the bound; the window fades what it cuts. */
function excerptOf(body: string): string {
  return body.replace(/\s+/gu, " ").trim().slice(0, CHANGES_BOUNDS.MAX_EXCERPT_CHARS).trimEnd();
}

/**
 * Where each reviewer stands, by their newest review that decides, else as
 * having commented; one the pull request still asks for a review stands
 * asked, as GitHub shows a re-requested reviewer, whatever they said before.
 */
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
    // Note that a comment after a decision leaves the decision standing, as GitHub reads it.
    if (state === REVIEW_STATE.COMMENTED && held !== undefined) continue;
    standing.set(account.id, { account, state });
  }
  for (const account of requested)
    standing.set(account.id, { account, state: REVIEW_STATE.REQUESTED });
  return [...standing.values()].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
}

/** The newest reviews that said something, up to the bound, oldest first; a draft review and one by nobody GitHub names are left out. */
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

/** No one: what a pull request the repository no longer holds names. */
const NOBODY: PullRequestPeople = {
  author: undefined,
  reviewers: [],
  commitAuthors: [],
  comments: [],
};

/** Every page of a listing, oldest first, until one comes back short or the bound is reached; none where the pull request is not found. */
const everyPage = /* @__PURE__ */ Effect.fnUntraced(function* <A>(
  token: Redacted.Redacted,
  path: string,
  schema: Schema.Codec<readonly A[], unknown>,
  maxPages: number,
) {
  const listed: A[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const request = githubRead(path, token).pipe(
      HttpClientRequest.setUrlParams({ per_page: String(PEOPLE_PER_PAGE), page: String(page) }),
    );
    const read = Option.getOrElse(yield* readOptional(request, schema), () => []);
    listed.push(...read);
    if (read.length < PEOPLE_PER_PAGE) break;
  }
  return listed;
});

/**
 * Who the pull request names, read on the token in three asks at once: the
 * pull request itself, for who opened it and who it still asks for a
 * review; every page of its reviews, since a reviewer stands by their
 * newest; and every page of its commits, since a later commit may be by
 * someone new, each commit naming its author and the co-authors its
 * message's trailers name by their noreply addresses. Each list is cut at the bound only once read whole. Nobody
 * where the repository holds no such pull request.
 */
export const pullRequestPeople = /* @__PURE__ */ Effect.fn("web/pullRequestPeople")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.fn.Return<PullRequestPeople, PullRequestReadFailure, HttpClient.HttpClient> {
  const path = `${repositoryPath(fullName)}/pulls/${number}`;
  const [pull, reviews, commits] = yield* Effect.all(
    [
      readOptional(githubRead(path, token), PullRequestPeopleSchema),
      everyPage(token, `${path}/reviews`, ReviewsSchema, PEOPLE_MAX_PAGES.REVIEWS),
      everyPage(token, `${path}/commits`, CommitsSchema, PEOPLE_MAX_PAGES.COMMITS),
    ],
    { concurrency: "unbounded" },
  );
  if (Option.isNone(pull)) return NOBODY;
  const requested = (pull.value.requested_reviewers ?? []).map(accountOf);
  return {
    author: pull.value.user === null ? undefined : accountOf(pull.value.user),
    reviewers: reviewersOf(reviews, requested),
    commitAuthors: distinctAccounts(
      commits.flatMap((commit) => [
        ...(commit.author === null ? [] : [accountOf(commit.author)]),
        ...coAuthorsOf(commit.commit?.message),
      ]),
    ),
    comments: commentsOf(reviews),
  };
});

/** A pull request read whole for its overview: what its pill says, and its description, branches, times, mergeability, and people. */
const OverviewPullSchema = Schema.Struct({
  ...PullRequestSchema.fields,
  body: Schema.NullOr(Schema.String),
  base: Schema.Struct({ ref: Schema.String }),
  created_at: Schema.String,
  merged_at: Schema.NullOr(Schema.String),
  mergeable_state: Schema.optionalKey(Schema.String),
  user: Schema.NullOr(GitHubAccountSchema),
  requested_reviewers: Schema.optionalKey(Schema.Array(GitHubAccountSchema)),
});

/** A head's check runs, each read for its row. */
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
      app: Schema.NullOr(Schema.Struct({ name: Schema.String })),
    }),
  ),
});

/** A head's commit statuses, the newest of each context, each read for its row. */
const ListedStatusesSchema = Schema.Struct({
  statuses: Schema.Array(
    Schema.Struct({
      context: Schema.String,
      state: Schema.String,
      target_url: Schema.NullOr(Schema.String),
      created_at: Schema.String,
      updated_at: Schema.String,
    }),
  ),
});

/** A pull request's comments, oldest first, as GitHub lists an issue's. */
const IssueCommentsSchema = Schema.Array(
  Schema.Struct({
    user: Schema.NullOr(GitHubAccountSchema),
    body: Schema.optionalKey(Schema.NullOr(Schema.String)),
    created_at: Schema.String,
    html_url: Schema.String,
  }),
);

/**
 * The most pages of a pull request's comments read. GitHub lists them
 * oldest first, so the newest are read by reading to the end, bounded where
 * no pull request goes, a thousand comments.
 */
const COMMENTS_MAX_PAGES = 10;

/** GitHub's own words for whether a pull request would merge; any it adds, and `unknown` itself, read as not yet worked out. */
const GITHUB_MERGE_STATE = new Map<string, MergeState>([
  ["clean", MERGE_STATE.CLEAN],
  ["has_hooks", MERGE_STATE.CLEAN],
  ["unstable", MERGE_STATE.UNSTABLE],
  ["blocked", MERGE_STATE.BLOCKED],
  ["behind", MERGE_STATE.BEHIND],
  ["dirty", MERGE_STATE.CONFLICTS],
  ["draft", MERGE_STATE.DRAFT],
]);

/** A check run's conclusions that pass nothing and fail nothing. */
const SKIPPED_CONCLUSIONS: ReadonlySet<string> = new Set(["skipped", "neutral", "stale"]);

const SUCCESS = "success";

/** A pull request's overview as GitHub holds it, every account as GitHub names it. */
export interface GitHubOverview {
  readonly pullRequest: GitHubPullRequest;
  readonly body: string;
  readonly base: string;
  readonly head: string;
  readonly createdAt: number;
  readonly mergedAt: number | null;
  readonly merge: MergeState;
  readonly checks: readonly PullRequestCheck[];
  readonly author: GitHubAccount | undefined;
  readonly reviewers: readonly GitHubReviewer[];
  readonly conversation: readonly GitHubConversationEntry[];
}

/** One entry of a pull request's conversation, its author as GitHub names them. */
export interface GitHubConversationEntry {
  readonly kind: (typeof CONVERSATION_ENTRY)[keyof typeof CONVERSATION_ENTRY];
  readonly account: GitHubAccount;
  readonly state: ReviewState | undefined;
  readonly body: string;
  readonly cut: boolean;
  readonly at: number;
  readonly url: string;
}

/** A time GitHub spells, in epoch milliseconds; none where it spells none or nothing a date reads. */
function timeOf(spelled: string | null | undefined): number | null {
  const at = Date.parse(spelled ?? "");
  return Number.isNaN(at) ? null : at;
}

/** A name cut to the bound a read carries. */
function nameOf(name: string): string {
  return name.slice(0, OVERVIEW_BOUNDS.MAX_NAME_CHARS);
}

/** Where a check run stands: running until it completes, then by its conclusion, a conclusion GitHub adds reading as failed. */
function runStateOf(status: string, conclusion: string | null): CheckState {
  if (status !== COMPLETED || conclusion === null) return CHECK_STATE.PENDING;
  if (conclusion === SUCCESS) return CHECK_STATE.PASSED;
  return SKIPPED_CONCLUSIONS.has(conclusion) ? CHECK_STATE.SKIPPED : CHECK_STATE.FAILED;
}

/** Where a commit status stands. */
function statusStateOf(state: string): CheckState {
  if (state === SUCCESS) return CHECK_STATE.PASSED;
  return FAILING_STATUS_STATES.has(state) ? CHECK_STATE.FAILED : CHECK_STATE.PENDING;
}

/** A head's checks one by one, as GitHub lists them: its check runs, then its commit statuses, up to the bound. */
function checksOf(
  token: Redacted.Redacted,
  fullName: string,
  sha: string,
): Read<readonly PullRequestCheck[]> {
  const commit = `${repositoryPath(fullName)}/commits/${segment(sha)}`;
  const perPage = HttpClientRequest.setUrlParams({ per_page: CHECKS_PER_PAGE });
  const runs = readListed(
    "check runs",
    githubRead(`${commit}/check-runs`, token).pipe(perPage),
    ListedCheckRunsSchema,
    (answer): readonly PullRequestCheck[] =>
      answer.check_runs.map((run) => ({
        name: nameOf(run.name),
        app: run.app === null ? null : nameOf(run.app.name),
        state: runStateOf(run.status, run.conclusion),
        url: run.html_url ?? run.details_url ?? null,
        startedAt: timeOf(run.started_at),
        completedAt: timeOf(run.completed_at),
      })),
  );
  const statuses = readListed(
    "commit statuses",
    githubRead(`${commit}/status`, token).pipe(perPage),
    ListedStatusesSchema,
    (answer): readonly PullRequestCheck[] =>
      answer.statuses.map((status) => {
        const state = statusStateOf(status.state);
        return {
          name: nameOf(status.context),
          app: null,
          state,
          url: status.target_url,
          startedAt: timeOf(status.created_at),
          completedAt: state === CHECK_STATE.PENDING ? null : timeOf(status.updated_at),
        };
      }),
  );
  return Effect.map(Effect.all([runs, statuses], { concurrency: "unbounded" }), ([a, b]) =>
    [...a, ...b].slice(0, OVERVIEW_BOUNDS.MAX_CHECKS),
  );
}

/** A head's checks of one kind, or none where the App may not read them, said once in the log. */
function readListed<A>(
  what: string,
  request: HttpClientRequest.HttpClientRequest,
  schema: Schema.Codec<A, unknown>,
  listed: (answer: A) => readonly PullRequestCheck[],
): Read<readonly PullRequestCheck[]> {
  return Effect.scoped(
    Effect.flatMap(send(request), (response: HttpClientResponse.HttpClientResponse) => {
      if (response.status === GITHUB_HTTP_STATUS.NOT_FOUND) return Effect.succeed([]);
      if (response.status === GITHUB_HTTP_STATUS.FORBIDDEN) {
        return Effect.as(
          Effect.logWarning(`the GitHub App may not read a head's ${what}; none are listed`),
          [],
        );
      }
      return Effect.map(readBody(response, schema), listed);
    }),
  );
}

/** An entry's words as a read carries them, and whether they were cut to fit. */
interface EntryWords {
  readonly body: string;
  readonly cut: boolean;
}

/** An entry's words cut to the bound, and whether they were. */
function wordsOf(body: string | null | undefined): EntryWords {
  const words = body?.trim() ?? "";
  const cut = words.length > OVERVIEW_BOUNDS.MAX_ENTRY_CHARS;
  return { body: cut ? words.slice(0, OVERVIEW_BOUNDS.MAX_ENTRY_CHARS) : words, cut };
}

/**
 * The conversation: every comment that says something and every review
 * that decides or says something, in time order, the newest kept up to the
 * bound. A review that only commented and said nothing is the wrapper
 * GitHub makes for comments on lines, which this read does not list, and a
 * draft review is its author's alone, so neither is an entry.
 */
function conversationOf(
  comments: typeof IssueCommentsSchema.Type,
  reviews: typeof ReviewsSchema.Type,
  pageUrl: string,
): readonly GitHubConversationEntry[] {
  const said = comments.flatMap((comment): GitHubConversationEntry[] => {
    const words = wordsOf(comment.body);
    if (comment.user === null || words.body === "") return [];
    return [
      {
        kind: CONVERSATION_ENTRY.COMMENT,
        account: accountOf(comment.user),
        state: undefined,
        ...words,
        at: timeOf(comment.created_at) ?? 0,
        url: comment.html_url,
      },
    ];
  });
  const reviewed = reviews.flatMap((review): GitHubConversationEntry[] => {
    const state = GITHUB_REVIEW_STATE.get(review.state);
    const words = wordsOf(review.body);
    if (review.user === null || state === undefined) return [];
    if (state === REVIEW_STATE.COMMENTED && words.body === "") return [];
    return [
      {
        kind: CONVERSATION_ENTRY.REVIEW,
        account: accountOf(review.user),
        state,
        ...words,
        at: timeOf(review.submitted_at) ?? 0,
        url: review.html_url ?? pageUrl,
      },
    ];
  });
  return [...said, ...reviewed].sort((a, b) => a.at - b.at).slice(-OVERVIEW_BOUNDS.MAX_ENTRIES);
}

/**
 * A pull request's overview, read on the token: the pull request whole,
 * then at once its head's checks, every page of its comments, and every
 * page of its reviews, which both name where each reviewer stands and join
 * its comments as its conversation. None where the repository holds no
 * such pull request.
 */
export const pullRequestOverview = /* @__PURE__ */ Effect.fn("web/pullRequestOverview")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.fn.Return<Option.Option<GitHubOverview>, PullRequestReadFailure, HttpClient.HttpClient> {
  const path = `${repositoryPath(fullName)}/pulls/${number}`;
  const read = yield* readOptional(githubRead(path, token), OverviewPullSchema);
  if (Option.isNone(read)) return Option.none();
  const pull = read.value;
  const [checks, comments, reviews] = yield* Effect.all(
    [
      checksOf(token, fullName, pull.head.sha),
      everyPage(
        token,
        `${repositoryPath(fullName)}/issues/${number}/comments`,
        IssueCommentsSchema,
        COMMENTS_MAX_PAGES,
      ),
      everyPage(token, `${path}/reviews`, ReviewsSchema, PEOPLE_MAX_PAGES.REVIEWS),
    ],
    { concurrency: "unbounded" },
  );
  const pullRequest = pullRequestOf(pull);
  return Option.some({
    pullRequest,
    body: (pull.body ?? "").slice(0, OVERVIEW_BOUNDS.MAX_BODY_CHARS),
    base: nameOf(pull.base.ref),
    head: nameOf(pull.head.ref),
    createdAt: timeOf(pull.created_at) ?? 0,
    mergedAt: timeOf(pull.merged_at),
    merge: GITHUB_MERGE_STATE.get(pull.mergeable_state ?? "") ?? MERGE_STATE.UNKNOWN,
    checks,
    author: pull.user === null ? undefined : accountOf(pull.user),
    reviewers: reviewersOf(reviews, (pull.requested_reviewers ?? []).map(accountOf)),
    conversation: conversationOf(comments, reviews, pullRequest.url),
  });
});
