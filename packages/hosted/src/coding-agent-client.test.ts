import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { HostedCodingAgentClient } from "./coding-agent-client.js";
import { CODING_AGENT_CALL_FAILURE } from "./coding-agent-view.js";
import { CODING_AGENT_CURSOR_START, CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import { MODEL_PROVIDER } from "./models-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT = {
  id: AGENT_ID,
  planId: PLAN_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  createdAt: 1_800_000_000_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const CHOICE = { model: "openai/gpt-6.1-sol", effort: "xhigh" };

function client(): HostedCodingAgentClient {
  return new HostedCodingAgentClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

it.effect("reads the models the service offers under the account's bearer", () =>
  Effect.gen(function* () {
    const models = [
      {
        id: "anthropic/claude-opus-5.5",
        name: "Claude Opus 5.5",
        provider: MODEL_PROVIDER.ANTHROPIC,
        efforts: ["low", "high", "max"],
      },
    ];
    const api = fakeCloudApi({ "GET /api/models": { answer: () => ({ models }) } });

    const read = yield* Effect.provide(client().models(), api.layer);

    assert.deepEqual(read, { models });
    assert.deepEqual(api.credentials(), ["token-1"]);
  }),
);

it.effect(
  "reads the default off the preferences snapshot and leaves the settings part to the settings client",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "GET /api/account/preferences": {
          answer: () => ({ preferences: { voice: "marin" }, codingAgent: CHOICE, updatedAt: 1 }),
        },
      });

      const read = yield* Effect.provide(client().readDefault(), api.layer);

      assert.deepEqual(read, { choice: CHOICE });
    }),
);

it.effect(
  "writes the default as the coding-agent part alone, and reads a refused choice as invalid",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "PUT /api/account/preferences": {
          answer: (request) => ({
            preferences: {},
            codingAgent: JSON.parse(request.body ?? "{}").codingAgent,
          }),
        },
      });
      const refusing = fakeCloudApi({
        "PUT /api/account/preferences": {
          answer: () => ({ error: HOSTED_API_ERROR.INVALID_REQUEST }),
          status: HTTP_STATUS.BAD_REQUEST,
        },
      });

      const written = yield* Effect.provide(client().writeDefault(CHOICE), api.layer);
      const refused = yield* Effect.provide(client().writeDefault(CHOICE), refusing.layer);

      assert.deepEqual(written, { choice: CHOICE });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { codingAgent: CHOICE });
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE });
    }),
);

it.effect("lists a plan's agents, and a plan the service does not find reads as not found", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/agents`]: { answer: () => ({ agents: [AGENT] }) },
    });
    const gone = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/agents`]: {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const listed = yield* Effect.provide(client().list(PLAN_ID), api.layer);
    const missing = yield* Effect.provide(client().list(PLAN_ID), gone.layer);

    assert.deepEqual(listed, { agents: [AGENT] });
    assert.deepEqual(missing, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
  }),
);

it.effect(
  "starts an agent with the request as sent, and reads each refusal as its own failure",
  () =>
    Effect.gen(function* () {
      const request = { idempotencyKey: "press-1", ...CHOICE };
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/agents`]: {
          answer: () => ({ agent: AGENT }),
          status: 201,
        },
      });
      const refusals = [
        [HOSTED_API_ERROR.NO_REPOSITORY, CODING_AGENT_CALL_FAILURE.NO_REPOSITORY],
        [
          HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
          CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
        ],
        [
          HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED,
          CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
        ],
        [HOSTED_API_ERROR.INVALID_REQUEST, CODING_AGENT_CALL_FAILURE.INVALID_CHOICE],
        [HOSTED_API_ERROR.UNAVAILABLE, CODING_AGENT_CALL_FAILURE.UNANSWERED],
      ] as const;

      const started = yield* Effect.provide(client().start(PLAN_ID, request), api.layer);
      assert.deepEqual(started, { agent: AGENT });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), request);

      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          [`POST /api/plans/${PLAN_ID}/agents`]: {
            answer: () => ({ error }),
            status: HTTP_STATUS.CONFLICT,
          },
        });
        const refused = yield* Effect.provide(client().start(PLAN_ID, request), refusing.layer);
        assert.deepEqual(refused, { failure }, error);
      }
    }),
);

it.effect("a Start the service would refuse by shape travels nowhere", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`POST /api/plans/${PLAN_ID}/agents`]: { answer: () => ({ agent: AGENT }) },
    });

    const refused = yield* Effect.provide(
      client().start(PLAN_ID, { idempotencyKey: "   " }),
      api.layer,
    );

    assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect("reads the transcript past the cursor at the agent's messages address", () =>
  Effect.gen(function* () {
    const message = {
      id: "m-1",
      role: "assistant",
      parts: [{ type: "text", text: "Reading the repository." }],
    };
    const api = fakeCloudApi({
      [`GET /api/agents/${AGENT_ID}/messages`]: {
        answer: () => ({ messages: [message], cursor: "3:2", status: CODING_AGENT_STATUS.RUNNING }),
      },
    });

    const page = yield* Effect.provide(
      client().messages(AGENT_ID, CODING_AGENT_CURSOR_START),
      api.layer,
    );

    assert.deepEqual(page, {
      messages: [message],
      cursor: "3:2",
      status: CODING_AGENT_STATUS.RUNNING,
    });
    assert.equal(
      api.requests()[0]?.url,
      `https://tryluke.dev/api/agents/${AGENT_ID}/messages?after=${encodeURIComponent(CODING_AGENT_CURSOR_START)}`,
    );
  }),
);

it.effect(
  "stops an agent and answers it as it then stands; a service that did not answer reads as unanswered",
  () =>
    Effect.gen(function* () {
      const stopped = { ...AGENT, status: CODING_AGENT_STATUS.CANCELLED };
      const api = fakeCloudApi({
        [`POST /api/agents/${AGENT_ID}/stop`]: { answer: () => ({ agent: stopped }) },
      });

      const answer = yield* Effect.provide(client().stop(AGENT_ID), api.layer);
      assert.deepEqual(answer, { agent: stopped });

      api.fail();
      const failed = yield* Effect.provide(client().stop(AGENT_ID), api.layer);
      assert.deepEqual(failed, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    }),
);
