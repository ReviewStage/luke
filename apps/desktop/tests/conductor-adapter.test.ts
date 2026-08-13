import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import type { CloudFetch } from "../src/cloud-session-adapter";
import { CONDUCTOR_PROVIDER, ConductorSessionAdapter } from "../src/conductor-adapter";

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

const HTTP_STATUS = {
  OK: 200,
  UNAUTHORIZED: 401,
  SERVER_ERROR: 500,
} as const;

interface TestProject {
  id: string;
  name: string;
  gitRemote: string;
}

interface TestWorkspace {
  id: string;
  projectId: string;
  name: string;
  creatorId?: string;
  lastActivityAt: number;
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
}

interface TestApi {
  userId?: string;
  projects: readonly TestProject[];
  workspaces: readonly TestWorkspace[];
  sessions: readonly TestSession[];
}

interface RecordedRequest {
  method: string;
  pathname: string;
  authorization: string | undefined;
}

interface FakeConductorApi {
  fetch: CloudFetch;
  requests: RecordedRequest[];
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function jsonResponse(body: unknown, status = HTTP_STATUS.OK): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function page(data: readonly unknown[]): unknown {
  return { data, offset: 0, hasMore: false };
}

function workspacePayload(workspace: TestWorkspace): Record<string, unknown> {
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: isoTimestamp(workspace.lastActivityAt),
    deepLink: `conductor://workspace?id=${workspace.id}`,
    lastActivityAt: isoTimestamp(workspace.lastActivityAt),
    ...(workspace.creatorId ? { creatorId: workspace.creatorId } : {}),
  };
}

function sessionPayload(session: TestSession): Record<string, unknown> {
  return {
    id: session.id,
    deepLink: `conductor://workspace?session=${session.id}`,
    name: session.name,
    ...(session.resolvedModel ? { resolvedModel: session.resolvedModel } : {}),
    ...(session.archivedAt ? { archivedAt: session.archivedAt } : {}),
  };
}

/** Serves the read-only subset of the public API the adapter is allowed to use. */
function fakeConductorApi(api: TestApi): FakeConductorApi {
  const requests: RecordedRequest[] = [];
  const fetch: CloudFetch = async (url, init) => {
    const { pathname } = new URL(url);
    const headers = new Headers(init.headers);
    requests.push({
      method: init.method ?? "",
      pathname,
      authorization: headers.get("authorization") ?? undefined,
    });

    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    if (segments[0] === "me") {
      return jsonResponse(api.userId ? { userId: api.userId } : {});
    }
    if (segments[1] === "projects" && segments.length === 2) {
      return jsonResponse(page(api.projects));
    }
    if (segments[1] === "projects" && segments[3] === "workspaces") {
      return jsonResponse(
        page(
          api.workspaces
            .filter((workspace) => workspace.projectId === segments[2])
            .map(workspacePayload),
        ),
      );
    }
    if (segments[1] === "workspaces" && segments[3] === "sessions") {
      return jsonResponse(
        page(
          api.sessions.filter((session) => session.workspaceId === segments[2]).map(sessionPayload),
        ),
      );
    }
    if (segments[1] === "sessions" && segments[3] === "status") {
      const session = api.sessions.find((candidate) => candidate.id === segments[2]);
      if (!session) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      if (session.statusHttpStatus) return jsonResponse({}, session.statusHttpStatus);
      return jsonResponse({
        workspaceId: session.workspaceId,
        sessionId: session.id,
        status: session.status ?? TEST_CONDUCTOR_STATUS.IDLE,
        updatedAt: isoTimestamp(session.statusUpdatedAt ?? TEST_TIME),
        ...(session.status === TEST_CONDUCTOR_STATUS.ERROR
          ? { errorMessage: TEST_ERROR_MESSAGE }
          : {}),
      });
    }
    return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
  };
  return { fetch, requests };
}

function adapterFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
    maximumObservedWorkspaces?: number;
    maximumObservedSessions?: number;
  } = {},
): ConductorSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new ConductorSessionAdapter({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
    ...(overrides.maximumObservedWorkspaces === undefined
      ? {}
      : { maximumObservedWorkspaces: overrides.maximumObservedWorkspaces }),
    ...(overrides.maximumObservedSessions === undefined
      ? {}
      : { maximumObservedSessions: overrides.maximumObservedSessions }),
  });
}

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
  assert.equal(observations[0]?.title, TEST_SESSION_NAME);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 5_000);
  assert.equal(observations[0]?.controls, undefined);
  assert.deepEqual(observations[0]?.detail, {
    repository: "luke",
    branch: TEST_WORKSPACE_NAME,
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

test("reports an idle session as waiting and an errored session with its reason", async () => {
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
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: "session-errored",
        workspaceId: "workspace-active",
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

test("separates sessions that share one project by their own names", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-one", TEST_TIME - 30_000),
      ownedWorkspace("workspace-two", TEST_TIME - 40_000),
    ],
    sessions: [
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
});

test("reports an archived session as complete without requesting its status", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-archived",
        workspaceId: "workspace-active",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 20_000),
        status: TEST_CONDUCTOR_STATUS.WORKING,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.COMPLETE);
  // The archive time is when the chat settled; the workspace timestamp would
  // date it by whatever a sibling chat did since.
  assert.equal(observations[0]?.observedAt, TEST_TIME - 20_000);
  assert.equal(
    api.requests.some((request) => request.pathname.endsWith("/status")),
    false,
  );
});

test("drops a long-closed chat instead of letting a busy workspace make it look recent", async () => {
  // A closed chat carries no timestamp of its own except archivedAt. Falling
  // back to the workspace timestamp would make a chat closed days ago read as
  // freshly complete whenever a sibling chat is active — and let it spend a
  // budget slot a live session needed.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-busy", TEST_TIME - 5_000),
      ownedWorkspace("workspace-quiet", TEST_TIME - 60_000),
    ],
    sessions: [
      {
        id: "session-closed-days-ago",
        workspaceId: "workspace-busy",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 3 * 24 * 60 * 60 * 1000),
      },
      {
        id: "session-open",
        workspaceId: "workspace-quiet",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 30_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch, { maximumObservedSessions: 1 }).observe();

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
});

test("keeps reporting a long turn as working", async () => {
  // Conductor stamps a status with the moment it was entered, so a turn that
  // started an hour ago and is still running must not read as stale.
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
  assert.equal(observations[0]?.observedAt, startedAt);
});

test("does not treat a long-idle chat as waiting because its workspace is busy", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    // One workspace holds several chats, so its activity timestamp moves
    // whenever any one of them runs.
    workspaces: [ownedWorkspace("workspace-busy", TEST_TIME - 1_000)],
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
        workspaceId: "workspace-busy",
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

test("ignores workspaces older than the maximum session age", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-yesterday", TEST_TIME - 48 * 60 * 60 * 1000)],
    sessions: [
      { id: "session-yesterday", workspaceId: "workspace-yesterday", name: TEST_SESSION_NAME },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.deepEqual(observations, []);
});

test("bounds the workspaces and sessions a single pass observes", async () => {
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

  const observations = await adapterFor(api.fetch, {
    maximumObservedWorkspaces: 3,
    maximumObservedSessions: 2,
  }).observe();

  assert.equal(observations.length, 2);
  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-0", "session-1"],
  );
});

test("spreads a bounded session budget across workspaces", async () => {
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

  assert.equal(observedIds.filter((id) => id.startsWith("crowded-")).length, 4);
  assert.equal(observedIds.includes("quiet-session"), true);
});

test("prefers open chats over closed ones inside one workspace", async () => {
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

  assert.equal(observations[0]?.providerSessionId, "open-session");
  assert.equal(observations.length, 4);
});

test("reports nothing and issues no request without an API key", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 1_000)],
    sessions: [{ id: "session-active", workspaceId: "workspace-active", name: TEST_SESSION_NAME }],
  });

  const observations = await adapterFor(api.fetch, { apiKey: undefined }).observe();

  assert.deepEqual(observations, []);
  assert.deepEqual(api.requests, []);
});

test("reports nothing when the credential cannot be read", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-active", TEST_TIME - 1_000)],
    sessions: [{ id: "session-active", workspaceId: "workspace-active", name: TEST_SESSION_NAME }],
  });
  const adapter = adapterFor(api.fetch, {
    readApiKey: async () => {
      throw new Error("settings are unreadable");
    },
  });

  assert.deepEqual(await adapter.observe(), []);
  assert.deepEqual(api.requests, []);
});

test("reuses the previous snapshot inside the minimum refresh interval", async () => {
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
  let now = TEST_TIME;
  const adapter = adapterFor(api.fetch, {
    now: () => now,
    minimumRefreshIntervalMs: 15_000,
  });

  const first = await adapter.observe();
  const requestsAfterFirstPass = api.requests.length;
  now = TEST_TIME + 5_000;
  const throttled = await adapter.observe();
  const requestsAfterThrottledPass = api.requests.length;
  now = TEST_TIME + 20_000;
  const refreshed = await adapter.observe();

  assert.equal(first.length, 1);
  assert.deepEqual(throttled, first);
  assert.equal(
    requestsAfterThrottledPass,
    requestsAfterFirstPass,
    "throttled pass issued requests",
  );
  assert.ok(api.requests.length > requestsAfterThrottledPass, "refreshed pass issued no request");
  assert.equal(refreshed.length, 1);
});

test("observes again immediately after the API key changes", async () => {
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
  let apiKey = TEST_API_KEY;
  const adapter = adapterFor(api.fetch, {
    readApiKey: async () => apiKey,
    minimumRefreshIntervalMs: 60_000,
  });

  await adapter.observe();
  const requestsAfterFirstPass = api.requests.length;
  apiKey = "conductor-replacement-key";
  const observations = await adapter.observe();

  assert.ok(api.requests.length > requestsAfterFirstPass);
  assert.equal(observations.length, 1);
  assert.equal(
    api.requests.at(-1)?.authorization,
    "Bearer conductor-replacement-key",
    "the replacement key was not used",
  );
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

test("keeps the previous snapshot when a request fails transiently", async () => {
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
  let failRequests = false;
  const gatedFetch: CloudFetch = async (url, init) => {
    if (failRequests) throw new Error("network unreachable");
    return api.fetch(url, init);
  };
  const adapter = adapterFor(gatedFetch);

  const observed = await adapter.observe();
  failRequests = true;
  const duringOutage = await adapter.observe();

  assert.equal(observed.length, 1);
  assert.deepEqual(duringOutage, observed);
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

  assert.equal(observations.length, 2);
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
  assert.equal(observations[1]?.status, SESSION_STATUS.WORKING);
});
