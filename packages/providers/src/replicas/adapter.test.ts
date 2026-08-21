import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import type { JsonObject } from "@sidecar/wire/testing";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "@sidecar/wire/testing";
import type { CloudFetch } from "../shared/cloud-session-adapter.js";
import { describeCloudAdapterContract } from "../testing/cloud-adapter-contract.js";
import { REPLICAS_PROVIDER, ReplicasSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-21T02:45:00.000Z");
const TEST_BASE_URL = "https://replicas.test";
const TEST_API_KEY = "replicas-test-key";
const TEST_REPOSITORY_URL = "https://github.com/reviewstage/luke";
/** The developer's own words in the retained history, which must never leave it. */
const SECRET_PROMPT_TEXT = "SECRET_PROMPT_TEXT";

/** The documented workspace lifecycle, verified against the published OpenAPI. */
const TEST_STATUS = {
  PREPARING: "preparing",
  ACTIVE: "active",
  SLEEPING: "sleeping",
  ARCHIVED: "archived",
  ERROR: "error",
} as const;

interface TestChat {
  id: string;
  provider?: string;
  title?: string;
  updatedAt: number;
  parentChatId?: string;
}

interface TestWorkspace {
  id: string;
  name?: string;
  status?: string;
  repositoryUrl?: string;
  repositoryName?: string;
  omitRepositories?: boolean;
  pullRequestUrls?: readonly string[];
  createdAt: number;
  lastActivityAt?: number;
  codingAgent?: string;
  historyEvents?: readonly JsonObject[];
  refuseHistory?: boolean;
  chats?: readonly TestChat[];
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function claudeAssistant(text: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 10_000),
    type: "claude-assistant",
    payload: {
      type: "assistant",
      message: { content: [{ type: "text", text }] },
    },
  };
}

function claudeResult(): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 9_000),
    type: "claude-result",
    payload: { type: "result", subtype: "success" },
  };
}

/** Tool results travel as user events, and a prompt does too. */
function claudeUser(text: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 8_000),
    type: "claude-user",
    payload: { type: "user", message: { content: [{ type: "text", text }] } },
  };
}

function codexAssistant(text: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 10_000),
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
  };
}

function cursorAssistant(text: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 10_000),
    type: "cursor-assistant",
    payload: { text },
  };
}

function workspacePayload(workspace: TestWorkspace) {
  return {
    id: workspace.id,
    name: workspace.name ?? "fix-login-timeout",
    status: workspace.status ?? TEST_STATUS.ACTIVE,
    source: "dashboard",
    created_at: isoTimestamp(workspace.createdAt),
    last_activity_at:
      workspace.lastActivityAt === undefined ? null : isoTimestamp(workspace.lastActivityAt),
    repositories: workspace.omitRepositories
      ? []
      : [
          {
            id: "repository-id",
            name: workspace.repositoryName ?? "reviewstage/luke",
            url: workspace.repositoryUrl ?? TEST_REPOSITORY_URL,
          },
        ],
    pull_requests: (workspace.pullRequestUrls ?? []).map((url, index) => ({
      repository: workspace.repositoryName ?? "reviewstage/luke",
      number: index + 1,
      url,
    })),
  };
}

function conversationPayload(workspace: TestWorkspace, chat: TestChat) {
  return {
    chat_id: chat.id,
    workspace_id: workspace.id,
    workspace_name: workspace.name ?? "fix-login-timeout",
    workspace_status: workspace.status ?? TEST_STATUS.ACTIVE,
    workspace_source: "dashboard",
    workspace_created_at: isoTimestamp(workspace.createdAt),
    workspace_user_id: null,
    workspace_creator_email: null,
    environment_id: null,
    provider: chat.provider ?? null,
    title: chat.title ?? null,
    created_at: isoTimestamp(chat.updatedAt - 60_000),
    updated_at: isoTimestamp(chat.updatedAt),
    parent_chat_id: chat.parentChatId ?? null,
    senders: [],
  };
}

/**
 * Serves the subset of the Replica API the adapter is allowed to use: the
 * organization's replica list, the conversations read, the retained-history
 * read, and the documented message endpoint. The reads that wake a workspace
 * — `GET /v1/replica/{id}` and its chats list — are deliberately not served,
 * so a request to one is a failure of the pass, not a route this fake
 * forgot; a workspace marked `refuseHistory` answers the conflict a
 * pre-retention engine answers.
 */
function fakeReplicasApi(workspaces: readonly TestWorkspace[]) {
  return recordingFetch((request) => {
    const { pathname, searchParams, method } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (method === "GET" && pathname === "/v1/organization/conversations") {
      const workspace = workspaces.find(
        (candidate) => candidate.id === searchParams.get("workspace_id"),
      );
      const chats = workspace?.chats ?? [];
      return jsonResponse({
        conversations: workspace ? chats.map((chat) => conversationPayload(workspace, chat)) : [],
        total: chats.length,
        limit: Number(searchParams.get("limit") ?? "20"),
        next_cursor: null,
      });
    }
    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "v1" &&
      segments[1] === "replica" &&
      segments[3] === "messages"
    ) {
      const known = workspaces.some((workspace) => workspace.id === segments[2]);
      return known ? jsonResponse({ status: "sent" }) : jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }
    if (
      method === "GET" &&
      segments.length === 4 &&
      segments[0] === "v1" &&
      segments[1] === "replica" &&
      segments[3] === "history"
    ) {
      const workspace = workspaces.find((candidate) => candidate.id === segments[2]);
      if (!workspace || workspace.refuseHistory) {
        return jsonResponse({}, HTTP_STATUS.CONFLICT);
      }
      return jsonResponse({
        thread_id: null,
        events: [...(workspace.historyEvents ?? [])],
        total: workspace.historyEvents?.length ?? 0,
        has_more: false,
        coding_agent: workspace.codingAgent ?? null,
        waking: null,
        senders: [],
      });
    }
    if (
      method !== "GET" ||
      segments.length !== 2 ||
      segments[0] !== "v1" ||
      segments[1] !== "replica"
    ) {
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }

    // The documented list answers newest `created_at` first; the fake answers
    // in the order it was given so the adapter's own sort is what is tested.
    const limit = Number(searchParams.get("limit") ?? "10");
    const page = workspaces.slice(0, limit);
    return jsonResponse({
      replicas: page.map(workspacePayload),
      total: workspaces.length,
      page: 1,
      limit,
      total_pages: 1,
    });
  });
}

function adapterFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
  } = {},
): ReplicasSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new ReplicasSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

function activeWorkspace(id: string, lastActivityAt: number): TestWorkspace {
  return {
    id,
    status: TEST_STATUS.ACTIVE,
    createdAt: lastActivityAt - 60_000,
    lastActivityAt,
  };
}

describeCloudAdapterContract("Replicas", (options) => {
  const api = fakeReplicasApi([activeWorkspace("contract-workspace", TEST_TIME - 1_000)]);
  const fetch: CloudFetch = async (url, init) => {
    if (options.failRequests()) throw new Error("network unreachable");
    return api.fetch(url, init);
  };
  return {
    adapter: adapterFor(fetch, options),
    requestCount: () => api.requests.length,
    credentials: () =>
      api.requests
        .map((request) => request.authorization?.replace("Bearer ", ""))
        .filter((credential): credential is string => credential !== undefined),
  };
});

test("declares every provider operation on one adapter interface", () => {
  const adapter = adapterFor(async () => new Response("{}", { status: 200 }));
  assert.ok(adapter.sendMessage instanceof Function);
  assert.ok(adapter.executeControl instanceof Function);
  assert.ok(adapter.createWorkspace instanceof Function);
  assert.ok(adapter.spawnWorkspaceAgent instanceof Function);
});

test("observes an active workspace titled by the name Replicas gave it", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-active",
      name: "fix-login-timeout",
      status: TEST_STATUS.ACTIVE,
      createdAt: TEST_TIME - 60_000,
      lastActivityAt: TEST_TIME - 30_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(REPLICAS_PROVIDER, { id: "replicas", displayName: "Replicas" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "workspace-active");
  assert.equal(observations[0]?.title, "fix-login-timeout");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 30_000);
  assert.equal(observations[0]?.controls, undefined);
  // The row opens on the dashboard's own address for exactly this workspace,
  // composed from the observed id the way Conductor's deep link is, and the
  // Replicas mark rides as the app association carrying the same address.
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    link: "https://tryreplicas.com/home/workspace/workspace-active",
  });
  assert.deepEqual(observations[0]?.applications, [
    {
      id: "replicas",
      displayName: "Replicas",
      scope: "session",
      link: "https://tryreplicas.com/home/workspace/workspace-active",
    },
  ]);
});

test("falls back to the repository for a workspace the list did not name", async () => {
  const api = fakeReplicasApi([
    { id: "workspace-unnamed", name: "", createdAt: TEST_TIME - 1_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.title, "luke");
  assert.equal(observations[0]?.detail?.repository, "luke");
});

test("stands archived workspaces behind no row, the way the dashboard hides them", async () => {
  const api = fakeReplicasApi([
    activeWorkspace("workspace-open", TEST_TIME - 1_000),
    { id: "workspace-filed", status: TEST_STATUS.ARCHIVED, createdAt: TEST_TIME - 2_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["workspace-open"],
  );
});

test("reads the pass from the list, chats, and history tails, never a waking read", async () => {
  // `GET /v1/replica/{id}` and its chats list are documented to wake a
  // sleeping workspace, so the pass is answerable from the list, the
  // conversations read, and the retained history alone — the fake refuses
  // everything else.
  const api = fakeReplicasApi([
    activeWorkspace("workspace-one", TEST_TIME - 1_000),
    { id: "workspace-two", status: TEST_STATUS.SLEEPING, createdAt: TEST_TIME - 2_000 },
    { id: "workspace-three", status: TEST_STATUS.ERROR, createdAt: TEST_TIME - 3_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 3);
  const list = api.requests[0];
  assert.equal(list?.pathname, "/v1/replica");
  assert.equal(list?.search, "?limit=100");
  assert.equal(list?.method, "GET");
  assert.equal(list?.authorization, `Bearer ${TEST_API_KEY}`);
  // Chats and history are read for the active and the sleeping workspace; an
  // errored one has no retained conversation worth asking for.
  assert.deepEqual(
    api.requests
      .slice(1)
      .map((request) => request.pathname)
      .sort(),
    [
      "/v1/organization/conversations",
      "/v1/organization/conversations",
      "/v1/replica/workspace-one/history",
      "/v1/replica/workspace-two/history",
    ],
  );
  const conversations = api.requests.find(
    (request) => request.pathname === "/v1/organization/conversations",
  );
  assert.equal(conversations?.search.includes("workspace_id=workspace-"), true);
  assert.equal(api.requests.at(-1)?.search, "?limit=40");
});

test("reads a workspace's history once until its activity moves", async () => {
  const workspaces = [activeWorkspace("workspace-cached", TEST_TIME - 1_000)];
  const api = fakeReplicasApi(workspaces);
  const adapter = adapterFor(api.fetch);

  await adapter.observe();
  await adapter.observe();
  const unchanged = api.requests.filter((request) => request.pathname.endsWith("/history")).length;

  const touched = workspaces[0];
  if (touched) touched.lastActivityAt = TEST_TIME - 500;
  await adapter.observe();
  const moved = api.requests.filter((request) => request.pathname.endsWith("/history")).length;

  assert.equal(unchanged, 1);
  assert.equal(moved, 2);
});

test("maps every status Replicas reports onto a state Luke can show", async () => {
  const api = fakeReplicasApi(
    (
      [
        [TEST_STATUS.PREPARING, "preparing"],
        [TEST_STATUS.ACTIVE, "active"],
        [TEST_STATUS.SLEEPING, "sleeping"],
        [TEST_STATUS.ERROR, "error"],
        ["some-later-status", "later-status"],
      ] as const
    ).map(([status, name], index) => ({
      id: `workspace-${name}`,
      status,
      createdAt: TEST_TIME - (index + 1) * 1_000,
      lastActivityAt: TEST_TIME - (index + 1) * 1_000,
    })),
  );

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["workspace-preparing", SESSION_STATUS.WORKING],
      ["workspace-active", SESSION_STATUS.WORKING],
      ["workspace-sleeping", SESSION_STATUS.COMPLETE],
      ["workspace-error", SESSION_STATUS.ERROR],
      ["workspace-later-status", SESSION_STATUS.UNKNOWN],
    ],
  );
  // The list projection never says a chat is holding for the user, so no row
  // may claim to be.
  assert.equal(
    observations.some((observation) => observation.holdingForDeveloper === true),
    false,
  );
});

test("marks a workspace with the agent its retained history names", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-claude", TEST_TIME - 1_000),
      codingAgent: "claude",
    },
    {
      // A kind this build has no identity for rides the model slot in the
      // provider's own word instead, so it is not lost for lacking a mark.
      ...activeWorkspace("workspace-pi", TEST_TIME - 2_000),
      codingAgent: "pi",
    },
    activeWorkspace("workspace-unread", TEST_TIME - 3_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations[0]?.agent, { id: "claude-code", displayName: "Claude Code" });
  assert.equal(observations[0]?.detail?.model, undefined);
  assert.equal(observations[1]?.agent, undefined);
  assert.equal(observations[1]?.detail?.model, "pi");
  assert.equal(observations[2]?.agent, undefined);
});

test("derives the agent from the retained events when none is currently active", async () => {
  // `coding_agent` names the *currently active* agent, so a settled workspace
  // answers null — but every documented event family wears its agent on the
  // event type itself, so the newest placeable event still says whose
  // conversation this is.
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-claude-events", TEST_TIME - 1_000),
      historyEvents: [claudeAssistant("Reading the failing test first.")],
    },
    {
      ...activeWorkspace("workspace-codex-events", TEST_TIME - 2_000),
      historyEvents: [codexAssistant("Ported the fixture to the new shape.")],
    },
    {
      // fx and Kimi Code share the ACP family, told apart by the payload's
      // own provider field; kimi has no mark, so it rides the model slot.
      ...activeWorkspace("workspace-acp-events", TEST_TIME - 3_000),
      historyEvents: [
        {
          timestamp: isoTimestamp(TEST_TIME - 10_000),
          type: "acp-session-update",
          payload: { provider: "kimi", update: {} },
        },
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations[0]?.agent, { id: "claude-code", displayName: "Claude Code" });
  assert.deepEqual(observations[1]?.agent, { id: "codex", displayName: "Codex" });
  assert.equal(observations[2]?.agent, undefined);
  assert.equal(observations[2]?.detail?.model, "kimi");
});

test("reports the parting words as the recap once the turn actually parted", async () => {
  const api = fakeReplicasApi([
    {
      // The result event closes the turn, so the words may speak while the
      // workspace is still awake.
      ...activeWorkspace("workspace-settled", TEST_TIME - 1_000),
      codingAgent: "claude",
      historyEvents: [
        claudeUser(SECRET_PROMPT_TEXT),
        claudeAssistant("Renamed the flag and updated both call sites."),
        claudeResult(),
      ],
    },
    {
      // No result yet: the words are mid-turn, half a sentence posing as an
      // outcome, so the active row keeps quiet.
      ...activeWorkspace("workspace-mid-turn", TEST_TIME - 2_000),
      codingAgent: "claude",
      historyEvents: [claudeAssistant("Starting by reading the failing test")],
    },
    {
      // An event after the result is the next turn already moving, so the
      // words in hand are the previous turn's, not parting ones.
      ...activeWorkspace("workspace-asked-again", TEST_TIME - 3_000),
      codingAgent: "claude",
      historyEvents: [
        claudeAssistant("Done. The fixture now covers both paths."),
        claudeResult(),
        claudeUser(SECRET_PROMPT_TEXT),
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.recap, "Renamed the flag and updated both call sites.");
  assert.equal(observations[1]?.recap, undefined);
  assert.equal(observations[2]?.recap, undefined);
  // The developer's own words in the history never leave it: the recap is the
  // agent's message alone, and no prompt or tool result reaches a row.
  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("treats a sleeping workspace as settled enough for its parting words", async () => {
  const sleptAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const api = fakeReplicasApi([
    {
      id: "workspace-asleep",
      status: TEST_STATUS.SLEEPING,
      createdAt: sleptAt - 60_000,
      lastActivityAt: sleptAt,
      codingAgent: "codex",
      // Codex documents no turn-completion marker in this stream, so its
      // words wait for the sleep that proves the turn is over.
      historyEvents: [codexAssistant("Opened PR 17 with the schema migration.")],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
  assert.deepEqual(observations[0]?.agent, { id: "codex", displayName: "Codex" });
  assert.equal(observations[0]?.recap, "Opened PR 17 with the schema migration.");
});

test("refuses a recap from an event family whose payload is not specified", async () => {
  const sleptAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeReplicasApi([
    {
      id: "workspace-cursor",
      status: TEST_STATUS.SLEEPING,
      createdAt: sleptAt - 60_000,
      lastActivityAt: sleptAt,
      codingAgent: "cursor",
      // Replicas documents Cursor payload sub-shapes as not yet specified, so
      // words are refused rather than guessed out of them.
      historyEvents: [cursorAssistant("looks plausible but unspecified")],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations[0]?.agent, { id: "cursor", displayName: "Cursor" });
  assert.equal(observations[0]?.recap, undefined);
});

test("keeps the pass when a workspace's history is refused", async () => {
  const api = fakeReplicasApi([
    { ...activeWorkspace("workspace-refused", TEST_TIME - 1_000), refuseHistory: true },
    {
      ...activeWorkspace("workspace-read", TEST_TIME - 2_000),
      codingAgent: "opencode",
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.agent, undefined);
  assert.deepEqual(observations[1]?.agent, { id: "opencode", displayName: "OpenCode" });
});

test("keeps the roster when the history endpoint refuses the credential", async () => {
  // The list already answered under this key, so a history refusal is that
  // endpoint's answer about itself, never a judgment on the key: it must not
  // clear the roster the list just served — and it would answer the same way
  // until the workspace moves, so that workspace's history is not asked for
  // again before it does.
  const api = fakeReplicasApi([activeWorkspace("workspace-active", TEST_TIME - 1_000)]);
  const gatedFetch: CloudFetch = async (url, init) =>
    new URL(url).pathname.endsWith("/history")
      ? jsonResponse({}, HTTP_STATUS.FORBIDDEN)
      : api.fetch(url, init);
  const adapter = adapterFor(gatedFetch);

  const first = await adapter.observe();
  const second = await adapter.observe();

  assert.equal(first.length, 1);
  assert.equal(first[0]?.agent, undefined);
  assert.equal(second.length, 1);
  // Only the lists and the one chats read reached the fake: the refused
  // history was not asked again while the workspace stood still.
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/replica", "/v1/organization/conversations", "/v1/replica"],
  );
});

test("lists a workspace's chats as their own rows under one workspace tray", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-shared", TEST_TIME - 1_000),
      name: "fix-login-timeout",
      pullRequestUrls: ["https://github.com/reviewstage/luke/pull/402"],
      codingAgent: "claude",
      historyEvents: [
        claudeAssistant("Renamed the flag and updated both call sites."),
        claudeResult(),
      ],
      chats: [
        {
          id: "chat-older",
          provider: "codex",
          title: "Port the fixtures",
          updatedAt: TEST_TIME - 60_000,
        },
        {
          id: "chat-newest",
          provider: "claude",
          title: "Fix the login timeout",
          updatedAt: TEST_TIME - 1_000,
        },
        // A spawned sub-agent's chat is the parent's work, so it draws no row.
        {
          id: "chat-spawned",
          provider: "claude",
          updatedAt: TEST_TIME - 500,
          parentChatId: "chat-newest",
        },
      ],
    },
  ]);
  const adapter = adapterFor(api.fetch);

  const observations = await adapter.observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["chat-newest", "chat-older"],
  );
  // Each chat leads with its own agent and title; the workspace's name rides
  // the grouping, so the tray names all of its chats at once.
  assert.equal(observations[0]?.title, "Fix the login timeout");
  assert.deepEqual(observations[0]?.agent, { id: "claude-code", displayName: "Claude Code" });
  assert.equal(observations[1]?.title, "Port the fixtures");
  assert.deepEqual(observations[1]?.agent, { id: "codex", displayName: "Codex" });
  assert.deepEqual(observations[0]?.workspace, {
    providerWorkspaceId: "workspace-shared",
    name: "fix-login-timeout",
    scopeId: "replicas",
    managerName: "Replicas",
  });
  assert.deepEqual(observations[1]?.workspace, observations[0]?.workspace);
  // The workspace's compute lifecycle is the newest chat's status — the
  // platform's activity is wherever the latest words landed — while an older
  // chat's turn ended back at its own timestamp.
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[1]?.status, SESSION_STATUS.COMPLETE);
  // The settled recap and the workspace's pull request ride the newest chat
  // once rather than every row repeating them.
  assert.equal(observations[0]?.recap, "Renamed the flag and updated both call sites.");
  assert.equal(observations[1]?.recap, undefined);
  assert.equal(observations[0]?.detail?.change, "https://github.com/reviewstage/luke/pull/402");
  assert.equal(observations[1]?.detail?.change, undefined);
  // The history read was pinned to the newest chat, so the parting words are
  // attributably that chat's.
  const history = api.requests.find((request) => request.pathname.endsWith("/history"));
  assert.equal(history?.search.includes("chat_id=chat-newest"), true);

  const result = await adapter.sendMessage({
    providerSessionId: "chat-older",
    text: "Pick this back up",
  });
  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.pathname, "/v1/replica/workspace-shared/messages");
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    message: "Pick this back up",
    chat_id: "chat-older",
  });
});

test("keeps workspace rows when the conversations read refuses the credential", async () => {
  // The conversations read answers organization keys alone, so a personal
  // key is refused identically every pass: the chat listing stands down for
  // the credential's lifetime, and the workspace rows stand.
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-active", TEST_TIME - 1_000),
      codingAgent: "claude",
      chats: [{ id: "chat-unlisted", provider: "claude", updatedAt: TEST_TIME - 1_000 }],
    },
  ]);
  const gatedFetch: CloudFetch = async (url, init) =>
    new URL(url).pathname === "/v1/organization/conversations"
      ? jsonResponse({}, HTTP_STATUS.FORBIDDEN)
      : api.fetch(url, init);
  const adapter = adapterFor(gatedFetch);

  const first = await adapter.observe();
  const second = await adapter.observe();

  assert.deepEqual(
    first.map((observation) => observation.providerSessionId),
    ["workspace-active"],
  );
  assert.deepEqual(first[0]?.agent, { id: "claude-code", displayName: "Claude Code" });
  assert.equal(second.length, 1);
  // The refused conversations read was asked exactly once; the history read
  // still ran, unpinned, because the chats were never listed.
  assert.deepEqual(
    api.requests.map((request) => request.pathname),
    ["/v1/replica", "/v1/replica/workspace-active/history", "/v1/replica"],
  );
  assert.equal(api.requests[1]?.search.includes("chat_id"), false);
});

test("orders the pass by latest activity rather than by creation", async () => {
  // The documented list answers newest `created_at` first, but a workspace
  // created yesterday can be the one active now, so the pass sorts by the
  // same activity timestamp the rows report.
  const api = fakeReplicasApi([
    { id: "workspace-created-late", createdAt: TEST_TIME - 1_000 },
    activeWorkspace("workspace-touched-now", TEST_TIME - 500),
    { id: "workspace-created-early", createdAt: TEST_TIME - 3_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["workspace-touched-now", "workspace-created-late", "workspace-created-early"],
  );
});

test("reports the newest pull request as the workspace's published change", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-published",
      pullRequestUrls: [
        "https://github.com/reviewstage/luke/pull/402",
        "https://github.com/reviewstage/luke/pull/405",
      ],
      createdAt: TEST_TIME - 1_000,
    },
    { id: "workspace-unpublished", createdAt: TEST_TIME - 2_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.detail?.change, "https://github.com/reviewstage/luke/pull/405");
  // The pull request is the row's published work, never its address: a press
  // on the row lands on the workspace itself.
  assert.equal(
    observations[0]?.detail?.link,
    "https://tryreplicas.com/home/workspace/workspace-published",
  );
  assert.equal(observations[1]?.detail?.change, undefined);
});

test("reports why an errored workspace stopped rather than leaving it idle", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-error",
      status: TEST_STATUS.ERROR,
      createdAt: TEST_TIME - 1_000,
      lastActivityAt: TEST_TIME - 1_000,
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.detail?.error, "The workspace failed to start or wake");
});

test("drops a workspace it cannot place in time without losing the rest of the pass", async () => {
  const fetch: CloudFetch = async (url) => {
    if (new URL(url).pathname.endsWith("/history")) {
      return jsonResponse({}, HTTP_STATUS.CONFLICT);
    }
    return jsonResponse({
      replicas: [
        { status: TEST_STATUS.ACTIVE, created_at: isoTimestamp(TEST_TIME - 1_000) },
        { id: "workspace-undated", status: TEST_STATUS.ACTIVE },
        workspacePayload({ id: "workspace-dated", createdAt: TEST_TIME - 1_000 }),
      ],
    });
  };

  const observations = await adapterFor(fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["workspace-dated"],
  );
});

test("clears observations when Replicas rejects the API key", async () => {
  const api = fakeReplicasApi([activeWorkspace("workspace-active", TEST_TIME - 1_000)]);
  let rejectRequests = false;
  const gatedFetch: CloudFetch = async (url, init) =>
    rejectRequests ? jsonResponse({}, HTTP_STATUS.UNAUTHORIZED) : api.fetch(url, init);
  const adapter = adapterFor(gatedFetch);

  const authorized = await adapter.observe();
  rejectRequests = true;
  const rejected = await adapter.observe();

  assert.equal(authorized.length, 1);
  assert.deepEqual(rejected, []);
});

test("advertises a message only for the statuses Replicas documents taking one", async () => {
  const api = fakeReplicasApi([
    { id: "workspace-active", status: TEST_STATUS.ACTIVE, createdAt: TEST_TIME - 1_000 },
    { id: "workspace-sleeping", status: TEST_STATUS.SLEEPING, createdAt: TEST_TIME - 2_000 },
    { id: "workspace-preparing", status: TEST_STATUS.PREPARING, createdAt: TEST_TIME - 3_000 },
    { id: "workspace-error", status: TEST_STATUS.ERROR, createdAt: TEST_TIME - 4_000 },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const messageable = new Map(
    observations.map((entry) => [entry.providerSessionId, entry.canReceiveMessage]),
  );

  assert.equal(messageable.get("workspace-active"), true);
  // A sleeping workspace is documented to wake when interacted with, an act
  // the user's own send performs knowingly.
  assert.equal(messageable.get("workspace-sleeping"), true);
  // How a preparing or errored workspace handles a message is documented
  // nowhere, so neither is promised one.
  assert.equal(messageable.get("workspace-preparing"), false);
  assert.equal(messageable.get("workspace-error"), false);
});

test("hands a user message to Replicas through its documented message endpoint", async () => {
  const api = fakeReplicasApi([
    { id: "workspace-active", status: TEST_STATUS.ACTIVE, createdAt: TEST_TIME - 1_000 },
  ]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "workspace-active",
    text: "Use the existing fixture instead",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/replica/workspace-active/messages");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // The body carries the developer's words and nothing else: no agent choice,
  // no chat target, no mode flag — the workspace's own defaults stand.
  assert.deepEqual(JSON.parse(write?.body ?? ""), { message: "Use the existing fixture instead" });
});
