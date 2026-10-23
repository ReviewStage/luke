import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import { listAgentBrowserTabs } from "@luke/database/models/agent-browser-tabs";
import { writeDrawing, writeScene } from "@luke/database/models/board-store";
import {
  createCodingAgent,
  recordCodingAgentRunnerToken,
} from "@luke/database/models/coding-agent-store";
import { keepPlanAttachment, PLAN_ATTACHMENT_KEEP } from "@luke/database/models/plan-attachments";
import { user } from "@luke/database/schemas/auth";
import { conversations } from "@luke/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { getTestDB, openWorkspace, startTask } from "@luke/database/testing";
import { BOARD_ELEMENT_TYPE } from "@luke/features/board-vocabulary";
import { BROWSER_AGENT_ACTION } from "@luke/features/browser-agent-actions";
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
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Redacted } from "effect";
import { Base64 } from "effect/encoding";
import { type HttpClient, HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import type {
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "../../integrations/integration-connect.js";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
} from "../../integrations/integration-store.js";
import { INTEGRATION } from "../../integrations/integrations.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import type { CommentToolName } from "../../tasks/comment-tools.js";
import {
  agentBrowserTestLayer,
  fakeCdpPeer,
  noSandboxBrowserLayer,
} from "../../testing/agent-browser-fake.js";
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
import { SentryApp, sentryAppService } from "../../triggers/sentry/sentry-app-config.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import { BROWSER_TOOL_REFUSAL } from "../browser/browser-tool.js";
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
import {
  LUKE_INTEGRATION_MCP_PATH,
  LUKE_MCP_PATH,
  LUKE_MCP_PROTOCOL_VERSIONS,
  type LukeMcpBrowser,
  lukeMcpApp,
} from "./app.js";
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
    Layer.succeed(SentryApp, sentryAppService(undefined, [])),
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

/** The server's group over the test's database, the sandbox door and the browser given, and any services that stand in for the ones given, as a fetch a client is handed. */
const standingOver = (
  sandbox: InboxSandboxDoor = NO_SANDBOX,
  instead?: Layer.Layer<IntegrationConnect | WorkspaceLinearConnect | HttpClient.HttpClient>,
  browser: LukeMcpBrowser = noSandboxBrowserLayer,
) =>
  Effect.gen(function* () {
    const base = yield* doorServices;
    const services = instead === undefined ? base : Layer.merge(base, instead);
    const web = HttpRouter.toWebHandler(
      lukeMcpApp({ sandbox: () => ({ files: sandbox, repository: NO_CHECKOUT }), browser }).pipe(
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

/** A Codex agent on no task and in no repository, as an automation's run starts one, with a runner's bearer recorded for its conversation. */
const agentOnNoTaskWithBearer = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const organizationId = yield* openWorkspace(userId);
  const started = yield* createCodingAgent(userId, {
    taskId: null,
    organizationId,
    planSnapshot: null,
    prompt: "Chart the funnel",
    idempotencyKey: randomUUID(),
    model: "openai/gpt-5.5",
    effort: "high",
    repository: null,
    runtime: CONVERSATION_RUNTIME.CODEX,
    payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
  });
  const agent = Option.getOrThrow(started).agent;
  const bearer = randomBytes(32).toString("base64url");
  yield* recordCodingAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer));
  return { userId, agentId: agent.id, bearer };
});

/** What a fake Chromium's page answers beside its targets, as Chrome does for a screenshot of it. */
const PAGE_ANSWERS: Readonly<Record<string, { readonly result: unknown }>> = {
  "Target.attachToTarget": { result: { sessionId: "session-tab-1" } },
  "Target.detachFromTarget": { result: {} },
  "Target.activateTarget": { result: {} },
  "Page.getLayoutMetrics": {
    result: {
      cssLayoutViewport: { clientWidth: 1280, clientHeight: 800 },
      cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 800 },
    },
  },
  "Runtime.evaluate": { result: { result: { value: "complete" } } },
  "Page.captureScreenshot": { result: { data: "/9j/AAAA" } },
};

/** The session a native agent's sandbox is tagged with, as its conversation records it. */
const SESSION = "runner_session_fixture";

/** An agent with a bearer whose conversation records its runner's session, as one whose runner started does; its conversation's id beside. */
const agentInSandbox = Effect.gen(function* () {
  const agent = yield* agentWithBearer;
  const admitted = Option.getOrThrow(yield* admitRunnerBearer(agent.bearer));
  const { conversationId } = admitted.target;
  yield* Database.use((db) =>
    db
      .update(conversations)
      .set({ runtimeSessionId: SESSION })
      .where(eq(conversations.id, conversationId)),
  );
  return { ...agent, conversationId };
});

/** An SDK client connected under the bearer to the server at the path given, Luke's own unless another is named. */
function connected(fetch: typeof globalThis.fetch, bearer: string, path: string = LUKE_MCP_PATH) {
  return Effect.promise(async () => {
    const client = new Client({ name: "runner-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}${path}`), {
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
  "list_open_asks",
  "list_tasks",
  "read_task",
  "create_task",
  "update_task",
  "create_section",
  "delete_section",
  "list_automations",
  "create_automation",
  "update_automation",
  "delete_automation",
  "post_chat",
  "read_chat",
  "resolve_ask",
  "edit_channel",
  "read_comments",
  "reply_to_comment",
  "resolve_thread",
  "reopen_thread",
  "run_on_mac",
  "browser",
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
const DOOR_OF: Readonly<Record<Exclude<ServedTool, "run_on_mac" | "browser">, DirectCall>> = {
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
  list_open_asks: agentTool("list_open_asks"),
  list_tasks: agentTool("list_tasks"),
  read_task: agentTool("read_task"),
  create_task: agentTool("create_task"),
  update_task: agentTool("update_task"),
  create_section: agentTool("create_section"),
  delete_section: agentTool("delete_section"),
  list_automations: agentTool("list_automations"),
  create_automation: agentTool("create_automation"),
  update_automation: agentTool("update_automation"),
  delete_automation: agentTool("delete_automation"),
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
        // Note that an operator's own read is the one tool eve offers no agent on a task.
        assert.deepEqual(
          [...names].sort(),
          SERVED_TOOLS.filter((name) => name !== "list_open_asks").sort(),
        );
        for (const native of HARNESS_TOOLS) assert.ok(!names.includes(native), native);
        for (const tool of listed.tools) {
          const served = LUKE_MCP_TOOLS.get(tool.name);
          assert.ok(served !== undefined);
          assert.equal(tool.description, served.description);
          assert.deepEqual(tool.inputSchema, served.inputSchema);
        }
      }),
  );

  it.effect(
    "tools/list leaves out what eve offers no agent on no task and in no repository: the plan's, the board's, the comments', and the checkout's",
    () =>
      Effect.gen(function* () {
        const fetch = yield* standing;
        const agent = yield* agentOnNoTaskWithBearer;
        const client = yield* connected(fetch, agent.bearer);

        const listed = yield* Effect.promise(() => client.listTools());
        yield* Effect.promise(() => client.close());

        const withheld = [
          "edit_plan",
          "look_at_picture",
          "draw_on_board",
          "look_at_board",
          "read_comments",
          "reply_to_comment",
          "resolve_thread",
          "reopen_thread",
          "open_pull_request",
          "show_code",
          "list_open_asks",
        ];
        assert.deepEqual(
          listed.tools.map((tool) => tool.name).sort(),
          SERVED_TOOLS.filter((name) => !withheld.includes(name)).sort(),
        );
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

  it.effect("every tool declares the most of its result Claude Code takes whole", () =>
    Effect.gen(function* () {
      const fetch = yield* standing;
      const agent = yield* agentWithBearer;
      const client = yield* connected(fetch, agent.bearer);

      const listed = yield* Effect.promise(() => client.listTools());
      yield* Effect.promise(() => client.close());

      assert.ok(listed.tools.length > 0);
      for (const tool of listed.tools) {
        assert.equal(tool._meta?.["anthropic/maxResultSizeChars"], 500_000, tool.name);
      }
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
    "each integration is a server of its own, listing its provider's tools and forwarding a call on the member's own grant, and one not connected refusing as requiring sign-in",
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
        const linear = yield* connected(fetch, agent.bearer, `${LUKE_INTEGRATION_MCP_PATH}/linear`);
        const notion = yield* connected(fetch, agent.bearer, `${LUKE_INTEGRATION_MCP_PATH}/notion`);

        const linearTools = yield* Effect.promise(() => linear.listTools());
        const drawn = yield* Effect.promise(() => linear.callTool({ name: "draw", arguments: {} }));
        const failed = yield* Effect.promise(() =>
          linear.callTool({ name: "fail", arguments: {} }),
        );
        const notionTools = yield* Effect.promise(() => notion.listTools());
        const unsigned = yield* Effect.promise(() =>
          notion.callTool({ name: "notion-search", arguments: {} }),
        );
        yield* Effect.promise(() => Promise.all([linear.close(), notion.close()]));

        assert.equal(linear.getServerVersion()?.name, "linear");
        assert.equal(linear.getInstructions(), INTEGRATION.linear.DESCRIPTION);
        assert.deepEqual(
          linearTools.tools.map((tool) => tool.name),
          ["list_issues", "create_issue", "fail", "draw", "attach"],
        );
        assert.equal(drawn.isError, undefined);
        assert.deepEqual(drawn.content, [
          { type: "text", text: "A chart:" },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
        ]);
        assert.equal(failed.isError, true);
        assert.deepEqual(notionTools.tools, []);
        assert.equal(unsigned.isError, true);
        assert.deepEqual(
          [firstJson(unsigned).connection, firstJson(unsigned).requiresSignIn],
          ["notion", true],
        );
      }),
  );

  it.effect(
    "an integration server refuses a request without the runner's bearer, and a path that names no integration is not found",
    () =>
      Effect.gen(function* () {
        const agent = yield* agentWithBearer;
        const fetch = yield* standing;
        const ask = (path: string, bearer: string | undefined) =>
          Effect.promise(() =>
            fetch(`${ORIGIN}${path}`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
              },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
            }),
          );

        const unbearered = yield* ask(`${LUKE_INTEGRATION_MCP_PATH}/linear`, undefined);
        const unknown = yield* ask(`${LUKE_INTEGRATION_MCP_PATH}/luke`, agent.bearer);

        assert.equal(unbearered.status, 401);
        assert.equal(unknown.status, 404);
      }),
  );

  it.effect(
    "browser drives the Chromium in the agent's sandbox, a screenshot coming back as image content and the tab kept under the agent's conversation",
    () =>
      Effect.gen(function* () {
        const peer = yield* fakeCdpPeer({
          pages: [{ targetId: "tab-1", url: "https://shop.test/", title: "Shop" }],
          answer: (command) => PAGE_ANSWERS[command.method],
        });
        const fetch = yield* standingOver(
          NO_SANDBOX,
          undefined,
          agentBrowserTestLayer(peer, SESSION),
        );
        const agent = yield* agentInSandbox;
        const client = yield* connected(fetch, agent.bearer);

        const called = yield* Effect.promise(() =>
          client.callTool({
            name: "browser",
            arguments: {
              actions: [
                { action: BROWSER_AGENT_ACTION.LIST },
                { action: BROWSER_AGENT_ACTION.SCREENSHOT, tab: "tab-1" },
              ],
            },
          }),
        );
        yield* Effect.promise(() => client.close());

        assert.equal(called.isError, false);
        // SAFETY: the server answers a browser call with text and image blocks (`tools.ts`'s `browserContent`).
        const content = called.content as readonly {
          type: string;
          text?: string;
          data?: string;
          mimeType?: string;
        }[];
        // One JSON block, which the native transcript reads whole, then the picture.
        assert.deepEqual(
          content.map((block) => block.type),
          ["text", "image"],
        );
        assert.deepEqual(content[1], { type: "image", data: "/9j/AAAA", mimeType: "image/jpeg" });
        assert.ok(
          content.every((block) => block.text === undefined || !block.text.includes("/9j/AAAA")),
        );
        assert.deepEqual(
          firstJson(called).steps.map((step: { action: string; status: string }) => [
            step.action,
            step.status,
          ]),
          [
            ["list", "done"],
            ["screenshot", "done"],
          ],
        );
        assert.deepEqual(
          (yield* listAgentBrowserTabs(agent.conversationId)).map((row) => row.targetId),
          ["tab-1"],
        );
      }),
  );

  it.effect("browser runs nothing for an agent whose conversation records no session", () =>
    Effect.gen(function* () {
      const fetch = yield* standing;
      const agent = yield* agentWithBearer;
      const client = yield* connected(fetch, agent.bearer);

      const called = yield* Effect.promise(() =>
        client.callTool({
          name: "browser",
          arguments: { actions: [{ action: BROWSER_AGENT_ACTION.LIST }] },
        }),
      );
      yield* Effect.promise(() => client.close());

      assert.equal(called.isError, true);
      assert.deepEqual(firstJson(called), {
        status: "not-run",
        reason: BROWSER_TOOL_REFUSAL.NO_SANDBOX,
      });
    }),
  );
});
