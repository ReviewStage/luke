import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createAutomation,
  listAutomationRuns,
  queuedAutomationRuns,
} from "@luke/database/models/automation-store";
import {
  activeInstallationWorkspace,
  linkIntegrationInstallation,
} from "@luke/database/models/integration-installation-store";
import { getTestDB, startTask } from "@luke/database/testing";
import { HOSTED_API_ERROR } from "@luke/features";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
  type IntegrationTrigger,
} from "@luke/features/automation-wire";
import { SENTRY_TRIGGER_EVENT, TRIGGER_PROVIDER } from "@luke/features/trigger-catalog";
import type { WireBoundaryInput } from "@luke/wire";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { openGithubUser } from "../testing/github-app-fake.js";
import { SentryApp, type SentryAppSettings, sentryAppService } from "./sentry/sentry-app-config.js";
import { triggerIngressApp } from "./trigger-ingress-app.js";

/**
 * The trigger ingress answering Sentry the way a function answers it, over
 * a real dialect: a signed alert through a workspace's installation queues
 * one run for each of that workspace's automations listening for it whose
 * filters it passes, carrying the issue and the summary and never the body;
 * Sentry's redelivery under the same `Request-ID` queues none; another
 * workspace's automation never queues; a delivery through an installation
 * no workspace stands for, or one uninstalled since, is answered and queues
 * nothing; and a delivery whose signature does not hold is refused, as is
 * every delivery to a deployment with no Sentry integration configured.
 * Synthetic accounts, organizations, and words throughout.
 */

const ORIGIN = "https://luke.test";
const PATH = "/api/triggers/sentry";
const SECRET = "synthetic-client-secret";
const FIXTURE_INSTALLATION = "a8e5d37a-696c-4c54-adb5-b3f28d64c7de";

const SETTINGS: SentryAppSettings = {
  slug: "luke",
  clientId: "client",
  clientSecret: Redacted.make(SECRET),
};

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The ingress over the test's own database, with the integration configured or not. */
const standing = (settings: SentryAppSettings | undefined) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(SentryApp, sentryAppService(settings, ["SENTRY_APP_CLIENT_SECRET"])),
    );
    const ingress = HttpRouter.toWebHandler(
      triggerIngressApp().pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => ingress.dispose()));
    const ask = (init: RequestInit) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          ingress.handler(new Request(`${ORIGIN}${PATH}`, init)),
        );
        // SAFETY: the group answers JSON; the test reads it as the wire value it is.
        const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
    return { ask };
  });

/** A fixture's body, delivered through the installation named. */
function fixture(name: string, installation: string): string {
  return readFileSync(
    new URL(`./sentry/__fixtures__/${name}.json`, import.meta.url),
    "utf8",
  ).replaceAll(FIXTURE_INSTALLATION, installation);
}

/** A delivery as Sentry sends it: signed under the secret given, about the resource named. */
function delivery(
  resource: string,
  body: string,
  options: { readonly requestId?: string; readonly secret?: string } = {},
): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "request-id": options.requestId ?? randomUUID(),
      "sentry-hook-resource": resource,
      "sentry-hook-signature": createHmac("sha256", options.secret ?? SECRET)
        .update(body)
        .digest("hex"),
    },
    body,
  };
}

/** A workspace with Sentry installed on it under a fresh installation, and a member of it. */
const openWorkspace = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const task = yield* startTask(owner, { name: "Errors", repository: null });
  const installation = randomUUID();
  yield* linkIntegrationInstallation({
    provider: TRIGGER_PROVIDER.SENTRY,
    externalId: installation,
    organizationId: task.workspaceId,
    userId: owner,
  });
  return { owner, workspaceId: task.workspaceId, installation };
});

/** An automation of the workspace on the Sentry event, filtered as named. */
const sentryAutomation = (
  owner: string,
  workspaceId: string,
  event: IntegrationTrigger["event"],
  filters?: IntegrationTrigger["filters"],
) =>
  Effect.map(
    createAutomation(owner, {
      taskId: null,
      organizationId: workspaceId,
      repositories: ["Acme/Storefront"],
      name: "Fix Sentry errors",
      trigger: {
        kind: AUTOMATION_TRIGGER.INTEGRATION,
        provider: TRIGGER_PROVIDER.SENTRY,
        event,
        ...(filters === undefined ? undefined : { filters }),
      },
      action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the error the event names." },
      guards: AUTOMATION_DEFAULT_GUARDS,
      nextRunAt: null,
      webhookSecretHash: null,
    }),
    Option.getOrThrow,
  );

const queuedOf = (automationId: string) =>
  Effect.map(queuedAutomationRuns(new Date(0), 100), (runs) =>
    runs.filter((run) => run.automationId === automationId),
  );

it.layer(getTestDB())("the trigger ingress", (it) => {
  it.effect(
    "a signed alert queues one run per matching automation of the workspace, with the issue and summary, and Sentry's redelivery queues none",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, installation } = yield* openWorkspace;
        const { ask } = yield* standing(SETTINGS);
        const matching = yield* sentryAutomation(
          owner,
          workspaceId,
          SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          { project: ["Storefront"], environment: ["production", "staging"] },
        );
        const filteredOut = yield* sentryAutomation(
          owner,
          workspaceId,
          SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          { level: ["fatal"] },
        );
        const otherEvent = yield* sentryAutomation(
          owner,
          workspaceId,
          SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
        );
        const body = fixture("event-alert-triggered", installation);
        const requestId = randomUUID();

        const first = yield* ask(delivery("event_alert", body, { requestId }));
        const again = yield* ask(delivery("event_alert", body, { requestId }));

        assert.deepEqual(
          [first, again],
          [
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 1 } },
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 0 } },
          ],
        );
        const [run, ...rest] = yield* queuedOf(matching.id);
        assert.equal(rest.length, 0);
        assert.deepEqual(run?.firing, {
          kind: AUTOMATION_FIRING.INTEGRATION,
          provider: TRIGGER_PROVIDER.SENTRY,
          event: SENTRY_TRIGGER_EVENT.ALERT_TRIGGERED,
          subject: {
            id: "1117540176",
            title: "TypeError: Cannot read properties of undefined (reading 'percent')",
            url: "https://sentry.io/organizations/acme/issues/1117540176/",
          },
        });
        assert.match(run?.payload ?? "", /^Alert rule: Checkout errors in production$/mu);
        assert.doesNotMatch(run?.payload ?? "", /event_id|fingerprint/u, "the body is not kept");
        assert.equal((yield* listAutomationRuns(owner, filteredOut.id)).length, 0);
        assert.equal((yield* listAutomationRuns(owner, otherEvent.id)).length, 0);
      }),
  );

  it.effect("another workspace's automation never queues on a workspace's delivery", () =>
    Effect.gen(function* () {
      const ours = yield* openWorkspace;
      const theirs = yield* openWorkspace;
      const { ask } = yield* standing(SETTINGS);
      const mine = yield* sentryAutomation(
        ours.owner,
        ours.workspaceId,
        SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
      );
      const other = yield* sentryAutomation(
        theirs.owner,
        theirs.workspaceId,
        SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
      );

      const answer = yield* ask(delivery("issue", fixture("issue-created", ours.installation)));

      assert.deepEqual(answer, { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 1 } });
      assert.equal((yield* listAutomationRuns(ours.owner, mine.id)).length, 1);
      assert.equal((yield* listAutomationRuns(theirs.owner, other.id)).length, 0);
    }),
  );

  it.effect(
    "a delivery through an installation no workspace stands for, or one uninstalled since, queues nothing and is still answered",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, installation } = yield* openWorkspace;
        const { ask } = yield* standing(SETTINGS);
        const automation = yield* sentryAutomation(
          owner,
          workspaceId,
          SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
        );

        const unknown = yield* ask(delivery("issue", fixture("issue-created", randomUUID())));
        const uninstalled = yield* ask(
          delivery("installation", fixture("installation-deleted", installation)),
        );
        const late = yield* ask(delivery("issue", fixture("issue-created", installation)));

        assert.deepEqual(
          [unknown, uninstalled, late],
          [
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 0 } },
            { status: HOSTED_HTTP_STATUS.OK, body: { queued: 0 } },
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 0 } },
          ],
        );
        assert.ok(
          Option.isNone(yield* activeInstallationWorkspace(TRIGGER_PROVIDER.SENTRY, installation)),
        );
        assert.equal((yield* listAutomationRuns(owner, automation.id)).length, 0);
      }),
  );

  it.effect(
    "a delivery signed under another secret, unsigned, or not a POST is refused, and an unconfigured deployment refuses them all",
    () =>
      Effect.gen(function* () {
        const { owner, workspaceId, installation } = yield* openWorkspace;
        const automation = yield* sentryAutomation(
          owner,
          workspaceId,
          SENTRY_TRIGGER_EVENT.ISSUE_CREATED,
        );
        const body = fixture("issue-created", installation);
        const { ask } = yield* standing(SETTINGS);
        const unconfigured = yield* standing(undefined);
        const signed = delivery("issue", body);

        assert.deepEqual(
          [
            yield* ask(delivery("issue", body, { secret: "another-secret" })),
            yield* ask({ method: "POST", headers: { "sentry-hook-resource": "issue" }, body }),
            yield* ask({ method: "GET" }),
            yield* unconfigured.ask(signed),
          ],
          [
            {
              status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
              body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
            },
            {
              status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
              body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
            },
            {
              status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
              body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
            },
            {
              status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
              body: { error: HOSTED_API_ERROR.UNAVAILABLE },
            },
          ],
        );
        assert.equal((yield* listAutomationRuns(owner, automation.id)).length, 0);
      }),
  );
});
