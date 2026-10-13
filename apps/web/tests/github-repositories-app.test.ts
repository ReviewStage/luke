import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { githubRepositoriesAnswerSchema, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { GITHUB_APP_ENVIRONMENT } from "../server/auth-deployment";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { GitHubApp } from "../server/github/github-app";
import { githubRepositoriesApp } from "../server/github-repositories-app";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  type FakeGitHub,
  fakeGitHub,
  GITHUB_FIXTURE,
  githubReaching,
  openGithubUser,
} from "./support/github-app-fake";
import { testSqlClient } from "./support/sql-client";
import { openInstallationWorkspace, openWorkspace } from "./support/workspaces";

/**
 * The repositories route over the real `GitHubApp`, a GitHub the test
 * scripts, and the account rows on a real dialect: the bearer names the
 * account whose token reads GitHub, the answer is what the App reaches for
 * that account with where to install it, and an account that must sign in
 * again or a GitHub that could not be read are each refused by name.
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

/** The owner signed in with GitHub through the App; the other signed in with Google alone. */
const openAccounts = (github: FakeGitHub) =>
  Effect.gen(function* () {
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

it.layer(testSqlClient)("the repositories route", (it) => {
  it.effect(
    "lists what the bearer's account reaches through the App, most recently updated first",
    () =>
      Effect.gen(function* () {
        const github = githubReaching([
          {
            id: 1,
            login: "octocat",
            repositories: [
              { owner: "octocat", name: "dotfiles", updatedAt: "2026-09-01T00:00:00Z" },
              { owner: "octocat", name: "relay", updatedAt: "2026-10-08T00:00:00Z", private: true },
            ],
          },
        ]);
        const { owner, ask } = yield* openAccounts(github);

        const reached = listed(yield* ask(owner));

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
        assert.equal(JSON.stringify(reached).includes("ghu_"), false);
      }),
  );

  it.effect(
    "a workspace of an installation lists that installation's repositories alone, and a workspace of none, or none named, lists everything",
    () =>
      Effect.gen(function* () {
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
        const personal = yield* openWorkspace(owner);
        const names = (answered: Answer) => {
          const reached = listed(answered);
          return [reached.installed, reached.repositories.map((repository) => repository.fullName)];
        };

        assert.deepEqual(names(yield* ask(owner, "GET", [acme])), [true, ["acme/relay"]]);
        assert.deepEqual(names(yield* ask(owner, "GET", [personal])), [
          true,
          ["acme/relay", "octocat/dotfiles"],
        ]);
        assert.deepEqual(names(yield* ask(owner)), [true, ["acme/relay", "octocat/dotfiles"]]);
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

  it.effect("an account with the App installed nowhere is told so, with where to install it", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts(githubReaching([]));

      assert.deepEqual(listed(yield* ask(owner)), {
        installed: false,
        repositories: [],
        installationUrl: `https://github.com/apps/${GITHUB_FIXTURE.SLUG}/installations/new`,
      });
    }),
  );

  it.effect(
    "an account that never signed in with GitHub, or whose token GitHub revoked, must sign in again",
    () =>
      Effect.gen(function* () {
        const revoked = fakeGitHub(() =>
          Response.json({ message: "Bad credentials" }, { status: 401 }),
        );
        const { owner, other, ask } = yield* openAccounts(revoked);
        const signIn = refusal(
          HOSTED_HTTP_STATUS.FORBIDDEN,
          HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED,
        );

        assert.deepEqual([yield* ask(owner), yield* ask(other)], [signIn, signIn]);
      }),
  );

  it.effect(
    "a GitHub that could not be read, and a deployment without the App, are unavailable",
    () =>
      Effect.gen(function* () {
        const down = fakeGitHub(() => new Response(null, { status: 503 }));
        const unconfigured = fakeGitHub(
          () => Response.json({}),
          GitHubApp.layer(undefined, [GITHUB_APP_ENVIRONMENT.SLUG]),
        );
        const unavailable = refusal(
          HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          HOSTED_API_ERROR.UNAVAILABLE,
        );

        const { owner, ask } = yield* openAccounts(down);
        const withoutApp = yield* openAccounts(unconfigured);

        assert.deepEqual(yield* ask(owner), unavailable);
        assert.deepEqual(yield* withoutApp.ask(withoutApp.owner), unavailable);
        assert.equal(unconfigured.sent.length, 0);
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
});
