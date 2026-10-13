import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { user } from "@sidecar/database/schemas/auth";
import { getTestDB } from "@sidecar/database/testing";
import { githubRepositoriesAnswerSchema, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { githubRepositoriesApp } from "../server/github-repositories-app";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import {
  type FakeGitHub,
  GITHUB_FIXTURE,
  githubReaching,
  openGithubUser,
} from "./support/github-app-fake";

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

/** The owner signed in with GitHub through the App; the other signed in with Google alone. */
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
    const ask = (userId: string | undefined, method = "GET") =>
      answer(
        bearers,
        github,
        new Request(new URL(HOSTED_SERVICE_PATH.GITHUB_REPOSITORIES, ORIGIN), {
          method,
          headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
        }),
      );
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
