import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_VOICE } from "@sidecar/realtime";
import { PROVIDER_ID } from "@sidecar/session";
import type { AccountPreferences } from "@sidecar/settings";
import type { WireBoundaryInput } from "@sidecar/wire";
import {
  type AccountPreferencesRow,
  handleAccountPreferencesRead,
  handleAccountPreferencesWrite,
} from "../server/hosted/account-preferences";
import { HOSTED_API_ERROR } from "../server/hosted/http";

const NOW = new Date("2026-09-08T12:00:00.000Z");

function readRequest(headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/account/preferences", {
    method: "GET",
    headers: { authorization: "Bearer token-1", ...headers },
  });
}

function writeRequest(body?: WireBoundaryInput, headers: Record<string, string> = {}): Request {
  return new Request("https://luke.test/api/account/preferences", {
    method: "PUT",
    headers: { authorization: "Bearer token-1", "content-type": "application/json", ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function readOptions(overrides: Partial<Parameters<typeof handleAccountPreferencesRead>[0]> = {}) {
  return {
    request: readRequest(),
    resolveUserId: async () => "user-1",
    readPreferences: async (_userId: string): Promise<AccountPreferencesRow | undefined> => ({
      preferences: { voice: REALTIME_VOICE.MARIN },
      updatedAt: NOW,
    }),
    ...overrides,
  };
}

function writeOptions(
  overrides: Partial<Parameters<typeof handleAccountPreferencesWrite>[0]> = {},
) {
  return {
    request: writeRequest({ preferences: { voice: REALTIME_VOICE.SAGE } }),
    resolveUserId: async () => "user-1",
    writePreferences: async (_userId: string, _preferences: AccountPreferences) => NOW,
    ...overrides,
  };
}

test("the account preferences read gate order is method then token", async () => {
  const wrongMethod = await handleAccountPreferencesRead(
    readOptions({
      request: new Request("https://luke.test/api/account/preferences", { method: "POST" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleAccountPreferencesRead(
    readOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);
});

test("reading account preferences returns the stored snapshot", async () => {
  const response = await handleAccountPreferencesRead(
    readOptions({
      readPreferences: async () => ({
        preferences: {
          voice: REALTIME_VOICE.CORAL,
          defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
        },
        updatedAt: NOW,
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    preferences: { voice: REALTIME_VOICE.CORAL, defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR },
    updatedAt: NOW.getTime(),
  });
});

test("reading with no stored row returns an empty preferences snapshot", async () => {
  const response = await handleAccountPreferencesRead(
    readOptions({ readPreferences: async () => undefined }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { preferences: {} });
});

test("the account preferences write gate order is method, token, then body", async () => {
  const wrongMethod = await handleAccountPreferencesWrite(
    writeOptions({
      request: new Request("https://luke.test/api/account/preferences", { method: "GET" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const anonymous = await handleAccountPreferencesWrite(
    writeOptions({ resolveUserId: async () => undefined }),
  );
  assert.equal(anonymous.status, 401);

  const noBody = await handleAccountPreferencesWrite(
    writeOptions({
      request: new Request("https://luke.test/api/account/preferences", {
        method: "PUT",
        headers: { authorization: "Bearer t" },
      }),
    }),
  );
  assert.equal(noBody.status, 400);
  assert.equal((await noBody.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
});

test("writing account preferences validates and stores a full snapshot", async () => {
  let stored: { userId: string; preferences: AccountPreferences } | undefined;

  const response = await handleAccountPreferencesWrite(
    writeOptions({
      request: writeRequest({
        preferences: {
          voice: REALTIME_VOICE.MARIN,
          defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
          workspaceProjectDefaults: { conductor: "project-1" },
          workspaceAgentDefaults: {
            conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" },
          },
        },
      }),
      writePreferences: async (userId, preferences) => {
        stored = { userId, preferences };
        return NOW;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(stored, {
    userId: "user-1",
    preferences: {
      voice: REALTIME_VOICE.MARIN,
      defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
      workspaceProjectDefaults: { conductor: "project-1" },
      workspaceAgentDefaults: {
        conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" },
      },
    },
  });
  assert.deepEqual(await response.json(), {
    preferences: stored?.preferences,
    updatedAt: NOW.getTime(),
  });
});

test("omitted and null account preference fields clear the stored value", async () => {
  let stored: AccountPreferences | undefined;

  const response = await handleAccountPreferencesWrite(
    writeOptions({
      request: writeRequest({
        preferences: {
          voice: null,
          workspaceProjectDefaults: { conductor: "project-2" },
        },
      }),
      writePreferences: async (_userId, preferences) => {
        stored = preferences;
        return NOW;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(stored, {
    workspaceProjectDefaults: { conductor: "project-2" },
  });
});

test("writes reject unknown or invalid preferences instead of storing arbitrary text", async () => {
  const unknown = await handleAccountPreferencesWrite(
    writeOptions({
      request: writeRequest({ preferences: { sessionSearchQuery: "branch name" } }),
    }),
  );
  assert.equal(unknown.status, 400);

  const invalid = await handleAccountPreferencesWrite(
    writeOptions({ request: writeRequest({ preferences: { voice: "baritone" } }) }),
  );
  assert.equal(invalid.status, 400);

  const trimmedMap = await handleAccountPreferencesWrite(
    writeOptions({
      request: writeRequest({
        preferences: { workspaceProjectDefaults: { conductor: "project-1", future: "project-2" } },
      }),
    }),
  );
  assert.equal(trimmedMap.status, 400);
});

test("a phone's retired pace field is dropped at the door rather than refusing its snapshot", async () => {
  let stored: { userId: string; preferences: AccountPreferences } | undefined;

  const response = await handleAccountPreferencesWrite(
    writeOptions({
      request: writeRequest({
        preferences: { voice: REALTIME_VOICE.MARIN, voiceSpeed: 1.25 },
      }),
      writePreferences: async (userId, preferences) => {
        stored = { userId, preferences };
        return NOW;
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(stored?.preferences, { voice: REALTIME_VOICE.MARIN });
  assert.deepEqual(Object.keys((await response.json()).preferences), ["voice"]);
});
