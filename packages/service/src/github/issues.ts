/**
 * issues.ts -- one issue of a repository as a link to it draws it: its number, title, page, and where it stands.
 *
 * The read runs on an installation token the App minted for the one
 * repository with issues read alone (`github-app.ts`'s
 * `repositoryIssueToken`), and composes over the App module's own kit
 * (`githubRead`, `send`, `readBody`) so a token leaves this module no more
 * than it leaves that one. GitHub answers a pull request's number on its
 * issues path too, since every pull request is an issue to it, and that
 * answer is none here, because the link names an issue and a pull request's
 * own link reads it as one. A repository with its issues turned off answers
 * gone, which is none as well. Where it stands is read as GitHub draws its
 * mark: open, closed as done, or closed as not planned, which a duplicate is
 * closed as too. Who opened it is read off the same answer, by login.
 *
 * New task's picker reads a repository's issues on the same token: its open
 * issues, newest changed first (`GET /repos/{o}/{n}/issues?state=open`),
 * those GitHub's search finds for words typed (`GET /search/issues`, held to
 * the one repository's open issues), or one by number; each with its node
 * id, who opened it, and how GitHub says they stand to the repository
 * (`author_association`), and none of them a pull request. A task links one
 * as its row keeps it (`issueLink`): under its node id, which survives a
 * rename or a transfer, keyed `owner/name#N`, its body kept to the bound a
 * Linear issue's description is held to.
 */

import type { NewTaskIssueLink } from "@luke/database/models/task-issue-store";
import {
  GITHUB_ISSUES_BOUNDS,
  type GitHubIssuePick,
  ISSUE_STATE,
  type IssueState,
} from "@luke/features/github-repositories-wire";
import { LINEAR_BOUNDS } from "@luke/features/linear-wire";
import { TASK_ISSUE_PROVIDER } from "@luke/features/task-issue-wire";
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
import { GitHubOpenerSchema, openerFieldsOf } from "./pull-requests.js";

/** One issue as a link to it draws it. */
export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly state: IssueState;
  /** The login of who opened it, where GitHub named one, their avatar where GitHub's avatar host serves it, and whether they are an App's bot. */
  readonly author?: string;
  readonly authorAvatarUrl?: string;
  readonly authorBot?: boolean;
}

/** GitHub's own word for a closed issue, and its reasons for closing one that read as not planned. */
const GITHUB_CLOSED = "closed";
const NOT_PLANNED_REASONS: ReadonlySet<string> = new Set(["not_planned", "duplicate"]);

const IssueSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.String,
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  /** Who opened it; null where their account is gone. */
  user: Schema.optional(Schema.NullOr(GitHubOpenerSchema)),
  /** Present only where the number is a pull request's. */
  pull_request: Schema.optional(Schema.Unknown),
});

/** An issue as a picker's read spells it: the one issue's fields, and its node id, who opened it as GitHub says they stand to the repository, when it last changed, and its body. */
const PickedIssueSchema = Schema.Struct({
  ...IssueSchema.fields,
  node_id: Schema.String,
  author_association: Schema.String,
  updated_at: Schema.String,
  body: Schema.optional(Schema.NullOr(Schema.String)),
});

type PickedIssueRecord = typeof PickedIssueSchema.Type;

const SearchedIssuesSchema = Schema.Struct({
  items: Schema.Array(Schema.Struct({ ...PickedIssueSchema.fields, html_url: Schema.String })),
});

/** How many issues a listing asks for at once: more than a picker answers, since pull requests share the listing and are dropped. */
const LISTED_PER_PAGE = 100;

/** Where an issue stands, as its mark draws it. */
function stateOf(record: typeof IssueSchema.Type): IssueState {
  if (record.state !== GITHUB_CLOSED) return ISSUE_STATE.OPEN;
  return NOT_PLANNED_REASONS.has(record.state_reason ?? "")
    ? ISSUE_STATE.NOT_PLANNED
    : ISSUE_STATE.CLOSED;
}

/** One issue of the repository by number; none where it holds no issue of that number, the number is a pull request's, or its issues are off. */
export function issueByNumber(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<Option.Option<GitHubIssue>, GitHubUnavailable, HttpClient.HttpClient> {
  const [owner = "", name = ""] = fullName.split("/");
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number}`;
  return Effect.scoped(
    Effect.flatMap(send(githubRead(path, token)), (response) => {
      if (
        response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
        response.status === GITHUB_HTTP_STATUS.GONE
      ) {
        return Effect.succeed(Option.none<GitHubIssue>());
      }
      return Effect.map(readBody(response, IssueSchema), (record) =>
        record.pull_request === undefined
          ? Option.some({
              number: record.number,
              title: record.title,
              url: record.html_url,
              state: stateOf(record),
              ...openerFieldsOf(record.user),
            })
          : Option.none(),
      );
    }),
  );
}

/** The path of a repository's issues under the API, its owner and name each encoded. */
function issuesPath(fullName: string): string {
  const [owner = "", name = ""] = fullName.split("/");
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues`;
}

/** An issue's record as the picker lists it, in the repository as GitHub spells it. */
function pickOf(fullName: string, record: PickedIssueRecord): GitHubIssuePick {
  const updatedAt = Date.parse(record.updated_at);
  const author = record.user?.login;
  return {
    nodeId: record.node_id,
    repository: fullName,
    number: record.number,
    title: record.title,
    url: record.html_url,
    state: stateOf(record),
    ...(author === undefined ? undefined : { author }),
    authorAssociation: record.author_association,
    updatedAt: Number.isFinite(updatedAt) ? Math.max(updatedAt, 0) : 0,
  };
}

/** The issues of an answer, none of them a pull request, as many as a read answers. */
function picksOf(
  fullName: string,
  records: readonly PickedIssueRecord[],
): readonly GitHubIssuePick[] {
  return records
    .filter((record) => record.pull_request === undefined)
    .slice(0, GITHUB_ISSUES_BOUNDS.MAX_ISSUES)
    .map((record) => pickOf(fullName, record));
}

/** The repository's open issues, newest changed first. */
export function openIssues(
  token: Redacted.Redacted,
  fullName: string,
): Effect.Effect<readonly GitHubIssuePick[], GitHubUnavailable, HttpClient.HttpClient> {
  const request = githubRead(issuesPath(fullName), token).pipe(
    HttpClientRequest.setUrlParams({
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: String(LISTED_PER_PAGE),
    }),
  );
  return Effect.scoped(
    Effect.flatMap(send(request), (response) =>
      Effect.map(readBody(response, Schema.Array(PickedIssueSchema)), (records) =>
        picksOf(fullName, records),
      ),
    ),
  );
}

/**
 * The repository's open issues GitHub's search finds for the words, newest
 * changed first. Note that a result of any other repository is dropped,
 * because words typed may carry a qualifier of their own that widens the
 * search past the one the read names.
 */
export function searchIssues(
  token: Redacted.Redacted,
  fullName: string,
  words: string,
): Effect.Effect<readonly GitHubIssuePick[], GitHubUnavailable, HttpClient.HttpClient> {
  const page = `https://github.com/${fullName}/issues/`.toLowerCase();
  const request = githubRead("/search/issues", token).pipe(
    HttpClientRequest.setUrlParams({
      q: `${words} repo:${fullName} is:issue is:open`,
      sort: "updated",
      order: "desc",
      per_page: String(GITHUB_ISSUES_BOUNDS.MAX_ISSUES),
    }),
  );
  return Effect.scoped(
    Effect.flatMap(send(request), (response) =>
      Effect.map(readBody(response, SearchedIssuesSchema), (answer) =>
        picksOf(
          fullName,
          answer.items.filter((item) => item.html_url.toLowerCase().startsWith(page)),
        ),
      ),
    ),
  );
}

/** One issue's record by number; none where the repository holds none, it is a pull request's, or its issues are off. */
function issueRecord(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<Option.Option<PickedIssueRecord>, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.scoped(
    Effect.flatMap(
      send(githubRead(`${issuesPath(fullName)}/${number}`, token)),
      (response: HttpClientResponse.HttpClientResponse) => {
        if (
          response.status === GITHUB_HTTP_STATUS.NOT_FOUND ||
          response.status === GITHUB_HTTP_STATUS.GONE
        ) {
          return Effect.succeed(Option.none<PickedIssueRecord>());
        }
        return Effect.map(readBody(response, PickedIssueSchema), (record) =>
          record.pull_request === undefined ? Option.some(record) : Option.none(),
        );
      },
    ),
  );
}

/** One issue by number as the picker lists it; none on the same terms as `issueByNumber`. */
export function issuePick(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<Option.Option<GitHubIssuePick>, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.map(
    issueRecord(token, fullName, number),
    Option.map((record) => pickOf(fullName, record)),
  );
}

/** One issue by number as a task links it, its body bounded and empty where it has none; none on the same terms as `issueByNumber`. */
export function issueLink(
  token: Redacted.Redacted,
  fullName: string,
  number: number,
): Effect.Effect<Option.Option<NewTaskIssueLink>, GitHubUnavailable, HttpClient.HttpClient> {
  return Effect.map(
    issueRecord(token, fullName, number),
    Option.map((record) => ({
      provider: TASK_ISSUE_PROVIDER.GITHUB,
      externalId: record.node_id,
      repository: fullName,
      number: record.number,
      key: `${fullName}#${record.number}`,
      url: record.html_url,
      title: record.title,
      description: (record.body ?? "").slice(0, LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS),
    })),
  );
}
