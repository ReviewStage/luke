import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeCloudApi, HTTP_STATUS, type JsonValue, recordingHttpClient } from "@luke/wire/testing";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { accountBearer } from "./account-call.js";
import { HostedCodingAgentClient } from "./coding-agent-client.js";
import { CODING_AGENT_CALL_FAILURE } from "./coding-agent-view.js";
import { CODING_AGENT_STATUS } from "./coding-agent-wire.js";
import { INBOX_REPLY } from "./inbox-wire.js";
import { LIVE_SIGNED_OUT } from "./live-wire.js";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
} from "./provider-key-wire.js";
import { PULL_REQUEST_CHAPTERS_CALL_FAILURE } from "./pull-request-chapters-view.js";
import { PULL_REQUEST_CHAPTERS_STATE } from "./pull-request-chapters-wire.js";
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
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
    }),
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
  "a message refused at its plan's limit carries the reset the service named, and one with none is the bare refusal",
  () =>
    Effect.gen(function* () {
      const resetsAt = Date.UTC(2026, 9, 21, 15, 40);
      const refusingWith = (body: JsonValue) =>
        fakeCloudApi({
          "POST /api/agents/agent-1/messages": {
            answer: () => body,
            status: HTTP_STATUS.CONFLICT,
          },
        });
      const request = { text: "Also the emails.", clientKey: "key-1" };

      const named = yield* Effect.provide(
        client().message("agent-1", request),
        refusingWith({ error: HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED, resetsAt }).layer,
      );
      const bare = yield* Effect.provide(
        client().message("agent-1", request),
        refusingWith({ error: HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED }).layer,
      );

      assert.deepEqual(named, {
        failure: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED,
        resetsAt,
      });
      assert.deepEqual(bare, { failure: CODING_AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED });
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
      yield* Effect.provide(
        client().removeProviderKey({
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        }),
        api.layer,
      );

      assert.deepEqual(read, { keys: [kept] });
      assert.deepEqual(saved, { keys: [], rejected: PROVIDER_KEY_REJECTION.INVALID });
      assert.deepEqual(removed, { keys: [] });
      const [, save, removal, tokenRemoval] = api.requests();
      assert.deepEqual(JSON.parse(save?.body ?? "{}"), {
        provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
        key,
      });
      assert.equal(
        removal?.url,
        `https://tryluke.dev/api/account/provider-keys?provider=${PROVIDER_KEY_PROVIDER.ANTHROPIC}`,
      );
      assert.equal(
        tokenRemoval?.url,
        `https://tryluke.dev/api/account/provider-keys?provider=${PROVIDER_KEY_PROVIDER.ANTHROPIC}&kind=${PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN}`,
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
  "writes a message on an inbox item's thread at the item's own path, its words trimmed, answers the item as it then stands, names a refusal as a message's, sends an answer to the open ask on a reply with no words, and sends nothing that carries neither words, files, nor an answer",
  () =>
    Effect.gen(function* () {
      const itemId = "5d2b8f0e-1a3c-4e6f-9b7d-2c4e6a8b0d1f";
      const item = {
        id: itemId,
        agentId: AGENT_ID,
        key: "invite-copy",
        revision: 1,
        version: 5,
        title: "What should the invitation email say?",
        needsReply: true,
        status: "answered",
        thread: [
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
      const answers = {
        ask: "7f4d0b2a-3c5e-4a81-9d9f-4e6a8c0d2f3b",
        reply: INBOX_REPLY.CHOSE,
        choices: ["Short"],
      };
      const answered = yield* Effect.provide(
        client().messageInbox(itemId, { text: " ", clientKey: "key-3", answers }),
        api.layer,
      );

      assert.deepEqual(sent, { item });
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY });
      assert.deepEqual(empty, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(answered, { item });
      assert.deepEqual(
        api.requests().map((request) => JSON.parse(request.body ?? "null")),
        [
          { text: "Drop the emoji.", clientKey: "key-1" },
          { text: "", clientKey: "key-3", answers },
        ],
        "nothing is sent for a message of neither, and an answer goes without words",
      );
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

it.effect(
  "a message outlasts the service's wait for the agent's conversation and its thirty-second hand-over to eve, so one that lands slowly answers as sent, and is unanswered only past its own deadline",
  () =>
    Effect.gen(function* () {
      const request = { text: "Also the emails.", clientKey: "key-1" };
      const ran = { agent: AGENT };
      let answer: (response: Response) => void = () => undefined;
      const slow = recordingHttpClient(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      );
      const asked = yield* Effect.forkChild(
        Effect.provide(client().message(AGENT_ID, request), slow.layer),
      );
      yield* TestClock.adjust("40 seconds");
      answer(
        new Response(JSON.stringify(ran), {
          status: 202,
          headers: { "content-type": "application/json" },
        }),
      );
      assert.deepEqual(yield* Fiber.join(asked), ran);

      const silent = recordingHttpClient(() => new Promise<Response>(() => undefined));
      const unanswered = yield* Effect.forkChild(
        Effect.provide(client().message(AGENT_ID, request), silent.layer),
      );
      yield* TestClock.adjust("44 seconds");
      assert.equal(unanswered.pollUnsafe(), undefined, "still waiting short of its deadline");
      yield* TestClock.adjust("1 second");
      assert.deepEqual(yield* Fiber.join(unanswered), {
        failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
      });
    }),
);

it.effect(
  "a Start from an agent travels to that agent's own path with the body a task's Start carries, and one naming no agent travels nowhere",
  () =>
    Effect.gen(function* () {
      const request = { idempotencyKey: "press-1", from: { agentId: AGENT_ID } };
      const api = fakeCloudApi({
        [`POST /api/agents/${AGENT_ID}/agents`]: {
          answer: () => ({ agent: AGENT }),
          status: 201,
        },
      });

      const started = yield* Effect.provide(client().startFrom(request), api.layer);
      const nowhere = yield* Effect.provide(
        client().startFrom({ idempotencyKey: "press-2", prompt: "Go." }),
        api.layer,
      );

      assert.deepEqual(started, { agent: AGENT });
      assert.deepEqual(nowhere, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(
        api.requests().map((each) => [each.url, JSON.parse(each.body ?? "{}")]),
        [[`https://tryluke.dev/api/agents/${AGENT_ID}/agents`, request]],
      );
    }),
);

it.effect(
  "the account inbox sealed for following is read as the service answers it for the account named, polled past a digest where asked, a session of another account is signed out, and a refusal or a body that is no answer is unanswered",
  () =>
    Effect.gen(function* () {
      const sealed = {
        capability: "capability-1",
        queryFingerprint: "fingerprint-1",
        expiresAt: 1_800_000_060_000,
      };
      const live = {
        url: "wss://realtime.example/v1",
        queries: {
          items: sealed,
          planless: sealed,
          plans: sealed,
          automations: sealed,
          failedRuns: sealed,
        },
      };
      const answering = (answer: JsonValue, status: number = HTTP_STATUS.OK) =>
        fakeCloudApi({ "GET /api/live/inbox": { answer: () => answer, status } });

      const api = answering(live);
      const read = yield* Effect.provide(client().accountInboxLive("user-dana"), api.layer);
      yield* Effect.provide(client().accountInboxLive("user-dana", true, "d-1"), api.layer);
      const signedOut = yield* Effect.provide(
        client().accountInboxLive("user-dana"),
        answering({ error: HOSTED_API_ERROR.INVALID_TOKEN }, 401).layer,
      );
      const refused = yield* Effect.provide(
        client().accountInboxLive("user-dana"),
        answering({ error: HOSTED_API_ERROR.UNAVAILABLE }, 503).layer,
      );
      const unread = yield* Effect.provide(
        client().accountInboxLive("user-dana"),
        answering({ url: live.url }).layer,
      );

      assert.deepEqual(read, live);
      const [sealing, polling] = api.requests().map((each) => each.searchParams);
      assert.equal(sealing?.get("userId"), "user-dana");
      assert.equal(sealing?.get("poll"), null);
      assert.equal(polling?.get("poll"), "true");
      assert.equal(polling?.get("after"), "d-1");
      assert.deepEqual(signedOut, LIVE_SIGNED_OUT);
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(unread, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "a pull request's chapters are read by the tab's number and generated with it in the query, each refusal the tab acts on read as its own failure",
  () =>
    Effect.gen(function* () {
      const path = `/api/agents/${AGENT_ID}/chapters`;
      const answer = {
        pullRequest: {
          number: 7,
          headSha: "c0ffee1",
          generatable: true,
          chapters: { status: PULL_REQUEST_CHAPTERS_STATE.NONE },
        },
      };
      const api = fakeCloudApi({
        [`GET ${path}`]: { answer: () => answer },
        [`POST ${path}`]: { answer: () => answer },
      });

      assert.deepEqual(yield* Effect.provide(client().chapters(AGENT_ID, 7), api.layer), answer);
      assert.deepEqual(
        yield* Effect.provide(client().generateChapters(AGENT_ID, 7), api.layer),
        answer,
      );
      assert.deepEqual(yield* Effect.provide(client().chapters(AGENT_ID), api.layer), answer);
      assert.deepEqual(
        api.requests().map((request) => `${request.method} ${request.pathname}${request.search}`),
        [`GET ${path}?number=7`, `POST ${path}?number=7`, `GET ${path}`],
      );
      assert.equal(api.requests()[1]?.body ?? "", "");

      const refusals = [
        [HOSTED_API_ERROR.NOT_FOUND, PULL_REQUEST_CHAPTERS_CALL_FAILURE.NOT_FOUND],
        [
          HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
          PULL_REQUEST_CHAPTERS_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
        ],
        [HOSTED_API_ERROR.GITHUB_UNANSWERED, PULL_REQUEST_CHAPTERS_CALL_FAILURE.GITHUB_UNANSWERED],
        [HOSTED_API_ERROR.UNAVAILABLE, PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNAVAILABLE],
        [HOSTED_API_ERROR.INVALID_REQUEST, PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED],
      ] as const;
      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          [`POST ${path}`]: { answer: () => ({ error }), status: HTTP_STATUS.CONFLICT },
        });
        assert.deepEqual(
          yield* Effect.provide(client().generateChapters(AGENT_ID), refusing.layer),
          { failure },
          error,
        );
      }
    }),
);

it.effect(
  "ensures the operator in a workspace with the reset as sent, and reads the experiment's 404 as not found",
  () =>
    Effect.gen(function* () {
      const path = `PUT /api/workspaces/${WORKSPACE_ID}/operator`;
      const api = fakeCloudApi({ [path]: { answer: () => ({ agentId: AGENT_ID, txid: "9103" }) } });
      const refusing = fakeCloudApi({
        [path]: { answer: () => ({ error: HOSTED_API_ERROR.NOT_FOUND }), status: 404 },
      });

      const ensured = yield* Effect.provide(
        client().ensureOperator(WORKSPACE_ID, { reset: true }),
        api.layer,
      );
      const refused = yield* Effect.provide(
        client().ensureOperator(WORKSPACE_ID, {}),
        refusing.layer,
      );

      assert.deepEqual(ensured, { agentId: AGENT_ID, txid: "9103" });
      assert.deepEqual(JSON.parse(api.requests()[0]?.body ?? "{}"), { reset: true });
      assert.deepEqual(refused, { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND });
    }),
);

it.effect(
  "a dictated clip answers its words, and a clip refused for want of an OpenAI key says so rather than unanswered",
  () =>
    Effect.gen(function* () {
      const clip = { audio: "T2dnUw==", durationMs: 1_500, keywords: ["relay"] };
      const answering = fakeCloudApi({
        "POST /api/dictation": { answer: () => ({ text: "Run the tests" }) },
      });
      const heard = yield* Effect.provide(client().transcribeDictation(clip), answering.layer);
      assert.deepEqual(heard, { text: "Run the tests" });

      const refusals = [
        [HOSTED_API_ERROR.OPENAI_KEY_MISSING, CODING_AGENT_CALL_FAILURE.OPENAI_KEY_MISSING],
        [HOSTED_API_ERROR.UNAVAILABLE, CODING_AGENT_CALL_FAILURE.UNANSWERED],
      ] as const;
      for (const [error, failure] of refusals) {
        const refusing = fakeCloudApi({
          "POST /api/dictation": { answer: () => ({ error }), status: HTTP_STATUS.CONFLICT },
        });
        const refused = yield* Effect.provide(client().transcribeDictation(clip), refusing.layer);
        assert.deepEqual(refused, { failure }, error);
      }
    }),
);
