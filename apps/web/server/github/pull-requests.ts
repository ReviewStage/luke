/**
 * pull-requests.ts -- what a coding agent published, as GitHub holds it: a pull request by number or by its branch, a branch, and the checks on a head.
 *
 * Every read runs on the developer's own GitHub App token
 * (`github-app.ts`'s `userToken`), the same reach that admits the agent's
 * checkout: the App's own permissions bound it, and a repository the
 * developer does not reach answers not found rather than refused. The
 * requests compose over the App module's own kit (`githubRead`,
 * `sendAsUser`, `readBody`) so a token leaves this module no more than it
 * leaves that one. The checks are read as one word for a dot: GitHub's
 * check runs and its older commit statuses together, since a workflow
 * reports as the one and a deployment may report as the other, and a
 * repository where the App may read neither reads as having none, with a
 * warning, rather than failing the whole answer.
 */

import {
  CHECK_SUMMARY,
  type CheckSummary,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@sidecar/hosted/coding-agent-wire";
import { Effect, Option, type Redacted, Schema } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import {
  GITHUB_HTTP_STATUS,
  type GitHubSignInRequired,
  type GitHubUnavailable,
  githubRead,
  readBody,
  sendAsUser,
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

/** What a read on the user's token fails with: GitHub unreachable or a sign-in owed. */
export type PullRequestReadFailure = GitHubUnavailable | GitHubSignInRequired;

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

const CombinedStatusSchema = Schema.Struct({
  statuses: Schema.Array(Schema.Struct({ state: Schema.String })),
});

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
      sendAsUser(request),
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
    Effect.flatMap(sendAsUser(request), (response: HttpClientResponse.HttpClientResponse) => {
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
