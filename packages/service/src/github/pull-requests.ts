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
 * reviews that said something, each the first page GitHub answers. And a
 * review's inline comments are read, by file and line, for the message
 * that tells the agent on the pull request of that review (`agent-wakes.ts`).
 * A pull request's overview, which its Pull request tab draws, is read in
 * three reads that each land on their own, so the tab draws each part as it
 * lands rather than waiting on the slowest: the pull request whole, its
 * description and its mergeability among it; every check on its head, one
 * by one, read by the pull request's own head ref so it waits on no read of
 * the head's commit, and beside them its head's deployments in one GraphQL
 * read; and its comments, its reviews, and its review threads, made one
 * conversation in time order. The pull request's read carries its labels
 * as GitHub answers them, and, for one still open, the stack it stands in
 * (`pull-request-stack.ts`), worked out from GraphQL reads of the
 * repository's open pull requests asked beside it, so the stack costs no
 * wait.
 */

import {
  githubAppAvatarUrl,
  githubAvatarUrl,
  githubUserAvatarUrl,
} from "@luke/features/account-picture";
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
} from "@luke/features/coding-agent-wire";
import { githubImageOf, imageTypeOfPath } from "@luke/features/github-image";
import { REACTION, type Reaction } from "@luke/features/pull-request-write-wire";
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
import { type StackCandidate, type StackEntry, stackOf } from "./pull-request-stack.js";

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
  /** The login of who opened it, where GitHub named one, their avatar where GitHub's avatar host serves it, and whether they are an App's bot. */
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
  /** When it was opened, and when it was merged or closed where it was, as epoch milliseconds, where GitHub named them. */
  readonly openedAt?: number;
  readonly mergedAt?: number;
  readonly closedAt?: number;
  /** The branch it merges into, and that branch's head as GitHub last counted it, where GitHub named them. */
  readonly baseRef?: string;
  readonly baseSha?: string;
  /** Its labels, each by its name and its colour as GitHub's six hex digits. */
  readonly labels?: readonly GitHubLabel[];
  /** How many comments it holds, on its conversation and its diff together, where GitHub counted them. */
  readonly comments?: number;
  /** How many commits it holds, where GitHub counted them. */
  readonly commits?: number;
}

/** A label as GitHub names it: its name and its colour, six hex digits with no `#`. */
interface GitHubLabel {
  readonly name: string;
  readonly color: string;
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

/** Who opened a pull request or an issue, as GitHub names them on it: their login, and, where it sends them, their kind and their avatar. */
export const GitHubOpenerSchema = Schema.Struct({
  login: Schema.String,
  type: Schema.optional(Schema.String),
  avatar_url: Schema.optional(Schema.String),
});

/** Who opened a pull request or an issue, as its read names them: their login, their avatar where GitHub's avatar host serves it, and whether they are an App's bot; none of them where GitHub named no one. */
interface OpenerFields {
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
}

/** Who opened a pull request or an issue, as its link's card names them; nothing where GitHub named no one. */
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
  /** Who opened it; null where their account is gone. */
  user: Schema.optional(Schema.NullOr(GitHubOpenerSchema)),
  // Note that what follows is read where GitHub sends it, which its one pull request's read always does, and left out where it does not.
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

/** A moment GitHub spells as ISO 8601, as epoch milliseconds; none where it spells none or one that does not parse. */
function momentOf(spelled: string | null | undefined): number | undefined {
  if (spelled == null) return undefined;
  const at = Date.parse(spelled);
  return Number.isNaN(at) ? undefined : at;
}

/** How many comments a pull request holds, on its conversation and its diff together; none where GitHub counted neither. */
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

/** Two commits compared, as far as where they part. */
const CompareSchema = Schema.Struct({ merge_base_commit: Schema.Struct({ sha: Schema.String }) });

/** The commits a pull request's changed images are read at: its head, and where it parts from its base branch, each where it was read. */
export interface ImageCommits {
  readonly headSha?: string;
  readonly baseSha?: string;
}

/** Whether a changed file is an image whose before stands at the base: one changed in place, moved, or removed. */
function imageWithBefore(file: CodingAgentChangedFile): boolean {
  return (
    file.status !== CHANGED_FILE_STATUS.ADDED &&
    imageTypeOfPath(file.previousPath ?? file.path) !== undefined
  );
}

/**
 * The commits the files' changed images are read at: the pull request's
 * head, and, only where an image stood before them, where its head and its
 * base branch part, the merge base GitHub counts the files' changes from,
 * read off one compare of the two asking for a single commit and file,
 * since GitHub pages the rest. Note that the base branch's head is never
 * answered in the merge base's place, because a base branch that changed
 * the same image since would draw a before the pull request never had; a
 * compare that does not land answers no merge base, and the window draws
 * the after alone.
 */
export const imageCommits = /* @__PURE__ */ Effect.fn("web/imageCommits")(function* (
  token: Redacted.Redacted,
  fullName: string,
  pullRequest: Option.Option<Pick<GitHubPullRequest, "headSha" | "baseSha">>,
  files: readonly CodingAgentChangedFile[],
): Effect.fn.Return<ImageCommits, never, HttpClient.HttpClient> {
  if (Option.isNone(pullRequest)) return {};
  const { headSha, baseSha } = pullRequest.value;
  if (baseSha === undefined || !files.some(imageWithBefore)) return { headSha };
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

/** An App's bot whose avatar a caller knows without asking GitHub, by its login: Luke's own App's, by its App's id. */
export interface KnownBot {
  readonly login: string;
  readonly avatarUrl: string;
}

/** A login as GitHub matches one, whatever its case, since a trailer may spell it otherwise than GitHub's own read. */
function loginKey(login: string): string {
  return login.toLowerCase();
}

/**
 * The avatar of each App's bot by its login, whatever its case: the bots known beforehand,
 * then every bot the read names elsewhere with the avatar GitHub gave it,
 * which is its App's.
 */
function botAvatarsOf(
  known: readonly KnownBot[],
  named: readonly GitHubAccount[],
): ReadonlyMap<string, string> {
  const avatars = new Map(known.map((bot) => [loginKey(bot.login), bot.avatarUrl]));
  for (const account of named) {
    if (account.bot && account.avatarUrl !== undefined)
      avatars.set(loginKey(account.login), account.avatarUrl);
  }
  return avatars;
}

/**
 * The accounts a commit's message names as co-authors by their noreply
 * addresses, in the order it names them. Note that only the message's last
 * paragraph is read, because that is where git reads trailers from, so a
 * trailer-shaped line quoted in the body names nobody.
 */
function coAuthorsOf(
  message: string | undefined,
  botAvatars: ReadonlyMap<string, string>,
): readonly GitHubAccount[] {
  if (message === undefined) return [];
  const trailers =
    message
      .trimEnd()
      .split(/\n[ \t]*\n/u)
      .at(-1) ?? "";
  return [...trailers.matchAll(CO_AUTHOR_TRAILER)].map(([, id = "", login = ""]) => {
    const bot = login.endsWith(BOT_LOGIN_SUFFIX);
    // Note that a bot's id is served an identicon, not its App's picture, so a bot co-author wears its App's avatar only where it is known, and its robot otherwise.
    const avatarUrl = bot
      ? botAvatars.get(loginKey(login))
      : githubUserAvatarUrl({ id: Number(id) });
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

/**
 * Who the pull request names, read on the token in three asks at once: the
 * pull request itself, for who opened it and who it still asks for a
 * review; every page of its reviews, since a reviewer stands by their
 * newest; and every page of its commits, since a later commit may be by
 * someone new, each commit naming its author and the co-authors its
 * message's trailers name by their noreply addresses. A bot co-author
 * wears the avatar of a bot `known` names, or of the same bot named
 * anywhere else in the read, and asks GitHub nothing more. Each list is cut
 * at the bound only once read whole. Nobody where the repository holds no
 * such pull request.
 */
export const pullRequestPeople = /* @__PURE__ */ Effect.fn("web/pullRequestPeople")(function* (
  token: Redacted.Redacted,
  fullName: string,
  number: number,
  known: readonly KnownBot[] = [],
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
  const author = pull.value.user === null ? undefined : accountOf(pull.value.user);
  const reviewers = reviewersOf(reviews, requested);
  const committers = commits.flatMap((commit) =>
    commit.author === null ? [] : [accountOf(commit.author)],
  );
  const botAvatars = botAvatarsOf(known, [
    ...(author === undefined ? [] : [author]),
    ...requested,
    ...reviews.flatMap((review) => (review.user === null ? [] : [accountOf(review.user)])),
    ...committers,
  ]);
  return {
    author,
    reviewers,
    commitAuthors: distinctAccounts(
      commits.flatMap((commit) => [
        ...(commit.author === null ? [] : [accountOf(commit.author)]),
        ...coAuthorsOf(commit.commit?.message, botAvatars),
      ]),
    ),
    comments: commentsOf(reviews),
  };
});

/** One inline comment of a review: the file and the line it is on, where GitHub still places it, its words, and its page. */
export interface GitHubReviewLineComment {
  readonly path: string;
  readonly line: number | undefined;
  readonly body: string;
  readonly url: string;
}

/** A review's inline comments, as GitHub lists them; a comment on a line since changed away keeps the line it was made on. */
const ReviewLineCommentsSchema = Schema.Array(
  Schema.Struct({
    path: Schema.String,
    line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    original_line: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    body: Schema.String,
    html_url: Schema.String,
  }),
);

/**
 * The most pages of a review's inline comments read, a hundred to a page:
 * three hundred comments outrun any message they are told in, so a review
 * longer still is cut there with the note that sends the agent to `gh`.
 */
const REVIEW_COMMENTS_MAX_PAGES = 3;

/**
 * The inline comments of one review of a pull request, in the order GitHub
 * lists them, each by its file and line, read page by page up to the bound;
 * none where the repository holds no such review.
 */
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

/**
 * GitHub's media type that answers a body beside its own rendering of it
 * (`body_html`): the markdown rendered as github.com renders it, mentions,
 * references, and emoji included, its uploads named by their assets.
 */
const FULL_MEDIA_TYPE = "application/vnd.github.full+json";

/** A read asking for GitHub's rendering of every body it answers, beside the body. */
function withRendering(
  request: HttpClientRequest.HttpClientRequest,
): HttpClientRequest.HttpClientRequest {
  return HttpClientRequest.setHeader(request, "accept", FULL_MEDIA_TYPE);
}

/** A team as GitHub names one: its slug, which a review request names it by, and its name. */
const TeamSchema = Schema.Struct({ slug: Schema.String, name: Schema.String });

/** A team as the overview and the pickers hold one. */
interface GitHubTeam {
  readonly slug: string;
  readonly name: string;
}

/** A pull request read whole for its overview: what its pill says, and its description, branches, times, mergeability, and people. */
const OverviewPullSchema = Schema.Struct({
  ...PullRequestSchema.fields,
  body: Schema.NullOr(Schema.String),
  body_html: Schema.optionalKey(Schema.NullOr(Schema.String)),
  // Note that a head's repository is null where its fork was deleted, which no pull request here stands on.
  head: Schema.Struct({
    ref: Schema.String,
    sha: Schema.String,
    repo: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.Number }))),
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
      app: Schema.NullOr(Schema.Struct({ id: Schema.Number, name: Schema.String })),
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
      avatar_url: Schema.optionalKey(Schema.NullOr(Schema.String)),
    }),
  ),
});

/**
 * How many gave each reaction, as a REST listing of an issue's comments
 * rolls them up beside each comment, by the key it counts each under.
 */
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

/** The key a REST rollup counts each reaction under. */
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

/** A pull request's comments, oldest first, as GitHub lists an issue's. */
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

/** A pull request itself as its overview holds it, every account as GitHub names it. */
export interface GitHubOverviewPullRequest {
  readonly pullRequest: GitHubPullRequest;
  readonly html: string;
  readonly base: string;
  readonly head: string;
  readonly createdAt: number;
  readonly mergedAt: number | null;
  readonly merge: MergeState;
  readonly author: GitHubAccount | undefined;
  /** Who it still asks for a review, up to the bound. */
  readonly requested: readonly GitHubAccount[];
  /** The teams it still asks for a review, up to the bound. */
  readonly requestedTeams: readonly GitHubTeam[];
  /** Its labels, up to the bound. */
  readonly labels: readonly GitHubLabel[];
  /** The stack it stands in, base first and itself among it; empty where it stands in none, or is not open. */
  readonly stack: readonly StackEntry[];
}

/** A pull request's conversation as its overview holds it, every account as GitHub names it. */
export interface GitHubOverviewConversation {
  /** Where each reviewer stands by their reviews alone; who the pull request still asks is its own read's. */
  readonly reviewers: readonly GitHubReviewer[];
  readonly conversation: readonly GitHubConversationEntry[];
  /** How many earlier entries the bounds left on GitHub. */
  readonly earlier: number;
  /** The reactions the pull request's description wears. */
  readonly descriptionReactions: readonly GitHubReaction[];
  /** GitHub's GraphQL id of the pull request, which a reaction on its description is added to; none where the read named none. */
  readonly descriptionSubject: string | undefined;
}

/**
 * One reaction a comment wears: which, how many gave it, the first of them
 * up to the bound where the read names them, and whether the member reading
 * gave it, where their own token was read.
 */
export interface GitHubReaction {
  readonly content: Reaction;
  readonly count: number;
  readonly accounts: readonly GitHubAccount[] | undefined;
  readonly mine: boolean | undefined;
}

/** The reactions the member reading gave, by GitHub's GraphQL id of what wears them, as their own token reads them. */
export type ViewerReactions = ReadonlyMap<string, ReadonlySet<Reaction>>;

/** One entry of a pull request's conversation, its author as GitHub names them. */
interface GitHubConversationEntry {
  readonly kind: (typeof CONVERSATION_ENTRY)[keyof typeof CONVERSATION_ENTRY];
  readonly account: GitHubAccount;
  readonly state: ReviewState | undefined;
  readonly html: string | null;
  readonly body: string;
  readonly at: number;
  readonly url: string;
  /** The review threads a review started, oldest first; none on a comment. */
  readonly threads: readonly GitHubReviewThread[];
  readonly reactions: readonly GitHubReaction[];
  /** GitHub's GraphQL id of the entry, which a reaction is added to; none where GitHub named none. */
  readonly subject: string | undefined;
}

/** One comment of a review thread, its author as GitHub names them. */
interface GitHubThreadComment {
  readonly account: GitHubAccount;
  readonly html: string | null;
  readonly body: string;
  readonly at: number;
  readonly url: string;
  readonly reactions: readonly GitHubReaction[];
  /** GitHub's GraphQL id of the entry, which a reaction is added to; none where GitHub named none. */
  readonly subject: string | undefined;
}

/** One review thread as GitHub holds it: where it is, the hunk it was made on, where it stands, and its comments. */
interface GitHubReviewThread {
  /** GitHub's id for the review its first comment was made in; none where GitHub names none. */
  readonly reviewId: number | null;
  /** GitHub's GraphQL id for the thread, which a reply or a resolve names it by. */
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

/**
 * A check's avatar as the wire carries it: an address on GitHub's own
 * avatar host, drawn as it is, or one the window reads through the
 * service's image proxy (`githubImageOf`); absent for anything else.
 */
function checkAvatarOf(spelled: string | null | undefined): string | undefined {
  if (spelled === null || spelled === undefined) return undefined;
  return githubAvatarUrl(spelled) ?? (githubImageOf(spelled) === undefined ? undefined : spelled);
}

/** A check wearing its avatar, where it has one. */
function withAvatar(check: PullRequestCheck, avatarUrl: string | undefined): PullRequestCheck {
  return avatarUrl === undefined ? check : { ...check, avatarUrl };
}

/** Where a check stands in the order the bound keeps them by: what asks for a look first. */
const CHECK_RANK = {
  [CHECK_STATE.FAILED]: 0,
  [CHECK_STATE.PENDING]: 1,
  [CHECK_STATE.PASSED]: 2,
  [CHECK_STATE.SKIPPED]: 3,
} as const satisfies Record<CheckState, number>;

/** The ref GitHub keeps on a pull request's head, which names its head commit wherever the head branch lives. */
function pullHeadRef(number: number): string {
  return `refs/pull/${number}/head`;
}

/**
 * A pull request's checks one by one: its head's check runs and its commit
 * statuses, those that failed first, then those still running, up to the
 * bound. The head is named by the ref GitHub keeps on the pull request, so
 * the checks wait on no read of the pull request for its head's commit; a
 * pull request the repository does not hold lists none. Note that they are
 * ordered before they are cut, because a head with a hundred passing runs
 * would otherwise leave out the one status that failed. Each wears its
 * avatar: a check run its App's logo, by the App's id its run names, and a
 * status the picture GitHub names on it, so the avatars cost no request of
 * their own.
 */
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

/** An entry's words as a read carries them, whole: GitHub's rendering, or the markdown where GitHub sent none. */
interface EntryWords {
  readonly html: string | null;
  readonly body: string;
  /** Whether the entry said anything at all. */
  readonly said: boolean;
}

/** An entry's words, whole: GitHub's rendering where it sent one, else the markdown. */
function wordsOf(body: string | null | undefined, html: string | null | undefined): EntryWords {
  const words = body?.trim() ?? "";
  const rendered = html?.trim() ?? "";
  return rendered === ""
    ? { html: null, body: words, said: words !== "" }
    : { html: rendered, body: "", said: words !== "" };
}

/**
 * What the REST listings do not say of a conversation, in one GraphQL read:
 * the review threads of a pull request, newest kept up to the bound, each
 * with its first comments up to the bound and how many GitHub holds, since
 * the REST listing names neither whether a thread was resolved nor whether
 * a push outdated it; and the reactions its description, its comments, its
 * reviews, and its thread comments wear, which no REST listing of a review
 * carries. The newest comments and reviews are read up to the bound on the
 * conversation's entries; GraphQL counts the empty ones the conversation
 * leaves out, so a comment kept past those is counted by the rollup its
 * REST listing carries instead, naming nobody, and a review kept past a
 * hundred newer ones, most of them a reply's wrapper, wears none.
 * Each reaction names the first who gave it up to the bound, but a thread
 * comment's only counts them: GitHub prices a read by the lists it may
 * answer, and naming them under every thread comment costs fifty times the
 * rest of the read. A bot's GraphQL login lacks the suffix its REST login
 * wears, so the suffix is put back.
 */
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

/** How many of the repository's open pull requests one page of a stack's read lists: GitHub's most. */
const STACK_CANDIDATES = 100;

/** The most pages of open pull requests a stack is read to; a repository holding more stands in no stack. */
const STACK_PAGES = 5;

/** GitHub's GraphQL word for an App's bot, and for the left side of a diff. */
const GRAPHQL_BOT = "Bot";
const GRAPHQL_LEFT = "LEFT";

/** The review state of an author's draft, which nobody else sees. */
const GRAPHQL_PENDING = "PENDING";

/** The account GitHub names a deleted account's comments by. */
const GHOST: GitHubAccount = { id: 10_137, login: "ghost", bot: false, avatarUrl: undefined };

/** GitHub's GraphQL words for each reaction (`ReactionContent`). */
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

/** Each reaction in GitHub's GraphQL words, which a mutation names it by. */
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

/** The order GitHub draws reactions in. */
const REACTION_ORDER: readonly Reaction[] = Object.values(REACTION);

/** An account as GitHub's GraphQL names one: an author, or someone who reacted. */
const GraphActorSchema = Schema.Struct({
  __typename: Schema.String,
  login: Schema.String,
  avatarUrl: Schema.optionalKey(Schema.String),
  databaseId: Schema.optionalKey(Schema.NullOr(Schema.Number)),
});

/** One reaction as GitHub's GraphQL answers it: which, how many, and, where asked, the first who gave it. */
const ReactionGroupSchema = Schema.Struct({
  content: Schema.String,
  reactors: Schema.Struct({
    totalCount: Schema.Number,
    nodes: Schema.optionalKey(Schema.Array(Schema.NullOr(GraphActorSchema))),
  }),
});

const ReactionGroupsSchema = Schema.optionalKey(Schema.NullOr(Schema.Array(ReactionGroupSchema)));

/** A comment or a review read for the reactions it wears, by GitHub's id for it. */
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

/** GitHub's GraphQL answer: its data where it read any, and its errors where it met some. */
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

/** The reactions a read names, by GitHub's id for what wears them. */
type ReactionsById = ReadonlyMap<number, readonly GitHubReaction[]>;

/**
 * What the GraphQL read says of a conversation: its review threads, and how
 * many past the bound were left on GitHub; and the reactions its
 * description, comments, and reviews wear, the comments and reviews by
 * GitHub's id for them.
 */
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

/** An account as GitHub's GraphQL names one, as the people hold them; a deleted account as GitHub's ghost. */
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

/**
 * The reactions something wears, in GitHub's order: those given, each with
 * who GitHub named of those who gave it where the read asked; a reaction
 * this service does not know of is left out.
 */
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

/** The reactions each of a list wears, by GitHub's id for it. */
function reactionsById(
  list: { readonly nodes: readonly (typeof ReactedSchema.Type | null)[] } | undefined,
): ReactionsById {
  const byId = new Map<number, readonly GitHubReaction[]>();
  for (const node of list?.nodes ?? []) {
    if (node?.databaseId != null) byId.set(node.databaseId, reactionsOf(node.reactionGroups));
  }
  return byId;
}

/** The reactions GitHub's id names, none where it names nothing the read reached. */
function reactionsAt(byId: ReactionsById, id: number | undefined): readonly GitHubReaction[] {
  return (id === undefined ? undefined : byId.get(id)) ?? [];
}

/** The reactions a REST rollup counts, in GitHub's order, those given, naming nobody. */
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

/** One thread as the overview holds it, a draft's comments left out; none where nothing but a draft is left. */
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

/**
 * The pull request's review threads and reactions, read over GraphQL on the
 * token. Note that a read that fails, or that GitHub answers only with
 * errors, leaves the threads and the reactions out, said once in the log,
 * because the rest of the overview stands without them.
 */
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

/** When a thread was started: its first comment's time. */
function threadAt(thread: GitHubReviewThread): number {
  return thread.comments[0]?.at ?? 0;
}

/**
 * A thread whose review is no entry, a deleted account's or one the review
 * listing never reached, standing at its own time as the review GitHub
 * would draw around it.
 */
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

/** The conversation as a read carries it: its newest entries, oldest first, and how many earlier ones were left. */
interface KeptConversation {
  readonly conversation: readonly GitHubConversationEntry[];
  readonly earlier: number;
}

/**
 * The conversation: every comment that says something and every review
 * that decides, says something, or started a review thread, each thread
 * under the review its first comment was made in, in time order, the newest
 * kept up to the bound and the earlier ones counted with the threads left
 * on GitHub. A review that only commented, said nothing, and started no
 * thread is GitHub's wrapper for a reply in a thread drawn under its own
 * review, and a draft review is its author's alone, so neither is an
 * entry; a thread whose review is no entry stands at its own time.
 */
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
        // Note that a comment past the GraphQL read's newest hundred, which counts the empty ones the conversation leaves out, is counted by its REST rollup instead.
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

/**
 * The repository's open pull requests a stack is worked out from, a page
 * at a time in GraphQL reads: each by its number, words, and branches, and
 * whether its head is a fork's, and where the next page starts.
 */
const OPEN_PULL_REQUESTS_QUERY = `query OpenPullRequests($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: ${STACK_CANDIDATES}, after: $after) {
      nodes { number title url isDraft headRefName baseRefName isCrossRepository }
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

/** The open pull requests a page lists, as a stack is worked out from them. */
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
          },
        ],
  );
}

/**
 * The repository's every open pull request, page after page up to the
 * bound, as a stack is worked out from them; none where they could not all
 * be read. Note that a listing cut short is none rather than what it got
 * to, because a pull request it left out could be the second on a branch,
 * which unmakes an edge the rest would make; and that a read that fails, or
 * that GitHub answers only with errors, is none too, said once in the log,
 * because the header stands without its stack.
 */
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

/**
 * A pull request itself as its overview draws it, read on the token in one
 * ask with GitHub's rendering of its description: its branches, its times,
 * its mergeability, who opened it, who it still asks for a review, and its
 * labels. Where `stacked` says it was open as last read, the repository's
 * open pull requests are read beside it for the stack it stands in, which
 * one no longer open stands in none of. None where the repository holds no
 * such pull request.
 */
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
  };
  const stands =
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT;
  return Option.some({
    pullRequest,
    html: pull.body_html?.trim() ?? "",
    base: nameOf(pull.base.ref),
    head: nameOf(pull.head.ref),
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

/**
 * A pull request's conversation, read on the token: at once every page of
 * its comments, every page of its reviews, which both name where each
 * reviewer stands and join its comments as its conversation, and its review
 * threads, each under its review, with the reactions its description and
 * every entry wear, read in the threads' one ask rather than one per
 * comment. `pageUrl` is the pull request's own page,
 * which an entry GitHub names no page of opens. A pull request the
 * repository does not hold reads as nobody having said anything.
 */
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
    // The member's own read runs beside the App's and is waited on only briefly once they land, so it never holds the conversation.
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

/**
 * How long the conversation waits, once the App's reads land, on the
 * member's own read of which reactions they gave; past it the conversation
 * is answered without them.
 */
const VIEWER_GRACE = Duration.millis(750);

/**
 * The reactions marked with whether the member gave each, by what their own
 * read says of the subject wearing them; left unmarked where their read was
 * not made or did not reach that subject.
 */
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

/** GitHub's word, on the member's own token, for whether they gave each reaction something wears. */
const ViewerGroupsSchema = Schema.optionalKey(
  Schema.NullOr(
    Schema.Array(Schema.Struct({ content: Schema.String, viewerHasReacted: Schema.Boolean })),
  ),
);

/** Something read for which reactions the member gave it, by its GraphQL id. */
const ViewedSchema = Schema.Struct({ id: Schema.String, reactionGroups: ViewerGroupsSchema });

const ViewedListSchema = Schema.optionalKey(
  Schema.Struct({ nodes: Schema.Array(Schema.NullOr(ViewedSchema)) }),
);

/**
 * Which reactions the member reading gave, read on their own GitHub token,
 * since a read on the App's token answers for the App's bot: the
 * description, the newest comments and reviews, and every thread comment,
 * each by its GraphQL id, as the conversation's own read bounds them.
 */
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

/** The reactions GitHub says the viewer gave, among those this service knows. */
function givenOf(groups: (typeof ViewedSchema.Type)["reactionGroups"]): ReadonlySet<Reaction> {
  return new Set(
    (groups ?? []).flatMap((group) => {
      const content = GRAPHQL_REACTION.get(group.content);
      return group.viewerHasReacted && content !== undefined ? [content] : [];
    }),
  );
}

/**
 * Which reactions the member gave, read on their own token; none where
 * GitHub would not answer them, which leaves the conversation unmarked
 * rather than failing it, said once in the log.
 */
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

/**
 * How many deployments of the head one read asks GitHub for, the newest
 * first: a whole page, GitHub's most, so an environment deployed again and
 * again on the same commit leaves room for the others once each keeps its
 * newest. Note that it is one page and never more, because paging until
 * ten environments stood would make the checks read's requests grow with
 * how often one environment redeployed; a head with more than a hundred
 * deployments lists the environments of its newest hundred.
 */
const DEPLOYMENTS_ASKED = 100;

/**
 * The deployments of a pull request's head, in one GraphQL read whatever
 * their number: the head is the pull request's last commit, so no read of
 * its commit comes first, and each deployment carries its newest status,
 * where REST would ask once for the list and once more for each status.
 */
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

/** GitHub's GraphQL answer to the deployments read: its data where it read any, and its errors where it met some. */
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

/** GitHub's words for where a deployment or its newest status stands, as the wire says each; any it adds reads as still deploying. */
const GITHUB_DEPLOYMENT_STATE = new Map<string, DeploymentState>([
  ["SUCCESS", DEPLOYMENT_STATE.READY],
  ["ACTIVE", DEPLOYMENT_STATE.READY],
  ["FAILURE", DEPLOYMENT_STATE.FAILED],
  ["ERROR", DEPLOYMENT_STATE.FAILED],
  ["INACTIVE", DEPLOYMENT_STATE.INACTIVE],
  ["DESTROYED", DEPLOYMENT_STATE.INACTIVE],
  ["ABANDONED", DEPLOYMENT_STATE.INACTIVE],
]);

/** The address a deployment serves, only where it is https, since the window opens it in the browser. */
function deploymentUrlOf(spelled: string | null | undefined): string | null {
  if (spelled === null || spelled === undefined) return null;
  try {
    return new URL(spelled).protocol === "https:" ? spelled : null;
  } catch {
    return null;
  }
}

/** One deployment as the wire carries it; none for one GitHub names no environment of. */
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

/** The newest deployment of each environment, newest first, up to the bound. */
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

/**
 * A pull request's head's deployments, such as its Vercel Previews: the
 * newest of each environment, newest first, up to the bound, each with
 * where its newest status left it and the https address it serves. It is
 * one request whatever their number (`DEPLOYMENTS_QUERY`). A pull request
 * the repository does not hold, or a repository where the App may not read
 * deployments, lists none, said once in the log, rather than failing the
 * checks read it stands beside.
 */
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

/** The member's own pending review on a pull request, as the conversation's read carries it: how many comments it holds. */
export interface ViewerPendingReview {
  readonly comments: number;
}

/** At most this many pending reviews are read to find the member's own; GitHub shows a member only theirs, so one is the most ever answered. */
const VIEWER_PENDING_READ = 10;

const VIEWER_PENDING_QUERY = `query ViewerPendingReview($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(states: PENDING, first: ${VIEWER_PENDING_READ}) {
        nodes { viewerDidAuthor comments { totalCount } }
      }
    }
  }
}`;

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
                        viewerDidAuthor: Schema.Boolean,
                        comments: Schema.Struct({ totalCount: Schema.Number }),
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
});

/**
 * The review the member holds pending on the pull request, read on their
 * own token, since nobody else sees it; none where they hold none, and none
 * where GitHub would not answer them, which leaves the conversation without
 * it rather than failing it, said once in the log.
 */
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
      const nodes = answer.data?.repository?.pullRequest?.reviews.nodes ?? [];
      const own = nodes.find((node) => node?.viewerDidAuthor === true);
      return own == null ? null : { comments: own.comments.totalCount };
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

/** The repository's labels, as its pickers list them. */
const LabelsSchema = Schema.Array(Schema.Struct({ name: Schema.String, color: Schema.String }));

/** The repository's collaborators, each an account. */
const CollaboratorsSchema = Schema.Array(GitHubAccountSchema);

/** The teams that reach the repository. */
const TeamsSchema = Schema.Array(TeamSchema);

/** The most pages of each of the pickers' listings read: their bound, a hundred to a page. */
const OPTIONS_MAX_PAGES = Math.ceil(OVERVIEW_BOUNDS.MAX_OPTIONS / PEOPLE_PER_PAGE);

/** What the reviewer and label pickers offer, read of the repository: its labels, its collaborators, and its teams, each up to the bound. */
export interface GitHubReviewOptions {
  readonly labels: readonly GitHubLabel[];
  readonly users: readonly GitHubAccount[];
  readonly teams: readonly GitHubTeam[];
}

/**
 * One of the pickers' listings, every page up to the bound. Note that one
 * the App may not read, as the teams of a repository a person owns or of an
 * installation that never granted the read, lists none, said once in the
 * log, because the others stand without it; and that any other failure, a
 * GitHub that did not answer, fails the read, so the pickers read it again
 * rather than hold an empty list that is no answer at all.
 */
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

/**
 * What the reviewer and label pickers offer, read on the token of the
 * agent's repository in three asks at once: its labels, its collaborators,
 * who may be asked for a review, and the teams that reach it.
 */
export const pullRequestReviewOptions = /* @__PURE__ */ Effect.fn("web/pullRequestReviewOptions")(
  function* (
    token: Redacted.Redacted,
    fullName: string,
  ): Effect.fn.Return<GitHubReviewOptions, PullRequestReadFailure, HttpClient.HttpClient> {
    const path = repositoryPath(fullName);
    const [labels, users, teams] = yield* Effect.all(
      [
        optionsListing(token, `${path}/labels`, LabelsSchema, "labels"),
        optionsListing(token, `${path}/collaborators`, CollaboratorsSchema, "collaborators"),
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
