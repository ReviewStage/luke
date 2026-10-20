import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { account, user } from "@luke/database/schemas/auth";
import { githubPersonalToken } from "@luke/database/schemas/github-personal-token";
import { getTestDB } from "@luke/database/testing";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenAnswer,
  githubTokenAnswerSchema,
} from "@luke/features/github-token-wire";
import { EXPERIMENT } from "@luke/settings";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { HTTP_STATUS, jsonResponse, recordingHttpClient } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Cause, Clock, Effect, Layer, Logger, Option, Redacted, Result } from "effect";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { GITHUB_TOKEN_ABSENCE, memberGitHubToken } from "./github-token.js";
import { githubTokenProcedures } from "./github-token-procedures.js";

/**
 * The member's own GitHub token, answered by the procedures the way the
 * hosted oRPC route answers them, over a real dialect and GitHub faked at
 * its HTTP door: a token is kept only where GitHub accepts it with `repo` as
 * the member's own linked account, kept sealed, answered only as a summary,
 * and opened again by the service-side read until a use marks it invalid;
 * a save past the brake keeps nothing, and no answer, refusal, or logged
 * line carries the token.
 *
 * Synthetic accounts and tokens, built at run time so no literal is shaped
 * like a real one; the key-encryption key is fixed bytes written for this file.
 */

const ORIGIN = "https://luke.test";
const TOKEN_PATH = "/api/github/token";
const RING = `1:${Buffer.alloc(32, 1).toString("base64")}`;
const GITHUB_ID = 4242;
const EXPIRES = "2026-12-01 12:00:00 UTC";

const classic = (tail: string) => `ghp_${"0".repeat(32)}${tail}`;
const TOKEN = {
  GOOD: classic("good"),
  REFUSED: classic("rfsd"),
  NO_REPO: classic("nrpo"),
  OTHER: classic("othr"),
  FINE_GRAINED: `github_pat_${"0".repeat(30)}fine`,
} as const;

const ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
};

/** What the fake GitHub answers `GET /user` with, per token; a token it does not know is refused. */
function github(token: string): Response {
  const user = (id: number, scopes: string) =>
    new Response(JSON.stringify({ id, login: `login-${id}` }), {
      headers: {
        "content-type": "application/json",
        "x-oauth-scopes": scopes,
        "github-authentication-token-expiration": EXPIRES,
      },
    });
  switch (token) {
    case TOKEN.GOOD:
      return user(GITHUB_ID, "repo, workflow");
    case TOKEN.NO_REPO:
      return user(GITHUB_ID, "read:user");
    case TOKEN.OTHER:
      return user(GITHUB_ID + 1, "repo");
    default:
      return jsonResponse({}, HTTP_STATUS.UNAUTHORIZED);
  }
}

/** A request to the token's path, as `userId`'s bearer where one is named, carrying the body given as JSON. */
function tokenRequest(
  userId: string | undefined,
  method: string,
  body?: WireBoundaryInput,
): Request {
  return new Request(new URL(TOKEN_PATH, ORIGIN), {
    method,
    headers: {
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
      ...(body === undefined ? undefined : { "content-type": "application/json" }),
    },
    ...(body === undefined ? undefined : { body: JSON.stringify(body) }),
  });
}

/** A member with GitHub linked and the experiment on, another with it off, and the group answering both. */
const openMembers = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, off] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, off]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  yield* db.insert(account).values({
    id: randomUUID(),
    accountId: String(GITHUB_ID),
    providerId: "github",
    userId: owner,
    updatedAt: new Date(0),
  });
  yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.GITHUB_TOKEN]: true } });
  const fake = recordingHttpClient((request) =>
    github(request.authorization?.replace(/^Bearer /u, "") ?? ""),
  );
  const procedures = githubTokenProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(
          incoming.headers.get("authorization")?.replace(/^Bearer /u, "") || undefined,
        ),
      ),
  });
  const logged: string[] = [];
  // Every line the procedures log is kept, so a test can read what they say.
  const recorder = Logger.make(({ message, cause }) => {
    logged.push(`${JSON.stringify(message)} ${Cause.pretty(cause)}`);
  });
  const send = (request: Request, environment: HostedEnvironmentValues = ENVIRONMENT) =>
    Effect.gen(function* () {
      // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
      const services = Layer.mergeAll(
        Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
        Layer.succeed(Database, db),
        Layer.succeed(Clock.Clock, yield* Clock.Clock),
        Layer.succeed(HostedEnvironment, environment),
        fake.layer,
        Logger.layer([recorder]),
      );
      const response = yield* hostedAnswer({ githubToken: procedures }, services, request);
      const text = yield* Effect.promise(() => response.text());
      // SAFETY: the route answers JSON; the test compares it as the wire value it is.
      return {
        status: response.status,
        body: JSON.parse(text) as WireBoundaryInput,
        text,
        contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
      };
    });
  const ask = (userId: string | undefined, method = "GET", body?: WireBoundaryInput) =>
    send(tokenRequest(userId, method, body));
  return { owner, off, ask, send, checks: fake.requests, logged };
});

function answerOf(answered: { status: number; body: WireBoundaryInput }): GitHubTokenAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
  const read = readEither(githubTokenAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

it.layer(getTestDB())("the GitHub token procedures", (it) => {
  it.effect(
    "a token GitHub accepts as the member's own is kept sealed, answered as a summary, opened by the service's read, and removed",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, ask, checks } = yield* openMembers;

        const saved = yield* ask(owner, "PUT", { token: TOKEN.GOOD });
        const read = yield* ask(owner);
        const opened = yield* memberGitHubToken(owner).pipe(
          Effect.provideService(HostedEnvironment, ENVIRONMENT),
        );
        const rows = yield* db
          .select()
          .from(githubPersonalToken)
          .where(eq(githubPersonalToken.userId, owner));

        const { token } = answerOf(saved);
        assert.deepEqual(token && { ...token, statusAt: 0, addedAt: 0 }, {
          login: `login-${GITHUB_ID}`,
          hint: "ghp_…good",
          status: GITHUB_TOKEN_STATUS.VERIFIED,
          statusAt: 0,
          addedAt: 0,
          expiresAt: Date.parse("2026-12-01T12:00:00Z"),
        });
        assert.deepEqual(answerOf(read), answerOf(saved));
        assert.deepEqual(
          [saved.contentType, saved.cacheControl],
          ["application/json", "private, no-store"],
          "answered as the old group answered, never kept by a cache",
        );
        assert.equal(saved.text, JSON.stringify(saved.body), "the wire's own bytes, no more");
        assert.deepEqual(
          checks.map((check) => [
            check.method,
            check.url,
            check.authorization,
            check.accept,
            check.headers.get("x-github-api-version"),
          ]),
          [
            [
              "GET",
              "https://api.github.com/user",
              `Bearer ${TOKEN.GOOD}`,
              "application/vnd.github+json",
              "2022-11-28",
            ],
          ],
          "the save asks GitHub once, the documented way",
        );
        for (const text of [saved.text, read.text, JSON.stringify(rows)]) {
          assert.ok(!text.includes(TOKEN.GOOD), "no answer or column holds the token");
        }
        if (Result.isFailure(opened)) return assert.fail(`not opened: ${opened.failure}`);
        assert.equal(Redacted.value(opened.success.token), TOKEN.GOOD);

        yield* opened.success.markInvalid;
        const afterUse = yield* memberGitHubToken(owner).pipe(
          Effect.provideService(HostedEnvironment, ENVIRONMENT),
        );
        assert.deepEqual(afterUse, Result.fail(GITHUB_TOKEN_ABSENCE.INVALID));
        assert.equal(answerOf(yield* ask(owner)).token?.status, GITHUB_TOKEN_STATUS.INVALID);

        assert.deepEqual(answerOf(yield* ask(owner, "DELETE")), { token: null });
        const removed = yield* memberGitHubToken(owner).pipe(
          Effect.provideService(HostedEnvironment, ENVIRONMENT),
        );
        assert.deepEqual(removed, Result.fail(GITHUB_TOKEN_ABSENCE.NONE));
      }),
  );

  it.effect(
    "a fine-grained token, one GitHub refuses, one without repo, and another GitHub user's keep nothing and say why",
    () =>
      Effect.gen(function* () {
        const { owner, ask, checks } = yield* openMembers;

        const answers = [];
        for (const token of [TOKEN.FINE_GRAINED, TOKEN.REFUSED, TOKEN.NO_REPO, TOKEN.OTHER]) {
          answers.push(answerOf(yield* ask(owner, "PUT", { token })));
        }

        assert.deepEqual(answers, [
          { token: null, rejected: GITHUB_TOKEN_REJECTION.FINE_GRAINED },
          { token: null, rejected: GITHUB_TOKEN_REJECTION.INVALID },
          { token: null, rejected: GITHUB_TOKEN_REJECTION.NO_REPO_SCOPE },
          { token: null, rejected: GITHUB_TOKEN_REJECTION.OTHER_USER },
        ]);
        assert.ok(
          checks.every((check) => !check.authorization?.includes(TOKEN.FINE_GRAINED)),
          "a fine-grained token is never sent to GitHub",
        );
      }),
  );

  it.effect("the path names nothing for a member without the experiment on", () =>
    Effect.gen(function* () {
      const { off, ask } = yield* openMembers;

      const answered = yield* ask(off, "PUT", { token: TOKEN.GOOD });

      assert.deepEqual(
        { status: answered.status, body: answered.body },
        { status: HOSTED_HTTP_STATUS.NOT_FOUND, body: { error: HOSTED_API_ERROR.NOT_FOUND } },
      );
    }),
  );
  it.effect(
    "an unsigned caller is refused whatever it carries, and a method the path does not answer is not taken",
    () =>
      Effect.gen(function* () {
        const { owner, ask, checks } = yield* openMembers;
        const ofAnswer = (answered: { status: number; body: WireBoundaryInput }) => ({
          status: answered.status,
          body: answered.body,
        });
        const unsigned = {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        };

        assert.deepEqual(ofAnswer(yield* ask(undefined)), unsigned);
        assert.deepEqual(ofAnswer(yield* ask(undefined, "PUT", { token: TOKEN.GOOD })), unsigned);
        assert.deepEqual(ofAnswer(yield* ask(undefined, "PUT", { nope: true })), unsigned);
        assert.deepEqual(ofAnswer(yield* ask(undefined, "DELETE")), unsigned);
        assert.deepEqual(ofAnswer(yield* ask(owner, "POST", { token: TOKEN.GOOD })), {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        });
        assert.deepEqual(checks, [], "nothing unsigned or untaken reaches GitHub");
      }),
  );

  it.effect(
    "a member's eleventh save in an hour is braked: it keeps nothing, asks GitHub nothing, and says so",
    () =>
      Effect.gen(function* () {
        const { owner, ask, checks } = yield* openMembers;

        const answers = [];
        for (let attempt = 0; attempt < 10; attempt += 1) {
          answers.push(answerOf(yield* ask(owner, "PUT", { token: TOKEN.REFUSED })));
        }
        const braked = yield* ask(owner, "PUT", { token: TOKEN.GOOD });

        assert.ok(answers.every((answer) => answer.rejected === GITHUB_TOKEN_REJECTION.INVALID));
        assert.deepEqual(answerOf(braked), {
          token: null,
          rejected: GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES,
        });
        assert.ok(
          checks.every((check) => !check.authorization?.includes(TOKEN.GOOD)),
          "the braked token is never sent to GitHub",
        );
        assert.ok(!braked.text.includes(TOKEN.GOOD));
        assert.deepEqual(answerOf(yield* ask(owner)), { token: null }, "and nothing was kept");
      }),
  );

  it.effect(
    "no refusal of a save carries the token, in its body or anything logged, whichever check refused it",
    () =>
      Effect.gen(function* () {
        const { owner, off, ask, send, logged } = yield* openMembers;
        const tooLong = `${TOKEN.GOOD}${"x".repeat(300)}`;
        const padded = JSON.stringify({ token: `${TOKEN.GOOD}${" ".repeat(1_100)}` });
        const refusal = (status: number, error: string) => ({ status, body: { error } });
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
        const unavailable = refusal(
          HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          HOSTED_API_ERROR.UNAVAILABLE,
        );

        const refusals = [
          [yield* ask(owner, "PUT", { token: tooLong }), invalid],
          [yield* ask(owner, "PUT", { token: `${TOKEN.GOOD} ${TOKEN.GOOD}` }), invalid],
          [yield* ask(owner, "PUT", { token: TOKEN.GOOD, scopes: TOKEN.GOOD }), invalid],
          [yield* ask(owner, "PUT", [TOKEN.GOOD]), invalid],
          [
            yield* send(
              new Request(new URL(TOKEN_PATH, ORIGIN), {
                method: "PUT",
                headers: {
                  authorization: `Bearer ${owner}`,
                  "content-type": "application/json",
                  "content-length": String(Buffer.byteLength(padded)),
                },
                body: padded,
              }),
            ),
            refusal(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
          ],
          [
            yield* ask(off, "PUT", { token: TOKEN.GOOD }),
            refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
          ],
          [
            yield* send(tokenRequest(owner, "PUT", { token: TOKEN.GOOD }), {
              ...ENVIRONMENT,
              providerKeyEncryptionKeys: undefined,
            }),
            unavailable,
          ],
          [
            yield* send(tokenRequest(owner, "PUT", { token: TOKEN.GOOD }), {
              ...ENVIRONMENT,
              providerKeyEncryptionKeys: Redacted.make("1:not-a-key-at-all"),
            }),
            unavailable,
          ],
        ] as const;

        for (const [answered, expected] of refusals) {
          assert.deepEqual({ status: answered.status, body: answered.body }, expected);
          for (const token of [TOKEN.GOOD, tooLong]) {
            assert.ok(!answered.text.includes(token), "no refusal's body carries the token");
          }
        }
        assert.ok(logged.length > 0, "the unreadable ring is logged");
        assert.ok(
          logged.every((line) => !line.includes(TOKEN.GOOD) && !line.includes("not-a-key")),
          "no line logs the token or the ring",
        );
      }),
  );
  it.effect(
    "a save whose body is not sent as JSON is refused as an invalid request, keeps nothing, and asks GitHub nothing",
    () =>
      Effect.gen(function* () {
        // Note that the old group read any body as JSON; oRPC reads one only under a JSON content type.
        const { owner, ask, send, checks } = yield* openMembers;
        const untyped = new Request(new URL(TOKEN_PATH, ORIGIN), {
          method: "PUT",
          headers: { authorization: `Bearer ${owner}`, "content-type": "text/plain" },
          body: JSON.stringify({ token: TOKEN.GOOD }),
        });

        const answered = yield* send(untyped);

        assert.deepEqual(
          { status: answered.status, body: answered.body },
          {
            status: HOSTED_HTTP_STATUS.BAD_REQUEST,
            body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
          },
        );
        assert.deepEqual(checks, []);
        assert.deepEqual(answerOf(yield* ask(owner)), { token: null });
      }),
  );
});
