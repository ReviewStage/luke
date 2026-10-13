import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { carried, GATEWAY_METHOD, type GatewayClient, type GatewayMethod } from "@sidecar/gateway";
import { CODING_AGENT_CALL_FAILURE } from "@sidecar/hosted/coding-agent-view";
import { CONTEXT_WINDOW } from "@sidecar/hosted/coding-agent-wire";
import { INBOX_REPLY } from "@sidecar/hosted/inbox-wire";
import { INTEGRATION_PROVIDER } from "@sidecar/hosted/integration-wire";
import { PLAN_CALL_FAILURE } from "@sidecar/hosted/planning-view";
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
  "a file read raw carries raw to the host, one read at a commit carries the commit, and a window read carries neither",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const planId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
      const window = { planId, path: "src/invite.ts", firstLine: 1, lastLine: 1 };
      const ref = "0123456789abcdef0123456789abcdef01234567";

      yield* operator.planningFile({ ...window, raw: true });
      yield* operator.planningFile({ ...window, ref });
      yield* operator.planningFile(window);

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.PLANNING_FILE, { ...window, raw: true }],
          [GATEWAY_METHOD.PLANNING_FILE, { ...window, ref }],
          [GATEWAY_METHOD.PLANNING_FILE, window],
        ],
      );
    }),
);

it.effect(
  "a folder's listing asked whole carries recursive to the host, and one asked alone carries none",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const planId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

      yield* operator.planningTree({ planId, path: "", recursive: true });
      yield* operator.planningTree({ planId, path: "src" });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.PLANNING_TREE, { planId, path: "", recursive: true }],
          [GATEWAY_METHOD.PLANNING_TREE, { planId, path: "src" }],
        ],
      );
    }),
);

it.effect(
  "a repository's skills are asked of the host by the plan alone, and an answer the window does not read is unanswered",
  () =>
    Effect.gen(function* () {
      const planId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
      const skills = {
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [
            {
              name: "release",
              description: "Cut a release of the relay.",
              path: ".agents/skills/release/SKILL.md",
            },
          ],
        },
      };
      const answers = [carried(skills), carried({ skills: "none" })];
      const requests: RecordedCall[] = [];
      const operator = operatorOver({
        call: (method, params = {}) =>
          Effect.sync(() => {
            requests.push({ method, params });
            return { ok: true, result: answers.shift() ?? carried({}) };
          }),
        on: () => () => undefined,
      });

      assert.deepEqual(yield* operator.planningSkills({ planId }), skills);
      assert.deepEqual(yield* operator.planningSkills({ planId }), {
        failure: PLAN_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.PLANNING_SKILLS, { planId }],
          [GATEWAY_METHOD.PLANNING_SKILLS, { planId }],
        ],
      );
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

it.effect(
  "the standard context window travels to the host with a Start, a change, and the default, and a choice naming none carries no window field",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const planId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
      const standard = {
        model: "openai/gpt-5.5",
        effort: "high",
        contextWindow: CONTEXT_WINDOW.STANDARD,
      };

      yield* operator.codingAgentStart({ planId, idempotencyKey: "press-1", ...standard });
      yield* operator.codingAgentChoose({ agentId: "agent-1", ...standard });
      yield* operator.codingAgentChoose({
        agentId: "agent-1",
        model: standard.model,
        effort: "low",
      });
      yield* operator.codingAgentDefaultWrite(standard);

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.CODING_AGENTS_START, { planId, idempotencyKey: "press-1", ...standard }],
          [GATEWAY_METHOD.CODING_AGENTS_CHOOSE, { agentId: "agent-1", ...standard }],
          [
            GATEWAY_METHOD.CODING_AGENTS_CHOOSE,
            { agentId: "agent-1", model: standard.model, effort: "low" },
          ],
          [GATEWAY_METHOD.CODING_AGENTS_DEFAULT_WRITE, standard],
        ],
      );
    }),
);

it.effect(
  "a Start's task travels to the host with the Start, and a Start with none carries no task field",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const planId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

      yield* operator.codingAgentStart({
        planId,
        idempotencyKey: "press-1",
        task: "Rename the invite email's subject.",
      });
      yield* operator.codingAgentStart({ planId, idempotencyKey: "press-2" });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [
            GATEWAY_METHOD.CODING_AGENTS_START,
            { planId, idempotencyKey: "press-1", task: "Rename the invite email's subject." },
          ],
          [GATEWAY_METHOD.CODING_AGENTS_START, { planId, idempotencyKey: "press-2" }],
        ],
      );
    }),
);

it.effect(
  "the files attached to a task or a message, and the MCP servers a draft switched off, travel to the host with it, and a Start or a message with none carries no such field",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const planId = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
      const attachments = [
        { name: "shot.png", mediaType: "image/png", data: "iVBORw0KGgo=" } as const,
      ];

      yield* operator.codingAgentStart({
        planId,
        idempotencyKey: "press-1",
        task: "Fix what this shows.",
        attachments,
        disabledServers: [INTEGRATION_PROVIDER.LINEAR],
      });
      yield* operator.codingAgentMessage({
        agentId: "agent-1",
        text: "And this.",
        clientKey: "send-1",
        attachments,
      });
      yield* operator.codingAgentMessage({
        agentId: "agent-1",
        text: "Go on.",
        clientKey: "send-2",
      });

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [
            GATEWAY_METHOD.CODING_AGENTS_START,
            {
              planId,
              idempotencyKey: "press-1",
              task: "Fix what this shows.",
              attachments,
              disabledServers: [INTEGRATION_PROVIDER.LINEAR],
            },
          ],
          [
            GATEWAY_METHOD.CODING_AGENTS_MESSAGE,
            { agentId: "agent-1", text: "And this.", clientKey: "send-1", attachments },
          ],
          [
            GATEWAY_METHOD.CODING_AGENTS_MESSAGE,
            { agentId: "agent-1", text: "Go on.", clientKey: "send-2" },
          ],
        ],
      );
    }),
);

it.effect(
  "an inbox answer's options, a form's values, and the note travel to the host with the answer, and an answer naming none carries no such field",
  () =>
    Effect.gen(function* () {
      const { client, requests } = recordingClient();
      const operator = operatorOver(client);
      const itemId = "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a";
      const chose = {
        itemId,
        revision: 2,
        reply: INBOX_REPLY.CHOSE,
        choices: ["Keep the old column", "Backfill first"],
        note: "Drop it after the backfill.",
        clientKey: "answer-1",
      };
      const filled = {
        itemId,
        revision: 2,
        reply: INBOX_REPLY.SUBMITTED,
        values: [
          { label: "Host", value: "smtp.acme.test" },
          { label: "Port", value: 587 },
          { label: "Verify certificate", value: true },
        ],
        clientKey: "answer-3",
      };
      const approved = { itemId, revision: 3, reply: INBOX_REPLY.APPROVED, clientKey: "answer-2" };

      yield* operator.codingAgentInboxAnswer(chose);
      yield* operator.codingAgentInboxAnswer(filled);
      yield* operator.codingAgentInboxAnswer(approved);

      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER, chose],
          [GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER, filled],
          [GATEWAY_METHOD.CODING_AGENTS_INBOX_ANSWER, approved],
        ],
      );
    }),
);

it.effect(
  "a plan template travels to the host as the method's template, a reset as null, and the host's answer reads with a key a newer host added dropped",
  () =>
    Effect.gen(function* () {
      const requests: RecordedCall[] = [];
      const client: GatewayClient = {
        call: (method, params = {}) =>
          Effect.sync(() => {
            requests.push({ method, params });
            return { ok: true, result: carried({ template: "## Why\n", custom: true, at: 1 }) };
          }),
        on: () => () => undefined,
      };
      const operator = operatorOver(client);

      const kept = yield* operator.planTemplateWrite({ template: "## Why\n" });
      yield* operator.planTemplateWrite({ template: null });

      assert.deepEqual(kept, { template: "## Why\n", custom: true });
      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.PLAN_TEMPLATE_WRITE, { template: "## Why\n" }],
          [GATEWAY_METHOD.PLAN_TEMPLATE_WRITE, { template: null }],
        ],
      );
    }),
);

it.effect(
  "the plan template's history travels to the host as the methods' page and revision, and an answer the view cannot read is unanswered",
  () =>
    Effect.gen(function* () {
      const requests: RecordedCall[] = [];
      const client: GatewayClient = {
        call: (method, params = {}) =>
          Effect.sync(() => {
            requests.push({ method, params });
            const result =
              method === GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS
                ? { revisions: [] }
                : method === GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE
                  ? { template: "## Why\n", custom: true }
                  : { revision: { seq: 0 } };
            return { ok: true, result: carried(result) };
          }),
        on: () => () => undefined,
      };
      const operator = operatorOver(client);

      const newest = yield* operator.planTemplateRevisions({});
      yield* operator.planTemplateRevisions({ before: 3 });
      const unreadable = yield* operator.planTemplateRevision({ seq: 2 });
      const restored = yield* operator.planTemplateRestore({ seq: 2 });

      assert.deepEqual(newest, { revisions: [] });
      assert.deepEqual(unreadable, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(restored, { template: "## Why\n", custom: true });
      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS, {}],
          [GATEWAY_METHOD.PLAN_TEMPLATE_REVISIONS, { before: 3 }],
          [GATEWAY_METHOD.PLAN_TEMPLATE_REVISION, { seq: 2 }],
          [GATEWAY_METHOD.PLAN_TEMPLATE_RESTORE, { seq: 2 }],
        ],
      );
    }),
);

it.effect(
  "what waits across the account is asked of the host past its cursor and read as the view declares it, and an answer it cannot read is unanswered",
  () =>
    Effect.gen(function* () {
      const waiting = {
        items: [
          {
            id: "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a",
            planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
            agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
            agentTitle: null,
            agentModel: "anthropic/claude-opus-5.5",
            title: "Push to the release branch?",
            revision: 2,
            postedAt: 1_800_000_000_000,
            updatedAt: 1_800_000_060_000,
          },
        ],
        plans: [
          {
            planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
            items: 3,
            updatedAt: 1_800_000_060_000,
          },
        ],
        cursor: "9",
        readAt: 1_800_000_120_000,
      };
      const answers = [carried(waiting), carried({ items: "none" })];
      const requests: RecordedCall[] = [];
      const operator = operatorOver({
        call: (method, params = {}) =>
          Effect.sync(() => {
            requests.push({ method, params });
            return { ok: true, result: answers.shift() ?? carried({}) };
          }),
        on: () => () => undefined,
      });

      assert.deepEqual(yield* operator.codingAgentAccountInbox({ after: "8" }), waiting);
      assert.deepEqual(yield* operator.codingAgentAccountInbox({ after: "9" }), {
        failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(
        requests.map((request) => [request.method, request.params]),
        [
          [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX, { after: "8" }],
          [GATEWAY_METHOD.CODING_AGENTS_ACCOUNT_INBOX, { after: "9" }],
        ],
      );
    }),
);
