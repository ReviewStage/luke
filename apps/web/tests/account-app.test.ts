import assert from "node:assert/strict";
import path from "node:path";
import { HttpApp } from "@effect/platform";
import { PROVIDER_ID } from "@sidecar/session";
import type { WireBoundaryInput } from "@sidecar/wire";
import { type FakeResponder, fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Redacted } from "effect";
import { test } from "vitest";
import { type AccountAppSeams, accountApp } from "../server/account-app.js";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "../server/core.js";
import { handleAccountDelete } from "../server/hosted/account-delete.js";
import {
  type AccountPreferencesRow,
  type HostedAccountPreferences,
  handleAccountPreferencesRead,
  handleAccountPreferencesWrite,
} from "../server/hosted/account-preferences.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import {
  type RecordedResponse,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The account group carries the same answers `server/hosted/account-delete.ts`
 * and `server/hosted/account-preferences.ts` always gave, over the group
 * shape in `server/account-app.ts`. Each case answers twice, once through the
 * group — with the deployment's environment handed in rather than read, the
 * way `tests/support/brain-call.ts` hands it to the brain group — and once by
 * calling the promise-shaped handler the way the route called it before the
 * conversion, on a backing store built the same way for both, and the two
 * recordings are compared; the goldens beside them are the bytes themselves,
 * so a later change to the group cannot move them silently.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/account-route");

const ORIGIN = "https://luke.test";
const NOW = new Date("2026-09-08T12:00:00.000Z");
const VALID_AUTHORIZATION = "Bearer token-1";
const USER_ID = "user-1";

const ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  brainModel: undefined,
  prefetchModel: undefined,
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

function resolveUserId(request: Request): Promise<string | undefined> {
  return Promise.resolve(
    request.headers.get("authorization") === VALID_AUTHORIZATION ? USER_ID : undefined,
  );
}

function deleteUser(state: Backing) {
  return async (userId: string) => {
    state.deleted.push(userId);
  };
}

/** The promise-shaped handler's own analytics seam, unaffected by the group's move onto `HostedEnvironment`. */
function forgetAnalytics(state: Backing) {
  return async (userId: string) => {
    if (state.forgetAnalyticsFails) throw new Error("processor unreachable");
    state.forgotten.push(userId);
  };
}

/** The group's analytics transport: the same success or failure, reached through the injected client instead. */
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
    deleteUser: deleteUser(state),
    readPreferences: readPreferences(state),
    writePreferences: writePreferences(state),
  };
}

/** The group's answer, with the deployment's environment handed in directly rather than read from `process.env`. */
function groupAnswer(state: Backing, request: Request): Promise<Response> {
  const handler = HttpApp.toWebHandler(
    accountApp(groupSeams(state)).pipe(
      Effect.provideService(HostedEnvironment, ENVIRONMENT),
      Effect.provide(fakeHttpClientLayer(forgetAnalyticsResponder(state))),
    ),
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

const WRITE_BODY = {
  preferences: {
    voice: REALTIME_VOICE.MARIN,
    voiceSpeed: REALTIME_VOICE_SPEED.FAST,
    defaultWorkspaceProvider: PROVIDER_ID.CONDUCTOR,
    workspaceProjectDefaults: { conductor: "project-1" },
    workspaceAgentDefaults: { conductor: { agent: "codex", model: "gpt-5.6-sol", effort: "high" } },
  },
};

const TRANSPORT_HEADER = { CONTENT_LENGTH: "content-length" } as const;

/**
 * `HttpServerResponse.unsafeJson` states a body's length on the response the
 * platform hands back; `jsonResponse`'s plain `Response` leaves the wire
 * transport to state it instead, the way the promise-shaped handlers always
 * relied on Vercel's own runtime to. The value is checked against the body it
 * frames before it is dropped, so a byte the platform computed wrong would
 * still fail, and both sides reach the same bytes on the actual wire.
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
  direct: (state: Backing, request: Request) => Promise<Response>;
}

const EXCHANGES: readonly Exchange[] = [
  {
    name: "delete-success",
    state: () => backing(),
    request: deleteRequest,
    direct: (state, request) =>
      handleAccountDelete({
        request,
        resolveUserId,
        deleteUser: deleteUser(state),
        forgetAnalytics: forgetAnalytics(state),
      }),
  },
  {
    name: "delete-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/delete`, { method: "GET" }),
    direct: (state, request) =>
      handleAccountDelete({ request, resolveUserId, deleteUser: deleteUser(state) }),
  },
  {
    name: "delete-invalid-token",
    state: () => backing(),
    request: () => deleteRequest({}),
    direct: (state, request) =>
      handleAccountDelete({ request, resolveUserId, deleteUser: deleteUser(state) }),
  },
  {
    name: "delete-analytics-failure",
    state: () => backing({ forgetAnalyticsFails: true }),
    request: deleteRequest,
    direct: (state, request) =>
      handleAccountDelete({
        request,
        resolveUserId,
        deleteUser: deleteUser(state),
        forgetAnalytics: forgetAnalytics(state),
      }),
  },
  {
    name: "preferences-read",
    state: () =>
      backing({
        stored: new Map([[USER_ID, { preferences: STORED_PREFERENCES, updatedAt: NOW }]]),
      }),
    request: preferencesReadRequest,
    direct: (state, request) =>
      handleAccountPreferencesRead({
        request,
        resolveUserId,
        readPreferences: readPreferences(state),
      }),
  },
  {
    name: "preferences-read-empty",
    state: () => backing(),
    request: preferencesReadRequest,
    direct: (state, request) =>
      handleAccountPreferencesRead({
        request,
        resolveUserId,
        readPreferences: readPreferences(state),
      }),
  },
  {
    name: "preferences-read-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/preferences`, { method: "POST" }),
    direct: (state, request) =>
      handleAccountPreferencesRead({
        request,
        resolveUserId,
        readPreferences: readPreferences(state),
      }),
  },
  {
    name: "preferences-read-invalid-token",
    state: () => backing(),
    request: () => preferencesReadRequest({}),
    direct: (state, request) =>
      handleAccountPreferencesRead({
        request,
        resolveUserId,
        readPreferences: readPreferences(state),
      }),
  },
  {
    name: "preferences-write",
    state: () => backing(),
    request: () => preferencesWriteRequest(WRITE_BODY),
    direct: (state, request) =>
      handleAccountPreferencesWrite({
        request,
        resolveUserId,
        writePreferences: writePreferences(state),
      }),
  },
  {
    name: "preferences-write-invalid-body",
    state: () => backing(),
    request: () => preferencesWriteRequest(undefined),
    direct: (state, request) =>
      handleAccountPreferencesWrite({
        request,
        resolveUserId,
        writePreferences: writePreferences(state),
      }),
  },
  {
    name: "preferences-write-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/preferences`, { method: "DELETE" }),
    direct: (state, request) =>
      handleAccountPreferencesWrite({
        request,
        resolveUserId,
        writePreferences: writePreferences(state),
      }),
  },
];

test("the group answers what the promise-shaped handler answered, byte for byte", async () => {
  for (const exchange of EXCHANGES) {
    const directState = exchange.state();
    const direct = await answered(await exchange.direct(directState, exchange.request()));

    const groupState = exchange.state();
    const carried = await answered(await groupAnswer(groupState, exchange.request()));

    assert.deepEqual(carried, direct);
    assert.deepEqual(groupState, directState);
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
