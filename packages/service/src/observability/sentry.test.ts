import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Sentry from "@sentry/effect";
import { Effect, Fiber, Layer, Logger } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { recordingSentry, sentOfType } from "../testing/sentry-transport.js";
import { sentryCronCheckIns, sentryLogger, sentryReportedFetch, standReported } from "./sentry.js";

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

it.effect(
  "a stood service is captured once whether it fails or its runner cannot run it, and not when it is interrupted",
  () =>
    Effect.gen(function* () {
      const sentry = recordingSentry();
      yield* Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const run = (service: Effect.Effect<never, TypeError>) =>
          Effect.runPromiseWith(context)(service);
        yield* Effect.promise(() => standReported(run, Effect.fail(new TypeError("refused"))));
        yield* Effect.promise(() => standReported(run, Effect.interrupt));
        // Note that this runner rejects as one whose runtime could not be built does, running nothing.
        const unbuilt = () => Promise.reject(new RangeError("no runtime"));
        yield* Effect.promise(() => standReported(unbuilt, Effect.never));
      }).pipe(Effect.provide(sentry.layer));
      // Note that the two are compared unordered, because the SDK sends each event when its processing settles.
      assert.deepEqual(exceptionTypes(sentry.sent).sort(), ["RangeError", "TypeError"]);
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

it.effect("an exception and a rejection nothing in the process caught are each captured", () =>
  Effect.gen(function* () {
    const sentry = recordingSentry();
    yield* Effect.sync(() => {
      sentry.throwUncaught(new RangeError("thrown on a timer"));
      sentry.rejectUnhandled(new TypeError("rejected unawaited"));
    }).pipe(Effect.provide(sentry.layer));
    // Note that the two reports are processed concurrently, so they may leave in either order.
    assert.deepEqual(exceptionTypes(sentry.sent).toSorted(), ["RangeError", "TypeError"]);
  }),
);

it.effect("a web function that throws is captured, and throws the same failure on", () =>
  Effect.gen(function* () {
    const sentry = recordingSentry();
    const fetch = sentryReportedFetch(
      () => Promise.reject(new SyntaxError("DATABASE_URL is not set")),
      () => {},
    );
    yield* Effect.promise(() =>
      assert.rejects(fetch(new Request("https://luke.test/api/plans")), {
        name: "SyntaxError",
        message: "DATABASE_URL is not set",
      }),
    ).pipe(Effect.provide(sentry.layer));
    assert.deepEqual(exceptionTypes(sentry.sent), ["SyntaxError"]);
  }),
);

it.effect("a web function answers before its report has left, and keeps awake until it has", () =>
  Effect.gen(function* () {
    // Note that the network is held by hand, because a function frozen once it answers drops whatever is still in flight.
    let release = () => {};
    const network = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sentry = recordingSentry(() => network);
    const awake: Promise<boolean>[] = [];
    yield* Effect.gen(function* () {
      const context = yield* Effect.context<never>();
      const { handler, dispose } = HttpRouter.toWebHandler(
        HttpRouter.add("GET", "/dies", Effect.die(new RangeError("no such row"))),
        { disableLogger: true },
      );
      const fetch = sentryReportedFetch(
        (request) => handler(request, context),
        (sending) => awake.push(sending),
      );
      const answer = yield* Effect.promise(() => fetch(new Request("https://luke.test/dies")));
      let delivered = false;
      const keptAwake = Promise.all(awake).then(() => {
        delivered = true;
      });
      for (let turn = 0; turn < 10; turn++) yield* Effect.yieldNow;
      assert.equal(answer.status, 500);
      assert.equal(delivered, false);
      release();
      yield* Effect.promise(() => keptAwake);
      yield* Effect.promise(() => dispose());
    }).pipe(
      // Note that the network is let go on a failed assertion too, or closing Sentry would wait on it for good.
      Effect.ensuring(Effect.sync(() => release())),
      Effect.provide(sentry.layer),
    );
    assert.deepEqual(exceptionTypes(sentry.sent), ["RangeError"]);
  }),
);

it.effect(
  "a request's address reaches Sentry with its query's values and its credentials redacted",
  () =>
    Effect.gen(function* () {
      const sentry = recordingSentry();
      const workspace = "1b480a3c-828f-4dee-b9e3-444eafa20fe3";
      const invite = "fixture".repeat(6);
      yield* Effect.gen(function* () {
        const context = yield* Effect.context<never>();
        const { handler, dispose } = HttpRouter.toWebHandler(
          Layer.mergeAll(
            HttpRouter.add("GET", "/api/auth/callback/:provider", HttpServerResponse.text("in")),
            HttpRouter.add(
              "GET",
              "/api/workspaces/:id/invites/:invite",
              HttpServerResponse.text("in"),
            ),
          ),
          { disableLogger: true },
        );
        for (const address of [
          `https://luke.test/api/auth/callback/github?code=fixture-oauth-code&state=fixture-oauth-state&${invite}=1`,
          `https://luke.test/api/workspaces/${workspace}/invites/${invite}`,
        ]) {
          yield* Effect.promise(() => handler(new Request(address), context));
        }
        yield* Effect.promise(() => dispose());
      }).pipe(Effect.provide(sentry.layer));
      const spans = sentOfType(sentry.sent, "span").map((item) => item.text);
      const sent = (words: string) => spans.some((text) => text.includes(words));
      assert.ok(
        sent("/api/auth/callback/github?code=[redacted]&state=[redacted]&[redacted]=[redacted]"),
      );
      assert.ok(sent(`/api/workspaces/${workspace}/invites/[redacted]`));
      assert.ok(!sent("fixture-oauth") && !sent(invite));
    }),
);

it.effect(
  "an error reaches Sentry with its request's and its breadcrumbs' addresses redacted",
  () =>
    Effect.gen(function* () {
      const sentry = recordingSentry();
      const callback = "https://luke.test/api/auth/callback/github?code=fixture-oauth-code";
      yield* Effect.gen(function* () {
        // Note that the request is attached as Sentry's HTTP and request-data integrations attach the one an eve root answers.
        yield* Effect.sync(() => {
          Sentry.addIntegration(Sentry.requestDataIntegration());
          Sentry.getIsolationScope().setSDKProcessingMetadata({
            normalizedRequest: { url: callback, query_string: "code=fixture-oauth-code" },
          });
          Sentry.addBreadcrumb({ category: "http", data: { url: callback } });
        });
        yield* Effect.exit(Effect.withErrorReporting(Effect.fail(new TypeError("refused"))));
      }).pipe(Effect.provide(sentry.layer));
      // Note that the request and the breadcrumbs are read apart, because the event's context lines quote this file.
      const [event] = sentOfType(sentry.sent, "event").map((item) => item.text);
      const { request, breadcrumbs } = JSON.parse(event ?? "{}");
      assert.deepEqual(
        { request: [request.url, request.query_string], breadcrumb: breadcrumbs[0].data.url },
        {
          request: [
            "https://luke.test/api/auth/callback/github?code=[redacted]",
            "code=[redacted]",
          ],
          breadcrumb: "https://luke.test/api/auth/callback/github?code=[redacted]",
        },
      );
    }),
);
