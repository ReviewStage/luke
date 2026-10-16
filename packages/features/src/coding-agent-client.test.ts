import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, type JsonValue, recordingHttpClient } from "@luke/wire/testing";
import { Effect } from "effect";
import { HostedCodingAgentClient } from "./coding-agent-client.js";
import { CODING_AGENT_CALL_FAILURE } from "./coding-agent-view.js";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
} from "./provider-key-wire.js";
import { REPOSITORY_UNREACHED } from "./repository-reach-wire.js";
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

const CHOICE = { model: "openai/gpt-6.1-sol", effort: "xhigh" };

function client(): HostedCodingAgentClient {
  return new HostedCodingAgentClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
  });
}

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
        [HOSTED_API_ERROR.INVALID_REQUEST, CODING_AGENT_CALL_FAILURE.INVALID_CHOICE],
        [HOSTED_API_ERROR.PLAN_ARCHIVED, CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED],
        [HOSTED_API_ERROR.GITHUB_UNANSWERED, CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED],
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

it.effect(
  "a Start's prompt travels under the key a released service reads, task, trimmed as it is bounded",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`POST /api/plans/${PLAN_ID}/agents`]: { answer: () => ({ agent: AGENT }), status: 201 },
      });

      yield* Effect.provide(
        client().start(PLAN_ID, { idempotencyKey: "press-1", prompt: "  Fix the flaky test.  " }),
        api.layer,
      );

      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), {
        idempotencyKey: "press-1",
        task: "Fix the flaky test.",
      });
    }),
);

it.effect(
  "a Start refused for a repository out of reach carries why, and a reason this build cannot read is the bare refusal",
  () =>
    Effect.gen(function* () {
      const request = { idempotencyKey: "press-1" };
      const refusingWith = (unreached: JsonValue) =>
        fakeCloudApi({
          [`POST /api/plans/${PLAN_ID}/agents`]: {
            answer: () => ({ error: HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, unreached }),
            status: HTTP_STATUS.FORBIDDEN,
          },
        });
      const unreached = {
        reason: REPOSITORY_UNREACHED.OTHER_WORKSPACE,
        repository: "Acme/Relay",
        workspace: { id: "team-1", name: "Acme Team" },
      };

      const named = yield* Effect.provide(
        client().start(PLAN_ID, request),
        refusingWith(unreached).layer,
      );
      const newer = yield* Effect.provide(
        client().start(PLAN_ID, request),
        refusingWith({ reason: "a-reason-from-later", repository: "Acme/Relay" }).layer,
      );
      const elsewhere = yield* Effect.provide(
        client().start(PLAN_ID, request),
        refusingWith({
          reason: REPOSITORY_UNREACHED.NOT_SELECTED,
          repository: "Acme/Relay",
          settingsUrl: "https://example.test/settings",
        }).layer,
      );

      assert.deepEqual(named, {
        failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
        unreached,
      });
      assert.deepEqual(newer, { failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
      // A settings page off GitHub is not one the desktop would open.
      assert.deepEqual(elsewhere, {
        failure: CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      });
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

it.effect(
  "reads a workspace's memories and forgets one, each naming its workspace and the memory in the query, answering the memories as they then stand",
  () =>
    Effect.gen(function* () {
      const memory = {
        id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
        text: "Deployments go out from the release branch.",
        keptBy: { userId: "user-1", name: "Dean" },
        forgettable: true,
        createdAt: 1,
        updatedAt: 2,
      };
      const workspaceId = "workspace-1";
      const api = fakeCloudApi({
        "GET /api/account/memories": { answer: () => ({ memories: [memory] }) },
        "DELETE /api/account/memories": { answer: () => ({ memories: [] }) },
      });
      const failing = fakeCloudApi({
        "GET /api/account/memories": {
          answer: () => ({ error: HOSTED_API_ERROR.UNAVAILABLE }),
          status: HTTP_STATUS.SERVER_ERROR,
        },
      });

      const read = yield* Effect.provide(client().readMemories({ workspaceId }), api.layer);
      const forgotten = yield* Effect.provide(
        client().forgetMemory({ workspaceId, id: memory.id }),
        api.layer,
      );
      const failed = yield* Effect.provide(client().readMemories({ workspaceId }), failing.layer);

      assert.deepEqual(read, { memories: [memory] });
      assert.deepEqual(forgotten, { memories: [] });
      assert.deepEqual(failed, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        api.requests().map((sent) => sent.url),
        [
          `https://tryluke.dev/api/account/memories?workspaceId=${workspaceId}`,
          `https://tryluke.dev/api/account/memories?workspaceId=${workspaceId}&id=${memory.id}`,
        ],
      );
    }),
);

it.effect(
  "reads one agent as its own page by its id, an agent with no plan among them, and one the account does not reach as not found",
  () =>
    Effect.gen(function* () {
      const page = {
        ...AGENT,
        planId: null,
        automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
        workspaceId: "workspace-1",
        repository: "acme/relay",
      };
      const api = fakeCloudApi({
        [`GET /api/agents/${AGENT_ID}`]: { answer: () => ({ agent: page }) },
      });
      const refusing = fakeCloudApi({
        [`GET /api/agents/${AGENT_ID}`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const read = yield* Effect.provide(client().agent(AGENT_ID), api.layer);
      const refused = yield* Effect.provide(client().agent(AGENT_ID), refusing.layer);

      assert.deepEqual(read, { agent: page });
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    }),
);

it.effect(
  "reads one agent's inbox past a cursor at the agent's own path, held as a plan's is",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`GET /api/agents/${AGENT_ID}/inbox`]: {
          answer: () => ({ items: [], cursor: "3" }),
        },
      });

      const read = yield* Effect.provide(client().agentInbox(AGENT_ID, "0"), api.layer);

      assert.deepEqual(read, { items: [], cursor: "3" });
    }),
);

it.effect(
  "lists a workspace's agents by its id and the repository named, and a workspace the account is not in as not found",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({ "GET /api/agents": { answer: () => ({ agents: [AGENT] }) } });
      const refusing = fakeCloudApi({
        "GET /api/agents": {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const listed = yield* Effect.provide(
        client().listWorkspace({ workspaceId: "workspace-1", repository: "acme/relay" }),
        api.layer,
      );
      const refused = yield* Effect.provide(
        client().listWorkspace({ workspaceId: "workspace-2" }),
        refusing.layer,
      );

      assert.deepEqual(listed, { agents: [AGENT] });
      const query = api.requests()[0]?.searchParams;
      assert.deepEqual(
        [query?.get("workspaceId"), query?.get("repository")],
        ["workspace-1", "acme/relay"],
      );
      assert.equal(refusing.requests()[0]?.searchParams.get("repository"), null);
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    }),
);

it.effect(
  "reads an agent's picture, or its worker's, as base64 under the type the service named, and anything else as unanswered",
  () =>
    Effect.gen(function* () {
      const pictureId = "3ea06f44-b05d-4182-ad94-6f7a8b9cadb4";
      const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
      const served = recordingHttpClient(
        () => new Response(bytes, { status: 200, headers: { "content-type": "image/png" } }),
      );
      const read = yield* Effect.provide(client().agentPicture(AGENT_ID, pictureId), served.layer);
      const worker = yield* Effect.provide(
        client().agentPicture(AGENT_ID, pictureId, "call-worker"),
        served.layer,
      );
      const other = recordingHttpClient(
        () => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }),
      );
      const unexpected = yield* Effect.provide(
        client().agentPicture(AGENT_ID, pictureId),
        other.layer,
      );

      assert.deepEqual(
        served.requests.map((request) => request.pathname),
        [
          `/api/agents/${AGENT_ID}/pictures/${pictureId}`,
          `/api/agents/${AGENT_ID}/subagents/call-worker/pictures/${pictureId}`,
        ],
      );
      assert.deepEqual(read, { contentType: "image/png", base64: "iVBORw==" });
      assert.deepEqual(worker, read);
      assert.deepEqual(unexpected, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    }),
);
