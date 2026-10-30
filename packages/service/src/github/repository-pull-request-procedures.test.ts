/**
 * repository-pull-request-procedures.test.ts -- a pull request read by its repository and number refuses a non-member exactly as it refuses a number the repository holds none under.
 *
 * Over the real `GitHubApp`, a GitHub the test scripts, and the account and
 * workspace rows on a real dialect. The member reads the pull request, so
 * the refusals below are the reads' own and not a route that reads nothing.
 *
 * Synthetic accounts, bearers, tokens, and repositories throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { user } from "@luke/database/schemas/auth";
import { getTestDB, openInstallationWorkspace } from "@luke/database/testing";
import { GITHUB_REPOSITORIES_QUERY } from "@luke/features";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { githubReaching, openGithubUser } from "../testing/github-app-fake.js";
import type { GitHubApp } from "./github-app.js";
import { repositoryPullRequestProcedures } from "./repository-pull-request-procedures.js";

const ORIGIN = "https://luke.test";

/** Every read of the resource, each naming the pull request in its query. */
const READ_PATHS = [
  "/api/pull-requests",
  "/api/pull-requests/changes",
  "/api/pull-requests/overview/pull-request",
  "/api/pull-requests/overview/checks",
  "/api/pull-requests/overview/conversation",
] as const;

/** `acme/relay`'s pull request 42, open, its head's checks none, as GitHub's API answers each; nothing for any other read. */
function relayRead(sent: { readonly url: string }): Response | undefined {
  const path = new URL(sent.url).pathname;
  if (path === "/repos/acme/relay/pulls/42") {
    return Response.json({
      number: 42,
      title: "Send invitations in batches",
      html_url: "https://github.com/acme/relay/pull/42",
      state: "open",
      draft: false,
      merged: false,
      additions: 12,
      deletions: 3,
      changed_files: 2,
      head: { ref: "invites-42", sha: "sha-42" },
      user: { login: "octo-dev" },
    });
  }
  if (path === "/repos/acme/relay/commits/sha-42/check-runs")
    return Response.json({ check_runs: [] });
  if (path === "/repos/acme/relay/commits/sha-42/status") return Response.json({ statuses: [] });
  return undefined;
}

it.layer(getTestDB())("a pull request by its repository and number", (it) => {
  it.effect("a non-member is refused exactly as a pull request the repository does not hold", () =>
    Effect.gen(function* () {
      const github = githubReaching(
        [{ id: 7802, login: "acme", repositories: [{ owner: "acme", name: "relay" }] }],
        undefined,
        {},
        relayRead,
      );
      const member = yield* openGithubUser();
      const outsider = `user-${randomUUID()}`;
      yield* (yield* Database)
        .insert(user)
        .values({ id: outsider, name: "Test User", email: `${outsider}@luke.test` });
      const workspace = yield* openInstallationWorkspace(member, {
        installationId: 7802,
        accountId: 9802,
        accountLogin: "acme",
      });
      const services = yield* Effect.context<GitHubApp>().pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
            Layer.succeed(Database, yield* Database),
            Layer.succeed(Clock.Clock, yield* Clock.Clock),
            github.layer,
          ),
        ),
      );
      const handle = hostedFetch({
        pullRequests: repositoryPullRequestProcedures({
          resolveUserId: (incoming) =>
            Effect.succeed(
              Option.fromNullishOr(
                incoming.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
              ),
            ),
        }),
      });
      const read = (path: string, userId: string, number: number) =>
        Effect.gen(function* () {
          const url = new URL(path, ORIGIN);
          url.searchParams.append(GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace);
          url.searchParams.append(GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay");
          url.searchParams.append(GITHUB_REPOSITORIES_QUERY.NUMBER, String(number));
          const request = new Request(url, { headers: { authorization: `Bearer ${userId}` } });
          // SAFETY: the procedures yield the database, the clock, the GitHub App, and its HTTP client alone, which is all a test provides of the web runtime's services.
          const response = yield* Effect.promise(() =>
            handle(request, services as Context.Context<WebServices>),
          );
          return { status: response.status, text: yield* Effect.promise(() => response.text()) };
        });

      const found = yield* read("/api/pull-requests", member, 42);
      assert.equal(found.status, HOSTED_HTTP_STATUS.OK);
      const answer = JSON.parse(found.text);
      assert.deepEqual(
        [answer.repository, answer.branch, answer.pullRequest?.number],
        ["acme/relay", "invites-42", 42],
      );
      for (const path of READ_PATHS) {
        const missing = yield* read(path, member, 99);
        const outside = yield* read(path, outsider, 42);
        assert.deepEqual(missing, {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          text: JSON.stringify({ error: "not-found" }),
        });
        assert.deepEqual(outside, missing, path);
      }
    }),
  );
});
