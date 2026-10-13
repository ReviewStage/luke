import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fakeCloudApi,
  fakeHttpClientLayer,
  HTTP_STATUS,
  jsonResponse,
  recordedRoutes,
} from "@sidecar/wire/testing";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { HostedCodingAgentClient } from "./coding-agent-client.js";
import { CODING_AGENT_CALL_FAILURE } from "./coding-agent-view.js";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
} from "./coding-agent-wire.js";
import {
  INBOX_BOUNDS,
  INBOX_CURSOR_START,
  INBOX_REPLY,
  INBOX_RESPONSE,
  INBOX_STATUS,
  INBOX_WIRE_VERSION,
} from "./inbox-wire.js";
import { INTEGRATION_PROVIDER } from "./integration-wire.js";
import { MODEL_PROVIDER } from "./models-wire.js";
import { DEFAULT_PLAN_TEMPLATE, PLAN_TEMPLATE_BOUNDS } from "./plan-document-template.js";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
} from "./provider-key-wire.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const AGENT = {
  id: AGENT_ID,
  planId: PLAN_ID,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_000_000,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const ITEM_ID = "5e2d7c3a-1b4f-4e6a-8c9d-0f1e2d3c4b5a";

/** One open item of the plan's inbox, as the service answers it. */
const ITEM = {
  id: ITEM_ID,
  agentId: AGENT_ID,
  key: "push-access",
  revision: 2,
  version: INBOX_WIRE_VERSION,
  title: "Push to the release branch?",
  blocks: [],
  response: { type: INBOX_RESPONSE.APPROVAL },
  needsReply: true,
  status: INBOX_STATUS.OPEN,
  postedAt: 1_800_000_000_000,
  updatedAt: 1_800_000_060_000,
};

/** An answer approving that item at the revision the window drew. */
const APPROVAL = { revision: 2, reply: INBOX_REPLY.APPROVED, clientKey: "answer-1" };

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

it.effect("a refusal carrying more than its reason still reads as the refusal it names", () =>
  Effect.gen(function* () {
    const gone = fakeCloudApi({
      [`GET /api/plans/${PLAN_ID}/agents`]: {
        answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND, requestId: "req_1" }),
        status: HTTP_STATUS.NOT_FOUND,
      },
    });

    const missing = yield* Effect.provide(client().list(PLAN_ID), gone.layer);

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
        [HOSTED_API_ERROR.PLAN_ARCHIVED, CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED],
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

it.effect("a Start naming a task carries it to the service as sent", () =>
  Effect.gen(function* () {
    const request = { idempotencyKey: "press-1", task: "Rename the invite email's subject." };
    const api = fakeCloudApi({
      [`POST /api/plans/${PLAN_ID}/agents`]: { answer: () => ({ agent: AGENT }), status: 201 },
    });

    const started = yield* Effect.provide(client().start(PLAN_ID, request), api.layer);

    assert.deepEqual(started, { agent: AGENT });
    assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), request);
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

it.effect(
  "a message and a Start's task carry words, files, or both, and one carrying neither travels nowhere",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/agents`]: { answer: () => ({ agent: AGENT }), status: 201 },
        [`POST /api/agents/${AGENT_ID}/messages`]: { answer: () => ({ agent: AGENT }) },
      });
      const shot = [{ name: "shot.png", mediaType: "image/png", data: "iVBORw0KGgo=" }] as const;
      const carried = [
        { words: "Match this design." },
        { words: "", attachments: shot },
        { words: "Match this design.", attachments: shot },
      ];
      for (const { words, attachments } of carried) {
        const files = attachments === undefined ? undefined : { attachments };
        const message = { text: words, clientKey: "send-1", ...files };
        const start = { idempotencyKey: "press-1", task: words, ...files };
        assert.deepEqual(yield* Effect.provide(client().message(AGENT_ID, message), api.layer), {
          agent: AGENT,
        });
        assert.deepEqual(yield* Effect.provide(client().start(PLAN_ID, start), api.layer), {
          agent: AGENT,
        });
      }
      assert.equal(api.requests().length, 6);

      const neither = [
        client().message(AGENT_ID, { text: "  ", clientKey: "send-2" }),
        client().message(AGENT_ID, { text: "", clientKey: "send-3", attachments: [] }),
        client().start(PLAN_ID, { idempotencyKey: "press-2", task: "  " }),
        client().start(PLAN_ID, { idempotencyKey: "press-3", task: "", attachments: [] }),
      ];
      for (const refused of neither) {
        assert.deepEqual(yield* Effect.provide(refused, api.layer), {
          failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
        });
      }
      assert.equal(api.requests().length, 6);
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
        answer: () => ({
          messages: [message],
          cursor: "3:2",
          status: CODING_AGENT_STATUS.RUNNING,
          title: null,
        }),
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
      title: null,
    });
    assert.equal(
      api.requests()[0]?.url,
      `https://tryluke.dev/api/agents/${AGENT_ID}/messages?after=${encodeURIComponent(CODING_AGENT_CURSOR_START)}`,
    );
  }),
);

it.effect("reads a worker's transcript under the agent and the call that started it", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`GET /api/agents/${AGENT_ID}/subagents/call-7/messages`]: {
        answer: () => ({
          messages: [],
          cursor: "1:0",
          status: CODING_AGENT_STATUS.COMPLETED,
          title: null,
        }),
      },
    });

    const page = yield* Effect.provide(
      client().messages(AGENT_ID, CODING_AGENT_CURSOR_START, "call-7"),
      api.layer,
    );

    assert.deepEqual(page, {
      messages: [],
      cursor: "1:0",
      status: CODING_AGENT_STATUS.COMPLETED,
      title: null,
    });
    assert.equal(
      api.requests()[0]?.url,
      `https://tryluke.dev/api/agents/${AGENT_ID}/subagents/call-7/messages?after=${encodeURIComponent(CODING_AGENT_CURSOR_START)}`,
    );
  }),
);

it.effect(
  "messages an agent with its words under the send's key, and answers it running; each refusal the route names reads as its own failure",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`POST /api/agents/${AGENT_ID}/messages`]: { answer: () => ({ agent: AGENT }) },
      });

      const answer = yield* Effect.provide(
        client().message(AGENT_ID, {
          text: "  Also expire them after a week.  ",
          clientKey: "send-1",
        }),
        api.layer,
      );
      assert.deepEqual(answer, { agent: AGENT });
      // The words travel trimmed, as the service keeps them, with the key a retry carries again.
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        text: "Also expire them after a week.",
        clientKey: "send-1",
      });

      const refusals = [
        [HOSTED_API_ERROR.AGENT_NOT_READY, CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY],
        [HOSTED_API_ERROR.AGENT_RETIRED, CODING_AGENT_CALL_FAILURE.AGENT_RETIRED],
        [HOSTED_API_ERROR.MESSAGE_TOO_LONG, CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG],
        [HOSTED_API_ERROR.NOT_FOUND, CODING_AGENT_CALL_FAILURE.NOT_FOUND],
        [HOSTED_API_ERROR.PLAN_ARCHIVED, CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED],
      ] as const;
      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          [`POST /api/agents/${AGENT_ID}/messages`]: {
            status: HTTP_STATUS.CONFLICT,
            answer: () => ({ error }),
          },
        });
        const refused = yield* Effect.provide(
          client().message(AGENT_ID, { text: "Go on.", clientKey: "send-2" }),
          refusing.layer,
        );
        assert.deepEqual(refused, { failure });
      }

      // Words past the bound, or none, never travel.
      const tooLong = yield* Effect.provide(
        client().message(AGENT_ID, {
          text: "x".repeat(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS + 1),
          clientKey: "send-3",
        }),
        api.layer,
      );
      assert.deepEqual(tooLong, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      const blank = yield* Effect.provide(
        client().message(AGENT_ID, { text: "   ", clientKey: "send-4" }),
        api.layer,
      );
      assert.deepEqual(blank, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 1);
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

it.effect(
  "lists the archived agents among the rest only where asked, archives an agent or brings it back at its own address, as which way alone, and reads one still starting as not ready",
  () =>
    Effect.gen(function* () {
      const archived = { ...AGENT, archivedAt: 1_800_000_300_000 };
      const api = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/agents`]: { answer: () => ({ agents: [archived] }) },
        [`PATCH /api/agents/${AGENT_ID}`]: { answer: () => ({ agent: archived }) },
      });

      const listed = yield* Effect.provide(client().list(PLAN_ID, true), api.layer);
      yield* Effect.provide(client().list(PLAN_ID), api.layer);
      const answer = yield* Effect.provide(
        client().archive(AGENT_ID, { archived: true }),
        api.layer,
      );

      assert.deepEqual(listed, { agents: [archived] });
      assert.deepEqual(answer, { agent: archived });
      assert.deepEqual(recordedRoutes(api.requests()), [
        `GET /api/plans/${PLAN_ID}/agents?archived=include`,
        `GET /api/plans/${PLAN_ID}/agents`,
        `PATCH /api/agents/${AGENT_ID}`,
      ]);
      assert.deepEqual(JSON.parse(api.requests()[2]?.body ?? "{}"), { archived: true });

      const starting = fakeCloudApi({
        [`PATCH /api/agents/${AGENT_ID}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.AGENT_NOT_READY }),
          status: HTTP_STATUS.CONFLICT,
        },
      });
      const refused = yield* Effect.provide(
        client().archive(AGENT_ID, { archived: true }),
        starting.layer,
      );
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
    }),
);

it.effect(
  "changes an agent's model and effort at the agent's own address, as the choice alone",
  () =>
    Effect.gen(function* () {
      const chosen = { ...AGENT, ...CHOICE };
      const api = fakeCloudApi({
        [`PATCH /api/agents/${AGENT_ID}`]: { answer: () => ({ agent: chosen }) },
      });

      const answer = yield* Effect.provide(client().choose(AGENT_ID, CHOICE), api.layer);

      assert.deepEqual(answer, { agent: chosen });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), CHOICE);
    }),
);

it.effect(
  "renames an agent at its own address, as the title alone, and refuses a title past the bound without asking",
  () =>
    Effect.gen(function* () {
      const renamed = { ...AGENT, title: "Sign-out button" };
      const api = fakeCloudApi({
        [`PATCH /api/agents/${AGENT_ID}`]: { answer: () => ({ agent: renamed }) },
      });

      const answer = yield* Effect.provide(
        client().rename(AGENT_ID, { title: " Sign-out button " }),
        api.layer,
      );
      assert.deepEqual(answer, { agent: renamed });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { title: "Sign-out button" });

      const refused = yield* Effect.provide(
        client().rename(AGENT_ID, { title: "x".repeat(CODING_AGENT_BOUNDS.MAX_TITLE_CHARS + 1) }),
        api.layer,
      );
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 1);
    }),
);

it.effect(
  "switches an agent's MCP servers at its own address, as the whole list of those off, and refuses a list past the bound without asking",
  () =>
    Effect.gen(function* () {
      const switched = { ...AGENT, disabledServers: [INTEGRATION_PROVIDER.LINEAR] };
      const api = fakeCloudApi({
        [`PATCH /api/agents/${AGENT_ID}`]: { answer: () => ({ agent: switched }) },
      });

      const answer = yield* Effect.provide(
        client().switchServers(AGENT_ID, { disabledServers: [INTEGRATION_PROVIDER.LINEAR] }),
        api.layer,
      );
      assert.deepEqual(answer, { agent: switched });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        disabledServers: [INTEGRATION_PROVIDER.LINEAR],
      });

      const refused = yield* Effect.provide(
        client().switchServers(AGENT_ID, {
          disabledServers: Array.from(
            { length: CODING_AGENT_BOUNDS.MAX_SERVERS + 1 },
            () => INTEGRATION_PROVIDER.LINEAR,
          ),
        }),
        api.layer,
      );
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 1);
    }),
);

it.effect(
  "reads what an agent published at its pull-request address, and an agent the service does not find reads as not found",
  () =>
    Effect.gen(function* () {
      const published = {
        repository: "acme/relay",
        branch: "luke/teammate-invitations",
        pullRequest: {
          number: 123,
          title: "Teammate invitations",
          url: "https://github.com/acme/relay/pull/123",
          state: "open",
          checks: "passing",
          additions: 210,
          deletions: 14,
          changedFiles: 6,
        },
      };
      const api = fakeCloudApi({
        [`GET /api/agents/${AGENT_ID}/pull-request`]: { answer: () => published },
      });
      const gone = fakeCloudApi({
        [`GET /api/agents/${AGENT_ID}/pull-request`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const read = yield* Effect.provide(client().pullRequest(AGENT_ID), api.layer);
      const missing = yield* Effect.provide(client().pullRequest(AGENT_ID), gone.layer);

      assert.deepEqual(read, published);
      assert.deepEqual(missing, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    }),
);

it.effect(
  "reads, saves, and removes the account's own provider keys, a save carrying the key once in its body and every answer its hint alone",
  () =>
    Effect.gen(function* () {
      const key = "sk-ant-api03-synthetic-0000000000000000wxyz";
      const kept = {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        hint: "sk-ant-…wxyz",
        addedAt: 1,
        status: PROVIDER_KEY_STATUS.VERIFIED,
        statusAt: 1,
      };
      const api = fakeCloudApi({
        "GET /api/account/provider-keys": { answer: () => ({ keys: [kept] }) },
        "PUT /api/account/provider-keys": {
          answer: () => ({ keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID }),
        },
        "DELETE /api/account/provider-keys": { answer: () => ({ keys: [] }) },
      });

      const read = yield* Effect.provide(client().readProviderKeys(), api.layer);
      const saved = yield* Effect.provide(
        client().saveProviderKey({ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, key }),
        api.layer,
      );
      const removed = yield* Effect.provide(
        client().removeProviderKey({ provider: PROVIDER_KEY_PROVIDER.ANTHROPIC }),
        api.layer,
      );

      assert.deepEqual(read, { keys: [kept] });
      assert.deepEqual(saved, { keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID });
      assert.deepEqual(removed, { keys: [] });
      const [, save, removal] = api.requests();
      assert.deepEqual(JSON.parse(save?.body ?? "{}"), {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        key,
      });
      assert.equal(
        removal?.url,
        `https://tryluke.dev/api/account/provider-keys?provider=${PROVIDER_KEY_PROVIDER.ANTHROPIC}`,
      );
    }),
);

it.effect("a provider key the service would refuse by shape travels nowhere", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "PUT /api/account/provider-keys": { answer: () => ({ keys: [] }) },
    });

    const refused = yield* Effect.provide(
      client().saveProviderKey({ provider: PROVIDER_KEY_PROVIDER.OPENAI, key: "sk-short" }),
      api.layer,
    );

    assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect(
  "reads the account's plan template, ignoring a key a newer service added, and a read the service refuses reads as unanswered",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "GET /api/account/plan-template": {
          answer: () => ({ template: "## Why\n", custom: true, updatedAt: 1 }),
        },
      });
      const failing = fakeCloudApi({
        "GET /api/account/plan-template": {
          answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });

      const read = yield* Effect.provide(client().readPlanTemplate(), api.layer);
      const failed = yield* Effect.provide(client().readPlanTemplate(), failing.layer);

      assert.deepEqual(read, { template: "## Why\n", custom: true });
      assert.deepEqual(api.credentials(), ["token-1"]);
      assert.deepEqual(failed, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "writes the plan template verbatim, and null for the default, answering the template as kept",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        "PUT /api/account/plan-template": {
          answer: (request) => {
            const template: string | null = JSON.parse(request.body ?? "{}").template;
            return { template: template ?? DEFAULT_PLAN_TEMPLATE, custom: template !== null };
          },
        },
      });

      const kept = yield* Effect.provide(
        client().writePlanTemplate({ template: "  ## Why\n\n" }),
        api.layer,
      );
      const reset = yield* Effect.provide(
        client().writePlanTemplate({ template: null }),
        api.layer,
      );

      assert.deepEqual(kept, { template: "  ## Why\n\n", custom: true });
      assert.deepEqual(reset, { template: DEFAULT_PLAN_TEMPLATE, custom: false });
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "{}")),
        [{ template: "  ## Why\n\n" }, { template: null }],
      );
    }),
);

it.effect("a plan template past the bound travels nowhere", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "PUT /api/account/plan-template": { answer: () => ({ template: "", custom: true }) },
    });

    const refused = yield* Effect.provide(
      client().writePlanTemplate({ template: "x".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS + 1) }),
      api.layer,
    );

    assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(api.requests(), []);
  }),
);

it.effect(
  "reads the plan template's history a page and a revision at a time and restores a revision at their addresses, ignoring a key a newer service added, and a revision the service does not find reads as unanswered",
  () =>
    Effect.gen(function* () {
      const line = {
        seq: 2,
        lastEdit: { actor: "developer", at: 1_000, duringCall: false },
        startedAt: 1_000,
        changes: 1,
        default: true,
      };
      const api = fakeCloudApi({
        "GET /api/account/plan-template/revisions": { answer: () => ({ revisions: [line] }) },
        "GET /api/account/plan-template/revisions/2": {
          answer: () => ({
            revision: { seq: 2, document: { body: "## Why\n", assumptions: [] }, previous: null },
          }),
        },
        "POST /api/account/plan-template/revisions/2/restore": {
          answer: () => ({ template: "## Why\n", custom: true, updatedAt: 1 }),
        },
        "GET /api/account/plan-template/revisions/9": {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const newest = yield* Effect.provide(client().readPlanTemplateRevisions({}), api.layer);
      const older = yield* Effect.provide(
        client().readPlanTemplateRevisions({ before: 3 }),
        api.layer,
      );
      const revision = yield* Effect.provide(
        client().readPlanTemplateRevision({ seq: 2 }),
        api.layer,
      );
      const restored = yield* Effect.provide(client().restorePlanTemplate({ seq: 2 }), api.layer);
      const missing = yield* Effect.provide(
        client().readPlanTemplateRevision({ seq: 9 }),
        api.layer,
      );

      assert.deepEqual(newest, { revisions: [line] });
      assert.deepEqual(older, { revisions: [line] });
      assert.deepEqual(revision, {
        revision: { seq: 2, document: { body: "## Why\n", assumptions: [] }, previous: null },
      });
      assert.deepEqual(restored, { template: "## Why\n", custom: true });
      assert.deepEqual(missing, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(recordedRoutes(api.requests()), [
        "GET /api/account/plan-template/revisions",
        "GET /api/account/plan-template/revisions?before=3",
        "GET /api/account/plan-template/revisions/2",
        "POST /api/account/plan-template/revisions/2/restore",
        "GET /api/account/plan-template/revisions/9",
      ]);
    }),
);

it.effect(
  "reads a plan's inbox past the cursor at the plan's inbox address, and a plan the service does not find reads as not found",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/inbox`]: { answer: () => ({ items: [ITEM], cursor: "7" }) },
      });
      const gone = fakeCloudApi({
        [`GET /api/plans/${PLAN_ID}/inbox`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const read = yield* Effect.provide(client().inbox(PLAN_ID, INBOX_CURSOR_START), api.layer);
      const missing = yield* Effect.provide(client().inbox(PLAN_ID, "7"), gone.layer);

      assert.deepEqual(read, { items: [ITEM], cursor: "7" });
      assert.equal(
        api.requests()[0]?.url,
        `https://tryluke.dev/api/plans/${PLAN_ID}/inbox?after=${INBOX_CURSOR_START}`,
      );
      assert.deepEqual(missing, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    }),
);

it.effect(
  "an inbox read the service holds past an ordinary call's deadline is still read when it answers",
  () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<void>();
      let answer: (response: Response) => void = () => undefined;
      const held = fakeHttpClientLayer(() => {
        Deferred.doneUnsafe(asked, Effect.void);
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      });

      const reading = yield* Effect.forkChild(
        Effect.provide(client().inbox(PLAN_ID, INBOX_CURSOR_START), held),
      );
      yield* Deferred.await(asked);
      // The service holds the read while nothing changed: past the account call's usual deadline.
      yield* TestClock.adjust(Duration.seconds(20));
      answer(jsonResponse({ items: [ITEM], cursor: "8" }));
      const read = yield* Fiber.join(reading);

      assert.deepEqual(read, { items: [ITEM], cursor: "8" });
    }),
);

/** One item that waits across the account, as the service answers it. */
const WAITING = {
  id: ITEM_ID,
  planId: PLAN_ID,
  agentId: AGENT_ID,
  agentTitle: "Fix invitations",
  agentModel: "anthropic/claude-opus-5.5",
  title: "Push to the release branch?",
  revision: 2,
  postedAt: 1_800_000_000_000,
  updatedAt: 1_800_000_060_000,
};

it.effect(
  "reads what waits across the account past the cursor at the account's inbox address, still read when the service holds it past an ordinary call's deadline",
  () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<string>();
      let answer: (response: Response) => void = () => undefined;
      const held = fakeHttpClientLayer((url) => {
        Deferred.doneUnsafe(asked, Effect.succeed(url));
        return new Promise<Response>((resolve) => {
          answer = resolve;
        });
      });

      const reading = yield* Effect.forkChild(Effect.provide(client().accountInbox("7"), held));
      assert.equal(yield* Deferred.await(asked), "https://tryluke.dev/api/inbox?after=7");
      yield* TestClock.adjust(Duration.seconds(20));
      const plans = [{ planId: PLAN_ID, items: 4, updatedAt: 1_800_000_060_000 }];
      answer(jsonResponse({ items: [WAITING], plans, cursor: "8", readAt: 1_800_000_120_000 }));

      assert.deepEqual(yield* Fiber.join(reading), {
        items: [WAITING],
        plans,
        cursor: "8",
        readAt: 1_800_000_120_000,
      });
    }),
);

it.effect(
  "answers an inbox item at its own address with the answer as sent, and reads each refusal a message names as its own failure",
  () =>
    Effect.gen(function* () {
      const answered = {
        item: {
          ...ITEM,
          revision: 3,
          status: INBOX_STATUS.ANSWERED,
          answer: { reply: "approved" },
        },
        taken: true,
      };
      const api = fakeCloudApi({ [`POST /api/inbox/${ITEM_ID}`]: { answer: () => answered } });

      const answer = yield* Effect.provide(client().answerInbox(ITEM_ID, APPROVAL), api.layer);
      assert.deepEqual(answer, answered);
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), APPROVAL);

      const refusals = [
        [HOSTED_API_ERROR.NOT_FOUND, CODING_AGENT_CALL_FAILURE.NOT_FOUND],
        [HOSTED_API_ERROR.MESSAGE_TOO_LONG, CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG],
        [HOSTED_API_ERROR.AGENT_NOT_READY, CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY],
        [HOSTED_API_ERROR.AGENT_RETIRED, CODING_AGENT_CALL_FAILURE.AGENT_RETIRED],
        [
          HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
          CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
        ],
        [
          HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED,
          CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED,
        ],
        [HOSTED_API_ERROR.PLAN_ARCHIVED, CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED],
        [HOSTED_API_ERROR.INVALID_REQUEST, CODING_AGENT_CALL_FAILURE.UNANSWERED],
      ] as const;
      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          [`POST /api/inbox/${ITEM_ID}`]: {
            status: HTTP_STATUS.CONFLICT,
            answer: () => ({ error }),
          },
        });
        const refused = yield* Effect.provide(
          client().answerInbox(ITEM_ID, APPROVAL),
          refusing.layer,
        );
        assert.deepEqual(refused, { failure }, error);
      }
    }),
);

it.effect(
  "reads an item's image at its own address as its bytes in base64 under the type the service served, reads a refusal as its own failure, and reads a type no image block may be as unanswered",
  () =>
    Effect.gen(function* () {
      const ATTACHMENT_ID = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
      const asked: string[] = [];
      const serving = (contentType: string, body: BodyInit, status: number = HTTP_STATUS.OK) =>
        fakeHttpClientLayer((url, init) => {
          asked.push(
            `${init.method ?? ""} ${url} ${new Headers(init.headers).get("authorization") ?? ""}`,
          );
          return new Response(body, { status, headers: { "content-type": contentType } });
        });

      const read = yield* Effect.provide(
        client().inboxAttachment(ITEM_ID, ATTACHMENT_ID),
        serving("image/png", bytes),
      );
      const missing = yield* Effect.provide(
        client().inboxAttachment(ITEM_ID, ATTACHMENT_ID),
        serving(
          "application/json",
          JSON.stringify({ error: HOSTED_API_ERROR.NOT_FOUND }),
          HTTP_STATUS.NOT_FOUND,
        ),
      );
      const page = yield* Effect.provide(
        client().inboxAttachment(ITEM_ID, ATTACHMENT_ID),
        serving("text/html", "<p>Sign in</p>"),
      );

      assert.deepEqual(read, { contentType: "image/png", base64: "iVBORw0KGgoAAQID" });
      assert.deepEqual(missing, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(page, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.equal(
        asked[0],
        `GET https://tryluke.dev/api/inbox/${ITEM_ID}/attachments/${ATTACHMENT_ID} Bearer token-1`,
      );
    }),
);

it.effect("an inbox answer the service would refuse by shape travels nowhere", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      [`POST /api/inbox/${ITEM_ID}`]: { answer: () => ({ item: ITEM, taken: true }) },
    });

    const refused = [
      { ...APPROVAL, clientKey: "" },
      { ...APPROVAL, revision: -1 },
      {
        ...APPROVAL,
        reply: INBOX_REPLY.ANSWERED,
        note: "x".repeat(INBOX_BOUNDS.MAX_NOTE_CHARS + 1),
      },
    ];
    for (const request of refused) {
      const answer = yield* Effect.provide(client().answerInbox(ITEM_ID, request), api.layer);
      assert.deepEqual(answer, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    }
    assert.deepEqual(api.requests(), []);
  }),
);
