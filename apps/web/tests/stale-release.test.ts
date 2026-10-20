// @vitest-environment jsdom
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Fiber, Queue, Stream } from "effect";
import { TestClock } from "effect/testing";
import { RELEASE_META } from "../scripts/release-meta-name";
import { followRelease } from "../src/app/stale-release";

/**
 * stale-release.test.ts -- a tab left open across a release comes back to
 * the front: it reloads onto a release the deployment serves that is not its
 * own, offers the reload instead while a page holds unsaved work, asks the
 * deployment at most once a minute, and stays put on its own release.
 * Synthetic commits.
 */

const ORIGIN = "http://localhost:3000";
const BUILT = "1111111111111111111111111111111111111111";
const NEWER = "2222222222222222222222222222222222222222";

/** The app's page as a deployment serves it, naming the commit given. */
const appPage = (release: string) =>
  `<!doctype html><html><head><meta name="${RELEASE_META}" content="${release}" /><title>Luke</title></head><body></body></html>`;

/** Lets the follow's fiber take what was handed it. */
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/**
 * A tab built from `BUILT`, following its returns against a deployment that
 * serves `serving()`: what it did (reloaded, offered), how often it asked
 * the deployment, and a way to bring it back to the front.
 */
function tab(options: {
  serving: () => string;
  unsavedWork?: () => boolean;
  /** What the deployment answers in place of its page, where it answers otherwise. */
  answer?: () => Response;
}) {
  return Effect.gen(function* () {
    const returns = yield* Queue.unbounded<void>();
    const did: string[] = [];
    const asked: string[] = [];
    const client = fakeHttpClientLayer((url) => {
      asked.push(new URL(url).pathname);
      return options.answer?.() ?? new Response(appPage(options.serving()), { status: 200 });
    });
    yield* Effect.forkChild(
      followRelease({
        release: BUILT,
        origin: ORIGIN,
        returns: Stream.fromQueue(returns),
        unsavedWork: options.unsavedWork ?? (() => false),
        reload: () => did.push("reloaded"),
        offerReload: () => did.push("offered"),
      }).pipe(Effect.provide(client)),
    );
    yield* settled;
    const returned = Effect.andThen(Queue.offer(returns, undefined), settled);
    return { did, asked, returned };
  });
}

it.effect("a tab that comes back to a newer release reloads onto it", () =>
  Effect.gen(function* () {
    const { did, asked, returned } = yield* tab({ serving: () => NEWER });
    yield* returned;
    assert.deepEqual(did, ["reloaded"]);
    assert.deepEqual(asked, ["/app"]);
  }),
);

it.effect("a tab that comes back to its own release stays as it is", () =>
  Effect.gen(function* () {
    const { did, asked, returned } = yield* tab({ serving: () => BUILT });
    yield* returned;
    assert.deepEqual(did, []);
    assert.deepEqual(asked, ["/app"]);
  }),
);

it.effect(
  "while a page holds unsaved work the reload is offered rather than taken, again on a later return, and taken once the work is gone",
  () =>
    Effect.gen(function* () {
      let unsaved = true;
      const { did, returned } = yield* tab({
        serving: () => NEWER,
        unsavedWork: () => unsaved,
      });
      yield* returned;
      assert.deepEqual(did, ["offered"]);

      // A minute on, still holding the work, as after a Reload whose leave was cancelled: offered again.
      yield* TestClock.adjust("1 minute");
      yield* returned;
      assert.deepEqual(did, ["offered", "offered"]);

      unsaved = false;
      yield* TestClock.adjust("1 minute");
      yield* returned;
      assert.deepEqual(did, ["offered", "offered", "reloaded"]);
    }),
);

it.effect("the deployment is asked at most once a minute, however often the tab comes back", () =>
  Effect.gen(function* () {
    let serving = BUILT;
    const { did, asked, returned } = yield* tab({ serving: () => serving });
    yield* returned;
    assert.equal(asked.length, 1);

    // A release lands, but returns within the minute ask nothing.
    serving = NEWER;
    yield* TestClock.adjust("30 seconds");
    yield* returned;
    yield* TestClock.adjust("29 seconds");
    yield* returned;
    assert.equal(asked.length, 1);
    assert.deepEqual(did, []);

    yield* TestClock.adjust("1 second");
    yield* returned;
    assert.equal(asked.length, 2);
    assert.deepEqual(did, ["reloaded"]);
  }),
);

it.effect(
  "an answer that names no release, a refusal, a page with no meta, or a failed request, reloads nothing and offers nothing",
  () =>
    Effect.gen(function* () {
      const answers: readonly (() => Response)[] = [
        () => new Response(appPage(NEWER), { status: 503 }),
        () => new Response("<!doctype html><html><head><title>Luke</title></head></html>"),
        () => new Response(appPage("")),
        () => {
          throw new Error("offline");
        },
      ];
      for (const answer of answers) {
        for (const unsaved of [false, true]) {
          const { did, asked, returned } = yield* tab({
            serving: () => NEWER,
            answer,
            unsavedWork: () => unsaved,
          });
          yield* returned;
          assert.deepEqual(asked, ["/app"]);
          assert.deepEqual(did, []);
        }
      }
    }),
);

it.effect("a build that names no release never asks the deployment", () =>
  Effect.gen(function* () {
    const asked: string[] = [];
    const returns = yield* Queue.unbounded<void>();
    yield* Queue.offer(returns, undefined);
    const fiber = yield* Effect.forkChild(
      followRelease({
        release: "",
        origin: ORIGIN,
        returns: Stream.fromQueue(returns),
        unsavedWork: () => false,
        reload: () => asked.push("reloaded"),
        offerReload: () => asked.push("offered"),
      }).pipe(
        Effect.provide(
          fakeHttpClientLayer((url) => {
            asked.push(url);
            return new Response(appPage(NEWER));
          }),
        ),
      ),
    );
    yield* Fiber.join(fiber);
    assert.deepEqual(asked, []);
  }),
);
