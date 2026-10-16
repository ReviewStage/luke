import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import {
  errorReportsOn,
  FIXTURE_SENTRY_DSN,
  recordingSentryTransport,
  reportingErrors,
} from "../testing/sentry-transport.js";
import {
  CHECK_IN_STATUS,
  ERROR_REPORTS_ENVIRONMENT,
  ErrorReports,
  logDefect,
  logRouteFailure,
} from "./error-reports.js";

/**
 * Error reports at Sentry's own boundary, its transport
 * (`testing/sentry-transport.ts`): nothing reaches the network, and each test
 * asserts what Sentry would have received.
 */

/** A credential built at run time, so no tracked line holds one (`repository-checks.sh`). */
const FIXTURE_KEY = `sk-${"fixture".repeat(3)}`;

it.effect(
  "a line at Error files its words with every credential redacted, and a line below it files nothing",
  () =>
    Effect.gen(function* () {
      const { sent, transport } = recordingSentryTransport();
      // An error handed as a value rather than as a `Cause` is still words.
      yield* Effect.logError(
        `the provider refused ${FIXTURE_KEY}`,
        new Error(`401 for key ${FIXTURE_KEY}`),
      ).pipe(Effect.provide(reportingErrors(transport)));
      yield* Effect.gen(function* () {
        yield* Effect.logError("the sweep could not reach eve");
        yield* Effect.logWarning("a title could not be generated");
        yield* Effect.logInfo("a session started");
      }).pipe(Effect.provide(reportingErrors(transport)));
      const [first, second] = sent.events;
      assert.equal(sent.events.length, 2);
      assert.equal(first?.level, "error");
      assert.equal(first?.message, "the provider refused [redacted] Error: 401 for key [redacted]");
      assert.equal(second?.message, "the sweep could not reach eve");
      assert.equal(JSON.stringify(sent.events).includes(FIXTURE_KEY), false);
    }),
);

it.effect(
  "a defect logged with its cause files the error itself, redacted, with the line beside it",
  () =>
    Effect.gen(function* () {
      const { sent, transport } = recordingSentryTransport();
      yield* Effect.die(new TypeError(`fetch failed for ${FIXTURE_KEY}`)).pipe(
        Effect.catchCause((cause) => Effect.logFatal("an edge's effect died", cause)),
        Effect.provide(reportingErrors(transport)),
      );
      const [event] = sent.events;
      const [exception] = event?.exception?.values ?? [];
      assert.equal(event?.level, "fatal");
      assert.equal(exception?.type, "TypeError");
      assert.equal(exception?.value, "fetch failed for [redacted]");
      assert.equal(event?.contexts?.log?.message, "an edge's effect died");
      assert.ok((exception?.stacktrace?.frames?.length ?? 0) > 0);
    }),
);

it.effect("a deployment without a DSN reports nothing and checks nothing in", () =>
  Effect.gen(function* () {
    const { sent, transport } = recordingSentryTransport();
    yield* Effect.gen(function* () {
      yield* Effect.logError("the sweep could not reach eve");
      const reports = yield* ErrorReports;
      yield* reports.checkIn(
        { slug: "maintenance-sweep", crontab: "* * * * *", maxRuntimeMinutes: 1 },
        CHECK_IN_STATUS.ERROR,
        1,
      );
    }).pipe(Effect.provide(errorReportsOn({}, transport)));
    assert.deepEqual(sent, { events: [], checkIns: [] });
  }),
);

it.effect("a check-in names its monitor and the schedule Sentry should expect it on", () =>
  Effect.gen(function* () {
    const { sent, transport } = recordingSentryTransport();
    yield* Effect.gen(function* () {
      const reports = yield* ErrorReports;
      yield* reports.checkIn(
        { slug: "maintenance-sweep", crontab: "* * * * *", maxRuntimeMinutes: 1 },
        CHECK_IN_STATUS.OK,
        4.5,
      );
    }).pipe(
      Effect.provide(
        errorReportsOn(
          {
            [ERROR_REPORTS_ENVIRONMENT.DSN]: FIXTURE_SENTRY_DSN,
            [ERROR_REPORTS_ENVIRONMENT.DEPLOYMENT]: "production",
          },
          transport,
        ),
      ),
    );
    const [checkIn] = sent.checkIns;
    assert.equal(checkIn?.monitor_slug, "maintenance-sweep");
    assert.equal(checkIn?.status, "ok");
    assert.equal(checkIn?.duration, 4.5);
    assert.equal(checkIn?.environment, "production");
    assert.deepEqual(checkIn?.monitor_config?.schedule, { type: "crontab", value: "* * * * *" });
  }),
);

it.effect(
  "a route that dies answers 500 and files the defect; one that answers files nothing",
  () =>
    Effect.gen(function* () {
      const { sent, transport } = recordingSentryTransport();
      const statuses = yield* Effect.gen(function* () {
        const context = yield* Effect.context<ErrorReports>();
        const { handler, dispose } = HttpRouter.toWebHandler(
          Layer.mergeAll(
            HttpRouter.add("GET", "/dies", Effect.die(new RangeError("no such row"))),
            HttpRouter.add("GET", "/answers", Effect.succeed(HttpServerResponse.text("ok"))),
          ),
          { disableLogger: true, middleware: logRouteFailure },
        );
        const died = yield* Effect.promise(() =>
          handler(new Request("https://luke.test/dies"), context),
        );
        const answered = yield* Effect.promise(() =>
          handler(new Request("https://luke.test/answers"), context),
        );
        yield* Effect.promise(() => dispose());
        return [died.status, answered.status];
      }).pipe(Effect.provide(reportingErrors(transport)));
      const [event] = sent.events;
      assert.deepEqual(statuses, [500, 200]);
      assert.equal(sent.events.length, 1);
      assert.equal(event?.exception?.values?.[0]?.type, "RangeError");
      assert.equal(event?.contexts?.log?.message, "a route ended without an answer");
    }),
);

it.effect(
  "an edge's effect that dies files the defect; one that fails as it may files nothing",
  () =>
    Effect.gen(function* () {
      const { sent, transport } = recordingSentryTransport();
      yield* Effect.gen(function* () {
        yield* Effect.exit(logDefect(Effect.die(new RangeError("no such session"))));
        yield* Effect.exit(logDefect(Effect.fail("the session was not this account's")));
      }).pipe(Effect.provide(reportingErrors(transport)));
      const [event] = sent.events;
      assert.equal(sent.events.length, 1);
      assert.equal(event?.exception?.values?.[0]?.type, "RangeError");
      assert.equal(event?.contexts?.log?.message, "an edge's effect died");
    }),
);
