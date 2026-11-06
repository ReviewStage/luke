import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import { carried, GATEWAY_METHOD, type GatewayClient, type GatewayMethod } from "@repo/gateway";
import { appSettingsWire, settingsView } from "@repo/settings/testing";
import type { AppSettings } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS, type WireRecord } from "@repo/wire";
import { Effect } from "effect";
import { createHostOperator } from "./host-operator.js";

const SETTINGS: AppSettings = appSettingsWire(settingsView());
/** A task's agents run on the member's Studio. */
const ON_STUDIO = {
  machine: AGENT_MACHINE.DEVICE,
  deviceId: "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11",
} as const;

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

it.effect(
  "a plan's start carries the workspace it was started in, its brief, a start without planning says so, and one naming an agent or a device to run on carries it, to the host; a start naming none carries no such field",
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
      yield* operator.tasksStart({ brief: "Let any member invite a teammate." });
      yield* operator.tasksStart({ repository: "acme/ledger", runsOn: ON_STUDIO });

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
          [GATEWAY_METHOD.TASKS_START, { brief: "Let any member invite a teammate." }],
          [GATEWAY_METHOD.TASKS_START, { repository: "acme/ledger", runsOn: ON_STUDIO }],
        ],
      );
    }),
);

it.effect("a task filed for later carries its status, priority, and assignee to the host", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    yield* operator.tasksStart({
      name: "Rate limit search",
      planning: false,
      status: TASK_STATUS.BACKLOG,
      priority: TASK_PRIORITY.HIGH,
      assigneeId: "user-ada",
    });

    assert.deepEqual(
      requests.map((request) => [request.method, request.params]),
      [
        [
          GATEWAY_METHOD.TASKS_START,
          {
            name: "Rate limit search",
            planning: false,
            status: TASK_STATUS.BACKLOG,
            priority: TASK_PRIORITY.HIGH,
            assigneeId: "user-ada",
          },
        ],
      ],
    );
  }),
);
