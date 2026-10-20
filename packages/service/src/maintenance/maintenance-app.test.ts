import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@luke/database/core/query";
import { createAutomation } from "@luke/database/models/automation-store";
import { getTestDB, startTask } from "@luke/database/testing";
import { noDatabase } from "@luke/database/testing/no-database";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { noNetwork } from "@luke/wire/testing";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { type HttpClient, HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { afterEach, vi } from "vitest";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_HEADER } from "../agents/brain-host/bounds.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { GitHubApp } from "../github/github-app.js";
import { type ModelCatalog, modelCatalogOf } from "../providers/model-catalog.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { recordingSentry, type SentItem, sentOfType } from "../testing/sentry-transport.js";
import { maintenanceApp } from "./maintenance-app.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";

/**
 * The sweep's group as the cron reaches it, told to Sentry's Crons through a
 * recording transport. A sweep that runs does so over an empty migrated
 * database, so it finds nothing to do and reaches no provider; what each
 * sweep does is `maintenance-sweep.test.ts`'s. The one exception is an
 * automation the sweep starts, which reaches eve as the deployment acting
 * for its owner: under the deployment's own secret at eve's door, never the
 * cron's bearer the sweep itself was called with, over GitHub and eve as
 * one fake HTTP boundary.
 */

const CRON_SECRET = "cron-secret-1";
/** The deployment's own secret at eve's door, which every deployment here holds beside the cron's. */
const EVE_DEPLOYMENT_SECRET = "eve-deployment-secret-1";
/** The origin eve answers on, as `LUKE_EVE_ORIGIN` names it to the sweep. */
const EVE_ORIGIN = "https://luke.test";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    eveDeploymentSecret: Redacted.make(EVE_DEPLOYMENT_SECRET),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
    nativeAgentAccounts: [],
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
  reached: Layer.Layer<HttpClient.HttpClient | GitHubApp | ModelCatalog> = Layer.mergeAll(
    noNetwork,
    GitHubApp.layer(undefined),
    modelCatalogOf([]),
  ),
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      database,
      reached,
      Layer.succeed(HostedEnvironment, environment(cronSecret)),
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

it.effect(
  "a call under the deployment's own secret at eve's door is not the cron's, beside the cron's secret or without it, and checks nothing in",
  () =>
    Effect.gen(function* () {
      const sentry = recordingSentry();
      const beside = yield* sweep(CRON_SECRET, EVE_DEPLOYMENT_SECRET).pipe(
        Effect.provide(sentry.layer),
      );
      const without = yield* sweep(undefined, EVE_DEPLOYMENT_SECRET).pipe(
        Effect.provide(sentry.layer),
      );
      assert.deepEqual([beside, without], [401, 503]);
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

/** The one installation reaching the automation's repository. */
const RELAY = { owner: "Acme", name: "Relay" } as const;
const INSTALLATION: InstallationFixture = {
  id: 7_100,
  login: RELAY.owner,
  accountId: 71_000,
  repositories: [RELAY],
};
const MODEL = "openai/gpt-6.1-sol";

/** An owner, a task on the installation's repository, and an automation on it due a minute ago. */
const openDueAutomation = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const task = yield* startTask(owner, {
    name: "Flaky tests",
    repository: `${RELAY.owner}/${RELAY.name}`,
  });
  yield* connectWorkspaceGitHub(task.workspaceId, INSTALLATION);
  const now = yield* Clock.currentTimeMillis;
  Option.getOrThrow(
    yield* createAutomation(owner, {
      taskId: task.id,
      name: "Flaky-test sweep",
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
      action: {
        kind: AUTOMATION_ACTION.CODING_AGENT,
        prompt: "Find the flakiest test in CI this week and fix it.",
        choice: { model: MODEL, effort: "low" },
      },
      guards: AUTOMATION_DEFAULT_GUARDS,
      nextRunAt: new Date(now - 60_000),
      webhookSecretHash: null,
      archiveSuccessful: false,
    }),
  );
  return owner;
});

/**
 * GitHub reaching the automation's repository and eve behind the
 * deployment's rewrites, as one HTTP boundary, with the catalog the
 * automation's model is offered in; every request eve receives is written
 * down by its route, bearer, and the account it names.
 */
function githubAndEve() {
  const asked: {
    readonly url: string;
    readonly authorization: string | null;
    readonly account: string | null;
  }[] = [];
  const github = githubReaching([INSTALLATION], undefined, {}, (sent) => {
    if (!sent.url.startsWith(`${EVE_ORIGIN}/eve/`)) return undefined;
    asked.push({
      url: sent.url,
      authorization: sent.headers.get("authorization"),
      account: sent.headers.get(BRAIN_HOST_HEADER.ACCOUNT),
    });
    return Response.json(
      { ok: true, sessionId: "wrun_01SWEPTAUTOMATION000000000", status: "accepted" },
      { status: 202 },
    );
  });
  const catalog = modelCatalogOf([
    { id: MODEL, name: "GPT-6.1 Sol", provider: MODEL_PROVIDER.OPENAI, efforts: ["low", "high"] },
  ]);
  return { asked, reached: Layer.merge(github.layer, catalog) };
}

it.layer(getTestDB())("an automation the sweep starts", (it) => {
  it.effect(
    "reaches eve as the deployment acting for its owner, under the deployment's own secret and never the cron's bearer the sweep was called with",
    () =>
      Effect.gen(function* () {
        yield* Effect.sync(() => vi.stubEnv(BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN, EVE_ORIGIN));
        const owner = yield* openDueAutomation;
        const eve = githubAndEve();
        const sentry = recordingSentry();
        const database = yield* testDatabase;
        const status = yield* sweep(CRON_SECRET, CRON_SECRET, database, eve.reached).pipe(
          Effect.provide(sentry.layer),
        );
        assert.equal(status, 200);
        assert.deepEqual(eve.asked, [
          {
            url: `${EVE_ORIGIN}/eve/coder/v1/session`,
            authorization: `Bearer ${EVE_DEPLOYMENT_SECRET}`,
            account: owner,
          },
        ]);
      }),
  );
});
