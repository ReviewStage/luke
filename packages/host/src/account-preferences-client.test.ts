import assert from "node:assert/strict";
import type { AccountPreferences } from "@sidecar/settings";
import { test } from "vitest";
import { AccountPreferencesClient } from "./account-preferences-client.js";

const PREFERENCES_ANSWER = {
  preferences: { voice: "marin", defaultWorkspaceProvider: "conductor" },
  updatedAt: 1_800_000_000_000,
};

interface RecordedRequest {
  url: string | URL | Request;
  init?: RequestInit;
}

function service(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, fetchLike };
}

function client(options: Partial<ConstructorParameters<typeof AccountPreferencesClient>[0]> = {}) {
  return new AccountPreferencesClient({
    serviceBaseUrl: "https://tryluke.dev",
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    ...options,
  });
}

test("reads account preferences as a bearer-authenticated GET", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(PREFERENCES_ANSWER), { status: 200 }),
  ]);

  const answer = await client({ fetch: fetchLike }).readPreferences();
  assert.deepEqual(answer, {
    preferences: PREFERENCES_ANSWER.preferences,
    hasStoredSnapshot: true,
  });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/account/preferences");
  assert.equal(request?.init?.method, "GET");
  assert.equal(request?.init?.body, undefined);
  assert.equal(new Headers(request?.init?.headers).get("authorization"), "Bearer token-1");
  assert.equal(new Headers(request?.init?.headers).get("content-type"), null);
});

test("reads a missing hosted row as an empty snapshot without a stored marker", async () => {
  const { fetchLike } = service([
    () => new Response(JSON.stringify({ preferences: {} }), { status: 200 }),
  ]);

  assert.deepEqual(await client({ fetch: fetchLike }).readPreferences(), {
    preferences: {},
    hasStoredSnapshot: false,
  });
});

test("writes account preferences as a full snapshot", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(PREFERENCES_ANSWER), { status: 200 }),
  ]);

  const answer = await client({ fetch: fetchLike }).writePreferences({
    voice: "marin",
    defaultWorkspaceProvider: "conductor",
  });
  assert.deepEqual(answer, {
    preferences: PREFERENCES_ANSWER.preferences,
    hasStoredSnapshot: true,
  });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/account/preferences");
  assert.equal(request?.init?.method, "PUT");
  assert.equal(new Headers(request?.init?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    preferences: { voice: "marin", defaultWorkspaceProvider: "conductor" },
  });
});

test("a malformed account preferences payload never travels", async () => {
  const { requests, fetchLike } = service([]);

  // SAFETY: This deliberately bypasses the public AccountPreferences type to verify the runtime guard.
  const malformed = { voiceHotkey: "Command+Space" } as AccountPreferences;

  assert.equal(await client({ fetch: fetchLike }).writePreferences(malformed), undefined);
  assert.equal(requests.length, 0);
});

test("a refusal and a snapshot the settings vocabulary does not admit read as no answer", async () => {
  const refused = client({
    fetch: async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
  });
  assert.equal(await refused.writePreferences({ voice: "sage" }), undefined);

  const malformed = client({
    fetch: async () => new Response(JSON.stringify({ preferences: "none" }), { status: 200 }),
  });
  assert.equal(await malformed.readPreferences(), undefined);

  const unknownField = client({
    fetch: async () =>
      new Response(JSON.stringify({ preferences: { voiceHotkey: "Command+Space" } }), {
        status: 200,
      }),
  });
  assert.equal(await unknownField.readPreferences(), undefined);
});
