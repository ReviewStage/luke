import assert from "node:assert/strict";
import path from "node:path";
import { PROVIDER_ID } from "@sidecar/session";
import type { WireBoundaryInput } from "@sidecar/wire";
import { type FakeResponder, fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { test } from "vitest";
import { type AccountAppSeams, accountApp } from "../server/account-app.js";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "../server/core.js";
import type {
  AccountPreferencesRow,
  HostedAccountPreferences,
} from "../server/hosted/account-preferences.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import { noDatabase } from "./support/no-database.js";
import {
  type RecordedResponse,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The account group's two endpoints, over the shape in `server/account-app.ts`.
 * Each case runs the group once — with the deployment's environment handed in
 * rather than read, the way `tests/support/mint-call.ts` hands it to the
 * mint group — against a fresh backing store, and asserts both the bytes the
 * answer carries and what the backing store ends up holding; the goldens
 * beside the bytes are the answer itself, so a later change to the group
 * cannot move them silently.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/account-route");

const ORIGIN = "https://luke.test";
const NOW = new Date("2026-09-08T12:00:00.000Z");
const VALID_AUTHORIZATION = "Bearer token-1";
const USER_ID = "user-1";

const ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  realtimeModel: undefined,
  posthogPersonalApiKey: Redacted.make("posthog-personal-key"),
  posthogProjectId: "posthog-project-1",
  posthogApiHost: undefined,
  providerKeyEncryptionSecret: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  apnsCredentials: undefined,
};

interface Backing {
  deleted: string[];
  forgotten: string[];
  stored: Map<string, AccountPreferencesRow>;
  forgetAnalyticsFails: boolean;
}

function backing(overrides: Partial<Backing> = {}): Backing {
  return {
    deleted: [],
    forgotten: [],
    stored: new Map(),
    forgetAnalyticsFails: false,
    ...overrides,
  };
}

function resolveUserId(request: Request): Effect.Effect<string | undefined> {
  return Effect.succeed(
    request.headers.get("authorization") === VALID_AUTHORIZATION ? USER_ID : undefined,
  );
}

function deleteUser(state: Backing) {
  return async (userId: string) => {
    state.deleted.push(userId);
  };
}

/** The group's analytics transport: forwarded through the injected HTTP client. */
function forgetAnalyticsResponder(state: Backing): FakeResponder {
  return async () => {
    if (state.forgetAnalyticsFails) throw new Error("processor unreachable");
    state.forgotten.push(USER_ID);
    return new Response(null, { status: 200 });
  };
}

function readPreferences(state: Backing) {
  return async (userId: string): Promise<AccountPreferencesRow | undefined> =>
    state.stored.get(userId);
}

function writePreferences(state: Backing) {
  return async (userId: string, preferences: HostedAccountPreferences): Promise<Date> => {
    state.stored.set(userId, { preferences, updatedAt: NOW });
    return NOW;
  };
}

function groupSeams(state: Backing): AccountAppSeams {
  return {
    resolveUserId,
    deleteUser: (userId) => Effect.promise(() => deleteUser(state)(userId)),
    readPreferences: (userId) => Effect.promise(() => readPreferences(state)(userId)),
    writePreferences: (userId, preferences) =>
      Effect.promise(() => writePreferences(state)(userId, preferences)),
  };
}

/** The group's answer, with the deployment's environment handed in directly rather than read from `process.env`. */
function groupAnswer(state: Backing, request: Request): Promise<Response> {
  const { handler } = HttpRouter.toWebHandler(
    accountApp(groupSeams(state)).pipe(
      HttpRouter.provideRequest(Layer.succeed(HostedEnvironment, ENVIRONMENT)),
      HttpRouter.provideRequest(fakeHttpClientLayer(forgetAnalyticsResponder(state))),
      HttpRouter.provideRequest(noDatabase),
    ),
    { disableLogger: true },
  );
  return handler(request);
}

function deleteRequest(
  headers: Record<string, string> = { authorization: VALID_AUTHORIZATION },
): Request {
  return new Request(`${ORIGIN}/api/account/delete`, { method: "POST", headers });
}

function preferencesReadRequest(
  headers: Record<string, string> = { authorization: VALID_AUTHORIZATION },
): Request {
  return new Request(`${ORIGIN}/api/account/preferences`, { method: "GET", headers });
}

function preferencesWriteRequest(
  body: WireBoundaryInput | undefined,
  headers: Record<string, string> = {
    authorization: VALID_AUTHORIZATION,
    "content-type": "application/json",
  },
): Request {
  const init: RequestInit = { method: "PUT", headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`${ORIGIN}/api/account/preferences`, init);
}

const STORED_PREFERENCES: HostedAccountPreferences = {
  voice: REALTIME_VOICE.CORAL,
  voiceSpeed: REALTIME_VOICE_SPEED.QUICK,
};

const WRITTEN_PREFERENCES = {
  voice: REALTIME_VOICE.MARIN,
  voiceSpeed: REALTIME_VOICE_SPEED.FAST,
  defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
  workspaceProjectDefaults: { conductor: "project-1" },
  workspaceAgentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" } },
} satisfies HostedAccountPreferences;

const WRITE_BODY = { preferences: WRITTEN_PREFERENCES };

const TRANSPORT_HEADER = { CONTENT_LENGTH: "content-length" } as const;

/**
 * `HttpServerResponse.jsonUnsafe` states a body's length on the response the
 * platform hands back, which the wire transport would otherwise state for
 * itself; the value is checked against the body it frames before it is
 * dropped, so a byte the platform computed wrong would still fail.
 */
async function answered(response: Response): Promise<RecordedResponse> {
  const recorded = await recordedResponse(response);
  const framed = recorded.headers.find(([name]) => name === TRANSPORT_HEADER.CONTENT_LENGTH);
  if (framed) assert.equal(Number(framed[1]), new TextEncoder().encode(recorded.body).byteLength);
  return {
    ...recorded,
    headers: recorded.headers.filter(([name]) => name !== TRANSPORT_HEADER.CONTENT_LENGTH),
  };
}

interface Exchange {
  name: string;
  state: () => Backing;
  request: () => Request;
  /** What the backing store holds once the group has answered. */
  finalState: () => Backing;
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "delete-success",
    state: () => backing(),
    request: deleteRequest,
    finalState: () => backing({ deleted: [USER_ID], forgotten: [USER_ID] }),
  },
  {
    name: "delete-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/delete`, { method: "GET" }),
    finalState: () => backing(),
  },
  {
    name: "delete-invalid-token",
    state: () => backing(),
    request: () => deleteRequest({}),
    finalState: () => backing(),
  },
  {
    name: "delete-analytics-failure",
    state: () => backing({ forgetAnalyticsFails: true }),
    request: deleteRequest,
    finalState: () => backing({ deleted: [USER_ID], forgetAnalyticsFails: true }),
  },
  {
    name: "preferences-read",
    state: () =>
      backing({
        stored: new Map([[USER_ID, { preferences: STORED_PREFERENCES, updatedAt: NOW }]]),
      }),
    request: preferencesReadRequest,
    finalState: () =>
      backing({
        stored: new Map([[USER_ID, { preferences: STORED_PREFERENCES, updatedAt: NOW }]]),
      }),
  },
  {
    name: "preferences-read-empty",
    state: () => backing(),
    request: preferencesReadRequest,
    finalState: () => backing(),
  },
  {
    name: "preferences-read-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/preferences`, { method: "POST" }),
    finalState: () => backing(),
  },
  {
    name: "preferences-read-invalid-token",
    state: () => backing(),
    request: () => preferencesReadRequest({}),
    finalState: () => backing(),
  },
  {
    name: "preferences-write",
    state: () => backing(),
    request: () => preferencesWriteRequest(WRITE_BODY),
    finalState: () =>
      backing({
        stored: new Map([[USER_ID, { preferences: WRITTEN_PREFERENCES, updatedAt: NOW }]]),
      }),
  },
  {
    name: "preferences-write-invalid-body",
    state: () => backing(),
    request: () => preferencesWriteRequest(undefined),
    finalState: () => backing(),
  },
  {
    name: "preferences-write-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/preferences`, { method: "DELETE" }),
    finalState: () => backing(),
  },
];

test("the group answers the recorded bytes and leaves the backing store as expected", async () => {
  for (const exchange of EXCHANGES) {
    const state = exchange.state();
    const carried = await answered(await groupAnswer(state, exchange.request()));

    assert.deepEqual(state, exchange.finalState());
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
  }
});

test("a path the group declares no route for is refused without reaching either endpoint", async () => {
  const state = backing();
  const response = await groupAnswer(state, new Request(`${ORIGIN}/api/account/not-a-route`));
  const carried = await answered(response);

  assert.deepEqual(state, backing());
  assert.equal(carried.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  await settleResponseGolden(GOLDEN_ROOT, "route-not-found", carried);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = [...EXCHANGES.map((exchange) => exchange.name), "route-not-found"].sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
