import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Fiber, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { TestClock } from "effect/testing";
import { githubRateGate } from "./github-rate-gate.js";

/**
 * The gate over a GitHub that answers whatever the case scripts next, read
 * through the status each request comes back with: a held request answers
 * 429 even where GitHub would have answered 200, which is the request never
 * sent. The waits are GitHub's documented ones: `x-ratelimit-reset` where
 * nothing remains, else a minute, doubling as the refusals repeat.
 */

const PULL_REQUEST = "https://api.github.com/repos/octo/repo/pulls/1";
const INSTALLATION_BEARER = "ghs_fixture-installation-token";

type Answer = () => Response | Promise<Response>;

/** A GitHub whose next answers are the ones queued, and 200 once they run out. */
function scriptedGitHub(answers: Answer[]) {
  return githubRateGate.pipe(
    Layer.provide(fakeHttpClientLayer(() => (answers.shift() ?? (() => Response.json({})))())),
  );
}

const pullRequestAsked = Effect.flatMap(HttpClient.HttpClient, (client) =>
  client.execute(
    HttpClientRequest.get(PULL_REQUEST).pipe(HttpClientRequest.bearerToken(INSTALLATION_BEARER)),
  ),
);

const asked = Effect.map(pullRequestAsked, (response) => response.status);

const secondary = () =>
  Response.json(
    { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
    { status: 403 },
  );

it.effect("a primary limit holds every request until GitHub's reset, however far off", () =>
  Effect.gen(function* () {
    // TestClock starts at the epoch, so a reset an hour out is 3600.
    const exhausted = () =>
      Response.json(
        { message: "API rate limit exceeded" },
        { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "3600" } },
      );
    const statuses = yield* Effect.gen(function* () {
      const refused = yield* asked;
      yield* TestClock.adjust("3599 seconds");
      const held = yield* asked;
      yield* TestClock.adjust("1 second");
      const sent = yield* asked;
      return [refused, held, sent];
    }).pipe(Effect.provide(scriptedGitHub([exhausted])));
    assert.deepEqual(statuses, [403, 429, 200]);
  }),
);

it.effect(
  "a secondary limit naming no wait holds a minute, then twice as long when refused again",
  () =>
    Effect.gen(function* () {
      const statuses = yield* Effect.gen(function* () {
        const first = yield* asked;
        yield* TestClock.adjust("1 minute");
        const second = yield* asked;
        yield* TestClock.adjust("1 minute");
        const heldLonger = yield* asked;
        yield* TestClock.adjust("1 minute");
        const sent = yield* asked;
        return [first, second, heldLonger, sent];
      }).pipe(Effect.provide(scriptedGitHub([secondary, secondary])));
      assert.deepEqual(statuses, [403, 403, 429, 200]);
    }),
);

it.effect("an answer sent before the refusal and landing after it lifts no hold", () =>
  Effect.gen(function* () {
    const late = Promise.withResolvers<Response>();
    const arrived = Promise.withResolvers<void>();
    const lateAnswer = () => {
      arrived.resolve();
      return late.promise;
    };
    const statuses = yield* Effect.gen(function* () {
      const early = yield* Effect.forkChild(asked);
      // Note that the refusal is asked only once the early request is at GitHub.
      yield* Effect.promise(() => arrived.promise);
      const refused = yield* asked;
      late.resolve(Response.json({}));
      const landed = yield* Fiber.join(early);
      const after = yield* asked;
      return [landed, refused, after];
    }).pipe(Effect.provide(scriptedGitHub([lateAnswer, secondary])));
    assert.deepEqual(statuses, [200, 403, 429]);
  }),
);

it.effect("a 403 that names no rate limit holds nothing, and its message is the caller's", () =>
  Effect.gen(function* () {
    const forbidden = () =>
      Response.json({ message: "Resource not accessible by integration" }, { status: 403 });
    const [message, next] = yield* Effect.gen(function* () {
      const refused = yield* pullRequestAsked;
      const body = yield* refused.json;
      return [body, yield* asked] as const;
    }).pipe(Effect.provide(scriptedGitHub([forbidden])));
    assert.deepEqual([message, next], [{ message: "Resource not accessible by integration" }, 200]);
  }),
);
