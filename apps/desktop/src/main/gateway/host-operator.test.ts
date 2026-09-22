import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { carried, GATEWAY_METHOD, type GatewayClient, type GatewayMethod } from "@sidecar/gateway";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettings } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, TRANSCRIPT_KIND, type WireRecord } from "@sidecar/wire";
import { Effect } from "effect";
import { appSettingsWire } from "../../testing/spoken-setting-bridge";
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
      APP_SETTING_SCHEMA.sessionSearchQuery.field,
      "review",
      REPORTER,
    );

    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request?.method, GATEWAY_METHOD.SETTINGS_UPDATE);
    assert.deepEqual(request?.params, {
      field: APP_SETTING_SCHEMA.sessionSearchQuery.field,
      value: "review",
      reporter: REPORTER,
    });
  }),
);

it.effect("a cleared setting travels as an absent value field, so the clear reaches the host", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    const cleared = yield* operator.updateSetting(
      APP_SETTING_SCHEMA.sessionSearchQuery.field,
      undefined,
      REPORTER,
    );

    assert.equal(cleared.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request !== undefined && "value" in request.params, false);
    assert.deepEqual(request?.params, {
      field: APP_SETTING_SCHEMA.sessionSearchQuery.field,
      reporter: REPORTER,
    });
  }),
);

it.effect("every clearable plain setting reaches the host when cleared", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    const fields = [
      APP_SETTING_SCHEMA.sessionFilters.field,
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
  "opening a transcript names the conversation and its kind, and the close carries nothing",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);

      // The client above answers a settings write, which is no open; the operator reads that as the host not taking it.
      assert.equal(yield* operator.openChildTranscript("agent-1", TRANSCRIPT_KIND.OBSERVED), false);
      yield* operator.closeChildTranscript();

      const [opened, closed] = requests;
      assert.equal(opened?.method, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT);
      assert.deepEqual(opened?.params, {
        conversationId: "agent-1",
        kind: TRANSCRIPT_KIND.OBSERVED,
      });
      assert.equal(closed?.method, GATEWAY_METHOD.CONVERSATION_CLOSE_CHILD_TRANSCRIPT);
      assert.deepEqual(closed?.params, {});
    }),
);

it.effect("a forgotten entry travels as an absent value field", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    yield* operator.updateSettingEntry(
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      "conductor",
      undefined,
      REPORTER,
    );

    const [request] = requests;
    assert.equal(request?.method, GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY);
    assert.deepEqual(request?.params, {
      field: APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      key: "conductor",
      reporter: REPORTER,
    });
  }),
);
