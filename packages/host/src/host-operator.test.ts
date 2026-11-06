import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  carried,
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  type GatewayMethod,
} from "@repo/gateway";
import { APP_SETTING_SCHEMA, THEME } from "@repo/settings";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import type { AppSettings } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS, type WireRecord } from "@repo/wire";
import { Effect } from "effect";
import { createHostOperator } from "./host-operator.js";
import { recordingReporter } from "./testing/recording-reporter.js";

const SETTINGS: AppSettings = appSettingsWire(settingsView());
const REPORTER = "panel-1";
interface RecordedCall {
  readonly method: GatewayMethod;
  readonly params: WireRecord;
}

/** A client that keeps every call it was handed and accepts each as a settings write. */
function recordingClient() {
  const requests: RecordedCall[] = [];
  const client: GatewayClient = {
    call: (method, params = {}) =>
      Effect.sync(() => {
        requests.push({ method, params });
        return {
          ok: true,
          result: carried({ status: ACTION_RESULT_STATUS.ACCEPTED, settings: SETTINGS }),
        };
      }),
    on: () => () => undefined,
  };
  return { client, requests };
}

function operatorOver(client: GatewayClient) {
  return createHostOperator({ client, report: () => undefined });
}

it.effect("a setting's value travels as the method's value field", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    const result = yield* operator.updateSetting(
      APP_SETTING_SCHEMA.theme.field,
      THEME.DARK,
      REPORTER,
    );

    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request?.method, GATEWAY_METHOD.SETTINGS_UPDATE);
    assert.deepEqual(request?.params, {
      field: APP_SETTING_SCHEMA.theme.field,
      value: THEME.DARK,
      reporter: REPORTER,
    });
  }),
);

it.effect(
  "a Start from an agent that names no task travels to the host with no task key, one on a task with its task, and an empty draft's Call with its blank and call",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const from = { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" };

      yield* operator.agentStart({ idempotencyKey: "press-1", from });
      yield* operator.agentStart({ taskId: "task-1", idempotencyKey: "press-2", from });
      yield* operator.agentStart({
        taskId: "task-1",
        idempotencyKey: "press-3",
        blank: true,
        call: true,
      });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.AGENTS_START, { idempotencyKey: "press-1", from }],
          [GATEWAY_METHOD.AGENTS_START, { taskId: "task-1", idempotencyKey: "press-2", from }],
          [
            GATEWAY_METHOD.AGENTS_START,
            { taskId: "task-1", idempotencyKey: "press-3", blank: true, call: true },
          ],
        ],
      );
    }),
);

it.effect(
  "a host's refusal is not reported to Sentry, where the handler that died behind it already was; an answer this build cannot read is",
  () => {
    const sentry = recordingReporter();
    return Effect.gen(function* () {
      const answering = (answer: GatewayCallResult) =>
        operatorOver({
          call: () => Effect.succeed(answer),
          on: () => () => undefined,
        }).updateSetting(APP_SETTING_SCHEMA.theme.field, THEME.DARK, REPORTER);
      // The router's own boundary, which every act's call through the operator runs under.
      const asked = (answer: GatewayCallResult) =>
        Effect.exit(Effect.withErrorReporting(answering(answer), { defectsOnly: true }));
      yield* asked({
        ok: false,
        error: { code: GATEWAY_ERROR.INTERNAL, message: "board is undefined" },
      });
      yield* asked({ ok: true, result: carried({ status: "sideways" }) });
      assert.deepEqual(sentry.reported, [
        `${GATEWAY_METHOD.SETTINGS_UPDATE} answered a shape this client cannot read`,
      ]);
    }).pipe(Effect.provide(sentry.layer));
  },
);
