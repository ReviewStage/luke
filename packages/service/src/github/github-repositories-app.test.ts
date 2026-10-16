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
  GITHUB_REPOSITORIES_QUERY,
  githubRepositoriesAnswerSchema,
  githubRepositoryIssueAnswerSchema,
  githubRepositoryPullRequestAnswerSchema,
  HOSTED_SERVICE_PATH,
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
import { Clock, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  type FakeGitHub,
  GITHUB_FIXTURE,
  githubReaching,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { githubRepositoriesApp } from "./github-repositories-app.js";

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
  };
}

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

/** The group over the test's own database and the GitHub given, answering one request. */
const answer = (bearers: ReadonlyMap<string, string>, github: FakeGitHub, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock: the account rows hang off it.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      githubRepositoriesApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
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
    return { owner, other, ask, read };
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
    "a member reads one pull request of a repository the workspace's installation reaches by its number, its number, title, page, state, who opened it, its size, when it was opened, its branches, labels, and comment and commit counts and nothing more, a merged one as merged, and one whose author's account is gone naming no one",
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
});
