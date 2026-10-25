import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { githubRateHold } from "@luke/database/schemas";
import { getTestDB } from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Clock, Effect, Fiber, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";
import { githubRateGate } from "./github-rate-gate.js";

/**
 * The gate over a GitHub that answers whatever the case scripts next, read
 * through the status each request comes back with: a held request answers
 * 429 even where GitHub would have answered 200, which is the request never
 * sent. The waits are GitHub's documented ones: `x-ratelimit-reset` where
 * nothing remains, else a minute, doubling as the refusals repeat; and a
 * second between the starts of two writes. The file shares one database,
 * where the gate keeps its holds for every instance, and each case starts it
 * holding nothing; two gates over it are two instances.
 */

const PULL_REQUEST = "https://api.github.com/repos/octo/repo/pulls/1";
const COMMENTS = "https://api.github.com/repos/octo/repo/issues/1/comments";
const INSTALLATION_BEARER = "ghs_fixture-installation-token";

type Answer = () => Response | Promise<Response>;

/** A GitHub whose next answers are the ones queued, and 200 once they run out. */
function scriptedGitHub(answers: Answer[]) {
  return githubRateGate.pipe(
    Layer.provide(fakeHttpClientLayer(() => (answers.shift() ?? (() => Response.json({})))())),
  );
}

/** A GitHub that answers 200 and notes the method and the instant on the test's clock each request reached it at. */
function timedGitHub(arrivals: Array<readonly [string, number]>, arrived: () => void) {
  return githubRateGate.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.map(Clock.currentTimeMillis, (now) => {
            arrivals.push([request.method, now]);
            arrived();
            return HttpClientResponse.fromWeb(request, Response.json({}));
          }),
        ),
      ),
    ),
  );
}

/** The case run once the database holds nothing another case was refused into. */
const holdingNothing = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.andThen(
    Database.use((db) => db.delete(githubRateHold)),
    effect,
  );

const sentAs = (request: HttpClientRequest.HttpClientRequest) =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.execute(request.pipe(HttpClientRequest.bearerToken(INSTALLATION_BEARER))),
  );

const pullRequestAsked = sentAs(HttpClientRequest.get(PULL_REQUEST));

const asked = Effect.map(pullRequestAsked, (response) => response.status);

const secondary = () =>
  Response.json(
    { message: "You have exceeded a secondary rate limit. Please wait a few minutes." },
    { status: 403 },
  );

it.layer(getTestDB())("the GitHub rate gate", (it) => {
  it.effect("a primary limit holds every request until GitHub's reset, however far off", () =>
    Effect.gen(function* () {
      // The file's cases share one clock, so the reset is an hour on from where this case starts.
      const anHourOn = (yield* Clock.currentTimeMillis) / 1000 + 3600;
      const exhausted = () =>
        Response.json(
          { message: "API rate limit exceeded" },
          {
            status: 403,
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(anHourOn) },
          },
        );
      const statuses = yield* Effect.gen(function* () {
        const refused = yield* asked;
        yield* TestClock.adjust("3599 seconds");
        const held = yield* asked;
        yield* TestClock.adjust("1 second");
        const sent = yield* asked;
        return [refused, held, sent];
      }).pipe(Effect.provide(scriptedGitHub([exhausted])), holdingNothing);
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
        }).pipe(Effect.provide(scriptedGitHub([secondary, secondary])), holdingNothing);
        assert.deepEqual(statuses, [403, 403, 429, 200]);
      }),
  );

  it.effect("a hold one instance was refused into holds another instance's requests too", () =>
    Effect.gen(function* () {
      const statuses = yield* Effect.gen(function* () {
        const refused = yield* Effect.provide(asked, scriptedGitHub([secondary]));
        const elsewhere = scriptedGitHub([]);
        const heldElsewhere = yield* Effect.provide(asked, elsewhere);
        yield* TestClock.adjust("1 minute");
        const sentElsewhere = yield* Effect.provide(asked, elsewhere);
        return [refused, heldElsewhere, sentElsewhere];
      }).pipe(holdingNothing);
      assert.deepEqual(statuses, [403, 429, 200]);
    }),
  );

  it.effect(
    "a database that does not answer holds nothing back, and the instance still holds",
    () =>
      Effect.gen(function* () {
        const statuses = yield* Effect.gen(function* () {
          const refused = yield* asked;
          const held = yield* asked;
          yield* TestClock.adjust("1 minute");
          const sent = yield* asked;
          return [refused, held, sent];
        }).pipe(Effect.provide(scriptedGitHub([secondary])), Effect.provide(noDatabase));
        assert.deepEqual(statuses, [403, 429, 200]);
      }),
  );

  it.effect("writes under one identity start a second apart, and reads are not spaced", () =>
    Effect.gen(function* () {
      const arrivals: Array<readonly [string, number]> = [];
      const start = yield* Clock.currentTimeMillis;
      const firstThree = Promise.withResolvers<void>();
      const arrived = () => {
        if (arrivals.length === 3) firstThree.resolve();
      };
      yield* Effect.gen(function* () {
        const comment = sentAs(HttpClientRequest.post(COMMENTS));
        const all = yield* Effect.forkChild(
          Effect.all([comment, comment, pullRequestAsked, pullRequestAsked], {
            concurrency: "unbounded",
          }),
        );
        // Note that the second write is waiting its turn once both reads and the first write are at GitHub.
        yield* Effect.promise(() => firstThree.promise);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(all);
      }).pipe(Effect.provide(timedGitHub(arrivals, arrived)), holdingNothing);
      assert.deepEqual(
        arrivals
          .map(([method, at]) => [method, at - start])
          .sort(([a], [b]) => String(a).localeCompare(String(b))),
        [
          ["GET", 0],
          ["GET", 0],
          ["POST", 0],
          ["POST", 1000],
        ],
      );
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
      }).pipe(Effect.provide(scriptedGitHub([lateAnswer, secondary])), holdingNothing);
      assert.deepEqual(statuses, [200, 403, 429]);
    }),
  );

  it.effect("a refusal whose message lands late keeps the longer hold another set meanwhile", () =>
    Effect.gen(function* () {
      const message = Promise.withResolvers<void>();
      const arrived = Promise.withResolvers<void>();
      // A secondary limit naming no wait, whose message GitHub is slow to send.
      const slowSecondary = () => {
        arrived.resolve();
        const body = new ReadableStream<Uint8Array>({
          start: async (controller) => {
            await message.promise;
            controller.enqueue(new TextEncoder().encode('{"message":"secondary rate limit"}'));
            controller.close();
          },
        });
        return new Response(body, { status: 403 });
      };
      const anHour = () =>
        Response.json(
          { message: "slow down" },
          { status: 429, headers: { "retry-after": "3600" } },
        );
      const statuses = yield* Effect.gen(function* () {
        const slow = yield* Effect.forkChild(asked);
        yield* Effect.promise(() => arrived.promise);
        const held = yield* asked;
        message.resolve();
        const slowStatus = yield* Fiber.join(slow);
        yield* TestClock.adjust("2 minutes");
        const after = yield* asked;
        return [slowStatus, held, after];
      }).pipe(Effect.provide(scriptedGitHub([slowSecondary, anHour])), holdingNothing);
      assert.deepEqual(statuses, [403, 429, 429]);
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
      }).pipe(Effect.provide(scriptedGitHub([forbidden])), holdingNothing);
      assert.deepEqual(
        [message, next],
        [{ message: "Resource not accessible by integration" }, 200],
      );
    }),
  );
});
