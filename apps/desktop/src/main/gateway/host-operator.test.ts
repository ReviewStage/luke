import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { carried, GATEWAY_METHOD, type GatewayClient, type GatewayMethod } from "@sidecar/gateway";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettings } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { appSettingsWire } from "../../testing/settings-wire";
import { createHostOperator } from "./host-operator";

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
      APP_SETTING_SCHEMA.voiceHotkey.field,
      "Alt+Space",
      REPORTER,
    );

    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request?.method, GATEWAY_METHOD.SETTINGS_UPDATE);
    assert.deepEqual(request?.params, {
      field: APP_SETTING_SCHEMA.voiceHotkey.field,
      value: "Alt+Space",
      reporter: REPORTER,
    });
  }),
);

it.effect("a cleared setting travels as an absent value field, so the clear reaches the host", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    const cleared = yield* operator.updateSetting(
      APP_SETTING_SCHEMA.voiceHotkey.field,
      undefined,
      REPORTER,
    );

    assert.equal(cleared.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request !== undefined && "value" in request.params, false);
    assert.deepEqual(request?.params, {
      field: APP_SETTING_SCHEMA.voiceHotkey.field,
      reporter: REPORTER,
    });
  }),
);

it.effect("every clearable plain setting reaches the host when cleared", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    const fields = [
      APP_SETTING_SCHEMA.voiceHotkey.field,
      APP_SETTING_SCHEMA.stopHotkey.field,
    ] as const;
    for (const field of fields) {
      yield* operator.updateSetting(field, undefined, REPORTER);
    }

    assert.equal(requests.length, fields.length);
    for (const [index, request] of requests.entries()) {
      assert.deepEqual(request?.params, {
        field: fields[index],
        reporter: REPORTER,
      });
    }
  }),
);

it.effect(
  "a board save carries the image of the scene to the host, and a save without one carries none",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const scene = {
        planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
        elements: [],
        appliedDrawing: 2,
      };

      yield* operator.planningBoardSave({ ...scene, image: "iVBORw0KGgo=" });
      yield* operator.planningBoardSave(scene);

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.PLANNING_BOARD_SAVE, { ...scene, image: "iVBORw0KGgo=" }],
          [GATEWAY_METHOD.PLANNING_BOARD_SAVE, scene],
        ],
      );
    }),
);
