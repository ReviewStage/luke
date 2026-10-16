import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { carried, GATEWAY_METHOD, type GatewayClient, type GatewayMethod } from "@luke/gateway";
import { APP_SETTING_SCHEMA } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import type { AppSettings } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS, type WireRecord } from "@luke/wire";
import { Effect } from "effect";
import { createHostOperator } from "./host-operator.js";

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

it.effect(
  "a plan's start carries the workspace it was started in to the host, and a start naming none carries no workspace field",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);

      yield* operator.planningStart({
        name: "Billing export",
        repository: "acme/ledger",
        workspaceId: "workspace-acme",
      });
      yield* operator.planningStart({ name: "Teammate invitations" });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [
            GATEWAY_METHOD.PLANNING_START,
            { name: "Billing export", repository: "acme/ledger", workspaceId: "workspace-acme" },
          ],
          [GATEWAY_METHOD.PLANNING_START, { name: "Teammate invitations" }],
        ],
      );
    }),
);

it.effect(
  "a read travels to the host naming its workspace and a forget its workspace and id, and the host's memories read with a key a newer host added dropped",
  () =>
    Effect.gen(function* () {
      const requests: RecordedCall[] = [];
      const memory = {
        id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
        text: "Deployments go out from the release branch.",
        keptBy: { userId: "user-1", name: "Dean" },
        forgettable: false,
        createdAt: 1,
        updatedAt: 2,
      };
      const workspaceId = "workspace-1";
      const client: GatewayClient = {
        call: (method, params = {}) =>
          Effect.sync(() => {
            requests.push({ method, params });
            return { ok: true, result: carried({ memories: [{ ...memory, pinned: true }] }) };
          }),
        on: () => () => undefined,
      };
      const operator = operatorOver(client);

      const read = yield* operator.memoriesRead({ workspaceId });
      yield* operator.memoryForget({ workspaceId, id: memory.id });

      assert.deepEqual(read, { memories: [memory] });
      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.MEMORIES_READ, { workspaceId }],
          [GATEWAY_METHOD.MEMORIES_FORGET, { workspaceId, id: memory.id }],
        ],
      );
    }),
);
