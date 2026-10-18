import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INBOX_REPLY } from "@luke/features/inbox-wire";
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
  "a plan's start carries the workspace it was started in, a start without planning says so, and one naming an agent carries it, to the host; a start naming none carries no such field",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const agent = { idempotencyKey: "start-1", prompt: "Expire invitations." };

      yield* operator.tasksStart({
        name: "Billing export",
        repository: "acme/ledger",
        workspaceId: "workspace-acme",
      });
      yield* operator.tasksStart({ name: "Teammate invitations" });
      yield* operator.tasksStart({ name: "Typo", planning: false });
      yield* operator.tasksStart({ repository: "acme/ledger", agent });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [
            GATEWAY_METHOD.TASKS_START,
            { name: "Billing export", repository: "acme/ledger", workspaceId: "workspace-acme" },
          ],
          [GATEWAY_METHOD.TASKS_START, { name: "Teammate invitations" }],
          [GATEWAY_METHOD.TASKS_START, { name: "Typo", planning: false }],
          [GATEWAY_METHOD.TASKS_START, { repository: "acme/ledger", agent }],
        ],
      );
    }),
);

it.effect("an inbox answer's files travel to the host with its words, under the answer's key", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);
    const attachments = [
      { name: "alerts.yml", mediaType: "text/plain", data: "dGhyZXNob2xk" },
    ] as const;

    yield* operator.codingAgentInboxAnswer({
      itemId: "item-1",
      revision: 2,
      reply: INBOX_REPLY.ANSWERED,
      note: "See the file.",
      attachments,
      clientKey: "answer-1",
    });

    assert.deepEqual(
      requests.map((request) => [request.method, request.params]),
      [
        [
          GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER,
          {
            itemId: "item-1",
            revision: 2,
            reply: INBOX_REPLY.ANSWERED,
            note: "See the file.",
            attachments,
            clientKey: "answer-1",
          },
        ],
      ],
    );
  }),
);
