import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GITHUB_FAILURE,
  GITHUB_UNAVAILABLE_ERROR,
  githubRepositoryListAnswerSchema,
} from "@sidecar/hosted";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Option, Result } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { githubApp } from "../server/github-app";
import { GITHUB_SOURCE_BOUNDS } from "../server/hosted/github-source";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { type FakeGitHub, type FakeRepository, fakeGitHub } from "./support/github-fake";

/**
 * The planning window's repository list, answered by the group the way a
 * function answers it: the bearer names the account, the account's GitHub
 * connection is the one read, and what answers is each repository's owner,
 * name, and privacy, from a fake of GitHub at the process boundary.
 *
 * Synthetic accounts, tokens, and repositories throughout.
 */

const ORIGIN = "https://luke.test";
const REPOSITORIES = "/api/github/repositories";
const ACCOUNT = "user-github-app";
const TOKEN = "fixture-token-github-app";

function repository(owner: string, name: string, isPrivate: boolean): FakeRepository {
  return {
    owner,
    name,
    private: isPrivate,
    defaultBranch: "main",
    branches: new Map(),
    commits: new Map(),
  };
}

/** The group answering one request from the account, or from no one. */
const ask = (github: FakeGitHub, userId: string | undefined, method = "GET") =>
  Effect.gen(function* () {
    const { handler, dispose } = HttpRouter.toWebHandler(
      githubApp({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(
              incoming.headers.get("authorization") === `Bearer ${ACCOUNT}` ? ACCOUNT : undefined,
            ),
          ),
      }).pipe(HttpRouter.provideRequest(github.layer)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() =>
      handler(
        new Request(new URL(REPOSITORIES, ORIGIN), {
          method,
          headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
        }),
      ),
    );
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
    yield* Effect.promise(() => dispose());
    return { status: response.status, body };
  });

it.effect("lists the repositories the account's connection reads, private ones included", () =>
  Effect.gen(function* () {
    const github = fakeGitHub();
    github.connect(ACCOUNT, TOKEN, [
      repository("acme", "relay", true),
      repository("acme", "site", false),
    ]);

    assert.deepEqual(yield* ask(github, ACCOUNT), {
      status: HOSTED_HTTP_STATUS.OK,
      body: {
        repositories: [
          { owner: "acme", name: "relay", private: true },
          { owner: "acme", name: "site", private: false },
        ],
        truncated: false,
      },
    });
  }),
);

it.effect("marks the list truncated when the connection reads more than it carries", () =>
  Effect.gen(function* () {
    const github = fakeGitHub();
    const carried =
      GITHUB_SOURCE_BOUNDS.MAX_REPOSITORY_PAGES * GITHUB_SOURCE_BOUNDS.REPOSITORIES_PER_PAGE;
    github.connect(
      ACCOUNT,
      TOKEN,
      Array.from({ length: carried + 1 }, (_, index) => repository("acme", `r${index}`, false)),
    );

    const listed = yield* ask(github, ACCOUNT);

    assert.equal(listed.status, HOSTED_HTTP_STATUS.OK);
    const body = readEither(githubRepositoryListAnswerSchema)(unparsedWire(listed.body));
    if (Result.isFailure(body)) return assert.fail(body.failure.refusal);
    assert.deepEqual([body.success.repositories.length, body.success.truncated], [carried, true]);
  }),
);

it.effect("says why when there is no connection or GitHub refuses it", () =>
  Effect.gen(function* () {
    const unconnected = fakeGitHub();
    const revoked = fakeGitHub();
    revoked.connect(ACCOUNT, TOKEN, [repository("acme", "relay", true)]);
    revoked.revoke(TOKEN);
    const unavailable = (reason: string) => ({
      status: HOSTED_HTTP_STATUS.CONFLICT,
      body: { error: GITHUB_UNAVAILABLE_ERROR, reason },
    });

    assert.deepEqual(yield* ask(unconnected, ACCOUNT), unavailable(GITHUB_FAILURE.NOT_CONNECTED));
    assert.deepEqual(yield* ask(revoked, ACCOUNT), unavailable(GITHUB_FAILURE.ACCESS_DENIED));
    assert.deepEqual(yield* ask(revoked, undefined), {
      status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
      body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
    });
    assert.deepEqual(yield* ask(revoked, ACCOUNT, "POST"), {
      status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
    });
  }),
);
