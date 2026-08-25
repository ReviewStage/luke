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
/** The reads a creation offer is built from, present in every pass. */
const PROJECT_READ_PATHS = ["/v1/environments", "/v1/replica/repositories"];

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
  processing?: boolean;
  /** A pre-created harness slot: never touched since the engine made it. */
  untouched?: boolean;
  /** This chat's own retained tail, served when history is pinned to it. */
  historyEvents?: readonly JsonObject[];
}

interface TestWorkspace {
  id: string;
  name?: string;
  status?: string;
  repositoryUrl?: string;
  repositoryName?: string;
  omitRepositories?: boolean;
  branch?: string;
  pullRequestUrls?: readonly string[];
  createdAt: number;
  lastActivityAt?: number;
  codingAgent?: string;
  historyEvents?: readonly JsonObject[];
  refuseHistory?: boolean;
  chats?: readonly TestChat[];
}

interface TestEnvironment {
  id: string;
  name: string;
  repositoryId?: string;
  isGlobal?: boolean;
}

interface TestRepository {
  id: string;
  name: string;
  url: string;
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

/** Replicas' own normalized token accounting, the one cross-family model source. */
function contextUsage(provider: string, model: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 11_000),
    type: "context-usage",
    payload: {
      provider,
      source: `${provider}_context`,
      model,
      totalTokens: 1000,
      maxTokens: 10000,
    },
  };
}

function claudeToolUse(tool: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 7_000),
    type: "claude-assistant",
    payload: {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: tool, id: "tool-1", input: {} }] },
    },
  };
}

function claudeFailedResult(message?: string): JsonObject {
  return {
    timestamp: isoTimestamp(TEST_TIME - 6_000),
    type: "claude-result",
    payload: {
      type: "result",
      subtype: "error",
      is_error: true,
      ...(message ? { errors: [message] } : undefined),
    },
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

/** A chat as the awake detail read spells it, in snake_case. */
function detailChatPayload(chat: TestChat) {
  return {
    id: chat.id,
    provider: chat.provider ?? "claude",
    title: chat.title ?? "",
    created_at: isoTimestamp(chat.untouched ? chat.updatedAt : chat.updatedAt - 60_000),
    updated_at: isoTimestamp(chat.updatedAt),
    processing: chat.processing ?? false,
  };
}

/**
 * Serves the subset of the Replica API the adapter is allowed to use: the
 * organization's replica list, the awake detail read, the retained-history
 * read, the environments and repositories the creation offer is built from,
 * and the documented writes. The engine-backed chats list under
 * `/v1/replica/{id}/chats` — which wakes a sleeping workspace — and the
 * whole key-refusing `/v1/workspaces` family answer refusals, so a request
 * to either is a failure of the pass, not a route this fake forgot; a
 * workspace marked `refuseHistory` answers the conflict a pre-retention
 * engine answers.
 */
function fakeReplicasApi(
  workspaces: readonly TestWorkspace[],
  options: {
    environments?: readonly TestEnvironment[];
    repositories?: readonly TestRepository[];
  } = {},
) {
  return recordingFetch((request) => {
    const { pathname, searchParams, method } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    // Nothing under `/v1/workspaces` answers an API key in production —
    // verified live — so the fake refuses the family outright, and a request
    // to it is a failure of the pass, not a route this fake forgot.
    if (segments[0] === "v1" && segments[1] === "workspaces") {
      return jsonResponse({ error: "Invalid token" }, HTTP_STATUS.UNAUTHORIZED);
    }
    if (method === "GET" && pathname === "/v1/environments") {
      // Every organization has at least its Global environment, so the
      // organization id is always learnable from this read.
      const environments = options.environments ?? [{ id: "environment-global", name: "Global" }];
      return jsonResponse({
        environments: environments.map((environment) => ({
          id: environment.id,
          organization_id: "organization-reviewstage",
          name: environment.name,
          is_global: environment.isGlobal ?? false,
          repository_id: environment.repositoryId ?? null,
        })),
      });
    }
    if (method === "GET" && pathname === "/v1/replica/repositories") {
      return jsonResponse({
        repositories: (options.repositories ?? []).map((repository) => ({
          ...repository,
          default_branch: "main",
        })),
      });
    }
    if (method === "POST" && pathname === "/v1/replica") {
      const body = JSON.parse(request.body ?? "{}");
      if (!body.name || !body.message || !body.environment_id) {
        return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      }
      return jsonResponse({
        replica: workspacePayload({
          id: "workspace-created",
          name: body.name,
          status: TEST_STATUS.PREPARING,
          createdAt: TEST_TIME,
        }),
      });
    }
    if (
      method === "POST" &&
      segments.length === 4 &&
      segments[0] === "v1" &&
      segments[1] === "replica" &&
      (segments[3] === "messages" || segments[3] === "chats")
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
      const pinned = (workspace.chats ?? []).find(
        (chat) => chat.id === searchParams.get("chat_id"),
      );
      return jsonResponse({
        thread_id: null,
        events: [...(pinned?.historyEvents ?? workspace.historyEvents ?? [])],
        total: workspace.historyEvents?.length ?? 0,
        has_more: false,
        coding_agent: workspace.codingAgent ?? null,
        waking: null,
        senders: [],
      });
    }
    if (
      method === "GET" &&
      segments.length === 3 &&
      segments[0] === "v1" &&
      segments[1] === "replica"
    ) {
      const workspace = workspaces.find((candidate) => candidate.id === segments[2]);
      if (!workspace) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      return jsonResponse({
        replica: {
          ...workspacePayload(workspace),
          coding_agent: workspace.codingAgent ?? null,
          waking: null,
          chats: (workspace.chats ?? []).map(detailChatPayload),
          repository_statuses: workspace.branch
            ? [
                {
                  repository: workspace.repositoryName ?? "reviewstage/luke",
                  branch: workspace.branch,
                  default_branch: "main",
                  pr_urls: [],
                  start_hooks_completed: true,
                  git_diff: null,
                },
              ]
            : [],
        },
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
    desktopAppPresent?: () => boolean;
  } = {},
): ReplicasSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new ReplicasSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
    ...(overrides.desktopAppPresent
      ? { desktopAppPresent: overrides.desktopAppPresent }
      : undefined),
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

/** The paths a pass requested, with the standing project reads left out. */
function observedPaths(api: { requests: { pathname: string }[] }): string[] {
  return api.requests
    .map((request) => request.pathname)
    .filter((pathname) => !PROJECT_READ_PATHS.includes(pathname));
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
  // The row opens on the dashboard's own address for exactly this workspace,
  // composed from the observed id the way Conductor's deep link is, and the
  // Replicas mark rides as the app association carrying the same address.
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    link: "https://replicas.dev/home/workspace/workspace-active",
  });
  // Workspace-scoped, like Superset's: inside a tray the manager is named
  // once on the header, and only a lone chat's row keeps the chip.
  assert.deepEqual(observations[0]?.applications, [
    {
      id: "replicas",
      displayName: "Replicas",
      scope: "workspace",
      link: "https://replicas.dev/home/workspace/workspace-active",
    },
  ]);
});

test("addresses the desktop app while the OS has a handler for its scheme", async () => {
  const api = fakeReplicasApi([
    {
      id: "workspace-active",
      name: "fix-login-timeout",
      status: TEST_STATUS.ACTIVE,
      createdAt: TEST_TIME - 60_000,
      lastActivityAt: TEST_TIME - 30_000,
    },
  ]);
  // The deep link carries the dashboard path as the one query parameter the
  // app's handler reads, so it opens exactly the page the web address does.
  const desktopLink = "replicas://open?path=%2Fhome%2Fworkspace%2Fworkspace-active";
  let handlerRegistered = false;
  const adapter = adapterFor(api.fetch, { desktopAppPresent: () => handlerRegistered });

  const webPass = await adapter.observe();
  handlerRegistered = true;
  const desktopPass = await adapter.observe();

  // The probe answers per pass, so installing the app applies on the next
  // one, and the row and its mark always carry the same address.
  assert.equal(webPass[0]?.detail?.link, "https://replicas.dev/home/workspace/workspace-active");
  assert.equal(desktopPass[0]?.detail?.link, desktopLink);
  assert.equal(desktopPass[0]?.applications?.[0]?.link, desktopLink);
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

test("reads awake detail and history tails, never a waking or key-refused read", async () => {
  // The detail read is documented to wake a sleeping workspace, so it is
  // issued only for a workspace the same pass's list reported awake; nothing
  // under `/v1/workspaces` is asked at all, because that family answers only
  // the dashboard's session tokens; and an errored workspace has no retained
  // conversation worth asking for.
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
  // Every request pins the dated API version, as Replicas' own guide says to.
  assert.equal(list?.headers.get("x-replicas-api-version"), "2026-05-17");
  assert.deepEqual(observedPaths(api).slice(1).sort(), [
    "/v1/replica/workspace-one",
    "/v1/replica/workspace-one/history",
    "/v1/replica/workspace-two/history",
  ]);
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
});

test("reports each chat's own turn: processing works, idle holds, stale idle goes quiet", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-turns", TEST_TIME - 1_000),
      branch: "feature/login-timeout",
      chats: [
        { id: "chat-working", provider: "claude", updatedAt: TEST_TIME - 1_000, processing: true },
        { id: "chat-holding", provider: "codex", updatedAt: TEST_TIME - 2_000, processing: false },
        {
          id: "chat-walked-away",
          provider: "claude",
          updatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
          processing: false,
        },
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(byId.get("chat-working")?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get("chat-working")?.holdingForDeveloper, undefined);
  // An idle chat in an awake workspace has finished its turn and is holding
  // for the user, the way an idle Conductor chat is.
  assert.equal(byId.get("chat-holding")?.status, SESSION_STATUS.WAITING);
  assert.equal(byId.get("chat-holding")?.holdingForDeveloper, true);
  // Once the ask goes stale it stops calling.
  assert.equal(byId.get("chat-walked-away")?.status, SESSION_STATUS.UNKNOWN);
  // The working branch the detail read reported rides every chat of the
  // workspace.
  assert.equal(byId.get("chat-working")?.detail?.branch, "feature/login-timeout");
});

test("keeps the chats last seen awake once the workspace sleeps, touching nothing", async () => {
  // No key-answerable read lists a sleeping workspace's chats without waking
  // it — the chat registry answers only the dashboard's session tokens,
  // verified live — so the rows a workspace settles into are the chats its
  // awake detail last listed, drawn as settled.
  const workspaces: TestWorkspace[] = [
    {
      id: "workspace-shared",
      name: "fix-login-timeout",
      status: TEST_STATUS.ACTIVE,
      createdAt: TEST_TIME - 60_000,
      lastActivityAt: TEST_TIME - 1_000,
      chats: [
        {
          id: "chat-a",
          provider: "claude",
          title: "Fix the login timeout",
          updatedAt: TEST_TIME - 1_000,
        },
        {
          id: "chat-b",
          provider: "codex",
          title: "Port the fixtures",
          updatedAt: TEST_TIME - 2_000,
        },
      ],
    },
  ];
  const api = fakeReplicasApi(workspaces);
  const adapter = adapterFor(api.fetch);

  const awake = await adapter.observe();
  const workspace = workspaces[0];
  if (workspace) workspace.status = TEST_STATUS.SLEEPING;
  const asleep = await adapter.observe();

  assert.deepEqual(
    awake.map((observation) => observation.providerSessionId),
    ["chat-a", "chat-b"],
  );
  assert.deepEqual(
    asleep.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["chat-a", SESSION_STATUS.COMPLETE],
      ["chat-b", SESSION_STATUS.COMPLETE],
    ],
  );
  assert.equal(asleep[0]?.title, "Fix the login timeout");
  assert.deepEqual(asleep[0]?.agent, { id: "claude-code", displayName: "Claude Code" });
  assert.deepEqual(asleep[1]?.agent, { id: "codex", displayName: "Codex" });
  assert.deepEqual(asleep[0]?.workspace, {
    providerWorkspaceId: "workspace-shared",
    name: "fix-login-timeout",
    scopeId: "replicas",
    managerName: "Replicas",
  });
  // The detail read would wake a sleeping workspace, so the second pass
  // issued exactly one: the first pass's, while the workspace was awake.
  assert.equal(
    api.requests.filter((request) => request.pathname === "/v1/replica/workspace-shared").length,
    1,
  );
});

test("starts another agent through the documented chat and message endpoints", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-active", TEST_TIME - 1_000),
      chats: [
        {
          id: "chat-existing",
          provider: "claude",
          updatedAt: TEST_TIME - 1_000,
          processing: false,
        },
      ],
    },
  ]);
  const adapter = adapterFor(api.fetch);
  const observations = await adapter.observe();

  // Every documented agent kind is advertised, targeted at the workspace.
  assert.deepEqual(observations[0]?.spawnableAgents, [
    "claude",
    "codex",
    "cursor",
    "deepseek",
    "fx",
    "kimi",
    "opencode",
    "pi",
  ]);
  assert.equal(observations[0]?.spawnTarget, "workspace-active");

  // With an opening task the whole ask is one documented message send, which
  // takes the agent kind beside the developer's words.
  const withTask = await adapter.spawnWorkspaceAgent({
    providerSessionId: "chat-existing",
    agent: "codex",
    task: "Port the fixtures to the new shape",
  });
  assert.deepEqual(withTask, { status: "accepted" });
  const messageWrite = api.requests.at(-1);
  assert.equal(messageWrite?.pathname, "/v1/replica/workspace-active/messages");
  assert.deepEqual(JSON.parse(messageWrite?.body ?? ""), {
    message: "Port the fixtures to the new shape",
    coding_agent: "codex",
  });

  // Without one it is the documented chat creation.
  const withoutTask = await adapter.spawnWorkspaceAgent({
    providerSessionId: "chat-existing",
    agent: "opencode",
    name: "Refactor pass",
  });
  assert.deepEqual(withoutTask, { status: "accepted" });
  const chatWrite = api.requests.at(-1);
  assert.equal(chatWrite?.pathname, "/v1/replica/workspace-active/chats");
  assert.deepEqual(JSON.parse(chatWrite?.body ?? ""), {
    provider: "opencode",
    title: "Refactor pass",
  });

  // An agent kind the observation never listed is refused before a request.
  const refused = await adapter.spawnWorkspaceAgent({
    providerSessionId: "chat-existing",
    agent: "not-an-agent",
  });
  assert.deepEqual(refused, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
});

test("offers the reported environments as projects and creates a workspace in one", async () => {
  const api = fakeReplicasApi([activeWorkspace("workspace-existing", TEST_TIME - 1_000)], {
    environments: [
      { id: "environment-luke", name: "Luke", repositoryId: "repository-luke" },
      { id: "environment-unbound", name: "Scratch" },
      { id: "environment-global", name: "Global", isGlobal: true },
    ],
    repositories: [{ id: "repository-luke", name: "reviewstage/luke", url: TEST_REPOSITORY_URL }],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  // Environments are the projects, labelled by their bound repository — or
  // their own name when unbound — and the Global defaults bundle offers no
  // creation, matching the dashboard.
  assert.deepEqual(adapter.workspaceProjects(), [
    {
      providerProjectId: "environment-luke",
      repository: "luke",
      targetName: "Luke",
      taskSupport: "required",
    },
    { providerProjectId: "environment-unbound", repository: "Scratch", taskSupport: "required" },
  ]);

  const created = await adapter.createWorkspace({
    providerProjectId: "environment-luke",
    task: "Fix the login timeout and open a pull request",
  });

  assert.deepEqual(created, { status: "accepted", providerSessionId: "workspace-created" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v1/replica");
  // The required name is the developer's own words slugged the way the
  // dashboard slugs one; the task rides as the required initial message.
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    name: "fix-the-login-timeout-and-open-a-pull-request",
    message: "Fix the login timeout and open a pull request",
    environment_id: "environment-luke",
  });

  // A task-less ask is refused rather than a workspace created idle.
  const taskless = await adapter.createWorkspace({ providerProjectId: "environment-luke" });
  assert.equal(taskless.status, "rejected");
});

test("draws no row for the untouched chat slot the engine keeps per harness", async () => {
  // The detail read lists one pre-created slot per agent harness beside the
  // chats the user actually opened — observed live as eight rows where three
  // conversations existed. Each slot wears its harness's own name as a
  // default title, so the title says nothing; only never having been touched
  // tells a slot from a conversation.
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-slots", TEST_TIME - 1_000),
      chats: [
        // A used slot: the boot-time creation stamp, moved by its first use.
        { id: "chat-real", provider: "claude", title: "Claude Code", updatedAt: TEST_TIME - 1_000 },
        // A fresh real chat mid-first-turn: untouched timestamps, but its
        // turn is running, so it keeps its row.
        {
          id: "chat-fresh",
          provider: "codex",
          title: "Codex",
          updatedAt: TEST_TIME - 2_000,
          processing: true,
          untouched: true,
        },
        {
          id: "slot-cursor",
          provider: "cursor",
          title: "Cursor",
          updatedAt: TEST_TIME - 3_000,
          untouched: true,
        },
        {
          id: "slot-pi",
          provider: "pi",
          title: "Pi",
          updatedAt: TEST_TIME - 3_000,
          untouched: true,
        },
        {
          id: "slot-deepseek",
          provider: "deepseek",
          title: "DeepSeek Harness",
          updatedAt: TEST_TIME - 3_000,
          untouched: true,
        },
        {
          id: "slot-relay",
          provider: "relay",
          title: "Relay",
          updatedAt: TEST_TIME - 3_000,
          untouched: true,
        },
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["chat-real", "chat-fresh"],
  );
});

test("marks a workspace with the agent its retained history names", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-claude", TEST_TIME - 1_000),
      codingAgent: "claude",
    },
    {
      // A hosted agent with no adapter of its own still carries its own mark
      // and name.
      ...activeWorkspace("workspace-pi", TEST_TIME - 2_000),
      codingAgent: "pi",
    },
    {
      // A kind this build has no identity for rides the model slot in the
      // provider's own word instead, so it is not lost for lacking a mark.
      ...activeWorkspace("workspace-kimi", TEST_TIME - 3_000),
      codingAgent: "kimi",
    },
    activeWorkspace("workspace-unread", TEST_TIME - 4_000),
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations[0]?.agent, { id: "claude-code", displayName: "Claude Code" });
  assert.equal(observations[0]?.detail?.model, undefined);
  assert.deepEqual(observations[1]?.agent, { id: "pi", displayName: "Pi" });
  assert.equal(observations[1]?.detail?.model, undefined);
  assert.equal(observations[2]?.agent, undefined);
  assert.equal(observations[2]?.detail?.model, "kimi");
  assert.equal(observations[3]?.agent, undefined);
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

test("enriches each chat from its own tail: model, tool, failure, and recap", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-rich", TEST_TIME - 1_000),
      chats: [
        {
          // Mid-turn: the model Replicas' accounting names, and the tool the
          // current turn is running — no recap, because nothing has parted.
          id: "chat-running",
          provider: "claude",
          title: "Fix the login timeout",
          updatedAt: TEST_TIME - 1_000,
          processing: true,
          historyEvents: [
            contextUsage("claude", "claude-opus-5"),
            claudeAssistant("Looking at the failing test."),
            claudeToolUse("Bash"),
          ],
        },
        {
          // Settled: its own parting words, attributably its own.
          id: "chat-settled",
          provider: "claude",
          title: "Port the fixtures",
          updatedAt: TEST_TIME - 2_000,
          processing: false,
          historyEvents: [
            contextUsage("claude", "claude-opus-5"),
            claudeAssistant("Ported both fixtures to the new shape."),
            claudeResult(),
          ],
        },
        {
          // Failed: the turn's own words as the row's reason.
          id: "chat-failed",
          provider: "codex",
          title: "Codex",
          updatedAt: TEST_TIME - 3_000,
          processing: false,
          historyEvents: [
            contextUsage("codex", "gpt-5.6-sol"),
            claudeUser(SECRET_PROMPT_TEXT),
            claudeFailedResult("The sandbox ran out of disk"),
          ],
        },
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(byId.get("chat-running")?.detail?.model, "claude-opus-5");
  assert.equal(byId.get("chat-running")?.detail?.activity, "Bash");
  assert.equal(byId.get("chat-running")?.recap, undefined);
  assert.equal(byId.get("chat-settled")?.recap, "Ported both fixtures to the new shape.");
  // An idle chat's last tool is history, not activity.
  assert.equal(byId.get("chat-settled")?.detail?.activity, undefined);
  assert.equal(byId.get("chat-failed")?.detail?.model, "gpt-5.6-sol");
  assert.equal(byId.get("chat-failed")?.detail?.error, "The sandbox ran out of disk");
  assert.equal(JSON.stringify(observations).includes(SECRET_PROMPT_TEXT), false);
});

test("keeps a stale agent out of a workspace row the live detail names otherwise", async () => {
  // The detail names kimi — a kind with no identity — while the retained
  // events last showed a Claude turn: the live word wins whole, riding the
  // model slot, and no mark from the past poses as the present.
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-switched", TEST_TIME - 1_000),
      codingAgent: "kimi",
      historyEvents: [claudeAssistant("An earlier Claude turn."), claudeResult()],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.agent, undefined);
  assert.equal(observations[0]?.detail?.model, "kimi");
});

test("covers an errored workspace's cached chats with the lifecycle, not stale turns", async () => {
  const workspaces: TestWorkspace[] = [
    {
      ...activeWorkspace("workspace-fated", TEST_TIME - 1_000),
      chats: [
        {
          id: "chat-busy",
          provider: "claude",
          title: "Claude Code",
          updatedAt: TEST_TIME - 1_000,
          processing: true,
        },
        {
          id: "chat-other",
          provider: "codex",
          title: "Codex",
          updatedAt: TEST_TIME - 2_000,
          processing: false,
        },
      ],
    },
  ];
  const api = fakeReplicasApi(workspaces);
  const adapter = adapterFor(api.fetch);

  await adapter.observe();
  const workspace = workspaces[0];
  if (workspace) workspace.status = TEST_STATUS.ERROR;
  const errored = await adapter.observe();

  // The workspace can run no turn, so its newest chat carries the failure
  // and its sibling reads settled — never the turn state cached from before.
  assert.deepEqual(
    errored.map((observation) => [observation.providerSessionId, observation.status]),
    [
      ["chat-busy", SESSION_STATUS.ERROR],
      ["chat-other", SESSION_STATUS.COMPLETE],
    ],
  );
  assert.equal(errored[0]?.detail?.error, "The workspace failed to start or wake");
});

test("keeps last turn's failure off a chat already running again", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-retrying", TEST_TIME - 1_000),
      chats: [
        {
          // The new turn started before its first events landed, so the tail
          // still ends on the failed result; the working row stays quiet
          // about it.
          id: "chat-retrying",
          provider: "claude",
          title: "Claude Code",
          updatedAt: TEST_TIME - 1_000,
          processing: true,
          historyEvents: [claudeFailedResult("The sandbox ran out of disk")],
        },
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.detail?.error, undefined);
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
  // The refused history was not asked again while the workspace stood still;
  // the awake detail read keeps its every-pass cadence.
  assert.deepEqual(observedPaths(api).sort(), [
    "/v1/replica",
    "/v1/replica",
    "/v1/replica/workspace-active",
    "/v1/replica/workspace-active",
  ]);
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
    "https://replicas.dev/home/workspace/workspace-published",
  );
  assert.equal(observations[1]?.detail?.change, undefined);
});

test("reports the workspace's pull request on every chat, for the tray to say once", async () => {
  // The workspace's chats work one branch, so each chat reports the shared
  // change and the tray header hoists the chip once — the reports prove
  // themselves one change by their shared number.
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-shared", TEST_TIME - 1_000),
      pullRequestUrls: ["https://github.com/reviewstage/luke/pull/402"],
      chats: [
        { id: "chat-a", provider: "claude", title: "Claude Code", updatedAt: TEST_TIME - 1_000 },
        { id: "chat-b", provider: "codex", title: "Codex", updatedAt: TEST_TIME - 2_000 },
      ],
    },
  ]);

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.detail?.change),
    [
      "https://github.com/reviewstage/luke/pull/402",
      "https://github.com/reviewstage/luke/pull/402",
    ],
  );
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
    const { pathname } = new URL(url);
    if (pathname !== "/v1/replica") return jsonResponse({}, HTTP_STATUS.CONFLICT);
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

test("hands a chat row's message to its own chat", async () => {
  const api = fakeReplicasApi([
    {
      ...activeWorkspace("workspace-shared", TEST_TIME - 1_000),
      chats: [
        { id: "chat-newest", provider: "claude", updatedAt: TEST_TIME - 1_000, processing: false },
        { id: "chat-older", provider: "codex", updatedAt: TEST_TIME - 60_000, processing: false },
      ],
    },
  ]);
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

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
