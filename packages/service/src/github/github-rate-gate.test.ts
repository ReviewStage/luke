import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Layer } from "effect";
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

/** A GitHub whose next answers are the ones queued, and 200 once they run out. */
function scriptedGitHub(answers: (() => Response)[]) {
  return githubRateGate.pipe(
    Layer.provide(fakeHttpClientLayer(() => (answers.shift() ?? (() => Response.json({})))())),
  );
}

const asked = Effect.flatMap(HttpClient.HttpClient, (client) =>
  Effect.map(
    client.execute(
      HttpClientRequest.get(PULL_REQUEST).pipe(HttpClientRequest.bearerToken(INSTALLATION_BEARER)),
    ),
    (response) => response.status,
  ),
);

it.effect("a primary limit holds every request until GitHub's reset", () =>
  Effect.gen(function* () {
    // TestClock starts at the epoch, so a reset 120 s out is 120.
    const exhausted = () =>
      Response.json(
        { message: "API rate limit exceeded" },
        { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "120" } },
      );
    const statuses = yield* Effect.gen(function* () {
      const refused = yield* asked;
      const held = yield* asked;
      yield* TestClock.adjust("119 seconds");
      const stillHeld = yield* asked;
      yield* TestClock.adjust("1 second");
      const sent = yield* asked;
      return [refused, held, stillHeld, sent];
    }).pipe(Effect.provide(scriptedGitHub([exhausted])));
    assert.deepEqual(statuses, [403, 429, 429, 200]);
  }),
);

it.effect(
  "a secondary limit naming no wait holds a minute, then twice as long when refused again",
  () =>
    Effect.gen(function* () {
      const secondary = () =>
        Response.json(
          { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
          { status: 403 },
        );
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

it.effect("a 403 that names no rate limit holds nothing", () =>
  Effect.gen(function* () {
    const forbidden = () =>
      Response.json({ message: "Resource not accessible by integration" }, { status: 403 });
    const statuses = yield* Effect.all([asked, asked]).pipe(
      Effect.provide(scriptedGitHub([forbidden])),
    );
    assert.deepEqual(statuses, [403, 200]);
  }),
);
