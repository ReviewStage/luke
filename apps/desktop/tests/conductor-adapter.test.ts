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
  lastError?: string;
}

interface TestApi {
  userId?: string;
  projects: readonly TestProject[];
  workspaces: readonly TestWorkspace[];
  sessions: readonly TestSession[];
  /** Misbehave: answer a creation without naming the first session. */
  createWithoutSessionId?: boolean;
}

interface RecordedRequest {
  method: string;
  pathname: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string | undefined;
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
  const createdSessionIds = new Set<string>();
  const fetch: CloudFetch = async (url, init) => {
    const { pathname } = new URL(url);
    const headers = new Headers(init.headers);
    requests.push({
      method: init.method ?? "",
      pathname,
      authorization: headers.get("authorization") ?? undefined,
      contentType: headers.get("content-type") ?? undefined,
      body: typeof init.body === "string" ? init.body : undefined,
    });

    const segments = pathname.split("/").filter((segment) => segment.length > 0);
    // The three documented writers: a prompt for one session, a cancel for the
    // turn it is working, and a new workspace in one project.
    if (init.method === "POST") {
      if (segments[1] === "workspaces" && segments.length === 2) {
        const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
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
        const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as {
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
      return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
    }
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
        ...(session.lastError ? { lastError: session.lastError } : {}),
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
  // Titled by the workspace, which carries the name the user knows the work
  // by; the chat's generated name is not read, and the workspace name is not a
  // branch, so no branch is reported at all.
  assert.equal(observations[0]?.title, TEST_WORKSPACE_NAME);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, TEST_TIME - 5_000);
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

// Rows are titled by their workspace, so two chats in one workspace would draw
// as identical lines that open different places. The workspace reports once,
// in the state of whichever chat most needs a person — a failure over a
// question, a question over work still running.
test("reports one row per workspace, carried by the chat that most needs a person", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-shared", TEST_TIME - 30_000)],
    sessions: [
      {
        id: "session-working",
        workspaceId: "workspace-shared",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      {
        id: "session-errored",
        workspaceId: "workspace-shared",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 5_000,
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-errored");
  assert.equal(observations[0]?.status, SESSION_STATUS.ERROR);
  assert.equal(observations[0]?.title, TEST_WORKSPACE_NAME);
  // The row opens the chat it reports, not whichever chat happened to be
  // listed first.
  assert.equal(observations[0]?.detail?.link, "conductor://workspace?session=session-errored");
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

test("separates sessions that share one project by their workspaces' names", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      { ...ownedWorkspace("workspace-one", TEST_TIME - 30_000), name: "lisbon-v2" },
      { ...ownedWorkspace("workspace-two", TEST_TIME - 40_000), name: "porto-v1" },
    ],
    sessions: [
      // Each chat carries a generated name, which must not become the title:
      // the workspace's name is the one the user chose or accepted.
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
    ["lisbon-v2", "porto-v1"],
  );
});

// The inverse trap of the one above: an open chat idle past the staleness
// window decays to unknown, and an archived sibling reads as complete. The
// open chat is still the one the user would return to, so it keeps the row —
// a closed chat must not make the workspace read as finished, or take the
// press that would have landed in the open one.
test("a closed chat does not speak for a workspace whose open chat went quiet", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-quieted", TEST_TIME - 1_000)],
    sessions: [
      {
        id: "session-open-stale",
        workspaceId: "workspace-quieted",
        name: TEST_SESSION_NAME,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 2 * 60 * 60 * 1000,
      },
      {
        id: "session-archived",
        workspaceId: "workspace-quieted",
        name: TEST_SESSION_NAME,
        archivedAt: isoTimestamp(TEST_TIME - 10_000),
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-open-stale");
  assert.equal(observations[0]?.status, SESSION_STATUS.UNKNOWN);
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
    // A workspace's activity timestamp moves whenever anything in it runs, so
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

  // The crowded workspace spent four of the session budget's slots on its
  // chats — the cap is what kept it from spending all of them — but it still
  // reports as one row beside its quiet neighbour.
  assert.equal(observedIds.filter((id) => id.startsWith("crowded-")).length, 1);
  assert.equal(observedIds.includes("quiet-session"), true);
  assert.equal(observations.length, 2);
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

  // The open chat takes the budget ahead of the closed ones, and it is the one
  // that speaks for the workspace: work still running outranks work settled.
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "open-session");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
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

  // One chat's unreadable status does not cost the workspace its row, and the
  // chat whose state is known is the one that speaks for it.
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-readable");
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
});

test("advertises a message for any open chat and a stop only while one works", async () => {
  // One workspace per chat: a workspace is one row, reported through its
  // neediest chat, so each state under test needs a workspace of its own.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-idle", TEST_TIME - 30_000),
      ownedWorkspace("workspace-working", TEST_TIME - 31_000),
      ownedWorkspace("workspace-failed", TEST_TIME - 32_000),
      ownedWorkspace("workspace-closed", TEST_TIME - 33_000),
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
      {
        id: "session-closed",
        workspaceId: "workspace-closed",
        name: TEST_SESSION_NAME,
        archivedAt: new Date(TEST_TIME - 8_000).toISOString(),
      },
    ],
  });

  const observations = await adapterFor(api.fetch).observe();
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(byId.get("session-idle")?.canReceiveMessage, true);
  assert.equal(byId.get("session-working")?.canReceiveMessage, true);
  // A failed chat is documented for no writer, and a closed one is settled.
  assert.equal(byId.get("session-failed")?.canReceiveMessage, false);
  assert.equal(byId.get("session-closed")?.canReceiveMessage, false);
  assert.equal(byId.get("session-idle")?.controls, undefined);
  assert.deepEqual(byId.get("session-working")?.controls, [
    { id: "cancel-turn", label: "Stop this turn", kind: "stop" },
  ]);
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

  assert.deepEqual(named, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(write?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    name: "fix the notch panel",
  });

  // Left unnamed, the ask carries no name at all: Conductor generates one, and
  // an empty field is not the same request as an absent one.
  const unnamed = await adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id });
  assert.deepEqual(unnamed, { status: "accepted" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), { projectId: LUKE_PROJECT.id });
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

  // A selection the build's table lists is sent exactly as documented, the
  // effort riding along when one was chosen.
  const chosen = await adapter.createWorkspace({
    providerProjectId: LUKE_PROJECT.id,
    agentSelection: { agent: "claude", model: "sonnet", effort: "max" },
  });
  assert.deepEqual(chosen, { status: "accepted" });
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
  assert.deepEqual(effortless, { status: "accepted" });
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
    assert.deepEqual(unlisted, { status: "accepted" });
    assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
      projectId: LUKE_PROJECT.id,
    });
  }

  // No choice at all sends no agent and no model, so Conductor's own
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
  assert.deepEqual(unlisted, { status: "unsupported" });
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

  assert.deepEqual(result, { status: "accepted" });
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

  // The workspace stands, so claiming failure outright would be as wrong as
  // claiming success: the answer says which half landed.
  assert.equal(result.status, "rejected");
  assert.match(
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

  assert.deepEqual(unlisted, { status: "unsupported" });
  assert.deepEqual(unobserved, { status: "unsupported" });
  assert.equal(api.requests.length, requestsBefore);
});
