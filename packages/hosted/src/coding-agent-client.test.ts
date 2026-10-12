import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  fakeCloudApi,
  fakeHttpClientLayer,
  HTTP_STATUS,
  jsonResponse,
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
  INBOX_KIND,
  INBOX_REPLY,
  INBOX_STATUS,
} from "./inbox-wire.js";
import { MODEL_PROVIDER } from "./models-wire.js";
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
  kind: INBOX_KIND.APPROVAL,
  title: "Push to the release branch?",
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
