import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { getTestDB } from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import { noNetwork } from "@luke/wire/testing";
import { Clock, Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { GitHubApp } from "../github/github-app.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { recordingSentry, type SentItem, sentOfType } from "../testing/sentry-transport.js";
import { maintenanceApp } from "./maintenance-app.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";

/**
 * The sweep's group as the cron reaches it, told to Sentry's Crons through a
 * recording transport. A sweep that runs does so over an empty migrated
 * database, so it finds nothing to do and reaches no provider; what each
 * sweep does is `maintenance-sweep.test.ts`'s.
 */

const CRON_SECRET = "cron-secret-1";

function environment(cronSecret: string | undefined): HostedEnvironmentValues {
  return {
    openAiKey: undefined,
    anthropicKey: undefined,
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: cronSecret === undefined ? undefined : Redacted.make(cronSecret),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
  };
}

/** Each check-in's monitor and status, in the order they were sent. */
function checkIns(sent: readonly SentItem[]): string[][] {
  return sentOfType(sent, "check_in").map((item) => [
    item.payload.monitor_slug ?? "",
    item.payload.status ?? "",
  ]);
}

/** The services a run of the sweep reads: the test's own database and clock, since the handler runs on the router's fiber. */
const testDatabase = Effect.gen(function* () {
  return Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
  );
});

/** The scheduler's call with `bearer`, answered by the group on a deployment whose cron secret is `cronSecret`. */
const sweep = (
  cronSecret: string | undefined,
  bearer: string,
  database: Layer.Layer<DatabaseServices> = noDatabase,
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      database,
      noNetwork,
      Layer.succeed(HostedEnvironment, environment(cronSecret)),
      GitHubApp.layer(undefined),
      modelCatalogOf([]),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      maintenanceApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const request = new Request(`https://luke.test${MAINTENANCE_SWEEP_PATH}`, {
      headers: { authorization: `Bearer ${bearer}` },
    });
    const response = yield* Effect.promise(() => handler(request));
    yield* Effect.promise(() => dispose());
    return response.status;
  });

it.effect(
  "a call to a deployment without its cron secret checks nothing in, so a stranger cannot fail a run",
  () =>
    Effect.gen(function* () {
      const sentry = recordingSentry();
      const status = yield* sweep(undefined, "anything").pipe(Effect.provide(sentry.layer));
      assert.equal(status, 503);
      assert.deepEqual(checkIns(sentry.sent), []);
    }),
);

it.effect("a call that is not the cron's checks nothing in", () =>
  Effect.gen(function* () {
    const sentry = recordingSentry();
    const status = yield* sweep(CRON_SECRET, "not-the-secret").pipe(Effect.provide(sentry.layer));
    assert.equal(status, 401);
    assert.deepEqual(checkIns(sentry.sent), []);
  }),
);

it.layer(getTestDB())("a sweep that runs", (it) => {
  it.effect("checks in as it starts and as it ends, with the monitor's schedule", () =>
    Effect.gen(function* () {
      const sentry = recordingSentry();
      const database = yield* testDatabase;
      const status = yield* sweep(CRON_SECRET, CRON_SECRET, database).pipe(
        Effect.provide(sentry.layer),
      );
      const [started] = sentOfType(sentry.sent, "check_in");
      assert.equal(status, 200);
      assert.deepEqual(checkIns(sentry.sent), [
        ["maintenance-sweep", "in_progress"],
        ["maintenance-sweep", "ok"],
      ]);
      assert.deepEqual(started?.payload.monitor_config, {
        schedule: { type: "crontab", value: "* * * * *" },
        checkin_margin: 1,
        max_runtime: 1,
        failure_issue_threshold: 3,
        timezone: "Etc/UTC",
      });
    }),
  );
});
