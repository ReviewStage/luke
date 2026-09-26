import {
  GITHUB_FAILURE,
  type GitHubFailure,
  type GitHubRepository,
  type GitHubRepositoryListAnswer,
  type PlanRepository,
} from "@sidecar/hosted";
import { HTTP_STATUS } from "@sidecar/wire";
import { Context, Data, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

/**
 * github-source.ts -- the account's GitHub credential, and the two repository metadata reads a plan is set up with.
 *
 * The credential is read at the moment a GitHub read needs it, from
 * whatever holds the account's GitHub connection, and it is revealed in one
 * place: the `Authorization` header of the request it rides. It never enters
 * an answer, a log line, or a span, and every failure below is one of the
 * fixed `GITHUB_FAILURE` reasons rather than GitHub's own words, because a
 * provider's error body is not ours to forward.
 *
 * The two reads are the minimal metadata a plan needs before any source is
 * read: which repositories the connection can read, for the window's picker,
 * and what commit a repository's default branch stands at, which the plan
 * keeps for its whole life. Source itself is read through GitHub's hosted
 * MCP service (`github-mcp.ts`), never here.
 */

const GITHUB_API_ORIGIN = "https://api.github.com";

const GITHUB_REQUEST_HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "Luke",
} as const;

export const GITHUB_SOURCE_BOUNDS = {
  /** One metadata request, headers and body. */
  REQUEST_TIMEOUT: Duration.seconds(10),
  /** GitHub's own page ceiling. */
  REPOSITORIES_PER_PAGE: 100,
  /** The most pages of repositories one list reads; past it the list is marked truncated. */
  MAX_REPOSITORY_PAGES: 3,
} as const;

const OK_STATUS = { FIRST: 200, PAST: 300 } as const;

/** Why a GitHub read under the account's connection answered nothing, as one fixed reason. */
export class GitHubUnavailable extends Data.TaggedError("GitHubUnavailable")<{
  readonly reason: GitHubFailure;
}> {}

/**
 * The account's GitHub credential, read when a GitHub read needs it. An
 * account with no connection answers `not-connected`; a store that could not
 * be read answers `failed`. What holds the connection is the layer's own
 * business, so the reads here and the planning model's source tool never
 * see where it came from.
 */
export interface GitHubAccessShape {
  readonly token: (userId: string) => Effect.Effect<Redacted.Redacted, GitHubUnavailable>;
}

export class GitHubAccess extends Context.Service<GitHubAccess, GitHubAccessShape>()(
  "GitHubAccess",
) {}

/**
 * The deployment's GitHub access until the account-bound GitHub connection
 * lands: no account holds a connection, so every GitHub read answers
 * `not-connected`, and the window and the planning model say GitHub has to
 * be connected rather than claiming anything was read.
 */
export const GITHUB_ACCESS_WITHOUT_CONNECTIONS: GitHubAccessShape = {
  token: () => Effect.fail(new GitHubUnavailable({ reason: GITHUB_FAILURE.NOT_CONNECTED })),
};

/** The same access as the layer a route provides. */
export const githubAccessWithoutConnections = Layer.succeed(
  GitHubAccess,
  GITHUB_ACCESS_WITHOUT_CONNECTIONS,
);

const RepositoryRowSchema = Schema.Struct({
  name: Schema.String,
  owner: Schema.Struct({ login: Schema.String }),
  private: Schema.Boolean,
  default_branch: Schema.String,
});

const BranchRowSchema = Schema.Struct({
  commit: Schema.Struct({ sha: Schema.String }),
});

const readRepository = HttpClientResponse.schemaBodyJson(RepositoryRowSchema);
const readRepositories = HttpClientResponse.schemaBodyJson(Schema.Array(RepositoryRowSchema));
const readBranch = HttpClientResponse.schemaBodyJson(BranchRowSchema);

/** A GitHub path from its segments, each one encoded, so a name can never name a different route. */
function githubUrl(segments: readonly string[], query: Readonly<Record<string, string>> = {}) {
  const url = new URL(GITHUB_API_ORIGIN);
  url.pathname = `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return url.href;
}

/**
 * The reason a GitHub status names. A 403 is the connection being refused
 * this repository unless GitHub says it is out of requests, and a 409 is
 * GitHub's answer for a repository with nothing in it.
 */
function failureOfStatus(response: HttpClientResponse.HttpClientResponse): GitHubFailure {
  const remaining = Option.getOrUndefined(Headers.get(response.headers, "x-ratelimit-remaining"));
  if (response.status === HTTP_STATUS.TOO_MANY_REQUESTS) return GITHUB_FAILURE.RATE_LIMITED;
  if (response.status === HTTP_STATUS.FORBIDDEN && remaining === "0") {
    return GITHUB_FAILURE.RATE_LIMITED;
  }
  if (response.status === HTTP_STATUS.UNAUTHORIZED) return GITHUB_FAILURE.ACCESS_DENIED;
  if (response.status === HTTP_STATUS.FORBIDDEN) return GITHUB_FAILURE.NOT_FOUND;
  if (response.status === HTTP_STATUS.NOT_FOUND) return GITHUB_FAILURE.NOT_FOUND;
  if (response.status === HTTP_STATUS.CONFLICT) return GITHUB_FAILURE.EMPTY_REPOSITORY;
  return GITHUB_FAILURE.FAILED;
}

/**
 * One GET under the credential, answered with its body read through
 * `read`. A status outside 2xx is its reason; a transport failure, a
 * deadline, and a body the schema refuses are all `failed`, since each is
 * GitHub not having answered what was asked.
 */
function githubGet<A>(
  token: Redacted.Redacted,
  url: string,
  read: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, unknown>,
): Effect.Effect<
  { readonly body: A; readonly response: HttpClientResponse.HttpClientResponse },
  GitHubUnavailable,
  HttpClient.HttpClient
> {
  const request = HttpClientRequest.get(url, {
    headers: { ...GITHUB_REQUEST_HEADERS, authorization: `Bearer ${Redacted.value(token)}` },
  });
  return Effect.gen(function* () {
    const response = yield* HttpClient.execute(request);
    if (response.status < OK_STATUS.FIRST || response.status >= OK_STATUS.PAST) {
      return yield* new GitHubUnavailable({ reason: failureOfStatus(response) });
    }
    const body = yield* read(response);
    return { body, response };
  }).pipe(
    Effect.timeout(GITHUB_SOURCE_BOUNDS.REQUEST_TIMEOUT),
    Effect.catch((failure) =>
      failure instanceof GitHubUnavailable
        ? Effect.fail(failure)
        : Effect.fail(new GitHubUnavailable({ reason: GITHUB_FAILURE.FAILED })),
    ),
  );
}

function hasNextPage(response: HttpClientResponse.HttpClientResponse): boolean {
  const link = Option.getOrUndefined(Headers.get(response.headers, "link"));
  return link?.includes('rel="next"') === true;
}

/**
 * The repository as GitHub names it, its default branch, and the commit
 * that branch stands at now. The owner and name are GitHub's own spelling,
 * whatever case the caller used. A repository with no commit on its default
 * branch answers `empty-repository`, since there is no source to plan against.
 */
export const resolveRepository = /* @__PURE__ */ Effect.fn("web/githubResolveRepository")(
  function* (token: Redacted.Redacted, owner: string, name: string) {
    const { body: repository } = yield* githubGet(
      token,
      githubUrl(["repos", owner, name]),
      readRepository,
    );
    const { body: branch } = yield* githubGet(
      token,
      githubUrl([
        "repos",
        repository.owner.login,
        repository.name,
        "branches",
        repository.default_branch,
      ]),
      readBranch,
    ).pipe(
      // A default branch GitHub names but cannot find is a repository with no commit yet.
      Effect.catch((failure) =>
        Effect.fail(
          failure.reason === GITHUB_FAILURE.NOT_FOUND
            ? new GitHubUnavailable({ reason: GITHUB_FAILURE.EMPTY_REPOSITORY })
            : failure,
        ),
      ),
    );
    return {
      owner: repository.owner.login,
      name: repository.name,
      branch: repository.default_branch,
      commit: branch.commit.sha,
    } satisfies PlanRepository;
  },
);

/**
 * The repositories the connection can read, most recently pushed first, up
 * to the page bound; `truncated` when GitHub holds more past it.
 */
export const listRepositories = /* @__PURE__ */ Effect.fn("web/githubListRepositories")(function* (
  token: Redacted.Redacted,
) {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= GITHUB_SOURCE_BOUNDS.MAX_REPOSITORY_PAGES; page += 1) {
    const { body, response } = yield* githubGet(
      token,
      githubUrl(["user", "repos"], {
        sort: "pushed",
        per_page: String(GITHUB_SOURCE_BOUNDS.REPOSITORIES_PER_PAGE),
        page: String(page),
      }),
      readRepositories,
    );
    for (const row of body) {
      repositories.push({ owner: row.owner.login, name: row.name, private: row.private });
    }
    if (!hasNextPage(response)) return { repositories, truncated: false };
  }
  return { repositories, truncated: true } satisfies GitHubRepositoryListAnswer;
});
