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
  githubRepositoryPullRequestAnswerSchema,
  HOSTED_SERVICE_PATH,
} from "@luke/features";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import {
  PLAN_FILE_REFUSAL,
  PLAN_TREE_ENTRY,
  planSkillsAnswerSchema,
  planTreeAnswerSchema,
} from "@luke/features/plan-wire";
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
  };
}

/** The pull requests `acme/relay` holds: one open, one merged. */
const RELAY_PULLS = new Map([
  [42, pullRecord(42, "Send invitations in batches", { merged: false, draft: false })],
  [43, pullRecord(43, "Retry a bounced invitation", { merged: true, draft: false })],
]);

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
          planTreeAnswerSchema,
          yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE, [
            ...place("acme/relay"),
            ["path", "src"],
          ]),
        );
        const skills = readOf(
          planSkillsAnswerSchema,
          yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_SKILLS, place("acme/relay")),
        );
        const elsewhere = readOf(
          planTreeAnswerSchema,
          yield* read(owner, HOSTED_SERVICE_PATH.GITHUB_REPOSITORY_TREE, place("acme/ledger")),
        );

        assert.deepEqual(tree, {
          folder: {
            path: "src",
            repository: "acme/relay",
            branch: "main",
            entries: [
              { name: "invite.ts", kind: PLAN_TREE_ENTRY.FILE },
              { name: "mail", kind: PLAN_TREE_ENTRY.FOLDER },
            ],
            truncated: false,
          },
        });
        assert.deepEqual(skills, {
          skills: { repository: "acme/relay", branch: "main", skills: [] },
        });
        assert.deepEqual(elsewhere, { refusal: PLAN_FILE_REFUSAL.NOT_REACHABLE });
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
    "a member reads one pull request of a repository the workspace's installation reaches by its number, its number, title, page, and state and nothing more, a merged one as merged",
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
            },
          },
        });
        assert.deepEqual(readOf(githubRepositoryPullRequestAnswerSchema, merged), {
          pullRequest: {
            number: 43,
            title: "Retry a bounced invitation",
            url: "https://github.com/acme/relay/pull/43",
            state: PULL_REQUEST_STATE.MERGED,
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
