import assert from "node:assert/strict";
import test from "node:test";
import { handleActMessage } from "../server/hosted/act-message";
import { handleActWorkspace } from "../server/hosted/act-workspace";
import { encryptProviderKey } from "../server/hosted/encryption";

const SECRET = "a".repeat(64);

function messageRequest(fields: Record<string, string>): Request {
  return new Request("https://luke.test/api/acts/message", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

function workspaceRequest(fields: Record<string, string>): Request {
  return new Request("https://luke.test/api/acts/workspace", {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
}

function messageOptions(
  overrides: Partial<Parameters<typeof handleActMessage>[0]> = {},
): Parameters<typeof handleActMessage>[0] {
  return {
    request: messageRequest({
      providerId: "conductor",
      providerSessionId: "session-1",
      text: "hello",
    }),
    encryptionSecret: SECRET,
    resolveUserId: async () => "user-1",
    readKey: async () => ({ ciphertext: encryptProviderKey("key-1", SECRET) }),
    unsupportedReason: () => undefined,
    executeMessage: async () => ({ result: "accepted" }),
    ...overrides,
  };
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
  const response = await handleActMessage(
    messageOptions({
      request: messageRequest({
        providerId: "devin",
        providerSessionId: "session-1",
        text: "hello",
      }),
      unsupportedReason: (providerId) =>
        providerId === "conductor" ? undefined : "Not yet available.",
      readKey: async () => undefined,
      executeMessage: async () => {
        throw new Error("executeMessage must not run for an unsupported provider");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "unsupported");
  assert.equal(body.reason, "Not yet available.");
});

test("an unsupported workspace provider gets 'unsupported' even with no key stored", async () => {
  const response = await handleActWorkspace(
    workspaceOptions({
      request: workspaceRequest({ providerId: "devin", providerProjectId: "project-1" }),
      unsupportedReason: (providerId) =>
        providerId === "conductor" ? undefined : "Not yet available.",
      readKey: async () => undefined,
      executeCreateWorkspace: async () => {
        throw new Error("executeCreateWorkspace must not run for an unsupported provider");
      },
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "unsupported");
  assert.equal(body.reason, "Not yet available.");
});

// --- Supported provider with no key is still a rejection ---

test("a supported provider with no key stored gets 'rejected'", async () => {
  const response = await handleActMessage(messageOptions({ readKey: async () => undefined }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result, "rejected");
  assert.match(body.reason, /No provider key stored/);
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
