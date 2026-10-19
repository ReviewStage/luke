import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { ensurePersonalWorkspace } from "@luke/database/models/workspace-store";
import { user } from "@luke/database/schemas/auth";
import {
  fakeWorkspaceSeams,
  getTestDB,
  openInstallationWorkspace,
  openWorkspace,
} from "@luke/database/testing";
import {
  accountBearer,
  GITHUB_REPOSITORIES_QUERY,
  githubRepositoriesAnswerSchema,
  githubRepositoryIssueAnswerSchema,
  githubRepositoryPullRequestAnswerSchema,
  HOSTED_SERVICE_PATH,
  HostedTaskClient,
} from "@luke/features";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { ISSUE_STATE } from "@luke/features/github-repositories-wire";
import {
  TASK_FILE_REFUSAL,
  TASK_TREE_ENTRY,
  taskSkillsAnswerSchema,
  taskTreeAnswerSchema,
} from "@luke/features/task-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { recordingHttpClient } from "@luke/wire/testing";
import { Clock, type Context, Effect, Layer, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import {
  type FakeGitHub,
  GITHUB_FIXTURE,
  githubReaching,
  openGithubUser,
} from "../testing/github-app-fake.js";
import type { GitHubApp } from "./github-app.js";
import { githubProcedures } from "./github-procedures.js";

/**
 * The repositories route over the real `GitHubApp`, a GitHub the test
 * scripts, and the account and workspace rows on a real dialect: the bearer
 * names the account, the workspace named (or the account's personal one) is
 * whose installation is listed, with where to install the App, and a
 * workspace the account is not in is refused by name.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";

/** A pull request of `acme/relay` as GitHub's API names it by number. */
const PULL_PATH = /^\/repos\/acme\/relay\/pulls\/(\d+)$/u;

/** One pull request of `acme/relay` as GitHub records it, whole: more than a link draws. */
function pullRecord(
  number: number,
  title: string,
  standing: { readonly merged: boolean; readonly draft: boolean },
  user: { readonly login: string } | null = { login: "octo-dev" },
) {
  return {
    number,
    title,
    html_url: `https://github.com/acme/relay/pull/${number}`,
    state: standing.merged ? "closed" : "open",
    draft: standing.draft,
    merged: standing.merged,
    additions: 12,
    deletions: 3,
    changed_files: 2,
    head: { ref: `invites-${number}`, sha: `sha-${number}` },
    user,
  };
}

/** What GitHub's read of one pull request carries past the fields every read names: when it was opened, its base, its labels, and its counts. */
const WHOLE_PULL = {
  created_at: "2026-10-01T09:30:00Z",
  merged_at: null,
  closed_at: null,
  base: { ref: "main" },
  labels: [{ name: "invites", color: "4fd18b", id: 9, description: null }],
  comments: 3,
  review_comments: 2,
  commits: 4,
  user: {
    login: "octo-dev",
    type: "User",
    avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
  },
};

/** The pull requests `acme/relay` holds: one open, read whole, and one merged, read as a listing names it. */
const RELAY_PULLS = new Map([
  [
    42,
    {
      ...pullRecord(42, "Send invitations in batches", { merged: false, draft: false }),
      ...WHOLE_PULL,
    },
  ],
  // Its author's account is gone, which GitHub answers as no user.
  [43, pullRecord(43, "Retry a bounced invitation", { merged: true, draft: false }, null)],
]);

/** An issue of `acme/relay` as GitHub's API names it by number. */
const ISSUE_PATH = /^\/repos\/acme\/relay\/issues\/(\d+)$/u;

/** One issue of `acme/relay` as GitHub records it, whole: more than a link draws. */
function issueRecord(number: number, title: string, state: string, reason: string | null) {
  return {
    number,
    title,
    html_url: `https://github.com/acme/relay/issues/${number}`,
    state,
    state_reason: reason,
    body: "Seen on the staging invitations page.",
    user: { login: "octo-dev" },
    comments: 3,
    node_id: `I_kwDOrelay${number}`,
    author_association: number === 9 ? "NONE" : "MEMBER",
    updated_at: "2026-10-01T00:00:00Z",
  };
}

/** The picker's read of one issue of `acme/relay` as the answer carries it. */
function relayPick(number: number, title: string, state: string, association: string) {
  return {
    nodeId: `I_kwDOrelay${number}`,
    repository: "acme/relay",
    number,
    title,
    url: `https://github.com/acme/relay/issues/${number}`,
    state,
    author: "octo-dev",
    authorAssociation: association,
    updatedAt: Date.parse("2026-10-01T00:00:00Z"),
  };
}

/** `acme/relay`'s issues listing and the search of its issues. */
const RELAY_ISSUES_PATH = "/repos/acme/relay/issues";
const SEARCH_PATH = "/search/issues";

/** The issues `acme/relay` answers on its issues path: one open, one done, one not planned, one a duplicate, and pull request 42, which GitHub answers there too. */
const RELAY_ISSUES = new Map<number, object>([
  [7, issueRecord(7, "Invitations expire too soon", "open", null)],
  [8, issueRecord(8, "Batch the invitation emails", "closed", "completed")],
  [9, issueRecord(9, "Invite by phone number", "closed", "not_planned")],
  [10, issueRecord(10, "Invites expire early", "closed", "duplicate")],
  [42, { ...issueRecord(42, "Send invitations in batches", "open", null), pull_request: {} }],
]);

/** An installation of the App granting what it asks today: issues write beside the rest. */
const GRANTING_ISSUES = {
  contents: "write",
  metadata: "read",
  pull_requests: "write",
  issues: "write",
} as const;

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The route over the test's own database and the GitHub given: one request in, its response out. */
const routeOver = (bearers: ReadonlyMap<string, string>, github: FakeGitHub) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on oRPC's own fiber, so it is handed the test's clock: the account rows hang off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const handled = yield* Effect.context<GitHubApp>().pipe(Effect.provide(services));
    const handle = hostedFetch({
      github: githubProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
        resolveSessionUserId: () => Effect.succeed(Option.none()),
        unlinkGitHub: () => Effect.void,
      }),
    });
    // SAFETY: the repositories procedures yield the database, the GitHub App, and its HTTP client alone, which is all a test provides of the web runtime's services.
    const webServices = handled as Context.Context<WebServices>;
    return (request: Request) => handle(request, webServices);
  });

/** The route over the test's own database and the GitHub given, answering one request. */
const answer = (bearers: ReadonlyMap<string, string>, github: FakeGitHub, request: Request) =>
  Effect.gen(function* () {
    const route = yield* routeOver(bearers, github);
    const response = yield* Effect.promise(() => route(request));
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

/** The owner signed in with GitHub through the App, which reaches nothing on its own; the other signed in with Google alone. */
const openAccounts = (github: FakeGitHub) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const owner = yield* openGithubUser();
    const other = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: other, name: "Test User", email: `${other}@luke.test` });
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const ask = (userId: string | undefined, method = "GET", workspaceIds: string[] = []) => {
      const url = new URL(HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES, ORIGIN);
      for (const id of workspaceIds) url.searchParams.append("workspaceId", id);
      return answer(
        bearers,
        github,
        new Request(url, {
          method,
          headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
        }),
      );
    };
    /** A read of one repository at the path given (its tree or its skills), with the queries given in order. */
    const read = (
      userId: string,
      path: string,
      query: readonly (readonly [name: string, value: string])[],
    ) => {
      const url = new URL(path, ORIGIN);
      for (const [name, value] of query) url.searchParams.append(name, value);
      return answer(
        bearers,
        github,
        new Request(url, { headers: { authorization: `Bearer ${userId}` } }),
      );
    };
    return { owner, other, bearers, ask, read };
  });

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

/** One repository's read answered, as the wire declares it, failing the test where it is not one. */
function readOf<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  answered: Answer,
): S["Type"] {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(schema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's answer: ${read.failure.refusal}`);
  return read.success;
}

/** The answer read as the wire declares it, failing the test where it is not one. */
function listed(answered: Answer) {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(githubRepositoriesAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's answer: ${read.failure.refusal}`);
  return read.success;
}

it.layer(getTestDB())("the repositories route", (it) => {
  it.effect(
    "a workspace lists its connected installation's repositories, most recently updated first",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          {
            id: 7101,
            login: "octocat",
            repositories: [
              { owner: "octocat", name: "dotfiles", updatedAt: "2026-09-01T00:00:00Z" },
              { owner: "octocat", name: "relay", updatedAt: "2026-10-08T00:00:00Z", private: true },
            ],
          },
        ]);
        const { owner, ask } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7101,
          accountId: 9101,
          accountLogin: "octocat",
        });

        const reached = listed(yield* ask(owner, "GET", [workspace]));

        assert.deepEqual(reached, {
          installed: true,
          repositories: [
            {
              owner: "octocat",
              name: "relay",
              fullName: "octocat/relay",
              defaultBranch: "main",
              private: true,
              updatedAt: Date.parse("2026-10-08T00:00:00Z"),
            },
            {
              owner: "octocat",
              name: "dotfiles",
              fullName: "octocat/dotfiles",
              defaultBranch: "main",
              private: false,
              updatedAt: Date.parse("2026-09-01T00:00:00Z"),
            },
          ],
          installationUrl: `https://github.com/apps/${GITHUB_FIXTURE.SLUG}/installations/new`,
        });
        // Note that neither the account's own token nor the App's are in the answer.
        assert.equal(JSON.stringify(reached).includes("ghu_"), false);
        assert.equal(JSON.stringify(reached).includes("ghs_"), false);
      }),
  );

  it.effect("no bearer and a wrong method are refused before GitHub is asked", () =>
    Effect.gen(function* () {
      const github = githubReaching([]);
      const { owner, ask } = yield* openAccounts(github);

      assert.deepEqual(
        yield* ask(undefined),
        refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN),
      );
      assert.deepEqual(
        yield* ask(owner, "POST"),
        refusal(HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED, HOSTED_API_ERROR.METHOD_NOT_ALLOWED),
      );
      assert.equal(github.sent.length, 0);
    }),
  );

  it.effect(
    "a workspace of an installation lists that installation's alone, and a workspace with nothing connected, the personal one named or by default, lists none, uninstalled, as does a first read ahead of the personal workspace",
    () =>
      Effect.gen(function* () {
        // Note that the account's own GitHub sign-in reaches both installations: none of it is listed but the workspace's.
        const github = githubReaching([
          { id: 7201, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
          { id: 7202, login: "octocat", repositories: [{ owner: "octocat", name: "dotfiles" }] },
        ]);
        const { owner, ask } = yield* openAccounts(github);
        const acme = yield* openInstallationWorkspace(owner, {
          installationId: 7201,
          accountId: 9201,
          accountLogin: "acme",
        });
        const bare = yield* openWorkspace(owner);
        const ahead = yield* ask(owner);
        const personal = yield* ensurePersonalWorkspace(owner, yield* fakeWorkspaceSeams);
        assert.ok(Option.isSome(personal));
        const names = (answered: Answer) => {
          const reached = listed(answered);
          return [reached.installed, reached.repositories.map((repository) => repository.fullName)];
        };

        assert.deepEqual(names(yield* ask(owner, "GET", [acme])), [true, ["acme/relay"]]);
        assert.deepEqual(names(yield* ask(owner, "GET", [bare])), [false, []]);
        assert.deepEqual(names(yield* ask(owner, "GET", [personal.value])), [false, []]);
        assert.deepEqual(names(yield* ask(owner)), [false, []]);
        assert.deepEqual(names(ahead), [false, []]);
      }),
  );

  it.effect(
    "a workspace whose installation its account suspended lists none, as not installed, rather than refusing the read as GitHub unavailable",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          {
            id: 7401,
            login: "acme",
            repositories: [{ owner: "acme", name: "relay" }],
            suspendedAt: "2026-10-12T00:00:00Z",
          },
        ]);
        const { owner, ask } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7401,
          accountId: 9401,
          accountLogin: "acme",
        });

        const reached = listed(yield* ask(owner, "GET", [workspace]));

        assert.deepEqual([reached.installed, reached.repositories], [false, []]);
      }),
  );

  it.effect(
    "a repository taken from the installation on GitHub is gone from the very next listing, since none is held between reads",
    () =>
      Effect.gen(function* () {
        const repositories = [
          { owner: "acme", name: "relay" },
          { owner: "acme", name: "ledger" },
        ];
        const github = githubReaching([{ id: 7501, login: "acme", repositories }]);
        const { owner, ask } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7501,
          accountId: 9501,
          accountLogin: "acme",
        });
        const names = (answered: Answer) =>
          listed(answered).repositories.map((repository) => repository.fullName);

        const before = names(yield* ask(owner, "GET", [workspace]));
        // Note that this is GitHub's side alone: an `installation_repositories` delivery stores nothing.
        repositories.pop();
        const after = names(yield* ask(owner, "GET", [workspace]));

        assert.deepEqual(before.toSorted(), ["acme/ledger", "acme/relay"]);
        assert.deepEqual(after, ["acme/relay"]);
      }),
  );

  it.effect(
    "a member reads a folder and the skills of a repository the workspace's installation reaches by the workspace and the repository's name, as a plan's own reads answer them, and one it does not reach is refused as unreachable",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(
          [{ id: 7601, login: "acme", repositories: [{ owner: "acme", name: "relay" }] }],
          undefined,
          {},
          (sent) =>
            new URL(sent.url).pathname === "/repos/acme/relay/git/trees/main%3Asrc"
              ? Response.json({
                  tree: [
                    { path: "invite.ts", type: "blob" },
                    { path: "mail", type: "tree" },
                  ],
                  truncated: false,
                })
              : undefined,
        );
        const { owner, read } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7601,
          accountId: 9601,
          accountLogin: "acme",
        });
        const place = (repository: string) =>
          [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, repository],
          ] as const;

        const tree = readOf(
          taskTreeAnswerSchema,
          yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE, [
            ...place("acme/relay"),
            ["path", "src"],
          ]),
        );
        const skills = readOf(
          taskSkillsAnswerSchema,
          yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS, place("acme/relay")),
        );
        const elsewhere = readOf(
          taskTreeAnswerSchema,
          yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE, place("acme/ledger")),
        );

        assert.deepEqual(tree, {
          folder: {
            path: "src",
            repository: "acme/relay",
            branch: "main",
            entries: [
              { name: "invite.ts", kind: TASK_TREE_ENTRY.FILE },
              { name: "mail", kind: TASK_TREE_ENTRY.FOLDER },
            ],
            truncated: false,
          },
        });
        assert.deepEqual(skills, {
          skills: { repository: "acme/relay", branch: "main", skills: [] },
        });
        assert.deepEqual(elsewhere, { refusal: TASK_FILE_REFUSAL.NOT_REACHABLE });
      }),
  );

  it.effect(
    "a repository's read in a workspace the account is not in is not found, and one naming no repository is invalid, before GitHub is asked",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 7701, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
        ]);
        const { owner, other, read } = yield* openAccounts(github);
        const theirs = yield* openInstallationWorkspace(other, {
          installationId: 7701,
          accountId: 9701,
          accountLogin: "acme",
        });
        const mine = yield* openWorkspace(owner);

        for (const path of [
          HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE,
          HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS,
        ]) {
          assert.deepEqual(
            yield* read(owner, path, [
              [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, theirs],
              [GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay"],
            ]),
            refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
            path,
          );
          assert.deepEqual(
            yield* read(owner, path, [[GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, mine]]),
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
            path,
          );
        }
        assert.equal(github.sent.length, 0);
      }),
  );

  it.effect(
    "a member reads one pull request of a repository the workspace's installation reaches by its number, its number, title, page, state, who opened it with their avatar, its size, when it was opened, its branches, labels, and comment and commit counts and nothing more, a merged one as merged, and one whose author's account is gone naming no one",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(
          [{ id: 7801, login: "acme", repositories: [{ owner: "acme", name: "relay" }] }],
          undefined,
          {},
          (sent) => {
            const pulled = PULL_PATH.exec(new URL(sent.url).pathname);
            const record = pulled === null ? undefined : RELAY_PULLS.get(Number(pulled[1]));
            return record === undefined ? undefined : Response.json(record);
          },
        );
        const { owner, read } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7801,
          accountId: 9801,
          accountLogin: "acme",
        });
        const pullRequest = (number: number) =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST, [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay"],
            [GITHUB_REPOSITORIES_QUERY.NUMBER, String(number)],
          ]);

        const open = yield* pullRequest(42);
        const merged = yield* pullRequest(43);

        assert.deepEqual(open, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            pullRequest: {
              number: 42,
              title: "Send invitations in batches",
              url: "https://github.com/acme/relay/pull/42",
              state: PULL_REQUEST_STATE.OPEN,
              author: "octo-dev",
              authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
              authorBot: false,
              additions: 12,
              deletions: 3,
              changedFiles: 2,
              openedAt: Date.parse("2026-10-01T09:30:00Z"),
              baseRef: "main",
              headRef: "invites-42",
              labels: [{ name: "invites", color: "4fd18b" }],
              comments: 5,
              commits: 4,
            },
          },
        });
        assert.deepEqual(readOf(githubRepositoryPullRequestAnswerSchema, merged), {
          pullRequest: {
            number: 43,
            title: "Retry a bounced invitation",
            url: "https://github.com/acme/relay/pull/43",
            state: PULL_REQUEST_STATE.MERGED,
            additions: 12,
            deletions: 3,
            changedFiles: 2,
            headRef: "invites-43",
          },
        });
      }),
  );

  it.effect(
    "a pull request of a repository the installation does not reach, or of a number the repository holds none under, answers none",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(
          [{ id: 7802, login: "acme", repositories: [{ owner: "acme", name: "relay" }] }],
          undefined,
          {},
          (sent) =>
            new URL(sent.url).pathname === "/repos/acme/ledger/pulls/42"
              ? Response.json(pullRecord(42, "Settle the ledger", { merged: false, draft: false }))
              : undefined,
        );
        const { owner, read } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7802,
          accountId: 9802,
          accountLogin: "acme",
        });
        const pullRequest = (repository: string, number: number) =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST, [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, repository],
            [GITHUB_REPOSITORIES_QUERY.NUMBER, String(number)],
          ]);

        const unreached = yield* pullRequest("acme/ledger", 42);
        const missing = yield* pullRequest("acme/relay", 99);

        const none = { status: HOSTED_HTTP_STATUS.OK, body: { pullRequest: null } };
        assert.deepEqual(unreached, none);
        assert.deepEqual(missing, none);
      }),
  );

  it.effect(
    "a pull request's read in a workspace the account is not in is not found, and one naming no number, or one that is not a pull request's, is invalid, before GitHub is asked",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 7803, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
        ]);
        const { owner, other, read } = yield* openAccounts(github);
        const theirs = yield* openInstallationWorkspace(owner, {
          installationId: 7803,
          accountId: 9803,
          accountLogin: "acme",
        });
        const place = [
          [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, theirs],
          [GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay"],
        ] as const;
        const numbered = (...numbers: string[]) =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST, [
            ...place,
            ...numbers.map((number) => [GITHUB_REPOSITORIES_QUERY.NUMBER, number] as const),
          ]);

        const stranger = yield* read(other, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_PULL_REQUEST, [
          ...place,
          [GITHUB_REPOSITORIES_QUERY.NUMBER, "42"],
        ]);
        const unnumbered = [
          yield* numbered(),
          yield* numbered("0"),
          yield* numbered("4.2"),
          yield* numbered("forty-two"),
          yield* numbered("42", "43"),
        ];

        assert.deepEqual(
          stranger,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        for (const answered of unnumbered) {
          assert.deepEqual(
            answered,
            refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
          );
        }
        assert.equal(github.sent.length, 0);
      }),
  );

  it.effect(
    "a member reads one issue of a repository the workspace's installation reaches by its number, its number, title, page, state, and who opened it and nothing more, on a token minted for the one repository with issues read alone; a duplicate reads as not planned, and a pull request's number, a missing one, and an unreached repository answer none",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(
          [
            {
              id: 7811,
              login: "acme",
              repositories: [{ owner: "acme", name: "relay" }],
              permissions: GRANTING_ISSUES,
            },
          ],
          undefined,
          {},
          (sent) => {
            const named = ISSUE_PATH.exec(new URL(sent.url).pathname);
            const record = named === null ? undefined : RELAY_ISSUES.get(Number(named[1]));
            return record === undefined ? undefined : Response.json(record);
          },
        );
        const { owner, read } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7811,
          accountId: 9811,
          accountLogin: "acme",
        });
        const issue = (number: number, repository = "acme/relay") =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUE, [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, repository],
            [GITHUB_REPOSITORIES_QUERY.NUMBER, String(number)],
          ]);
        const page = (number: number) => `https://github.com/acme/relay/issues/${number}`;

        const open = yield* issue(7);
        const states = [yield* issue(8), yield* issue(9), yield* issue(10)].map(
          (each) => readOf(githubRepositoryIssueAnswerSchema, each).issue?.state,
        );
        const none = [yield* issue(42), yield* issue(99), yield* issue(7, "acme/ledger")];

        assert.deepEqual(open, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            issue: {
              number: 7,
              title: "Invitations expire too soon",
              url: page(7),
              state: ISSUE_STATE.OPEN,
              author: "octo-dev",
              authorBot: false,
            },
          },
        });
        assert.deepEqual(states, [
          ISSUE_STATE.CLOSED,
          ISSUE_STATE.NOT_PLANNED,
          ISSUE_STATE.NOT_PLANNED,
        ]);
        for (const answered of none) {
          assert.deepEqual(answered, { status: HOSTED_HTTP_STATUS.OK, body: { issue: null } });
        }
        // The listing that finds the repository mints its own token; every token the issue is read on is cut to issues read on the one repository.
        const mints = github.sent
          .filter((sent) => sent.url.endsWith("/access_tokens"))
          .map((sent) => JSON.parse(sent.body))
          .filter((mint) => "repositories" in mint);
        assert.ok(mints.length > 0);
        for (const mint of mints) {
          assert.deepEqual(mint, { repositories: ["relay"], permissions: { issues: "read" } });
        }
      }),
  );

  it.effect(
    "an issue of a repository whose installation does not grant the App issues, or whose issues are turned off, answers none, and the first mints no token for the repository and asks GitHub for no issue",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(
          [
            { id: 7812, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
            {
              id: 7813,
              login: "globex",
              repositories: [{ owner: "globex", name: "ledger" }],
              permissions: GRANTING_ISSUES,
            },
          ],
          undefined,
          {},
          (sent) =>
            new URL(sent.url).pathname.includes("/issues/")
              ? Response.json({ message: "Issues are disabled for this repo" }, { status: 410 })
              : undefined,
        );
        const { owner, read } = yield* openAccounts(github);
        const ungranted = yield* openInstallationWorkspace(owner, {
          installationId: 7812,
          accountId: 9812,
          accountLogin: "acme",
        });
        const turnedOff = yield* openInstallationWorkspace(owner, {
          installationId: 7813,
          accountId: 9813,
          accountLogin: "globex",
        });
        const issue = (workspace: string, repository: string) =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUE, [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, repository],
            [GITHUB_REPOSITORIES_QUERY.NUMBER, "7"],
          ]);

        const notGranted = yield* issue(ungranted, "acme/relay");
        // The listing that looks for the repository mints its own token; none is minted for the repository, and no issue is asked.
        const forTheIssue = github.sent
          .filter(
            (sent) =>
              new URL(sent.url).pathname.includes("/issues/") ||
              (sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body)),
          )
          .map((sent) => sent.url);
        const off = yield* issue(turnedOff, "globex/ledger");

        const none = { status: HOSTED_HTTP_STATUS.OK, body: { issue: null } };
        assert.deepEqual(notGranted, none);
        assert.deepEqual(off, none);
        assert.deepEqual(forTheIssue, []);
      }),
  );

  it.effect(
    "a member reads a repository's open issues newest changed first, those a search finds, and one by its number, each with who opened it and how they stand to the repository, never a pull request, read past a page of them, and never another repository's, on a token cut to issues read on the one repository",
    () =>
      Effect.gen(function* () {
        const searched: URLSearchParams[] = [];
        const listedWith: URLSearchParams[] = [];
        const github = githubReaching(
          [
            {
              id: 7821,
              login: "acme",
              repositories: [{ owner: "acme", name: "relay" }],
              permissions: GRANTING_ISSUES,
            },
          ],
          undefined,
          {},
          (sent) => {
            const url = new URL(sent.url);
            // The first page is all pull requests, which share the listing, and issue 7 stands on the second.
            if (url.pathname === RELAY_ISSUES_PATH) {
              listedWith.push(url.searchParams);
              return Response.json(
                url.searchParams.get("page") === "1"
                  ? Array.from({ length: 100 }, (_, at) => ({
                      ...issueRecord(100 + at, "A pull request", "open", null),
                      pull_request: {},
                    }))
                  : [RELAY_ISSUES.get(7)],
              );
            }
            if (url.pathname === SEARCH_PATH) {
              searched.push(url.searchParams);
              return Response.json({
                items: [
                  RELAY_ISSUES.get(7),
                  {
                    ...issueRecord(3, "Invitations on the ledger", "open", null),
                    html_url: "https://github.com/acme/ledger/issues/3",
                  },
                ],
              });
            }
            const named = ISSUE_PATH.exec(url.pathname);
            const record = named === null ? undefined : RELAY_ISSUES.get(Number(named[1]));
            return record === undefined ? undefined : Response.json(record);
          },
        );
        const { owner, read } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7821,
          accountId: 9821,
          accountLogin: "acme",
        });
        const issues = (...more: readonly (readonly [string, string])[]) =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUES, [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay"],
            ...more,
          ]);

        const open = yield* issues();
        const found = yield* issues([GITHUB_REPOSITORIES_QUERY.QUERY, " invite "]);
        const one = yield* issues([GITHUB_REPOSITORIES_QUERY.NUMBER, "9"]);
        const pull = yield* issues([GITHUB_REPOSITORIES_QUERY.NUMBER, "42"]);

        const seven = relayPick(7, "Invitations expire too soon", ISSUE_STATE.OPEN, "MEMBER");
        assert.deepEqual(open, { status: HOSTED_HTTP_STATUS.OK, body: { issues: [seven] } });
        assert.deepEqual(found, { status: HOSTED_HTTP_STATUS.OK, body: { issues: [seven] } });
        assert.deepEqual(one, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            issues: [relayPick(9, "Invite by phone number", ISSUE_STATE.NOT_PLANNED, "NONE")],
          },
        });
        assert.deepEqual(pull, { status: HOSTED_HTTP_STATUS.OK, body: { issues: [] } });
        assert.deepEqual(
          listedWith.map((params) => [params.get("state"), params.get("sort"), params.get("page")]),
          [
            ["open", "updated", "1"],
            ["open", "updated", "2"],
          ],
        );
        assert.deepEqual(
          searched.map((params) => params.get("q")),
          ["invite repo:acme/relay is:issue is:open"],
        );
        const mints = github.sent
          .filter((sent) => sent.url.endsWith("/access_tokens"))
          .map((sent) => JSON.parse(sent.body))
          .filter((mint) => "repositories" in mint);
        for (const mint of mints) {
          assert.deepEqual(mint, { repositories: ["relay"], permissions: { issues: "read" } });
        }
      }),
  );

  it.effect(
    "a repository whose installation has not granted the App issues answers ungranted with the installation's settings page, never an empty list, and asks GitHub for no issue; an unreached repository has none, and a read naming a number off the wire's shape is invalid",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          {
            id: 7822,
            login: "acme",
            accountType: "Organization",
            repositories: [{ owner: "acme", name: "relay" }],
          },
        ]);
        const { owner, read } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7822,
          accountId: 9822,
          accountLogin: "acme",
        });
        const issues = (repository: string, ...more: readonly (readonly [string, string])[]) =>
          read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUES, [
            [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace],
            [GITHUB_REPOSITORIES_QUERY.REPOSITORY, repository],
            ...more,
          ]);

        const ungranted = yield* issues("acme/relay");
        const unreached = yield* issues("globex/ledger");
        const unnumbered = yield* issues("acme/relay", [GITHUB_REPOSITORIES_QUERY.NUMBER, "0"]);

        assert.deepEqual(ungranted, {
          status: HOSTED_HTTP_STATUS.OK,
          body: {
            ungranted: {
              settingsUrl: "https://github.com/organizations/acme/settings/installations/7822",
            },
          },
        });
        assert.deepEqual(unreached, { status: HOSTED_HTTP_STATUS.OK, body: { issues: [] } });
        assert.deepEqual(
          unnumbered,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        const askedIssues = github.sent.filter((sent) => {
          const { pathname } = new URL(sent.url);
          return pathname.includes("/issues") || pathname === SEARCH_PATH;
        });
        assert.deepEqual(askedIssues, []);
      }),
  );

  it.effect(
    "an issue's read in a workspace the account is not in is not found, and one naming no number is invalid, before GitHub is asked",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          {
            id: 7814,
            login: "acme",
            repositories: [{ owner: "acme", name: "relay" }],
            permissions: GRANTING_ISSUES,
          },
        ]);
        const { owner, other, read } = yield* openAccounts(github);
        const theirs = yield* openInstallationWorkspace(owner, {
          installationId: 7814,
          accountId: 9814,
          accountLogin: "acme",
        });
        const place = [
          [GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, theirs],
          [GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay"],
        ] as const;

        const stranger = yield* read(other, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUE, [
          ...place,
          [GITHUB_REPOSITORIES_QUERY.NUMBER, "7"],
        ]);
        const unnumbered = yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_ISSUE, [
          ...place,
          [GITHUB_REPOSITORIES_QUERY.NUMBER, "0"],
        ]);

        assert.deepEqual(
          stranger,
          refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
        );
        assert.deepEqual(
          unnumbered,
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(github.sent.length, 0);
      }),
  );

  it.effect(
    "a workspace the account is not in is not found, and two named are invalid, before GitHub is asked",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          { id: 7301, login: "acme", repositories: [{ owner: "acme", name: "relay" }] },
        ]);
        const { owner, other, ask } = yield* openAccounts(github);
        const theirs = yield* openInstallationWorkspace(other, {
          installationId: 7301,
          accountId: 9301,
          accountLogin: "acme",
        });
        const mine = yield* openWorkspace(owner);

        assert.deepEqual(
          [yield* ask(owner, "GET", [theirs]), yield* ask(owner, "GET", ["nowhere"])],
          [
            refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
            refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
          ],
        );
        assert.deepEqual(
          yield* ask(owner, "GET", [mine, mine]),
          refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST),
        );
        assert.equal(github.sent.length, 0);
      }),
  );
  it.effect(
    "an unsigned caller is refused as unauthenticated before its query is read, and a refusal is the old group's bytes",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([]);
        const { other, bearers } = yield* openAccounts(github);
        const route = yield* routeOver(bearers, github);
        const bytes = (url: string, headers: Record<string, string> = {}) =>
          Effect.promise(async () => {
            const response = await route(new Request(new URL(url, ORIGIN), { headers }));
            return {
              status: response.status,
              contentType: response.headers.get("content-type"),
              cacheControl: response.headers.get("cache-control"),
              text: await response.text(),
            };
          });
        const malformed = `${HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE}?workspaceId=a&workspaceId=b&recursive=yes`;

        assert.deepEqual(yield* bytes(malformed), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          contentType: "application/json",
          cacheControl: null,
          text: '{"error":"invalid-token"}',
        });
        assert.deepEqual(yield* bytes(malformed, { authorization: `Bearer ${other}` }), {
          status: HOSTED_HTTP_STATUS.BAD_REQUEST,
          contentType: "application/json",
          cacheControl: null,
          text: '{"error":"invalid-request"}',
        });
        assert.deepEqual(
          yield* bytes(
            `${HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS}?workspaceId=elsewhere&repository=acme%2Frelay`,
            { authorization: `Bearer ${other}` },
          ),
          {
            status: HOSTED_HTTP_STATUS.NOT_FOUND,
            contentType: "application/json",
            cacheControl: null,
            text: '{"error":"not-found"}',
          },
        );
        assert.equal(github.sent.length, 0);
      }),
  );

  it.effect(
    "the desktop's client reads through the route: the listing, a folder, a repository out of reach as unreachable, and nothing from a workspace it is not in",
    () =>
      Effect.gen(function* () {
        const github = githubReaching(
          [{ id: 7901, login: "acme", repositories: [{ owner: "acme", name: "relay" }] }],
          undefined,
          {},
          (sent) =>
            new URL(sent.url).pathname === "/repos/acme/relay/git/trees/main%3Asrc"
              ? Response.json({ tree: [{ path: "invite.ts", type: "blob" }], truncated: false })
              : undefined,
        );
        const { owner, other, bearers } = yield* openAccounts(github);
        const workspace = yield* openInstallationWorkspace(owner, {
          installationId: 7901,
          accountId: 9901,
          accountLogin: "acme",
        });
        const route = yield* routeOver(bearers, github);
        const service = recordingHttpClient((sent) => route(new Request(sent.url, sent.init)));
        const desktopOf = (userId: string) =>
          new HostedTaskClient({
            serviceBaseUrl: ORIGIN,
            credential: accountBearer({
              readAccessToken: () => Effect.succeed(userId),
              refreshAccount: () => Effect.void,
              readAccountKey: () => Effect.succeed(userId),
            }),
          });
        const desktop = desktopOf(owner);
        const asked = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
          Effect.provide(effect, service.layer);

        const repositories = yield* asked(desktop.repositories(workspace));
        const folder = yield* asked(
          desktop.readRepositoryTree(
            { workspaceId: workspace, repository: "acme/relay" },
            { path: "src" },
          ),
        );
        const unreached = yield* asked(
          desktop.readRepositoryTree(
            { workspaceId: workspace, repository: "acme/ledger" },
            { path: "" },
          ),
        );
        const stranger = yield* asked(
          desktopOf(other).readRepositorySkills({
            workspaceId: workspace,
            repository: "acme/relay",
          }),
        );

        assert.deepEqual(
          repositories.ok
            ? repositories.answer.repositories.map((listed) => listed.fullName)
            : repositories,
          ["acme/relay"],
        );
        assert.deepEqual(folder, {
          folder: {
            path: "src",
            repository: "acme/relay",
            branch: "main",
            entries: [{ name: "invite.ts", kind: TASK_TREE_ENTRY.FILE }],
            truncated: false,
          },
        });
        assert.deepEqual(unreached, { refusal: TASK_FILE_REFUSAL.NOT_REACHABLE });
        assert.equal(stranger, undefined);
        assert.deepEqual(
          service.requests.map((sent) => `${sent.method} ${sent.pathname}${sent.search}`),
          [
            `GET /api/github/repositories?workspaceId=${workspace}`,
            `GET /api/github/repositories/tree?workspaceId=${workspace}&repository=acme%2Frelay&path=src`,
            `GET /api/github/repositories/tree?workspaceId=${workspace}&repository=acme%2Fledger`,
            `GET /api/github/repositories/skills?workspaceId=${workspace}&repository=acme%2Frelay`,
          ],
        );
      }),
  );
});
