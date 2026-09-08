import assert from "node:assert/strict";
import test from "node:test";
import type { JsonObject } from "../../../packages/wire/src/testing/json.js";
import { ACTION_KIND, ACTION_REFUSAL, type WireRecord } from "../server/core";
import {
  type ActionExecutionAnswer,
  actionUnsupportedReason,
  executeSessionAction,
  type HostedSessionActionKind,
} from "../server/hosted/action-execute";
import { handleSessionAction, type SessionActionOptions } from "../server/hosted/action-session";
import { encryptProviderKey } from "../server/hosted/encryption";

const SECRET = "a".repeat(64);

function actionRequest(path: string, fields: Record<string, string>): Request {
  return new Request(`https://luke.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

function messageOptions(overrides: Partial<SessionActionOptions> = {}): SessionActionOptions {
  return {
    request: actionRequest("/api/actions/message", {
      providerId: "conductor",
      providerSessionId: "session-1",
      text: "hello",
    }),
    kind: ACTION_KIND.MESSAGE,
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readKey: async () => ({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    unsupportedReason: () => undefined,
    execute: async () => ({ result: "accepted" }),
    ...overrides,
  };
}

function workspaceOptions(overrides: Partial<SessionActionOptions> = {}): SessionActionOptions {
  return messageOptions({
    request: actionRequest("/api/actions/workspace", {
      providerId: "conductor",
      providerProjectId: "project-1",
      task: "build the thing",
    }),
    kind: ACTION_KIND.CREATE_WORKSPACE,
    ...overrides,
  });
}

// --- Unsupported providers answer before the key requirement ---

test("an unsupported provider gets 'unsupported' even with no key stored", async () => {
  const response = await handleSessionAction(
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
  const response = await handleSessionAction(
    workspaceOptions({
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

// --- Supported provider with no key is still a rejection ---

test("a supported provider with no key stored gets 'rejected'", async () => {
  const response = await handleSessionAction(messageOptions({ readKey: async () => undefined }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "rejected");
  assert.match(body.reason, /No provider key stored/);
});

// --- The one bound the route still keeps: a session id becomes a URL segment ---

test("a session id that could not be a URL segment is an invalid request", async () => {
  const response = await handleSessionAction(
    messageOptions({
      request: actionRequest("/api/actions/message", {
        providerId: "conductor",
        providerSessionId: "sessions/../session-1",
        text: "hello",
      }),
      execute: async () => {
        throw new Error("execute must not run for an unbounded session id");
      },
    }),
  );

  assert.equal(response.status, 400);
});

test("an action aimed at no session at all is an invalid request", async () => {
  const response = await handleSessionAction(
    messageOptions({
      request: actionRequest("/api/actions/message", { providerId: "conductor", text: "hello" }),
      execute: async () => {
        throw new Error("execute must not run without a session");
      },
    }),
  );

  assert.equal(response.status, 400);
});

// --- The ask reaches admission renamed and unparsed ---

test("the ask arrives at the executor as admission's own field names", async () => {
  let received: WireRecord | undefined;
  await handleSessionAction(
    messageOptions({
      execute: async (options) => {
        received = options.fields;
        return { result: "accepted" };
      },
    }),
  );

  assert.deepEqual(received, {
    provider_id: "conductor",
    provider_session_id: "session-1",
    text: "hello",
  });
});

test("a creation names a project rather than a session, and carries none", async () => {
  let received: WireRecord | undefined;
  await handleSessionAction(
    workspaceOptions({
      execute: async (options) => {
        received = options.fields;
        return { result: "accepted" };
      },
    }),
  );

  assert.deepEqual(received, {
    provider_id: "conductor",
    project_id: "project-1",
    task: "build the thing",
  });
});

// --- The execute result travels to the wire unchanged ---

test("a rejected execute result carries its reason and session id to the wire", async () => {
  const response = await handleSessionAction(
    workspaceOptions({
      execute: async () => ({
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
  const response = await handleSessionAction(
    workspaceOptions({
      execute: async () => ({ result: "accepted", providerSessionId: "session-9" }),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "accepted");
  assert.equal(body.providerSessionId, "session-9");
});

// --- The capability map mirrors the adapters exactly ---

test("the capability map matches each desktop adapter's implemented writes", () => {
  const actions: readonly HostedSessionActionKind[] = [
    ACTION_KIND.MESSAGE,
    ACTION_KIND.CONTROL,
    ACTION_KIND.ADD_AGENT,
    ACTION_KIND.RENAME_SESSION,
    ACTION_KIND.RENAME_WORKSPACE,
    ACTION_KIND.CREATE_WORKSPACE,
  ];

  for (const action of actions) {
    assert.deepEqual(
      (["conductor"] as const).filter(
        (providerId) => actionUnsupportedReason(action, providerId) === undefined,
      ),
      ["conductor"],
      action,
    );
  }
});

// --- One executor admits every action, over the pass it observed ---

const CONDUCTOR_PROJECT_ID = "project-1";
const CONDUCTOR_WORKSPACE_ID = "workspace-1";
const CONDUCTOR_SESSION_ID = "session-1";

/**
 * The read-only subset of Conductor's API one action pass walks — identity,
 * projects, the caller's workspaces, each workspace's sessions and lifecycle,
 * each session's status — with the session in the given state, plus a
 * recorder for whatever the action itself posts.
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

/** The fake API one case runs against: its fetch, and what the action posted through it. */
type ConductorApi = ReturnType<typeof conductorApi>;

/** One action asked of the fake API, admitted and carried by the one executor. */
function ask(
  api: ConductorApi,
  kind: HostedSessionActionKind,
  fields: Record<string, string>,
): Promise<ActionExecutionAnswer> {
  return executeSessionAction({
    kind,
    providerId: "conductor",
    fields: { provider_id: "conductor", ...fields },
    apiKey: "key-1",
    seams: { fetch: api.fetch },
  });
}

test("a message to a messageable Conductor session lands on its sendMessage method", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.MESSAGE, {
    provider_session_id: CONDUCTOR_SESSION_ID,
    text: "please continue",
  });

  assert.equal(answer.result, "accepted");
  assert.equal(api.posts.length, 1);
  assert.match(api.posts[0]?.url ?? "", /\/v0\/sessions\/session-1\/messages$/);
  assert.deepEqual(JSON.parse(api.posts[0]?.body ?? ""), { message: "please continue" });
});

test("a message to an errored Conductor session is rejected without a write", async () => {
  const api = conductorApi("error");
  const answer = await ask(api, ACTION_KIND.MESSAGE, {
    provider_session_id: CONDUCTOR_SESSION_ID,
    text: "hello",
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, ACTION_REFUSAL.NO_MESSAGES);
  assert.deepEqual(api.posts, []);
});

test("a message outside its bound is refused without a write", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.MESSAGE, {
    provider_session_id: CONDUCTOR_SESSION_ID,
    text: "  ",
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, ACTION_REFUSAL.MESSAGE_BOUND);
  assert.deepEqual(api.posts, []);
});

test("a message to a session the fresh pass did not observe is rejected", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.MESSAGE, {
    provider_session_id: "session-9",
    text: "hello",
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, "Session not found.");
  assert.deepEqual(api.posts, []);
});

test("a key the provider refuses is named as the reason, not a missing session", async () => {
  const answer = await executeSessionAction({
    kind: ACTION_KIND.MESSAGE,
    providerId: "conductor",
    fields: {
      provider_id: "conductor",
      provider_session_id: CONDUCTOR_SESSION_ID,
      text: "hello",
    },
    apiKey: "key-1",
    seams: { fetch: async () => new Response("{}", { status: 401 }) },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /rejected the stored API key/);
});

test("a provider that cannot be reached is named as the reason", async () => {
  const answer = await executeSessionAction({
    kind: ACTION_KIND.MESSAGE,
    providerId: "conductor",
    fields: {
      provider_id: "conductor",
      provider_session_id: CONDUCTOR_SESSION_ID,
      text: "hello",
    },
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
  const answer = await ask(api, ACTION_KIND.CONTROL, {
    provider_session_id: CONDUCTOR_SESSION_ID,
    control_id: "cancel-turn",
  });

  assert.equal(answer.result, "accepted");
  assert.deepEqual(
    api.posts.map((post) => post.url.endsWith("/v0/sessions/session-1/cancel")),
    [true],
  );
});

test("a control the fresh pass did not advertise is rejected without a write", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.CONTROL, {
    provider_session_id: CONDUCTOR_SESSION_ID,
    control_id: "cancel-turn",
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, ACTION_REFUSAL.NO_CONTROL);
  assert.deepEqual(api.posts, []);
});

test("a Conductor workspace creation lands in a reported project with the task inline", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.CREATE_WORKSPACE, {
    project_id: CONDUCTOR_PROJECT_ID,
    name: "Fix the flaky test",
    task: "Fix the flaky test in CI",
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
  const answer = await ask(api, ACTION_KIND.CREATE_WORKSPACE, {
    project_id: "project-other",
    task: "Do the thing",
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, "Project not found.");
  assert.deepEqual(api.posts, []);
});

// --- The creation's agent selection is held to the build's own table ---

test("a listed model resolves to the pairing the build documents", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.CREATE_WORKSPACE, {
    project_id: CONDUCTOR_PROJECT_ID,
    task: "build the thing",
    model: "fable-5",
    effort: "high",
  });

  assert.equal(answer.result, "accepted");
  const creation = JSON.parse(api.posts[0]?.body ?? "");
  assert.equal(creation.agent, "claude");
  assert.equal(creation.model, "fable-5");
  assert.equal(creation.effort, "high");
});

test("a model outside the build's table is refused without a write", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.CREATE_WORKSPACE, {
    project_id: CONDUCTOR_PROJECT_ID,
    task: "build the thing",
    model: "not-a-listed-model",
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, ACTION_REFUSAL.NO_MODEL);
  assert.deepEqual(api.posts, []);
});

test("no model named is no selection, never a guess", async () => {
  const api = conductorApi("idle");
  const answer = await ask(api, ACTION_KIND.CREATE_WORKSPACE, {
    project_id: CONDUCTOR_PROJECT_ID,
    task: "build the thing",
  });

  assert.equal(answer.result, "accepted");
  const creation = JSON.parse(api.posts[0]?.body ?? "");
  assert.equal(creation.agent, undefined);
  assert.equal(creation.model, undefined);
});
