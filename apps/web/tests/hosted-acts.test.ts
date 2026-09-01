import assert from "node:assert/strict";
import test from "node:test";
import { text, type WorkspaceAgentSelection } from "../server/core";
import {
  actUnsupportedReason,
  executeControlAct,
  executeCreateWorkspaceAct,
  executeMessageAct,
  MOBILE_SESSION_ACT,
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
      request: actRequest("/api/acts/message", {
        providerId: "copilot",
        providerSessionId: "session-1",
        text: "hello",
      }),
      unsupportedReason: (providerId) =>
        providerId === "conductor" ? undefined : "Not available.",
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
      request: workspaceRequest({ providerId: "devin", providerProjectId: "project-1" }),
      unsupportedReason: (providerId) =>
        providerId === "conductor" ? undefined : "Not available.",
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
  const supported = (act: (typeof MOBILE_SESSION_ACT)[keyof typeof MOBILE_SESSION_ACT]) =>
    (["conductor", "copilot", "cursor", "devin", "jules", "replicas"] as const).filter(
      (providerId) => actUnsupportedReason(act, providerId) === undefined,
    );

  assert.deepEqual(supported(MOBILE_SESSION_ACT.MESSAGE), [
    "conductor",
    "cursor",
    "devin",
    "jules",
    "replicas",
  ]);
  assert.deepEqual(supported(MOBILE_SESSION_ACT.CONTROL), [
    "conductor",
    "cursor",
    "devin",
    "jules",
  ]);
  assert.deepEqual(supported(MOBILE_SESSION_ACT.AGENT), ["conductor", "replicas"]);
  assert.deepEqual(supported(MOBILE_SESSION_ACT.RENAME_SESSION), ["conductor"]);
  assert.deepEqual(supported(MOBILE_SESSION_ACT.RENAME_WORKSPACE), ["conductor"]);
  assert.deepEqual(supported(MOBILE_SESSION_ACT.CREATE_WORKSPACE), [
    "conductor",
    "cursor",
    "replicas",
  ]);
});

test("an unsupported act names the provider and never reaches the network", async () => {
  const answer = await executeMessageAct({
    providerId: "copilot",
    providerSessionId: "task-1",
    text: "hello",
    apiKey: "key-1",
    seams: {
      fetch: async () => {
        throw new Error("an unsupported act must not touch the network");
      },
    },
  });

  assert.equal(answer.result, "unsupported");
  assert.match(answer.reason ?? "", /Copilot/);
});

// --- Executors re-observe and act through the provider's adapter ---

/** A Jules sessions listing with one session in the given state. */
function julesListing(state: string): string {
  return JSON.stringify({
    sessions: [
      {
        id: "jules-1",
        state,
        updateTime: new Date().toISOString(),
        sourceContext: { source: "github/owner/repo" },
        url: "https://jules.google.com/session/jules-1",
      },
    ],
  });
}

test("a message to a messageable Jules session lands on its sendMessage method", async () => {
  const posts: Array<{ url: string; body: string }> = [];
  const answer = await executeMessageAct({
    providerId: "jules",
    providerSessionId: "jules-1",
    text: "please continue",
    apiKey: "key-1",
    seams: {
      fetch: async (url, init) => {
        if (init.method === "POST") {
          posts.push({ url, body: String(init.body) });
          return new Response("{}", { status: 200 });
        }
        return new Response(julesListing("IN_PROGRESS"), { status: 200 });
      },
    },
  });

  assert.equal(answer.result, "accepted");
  assert.equal(posts.length, 1);
  assert.match(posts[0]?.url ?? "", /\/v1alpha\/sessions\/jules-1:sendMessage$/);
  assert.deepEqual(JSON.parse(posts[0]?.body ?? ""), { prompt: "please continue" });
});

test("a message to a settled Jules session is rejected without a write", async () => {
  const answer = await executeMessageAct({
    providerId: "jules",
    providerSessionId: "jules-1",
    text: "hello",
    apiKey: "key-1",
    seams: {
      fetch: async (_url, init) => {
        assert.notEqual(init.method, "POST", "a rejected act must not write");
        return new Response(julesListing("COMPLETED"), { status: 200 });
      },
    },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /not currently accepting messages/);
});

test("a message to a session the fresh pass did not observe is rejected", async () => {
  const answer = await executeMessageAct({
    providerId: "jules",
    providerSessionId: "jules-9",
    text: "hello",
    apiKey: "key-1",
    seams: {
      fetch: async () => new Response(julesListing("IN_PROGRESS"), { status: 200 }),
    },
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, "Session not found.");
});

test("a key the provider refuses is named as the reason, not a missing session", async () => {
  const answer = await executeMessageAct({
    providerId: "jules",
    providerSessionId: "jules-1",
    text: "hello",
    apiKey: "key-1",
    seams: { fetch: async () => new Response("{}", { status: 401 }) },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /rejected the stored API key/);
});

test("a provider that cannot be reached is named as the reason", async () => {
  const answer = await executeMessageAct({
    providerId: "jules",
    providerSessionId: "jules-1",
    text: "hello",
    apiKey: "key-1",
    seams: {
      fetch: async () => {
        throw new Error("connection refused");
      },
    },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /Could not reach Jules/);
});

test("an advertised control runs through the provider's documented endpoint", async () => {
  const posts: string[] = [];
  const answer = await executeControlAct({
    providerId: "jules",
    providerSessionId: "jules-1",
    controlId: "approve-plan",
    apiKey: "key-1",
    seams: {
      fetch: async (url, init) => {
        if (init.method === "POST") {
          posts.push(url);
          return new Response("{}", { status: 200 });
        }
        return new Response(julesListing("AWAITING_PLAN_APPROVAL"), { status: 200 });
      },
    },
  });

  assert.equal(answer.result, "accepted");
  assert.deepEqual(
    posts.map((url) => url.endsWith("/v1alpha/sessions/jules-1:approvePlan")),
    [true],
  );
});

test("a control the fresh pass did not advertise is rejected without a write", async () => {
  const answer = await executeControlAct({
    providerId: "jules",
    providerSessionId: "jules-1",
    controlId: "approve-plan",
    apiKey: "key-1",
    seams: {
      fetch: async (_url, init) => {
        assert.notEqual(init.method, "POST", "an unadvertised control must not write");
        return new Response(julesListing("IN_PROGRESS"), { status: 200 });
      },
    },
  });

  assert.equal(answer.result, "rejected");
  assert.match(answer.reason ?? "", /not currently offered/);
});

test("a Cursor workspace creation awaits the project list and delivers the task inline", async () => {
  const posts: Array<{ url: string; body: string }> = [];
  const answer = await executeCreateWorkspaceAct({
    providerId: "cursor",
    providerProjectId: "https://github.com/owner/repo",
    name: "Fix the flaky test",
    task: "Fix the flaky test in CI",
    apiKey: "key-1",
    seams: {
      fetch: async (url, init) => {
        if (init.method === "POST") {
          posts.push({ url, body: String(init.body) });
          return new Response(JSON.stringify({ agent: { id: "agent-9" } }), { status: 200 });
        }
        if (url.includes("/v1/repositories")) {
          return new Response(
            JSON.stringify({ items: [{ url: "https://github.com/owner/repo" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    },
  });

  assert.equal(answer.result, "accepted");
  assert.equal(answer.providerSessionId, "agent-9");
  assert.equal(posts.length, 1);
  assert.match(posts[0]?.url ?? "", /\/v1\/agents$/);
  const body = JSON.parse(posts[0]?.body ?? "");
  assert.deepEqual(body.prompt, { text: "Fix the flaky test in CI" });
  assert.deepEqual(body.repos, [{ url: "https://github.com/owner/repo" }]);
});

test("a workspace creation naming an unreported project is rejected without a write", async () => {
  const answer = await executeCreateWorkspaceAct({
    providerId: "cursor",
    providerProjectId: "https://github.com/owner/other",
    name: undefined,
    task: "Do the thing",
    apiKey: "key-1",
    seams: {
      fetch: async (url, init) => {
        assert.notEqual(init.method, "POST", "an unreported project must not be created in");
        if (url.includes("/v1/repositories")) {
          return new Response(
            JSON.stringify({ items: [{ url: "https://github.com/owner/repo" }] }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    },
  });

  assert.equal(answer.result, "rejected");
  assert.equal(answer.reason, "Project not found.");
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

test("a selection for a provider with no table is an invalid request", async () => {
  const response = await handleActWorkspace(
    workspaceOptions({
      request: workspaceRequest({
        providerId: "cursor",
        providerProjectId: "https://github.com/owner/repo",
        task: "build the thing",
        agent: "claude",
        model: "fable-5",
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
