import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import type { WireBoundaryInput } from "@luke/wire";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { type CoderHost, coderHost } from "../coder-host/host.js";
import { postToInbox } from "../coder-host/inbox.js";
import type { CoderHostSeams } from "../coder-host/production.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { LUKE_MCP_PATH, LUKE_MCP_PROTOCOL_VERSIONS, lukeMcpApp } from "./app.js";
import { runnerTokenDigest } from "./bearer.js";

/**
 * Luke's MCP server, answered by its group the way a function answers it,
 * over a real dialect, and driven by the MCP SDK's own client, the one a
 * harness speaks: a runner's bearer admits its agent's conversation, the
 * server lists `read_inbox` and runs it through the coder host's inbox door
 * as the agent's starter, and a wrong bearer, a missing one, and a retired
 * one are each refused before anything is read. Synthetic accounts and
 * words throughout.
 *
 * The SDK is pinned at the version the pinned Agent SDK resolves its MCP
 * peer to (`@anthropic-ai/claude-agent-sdk@0.3.304`'s `^1.29.0`), so a
 * client upgrade that stops speaking to this server fails here.
 */

const ORIGIN = "https://luke.test";

/** The coder host over the test's own store; the seams the inbox door never reads answer nothing. */
const hostOverStore = Effect.gen(function* () {
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  const seams: CoderHostSeams = {
    writer: () => Effect.succeed(writer),
    userInfo: () => Effect.succeed(undefined),
    ownership: {
      reachesSession: () => Promise.resolve(false),
      reachesConversation: () => Promise.resolve(false),
    },
    deploymentSecret: () => undefined,
    eveOrigin: () => undefined,
    keys: () =>
      Effect.succeed({
        anthropic: { key: Redacted.make("sk-ant-fixture") },
        openAi: { key: Redacted.make("sk-openai-fixture") },
      }),
    fastRefused: async () => undefined,
    titleModel: () => undefined,
    research: () => ({ openAi: undefined, spend: Effect.void }),
    scriptedModel: () => false,
    now: () => 0,
  };
  return coderHost(seams);
});

/** The server's group over the test's database, as a fetch a client is handed. */
const standing = Effect.gen(function* () {
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
  );
  const host: CoderHost = yield* hostOverStore;
  const web = HttpRouter.toWebHandler(
    lukeMcpApp(() => host).pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
  return (input: string | URL | Request, init?: RequestInit) =>
    web.handler(new Request(input, init));
});

/** A Claude Code agent started on a task, with a runner's bearer recorded for its conversation. */
const agentWithBearer = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    planSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });
  const agent = Option.getOrThrow(started).agent;
  const bearer = randomBytes(32).toString("base64url");
  yield* recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer));
  return { userId, taskId: task.id, agentId: agent.id, bearer };
});

/** An SDK client connected to the server under the bearer. */
function connected(fetch: typeof globalThis.fetch, bearer: string) {
  return Effect.promise(async () => {
    const client = new Client({ name: "runner-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}${LUKE_MCP_PATH}`), {
      fetch,
      requestInit: { headers: { authorization: `Bearer ${bearer}` } },
    });
    // SAFETY: the SDK's transport is its own `Transport`; its optional members are typed without `undefined`, which this repository's `exactOptionalPropertyTypes` reads strictly.
    await client.connect(transport as Transport);
    return client;
  });
}

/** One raw JSON-RPC POST, as a client that is no SDK's sends it. */
function post(
  fetch: typeof globalThis.fetch,
  bearer: string | undefined,
  body: WireBoundaryInput,
  extra: Readonly<Record<string, string>> = {},
) {
  return Effect.promise(async () => {
    const headers = new Headers(extra);
    headers.set("content-type", "application/json");
    headers.set("accept", "application/json, text/event-stream");
    if (bearer !== undefined) headers.set("authorization", `Bearer ${bearer}`);
    const response = await fetch(`${ORIGIN}${LUKE_MCP_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
  });
}

const initialize = (protocolVersion: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion, capabilities: {}, clientInfo: { name: "raw", version: "1" } },
});

it.layer(getTestDB())("Luke's MCP server", (it) => {
  it.effect(
    "an SDK client under the runner's bearer lists read_inbox and reads its agent's inbox through the inbox door",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;
        yield* postToInbox(
          agent,
          {
            key: "invite-queue",
            title: "Which queue sends the invitation emails?",
            body: "Postgres or Redis?",
          },
          () => Promise.reject(new Error("the sandbox was opened")),
        );
        const client = yield* connected(fetch, agent.bearer);

        const listed = yield* Effect.promise(() => client.listTools());
        const called = yield* Effect.promise(() =>
          client.callTool({ name: INBOX_TOOL.READ, arguments: {} }),
        );
        yield* Effect.promise(() => client.close());

        assert.deepEqual(
          listed.tools.map((tool) => tool.name),
          [INBOX_TOOL.READ],
        );
        assert.equal(called.isError, false);
        // SAFETY: the server answers every tool call with text blocks alone (`app.ts`'s `toolResult`).
        const [content] = called.content as readonly { type: string; text: string }[];
        const result = JSON.parse(content?.text ?? "null");
        assert.equal(result.status, "accepted");
        assert.deepEqual(
          result.inbox.map((line: { key: string; title: string }) => [line.key, line.title]),
          [["invite-queue", "Which queue sends the invitation emails?"]],
        );
      }),
  );

  it.effect("a wrong bearer, and a request with none, are refused before anything is read", () =>
    Effect.gen(function* () {
      const fetch = yield* standing;
      yield* agentWithBearer;

      const wrong = yield* post(
        fetch,
        randomBytes(32).toString("base64url"),
        initialize("2025-06-18"),
      );
      const none = yield* post(fetch, undefined, initialize("2025-06-18"));
      const sdk = yield* Effect.exit(connected(fetch, "not-the-bearer"));

      assert.equal(wrong.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
      assert.equal(none.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
      assert.equal(sdk._tag, "Failure");
    }),
  );

  it.effect("a bearer retired from the agent's conversation is refused from then on", () =>
    Effect.gen(function* () {
      const fetch = yield* standing;
      const agent = yield* agentWithBearer;
      const before = yield* post(fetch, agent.bearer, {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: INBOX_TOOL.READ, arguments: {} },
      });

      yield* recordCodingAgentRunnerToken(agent.userId, agent.agentId, null);
      const after = yield* post(fetch, agent.bearer, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: INBOX_TOOL.READ, arguments: {} },
      });

      assert.equal(before.status, HOSTED_HTTP_STATUS.OK);
      assert.equal(before.body.result.isError, false);
      assert.equal(after.status, HOSTED_HTTP_STATUS.UNAUTHORIZED);
    }),
  );

  it.effect(
    "initialize answers the client's protocol version where the server speaks it, and its newest where it does not",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;

        const spoken = yield* post(fetch, agent.bearer, initialize("2025-03-26"));
        const unspoken = yield* post(fetch, agent.bearer, initialize("2099-01-01"));

        assert.equal(spoken.body.result.protocolVersion, "2025-03-26");
        assert.equal(unspoken.body.result.protocolVersion, LUKE_MCP_PROTOCOL_VERSIONS[0]);
      }),
  );

  it.effect(
    "a tool the server does not hold and a method it does not know are protocol errors; a notification is taken with no body",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;

        const unknownTool = yield* post(fetch, agent.bearer, {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "bash", arguments: {} },
        });
        const unknownMethod = yield* post(fetch, agent.bearer, {
          jsonrpc: "2.0",
          id: 5,
          method: "resources/list",
        });
        const notification = yield* post(fetch, agent.bearer, {
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        const unspokenHeader = yield* post(
          fetch,
          agent.bearer,
          { jsonrpc: "2.0", id: 6, method: "ping" },
          { "mcp-protocol-version": "2099-01-01" },
        );

        assert.equal(unknownTool.body.error.code, -32602);
        assert.equal(unknownMethod.body.error.code, -32601);
        assert.deepEqual(
          [notification.status, notification.body],
          [HOSTED_HTTP_STATUS.ACCEPTED, undefined],
        );
        assert.equal(unspokenHeader.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
      }),
  );
});
