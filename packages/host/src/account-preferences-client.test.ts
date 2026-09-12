import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AccountPreferences } from "@sidecar/settings";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect } from "effect";
import { AccountPreferencesClient } from "./account-preferences-client.js";

const PREFERENCES_ANSWER = {
  preferences: { voice: "marin", defaultWorkspaceProvider: "conductor" },
  updatedAt: 1_800_000_000_000,
};

interface RecordedRequest {
  url: string | URL | Request;
  init: RequestInit | undefined;
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
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    ...options,
  });
}

it.effect("reads account preferences as a bearer-authenticated GET", () =>
  Effect.gen(function* () {
    const { requests, fetchLike } = service([
      () => new Response(JSON.stringify(PREFERENCES_ANSWER), { status: 200 }),
    ]);

    const answer = yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).readPreferences();
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
  }),
);

it.effect("reads a missing hosted row as an empty snapshot without a stored marker", () =>
  Effect.gen(function* () {
    const { fetchLike } = service([
      () => new Response(JSON.stringify({ preferences: {} }), { status: 200 }),
    ]);

    assert.deepEqual(
      yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).readPreferences(),
      {
        preferences: {},
        hasStoredSnapshot: false,
      },
    );
  }),
);

it.effect("writes account preferences as a full snapshot", () =>
  Effect.gen(function* () {
    const { requests, fetchLike } = service([
      () => new Response(JSON.stringify(PREFERENCES_ANSWER), { status: 200 }),
    ]);

    const answer = yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).writePreferences({
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
  }),
);

it.effect("a malformed account preferences payload never travels", () =>
  Effect.gen(function* () {
    const { requests, fetchLike } = service([]);

    // SAFETY: This deliberately bypasses the public AccountPreferences type to verify the runtime guard.
    const malformed = { voiceHotkey: "Command+Space" } as AccountPreferences;

    assert.equal(
      yield* client({ httpClient: fakeHttpClientLayer(fetchLike) }).writePreferences(malformed),
      undefined,
    );
    assert.equal(requests.length, 0);
  }),
);

it.effect("a refusal and a snapshot the settings vocabulary does not admit read as no answer", () =>
  Effect.gen(function* () {
    const refused = client({
      httpClient: fakeHttpClientLayer(
        async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }),
      ),
    });
    assert.equal(yield* refused.writePreferences({ voice: "sage" }), undefined);

    const malformed = client({
      httpClient: fakeHttpClientLayer(
        async () => new Response(JSON.stringify({ preferences: "none" }), { status: 200 }),
      ),
    });
    assert.equal(yield* malformed.readPreferences(), undefined);

    const unknownField = client({
      httpClient: fakeHttpClientLayer(
        async () =>
          new Response(JSON.stringify({ preferences: { voiceHotkey: "Command+Space" } }), {
            status: 200,
          }),
      ),
    });
    assert.equal(yield* unknownField.readPreferences(), undefined);
  }),
);
