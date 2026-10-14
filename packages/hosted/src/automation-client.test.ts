import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedAutomationClient } from "./automation-client.js";
import { AUTOMATION_CALL_FAILURE } from "./automation-view.js";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "./automation-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

/**
 * The window's automation calls against a scripted service: each travels
 * under the account's bearer to its own path, a write's answer is read for
 * its summary alone so a secret the service answered never reaches the
 * window, a write the service would refuse by shape never travels, and a
 * refusal is named in the window's own words. Synthetic ids and words.
 */

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const PLAN_ID = "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";
const SECRET = "window-minted-secret-0123456789abcdefghij";

function client(): HostedAutomationClient {
  return new HostedAutomationClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("ada@example.com"),
  });
}

const SUMMARY = {
  id: AUTOMATION_ID,
  planId: PLAN_ID,
  planName: "Alerts",
  name: "Fix Sentry alerts",
  enabled: true,
  pausedReason: null,
  trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the error the alert names." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: null,
  lastRun: null,
  createdAt: 1,
};

it.effect(
  "a webhook automation is made with the window's own secret in the body, and the answer reaches the window without any secret",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/automations": {
          answer: () => ({ automation: SUMMARY, webhookSecret: "a-secret-the-service-answered" }),
        },
      });

      const made = yield* Effect.provide(
        client().create({
          planId: PLAN_ID,
          name: SUMMARY.name,
          trigger: SUMMARY.trigger,
          action: SUMMARY.action,
          webhookSecret: SECRET,
        }),
        api.layer,
      );

      assert.deepEqual(made, { automation: SUMMARY });
      assert.equal(JSON.stringify(made).includes("secret"), false);
      const [sent] = api.requests();
      assert.equal(JSON.parse(sent?.body ?? "{}").webhookSecret, SECRET);
      assert.deepEqual(api.credentials(), ["token-1"]);
    }),
);

it.effect("each call goes to its own path, and the list names its plan in the query", () =>
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
      [`POST /api/automations/${AUTOMATION_ID}/run`]: {
        answer: () => ({ run }),
      },
      [`GET /api/automations/${AUTOMATION_ID}/runs`]: { answer: () => ({ runs: [run] }) },
      [`POST /api/automations/${AUTOMATION_ID}/webhook-secret`]: {
        answer: () => ({ automation: SUMMARY }),
      },
    });
    const ask = client();
    const named = { automationId: AUTOMATION_ID };

    const listed = yield* Effect.provide(ask.list({ planId: PLAN_ID }), api.layer);
    const changed = yield* Effect.provide(
      ask.change({ ...named, change: { enabled: false } }),
      api.layer,
    );
    const ran = yield* Effect.provide(
      ask.runNow({ ...named, idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3" }),
      api.layer,
    );
    const runs = yield* Effect.provide(ask.runs(named), api.layer);
    const rotated = yield* Effect.provide(
      ask.rotateWebhookSecret({ ...named, webhookSecret: SECRET }),
      api.layer,
    );
    const deleted = yield* Effect.provide(ask.remove(named), api.layer);

    assert.deepEqual(listed, { automations: [SUMMARY] });
    assert.deepEqual(changed, { automation: SUMMARY });
    assert.deepEqual(ran, { run });
    assert.deepEqual(runs, { runs: [run] });
    assert.deepEqual(rotated, { automation: SUMMARY });
    assert.deepEqual(deleted, { deleted: true });
    assert.equal(api.requests()[0]?.searchParams.get("planId"), PLAN_ID);
  }),
);

it.effect(
  "a refusal is named in the window's words, and a write the service would refuse by shape never travels",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "POST /api/automations": {
          answer: () => ({ error: HOSTED_API_ERROR.NO_REPOSITORY }),
          status: HTTP_STATUS.CONFLICT,
        },
        [`GET /api/automations/${AUTOMATION_ID}/runs`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });
      const ask = client();
      const made = {
        planId: PLAN_ID,
        name: SUMMARY.name,
        trigger: SUMMARY.trigger,
        action: SUMMARY.action,
      };

      const noRepository = yield* Effect.provide(ask.create(made), api.layer);
      const gone = yield* Effect.provide(ask.runs({ automationId: AUTOMATION_ID }), api.layer);
      const unsendable = yield* Effect.provide(ask.create({ ...made, name: "" }), api.layer);

      assert.deepEqual(noRepository, { failure: AUTOMATION_CALL_FAILURE.NO_REPOSITORY });
      assert.deepEqual(gone, { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(unsendable, { failure: AUTOMATION_CALL_FAILURE.INVALID });
      assert.equal(api.requests().length, 2, "the unsendable write never traveled");
    }),
);
