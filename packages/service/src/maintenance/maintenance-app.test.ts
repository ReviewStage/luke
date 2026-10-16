import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { getTestDB } from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import { Clock, Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { GitHubApp } from "../github/github-app.js";
import { ErrorReports } from "../observability/error-reports.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { noNetwork } from "../testing/no-network.js";
import { recordingSentryTransport, reportingErrors } from "../testing/sentry-transport.js";
import { maintenanceApp } from "./maintenance-app.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";

/**
 * The sweep's group as the cron reaches it, told to Sentry's monitor
 * through a recording transport. A sweep that runs does so over an empty
 * migrated database, so it finds nothing to do and reaches no provider; what
 * each sweep does is `maintenance-sweep.test.ts`'s.
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
      Layer.succeed(ErrorReports, yield* ErrorReports),
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

it.effect("a sweep the deployment cannot run checks in as failed", () =>
  Effect.gen(function* () {
    const { sent, transport } = recordingSentryTransport();
    const status = yield* sweep(undefined, CRON_SECRET).pipe(
      Effect.provide(reportingErrors(transport)),
    );
    assert.equal(status, 503);
    assert.deepEqual(
      sent.checkIns.map((checkIn) => [checkIn.monitor_slug, checkIn.status]),
      [["maintenance-sweep", "error"]],
    );
  }),
);

it.effect("a call that is not the cron's checks nothing in", () =>
  Effect.gen(function* () {
    const { sent, transport } = recordingSentryTransport();
    const status = yield* sweep(CRON_SECRET, "not-the-secret").pipe(
      Effect.provide(reportingErrors(transport)),
    );
    assert.equal(status, 401);
    assert.deepEqual(sent.checkIns, []);
  }),
);

it.layer(getTestDB())("a sweep that runs", (it) => {
  it.effect("checks in as ok", () =>
    Effect.gen(function* () {
      const { sent, transport } = recordingSentryTransport();
      const database = yield* testDatabase;
      const status = yield* sweep(CRON_SECRET, CRON_SECRET, database).pipe(
        Effect.provide(reportingErrors(transport)),
      );
      assert.equal(status, 200);
      assert.deepEqual(
        sent.checkIns.map((checkIn) => [checkIn.monitor_slug, checkIn.status]),
        [["maintenance-sweep", "ok"]],
      );
    }),
  );
});
