import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openInstallationWorkspace } from "@luke/database/testing";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { prFetchAnswerSchema } from "@luke/features/pr-fetch-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  type FakeGitHub,
  GITHUB_FIXTURE_INSTALLATION_TOKEN,
  githubReaching,
  openGithubUser,
  type SentToGitHub,
} from "../testing/github-app-fake.js";
import { prFetchApp } from "./pr-fetch-app.js";

/**
 * The pull-request fetch route over the real `GitHubApp`, a GitHub the test
 * scripts, and the account and workspace rows on a real dialect: a member of
 * the workspace is handed the pull request's head as GitHub holds it and a
 * token limited to the one repository and to contents read, never to
 * someone outside the workspace, and never for a repository or a pull
 * request the installation does not reach.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

interface Answer {
  readonly status: number;
  readonly cacheControl: string | null;
  readonly body: WireBoundaryInput;
}

/** GitHub's record of pull request 7 on octocat/relay; any other number is not found. */
function pullRequests(sent: SentToGitHub): Response | undefined {
  const { pathname } = new URL(sent.url);
  if (!pathname.startsWith("/repos/octocat/relay/pulls/")) return undefined;
  if (pathname !== "/repos/octocat/relay/pulls/7") {
    return Response.json({ message: "Not Found" }, { status: 404 });
  }
  return Response.json({
    number: 7,
    title: "Fix the relay",
    html_url: "https://github.com/octocat/relay/pull/7",
    state: "open",
    draft: false,
    merged: false,
    additions: 1,
    deletions: 1,
    changed_files: 1,
    head: { ref: "fix-relay", sha: HEAD_SHA },
  });
}

/** The installations the suite has connected, each test its own, since the store refuses one connected twice. */
let installationsOpened = 0;

/** A fresh installation on octocat reaching octocat/relay, and the GitHub that holds it and pull request 7. */
function relayGitHub() {
  installationsOpened += 1;
  const installation = {
    id: 7200 + installationsOpened,
    login: "octocat",
    repositories: [{ owner: "octocat", name: "relay", private: true }],
  };
  return { installation, github: githubReaching([installation], undefined, {}, pullRequests) };
}

/** The group over the test's own database and the GitHub given, answering one request. */
const answer = (bearers: ReadonlyMap<string, string>, github: FakeGitHub, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      github.layer,
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      prFetchApp({
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
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body,
    } satisfies Answer;
  });

/** The owner of a workspace connected to a relay installation of its own, and an account outside it. */
const openAccounts = () =>
  Effect.gen(function* () {
    const { installation, github } = relayGitHub();
    const db = yield* Database;
    const owner = yield* openGithubUser();
    const other = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: other, name: "Test User", email: `${other}@luke.test` });
    const workspace = yield* openInstallationWorkspace(owner, {
      installationId: installation.id,
      accountId: 9200 + installation.id,
      accountLogin: "octocat",
    });
    const bearers = new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]);
    const ask = (
      userId: string,
      body: Readonly<Record<string, string | number>>,
      method = "POST",
    ) =>
      answer(
        bearers,
        github,
        new Request(new URL(HOSTED_SERVICE_PATH.GITHUB_PR_FETCH, ORIGIN), {
          method,
          headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
          ...(method === "POST" ? { body: JSON.stringify(body) } : undefined),
        }),
      );
    return { github, owner, other, workspace, ask };
  });

/** The repository-scoped mints GitHub was asked for, by the permissions each named. */
function repositoryMints(github: FakeGitHub) {
  return github.sent
    .filter(
      (sent) => sent.url.endsWith("/access_tokens") && "repositories" in JSON.parse(sent.body),
    )
    .map((sent) => JSON.parse(sent.body));
}

it.layer(getTestDB())("the pull-request fetch route", (it) => {
  it.effect(
    "a member is handed the pull request's head and a contents-read token for its repository alone, not to be stored",
    () =>
      Effect.gen(function* () {
        const { github, owner, workspace, ask } = yield* openAccounts();

        const answered = yield* ask(owner, {
          workspaceId: workspace,
          repository: "octocat/relay",
          prNumber: 7,
        });

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(answered.cacheControl, "private, no-store");
        const read = readEither(prFetchAnswerSchema)(unparsedWire(answered.body));
        if (Result.isFailure(read)) return assert.fail(read.failure.refusal);
        assert.deepEqual(read.success, {
          workspaceId: workspace,
          repository: "octocat/relay",
          prNumber: 7,
          headSha: HEAD_SHA,
          headRef: "fix-relay",
          token: GITHUB_FIXTURE_INSTALLATION_TOKEN,
          expiresAt: "2026-10-01T01:00:00Z",
        });
        // The pull request was read on a token with pull requests read; the one handed out is contents read alone.
        assert.deepEqual(repositoryMints(github), [
          { repositories: ["relay"], permissions: { contents: "read", pull_requests: "read" } },
          { repositories: ["relay"], permissions: { contents: "read" } },
        ]);
      }),
  );

  it.effect("an account outside the workspace is not found, and no token is minted", () =>
    Effect.gen(function* () {
      const { github, other, workspace, ask } = yield* openAccounts();

      const answered = yield* ask(other, {
        workspaceId: workspace,
        repository: "octocat/relay",
        prNumber: 7,
      });

      assert.equal(answered.status, HOSTED_HTTP_STATUS.NOT_FOUND);
      assert.deepEqual(answered.body, { error: HOSTED_API_ERROR.NOT_FOUND });
      assert.deepEqual(repositoryMints(github), []);
    }),
  );

  it.effect(
    "a repository the installation does not reach is refused as out of reach, with no token",
    () =>
      Effect.gen(function* () {
        const { github, owner, workspace, ask } = yield* openAccounts();

        const answered = yield* ask(owner, {
          workspaceId: workspace,
          repository: "octocat/elsewhere",
          prNumber: 7,
        });

        assert.deepEqual(answered.body, { error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE });
        assert.deepEqual(repositoryMints(github), []);
      }),
  );

  it.effect(
    "a pull request the repository does not hold is not found, and no contents token is minted",
    () =>
      Effect.gen(function* () {
        const { github, owner, workspace, ask } = yield* openAccounts();

        const answered = yield* ask(owner, {
          workspaceId: workspace,
          repository: "octocat/relay",
          prNumber: 8,
        });

        assert.equal(answered.status, HOSTED_HTTP_STATUS.NOT_FOUND);
        assert.deepEqual(answered.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.deepEqual(
          repositoryMints(github).map((mint) => mint.permissions),
          [{ contents: "read", pull_requests: "read" }],
        );
      }),
  );

  it.effect(
    "a request off the wire's shape, or by another method, is refused before anything is read",
    () =>
      Effect.gen(function* () {
        const { github, owner, workspace, ask } = yield* openAccounts();

        const traversal = yield* ask(owner, {
          workspaceId: workspace,
          repository: "octocat/..",
          prNumber: 7,
        });
        const fraction = yield* ask(owner, {
          workspaceId: workspace,
          repository: "octocat/relay",
          prNumber: 1.5,
        });
        const got = yield* ask(owner, {}, "GET");

        assert.deepEqual(traversal.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        assert.deepEqual(fraction.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        assert.deepEqual(got.body, { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED });
        assert.deepEqual(repositoryMints(github), []);
      }),
  );
});
