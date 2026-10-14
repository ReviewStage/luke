import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@sidecar/gateway";
import { AUTOMATION_CALL_FAILURE } from "@sidecar/hosted/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@sidecar/hosted/automation-wire";
import type { WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { type AutomationsClient, composeAutomations } from "./compose-automations.js";

/**
 * The automations concern: behind a closed gate nothing is asked of the
 * service, a write's params, a webhook's window-minted secret among them,
 * reach the service as the window named them, the window hears the
 * service's answer whole, and params of the wrong shape are refused before
 * anything travels. Synthetic ids and words.
 */

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const PLAN_ID = "9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e";
const SECRET = "window-minted-secret-0123456789abcdefghij";

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

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
} as const;

const CREATE = {
  planId: PLAN_ID,
  name: SUMMARY.name,
  trigger: SUMMARY.trigger,
  action: SUMMARY.action,
  webhookSecret: SECRET,
};

/** The service as a script that writes down every ask it hears, as the ask runs. */
function fakeService() {
  const asked: unknown[] = [];
  const answer =
    <A>(name: string, value: A) =>
    (params: Parameters<AutomationsClient[keyof AutomationsClient]>[0]) =>
      Effect.sync(() => {
        asked.push([name, params]);
        return value;
      });
  const client: AutomationsClient = {
    list: answer("list", { automations: [SUMMARY] }),
    create: answer("create", { automation: SUMMARY }),
    change: answer("change", { automation: SUMMARY }),
    remove: answer("remove", { deleted: true } as const),
    runNow: answer("run", { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND }),
    runs: answer("runs", { runs: [] }),
    rotateWebhookSecret: answer("rotate", { automation: SUMMARY }),
  };
  return { client, asked };
}

function subject(options: { signedIn?: boolean; sendsNetwork?: boolean } = {}) {
  return Effect.gen(function* () {
    const service = fakeService();
    const composer = yield* composeAutomations({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked };
  });
}

it.effect("behind a closed account gate, or on a run that sends nothing, nothing is asked", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { call, asked } = yield* subject(options);
      assert.deepEqual(yield* call(GATEWAY_METHOD.AUTOMATIONS_LIST), {
        failure: AUTOMATION_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(yield* call(GATEWAY_METHOD.AUTOMATIONS_CREATE, CREATE), {
        failure: AUTOMATION_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(asked, []);
    }
  }),
);

it.effect(
  "a write's params reach the service as the window named them, a webhook's secret among them, and the window hears the answer whole",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const named = { automationId: AUTOMATION_ID };

      const made = yield* call(GATEWAY_METHOD.AUTOMATIONS_CREATE, CREATE);
      const rotated = yield* call(GATEWAY_METHOD.AUTOMATIONS_WEBHOOK_SECRET, {
        ...named,
        webhookSecret: SECRET,
      });
      const ran = yield* call(GATEWAY_METHOD.AUTOMATIONS_RUN, {
        ...named,
        idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
      });
      const deleted = yield* call(GATEWAY_METHOD.AUTOMATIONS_DELETE, named);

      assert.deepEqual(made, { automation: SUMMARY });
      assert.deepEqual(rotated, { automation: SUMMARY });
      assert.deepEqual(ran, { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(deleted, { deleted: true });
      assert.deepEqual(asked.slice(0, 2), [
        ["create", CREATE],
        ["rotate", { ...named, webhookSecret: SECRET }],
      ]);
    }),
);

it.effect("params of the wrong shape are refused before anything travels", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    const refused = yield* Effect.flip(
      call(GATEWAY_METHOD.AUTOMATIONS_WEBHOOK_SECRET, {
        automationId: AUTOMATION_ID,
        webhookSecret: "too-short",
      }),
    );

    assert.equal(refused._tag, "InvalidParamsRefusal");
    assert.deepEqual(asked, []);
  }),
);
