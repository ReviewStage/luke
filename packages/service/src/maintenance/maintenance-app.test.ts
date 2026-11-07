import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import { deleteTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { noDatabase } from "@repo/database/testing/no-database";
import { noNetwork } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Clock, Duration, Effect, Layer, Redacted } from "effect";
import { type HttpClient, HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { afterEach, vi } from "vitest";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { GitHubApp } from "../github/github-app.js";
import { type ModelCatalog, modelCatalogOf } from "../providers/model-catalog.js";
import { openGithubUser } from "../testing/github-app-fake.js";
import { recordingSentry, type SentItem, sentOfType } from "../testing/sentry-transport.js";
import { maintenanceApp } from "./maintenance-app.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";

/**
 * The sweep's group as the cron reaches it, told to Sentry's Crons through a
 * recording transport. A sweep that runs does so over an empty migrated
 * database, so it finds nothing to do and reaches no provider; what each
 * sweep does is `maintenance-sweep.test.ts`'s. The exception is a
 * deleted task's agent, whose conversation the purge takes once its
 * retention has passed and not before.
 */

const CRON_SECRET = "cron-secret-1";

afterEach(() => {
  vi.unstubAllEnvs();
});

function environment(cronSecret: string | undefined): HostedEnvironmentValues {
  return {
    posthogPersonalApiKey: undefined,
    posthogProjectId: undefined,
    posthogApiHost: undefined,
    posthogProjectApiKey: undefined,
    posthogIngestHost: undefined,
    cronSecret: cronSecret === undefined ? undefined : Redacted.make(cronSecret),
    githubWebhookSecret: undefined,
    providerKeyEncryptionKeys: undefined,
    titleAnthropicApiKey: undefined,
    previewApiKeys: {},
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
    const request = new Request(`https://app.test${MAINTENANCE_SWEEP_PATH}`, {
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

/** A task with one coding agent on it, deleted now, answering the agent's conversation. */
const deleteTaskWithAgent = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const task = yield* startTask(owner, { name: "Rate limits", repository: "acme/api" });
  const db = yield* Database;
  const conversationId = randomUUID();
  yield* db
    .insert(conversations)
    .values({ id: conversationId, userId: owner, kind: CONVERSATION_KIND.AGENT });
  yield* db.insert(agentTable).values({
    id: randomUUID(),
    organizationId: task.workspaceId,
    userId: owner,
    taskId: task.id,
    conversationId,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/api",
    idempotencyKey: randomUUID(),
  });
  assert.equal(yield* deleteTask(owner, task.id), true);
  return conversationId;
});

/** Whether the conversation's row still stands. */
const stands = (conversationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    return rows.length === 1;
  });

it.layer(getTestDB())("a deleted task's agent", (it) => {
  it.effect(
    "keeps its conversation through a sweep a minute short of seven days after the delete, and loses it to one a minute past",
    () =>
      Effect.gen(function* () {
        const conversationId = yield* deleteTaskWithAgent;
        const database = yield* testDatabase;
        const sweepNow = sweep(CRON_SECRET, CRON_SECRET, database).pipe(
          Effect.provide(recordingSentry().layer),
        );

        yield* TestClock.adjust(Duration.subtract(Duration.days(7), Duration.minutes(1)));
        yield* sweepNow;
        const kept = yield* stands(conversationId);

        yield* TestClock.adjust(Duration.minutes(2));
        yield* sweepNow;
        const purged = !(yield* stands(conversationId));

        assert.deepEqual({ kept, purged }, { kept: true, purged: true });
      }),
  );
});
