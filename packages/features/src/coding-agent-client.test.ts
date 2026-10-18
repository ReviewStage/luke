import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, type JsonValue, recordingHttpClient } from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { MEMBER_KIND } from "./chat-wire.js";
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

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const WORKSPACE_ID = "2a9c4e6f-1b3d-4f5a-8c7e-9d0b1a2c3e4f";

const AGENT = {
  id: AGENT_ID,
  planId: TASK_ID,
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
        [`POST /api/plans/${TASK_ID}/agents`]: {
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
        [HOSTED_API_ERROR.TASK_ARCHIVED, CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED],
        [HOSTED_API_ERROR.GITHUB_UNANSWERED, CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED],
        [HOSTED_API_ERROR.UNAVAILABLE, CODING_AGENT_CALL_FAILURE.UNANSWERED],
      ] as const;

      const started = yield* Effect.provide(client().start(TASK_ID, request), api.layer);
      assert.deepEqual(started, { agent: AGENT });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), request);

      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          [`POST /api/plans/${TASK_ID}/agents`]: {
            answer: () => ({ error }),
            status: HTTP_STATUS.CONFLICT,
          },
        });
        const refused = yield* Effect.provide(client().start(TASK_ID, request), refusing.layer);
        assert.deepEqual(refused, { failure }, error);
      }
    }),
);

it.effect(
  "a Start's prompt travels under the key a released service reads, task, trimmed as it is bounded",
  () =>
    Effect.gen(function* () {
      const api = fakeCloudApi({
        [`POST /api/plans/${TASK_ID}/agents`]: { answer: () => ({ agent: AGENT }), status: 201 },
      });

      yield* Effect.provide(
        client().start(TASK_ID, { idempotencyKey: "press-1", prompt: "  Fix the flaky test.  " }),
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
          [`POST /api/plans/${TASK_ID}/agents`]: {
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
        client().start(TASK_ID, request),
        refusingWith(unreached).layer,
      );
      const newer = yield* Effect.provide(
        client().start(TASK_ID, request),
        refusingWith({ reason: "a-reason-from-later", repository: "Acme/Relay" }).layer,
      );
      const elsewhere = yield* Effect.provide(
        client().start(TASK_ID, request),
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
  "writes a message on an inbox item's thread at the item's own path, its words trimmed, answers the item as it then stands, names a refusal as a message's, and sends nothing that carries neither words nor files",
  () =>
    Effect.gen(function* () {
      const itemId = "5d2b8f0e-1a3c-4e6f-9b7d-2c4e6a8b0d1f";
      const item = {
        id: itemId,
        agentId: AGENT_ID,
        key: "invite-copy",
        revision: 1,
        version: 4,
        title: "What should the invitation email say?",
        blocks: [],
        response: { type: "text" },
        needsReply: true,
        status: "answered",
        messages: [
          {
            id: "6e3c9a1f-2b4d-4f70-8c8e-3d5f7b9c1e2a",
            author: "member",
            member: { userId: "user-dana", name: "Dana" },
            text: "Drop the emoji.",
            createdAt: 2,
          },
        ],
        postedAt: 1,
        updatedAt: 2,
      };
      const path = `POST /api/inbox/${itemId}/messages`;
      const api = fakeCloudApi({ [path]: { answer: () => ({ item }) } });
      const refusing = fakeCloudApi({
        [path]: {
          answer: () => ({ error: HOSTED_API_ERROR.AGENT_NOT_READY }),
          status: HTTP_STATUS.CONFLICT,
        },
      });
      const message = { text: "  Drop the emoji.  ", clientKey: "key-1" };

      const sent = yield* Effect.provide(client().messageInbox(itemId, message), api.layer);
      const refused = yield* Effect.provide(client().messageInbox(itemId, message), refusing.layer);
      const empty = yield* Effect.provide(
        client().messageInbox(itemId, { text: " ", clientKey: "key-2" }),
        api.layer,
      );

      assert.deepEqual(sent, { item });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "null"), {
        text: "Drop the emoji.",
        clientKey: "key-1",
      });
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
      assert.deepEqual(empty, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 1, "nothing is sent for a message of neither");
    }),
);

it.effect(
  "marks an inbox item read with a PUT and unread with a DELETE at the item's read path, every item read with a PUT naming the workspace, reads an item the account cannot reach as not found, and sends nothing for a workspace that is no id",
  () =>
    Effect.gen(function* () {
      const itemId = "5d2b8f0e-1a3c-4e6f-9b7d-2c4e6a8b0d1f";
      const api = fakeCloudApi({
        [`PUT /api/inbox/${itemId}/read`]: { answer: () => ({ id: itemId, unread: false }) },
        [`DELETE /api/inbox/${itemId}/read`]: { answer: () => ({ id: itemId, unread: true }) },
        "PUT /api/inbox/read": { answer: () => ({ marked: 3 }) },
      });
      const refusing = fakeCloudApi({
        [`PUT /api/inbox/${itemId}/read`]: {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const read = yield* Effect.provide(client().markInboxItemRead(itemId), api.layer);
      const unread = yield* Effect.provide(client().markInboxItemUnread(itemId), api.layer);
      const all = yield* Effect.provide(
        client().markInboxRead({ workspaceId: WORKSPACE_ID }),
        api.layer,
      );
      const everywhere = yield* Effect.provide(client().markInboxRead(), api.layer);
      const missing = yield* Effect.provide(client().markInboxItemRead(itemId), refusing.layer);
      const malformed = yield* Effect.provide(
        client().markInboxRead({ workspaceId: "" }),
        api.layer,
      );

      assert.deepEqual(read, { id: itemId, unread: false });
      assert.deepEqual(unread, { id: itemId, unread: true });
      assert.deepEqual([all, everywhere], [{ marked: 3 }, { marked: 3 }]);
      assert.deepEqual(
        api.requests().map((sent) => sent.body),
        [undefined, undefined, JSON.stringify({ workspaceId: WORKSPACE_ID }), "{}"],
      );
      assert.deepEqual(missing, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(malformed, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.equal(api.requests().length, 4, "nothing is sent for a workspace that is no id");
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
  "reads an inbox item's attachment as base64 under the type it was kept as, an answer's PDF or text file as much as a picture, and any other type as unanswered",
  () =>
    Effect.gen(function* () {
      const itemId = "5d2b8f0e-1a3c-4e6f-9b7d-2c4e6a8b0d1f";
      const attachmentId = "6e3c9a1f-2b4d-4f70-8c8e-3d5f7b9c1e2a";
      const servedAs = (type: string) =>
        recordingHttpClient(
          () => new Response("%PDF", { status: 200, headers: { "content-type": type } }),
        );
      const read = (type: string) =>
        Effect.provide(client().inboxAttachment(itemId, attachmentId), servedAs(type).layer);

      assert.deepEqual(yield* read("application/pdf"), {
        contentType: "application/pdf",
        base64: "JVBERg==",
      });
      assert.deepEqual(yield* read("text/plain"), {
        contentType: "text/plain",
        base64: "JVBERg==",
      });
      assert.deepEqual(yield* read("text/html"), {
        failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });
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

it.effect(
  "reads a workspace's chat past the cursor it names, and a workspace the account is not in as not found",
  () =>
    Effect.gen(function* () {
      const self = "4e2b8c1d-5f3a-4b6c-9d7e-8f1a2b3c4d5e";
      const chat = {
        self,
        readSeq: 0,
        members: [
          { id: self, kind: MEMBER_KIND.HUMAN, handle: "ada", userId: "user-1", left: false },
        ],
        channels: [],
        messages: [],
        cursor: "12",
      };
      const api = fakeCloudApi({ "GET /api/workspaces/chat": { answer: () => chat } });
      const refusing = fakeCloudApi({
        "GET /api/workspaces/chat": {
          answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }),
          status: HTTP_STATUS.NOT_FOUND,
        },
      });

      const read = yield* Effect.provide(client().chat(WORKSPACE_ID, "7"), api.layer);
      const refused = yield* Effect.provide(client().chat(WORKSPACE_ID, "0"), refusing.layer);

      assert.deepEqual(read, chat);
      assert.equal(
        api.requests()[0]?.url,
        `https://tryluke.dev/api/workspaces/chat?workspaceId=${WORKSPACE_ID}&after=7`,
      );
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    }),
);

it.effect(
  "writes to a workspace's chat with the write as sent, reads each refusal as its own failure, and sends no write the service would refuse by shape",
  () =>
    Effect.gen(function* () {
      const write = { text: "Morning, @agent-2.", to: "#general", clientKey: "send-1" };
      const api = fakeCloudApi({
        "POST /api/workspaces/chat": { answer: () => ({ readSeq: 12 }) },
      });

      const read = yield* Effect.provide(
        client().chatPost(WORKSPACE_ID, { readTo: 12 }),
        api.layer,
      );
      const sent = yield* Effect.provide(client().chatPost(WORKSPACE_ID, write), api.layer);
      const unsent = yield* Effect.provide(
        client().chatPost(WORKSPACE_ID, { ...write, replyTo: 4 }),
        api.layer,
      );

      assert.deepEqual(read, { readSeq: 12 });
      assert.deepEqual(sent, { readSeq: 12 });
      assert.deepEqual(unsent, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        api.requests().map((request) => [request.url, JSON.parse(request.body ?? "{}")]),
        [
          [`https://tryluke.dev/api/workspaces/chat?workspaceId=${WORKSPACE_ID}`, { readTo: 12 }],
          [`https://tryluke.dev/api/workspaces/chat?workspaceId=${WORKSPACE_ID}`, write],
        ],
      );
      for (const [error, failure] of [
        [HOSTED_API_ERROR.NOT_FOUND, CODING_AGENT_CALL_FAILURE.NOT_FOUND],
        [HOSTED_API_ERROR.TASK_ARCHIVED, CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED],
      ] as const) {
        const refusing = fakeCloudApi({
          "POST /api/workspaces/chat": {
            answer: () => ({ error }),
            status: HTTP_STATUS.CONFLICT,
          },
        });
        const refused = yield* Effect.provide(
          client().chatPost(WORKSPACE_ID, write),
          refusing.layer,
        );
        assert.deepEqual(refused, { failure }, error);
      }
    }),
);

it.effect(
  "a Start outlasts the usual deadline, since one from another agent copies its work first, and answers unanswered only past its own",
  () =>
    Effect.gen(function* () {
      const request = { idempotencyKey: "press-1", from: { agentId: AGENT_ID } };
      let answer: (response: Response) => void = () => undefined;
      const slow = recordingHttpClient(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      const asked = yield* Effect.forkChild(
        Effect.provide(client().start(TASK_ID, request), slow.layer),
      );
      yield* TestClock.adjust("30 seconds");
      answer(
        new Response(JSON.stringify({ agent: AGENT }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
      assert.deepEqual(yield* Fiber.join(asked), { agent: AGENT });

      const silent = recordingHttpClient(() => new Promise<Response>(() => undefined));
      const unanswered = yield* Effect.forkChild(
        Effect.provide(client().start(TASK_ID, request), silent.layer),
      );
      yield* TestClock.adjust("119 seconds");
      assert.equal(unanswered.pollUnsafe(), undefined, "still waiting short of its deadline");
      yield* TestClock.adjust("1 second");
      assert.deepEqual(yield* Fiber.join(unanswered), {
        failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });
    }),
);
