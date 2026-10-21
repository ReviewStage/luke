import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { writeDrawing, writeScene } from "@luke/database/models/board-store";
import {
  createCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { user } from "@luke/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { CHAT_TOOL } from "@luke/features/chat-wire";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { PICTURE_TYPE, type Picture } from "@luke/features/picture-wire";
import { planAttachmentAddress } from "@luke/features/plan-attachment-link";
import { EXPERIMENT } from "@luke/settings";
import { type UnparsedWireValue, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { Base64 } from "effect/encoding";
import { type HttpClient, HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { runConnectionExecute, runConnectionSearch } from "../../integrations/connection-door.js";
import type {
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "../../integrations/integration-connect.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
} from "../../integrations/integration-store.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import type { CommentToolName } from "../../tasks/comment-tools.js";
import { NO_GITHUB } from "../../testing/github-app-fake.js";
import {
  CONNECTOR_ASKED_NOTHING,
  firstIntegrationAccount,
  integrationConnectOf,
} from "../../testing/integration-connect.js";
import {
  LINEAR_AND_NOTION_CONNECT,
  linearServer,
  linearTokenOf,
} from "../../testing/integration-mcp-fake.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import {
  type AgentDoorSeams,
  type AgentToolCall,
  runAgentBoard,
  runAgentChat,
  runAgentComment,
  runAgentEditPlan,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
  runAgentShowCode,
  runAgentShowImage,
  runAgentShowPage,
  runAgentTools,
} from "../coder-host/agent-doors.js";
import { postToInbox } from "../coder-host/inbox.js";
import { runAgentInbox } from "../coder-host/inbox-door.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import type { RepositorySandboxDoor } from "../repository-shell.js";
import { LUKE_MCP_PATH, LUKE_MCP_PROTOCOL_VERSIONS, lukeMcpApp } from "./app.js";
import { admitRunnerBearer, runnerTokenDigest } from "./bearer.js";
import { lukeMcpDoorSeams } from "./door-seams.js";
import { LUKE_MCP_TOOLS, type LukeMcpServices, refusedByDoor } from "./tools.js";

/**
 * Luke's MCP server, answered by its group the way a function answers it,
 * over a real dialect, and driven by the MCP SDK's own client, the one a
 * harness speaks: a runner's bearer admits its agent's conversation, the
 * server lists `read_inbox` and runs it through the coder host's inbox door
 * as the agent's starter, the door eve's tool reaches through the coder host, and a wrong bearer, a missing one, and a retired
 * one are each refused before anything is read. Synthetic accounts and
 * words throughout.
 *
 * The SDK is pinned at the version the pinned Agent SDK resolves its MCP
 * peer to (`@anthropic-ai/claude-agent-sdk@0.3.304`'s `^1.29.0`), so a
 * client upgrade that stops speaking to this server fails here.
 */

const ORIGIN = "https://luke.test";

/** A picture's bytes: a PNG's signature and a few more, which is all the store reads of them. */
const PICTURE: Picture = {
  contentType: PICTURE_TYPE.PNG,
  bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7, 7]),
};

/** A deployment that names nothing of its environment: no eve to reach, no keys. */
const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  eveDeploymentSecret: undefined,
};

/** The integrations this deployment set up: none, so a turn is handed GitHub alone, as the App offers it. */
const NO_INTEGRATIONS = integrationConnectOf(() => ({
  ...CONNECTOR_ASKED_NOTHING,
  configured: false,
}));

/** The services the doors run against, over the test's database: GitHub, the catalog, Linear and eve none of them reach. */
const doorServices = Effect.gen(function* () {
  return Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    NO_GITHUB,
    modelCatalogOf([]),
    NO_INTEGRATIONS,
    Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
  );
});

/** A sandbox holding the files given by absolute path, each read as one stream; the paths asked for are kept. */
function sandboxWith(files: Readonly<Record<string, string>>) {
  const asked: string[] = [];
  const door: InboxSandboxDoor = () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        asked.push(path);
        const text = files[path];
        if (text === undefined) return Promise.resolve(null);
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(text));
              controller.close();
            },
          }),
        );
      },
    });
  return { door, asked };
}

/** A sandbox no call opens: a tool that reads no file never asks for it. */
const NO_SANDBOX: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** A checkout no call opens: a tool that runs no command never asks for it. */
const NO_CHECKOUT: RepositorySandboxDoor = () =>
  Promise.reject(new Error("the checkout was opened"));

/** The server's group over the test's database, the sandbox door given, and any services that stand in for the ones given, as a fetch a client is handed. */
const standingOver = (
  sandbox: InboxSandboxDoor = NO_SANDBOX,
  instead?: Layer.Layer<IntegrationConnect | WorkspaceLinearConnect | HttpClient.HttpClient>,
) =>
  Effect.gen(function* () {
    const base = yield* doorServices;
    const services = instead === undefined ? base : Layer.merge(base, instead);
    const web = HttpRouter.toWebHandler(
      lukeMcpApp(() => ({ files: sandbox, repository: NO_CHECKOUT })).pipe(
        HttpRouter.provideRequest(services),
      ),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
    return (input: string | URL | Request, init?: RequestInit) =>
      web.handler(new Request(input, init));
  });

const standing = standingOver();

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

/** The tools a native agent is served: every Luke tool of the eve agent's that its harness has no equal of. */
const SERVED_TOOLS = [
  "post_to_inbox",
  "read_inbox",
  "withdraw_ask",
  "open_pull_request",
  "edit_plan",
  "look_at_picture",
  "show_image",
  "show_page",
  "read_page",
  "show_code",
  "draw_on_board",
  "look_at_board",
  "start_agent",
  "stop_agent",
  "list_agents",
  "read_agent",
  "update_agent",
  "list_models",
  "list_tasks",
  "read_task",
  "create_task",
  "update_task",
  "create_section",
  "delete_section",
  "post_chat",
  "read_chat",
  "resolve_ask",
  "edit_channel",
  "read_comments",
  "reply_to_comment",
  "resolve_thread",
  "reopen_thread",
  "run_on_mac",
  "connection_search",
  "connection_execute",
] as const;

type ServedTool = (typeof SERVED_TOOLS)[number];

/** A call of a door made directly, as eve's tool for it makes one through the coder host. */
type DirectCall = (
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  seams: AgentDoorSeams,
) => Effect.Effect<object, never, LukeMcpServices>;

const agentTool =
  (tool: AgentToolCall["tool"]): DirectCall =>
  (admitted, input, seams) =>
    runAgentTools(seams, admitted, { tool, input, callId: randomUUID() });

const commentTool =
  (name: CommentToolName): DirectCall =>
  (admitted, input) =>
    runAgentComment(admitted, name, input);

/**
 * Each tool's own door, called as eve's tool calls it: the server's answer to
 * a tool is to be this one's, so a tool routed to any other door, or to
 * none, answers otherwise.
 */
const DOOR_OF: Readonly<Record<Exclude<ServedTool, "run_on_mac">, DirectCall>> = {
  post_to_inbox: (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.POST, input, sandbox: NO_SANDBOX }),
  read_inbox: (admitted, input) => runAgentInbox(admitted, { tool: INBOX_TOOL.READ, input }),
  withdraw_ask: (admitted, input) => runAgentInbox(admitted, { tool: INBOX_TOOL.WITHDRAW, input }),
  open_pull_request: (admitted, input) => runAgentOpenPullRequest(admitted, input),
  edit_plan: (admitted, input) => runAgentEditPlan(admitted, input, 0, NO_SANDBOX),
  look_at_picture: (admitted, input) => runAgentLookAtPicture(admitted, input),
  show_image: (admitted, input) => runAgentShowImage(admitted, input, NO_SANDBOX),
  show_page: (admitted, input) => runAgentShowPage(admitted, input, NO_SANDBOX),
  read_page: agentTool("read_page"),
  show_code: (admitted, input) => runAgentShowCode(admitted, input, NO_CHECKOUT),
  draw_on_board: (admitted, input) => runAgentBoard(admitted, "draw_on_board", input),
  look_at_board: (admitted, input) => runAgentBoard(admitted, "look_at_board", input),
  start_agent: agentTool("start_agent"),
  stop_agent: agentTool("stop_agent"),
  list_agents: agentTool("list_agents"),
  read_agent: agentTool("read_agent"),
  update_agent: agentTool("update_agent"),
  list_models: agentTool("list_models"),
  list_tasks: agentTool("list_tasks"),
  read_task: agentTool("read_task"),
  create_task: agentTool("create_task"),
  update_task: agentTool("update_task"),
  create_section: agentTool("create_section"),
  delete_section: agentTool("delete_section"),
  post_chat: (admitted, input, seams) =>
    runAgentChat(seams, admitted, {
      tool: CHAT_TOOL.POST,
      input,
      clientKey: randomUUID(),
      postsInTurn: 0,
      sandbox: NO_SANDBOX,
    }),
  read_chat: (admitted, input, seams) =>
    runAgentChat(seams, admitted, { tool: CHAT_TOOL.READ, input }),
  resolve_ask: (admitted, input, seams) =>
    runAgentChat(seams, admitted, { tool: CHAT_TOOL.RESOLVE, input }),
  edit_channel: (admitted, input, seams) =>
    runAgentChat(seams, admitted, { tool: CHAT_TOOL.EDIT_CHANNEL, input }),
  read_comments: commentTool("read_comments"),
  reply_to_comment: commentTool("reply_to_comment"),
  resolve_thread: commentTool("resolve_thread"),
  reopen_thread: commentTool("reopen_thread"),
  connection_search: (admitted, input) => runConnectionSearch(admitted, input),
  connection_execute: (admitted, input) => runConnectionExecute(admitted, input),
};

/** The eve tools a harness has its own of, which the server never serves. */
const HARNESS_TOOLS = [
  "bash",
  "read_file",
  "write_file",
  "glob",
  "grep",
  "apply_patch",
  "write_todos",
  "sleep",
  "delegate",
  "task_wait",
  "task_cancel",
  "load_skill",
  "search_web",
  "read_web_page",
] as const;

/** A tool's result as the server answers it, its first block's JSON. */
function firstJson(called: object) {
  // SAFETY: every result but a picture's is one text block (`app.ts`'s `toolResult`).
  const [content] = (called as { content: readonly { type: string; text: string }[] }).content;
  return JSON.parse(content?.text ?? "null");
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

        assert.ok(listed.tools.some((tool) => tool.name === INBOX_TOOL.READ));
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

  it.effect(
    "tools/list names every Luke tool the agent's harness has no equal of, each with its eve tool's schema, and none the harness has",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;
        const client = yield* connected(fetch, agent.bearer);

        const listed = yield* Effect.promise(() => client.listTools());
        yield* Effect.promise(() => client.close());

        const names = listed.tools.map((tool) => tool.name);
        assert.deepEqual([...names].sort(), [...SERVED_TOOLS].sort());
        for (const native of HARNESS_TOOLS) assert.ok(!names.includes(native), native);
        for (const tool of listed.tools) {
          const served = LUKE_MCP_TOOLS.get(tool.name);
          assert.ok(served !== undefined);
          assert.equal(tool.description, served.description);
          assert.deepEqual(tool.inputSchema, served.inputSchema);
        }
      }),
  );

  it.effect("a door's refusal, whatever its status, is a tool error the agent reads", () =>
    Effect.gen(function* () {
      const fetch = yield* standing;
      const agent = yield* agentWithBearer;
      const client = yield* connected(fetch, agent.bearer);

      const noMac = yield* Effect.promise(() =>
        client.callTool({ name: "run_on_mac", arguments: { command: "ls ~/code" } }),
      );
      const unreadable = yield* Effect.promise(() =>
        client.callTool({ name: "withdraw_ask", arguments: {} }),
      );
      const noPicture = yield* Effect.promise(() =>
        client.callTool({
          name: "look_at_picture",
          arguments: { address: "https://tryluke.dev/acme/plan/p/files/missing" },
        }),
      );
      yield* Effect.promise(() => client.close());

      assert.deepEqual([noMac.isError, firstJson(noMac).status], [true, "not-run"]);
      assert.deepEqual([unreadable.isError, firstJson(unreadable).status], [true, "rejected"]);
      assert.deepEqual([noPicture.isError, firstJson(noPicture).status], [true, "not-looked"]);
    }),
  );

  it.effect(
    "each tool answers as its own door does, called as eve's tool calls it, for the same agent and input",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;
        const admitted = Option.getOrThrow(yield* admitRunnerBearer(agent.bearer));
        const seams = yield* lukeMcpDoorSeams.pipe(Effect.provide(yield* doorServices));
        // Chat is on, so each chat tool reaches its own words rather than the one refusal of Chat off.
        yield* writeAccountPreferences(agent.userId, { experiments: { [EXPERIMENT.CHAT]: true } });
        const client = yield* connected(fetch, agent.bearer);

        for (const [name, door] of Object.entries(DOOR_OF)) {
          // A look at the whiteboard that takes nothing waits on the Mac's image; one that names anything is refused at once.
          const input = name === "look_at_board" ? { probe: name } : {};
          const called = yield* Effect.promise(() => client.callTool({ name, arguments: input }));
          const direct = yield* door(admitted, unparsedWire(input), seams).pipe(
            Effect.provide(yield* doorServices),
          );
          assert.deepEqual(firstJson(called), JSON.parse(JSON.stringify(direct)), name);
          assert.equal(called.isError, refusedByDoor(direct), name);
        }
        yield* Effect.promise(() => client.close());
      }),
  );

  it.effect("show_page reads the page the agent names by its path from the agent's sandbox", () =>
    Effect.gen(function* () {
      const sandbox = sandboxWith({
        "/workspace/repository/pages/funnel.html":
          "<!doctype html><title>Funnel</title><p>Invites</p>",
      });
      const fetch = yield* standingOver(sandbox.door);
      const agent = yield* agentWithBearer;
      const client = yield* connected(fetch, agent.bearer);

      const called = yield* Effect.promise(() =>
        client.callTool({
          name: "show_page",
          arguments: { title: "Invite funnel", path: "pages/funnel.html" },
        }),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(called.isError, false);
      assert.equal(firstJson(called).status, "accepted");
      assert.deepEqual(sandbox.asked, ["/workspace/repository/pages/funnel.html"]);
    }),
  );

  it.effect(
    "a picture of the agent's plan comes back as its look's status and image content, never as text",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;
        const kept = yield* keepPlanAttachment(agent.userId, agent.taskId, PICTURE);
        if (kept.status !== PLAN_ATTACHMENT_KEEP.KEPT)
          return assert.fail("the picture was not kept");
        const address = planAttachmentAddress(
          { taskId: agent.taskId, attachmentId: kept.id },
          "acme",
        );
        const client = yield* connected(fetch, agent.bearer);

        const called = yield* Effect.promise(() =>
          client.callTool({ name: "look_at_picture", arguments: { address } }),
        );
        yield* Effect.promise(() => client.close());

        assert.equal(called.isError, false);
        assert.deepEqual(called.content, [
          { type: "text", text: '{"status":"looked"}' },
          { type: "image", data: Base64.encode(PICTURE.bytes), mimeType: PICTURE_TYPE.PNG },
        ]);
      }),
  );

  it.effect(
    "a look at the agent's whiteboard comes back as its look's status and image content, never as text",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentWithBearer;
        yield* writeDrawing(agent.userId, agent.taskId, [
          { type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" },
        ]);
        yield* writeScene(
          agent.userId,
          agent.taskId,
          [{ id: "api", type: BOARD_ELEMENT_TYPE.RECTANGLE, x: 0, y: 0, width: 200, height: 80 }],
          1,
          "iVBORw0KGgo=",
        );
        const client = yield* connected(fetch, agent.bearer);

        const called = yield* Effect.promise(() =>
          client.callTool({ name: "look_at_board", arguments: {} }),
        );
        yield* Effect.promise(() => client.close());

        assert.equal(called.isError, false);
        assert.deepEqual(called.content, [
          { type: "text", text: '{"status":"looked"}' },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ]);
      }),
  );

  it.effect(
    "a connection's tools are searched and called over the server on the member's own grant, a picture coming back as image content",
    () =>
      Effect.gen(function* () {
        const agent = yield* agentWithBearer;
        yield* beginIntegrationSignIn(
          agent.userId,
          firstIntegrationAccount(agent.userId, "linear"),
          `state-${agent.userId}`,
          Redacted.make("connect-verifier"),
        );
        yield* completeIntegrationSignIn(agent.userId, "linear", `state-${agent.userId}`);
        const heard = { calls: [], bearers: [] };
        const fetch = yield* standingOver(
          NO_SANDBOX,
          Layer.merge(LINEAR_AND_NOTION_CONNECT, linearServer(linearTokenOf(agent.userId), heard)),
        );
        const client = yield* connected(fetch, agent.bearer);

        const searched = yield* Effect.promise(() =>
          client.callTool({
            name: "connection_search",
            arguments: { query: "list issues", connection: "linear", limit: 1 },
          }),
        );
        const drawn = yield* Effect.promise(() =>
          client.callTool({
            name: "connection_execute",
            arguments: { connection: "linear", tool: "draw" },
          }),
        );
        const attached = yield* Effect.promise(() =>
          client.callTool({
            name: "connection_execute",
            arguments: { connection: "linear", tool: "attach" },
          }),
        );
        const unsigned = yield* Effect.promise(() =>
          client.callTool({
            name: "connection_execute",
            arguments: { connection: "notion", tool: "notion-search" },
          }),
        );
        yield* Effect.promise(() => client.close());

        assert.equal(searched.isError, false);
        assert.deepEqual(
          firstJson(searched).tools.map((tool: { tool: string }) => tool.tool),
          ["list_issues"],
        );
        assert.equal(drawn.isError, false);
        assert.deepEqual(drawn.content, [
          { type: "text", text: "A chart:" },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ]);
        assert.deepEqual(attached.content, [
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          {
            type: "text",
            text: "Resource: file:///notes.pdf (application/pdf, binary, not shown)",
          },
          { type: "image", data: "R0lGODlh", mimeType: "image/gif" },
        ]);
        assert.equal(unsigned.isError, true);
        assert.deepEqual(
          [firstJson(unsigned).connection, firstJson(unsigned).requiresSignIn],
          ["notion", true],
        );
      }),
  );
});
