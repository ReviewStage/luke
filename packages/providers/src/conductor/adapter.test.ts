import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS, type SessionControl } from "@sidecar/session";
import type { JsonObject, JsonValue } from "@sidecar/wire/testing";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "@sidecar/wire/testing";
import { CLOUD_ADAPTER_DEFAULTS, type CloudFetch } from "../shared/cloud-session-adapter.js";
import { describeCloudAdapterContract } from "../testing/cloud-adapter-contract.js";
import { CONDUCTOR_PROVIDER, ConductorSessionAdapter } from "./adapter.js";

const TEST_TIME = Date.parse("2026-08-12T02:45:00.000Z");
const TEST_BASE_URL = "https://api.conductor.test";
const TEST_API_KEY = "conductor-test-key";
const TEST_USER_ID = "user-under-observation";
const OTHER_USER_ID = "another-user";
const TEST_SESSION_NAME = "Revamp the notch panel";
const TEST_WORKSPACE_NAME = "bucharest-v1";
const TEST_ERROR_MESSAGE = "The agent container ran out of memory";

const TEST_CONDUCTOR_STATUS = {
  IDLE: "idle",
  WORKING: "working",
  ERROR: "error",
} as const;

type TestProject = {
  id: string;
  name: string;
  gitRemote: string;
};

interface TestWorkspace {
  id: string;
  projectId: string;
  name: string;
  creatorId?: string;
  lastActivityAt: number;
  /** What the listing marks the workspace as; the real page always carries one. */
  state?: string;
  lifecycleStatus?: string;
  lifecycleErrorMessage?: string;
  lifecycleHttpStatus?: number;
}

interface TestSession {
  id: string;
  workspaceId: string;
  name: string;
  resolvedModel?: string;
  archivedAt?: string;
  status?: string;
  statusUpdatedAt?: number;
  statusHttpStatus?: number;
  lastError?: string;
  agentType?: string;
  /** What the documented transcript read holds for this session, in order. */
  storedMessages?: readonly JsonObject[];
  /** Misbehave: refuse the transcript read itself. */
  messagesHttpStatus?: number;
}

interface TestApi {
  userId?: string;
  projects: readonly TestProject[];
  workspaces: readonly TestWorkspace[];
  sessions: readonly TestSession[];
  /** Misbehave: answer a creation without naming the first session. */
  createWithoutSessionId?: boolean;
  /** Misbehave: refuse the transcripts-view read. */
  sqlHttpStatus?: number;
  /**
   * The page bound the transcript read enforces server-side, whatever limit
   * was asked for — the real endpoint caps at 100; a smaller cap here lets a
   * test walk several pages without hundreds of fixture messages.
   */
  messagesPageSize?: number;
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function page(data: readonly JsonValue[]): JsonObject {
  return { data, offset: 0, hasMore: false };
}

function workspacePayload(workspace: TestWorkspace, projects: readonly TestProject[]) {
  const payload: JsonObject = {
    id: workspace.id,
    name: workspace.name,
    state: workspace.state ?? "ready",
    repoUrl: projects.find((project) => project.id === workspace.projectId)?.gitRemote ?? "",
    createdAt: isoTimestamp(workspace.lastActivityAt),
    deepLink: `conductor://workspace?id=${workspace.id}`,
    lastActivityAt: isoTimestamp(workspace.lastActivityAt),
  };
  if (workspace.creatorId) {
    payload.creatorId = workspace.creatorId;
  }
  return payload;
}

function sessionPayload(session: TestSession) {
  const payload: JsonObject = {
    id: session.id,
    deepLink: `conductor://workspace?session=${session.id}`,
    name: session.name,
  };
  if (session.resolvedModel) {
    payload.resolvedModel = session.resolvedModel;
  }
  if (session.archivedAt) {
    payload.archivedAt = session.archivedAt;
  }
  return payload;
}

/** Serves the read-only subset of the public API the adapter is allowed to use. */
function fakeConductorApi(api: TestApi) {
  const createdSessionIds = new Set<string>();
  return recordingFetch((request) => {
    const { pathname, method, body: rawBody } = request;
    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (method === "POST") {
      // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
      // The transcripts view: the one read that rides as a POSTed document.
      if (segments[1] === "sql" && segments.length === 2) {
        if (api.sqlHttpStatus) return jsonResponse({}, api.sqlHttpStatus);
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        const body = JSON.parse(rawBody ?? "{}") as {
          query?: string;
        };
        const query = body.query ?? "";
        if (!query.startsWith("SELECT ")) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        const ids = [...query.matchAll(/'([^']*)'/g)].map((match) => match[1]);
        const rows = api.sessions
          .filter((session) => ids.includes(session.id))
          .map((session) => ({
            session_id: session.id,
            agent_type: session.agentType ?? null,
            // The view's own transcript column, answered whether or not the
            // document asked for it: a chat's words, which no observation
            // may carry.
            transcript: TEST_TRANSCRIPT_WORDS,
          }));
        return jsonResponse({ rows, rowCount: rows.length, truncated: false });
      }
      // The six documented writers: a prompt for one session, a cancel for
      // the turn it is working, a new workspace in one project, an archive
      // for one workspace, and a rename for one workspace or one chat.
      if (segments[1] === "workspaces" && segments.length === 4 && segments[3] === "archive") {
        const workspace = api.workspaces.find((candidate) => candidate.id === segments[2]);
        if (!workspace) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        return jsonResponse({ workspaceId: workspace.id, status: "archived" });
      }
      if (segments[1] === "workspaces" && segments.length === 4 && segments[3] === "rename") {
        const workspace = api.workspaces.find((candidate) => candidate.id === segments[2]);
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        const body = JSON.parse(rawBody ?? "{}") as { name?: string };
        if (!workspace || !body.name) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        return jsonResponse({ workspaceId: workspace.id, name: body.name });
      }
      if (segments[1] === "workspaces" && segments.length === 2) {
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        const body = JSON.parse(rawBody ?? "{}") as {
          projectId?: string;
        };
        if (!api.projects.some((project) => project.id === body.projectId)) {
          return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        }
        if (api.createWithoutSessionId) {
          return jsonResponse({ workspaceId: "workspace-new" }, 201);
        }
        createdSessionIds.add("session-new");
        return jsonResponse(
          {
            workspaceId: "workspace-new",
            sessionId: "session-new",
            deepLink: "conductor://workspace?id=workspace-new",
          },
          201,
        );
      }
      if (segments[1] === "sessions" && segments.length === 2) {
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        const body = JSON.parse(rawBody ?? "{}") as {
          workspaceId?: string;
          agent?: string;
        };
        const workspaceExists = api.workspaces.some(
          (workspace) => workspace.id === body.workspaceId,
        );
        if (!workspaceExists || !body.agent) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        return jsonResponse({ sessionId: "session-spawned", workspaceId: body.workspaceId }, 201);
      }
      const session =
        api.sessions.find((candidate) => candidate.id === segments[2]) ??
        (createdSessionIds.has(segments[2] ?? "") ? { id: segments[2] ?? "" } : undefined);
      const writer = segments[3];
      if (!session || segments[1] !== "sessions" || segments.length !== 4) {
        return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      }
      if (writer === "messages") {
        return jsonResponse({ messageId: "message-1", state: "queued" }, 201);
      }
      if (writer === "cancel") {
        return jsonResponse({ sessionId: session.id, status: "idle", canceledQueuedMessages: 0 });
      }
      if (writer === "rename") {
        // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
        const body = JSON.parse(rawBody ?? "{}") as { name?: string };
        if (!body.name) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        return jsonResponse({ sessionId: session.id, name: body.name });
      }
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }
    if (segments[0] === "me") {
      return jsonResponse(api.userId ? { userId: api.userId } : {});
    }
    if (segments[1] === "projects" && segments.length === 2) {
      return jsonResponse(page(api.projects));
    }
    if (segments[1] === "workspaces" && segments.length === 2) {
      const limit = Number(request.searchParams.get("limit") ?? "100");
      const offset = Number(request.searchParams.get("offset") ?? "0");
      // The real index hides archived work when asked to; a deleted
      // workspace stays in the page here so the adapter's own record check
      // answers for it. The creator filter is deliberately not honored: the
      // adapter's attribution check answers for whose workspaces these are.
      const listed = api.workspaces.filter(
        (workspace) =>
          request.searchParams.get("includeArchived") !== "false" || workspace.state !== "archived",
      );
      const rows = listed
        .slice(offset, offset + limit)
        .map((workspace) => workspacePayload(workspace, api.projects));
      return jsonResponse({ data: rows, offset, hasMore: offset + rows.length < listed.length });
    }
    if (segments[1] === "workspaces" && segments[3] === "sessions") {
      return jsonResponse(
        page(
          api.sessions.filter((session) => session.workspaceId === segments[2]).map(sessionPayload),
        ),
      );
    }
    if (segments[1] === "sessions" && segments[3] === "messages") {
      const session = api.sessions.find((candidate) => candidate.id === segments[2]);
      if (!session) return jsonResponse({}, HTTP_STATUS.NOT_FOUND);
      if (session.messagesHttpStatus) return jsonResponse({}, session.messagesHttpStatus);
      const stored = session.storedMessages ?? [];
      const after = request.searchParams.get("after");
      let start = Number(request.searchParams.get("offset") ?? "0");
      if (after !== null) {
        const index = stored.findIndex((message) => message.id === after);
        // The real store refuses a cursor it never issued.
        if (index < 0) return jsonResponse({}, HTTP_STATUS.NOT_FOUND);
        start = index + 1;
      }
      const pageBound = api.messagesPageSize ?? 100;
      const limit = Math.min(Number(request.searchParams.get("limit") ?? "100"), pageBound);
      const data = stored.slice(start, start + limit);
      return jsonResponse({
        data,
        offset: start,
        hasMore: start + data.length < stored.length,
      });
    }
    if (segments[1] === "workspaces" && segments[3] === "status") {
      const workspace = api.workspaces.find((candidate) => candidate.id === segments[2]);
      if (!workspace) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      if (workspace.lifecycleHttpStatus) return jsonResponse({}, workspace.lifecycleHttpStatus);
      const lifecycle: JsonObject = {
        workspaceId: workspace.id,
        status: workspace.lifecycleStatus ?? "ready",
        updatedAt: isoTimestamp(workspace.lastActivityAt),
      };
      if (workspace.lifecycleErrorMessage) {
        lifecycle.errorMessage = workspace.lifecycleErrorMessage;
      }
      return jsonResponse(lifecycle);
    }
    if (segments[1] === "sessions" && segments[3] === "status") {
      const session = api.sessions.find((candidate) => candidate.id === segments[2]);
      if (!session) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      if (session.statusHttpStatus) return jsonResponse({}, session.statusHttpStatus);
      const statusPayload: JsonObject = {
        workspaceId: session.workspaceId,
        sessionId: session.id,
        status: session.status ?? TEST_CONDUCTOR_STATUS.IDLE,
        updatedAt: isoTimestamp(session.statusUpdatedAt ?? TEST_TIME),
      };
      if (session.status === TEST_CONDUCTOR_STATUS.ERROR) {
        statusPayload.errorMessage = TEST_ERROR_MESSAGE;
      }
      if (session.lastError) {
        statusPayload.lastError = session.lastError;
      }
      return jsonResponse(statusPayload);
    }
    return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
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
): ConductorSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new ConductorSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

test("declares every provider operation on one adapter interface", () => {
  const adapter = adapterFor(async () => new Response("{}", { status: 200 }));
  assert.ok(adapter.sendMessage instanceof Function);
  assert.ok(adapter.executeControl instanceof Function);
  assert.ok(adapter.createWorkspace instanceof Function);
  assert.ok(adapter.spawnWorkspaceAgent instanceof Function);
});

const LUKE_PROJECT: TestProject = {
  id: "project-luke",
  name: "luke",
  gitRemote: "https://github.com/reviewstage/luke.git",
};

function ownedWorkspace(id: string, lastActivityAt: number): TestWorkspace {
  return {
    id,
    projectId: LUKE_PROJECT.id,
    name: TEST_WORKSPACE_NAME,
    creatorId: TEST_USER_ID,
    lastActivityAt,
  };
}

describeCloudAdapterContract("Conductor", (options) => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("contract-workspace", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "contract-session",
        workspaceId: "contract-workspace",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });
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

test("observes cloud sessions the signed-in user created, under their own names", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        resolvedModel: "claude-opus-5",
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(CONDUCTOR_PROVIDER, { id: "conductor", displayName: "Conductor" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-working");
  // Titled by the chat's own name, grouped under the workspace's — the name
  // the user knows the work by — and neither is a branch, so no branch is
  // reported at all. Conductor manages the workspace, so the grouping carries
  // its mark the way a Superset workspace carries Superset's.
  assert.equal(observations[0]?.title, TEST_SESSION_NAME);
  assert.deepEqual(observations[0]?.workspace, {
    providerWorkspaceId: "workspace-active",
    name: TEST_WORKSPACE_NAME,
    scopeId: "conductor",
    managerName: "Conductor",
  });
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.lastActivityAt, TEST_TIME - 5_000);
  // A working session can be stopped and can take a message, both documented.
  assert.deepEqual(observations[0]?.controls, [
    { id: "cancel-turn", label: "Stop this turn", kind: "stop" },
  ]);
  assert.equal(observations[0]?.canReceiveMessage, true);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    model: "claude-opus-5",
    link: "conductor://workspace?session=session-working",
  });
  assert.equal(
    api.requests.every((request) => request.method === "GET"),
    true,
  );
  assert.equal(
    api.requests.every((request) => request.authorization === `Bearer ${TEST_API_KEY}`),
    true,
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports an idle session as waiting and an errored session with its reason", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-errored", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: "session-errored",
        workspaceId: "workspace-errored",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[1]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[1]?.detail?.error, TEST_ERROR_MESSAGE);
});

test("words a workspace still being built onto its rows, ready and asleep say nothing", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        ...ownedWorkspace("workspace-building", TEST_TIME - 5_000),
        lifecycleStatus: "initializing",
      },
      {
        ...ownedWorkspace("workspace-rebuilding", TEST_TIME - 10_000),
        lifecycleStatus: "updating",
      },
      { ...ownedWorkspace("workspace-ready", TEST_TIME - 20_000) },
      { ...ownedWorkspace("workspace-asleep", TEST_TIME - 30_000), lifecycleStatus: "sleeping" },
    ],
    sessions: [
      { id: "chat-building", workspaceId: "workspace-building", name: TEST_SESSION_NAME },
      { id: "chat-rebuilding", workspaceId: "workspace-rebuilding", name: TEST_SESSION_NAME },
      { id: "chat-ready", workspaceId: "workspace-ready", name: TEST_SESSION_NAME },
      { id: "chat-asleep", workspaceId: "workspace-asleep", name: TEST_SESSION_NAME },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // A workspace being stood up or rebuilt is why its chat sits quiet, so the
  // row says so; a ready workspace is the normal case and a sleeping one is
  // Conductor's own economy, so neither takes the activity slot.
  assert.equal(byId.get("chat-building")?.detail?.activity, "Workspace initializing");
  assert.equal(byId.get("chat-rebuilding")?.detail?.activity, "Workspace updating");
  assert.equal(byId.get("chat-ready")?.detail?.activity, undefined);
  assert.equal(byId.get("chat-asleep")?.detail?.activity, undefined);
});

test("reports the failure that kept a workspace from coming up, behind the chat's own", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        ...ownedWorkspace("workspace-failed", TEST_TIME - 5_000),
        lifecycleStatus: "initializing",
        lifecycleErrorMessage: "The setup script exited with status 1",
      },
      {
        ...ownedWorkspace("workspace-both-failed", TEST_TIME - 10_000),
        lifecycleStatus: "ready",
        lifecycleErrorMessage: "The snapshot could not be restored",
      },
    ],
    sessions: [
      {
        id: "chat-quietly-failed",
        workspaceId: "workspace-failed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // A chat with a failure of its own is telling the user about the turn
      // they are watching, which outranks the machinery around it.
      {
        id: "chat-loudly-failed",
        workspaceId: "workspace-both-failed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(
    byId.get("chat-quietly-failed")?.detail?.error,
    "The setup script exited with status 1",
  );
  assert.equal(byId.get("chat-loudly-failed")?.detail?.error, TEST_ERROR_MESSAGE);
});

test("a failed lifecycle read costs the workspace's words, never the pass", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        ...ownedWorkspace("workspace-unreadable", TEST_TIME - 5_000),
        lifecycleStatus: "initializing",
        lifecycleHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
    ],
    sessions: [
      {
        id: "chat-unreadable",
        workspaceId: "workspace-unreadable",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(observations.length, 1);
  assert.equal(byId.get("chat-unreadable")?.detail?.activity, undefined);
  assert.equal(byId.get("chat-unreadable")?.status, SESSION_STATUS.WAITING);
});

const IDLE_SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const SECOND_IDLE_SESSION_UUID = "22222222-2222-4222-8222-222222222222";
const WORKING_SESSION_UUID = "33333333-3333-4333-8333-333333333333";
const ERRORED_SESSION_UUID = "44444444-4444-4444-8444-444444444444";
/** What the transcripts view holds for every chat and an observation never reports. */
const TEST_TRANSCRIPT_WORDS = "SECRET_TRANSCRIPT_WORDS";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reads each chat's agent kind from the transcripts view, and nothing else", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-second-idle", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        resolvedModel: "gpt-5.5",
        agentType: "codex",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // A settled chat with no model reported still names its agent kind.
      {
        id: SECOND_IDLE_SESSION_UUID,
        workspaceId: "workspace-second-idle",
        name: TEST_SESSION_NAME,
        agentType: "claude",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 2_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  const idle = observations.find((candidate) => candidate.providerSessionId === IDLE_SESSION_UUID);
  const secondIdle = observations.find(
    (candidate) => candidate.providerSessionId === SECOND_IDLE_SESSION_UUID,
  );
  // A mapped agent kind becomes the agent itself — the identity the row's
  // mark leads with — and the model rides plain beside it.
  assert.equal(idle?.detail?.model, "gpt-5.5");
  assert.deepEqual(idle?.agent, { id: "codex", displayName: "Codex" });
  assert.equal(secondIdle?.detail?.model, undefined);
  assert.deepEqual(secondIdle?.agent, { id: "claude-code", displayName: "Claude Code" });

  // One read document for the whole pass, fixed by the build: the SELECT this
  // build wrote, naming exactly the observed session ids and nothing else.
  const reads = api.requests.filter((request) => request.method === "POST");
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.pathname, "/v0/sql");
  assert.equal(reads[0]?.authorization, `Bearer ${TEST_API_KEY}`);
  // The view holds each chat's transcript too, and the document names no
  // column of it: an observation pass reads who runs the chat, never what
  // was said in it, so no observation carries a word of the conversation.
  const { query } = JSON.parse(reads[0]?.body ?? "");
  assert.equal(
    query,
    "SELECT session_id, agent_type FROM session_transcripts_view WHERE session_id IN " +
      `('${IDLE_SESSION_UUID}', '${SECOND_IDLE_SESSION_UUID}')`,
  );
  assert.doesNotMatch(query, /\btranscript\b/);
  assert.doesNotMatch(JSON.stringify(observations), new RegExp(TEST_TRANSCRIPT_WORDS));
});

test("reports the agent kind whatever state the chat is in", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-working", TEST_TIME - 30_000),
      ownedWorkspace("workspace-errored", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: WORKING_SESSION_UUID,
        workspaceId: "workspace-working",
        name: TEST_SESSION_NAME,
        agentType: "cursor",
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: ERRORED_SESSION_UUID,
        workspaceId: "workspace-errored",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 2);
  // The agent kind is configuration, not conversation, so it rides regardless.
  const working = observations.find(
    (candidate) => candidate.providerSessionId === WORKING_SESSION_UUID,
  );
  assert.deepEqual(working?.agent, { id: "cursor", displayName: "Cursor" });
});

test("keeps a session id that is not a UUID out of the read document", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-odd", TEST_TIME - 40_000),
    ],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // An id of a shape this build does not know may not enter the document.
      {
        id: "session'); DROP VIEW session_transcripts_view; --",
        workspaceId: "workspace-odd",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  await adapterFor(api.fetch).observe();

  const reads = api.requests.filter((request) => request.pathname === "/v0/sql");
  assert.equal(reads.length, 1);
  assert.ok(reads[0]?.body?.includes(IDLE_SESSION_UUID));
  assert.equal(reads[0]?.body?.includes("DROP"), false);

  // With no UUID ids at all there is nothing to ask, so nothing is asked.
  const uuidlessApi = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-odd", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-plain",
        workspaceId: "workspace-odd",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });
  await adapterFor(uuidlessApi.fetch).observe();
  assert.equal(
    uuidlessApi.requests.every((request) => request.method === "GET"),
    true,
  );
});

test("a refused transcripts read costs the agent kind, never the pass", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-idle", TEST_TIME - 30_000)],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        resolvedModel: "gpt-5.5",
        agentType: "codex",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
    sqlHttpStatus: HTTP_STATUS.SERVER_ERROR,
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.agent, undefined);
  assert.equal(observations[0]?.detail?.model, "gpt-5.5");

  // Even a credential refusal on this one endpoint costs only the agent kind: a
  // key an org scopes away from the query endpoint still reads the roster,
  // and only the roster reads may judge the credential.
  const scopedKeyApi = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-idle", TEST_TIME - 30_000)],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
    sqlHttpStatus: HTTP_STATUS.UNAUTHORIZED,
  });

  const scopedKeyObservations = await adapterFor(scopedKeyApi.fetch).observe();

  assert.equal(scopedKeyObservations.length, 1);
  assert.equal(scopedKeyObservations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(scopedKeyObservations[0]?.agent, undefined);
});

// Every chat of a workspace is its own row, so no chat has to speak for a
// sibling: a workspace holding a failure and work still running is two facts,
// and each row reports its own state, opens its own place, and carries the
// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
// workspace as the group a surface seats them together by.
test("reports every chat in a workspace, each grouped under it", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-shared", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-shared",
        name: "Revamp the notch panel",
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: "session-errored",
        workspaceId: "workspace-shared",
        name: "Chase the memory leak",
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(observations.length, 2);
  assert.equal(byId.get("session-working")?.title, "Revamp the notch panel");
  assert.equal(byId.get("session-working")?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get("session-errored")?.title, "Chase the memory leak");
  assert.equal(byId.get("session-errored")?.status, SESSION_STATUS.ERROR);
  // Each row opens its own chat, and both carry the same workspace group.
  assert.equal(
    byId.get("session-errored")?.detail?.link,
    "conductor://workspace?session=session-errored",
  );
  for (const observation of observations) {
    assert.deepEqual(observation.workspace, {
      providerWorkspaceId: "workspace-shared",
      name: TEST_WORKSPACE_NAME,
      scopeId: "conductor",
      managerName: "Conductor",
    });
    // The Conductor mark rides each chat as an app association carrying the
    // chat's own exact address, so the trailing mark opens the same place the
    // row does — and the address names the exact chat, so the association is
    // the session's own and its mark rides the row even inside the tray.
    assert.deepEqual(observation.applications, [
      {
        id: "conductor",
        displayName: "Conductor",
        scope: "session",
        link: observation.detail?.link,
      },
    ]);
  }
});

test("does not carry a past failure into a session that recovered", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-recovered",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
        lastError: "An earlier failure this session already got past",
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  // `lastError` is the last failure a session ever had, not its current state,
  // and the row puts an error ahead of everything else on it.
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.detail?.error, undefined);
});

test("keeps an errored session errored after it goes stale", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30 * 60 * 1000)],
    sessions: [
      {
        id: "session-errored",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 30 * 60 * 1000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  // A failure does not heal by going stale, unlike an idle chat.
  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
});

test("titles each chat by its own name and its group by the workspace's", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      { ...ownedWorkspace("workspace-one", TEST_TIME - 30_000), name: "lisbon-v2" },
      { ...ownedWorkspace("workspace-two", TEST_TIME - 40_000), name: "porto-v1" },
    ],
    sessions: [
      // The chat's name tells it from its siblings; the workspace's name — the
      // one the user chose or accepted — names the group around it.
      {
        id: "session-one",
        workspaceId: "workspace-one",
        name: "Revamp the notch panel",
        statusUpdatedAt: TEST_TIME - 5_000,
      },
      {
        id: "session-two",
        workspaceId: "workspace-two",
        name: "Observe Cursor cloud agents",
        statusUpdatedAt: TEST_TIME - 6_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.title),
    ["Revamp the notch panel", "Observe Cursor cloud agents"],
  );
  assert.deepEqual(
    observations.map((observation) => observation.workspace?.name),
    ["lisbon-v2", "porto-v1"],
  );
});

// Filing a chat away is how a user says that one conversation is done being
// watched, so it earns no row at all — however recently it was filed, and
// whatever it was doing when it was. Its open sibling keeps its own row, and
// the drop happens before the pass ever asks after the filed chat, so it
// costs no status request and never enters the transcripts read.
test("leaves a filed-away chat off the roster while its workspace stays", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-quieted", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-open",
        workspaceId: "workspace-quieted",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 10_000,
      },
      {
        id: "session-archived",
        workspaceId: "workspace-quieted",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 10_000),
        status: TEST_CONDUCTOR_STATUS.WORKING,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // The filed-away chat neither settles the workspace nor holds it open: the
  // open sibling's own settled turn is what offers the archive.
  assert.deepEqual(observations[0]?.controls, [
    { id: "archive-workspace", label: "Archive", kind: "archive", target: "workspace-quieted" },
  ]);
  // Dropped before it is ever asked for: the filed-away chat costs no status
  // request, not just no row.
  assert.equal(
    api.requests.some((request) => request.pathname.includes("session-archived")),
    false,
  );
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("keeps reporting a long turn as working", async () => {
  // Only waiting decays with age, so a turn that started an hour ago and is
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // still running must not read as stale.
  const startedAt = TEST_TIME - 60 * 60 * 1000;
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-long-turn", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-long-turn",
        workspaceId: "workspace-long-turn",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: startedAt,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.lastActivityAt, startedAt);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("does not treat a long-idle chat as waiting because its workspace is busy", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    // A workspace's activity timestamp moves whenever anything in it runs, so
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // it can read as fresh while the chat inside was walked away from hours
    // ago. Staleness has to be judged on the chat's own status timestamp.
    workspaces: [
      ownedWorkspace("workspace-busy", TEST_TIME - 1_000),
      ownedWorkspace("workspace-fresh", TEST_TIME - 2_000),
    ],
    sessions: [
      {
        id: "session-abandoned",
        workspaceId: "workspace-busy",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
      },
      {
        id: "session-just-finished",
        workspaceId: "workspace-fresh",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 20_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations[0]?.providerSessionId, "session-abandoned");
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observations[1]?.providerSessionId, "session-just-finished");
  assert.equal(observations[1]?.status, SESSION_STATUS.WAITING);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("adopts the provider's timestamp again the moment the chat's work moves", async () => {
  const walkedAwayAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const workspace = ownedWorkspace("workspace-resumed", walkedAwayAt);
  const chat: TestSession = {
    id: IDLE_SESSION_UUID,
    workspaceId: "workspace-resumed",
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: walkedAwayAt,
  };
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [workspace],
    sessions: [chat],
  });
  let now = TEST_TIME;
  const adapter = adapterFor(api.fetch, { now: () => now });
  await adapter.observe();

  // The user sends the woken chat a message: the status itself moves.
  now = TEST_TIME + 60_000;
  chat.status = TEST_CONDUCTOR_STATUS.WORKING;
  chat.statusUpdatedAt = now;
  workspace.lastActivityAt = now;
  const working = await adapter.observe();
  assert.equal(working[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(working[0]?.lastActivityAt, now);

  // The turn settles: freshly waiting, on the provider's own timestamp for
  // the settle.
  const settledAt = TEST_TIME + 120_000;
  now = settledAt + 5_000;
  chat.status = TEST_CONDUCTOR_STATUS.IDLE;
  chat.statusUpdatedAt = settledAt;
  const settled = await adapter.observe();
  assert.equal(settled[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(settled[0]?.lastActivityAt, settledAt);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a whole turn between passes reads as unmoved", async () => {
  // A short turn can start and settle inside one refresh interval, so both
  // passes read idle. Status and failure are the only facts compared, and
  // neither moved, so the wake-bumped timestamp is not adopted: the accepted
  // cost of reading no words of the conversation is that such a turn keeps
  // the moment already reported.
  const walkedAwayAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const workspace = ownedWorkspace("workspace-quick-turn", walkedAwayAt);
  const chat: TestSession = {
    id: IDLE_SESSION_UUID,
    workspaceId: "workspace-quick-turn",
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: walkedAwayAt,
  };
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [workspace],
    sessions: [chat],
  });
  let now = TEST_TIME;
  const adapter = adapterFor(api.fetch, { now: () => now });
  await adapter.observe();

  const settledAt = TEST_TIME + 60_000;
  now = settledAt + 5_000;
  chat.statusUpdatedAt = settledAt;
  workspace.lastActivityAt = settledAt;
  const settled = await adapter.observe();
  assert.equal(settled[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(settled[0]?.lastActivityAt, settledAt);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a chat with no readable status falls back to its workspace's moment", async () => {
  // The workspace's timestamp covers every sibling chat, so it stands only
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // while the chat's own status read says nothing, and yields to it after.
  const walkedAwayAt = TEST_TIME - 2 * 60 * 60 * 1000;
  const workspace = ownedWorkspace("workspace-first-unreadable", TEST_TIME - 1_000);
  const chat: TestSession = {
    id: IDLE_SESSION_UUID,
    workspaceId: "workspace-first-unreadable",
    name: TEST_SESSION_NAME,
    status: TEST_CONDUCTOR_STATUS.IDLE,
    statusUpdatedAt: walkedAwayAt,
    statusHttpStatus: HTTP_STATUS.SERVER_ERROR,
  };
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [workspace],
    sessions: [chat],
  });
  let now = TEST_TIME;
  const adapter = adapterFor(api.fetch, { now: () => now });

  const unreadable = await adapter.observe();
  assert.equal(unreadable[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(unreadable[0]?.lastActivityAt, workspace.lastActivityAt);

  now = TEST_TIME + 60_000;
  delete chat.statusHttpStatus;
  const readable = await adapter.observe();
  assert.equal(readable[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(readable[0]?.lastActivityAt, walkedAwayAt);
});

test("ignores workspaces created by another user and workspaces without a creator", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      {
        id: "workspace-teammate",
        projectId: LUKE_PROJECT.id,
        name: TEST_SESSION_NAME,
        creatorId: OTHER_USER_ID,
        lastActivityAt: TEST_TIME - 1_000,
      },
      {
        id: "workspace-unattributed",
        projectId: LUKE_PROJECT.id,
        name: TEST_SESSION_NAME,
        lastActivityAt: TEST_TIME - 1_000,
      },
    ],
    sessions: [
      { id: "session-teammate", workspaceId: "workspace-teammate", name: TEST_SESSION_NAME },
      {
        id: "session-unattributed",
        workspaceId: "workspace-unattributed",
        name: TEST_SESSION_NAME,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations, []);
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-teammate")),
    false,
  );
});

test("keeps a workspace untouched since the day before yesterday", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-yesterday", TEST_TIME - 48 * 60 * 60 * 1000)],
    sessions: [
      { id: "session-yesterday", workspaceId: "workspace-yesterday", name: TEST_SESSION_NAME },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-yesterday"],
  );
});

test("observes every workspace and chat the pages hold", async () => {
  const workspaces = Array.from({ length: 6 }, (_value, index) =>
    ownedWorkspace(`workspace-${index}`, TEST_TIME - index * 1_000),
  );
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces,
    sessions: workspaces.map((workspace, index) => ({
      id: `session-${index}`,
      workspaceId: workspace.id,
      name: TEST_SESSION_NAME,
      status: TEST_CONDUCTOR_STATUS.WORKING,
      statusUpdatedAt: TEST_TIME - 1_000,
    })),
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-0", "session-1", "session-2", "session-3", "session-4", "session-5"],
  );
});

test("keeps an old open workspace that newer pages would have crowded out", async () => {
  // The listing pages newest-first, so an open workspace can be older than a
  // whole page of newer work. Following the listing while it says more
  // remain is what keeps that workspace's chat a row; stopping at the first
  // page silently retired a conversation to spare a request.
  const workspaces = [
    ...Array.from({ length: 100 }, (_value, index) =>
      ownedWorkspace(`workspace-new-${index}`, TEST_TIME - index * 1_000),
    ),
    ownedWorkspace("workspace-old", TEST_TIME - 500_000),
  ];
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces,
    sessions: [
      {
        id: "session-old",
        workspaceId: "workspace-old",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-old"],
  );
  // The second page was asked for where the first said more remained, and
  // every page carried the documented filters: the user the same pass's
  // identity read reported, and no archived work.
  const listings = api.requests.filter(
    (request) => request.method === "GET" && request.pathname === "/v0/workspaces",
  );
  assert.equal(listings.length, 2);
  assert.equal(listings[0]?.searchParams.get("creator"), TEST_USER_ID);
  assert.equal(listings[0]?.searchParams.get("includeArchived"), "false");
  assert.equal(listings[1]?.searchParams.get("offset"), "100");
});

test("lets a crowded workspace keep every chat beside its quiet neighbour", async () => {
  const workspaces = [
    ownedWorkspace("workspace-crowded", TEST_TIME - 1_000),
    ownedWorkspace("workspace-quiet", TEST_TIME - 2_000),
  ];
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces,
    sessions: [
      ...Array.from({ length: 8 }, (_value, index) => ({
        id: `crowded-${index}`,
        workspaceId: "workspace-crowded",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      })),
      {
        id: "quiet-session",
        workspaceId: "workspace-quiet",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const observedIds = observations.map((observation) => observation.providerSessionId);

  // A crowded workspace costs no one anything: all of its chats are rows, and
  // its quiet neighbour's chat is one too.
  assert.equal(observedIds.filter((id) => id.startsWith("crowded-")).length, 8);
  assert.equal(observedIds.includes("quiet-session"), true);
  assert.equal(observations.length, 9);
});

test("keeps only the open chats of a workspace that also holds filed-away ones", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-mixed", TEST_TIME - 1_000)],
    sessions: [
      ...Array.from({ length: 4 }, (_value, index) => ({
        id: `closed-${index}`,
        workspaceId: "workspace-mixed",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 10_000),
      })),
      {
        id: "open-session",
        workspaceId: "workspace-mixed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  // The filed-away chats earn no rows; the one still open is the workspace's
  // only voice, and it reports its own state.
  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["open-session"],
  );
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("clears observations when Conductor rejects the API key", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-active",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });
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

test("keeps observing when one session's status cannot be read", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-unreadable",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        statusHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
      {
        id: "session-readable",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // One chat's unreadable status costs nobody a row: the readable sibling
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // reports what it knows, and the unreadable one stands as unknown rather
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // than being dropped as though it were not there.
  assert.equal(observations.length, 2);
  assert.equal(byId.get("session-readable")?.status, SESSION_STATUS.WORKING);
  assert.equal(byId.get("session-unreadable")?.status, SESSION_STATUS.UNKNOWN);
});

test("advertises a message for any open chat, a stop mid-turn, and an archive once settled", async () => {
  // One workspace per chat, so each state under test reads on its own row
  // without any sibling beside it.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-working", TEST_TIME - 31_000),
      ownedWorkspace("workspace-failed", TEST_TIME - 32_000),
    ],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
      {
        id: "session-working",
        workspaceId: "workspace-working",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 6_000,
      },
      {
        id: "session-failed",
        workspaceId: "workspace-failed",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 7_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(byId.get("session-idle")?.canReceiveMessage, true);
  assert.equal(byId.get("session-working")?.canReceiveMessage, true);
  // A failed chat is documented for no writer.
  assert.equal(byId.get("session-failed")?.canReceiveMessage, false);
  // A chat mid-turn offers its stop and nothing else; every chat of a settled,
  // still-open workspace — idle or failed — offers to file that workspace
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // away, each naming its own workspace as the target.
  assert.deepEqual(byId.get("session-working")?.controls, [
    { id: "cancel-turn", label: "Stop this turn", kind: "stop" },
  ]);
  for (const [sessionId, workspaceId] of [
    ["session-idle", "workspace-idle"],
    ["session-failed", "workspace-failed"],
  ] as const) {
    assert.deepEqual(byId.get(sessionId)?.controls, [
      { id: "archive-workspace", label: "Archive", kind: "archive", target: workspaceId },
    ]);
  }
});

test("keeps the archive off every chat of a workspace while a sibling works", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 6_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // The idle chat's own turn is settled, but the workspace an archive acts on
  // is not: filing it away would take the sibling's running turn with it, so
  // no row of this workspace offers the archive.
  assert.deepEqual(byId.get("session-working")?.controls, [
    { id: "cancel-turn", label: "Stop this turn", kind: "stop" },
  ]);
  assert.equal(byId.get("session-idle")?.controls, undefined);
});

test("keeps the archive off a workspace whose chat's state could not be read", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-unreadable",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        statusHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // An unread status is not a settled one: the chat stands as unknown rather
  // than being dropped, and a workspace not positively seen settled offers no
  // filing away — the turn Luke could not read may still be running.
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observations[0]?.controls, undefined);
});

test("leaves a filed-away workspace and its chats off the roster entirely", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      // Filing a workspace away is how a user says its chats are done being
      // watched, so nothing of it survives to the roster — this is also what
      // makes a press of the archive control actually clear the rows it
      // acted on, come the next pass. The listing marks it, and a page can
      // hold hundreds of these, so it must cost nothing further: judged by a
      // per-workspace read instead, one failed read on one long-archived
      // workspace resurrected rows the user had already filed away.
      {
        ...ownedWorkspace("workspace-filed", TEST_TIME - 30_000),
        state: "archived",
        // Misbehave behind the mark: the pass must never ask.
        lifecycleHttpStatus: HTTP_STATUS.SERVER_ERROR,
      },
      {
        ...ownedWorkspace("workspace-erased", TEST_TIME - 40_000),
        state: "deleted",
      },
      ownedWorkspace("workspace-open", TEST_TIME - 5_000),
    ],
    sessions: [
      {
        id: "session-closed",
        workspaceId: "workspace-filed",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 20_000),
      },
      {
        id: "session-open",
        workspaceId: "workspace-open",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // Dropped before its lifecycle or sessions are ever asked for: the
  // filed-away workspaces cost no requests, not just no rows.
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-filed")),
    false,
  );
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-erased")),
    false,
  );
});

test("leaves a workspace whose lifecycle stands archived off the roster", async () => {
  // A filing-away the listing has not caught up with still shows at the
  // lifecycle endpoint, and a listing state this build does not know says
  // nothing either way — in both cases the lifecycle read decides, so
  // every chat of a workspace actually archived is dropped rather than
  // standing gray forever.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      { ...ownedWorkspace("workspace-archived", TEST_TIME - 30_000), lifecycleStatus: "archived" },
      {
        ...ownedWorkspace("workspace-deleted", TEST_TIME - 40_000),
        state: "some-future-state",
        lifecycleStatus: "deleted",
      },
      ownedWorkspace("workspace-open", TEST_TIME - 5_000),
    ],
    sessions: [
      { id: "session-filed", workspaceId: "workspace-archived", name: TEST_SESSION_NAME },
      { id: "session-gone", workspaceId: "workspace-deleted", name: TEST_SESSION_NAME },
      {
        id: "session-open",
        workspaceId: "workspace-open",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // Dropped before its chats are ever asked for: the retired workspaces cost
  // one lifecycle read each and nothing more.
  assert.equal(
    api.requests.some((request) => request.pathname.endsWith("workspace-archived/sessions")),
    false,
  );
  assert.equal(
    api.requests.some((request) => request.pathname.includes("session-filed")),
    false,
  );
});

test("hands a user prompt to Conductor's documented message endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.sendMessage({
    providerSessionId: "session-idle",
    text: "Rebase onto main before continuing",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions/session-idle/messages");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    message: "Rebase onto main before continuing",
  });
});

test("stops a working turn through Conductor's cancel endpoint, sending no body", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.executeControl({
    providerSessionId: "session-working",
    control: { id: "cancel-turn", label: "Stop this turn", kind: "stop" },
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions/session-working/cancel");
  // Conductor documents no body for a cancel.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("archives the workspace the user saw through Conductor's archive endpoint, sending no body", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  // Deliberately without a target: the route must be built from the control
  // the adapter itself advertised, never from the caller's copy of it.
  const result = await adapter.executeControl({
    providerSessionId: "session-idle",
    control: { id: "archive-workspace", label: "Archive" },
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces/workspace-active/archive");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // Conductor documents no body for an archive.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
});

test("asks the slow deadline for an archive, whose answer waits on the workspace standing down", () => {
  // The route is protected — nothing outside the adapter builds one — so the
  // probe is a subclass reading its own seam. Archiving answers only once the
  // workspace is filed away, past the shared request bound, and a deadline
  // shorter than the act reports an archive that landed as one that may not
  // have.
  class ControlRouteProbe extends ConductorSessionAdapter {
    deadlineFor(control: SessionControl): number | undefined {
      return this.controlRoute("session-idle", control)?.timeoutMs;
    }
  }
  const probe = new ControlRouteProbe({
    readApiKey: async () => TEST_API_KEY,
    baseUrl: TEST_BASE_URL,
    fetch: async () => jsonResponse({}),
  });

  assert.equal(
    probe.deadlineFor({ id: "archive-workspace", label: "Archive", target: "workspace-active" }),
    CLOUD_ADAPTER_DEFAULTS.SLOW_REQUEST_TIMEOUT_MS,
  );
  // The turn's stop answers at once, so it rides the shared bound.
  assert.equal(probe.deadlineFor({ id: "cancel-turn", label: "Stop this turn" }), undefined);
});

test("refuses to archive a workspace no row advertised, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  // A working workspace advertised only the turn's stop, so an archive ask
  // has nothing behind it and no request exists — whatever target the caller
  // writes into their copy of the control.
  const result = await adapter.executeControl({
    providerSessionId: "session-working",
    control: {
      id: "archive-workspace",
      label: "Archive",
      target: "workspace-active",
    },
  });

  assert.deepEqual(result, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("renames the workspace behind an observed row through Conductor's rename endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  const observations = await adapter.observe();

  // Every open workspace is renameable, so the target rides every chat's
  // advertisement the way the spawn target does.
  assert.equal(observations[0]?.renameTarget, "workspace-active");

  const result = await adapter.renameWorkspace({
    providerSessionId: "session-idle",
    name: "Payments rollout",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces/workspace-active/rename");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? "{}"), { name: "Payments rollout" });
});

test("renames an observed chat itself through Conductor's session rename endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  const observations = await adapter.observe();

  // Any open chat is renameable, whatever its turn is doing.
  assert.equal(observations[0]?.canRename, true);

  const result = await adapter.renameSession({
    providerSessionId: "session-idle",
    name: "Payments audit",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions/session-idle/rename");
  assert.deepEqual(JSON.parse(write?.body ?? "{}"), { name: "Payments audit" });
});

test("refuses a chat rename for a session no pass observed, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const result = await adapter.renameSession({
    providerSessionId: "session-unseen",
    name: "Payments audit",
  });

  assert.deepEqual(result, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("refuses a rename for a session no pass observed, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const result = await adapter.renameWorkspace({
    providerSessionId: "session-unseen",
    name: "Payments rollout",
  });

  assert.deepEqual(result, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("refuses a rename name outside its bound, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const result = await adapter.renameWorkspace({
    providerSessionId: "session-idle",
    name: "n".repeat(81),
  });

  assert.deepEqual(result, {
    status: "rejected",
    reason: "That workspace name is empty or too long.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("offers the projects the last pass listed as places a workspace can be created", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const adapter = adapterFor(api.fetch);

  // Nothing is offered before observation, or after the credential goes: the
  // offer is the last pass's own project list and nothing longer-lived.
  assert.deepEqual(adapter.workspaceProjects(), []);
  await adapter.observe();
  assert.deepEqual(adapter.workspaceProjects(), [
    // Conductor makes an idle workspace happily, so the task is optional.
    { providerProjectId: LUKE_PROJECT.id, repository: "luke", taskSupport: "optional" },
  ]);
});

test("creates a workspace through Conductor's documented creation endpoint", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const named = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    name: "fix the notch panel",
  });

  // The acceptance names the session the response did, so the surface can
  // open the workspace once observation reports it — an id, never an address.
  assert.deepEqual(named, { status: "accepted", providerSessionId: "session-new" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    name: "fix the notch panel",
  });

  // Left unnamed, the ask carries no name at all: Conductor generates one, and
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // an empty field is not the same request as an absent one.
  const unnamed = await adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id });
  assert.deepEqual(unnamed, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), { projectId: LUKE_PROJECT.id });
});

test("an acceptance whose response names no session stays a plain acceptance", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
    createWithoutSessionId: true,
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id });

  // Nothing named means nothing to wait on: the workspace stands unopened
  // rather than correlated by a guess.
  assert.deepEqual(result, { status: "accepted" });
});

test("a chosen agent and model ride the creation, and an unlisted pairing does not", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // A selection the build's table lists is sent exactly as documented, the
  // effort riding along when one was chosen.
  const chosen = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    agentSelection: { agent: "claude", model: "sonnet", effort: "max" },
  });
  assert.deepEqual(chosen, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    agent: "claude",
    model: "sonnet",
    effort: "max",
  });

  // No effort chosen sends none, so Conductor's default effort stands.
  const effortless = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    agentSelection: { agent: "claude", model: "sonnet" },
  });
  assert.deepEqual(effortless, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    agent: "claude",
    model: "sonnet",
  });

  // A selection outside the table — a foreign model, or an effort its agent
  // does not document — is dropped whole rather than sent: the adapter
  // answers for its own writes, and Conductor's defaults stand instead.
  for (const agentSelection of [
    { agent: "claude", model: "gpt-5.5" },
    { agent: "claude", model: "sonnet", effort: "ultra" },
  ]) {
    const unlisted = await adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      agentSelection,
    });
    assert.deepEqual(unlisted, { status: "accepted", providerSessionId: "session-new" });
    assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
      projectId: LUKE_PROJECT.id,
    });
  }

  // No choice at all sends no agent and no model, so Conductor's own
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // defaults decide — an absent field is not the same request as a guessed one.
  await adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
  });
});

test("refuses a creation ask for a project the last pass did not list", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const unlisted = await adapter.createWorkspace({ providerProjectId: "project-unknown" });

  // No request exists for a project observation did not see.
  assert.deepEqual(unlisted, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(api.requests.length, requestsBefore);

  // A name outside its bound is refused before a request exists too.
  const overlong = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    name: "a".repeat(200),
  });
  assert.equal(overlong.status, "rejected");
  assert.equal(api.requests.length, requestsBefore);
});

test("hands an opening task to the first session the creation response names", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    task: "Add a smoke test for the panel motion",
  });

  assert.deepEqual(result, { status: "accepted", providerSessionId: "session-new" });
  // Two documented writes, in order: the creation, then the message to
  // exactly the session Conductor said it made.
  const writes = api.requests.filter((request) => request.method === "POST");
  assert.deepEqual(
    writes.map((request) => request.pathname),
    ["/v0/workspaces", "/v0/sessions/session-new/messages"],
  );
  assert.deepEqual(JSON.parse(writes[1]?.body ?? ""), {
    message: "Add a smoke test for the panel motion",
  });
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reports a workspace whose task could not be delivered as exactly that", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [],
    sessions: [],
    createWithoutSessionId: true,
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    task: "Add a smoke test",
  });

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The workspace stands, so claiming failure outright would be as wrong as
  // claiming success: the answer says which half landed.
  assert.equal(result.status, "rejected");
  assert.match(
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    (result as { reason?: string }).reason ?? "",
    /created, but its opening task was not delivered/,
  );
  // No message request was guessed at without a session to send it to.
  const writes = api.requests.filter((request) => request.method === "POST");
  assert.deepEqual(
    writes.map((request) => request.pathname),
    ["/v0/workspaces"],
  );
});

test("starts another agent in the workspace behind an observed row", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  const observations = await adapter.observe();

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The roster row says which agents its workspace can take, exactly as the
  // endpoint takes them.
  assert.deepEqual(observations[0]?.spawnableAgents, ["claude", "codex", "cursor"]);

  const result = await adapter.spawnWorkspaceAgent({
    providerSessionId: "session-idle",
    agent: "codex",
    name: "xyz feature",
    task: "Build the XYZ feature",
  });

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/sessions");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // The workspace is read back from the pass, and the opening task rides the
  // creation itself — Conductor documents the first message inline.
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    workspaceId: "workspace-active",
    agent: "codex",
    name: "xyz feature",
    message: "Build the XYZ feature",
  });
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a stored model rides a new agent only as the pairing the table lists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  // A model documented for the asked-for agent kind rides along, its effort
  // beside it when one was chosen.
  const listed = await adapter.spawnWorkspaceAgent({
    providerSessionId: "session-idle",
    agent: "codex",
    model: "gpt-5.6-sol",
    effort: "ultra",
  });
  assert.deepEqual(listed, { status: "accepted" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    workspaceId: "workspace-active",
    agent: "codex",
    model: "gpt-5.6-sol",
    effort: "ultra",
  });

  // A selection outside the table — the model documented for a different
  // agent, or an effort this one does not take — is dropped whole rather than
  // sent, so the asked-for kind starts on Conductor's own defaults instead of
  // erroring.
  for (const stored of [
    { model: "sonnet" },
    { model: "gpt-5.6-sol", effort: "not-a-level" },
  ] as const) {
    const mismatched = await adapter.spawnWorkspaceAgent({
      providerSessionId: "session-idle",
      agent: "codex",
      ...stored,
    });
    assert.deepEqual(mismatched, { status: "accepted" });
    assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
      workspaceId: "workspace-active",
      agent: "codex",
    });
  }
});

test("refuses to start an agent the row never listed, before any request exists", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  // An agent kind the observation did not list, and a session the pass did
  // not emit, are both nowhere to land.
  const unlisted = await adapter.spawnWorkspaceAgent({
    providerSessionId: "session-idle",
    agent: "acp",
  });
  const unobserved = await adapter.spawnWorkspaceAgent({
    providerSessionId: "session-unseen",
    agent: "claude",
  });

  assert.deepEqual(unlisted, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.deepEqual(unobserved, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

// --- Conversation reading ---

const CONVERSATION_WORKSPACE_ID = "workspace-conversation";
const STORED_MESSAGE_UUIDS = [
  "aaaaaaaa-0000-4000-8000-000000000001",
  "aaaaaaaa-0000-4000-8000-000000000002",
  "aaaaaaaa-0000-4000-8000-000000000003",
  "aaaaaaaa-0000-4000-8000-000000000004",
  "aaaaaaaa-0000-4000-8000-000000000005",
  "aaaaaaaa-0000-4000-8000-000000000006",
  "aaaaaaaa-0000-4000-8000-000000000007",
  "aaaaaaaa-0000-4000-8000-000000000008",
] as const;

function storedUserMessage(id: string, message: string, receivedAtMs: number): JsonObject {
  return {
    id,
    sessionId: IDLE_SESSION_UUID,
    sessionIndex: 1,
    type: "userMessage",
    content: { type: "userMessage", message },
    receivedAt: isoTimestamp(receivedAtMs),
  };
}

function storedAgentEvent(id: string, rawPayload: JsonObject, receivedAtMs: number): JsonObject {
  return {
    id,
    sessionId: IDLE_SESSION_UUID,
    sessionIndex: 2,
    type: "agent",
    content: { type: "agent", rawPayload },
    receivedAt: isoTimestamp(receivedAtMs),
  };
}

/** A conversation whose store holds every shape the parse must judge. */
function conversationApi(overrides: Partial<TestSession> = {}, api: Partial<TestApi> = {}) {
  return fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [{ ...ownedWorkspace(CONVERSATION_WORKSPACE_ID, TEST_TIME - 30_000) }],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: CONVERSATION_WORKSPACE_ID,
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
        storedMessages: [
          storedUserMessage(
            STORED_MESSAGE_UUIDS[0],
            "Fix the flaky roster test",
            TEST_TIME - 9_000,
          ),
          // Thinking alone is not the agent speaking, so no bubble may wear it.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[1],
            { type: "assistant", message: { content: [{ type: "thinking", thinking: "plan" }] } },
            TEST_TIME - 8_000,
          ),
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[2],
            {
              type: "assistant",
              message: {
                content: [
                  { type: "thinking", thinking: "quiet" },
                  { type: "text", text: "Looking at the test now." },
                  { type: "tool_use", name: "Bash", input: {} },
                  { type: "text", text: "It races the clock." },
                ],
              },
            },
            TEST_TIME - 7_000,
          ),
          // A Claude-shaped `user` event is tool output, not the developer.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[3],
            { type: "user", message: { content: [{ type: "tool_result", content: "ok" }] } },
            TEST_TIME - 6_000,
          ),
          // A Codex item still streaming has no words yet.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[4],
            { event: { type: "item.started", item: { type: "agentMessage", text: "" } } },
            TEST_TIME - 5_000,
          ),
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[5],
            {
              event: {
                type: "item.completed",
                item: { type: "agentMessage", text: "Fixed: the test now stubs the clock." },
              },
            },
            TEST_TIME - 4_000,
          ),
          // A completed command is a tool at work, not the agent speaking.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[6],
            {
              event: {
                type: "item.completed",
                item: { type: "commandExecution", command: "pnpm test" },
              },
            },
            TEST_TIME - 3_000,
          ),
          // A lifecycle event has no author a bubble can wear.
          storedAgentEvent(
            STORED_MESSAGE_UUIDS[7],
            { type: "system", subtype: "init" },
            TEST_TIME - 2_000,
          ),
        ],
        ...overrides,
      },
    ],
    ...api,
  });
}

test("reads an observed chat's conversation as the attributed words alone", async () => {
  const api = conversationApi();
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.readConversation({ providerSessionId: IDLE_SESSION_UUID });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.deepEqual(result.messages, [
    {
      id: STORED_MESSAGE_UUIDS[0],
      author: "user",
      text: "Fix the flaky roster test",
      receivedAt: TEST_TIME - 9_000,
    },
    {
      id: STORED_MESSAGE_UUIDS[2],
      author: "agent",
      text: "Looking at the test now.\n\nIt races the clock.",
      receivedAt: TEST_TIME - 7_000,
    },
    {
      id: STORED_MESSAGE_UUIDS[5],
      author: "agent",
      text: "Fixed: the test now stubs the clock.",
      receivedAt: TEST_TIME - 4_000,
    },
  ]);
  // The cursor names the newest stored message the page consumed — dropped
  // or kept — so the poll that follows resumes past the lifecycle noise too.
  assert.equal(result.lastMessageId, STORED_MESSAGE_UUIDS[7]);
  assert.equal(result.hasMore, false);
  // The whole transcript fit in one page, so the history starts at its start.
  assert.equal(result.firstOffset, 0);
  assert.equal(result.hasOlder, false);

  const read = api.requests.at(-1);
  assert.equal(read?.method, "GET");
  assert.equal(read?.pathname, `/v0/sessions/${IDLE_SESSION_UUID}/messages`);
  // The opening read seeks the end and pages backward: offsets, never `after`.
  assert.equal(read?.searchParams.get("after"), null);
  assert.equal(read?.searchParams.get("offset"), "0");
});

test("continues a conversation read behind the cursor its last answer handed back", async () => {
  const api = conversationApi();
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: STORED_MESSAGE_UUIDS[2],
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.deepEqual(
    result.messages.map((message) => message.id),
    [STORED_MESSAGE_UUIDS[5]],
  );
  assert.equal(result.lastMessageId, STORED_MESSAGE_UUIDS[7]);
  // A poll never looks backward, so it reports no history position.
  assert.equal(result.firstOffset, undefined);
  assert.equal(result.hasOlder, undefined);

  const read = api.requests.at(-1);
  assert.equal(read?.searchParams.get("after"), STORED_MESSAGE_UUIDS[2]);
});

test("a poll walks the store's pages to the fixed bounds and answers hasMore honestly", async () => {
  const api = conversationApi(undefined, { messagesPageSize: 3 });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: STORED_MESSAGE_UUIDS[0],
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  // The seven stored messages behind the cursor fit inside the page budget,
  // walked three at a time: the later pages ride the cursor the earlier
  // ones handed back.
  assert.deepEqual(
    result.messages.map((message) => message.id),
    [STORED_MESSAGE_UUIDS[2], STORED_MESSAGE_UUIDS[5]],
  );
  assert.equal(result.hasMore, false);
  const reads = api.requests.filter(
    (request) =>
      request.method === "GET" && request.pathname.endsWith(`${IDLE_SESSION_UUID}/messages`),
  );
  assert.equal(reads.length, 3);
  assert.equal(reads[0]?.searchParams.get("after"), STORED_MESSAGE_UUIDS[0]);
  assert.equal(reads[1]?.searchParams.get("after"), STORED_MESSAGE_UUIDS[3]);
  assert.equal(reads[2]?.searchParams.get("after"), STORED_MESSAGE_UUIDS[6]);
});

test("refuses a conversation read for anything the latest pass did not stand behind", async () => {
  const api = conversationApi();
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const unobserved = await adapter.readConversation({
    providerSessionId: "99999999-9999-4999-8999-999999999999",
  });
  const badCursor = await adapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: "not-a-message-id",
  });
  const badPosition = await adapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    beforeOffset: -3,
  });
  const bothPositions = await adapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: STORED_MESSAGE_UUIDS[0],
    beforeOffset: 100,
  });

  assert.deepEqual(unobserved, {
    status: "unsupported",
    reason: "That act is not supported by the latest observation.",
  });
  assert.deepEqual(badCursor, {
    status: "rejected",
    reason: "That conversation cursor is not one Conductor handed back.",
  });
  assert.deepEqual(badPosition, {
    status: "rejected",
    reason: "That conversation position is not one Conductor handed back.",
  });
  assert.deepEqual(bothPositions, {
    status: "rejected",
    reason: "A poll and a history read are different asks; a request names one position.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

// A transcript longer than one window: the opening read seeks the end and
// pages backward from it, and a scroll to the top continues from where the
// last page said it began.
const LONG_TRANSCRIPT_LENGTH = 120;

function longMessageUuid(index: number): string {
  return `cccccccc-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function longConversationApi() {
  return conversationApi({
    storedMessages: Array.from({ length: LONG_TRANSCRIPT_LENGTH }, (_, index) =>
      storedUserMessage(longMessageUuid(index), `message ${index}`, TEST_TIME - 100_000 + index),
    ),
  });
}

test("an opening read answers the latest page of a long transcript", async () => {
  const api = longConversationApi();
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const result = await adapter.readConversation({ providerSessionId: IDLE_SESSION_UUID });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  // One hundred-message window paged back from the end of 120: the newest
  // hundred stand, the page names where it began, and older history remains.
  assert.equal(result.messages.length, 100);
  assert.equal(result.messages[0]?.id, longMessageUuid(20));
  assert.equal(result.messages.at(-1)?.id, longMessageUuid(119));
  assert.equal(result.lastMessageId, longMessageUuid(119));
  assert.equal(result.firstOffset, 20);
  assert.equal(result.hasOlder, true);
  assert.equal(result.hasMore, false);
  // The seek and the page together stay within a bounded, `after`-free
  // request budget: probes and windows carry arithmetic offsets alone.
  const reads = api.requests.slice(requestsBefore);
  assert.ok(reads.length <= 20, `expected a bounded seek, saw ${reads.length} requests`);
  assert.ok(reads.every((request) => request.searchParams.get("after") === null));
});

test("a scroll to the top reads the history just before what the screen holds", async () => {
  const api = longConversationApi();
  const adapter = adapterFor(api.fetch);
  await adapter.observe();

  const result = await adapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    beforeOffset: 20,
  });

  assert.equal(result.status, "accepted");
  if (result.status !== "accepted") return;
  assert.equal(result.messages.length, 20);
  assert.equal(result.messages[0]?.id, longMessageUuid(0));
  assert.equal(result.messages.at(-1)?.id, longMessageUuid(19));
  assert.equal(result.firstOffset, 0);
  assert.equal(result.hasOlder, false);
  // History must never move the poll: an older page names no forward cursor.
  assert.equal(result.lastMessageId, undefined);

  const read = api.requests.at(-1);
  assert.equal(read?.searchParams.get("offset"), "0");
  assert.equal(read?.searchParams.get("limit"), "20");
});

test("refuses a conversation read for an observed id that is not a UUID", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-idle",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });
  const adapter = adapterFor(api.fetch);
  await adapter.observe();
  const requestsBefore = api.requests.length;

  const result = await adapter.readConversation({ providerSessionId: "session-idle" });

  assert.deepEqual(result, {
    status: "unsupported",
    reason: "That session's id is not a shape this build can read messages for.",
  });
  assert.equal(api.requests.length, requestsBefore);
});

test("a conversation read names what refused it without echoing the provider", async () => {
  const refusedKey = conversationApi({ messagesHttpStatus: HTTP_STATUS.UNAUTHORIZED });
  const refusedKeyAdapter = adapterFor(refusedKey.fetch);
  await refusedKeyAdapter.observe();
  const unauthorized = await refusedKeyAdapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
  });
  assert.deepEqual(unauthorized, {
    status: "rejected",
    reason: "Conductor rejected the configured API key.",
  });

  // A cursor the store no longer holds answers 404, which reads as the same
  // transient refusal any unreadable answer does — never a fresh guess.
  const staleCursor = conversationApi();
  const staleCursorAdapter = adapterFor(staleCursor.fetch);
  await staleCursorAdapter.observe();
  const stale = await staleCursorAdapter.readConversation({
    providerSessionId: IDLE_SESSION_UUID,
    afterMessageId: "bbbbbbbb-0000-4000-8000-00000000000b",
  });
  assert.deepEqual(stale, {
    status: "rejected",
    reason: "Conductor did not answer, so the conversation could not be read.",
  });
});
