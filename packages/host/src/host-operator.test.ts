import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INBOX_REPLY, type InboxAnswers } from "@luke/features/inbox-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { TASK_PRIORITY, TASK_STATUS } from "@luke/features/task-wire";
import {
  carried,
  GATEWAY_ERROR,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  type GatewayMethod,
} from "@luke/gateway";
import { APP_SETTING_SCHEMA, THEME } from "@luke/settings";
import { appSettingsWire, settingsView } from "@luke/settings/testing";
import type { AppSettings } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS, type WireRecord } from "@luke/wire";
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
  "a plan's start carries the workspace it was started in, its brief, a start without planning says so, and one naming an agent carries it, to the host; a start naming none carries no such field",
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
        ],
      );
    }),
);

it.effect("a save names the kind of credential it carries, and an API key's names none", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);
    const key = "sk-ant-oat01-fake-setup-token-0000";

    yield* operator.providerKeySave({
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key,
    });
    yield* operator.providerKeySave({ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key });

    assert.deepEqual(
      requests.map((request) => [request.method, request.params]),
      [
        [
          GATEWAY_METHOD.PROVIDER_KEYS_SAVE,
          {
            provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
            kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
            key,
          },
        ],
        [GATEWAY_METHOD.PROVIDER_KEYS_SAVE, { provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key }],
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

it.effect(
  "a Start from an agent that names no task travels to the host with no task key, and one on a task with its task",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const from = { agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21" };

      yield* operator.codingAgentStart({ idempotencyKey: "press-1", from });
      yield* operator.codingAgentStart({ taskId: "task-1", idempotencyKey: "press-2", from });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.CODING_AGENTS_START, { idempotencyKey: "press-1", from }],
          [
            GATEWAY_METHOD.CODING_AGENTS_START,
            { taskId: "task-1", idempotencyKey: "press-2", from },
          ],
        ],
      );
    }),
);

it.effect(
  "an operator's ensure carries its Reset, the archived operator its Undo brings back, and the reader's zone to the host, and a plain ensure none of them",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const workspaceId = "workspace-acme";
      const timeZone = "America/New_York";

      yield* operator.codingAgentEnsureOperator({ workspaceId });
      yield* operator.codingAgentEnsureOperator({ workspaceId, reset: true, timeZone });
      yield* operator.codingAgentEnsureOperator({ workspaceId, restore: "operator-old", timeZone });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.CODING_AGENTS_ENSURE_OPERATOR, { workspaceId }],
          [GATEWAY_METHOD.CODING_AGENTS_ENSURE_OPERATOR, { workspaceId, reset: true, timeZone }],
          [
            GATEWAY_METHOD.CODING_AGENTS_ENSURE_OPERATOR,
            { workspaceId, restore: "operator-old", timeZone },
          ],
        ],
      );
    }),
);

it.effect("a nod on an inbox notice travels to the host as its revision and its key alone", () =>
  Effect.gen(function* () {
    const { client, requests } = recordingClient();
    const operator = operatorOver(client);

    yield* operator.codingAgentInboxAnswer({
      itemId: "item-1",
      revision: 2,
      reply: INBOX_REPLY.ACKNOWLEDGED,
      clientKey: "nod-1",
    });

    assert.deepEqual(
      requests.map((request) => [request.method, request.params]),
      [
        [
          GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER,
          { itemId: "item-1", revision: 2, reply: INBOX_REPLY.ACKNOWLEDGED, clientKey: "nod-1" },
        ],
      ],
    );
  }),
);

it.effect(
  "a message on an inbox item's thread carries the answer to its open ask to the host beside its words, and a plain reply carries none",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const answers: InboxAnswers = {
        ask: "7f4d0b2a-3c5e-4a81-9d9f-4e6a8c0d2f3b",
        reply: INBOX_REPLY.CHOSE,
        choices: ["Ship it"],
      };

      yield* operator.codingAgentInboxMessage({
        itemId: "item-1",
        text: "Ship it today.",
        clientKey: "message-1",
        answers,
      });
      yield* operator.codingAgentInboxMessage({
        itemId: "item-1",
        text: "Any news?",
        clientKey: "message-2",
      });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [
            GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE,
            { itemId: "item-1", text: "Ship it today.", clientKey: "message-1", answers },
          ],
          [
            GATEWAY_METHOD.CODING_AGENTS_INBOX_MESSAGE,
            { itemId: "item-1", text: "Any news?", clientKey: "message-2" },
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
        private: false,
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
