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
import { githubRepositoriesAnswerSchema, HOSTED_SERVICE_PATH } from "@luke/features";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
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
    return { owner, other, ask };
  });

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

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
