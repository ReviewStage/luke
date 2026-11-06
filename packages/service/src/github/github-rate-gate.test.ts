import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { githubRateHold } from "@repo/database/schemas";
import { getTestDB } from "@repo/database/testing";
import { noDatabase } from "@repo/database/testing/no-database";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Clock, Effect, Fiber, Layer } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";
import { GitHubBackground, githubRateGate } from "./github-rate-gate.js";

const PULL_REQUEST = "https://api.github.com/repos/octo/repo/pulls/1";
const COMMENTS = "https://api.github.com/repos/octo/repo/issues/1/comments";
const INSTALLATION_BEARER = "ghs_fixture-installation-token";

type Answer = () => Response | Promise<Response>;

function scriptedGitHub(answers: Answer[]) {
  return Layer.fresh(githubRateGate).pipe(
    Layer.provide(fakeHttpClientLayer(() => (answers.shift() ?? (() => Response.json({})))())),
  );
}

function timedGitHub(
  arrivals: Array<readonly [string, number]>,
  arrived: () => void,
  readsAnswered?: Promise<void>,
) {
  return Layer.fresh(githubRateGate).pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            arrivals.push([request.method, yield* Clock.currentTimeMillis]);
            arrived();
            if (request.method === "GET" && readsAnswered !== undefined) {
              yield* Effect.promise(() => readsAnswered);
            }
            return HttpClientResponse.fromWeb(request, Response.json({}));
          }),
        ),
      ),
    ),
  );
}

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

  it.effect("a refusal long after the last hold lifted holds a minute again", () =>
    Effect.gen(function* () {
      const statuses = yield* Effect.gen(function* () {
        const first = yield* asked;
        yield* TestClock.adjust("17 minutes");
        const again = yield* asked;
        yield* TestClock.adjust("1 minute");
        const sent = yield* asked;
        return [first, again, sent];
      }).pipe(Effect.provide(scriptedGitHub([secondary, secondary])), holdingNothing);
      assert.deepEqual(statuses, [403, 403, 200]);
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

  it.effect("requests under one identity reach GitHub one at a time", () =>
    Effect.gen(function* () {
      const arrivals: Array<readonly [string, number]> = [];
      const answered = Promise.withResolvers<void>();
      const first = Promise.withResolvers<void>();
      const seen = yield* Effect.gen(function* () {
        const both = yield* Effect.forkChild(
          Effect.all([pullRequestAsked, pullRequestAsked], { concurrency: "unbounded" }),
        );
        yield* Effect.promise(() => first.promise);
        for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
        const whileFirstOut = arrivals.length;
        answered.resolve();
        yield* Fiber.join(both);
        return [whileFirstOut, arrivals.length];
      }).pipe(
        Effect.provide(timedGitHub(arrivals, () => first.resolve(), answered.promise)),
        holdingNothing,
      );
      assert.deepEqual(seen, [1, 2]);
    }),
  );

  it.effect(
    "a member's read is sent while background work under the same identity is still out",
    () =>
      Effect.gen(function* () {
        const arrivals: Array<readonly [string, number]> = [];
        const answered = Promise.withResolvers<void>();
        const first = Promise.withResolvers<void>();
        const seen = yield* Effect.gen(function* () {
          const background = yield* Effect.forkChild(
            pullRequestAsked.pipe(Effect.provideService(GitHubBackground, true)),
          );
          yield* Effect.promise(() => first.promise);
          yield* pullRequestAsked.pipe(Effect.forkChild);
          for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
          const whileBackgroundOut = arrivals.length;
          answered.resolve();
          yield* Fiber.join(background);
          return whileBackgroundOut;
        }).pipe(
          Effect.provide(timedGitHub(arrivals, () => first.resolve(), answered.promise)),
          holdingNothing,
        );
        assert.equal(seen, 2);
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

  it.effect("writes that queued behind a busy lane still start a second apart", () =>
    Effect.gen(function* () {
      const arrivals: Array<readonly [string, number]> = [];
      const start = yield* Clock.currentTimeMillis;
      const readsAnswered = Promise.withResolvers<void>();
      const laneTaken = Promise.withResolvers<void>();
      const firstWrite = Promise.withResolvers<void>();
      const arrived = () => {
        const methods = arrivals.map(([method]) => method);
        if (methods.includes("GET")) laneTaken.resolve();
        if (methods.includes("POST")) firstWrite.resolve();
      };
      yield* Effect.gen(function* () {
        const comment = sentAs(HttpClientRequest.post(COMMENTS));
        const all = yield* Effect.forkChild(
          Effect.all([pullRequestAsked, comment, comment], { concurrency: "unbounded" }),
        );
        yield* Effect.promise(() => laneTaken.promise);
        yield* TestClock.adjust("2 seconds");
        readsAnswered.resolve();
        yield* Effect.promise(() => firstWrite.promise);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(all);
      }).pipe(
        Effect.provide(timedGitHub(arrivals, arrived, readsAnswered.promise)),
        holdingNothing,
      );
      assert.deepEqual(
        arrivals.filter(([method]) => method === "POST").map(([, at]) => at - start),
        [2000, 3000],
      );
    }),
  );

  it.effect("writes waiting their turn hold no lane a read could be sent in", () =>
    Effect.gen(function* () {
      const arrivals: Array<readonly [string, number]> = [];
      const start = yield* Clock.currentTimeMillis;
      const firstWrite = Promise.withResolvers<void>();
      const read = Promise.withResolvers<void>();
      const arrived = () => {
        const methods = arrivals.map(([method]) => method);
        if (methods.includes("POST")) firstWrite.resolve();
        if (methods.includes("GET")) read.resolve();
      };
      yield* Effect.gen(function* () {
        const comment = sentAs(HttpClientRequest.post(COMMENTS));
        const writes = Array.from({ length: 7 }, () => comment);
        const all = yield* Effect.forkChild(
          Effect.all([...writes, pullRequestAsked], { concurrency: "unbounded" }),
        );
        yield* Effect.promise(() => firstWrite.promise);
        yield* TestClock.adjust("1 second");
        yield* Effect.promise(() => read.promise);
        yield* Fiber.interrupt(all);
      }).pipe(Effect.provide(timedGitHub(arrivals, arrived)), holdingNothing);
      const [, readAt] = arrivals.find(([method]) => method === "GET") ?? [];
      assert.equal(readAt === undefined ? undefined : readAt - start, 0);
    }),
  );

  it.effect(
    "a write that waited its turn past the shared read's trust reads the shared hold again",
    () =>
      Effect.gen(function* () {
        const answered: number[] = [];
        const turns = Array.from({ length: 7 }, () => Promise.withResolvers<void>());
        yield* Effect.gen(function* () {
          const comment = sentAs(HttpClientRequest.post(COMMENTS)).pipe(
            Effect.tap((response) =>
              Effect.sync(() => {
                answered.push(response.status);
                turns[answered.length - 1]?.resolve();
              }),
            ),
          );
          yield* asked;
          const all = yield* Effect.forkChild(
            Effect.all(
              turns.map(() => comment),
              { concurrency: "unbounded" },
            ),
          );
          const [first, ...later] = turns.map((turn) => turn.promise);
          yield* Effect.promise(() => first ?? Promise.resolve());
          for (const [index, turn] of later.entries()) {
            yield* TestClock.adjust("1 second");
            yield* Effect.promise(() => turn);
            if (index === 0) yield* Effect.provide(asked, scriptedGitHub([secondary]));
          }
          yield* Fiber.join(all);
        }).pipe(Effect.provide(scriptedGitHub([])), holdingNothing);
        assert.equal(answered.at(-1), 429);
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
