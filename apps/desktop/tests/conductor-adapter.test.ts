import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/core";
import { Effect } from "effect";
import { CONDUCTOR_PROVIDER, ConductorSessionAdapter } from "../src/conductor-adapter";
import { describeCloudAdapterContract } from "./support/cloud-adapter-contract";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "./support/http-fake";
import { runHttpEffect } from "./support/run-effect";

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
  archivedAt?: string;
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
  transcriptTail?: string;
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
}

function isoTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function page<T>(data: readonly T[]) {
  return { data, offset: 0, hasMore: false };
}

function workspacePayload(workspace: TestWorkspace) {
  const payload = {
    id: workspace.id,
    name: workspace.name,
    createdAt: isoTimestamp(workspace.lastActivityAt),
    deepLink: `conductor://workspace?id=${workspace.id}`,
    lastActivityAt: isoTimestamp(workspace.lastActivityAt),
  };
  if (workspace.creatorId) {
    payload.creatorId = workspace.creatorId;
  }
  if (workspace.archivedAt) {
    payload.archivedAt = workspace.archivedAt;
  }
  return payload;
}

function sessionPayload(session: TestSession) {
  const payload = {
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
          .filter((session) => ids.includes(session.id) && session.transcriptTail !== undefined)
          .map((session) => ({
            session_id: session.id,
            agent_type: session.agentType ?? null,
            transcript_tail: session.transcriptTail,
          }));
        return jsonResponse({ rows, rowCount: rows.length, truncated: false });
      }
      // The four documented writers: a prompt for one session, a cancel for
      // the turn it is working, a new workspace in one project, and an
      // archive for one workspace.
      if (segments[1] === "workspaces" && segments.length === 4 && segments[3] === "archive") {
        const workspace = api.workspaces.find((candidate) => candidate.id === segments[2]);
        if (!workspace) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
        return jsonResponse({ workspaceId: workspace.id, status: "archived" });
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
    if (segments[1] === "workspaces" && segments[3] === "status") {
      const workspace = api.workspaces.find((candidate) => candidate.id === segments[2]);
      if (!workspace) return jsonResponse({}, HTTP_STATUS.SERVER_ERROR);
      if (workspace.lifecycleHttpStatus) return jsonResponse({}, workspace.lifecycleHttpStatus);
      const lifecycle = {
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
      const statusPayload = {
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
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Effect.Effect<
      string | undefined,
      unknown,
      import("../src/services/http").Http
    >;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
  } = {},
): ConductorSessionAdapter {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return new ConductorSessionAdapter({
    readApiKey: overrides.readApiKey ?? (() => Effect.succeed(apiKey)),
    baseUrl: TEST_BASE_URL,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}

test("declares every provider operation on one adapter interface", () => {
  const adapter = adapterFor();
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
    adapter: adapterFor(options),
    fetch,
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.deepEqual(CONDUCTOR_PROVIDER, { id: "conductor", displayName: "Conductor" });
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.providerSessionId, "session-working");
  // Titled by the chat's own name, grouped under the workspace's — the name
  // the user knows the work by — and neither is a branch, so no branch is
  // reported at all.
  assert.equal(observations[0]?.title, TEST_SESSION_NAME);
  assert.deepEqual(observations[0]?.workspace, {
    providerWorkspaceId: "workspace-active",
    name: TEST_WORKSPACE_NAME,
  });
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  // A workspace being stood up or rebuilt is why its chat sits quiet, so the
  // row says so; a ready workspace is the normal case and a sleeping one is
  // Conductor's own economy, so neither takes the activity slot from a recap.
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
  const byId = new Map(observations.map((entry) => [entry.providerSessionId, entry]));

  assert.equal(observations.length, 1);
  assert.equal(byId.get("chat-unreadable")?.detail?.activity, undefined);
  assert.equal(byId.get("chat-unreadable")?.status, SESSION_STATUS.WAITING);
});

const IDLE_SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const SECOND_IDLE_SESSION_UUID = "22222222-2222-4222-8222-222222222222";
const WORKING_SESSION_UUID = "33333333-3333-4333-8333-333333333333";
const ERRORED_SESSION_UUID = "44444444-4444-4444-8444-444444444444";

/** A tail the way the view writes one: headers, an elision mark, parting words. */
const TEST_TRANSCRIPT_TAIL =
  "st half of a message the tail cut into\n\n## User\n\nWire the panel.\n\n## Assistant\n\n" +
  "[12 messages elided]\n\nAll checks pass;\nnext, say whether to ship it.";
const TEST_RECAP = "All checks pass; next, say whether to ship it.";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("reads a settled chat's parting words from the transcripts view as its recap", async () => {
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
        transcriptTail: TEST_TRANSCRIPT_TAIL,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // A settled chat with no model reported still names its agent kind.
      {
        id: SECOND_IDLE_SESSION_UUID,
        workspaceId: "workspace-second-idle",
        name: TEST_SESSION_NAME,
        agentType: "claude",
        transcriptTail: TEST_TRANSCRIPT_TAIL,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 2_000,
      },
    ],
  });

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.equal(observations.length, 2);
  const idle = observations.find((candidate) => candidate.providerSessionId === IDLE_SESSION_UUID);
  const secondIdle = observations.find(
    (candidate) => candidate.providerSessionId === SECOND_IDLE_SESSION_UUID,
  );
  // The recap is the last message's words alone: the elision mark is dropped,
  // the header is not part of it, and nothing earlier in the tail survives.
  assert.equal(idle?.recap, TEST_RECAP);
  assert.equal(secondIdle?.recap, TEST_RECAP);
  // The agent kind joins the model label, and stands alone when no model came.
  assert.equal(idle?.detail?.model, "codex · gpt-5.5");
  assert.equal(secondIdle?.detail?.model, "claude");

  // One read document for the whole pass, fixed by the build: the SELECT this
  // build wrote, naming exactly the observed session ids and nothing else.
  const reads = api.requests.filter((request) => request.method === "POST");
  assert.equal(reads.length, 1);
  assert.equal(reads[0]?.pathname, "/v0/sql");
  assert.equal(reads[0]?.authorization, `Bearer ${TEST_API_KEY}`);
  assert.deepEqual(JSON.parse(reads[0]?.body ?? ""), {
    query:
      "SELECT session_id, agent_type, " +
      "CASE WHEN assistant_from_end > 0 AND (user_from_end = 0 OR assistant_from_end < user_from_end) " +
      "THEN SUBSTRING(transcript FROM GREATEST(LENGTH(transcript) - assistant_from_end - 12, 1) FOR 2014) " +
      "END AS transcript_tail " +
      "FROM (SELECT session_id, agent_type, transcript, " +
      "position(reverse(E'\\n## Assistant\\n') in reverse(transcript)) AS assistant_from_end, " +
      "position(reverse(E'\\n## User\\n') in reverse(transcript)) AS user_from_end " +
      "FROM session_transcripts_view WHERE session_id IN " +
      `('${IDLE_SESSION_UUID}', '${SECOND_IDLE_SESSION_UUID}')) AS attributed`,
  });
});

test("keeps parting words off a chat that is still working or newly failed", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-working", TEST_TIME - 30_000),
      ownedWorkspace("workspace-errored", TEST_TIME - 40_000),
    ],
    sessions: [
      // Mid-turn the words are half a sentence, not an outcome.
      {
        id: WORKING_SESSION_UUID,
        workspaceId: "workspace-working",
        name: TEST_SESSION_NAME,
        agentType: "cursor",
        transcriptTail: TEST_TRANSCRIPT_TAIL,
        status: TEST_CONDUCTOR_STATUS.WORKING,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // Beside a failure the parting words predate what the row has to say.
      {
        id: ERRORED_SESSION_UUID,
        workspaceId: "workspace-errored",
        name: TEST_SESSION_NAME,
        transcriptTail: TEST_TRANSCRIPT_TAIL,
        status: TEST_CONDUCTOR_STATUS.ERROR,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.equal(observations.length, 2);
  for (const observation of observations) {
    assert.equal(observation.recap, undefined);
  }
  // The agent kind is configuration, not conversation, so it rides regardless.
  const working = observations.find(
    (candidate) => candidate.providerSessionId === WORKING_SESSION_UUID,
  );
  assert.equal(working?.detail?.model, "cursor");
});

test("reports no recap for a tail it cannot attribute to the agent", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      ownedWorkspace("workspace-user-last", TEST_TIME - 30_000),
      ownedWorkspace("workspace-headerless", TEST_TIME - 40_000),
    ],
    sessions: [
      // The user spoke last, so there are no parting words to report.
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-user-last",
        name: TEST_SESSION_NAME,
        transcriptTail: `${TEST_TRANSCRIPT_TAIL}\n\n## User\n\nPlease also update the docs.`,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
      // A tail with no header names no speaker. The view anchors what it
      // returns at the final message's own header, so this is a misbehaving
      // answer — attribution is still refused rather than assumed.
      {
        id: SECOND_IDLE_SESSION_UUID,
        workspaceId: "workspace-headerless",
        name: TEST_SESSION_NAME,
        transcriptTail: "words with no header anywhere above them",
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.equal(observations.length, 2);
  for (const observation of observations) {
    assert.equal(observation.recap, undefined);
  }
});

test("cuts a recap at the recap bound", async () => {
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [ownedWorkspace("workspace-idle", TEST_TIME - 30_000)],
    sessions: [
      {
        id: IDLE_SESSION_UUID,
        workspaceId: "workspace-idle",
        name: TEST_SESSION_NAME,
        transcriptTail: `## Assistant\n\n${"a word ".repeat(200)}`,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
  });

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.equal(observations[0]?.recap?.length, 500);
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
        transcriptTail: TEST_TRANSCRIPT_TAIL,
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

  await runHttpEffect(adapterFor().observe(), api.fetch);

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
  await runHttpEffect(adapterFor().observe(), uuidlessApi.fetch);
  assert.equal(
    uuidlessApi.requests.every((request) => request.method === "GET"),
    true,
  );
});

test("a refused transcripts read costs the recap and agent kind, never the pass", async () => {
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
        transcriptTail: TEST_TRANSCRIPT_TAIL,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
    sqlHttpStatus: HTTP_STATUS.SERVER_ERROR,
  });

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(observations[0]?.recap, undefined);
  assert.equal(observations[0]?.detail?.model, "gpt-5.5");

  // Even a credential refusal on this one endpoint costs only the recap: a
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
        transcriptTail: TEST_TRANSCRIPT_TAIL,
        status: TEST_CONDUCTOR_STATUS.IDLE,
        statusUpdatedAt: TEST_TIME - 1_000,
      },
    ],
    sqlHttpStatus: HTTP_STATUS.UNAUTHORIZED,
  });

  const scopedKeyObservations = await runHttpEffect(adapterFor().observe(), scopedKeyApi.fetch);

  assert.equal(scopedKeyObservations.length, 1);
  assert.equal(scopedKeyObservations[0]?.status, SESSION_STATUS.WAITING);
  assert.equal(scopedKeyObservations[0]?.recap, undefined);
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
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
    });
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // The filed-away chat neither settles the workspace nor holds it open: the
  // open sibling's own settled turn is what offers the archive.
  assert.deepEqual(observations[0]?.controls, [
    { id: "archive-workspace", label: "Archive", target: "workspace-quieted" },
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
  // Conductor stamps a status with the moment it was entered, so a turn that
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.status, SESSION_STATUS.WORKING);
  assert.equal(observations[0]?.observedAt, startedAt);
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.deepEqual(
    observations.map((observation) => observation.providerSessionId),
    ["session-0", "session-1", "session-2", "session-3", "session-4", "session-5"],
  );
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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
  const fetch = gatedFetch;
  const adapter = adapterFor();

  const authorized = await runHttpEffect(adapter.observe(), fetch);
  rejectRequests = true;
  const rejected = await runHttpEffect(adapter.observe(), fetch);

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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
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
      { id: "archive-workspace", label: "Archive", target: workspaceId },
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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
      // acted on, come the next pass.
      {
        ...ownedWorkspace("workspace-filed", TEST_TIME - 30_000),
        archivedAt: isoTimestamp(TEST_TIME - 20_000),
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

  assert.deepEqual(
    observations.map((candidate) => candidate.providerSessionId),
    ["session-open"],
  );
  // Dropped before its sessions are ever asked for: the filed-away workspace
  // costs no requests, not just no rows.
  assert.equal(
    api.requests.some((request) => request.pathname.includes("workspace-filed")),
    false,
  );
});

test("leaves a workspace whose lifecycle stands archived off the roster", async () => {
  // Conductor's listing keeps a filed-away workspace in the page with no
  // mark of it — no archive timestamp, nothing — and only the lifecycle
  // endpoint says it was archived. Without that read deciding the roster,
  // every chat of every workspace ever archived kept its row, standing gray
  // forever.
  const api = fakeConductorApi({
    userId: TEST_USER_ID,
    projects: [LUKE_PROJECT],
    workspaces: [
      { ...ownedWorkspace("workspace-archived", TEST_TIME - 30_000), lifecycleStatus: "archived" },
      { ...ownedWorkspace("workspace-deleted", TEST_TIME - 40_000), lifecycleStatus: "deleted" },
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

  const observations = await runHttpEffect(adapterFor().observe(), api.fetch);

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  const result = await runHttpEffect(
    adapter.sendMessage({
      providerSessionId: "session-idle",
      text: "Rebase onto main before continuing",
    }),
    fetch,
  );

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  const result = await runHttpEffect(
    adapter.executeControl({
      providerSessionId: "session-working",
      control: { id: "cancel-turn", label: "Stop this turn", kind: "stop" },
    }),
    fetch,
  );

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  // Deliberately without a target: the route must be built from the control
  // the adapter itself advertised, never from the caller's copy of it.
  const result = await runHttpEffect(
    adapter.executeControl({
      providerSessionId: "session-idle",
      control: { id: "archive-workspace", label: "Archive" },
    }),
    fetch,
  );

  assert.deepEqual(result, { status: "accepted" });
  const write = api.requests.at(-1);
  assert.equal(write?.method, "POST");
  assert.equal(write?.pathname, "/v0/workspaces/workspace-active/archive");
  assert.equal(write?.authorization, `Bearer ${TEST_API_KEY}`);
  // Conductor documents no body for an archive.
  assert.equal(write?.contentType, undefined);
  assert.equal(write?.body, undefined);
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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);
  const requestsBefore = api.requests.length;

  // A working workspace advertised only the turn's stop, so an archive ask
  // has nothing behind it and no request exists — whatever target the caller
  // writes into their copy of the control.
  const result = await runHttpEffect(
    adapter.executeControl({
      providerSessionId: "session-working",
      control: {
        id: "archive-workspace",
        label: "Archive",
        target: "workspace-active",
      },
    }),
    fetch,
  );

  assert.deepEqual(result, { status: "unsupported" });
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
  const fetch = api.fetch;
  const adapter = adapterFor();

  // Nothing is offered before observation, or after the credential goes: the
  // offer is the last pass's own project list and nothing longer-lived.
  assert.deepEqual(adapter.workspaceProjects(), []);
  await runHttpEffect(adapter.observe(), fetch);
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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  const named = await runHttpEffect(
    adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      name: "fix the notch panel",
    }),
    fetch,
  );

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
  const unnamed = await runHttpEffect(
    adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id }),
    fetch,
  );
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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  const result = await runHttpEffect(
    adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id }),
    fetch,
  );

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // A selection the build's table lists is sent exactly as documented, the
  // effort riding along when one was chosen.
  const chosen = await runHttpEffect(
    adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      agentSelection: { agent: "claude", model: "sonnet", effort: "max" },
    }),
    fetch,
  );
  assert.deepEqual(chosen, { status: "accepted", providerSessionId: "session-new" });
  assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
    projectId: LUKE_PROJECT.id,
    agent: "claude",
    model: "sonnet",
    effort: "max",
  });

  // No effort chosen sends none, so Conductor's default effort stands.
  const effortless = await runHttpEffect(
    adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      agentSelection: { agent: "claude", model: "sonnet" },
    }),
    fetch,
  );
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
    const unlisted = await runHttpEffect(
      adapter.createWorkspace({
        providerProjectId: LUKE_PROJECT.id,
        agentSelection,
      }),
      fetch,
    );
    assert.deepEqual(unlisted, { status: "accepted", providerSessionId: "session-new" });
    assert.deepEqual(JSON.parse(api.requests.at(-1)?.body ?? ""), {
      projectId: LUKE_PROJECT.id,
    });
  }

  // No choice at all sends no agent and no model, so Conductor's own
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // defaults decide — an absent field is not the same request as a guessed one.
  await runHttpEffect(adapter.createWorkspace({ providerProjectId: LUKE_PROJECT.id }), fetch);
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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);
  const requestsBefore = api.requests.length;

  const unlisted = await runHttpEffect(
    adapter.createWorkspace({ providerProjectId: "project-unknown" }),
    fetch,
  );

  // No request exists for a project observation did not see.
  assert.deepEqual(unlisted, { status: "unsupported" });
  assert.equal(api.requests.length, requestsBefore);

  // A name outside its bound is refused before a request exists too.
  const overlong = await runHttpEffect(
    adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      name: "a".repeat(200),
    }),
    fetch,
  );
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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  const result = await runHttpEffect(
    adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      task: "Add a smoke test for the panel motion",
    }),
    fetch,
  );

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  const result = await runHttpEffect(
    adapter.createWorkspace({
      providerProjectId: LUKE_PROJECT.id,
      task: "Add a smoke test",
    }),
    fetch,
  );

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  const observations = await runHttpEffect(adapter.observe(), fetch);

  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // The roster row says which agents its workspace can take, exactly as the
  // endpoint takes them.
  assert.deepEqual(observations[0]?.spawnableAgents, ["claude", "codex", "cursor"]);

  const result = await runHttpEffect(
    adapter.spawnWorkspaceAgent({
      providerSessionId: "session-idle",
      agent: "codex",
      name: "xyz feature",
      task: "Build the XYZ feature",
    }),
    fetch,
  );

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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);

  // A model documented for the asked-for agent kind rides along, its effort
  // beside it when one was chosen.
  const listed = await runHttpEffect(
    adapter.spawnWorkspaceAgent({
      providerSessionId: "session-idle",
      agent: "codex",
      model: "gpt-5.6-sol",
      effort: "ultra",
    }),
    fetch,
  );
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
    const mismatched = await runHttpEffect(
      adapter.spawnWorkspaceAgent({
        providerSessionId: "session-idle",
        agent: "codex",
        ...stored,
      }),
      fetch,
    );
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
  const fetch = api.fetch;
  const adapter = adapterFor();
  await runHttpEffect(adapter.observe(), fetch);
  const requestsBefore = api.requests.length;

  // An agent kind the observation did not list, and a session the pass did
  // not emit, are both nowhere to land.
  const unlisted = await runHttpEffect(
    adapter.spawnWorkspaceAgent({
      providerSessionId: "session-idle",
      agent: "acp",
    }),
    fetch,
  );
  const unobserved = await runHttpEffect(
    adapter.spawnWorkspaceAgent({
      providerSessionId: "session-unseen",
      agent: "claude",
    }),
    fetch,
  );

  assert.deepEqual(unlisted, { status: "unsupported" });
  assert.deepEqual(unobserved, { status: "unsupported" });
  assert.equal(api.requests.length, requestsBefore);
});
