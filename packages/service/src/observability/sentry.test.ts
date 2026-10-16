import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Fiber, Layer, Logger } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { recordingSentry, sentOfType } from "../testing/sentry-transport.js";
import { sentryCronCheckIns, sentryLogger } from "./sentry.js";

/**
 * The deployment's Sentry at its own boundary, its transport
 * (`testing/sentry-transport.ts`): nothing reaches the network, and each test
 * asserts the envelope items Sentry would have received.
 */

/** The exception values of every error event sent, by type. */
function exceptionTypes(sent: ReturnType<typeof recordingSentry>["sent"]): string[] {
  return sentOfType(sent, "event").flatMap((item) =>
    (item.payload.exception?.values ?? []).map((value) => value.type ?? ""),
  );
}

it.effect("a route that dies answers 500 and is captured; one that answers is not", () =>
  Effect.gen(function* () {
    const sentry = recordingSentry();
    const statuses = yield* Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const { handler, dispose } = HttpRouter.toWebHandler(
        Layer.mergeAll(
          HttpRouter.add("GET", "/dies", Effect.die(new RangeError("no such row"))),
          HttpRouter.add("GET", "/answers", Effect.succeed(HttpServerResponse.text("ok"))),
        ),
        { disableLogger: true },
      );
      const died = yield* Effect.promise(() =>
        handler(new Request("https://luke.test/dies"), context),
      );
      const answered = yield* Effect.promise(() =>
        handler(new Request("https://luke.test/answers"), context),
      );
      yield* Effect.promise(() => dispose());
      return [died.status, answered.status];
    }).pipe(Effect.provide(sentry.layer));
    assert.deepEqual(statuses, [500, 200]);
    assert.deepEqual(exceptionTypes(sentry.sent), ["RangeError"]);
  }),
);

it.effect("an effect under error reporting is captured once, and an interruption not at all", () =>
  Effect.gen(function* () {
    const sentry = recordingSentry();
    yield* Effect.gen(function* () {
      yield* Effect.exit(Effect.withErrorReporting(Effect.fail(new TypeError("refused"))));
      yield* Effect.exit(Effect.withErrorReporting(Effect.interrupt));
    }).pipe(Effect.provide(sentry.layer));
    assert.deepEqual(exceptionTypes(sentry.sent), ["TypeError"]);
  }),
);

it.effect("a log line becomes a Sentry log, and a span a Sentry span", () =>
  Effect.gen(function* () {
    const sentry = recordingSentry();
    yield* Effect.logWarning("a title could not be generated").pipe(
      Effect.withSpan("web/title"),
      Effect.provide(Logger.layer([sentryLogger])),
      Effect.provide(sentry.layer),
    );
    const logs = sentOfType(sentry.sent, "log").map((item) => item.text);
    const spans = sentry.sent.filter((item) => item.type !== "log").map((item) => item.text);
    assert.ok(logs.some((text) => text.includes("a title could not be generated")));
    assert.ok(spans.some((text) => text.includes("web/title")));
  }),
);

it.effect("a monitored run returns only once its closing check-in has left", () =>
  Effect.gen(function* () {
    // Note that the network is held by hand, because a function frozen once it answers drops whatever is still in flight.
    let release = () => {};
    const network = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sentry = recordingSentry(() => network);
    const monitor = sentryCronCheckIns({
      slug: "a-job",
      crontab: "* * * * *",
      maxRuntimeMinutes: 1,
      checkInMarginMinutes: 1,
      failuresBeforeIssue: 1,
    });
    yield* Effect.gen(function* () {
      const run = yield* Effect.forkChild(monitor.run(Effect.void));
      for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
      assert.equal(run.pollUnsafe(), undefined);
      release();
      yield* Fiber.join(run);
    }).pipe(Effect.provide(sentry.layer));
    assert.deepEqual(
      sentOfType(sentry.sent, "check_in").map((item) => item.payload.status),
      ["in_progress", "ok"],
    );
  }),
);
