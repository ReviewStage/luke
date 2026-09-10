import type { SessionProviderPlugin } from "@sidecar/session";
import type { CloudFetch } from "@sidecar/wire";
import type { JsonObject, JsonValue } from "@sidecar/wire/testing";
import { HTTP_STATUS, jsonResponse, recordingFetch } from "@sidecar/wire/testing";
import { conductorPlugin } from "../conductor/index.js";

/**
 * Conductor's documented public API, answered from a synthetic account. Every
 * route the plugin is allowed to reach is served here and every other one is
 * a 500, so a read the build did not fix fails loudly rather than quietly
 * answering nothing.
 */

export const TEST_TIME = Date.parse("2026-08-12T02:45:00.000Z");
const TEST_BASE_URL = "https://api.conductor.test";
export const TEST_API_KEY = "conductor-test-key";
export const TEST_USER_ID = "user-under-observation";
export const OTHER_USER_ID = "another-user";
export const TEST_SESSION_NAME = "Revamp the notch panel";
export const TEST_WORKSPACE_NAME = "bucharest-v1";
export const TEST_ERROR_MESSAGE = "The agent container ran out of memory";

export const TEST_CONDUCTOR_STATUS = {
  IDLE: "idle",
  WORKING: "working",
  ERROR: "error",
} as const;

export type TestProject = {
  id: string;
  name: string;
  gitRemote: string;
};

export interface TestWorkspace {
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

export interface TestSession {
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

export interface TestApi {
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

export function isoTimestamp(timestampMs: number): string {
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
export function fakeConductorApi(api: TestApi) {
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

export function pluginFor(
  fetch: CloudFetch,
  overrides: {
    apiKey?: string | undefined;
    readApiKey?: () => Promise<string | undefined>;
    now?: () => number;
    minimumRefreshIntervalMs?: number;
  } = {},
): SessionProviderPlugin {
  const apiKey = "apiKey" in overrides ? overrides.apiKey : TEST_API_KEY;
  return conductorPlugin({
    readApiKey: overrides.readApiKey ?? (async () => apiKey),
    baseUrl: TEST_BASE_URL,
    fetch,
    now: overrides.now ?? (() => TEST_TIME),
    minimumRefreshIntervalMs: overrides.minimumRefreshIntervalMs ?? 0,
  });
}
export const LUKE_PROJECT: TestProject = {
  id: "project-luke",
  name: "luke",
  gitRemote: "https://github.com/reviewstage/luke.git",
};

export function ownedWorkspace(id: string, lastActivityAt: number): TestWorkspace {
  return {
    id,
    projectId: LUKE_PROJECT.id,
    name: TEST_WORKSPACE_NAME,
    creatorId: TEST_USER_ID,
    lastActivityAt,
  };
}
export const IDLE_SESSION_UUID = "11111111-1111-4111-8111-111111111111";
export const SECOND_IDLE_SESSION_UUID = "22222222-2222-4222-8222-222222222222";
export const WORKING_SESSION_UUID = "33333333-3333-4333-8333-333333333333";
export const ERRORED_SESSION_UUID = "44444444-4444-4444-8444-444444444444";
/** What the transcripts view holds for every chat and an observation never reports. */
const TEST_TRANSCRIPT_WORDS = "SECRET_TRANSCRIPT_WORDS";
