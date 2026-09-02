import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "../../../packages/wire/src/testing/json.js";
import { text, type WorkspaceAgentSelection } from "../server/core";
import {
  actUnsupportedReason,
  executeControlAct,
  executeCreateWorkspaceAct,
  executeMessageAct,
  REMOTE_SESSION_ACT,
} from "../server/hosted/act-execute";
import { handleSessionAct, type SessionActOptions } from "../server/hosted/act-session";
import { handleActWorkspace } from "../server/hosted/act-workspace";
import { encryptProviderKey } from "../server/hosted/encryption";

const SECRET = "a".repeat(64);

function actRequest(path: string, fields: Record<string, string>): Request {
  return new Request(`https://luke.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

type MessageFields = { text: string };

function messageOptions(
  overrides: Partial<SessionActOptions<MessageFields>> = {},
): SessionActOptions<MessageFields> {
  return {
    request: actRequest("/api/acts/message", {
      providerId: "conductor",
      providerSessionId: "session-1",
      text: "hello",
    }),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readKey: async () => ({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    parseFields: (body) => {
      const messageText = text(body.text);
      return messageText ? { text: messageText } : undefined;
    },
    unsupportedReason: () => undefined,
    execute: async () => ({ result: "accepted" }),
    ...overrides,
  };
}

function workspaceRequest(fields: Record<string, string>): Request {
  return actRequest("/api/acts/workspace", fields);
}

function workspaceOptions(
  overrides: Partial<Parameters<typeof handleActWorkspace>[0]> = {},
): Parameters<typeof handleActWorkspace>[0] {
  return {
    request: workspaceRequest({
      providerId: "conductor",
      providerProjectId: "project-1",
      task: "build the thing",
    }),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readKey: async () => ({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    unsupportedReason: () => undefined,
    executeCreateWorkspace: async () => ({ result: "accepted" }),
    ...overrides,
  };
}

// --- Unsupported providers answer before the key requirement ---

test("an unsupported provider gets 'unsupported' even with no key stored", async () => {
  const response = await handleSessionAct(
    messageOptions({
      unsupportedReason: () => "Not available.",
      readKey: async () => undefined,
      execute: async () => {
        throw new Error("execute must not run for an unsupported provider");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "unsupported");
  assert.equal(body.reason, "Not available.");
});

test("an unsupported workspace provider gets 'unsupported' even with no key stored", async () => {
  const response = await handleActWorkspace(
    workspaceOptions({
      unsupportedReason: () => "Not available.",
      readKey: async () => undefined,
      executeCreateWorkspace: async () => {
        throw new Error("executeCreateWorkspace must not run for an unsupported provider");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "unsupported");
  assert.equal(body.reason, "Not available.");
});

// --- Supported provider with no key is still a rejection ---

test("a supported provider with no key stored gets 'rejected'", async () => {
  const response = await handleSessionAct(messageOptions({ readKey: async () => undefined }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "rejected");
  assert.match(body.reason, /No provider key stored/);
});

// --- The act's own fields are bounded before anything else runs ---

test("an act whose fields fail their bound is an invalid request", async () => {
  const response = await handleSessionAct(
    messageOptions({
      request: actRequest("/api/acts/message", {
        providerId: "conductor",
        providerSessionId: "session-1",
        text: "",
      }),
      execute: async () => {
        throw new Error("execute must not run for unbounded fields");
      },
    }),
  );

  assert.equal(response.status, 400);
});

// --- The execute result travels to the wire unchanged ---

test("a rejected execute result carries its reason and session id to the wire", async () => {
  const response = await handleActWorkspace(
    workspaceOptions({
      executeCreateWorkspace: async () => ({
        result: "rejected",
        providerSessionId: "session-9",
        reason: "Workspace was created, but the opening task could not be delivered.",
      }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "rejected");
  assert.equal(body.providerSessionId, "session-9");
  assert.match(body.reason, /opening task could not be delivered/);
});

test("an accepted execute result carries the created session id to the wire", async () => {
  const response = await handleActWorkspace(
    workspaceOptions({
      executeCreateWorkspace: async () => ({ result: "accepted", providerSessionId: "session-9" }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "accepted");
  assert.equal(body.providerSessionId, "session-9");
});

test("a session act answer carries a created session id to the wire", async () => {
  const response = await handleSessionAct(
    messageOptions({
      execute: async () => ({ result: "accepted", providerSessionId: "chat-2" }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "accepted");
  assert.equal(body.providerSessionId, "chat-2");
});

// --- The capability map mirrors the adapters exactly ---

test("the capability map matches each desktop adapter's implemented writes", () => {
  const supported = (act: (typeof REMOTE_SESSION_ACT)[keyof typeof REMOTE_SESSION_ACT]) =>
    (["conductor"] as const).filter(
      (providerId) => actUnsupportedReason(act, providerId) === undefined,
    );

  for (const act of Object.values(REMOTE_SESSION_ACT)) {
    assert.deepEqual(supported(act), ["conductor"], act);
  }
});

// --- Executors re-observe and act through the provider's adapter ---

const CONDUCTOR_PROJECT_ID = "project-1";
const CONDUCTOR_WORKSPACE_ID = "workspace-1";
const CONDUCTOR_SESSION_ID = "session-1";

/**
 * The read-only subset of Conductor's API one act pass walks — identity,
 * projects, the caller's workspaces, each workspace's sessions and lifecycle,
 * each session's status — with the session in the given state, plus a
 * recorder for whatever the act itself posts.
 */
function conductorApi(status: string) {
  const posts: Array<{ url: string; body: string }> = [];
  const json = (value: JsonObject) => new Response(JSON.stringify(value), { status: 200 });
  const fetch = async (url: string, init: RequestInit) => {
    const { pathname } = new URL(url);
    if (init.method === "POST") {
      if (pathname.endsWith("/v0/sql")) return json({ rows: [], rowCount: 0, truncated: false });
      posts.push({ url, body: String(init.body) });
      if (pathname.endsWith("/v0/workspaces")) {
        return new Response(
          JSON.stringify({ workspaceId: "workspace-new", sessionId: "session-new" }),
          { status: 201 },
        );
      }
      return new Response(JSON.stringify({ messageId: "message-1", state: "queued" }), {
        status: 201,
      });
    }
    if (pathname.endsWith("/me")) return json({ userId: "user-1" });
    if (pathname.endsWith("/v0/projects")) {
      return json({
        data: [
          { id: CONDUCTOR_PROJECT_ID, gitRemote: "https://github.com/owner/repo", name: "repo" },
        ],
        offset: 0,
        hasMore: false,
      });
    }
    if (pathname.endsWith("/v0/workspaces")) {
      return json({
        data: [
          {
            id: CONDUCTOR_WORKSPACE_ID,
            name: "amber-shoal",
            state: "ready",
            repoUrl: "https://github.com/owner/repo",
            creatorId: "user-1",
            createdAt: "2026-08-12T02:00:00.000Z",
            lastActivityAt: "2026-08-12T02:40:00.000Z",
            deepLink: `conductor://workspace?id=${CONDUCTOR_WORKSPACE_ID}`,
          },
        ],
        offset: 0,
        hasMore: false,
      });
    }
    if (pathname.endsWith(`/v0/workspaces/${CONDUCTOR_WORKSPACE_ID}/sessions`)) {
      return json({
        data: [
          {
            id: CONDUCTOR_SESSION_ID,
            name: "Revamp the panel",
            deepLink: `conductor://workspace?session=${CONDUCTOR_SESSION_ID}`,
          },
        ],
        offset: 0,
        hasMore: false,
      });
    }
    if (pathname.endsWith(`/v0/workspaces/${CONDUCTOR_WORKSPACE_ID}/status`)) {
      return json({
        workspaceId: CONDUCTOR_WORKSPACE_ID,
        status: "ready",
        updatedAt: "2026-08-12T02:40:00.000Z",
      });
    }
    if (pathname.endsWith(`/v0/sessions/${CONDUCTOR_SESSION_ID}/status`)) {
      const statusPayload: JsonObject = {
        workspaceId: CONDUCTOR_WORKSPACE_ID,
        sessionId: CONDUCTOR_SESSION_ID,
        status,
        updatedAt: "2026-08-12T02:40:00.000Z",
      };
      if (status === "error") statusPayload.errorMessage = "The agent container ran out of memory";
      return json(statusPayload);
    }
    return new Response("{}", { status: 500 });
  };
  return { fetch, posts };
}

test("a message to a messageable Conductor session lands on its sendMessage method", async () => {
  const api = conductorApi("idle");
  const answer = await executeMessageAct({
    providerId: "conductor",
    providerSessionId: CONDUCTOR_SESSION_ID,
    text: "please continue",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "accepted");
  assert.equal(api.posts.length, 1);
  assert.match(api.posts[0]?.url ?? "", /\/v0\/sessions\/session-1\/messages$/);
  assert.deepEqual(JSON.parse(api.posts[0]?.body ?? ""), { message: "please continue" });
});

test("a message to an errored Conductor session is rejected without a write", async () => {
  const api = conductorApi("error");
  const answer = await executeMessageAct({
    providerId: "conductor",
    providerSessionId: CONDUCTOR_SESSION_ID,
    text: "hello",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /not currently accepting messages/);
  assert.deepEqual(api.posts, []);
});

test("a message to a session the fresh pass did not observe is rejected", async () => {
  const api = conductorApi("idle");
  const answer = await executeMessageAct({
    providerId: "conductor",
    providerSessionId: "session-9",
    text: "hello",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, "Session not found.");
  assert.deepEqual(api.posts, []);
});

test("a key the provider refuses is named as the reason, not a missing session", async () => {
  const answer = await executeMessageAct({
    providerId: "conductor",
    providerSessionId: CONDUCTOR_SESSION_ID,
    text: "hello",
    apiKey: "key-1",
    seams: { fetch: async () => new Response("{}", { status: 401 }) },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /rejected the stored API key/);
});

test("a provider that cannot be reached is named as the reason", async () => {
  const answer = await executeMessageAct({
    providerId: "conductor",
    providerSessionId: CONDUCTOR_SESSION_ID,
    text: "hello",
    apiKey: "key-1",
    seams: {
      fetch: async () => {
        throw new Error("connection refused");
      },
    },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /Could not reach Conductor/);
});

test("an advertised control runs through the provider's documented endpoint", async () => {
  const api = conductorApi("working");
  const answer = await executeControlAct({
    providerId: "conductor",
    providerSessionId: CONDUCTOR_SESSION_ID,
    controlId: "cancel-turn",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "accepted");
  assert.deepEqual(
    api.posts.map((post) => post.url.endsWith("/v0/sessions/session-1/cancel")),
    [true],
  );
});

test("a control the fresh pass did not advertise is rejected without a write", async () => {
  const api = conductorApi("idle");
  const answer = await executeControlAct({
    providerId: "conductor",
    providerSessionId: CONDUCTOR_SESSION_ID,
    controlId: "cancel-turn",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /not currently offered/);
  assert.deepEqual(api.posts, []);
});

test("a Conductor workspace creation lands in a reported project with the task inline", async () => {
  const api = conductorApi("idle");
  const answer = await executeCreateWorkspaceAct({
    providerId: "conductor",
    providerProjectId: CONDUCTOR_PROJECT_ID,
    name: "Fix the flaky test",
    task: "Fix the flaky test in CI",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "accepted");
  assert.equal(answer.providerSessionId, "session-new");
  // Conductor's creation endpoint documents no prompt field, so the task
  // follows as a message to the session the creation response named.
  assert.deepEqual(
    api.posts.map((post) => new URL(post.url).pathname),
    ["/v0/workspaces", "/v0/sessions/session-new/messages"],
  );
  const creation = JSON.parse(api.posts[0]?.body ?? "");
  assert.equal(creation.projectId, CONDUCTOR_PROJECT_ID);
  assert.equal(creation.name, "Fix the flaky test");
  assert.equal(creation.prompt, undefined);
});

test("a workspace creation naming an unreported project is rejected without a write", async () => {
  const api = conductorApi("idle");
  const answer = await executeCreateWorkspaceAct({
    providerId: "conductor",
    providerProjectId: "project-other",
    name: undefined,
    task: "Do the thing",
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, "Project not found.");
  assert.deepEqual(api.posts, []);
});

// --- The workspace act's agent selection is held to the build's table ---

test("a listed agent selection reaches the executor whole", async () => {
  let received: WorkspaceAgentSelection | undefined;
  const response = await handleActWorkspace(
    workspaceOptions({
      request: workspaceRequest({
        providerId: "conductor",
        providerProjectId: "project-1",
        task: "build the thing",
        agent: "claude",
        model: "fable-5",
        effort: "high",
      }),
      executeCreateWorkspace: async (options) => {
        received = options.agentSelection;
        return { result: "accepted" };
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, { agent: "claude", model: "fable-5", effort: "high" });
});

test("an agent selection outside the build's table is an invalid request", async () => {
  const response = await handleActWorkspace(
    workspaceOptions({
      request: workspaceRequest({
        providerId: "conductor",
        providerProjectId: "project-1",
        task: "build the thing",
        agent: "claude",
        model: "not-a-listed-model",
      }),
      executeCreateWorkspace: async () => {
        throw new Error("executeCreateWorkspace must not run for an unlisted selection");
      },
    }),
  );

  assert.equal(response.status, 400);
});

test("no selection fields is no selection, never a guess", async () => {
  let received: WorkspaceAgentSelection | undefined;
  let ran = false;
  await handleActWorkspace(
    workspaceOptions({
      executeCreateWorkspace: async (options) => {
        received = options.agentSelection;
        ran = true;
        return { result: "accepted" };
      },
    }),
  );

  assert.equal(ran, true);
  assert.equal(received, undefined);
});
