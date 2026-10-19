import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@luke/wire/testing";
import { Effect } from "effect";
import { accountBearer } from "./account-call.js";
import { HostedAutomationClient } from "./automation-client.js";
import { AUTOMATION_CALL_FAILURE } from "./automation-view.js";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "./automation-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * The window's automation calls against a scripted service: each travels
 * under the account's bearer to its own path, a write's answer is read for
 * its summary alone so a secret the service answered never reaches the
 * window, a write the service would refuse by shape never travels, and a
 * refusal is named in the window's own words. Synthetic ids and words.
 */

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

function client(): HostedAutomationClient {
  return new HostedAutomationClient({
    serviceBaseUrl: "https://tryluke.dev",
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.succeed("ada@example.com"),
    }),
  });
}

const SCHEDULE = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 9 * * 1-5",
  timezone: "UTC",
} as const;

const SUMMARY = {
  id: AUTOMATION_ID,
  planId: null,
  planName: null,
  workspaceId: WORKSPACE_ID,
  name: "Triage new issues",
  enabled: true,
  pausedReason: null,
  trigger: SCHEDULE,
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage the issues opened today." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: 10,
  lastRun: null,
  createdAt: 1,
  repositories: ["acme/web"],
};

const MADE = {
  workspaceId: WORKSPACE_ID,
  repositories: ["acme/web"],
  name: SUMMARY.name,
  trigger: SCHEDULE,
  action: SUMMARY.action,
};

it.effect(
  "an automation is made on its workspace under the account's bearer, and a webhook secret the service minted is answered once for the window to show",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/automations": {
          answer: () => ({ automation: SUMMARY, webhookSecret: "a-secret-the-service-answered" }),
        },
      });

      const made = yield* Effect.provide(client().create(MADE), api.layer);

      assert.deepEqual(made, {
        automation: SUMMARY,
        webhookSecret: "a-secret-the-service-answered",
      });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), MADE);
      assert.deepEqual(api.credentials(), ["token-1"]);
    }),
);

it.effect("each call goes to its own path, and the list names its workspace in the query", () =>
  Effect.gen(function* () {
    const run = {
      id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
      firing: { kind: "manual" },
      status: "started",
      reason: null,
      agent: null,
      firedAt: 2,
      settledAt: 3,
    };
    const api = fakeCloudApi({
      "GET /api/automations": { answer: () => ({ automations: [SUMMARY] }) },
      [`PATCH /api/automations/${AUTOMATION_ID}`]: { answer: () => ({ automation: SUMMARY }) },
      [`DELETE /api/automations/${AUTOMATION_ID}`]: { answer: () => ({}) },
      [`POST /api/automations/${AUTOMATION_ID}/run`]: { answer: () => ({ run }) },
      [`GET /api/automations/${AUTOMATION_ID}/runs`]: { answer: () => ({ runs: [run] }) },
    });
    const ask = client();
    const named = { automationId: AUTOMATION_ID };

    const listed = yield* Effect.provide(ask.list({ workspaceId: WORKSPACE_ID }), api.layer);
    const changed = yield* Effect.provide(
      ask.change({ ...named, change: { enabled: false } }),
      api.layer,
    );
    const ran = yield* Effect.provide(
      ask.runNow({ ...named, idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3" }),
      api.layer,
    );
    const runs = yield* Effect.provide(ask.runs(named), api.layer);
    const deleted = yield* Effect.provide(ask.remove(named), api.layer);

    assert.deepEqual(listed, { automations: [SUMMARY] });
    assert.deepEqual(changed, { automation: SUMMARY });
    assert.deepEqual(ran, { run });
    assert.deepEqual(runs, { runs: [run] });
    assert.deepEqual(deleted, { deleted: true });
    assert.equal(api.requests()[0]?.searchParams.get("workspaceId"), WORKSPACE_ID);
    assert.equal(api.requests()[0]?.searchParams.get("planId"), null);
  }),
);

it.effect(
  "a refusal is named in the window's words, with why a repository is out of reach, and a write the service would refuse by shape never travels",
  () =>
    Effect.gen(function* () {
      const unreached = { reason: REPOSITORY_UNREACHED.NOT_CONNECTED, repository: "acme/web" };
      const api = fakeCloudApi({
        "POST /api/automations": {
          answer: () => ({ error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached }),
          status: HTTP_STATUS.CONFLICT,
        },
        [`GET /api/automations/${AUTOMATION_ID}/runs`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });
      const ask = client();

      const outOfReach = yield* Effect.provide(ask.create(MADE), api.layer);
      const gone = yield* Effect.provide(ask.runs({ automationId: AUTOMATION_ID }), api.layer);
      const unnamed = yield* Effect.provide(ask.create({ ...MADE, name: "" }), api.layer);
      const unspelled = yield* Effect.provide(
        ask.change({ automationId: AUTOMATION_ID, change: { repositories: ["not a repository"] } }),
        api.layer,
      );

      assert.deepEqual(outOfReach, {
        failure: AUTOMATION_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
        unreached,
      });
      assert.deepEqual(gone, { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(unnamed, { failure: AUTOMATION_CALL_FAILURE.INVALID });
      assert.deepEqual(unspelled, { failure: AUTOMATION_CALL_FAILURE.INVALID });
      assert.equal(api.requests().length, 2, "no unsendable write traveled");
    }),
);

it.effect(
  "a webhook's secret is replaced by the hash the host sends, and a window's own write to a webhook answers the secret the service minted",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`PATCH /api/automations/${AUTOMATION_ID}`]: {
          answer: () => ({
            automation: { ...SUMMARY, trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
            webhookSecret: "a-secret-the-service-minted",
          }),
        },
      });

      const replaced = yield* Effect.provide(
        client().replaceWebhookSecret({
          automationId: AUTOMATION_ID,
          webhookSecretHash: "ab".repeat(32),
        }),
        api.layer,
      );
      const toWebhook = yield* Effect.provide(
        client().change({
          automationId: AUTOMATION_ID,
          change: { trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
        }),
        api.layer,
      );

      assert.ok(!("failure" in replaced) && replaced.automation.id === AUTOMATION_ID);
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        webhookSecretHash: "ab".repeat(32),
      });
      assert.ok(
        !("failure" in toWebhook) && toWebhook.webhookSecret === "a-secret-the-service-minted",
      );
    }),
);

it.effect(
  "a webhook automation is read with the address its caller posts to on the service this client reaches, and any other with none",
  () =>
    Effect.gen(function* () {
      const hooked = {
        ...SUMMARY,
        id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
        trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      };
      const api = fakeCloudApi({
        "GET /api/automations": { answer: () => ({ automations: [SUMMARY, hooked] }) },
      });

      const listed = yield* Effect.provide(client().list({}), api.layer);

      assert.ok(!("failure" in listed));
      assert.deepEqual(
        listed.automations.map((each) => each.webhookUrl),
        [undefined, `https://tryluke.dev/api/automations/${hooked.id}/webhook`],
      );
    }),
);
