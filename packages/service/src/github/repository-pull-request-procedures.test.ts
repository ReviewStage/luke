/**
 * repository-pull-request-procedures.test.ts -- a pull request read, changed, or chaptered by its repository and number refuses a non-member exactly as it refuses a number the repository holds none under.
 *
 * Over the real `GitHubApp`, a GitHub the test scripts, and the account and
 * workspace rows on a real dialect. The member reads the pull request and
 * labels it, on their own GitHub sign-in, so the refusals below are the
 * procedures' own and not a route that answers nothing.
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
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@luke/features/pull-request-write-wire";
import { HTTP_METHOD } from "@luke/wire";
import { Clock, type Context, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { pullRequestChaptersProcedures } from "../chapters/pull-request-chapters-procedures.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { githubReaching, openGithubUser, standingGithubRow } from "../testing/github-app-fake.js";
import type { GitHubApp } from "./github-app.js";
import { repositoryPullRequestProcedures } from "./repository-pull-request-procedures.js";

const ORIGIN = "https://luke.test";

/** A change any pull request takes: a label put on it. */
const LABEL = JSON.stringify({ action: PULL_REQUEST_ACTION.ADD_LABEL, label: "ready" });

/** Every ask that reaches the pull request by its number, each naming it in its query: its reads, its change, and a Generate of its chapters. */
const NUMBERED_ASKS = [
  { method: HTTP_METHOD.GET, path: "/api/pull-requests" },
  { method: HTTP_METHOD.GET, path: "/api/pull-requests/changes" },
  { method: HTTP_METHOD.GET, path: "/api/pull-requests/overview/pull-request" },
  { method: HTTP_METHOD.GET, path: "/api/pull-requests/overview/checks" },
  { method: HTTP_METHOD.GET, path: "/api/pull-requests/overview/conversation" },
  { method: HTTP_METHOD.GET, path: "/api/pull-requests/viewed" },
  { method: HTTP_METHOD.POST, path: "/api/pull-requests/action", body: LABEL },
  { method: HTTP_METHOD.POST, path: "/api/pull-requests/chapters" },
] as const;

/** The review options' read, of the repository and so of no number: a member's missing one still answers. */
const REVIEW_OPTIONS_READ = {
  method: HTTP_METHOD.GET,
  path: "/api/pull-requests/review-options",
} as const;

/** The chapters' read, which asks GitHub nothing of the number, so a member's missing one answers as no chapters rather than as none found. */
const CHAPTERS_READ = { method: HTTP_METHOD.GET, path: "/api/pull-requests/chapters" } as const;

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
  if (path === "/repos/acme/relay/issues/42/labels") return Response.json([{ name: "ready" }]);
  if (path === "/repos/acme/relay/labels")
    return Response.json([{ name: "ready", color: "0e8a16" }]);
  if (path === "/repos/acme/relay/assignees") return Response.json([]);
  if (path === "/repos/acme/relay/teams") return Response.json([]);
  return undefined;
}

it.layer(getTestDB())("a pull request by its repository and number", (it) => {
  it.effect(
    "a non-member is refused on every read and write exactly as a pull request the repository does not hold",
    () =>
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
        const seams = {
          resolveUserId: (incoming: Request) =>
            Effect.succeed(
              Option.fromNullishOr(
                incoming.headers.get("authorization")?.match(/^Bearer (user-.+)$/u)?.[1],
              ),
            ),
        };
        const handle = hostedFetch({
          pullRequests: repositoryPullRequestProcedures(seams),
          pullRequestChapters: pullRequestChaptersProcedures(seams),
        });
        const ask = (
          { method, path, body }: { method: string; path: string; body?: string },
          userId: string,
          number: number,
        ) =>
          Effect.gen(function* () {
            const url = new URL(path, ORIGIN);
            url.searchParams.append(GITHUB_REPOSITORIES_QUERY.WORKSPACE_ID, workspace);
            url.searchParams.append(GITHUB_REPOSITORIES_QUERY.REPOSITORY, "acme/relay");
            url.searchParams.append(GITHUB_REPOSITORIES_QUERY.NUMBER, String(number));
            const request = new Request(url, {
              method,
              headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
              ...(body === undefined ? undefined : { body }),
            });
            // SAFETY: the procedures yield the database, the clock, the GitHub App, and its HTTP client alone, which is all a test provides of the web runtime's services.
            const response = yield* Effect.promise(() =>
              handle(request, services as Context.Context<WebServices>),
            );
            return { status: response.status, text: yield* Effect.promise(() => response.text()) };
          });

        const found = yield* ask(NUMBERED_ASKS[0], member, 42);
        assert.equal(found.status, HOSTED_HTTP_STATUS.OK);
        const answer = JSON.parse(found.text);
        assert.deepEqual(
          [answer.repository, answer.branch, answer.pullRequest?.number],
          ["acme/relay", "invites-42", 42],
        );
        const labelled = yield* ask(
          { method: HTTP_METHOD.POST, path: "/api/pull-requests/action", body: LABEL },
          member,
          42,
        );
        assert.deepEqual(labelled, {
          status: HOSTED_HTTP_STATUS.OK,
          text: JSON.stringify({ outcome: PULL_REQUEST_WRITE_OUTCOME.DONE }),
        });
        // The label is put on as the member, on their own sign-in, and never on the token minted for the repository.
        const write = github.sent.find((sent) => new URL(sent.url).pathname.endsWith("/labels"));
        assert.equal(
          write?.headers.get("authorization"),
          `Bearer ${standingGithubRow(0).accessToken}`,
        );
        const notFound = { status: HOSTED_HTTP_STATUS.NOT_FOUND, text: '{"error":"not-found"}' };
        for (const numbered of NUMBERED_ASKS) {
          assert.deepEqual(yield* ask(numbered, member, 99), notFound, numbered.path);
          assert.deepEqual(yield* ask(numbered, outsider, 42), notFound, numbered.path);
        }
        assert.deepEqual(yield* ask(CHAPTERS_READ, outsider, 42), notFound);
        // The review options are the repository's, so a member's missing number answers and only a non-member is refused.
        const options = yield* ask(REVIEW_OPTIONS_READ, member, 99);
        assert.equal(options.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(JSON.parse(options.text), {
          labels: [{ name: "ready", color: "0e8a16" }],
          users: [],
          teams: [],
        });
        assert.deepEqual(yield* ask(REVIEW_OPTIONS_READ, outsider, 42), notFound);
      }),
  );
});
