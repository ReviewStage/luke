import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  carried,
  GATEWAY_METHOD,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayTransport,
  gatewayClient,
  gatewayRequestFromWire,
  gatewayRequestToWire,
} from "@sidecar/gateway";
import { APP_SETTING_SCHEMA } from "@sidecar/settings";
import { settingsView } from "@sidecar/settings/testing";
import type { AppSettings } from "@sidecar/settings/wire";
import { ACTION_RESULT_STATUS, TRANSCRIPT_KIND } from "@sidecar/wire";
import { Effect } from "effect";
import { appSettingsWire } from "../../testing/spoken-setting-bridge";
import { createHostOperator } from "./host-operator";

const SETTINGS: AppSettings = appSettingsWire(settingsView());
const REPORTER = "panel-1";

/** A transport that keeps every request it was handed and accepts each as a settings write. */
function recordingTransport() {
  const requests: GatewayRequest[] = [];
  const transport: GatewayTransport = {
    request: (request) =>
      Effect.sync(() => {
        requests.push(request);
        const response: GatewayResponse = {
          id: request.id,
          ok: true,
          result: carried({ status: ACTION_RESULT_STATUS.ACCEPTED, settings: SETTINGS }),
          revision: { configuration: 0, sequence: 0 },
        };
        return response;
      }),
    events: () => () => undefined,
    connected: () => true,
  };
  return { transport, requests };
}

function operatorOver(transport: GatewayTransport) {
  let ids = 0;
  return Effect.map(
    gatewayClient({
      transport,
      createId: () => {
        ids += 1;
        return `id-${ids}`;
      },
    }),
    (client) =>
      createHostOperator({
        client,
        lastSettings: () => undefined,
        report: () => undefined,
      }),
  );
}

/**
 * The step a request has to survive to reach the host: the in-process
 * transport encodes it with the protocol's own writer before the door reads
 * it back, and a params record the writer refuses never arrives.
 */
function crossesTheWire(request: GatewayRequest | undefined): GatewayRequest | undefined {
  return request === undefined ? undefined : gatewayRequestFromWire(gatewayRequestToWire(request));
}

it.effect("a setting's value travels as the method's value field", () =>
  Effect.gen(function* () {
    const { transport, requests } = recordingTransport();
    const operator = yield* operatorOver(transport);

    const result = yield* operator.updateSetting(
      APP_SETTING_SCHEMA.sessionSearchQuery.field,
      "review",
      REPORTER,
    );

    assert.equal(result.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request?.method, GATEWAY_METHOD.SETTINGS_UPDATE);
    assert.deepEqual(crossesTheWire(request)?.params, {
      field: APP_SETTING_SCHEMA.sessionSearchQuery.field,
      value: "review",
      reporter: REPORTER,
    });
  }),
);

it.effect("a cleared setting travels as an absent value field, so the clear reaches the host", () =>
  Effect.gen(function* () {
    const { transport, requests } = recordingTransport();
    const operator = yield* operatorOver(transport);

    const cleared = yield* operator.updateSetting(
      APP_SETTING_SCHEMA.sessionSearchQuery.field,
      undefined,
      REPORTER,
    );

    assert.equal(cleared.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(request !== undefined && "value" in request.params, false);
    assert.deepEqual(crossesTheWire(request)?.params, {
      field: APP_SETTING_SCHEMA.sessionSearchQuery.field,
      reporter: REPORTER,
    });
  }),
);

it.effect("every clearable plain setting crosses the wire when cleared", () =>
  Effect.gen(function* () {
    const { transport, requests } = recordingTransport();
    const operator = yield* operatorOver(transport);

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
      assert.deepEqual(crossesTheWire(request)?.params, {
        field: fields[index],
        reporter: REPORTER,
      });
    }
  }),
);

it.effect(
  "opening a transcript travels as a keyed mutation naming the conversation and its kind, and the close carries nothing",
  () =>
    Effect.gen(function* () {
      const { transport, requests } = recordingTransport();
      const operator = yield* operatorOver(transport);

      // The transport above answers a settings write, which is no open; the operator reads that as the host not taking it.
      assert.equal(yield* operator.openChildTranscript("agent-1", TRANSCRIPT_KIND.OBSERVED), false);
      yield* operator.closeChildTranscript();

      const [opened, closed] = requests;
      assert.equal(opened?.method, GATEWAY_METHOD.CONVERSATION_OPEN_CHILD_TRANSCRIPT);
      assert.deepEqual(crossesTheWire(opened)?.params, {
        conversationId: "agent-1",
        kind: TRANSCRIPT_KIND.OBSERVED,
      });
      assert.ok(opened?.idempotencyKey);
      assert.equal(closed?.method, GATEWAY_METHOD.CONVERSATION_CLOSE_CHILD_TRANSCRIPT);
      assert.deepEqual(crossesTheWire(closed)?.params, {});
    }),
);

it.effect("a forgotten entry travels as an absent value field", () =>
  Effect.gen(function* () {
    const { transport, requests } = recordingTransport();
    const operator = yield* operatorOver(transport);

    yield* operator.updateSettingEntry(
      APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      "conductor",
      undefined,
      REPORTER,
    );

    const [request] = requests;
    assert.equal(request?.method, GATEWAY_METHOD.SETTINGS_UPDATE_ENTRY);
    assert.deepEqual(crossesTheWire(request)?.params, {
      field: APP_SETTING_SCHEMA.workspaceProjectDefaults.field,
      key: "conductor",
      reporter: REPORTER,
    });
  }),
);
