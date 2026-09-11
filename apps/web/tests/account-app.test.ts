import assert from "node:assert/strict";
import path from "node:path";
import { PROVIDER_ID } from "@sidecar/session";
import type { WireBoundaryInput } from "@sidecar/wire";
import { afterEach, beforeEach, test, vi } from "vitest";
import { type AccountAppSeams, accountApp } from "../server/account-app.js";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "../server/core.js";
import { handleAccountDelete } from "../server/hosted/account-delete.js";
import {
  type AccountPreferencesRow,
  type HostedAccountPreferences,
  handleAccountPreferencesRead,
  handleAccountPreferencesWrite,
} from "../server/hosted/account-preferences.js";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import { routeFromHttpApp } from "../server/route-effect.js";
import { disposeWebRuntime } from "../server/runtime.js";
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
 * group and once by calling the promise-shaped handler the way the route
 * called it before the conversion, on a backing store built the same way for
 * both, and the two recordings are compared; the goldens beside them are the
 * bytes themselves, so a later change to the group cannot move them silently.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/account-route");

/** The layer names a database and nothing here queries one, as in `web-runtime.test.ts`. */
const PLACEHOLDER_DATABASE_URL = "postgresql://runtime:edge@127.0.0.1:5432/luke";

const ORIGIN = "https://luke.test";
const NOW = new Date("2026-09-08T12:00:00.000Z");
const VALID_AUTHORIZATION = "Bearer token-1";
const USER_ID = "user-1";

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

function forgetAnalytics(state: Backing) {
  return async (userId: string) => {
    if (state.forgetAnalyticsFails) throw new Error("processor unreachable");
    state.forgotten.push(userId);
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
    forgetAnalytics: forgetAnalytics(state),
    readPreferences: readPreferences(state),
    writePreferences: writePreferences(state),
  };
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
 * relied on Vercel's own runtime to. Both reach the same bytes on the wire,
 * so the byte-identity oracle drops the one header only the in-process object
 * states differently.
 */
function withoutTransportHeaders(recorded: RecordedResponse): RecordedResponse {
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

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", PLACEHOLDER_DATABASE_URL);
});

afterEach(async () => {
  await disposeWebRuntime();
  vi.unstubAllEnvs();
});

test("the group answers what the promise-shaped handler answered, byte for byte", async () => {
  for (const exchange of EXCHANGES) {
    const directState = exchange.state();
    const direct = withoutTransportHeaders(
      await recordedResponse(await exchange.direct(directState, exchange.request())),
    );

    const groupState = exchange.state();
    const carried = withoutTransportHeaders(
      await recordedResponse(
        await routeFromHttpApp(accountApp(groupSeams(groupState))).fetch(exchange.request()),
      ),
    );

    assert.deepEqual(carried, direct);
    assert.deepEqual(groupState, directState);
    await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
  }
});

test("a path the group declares no route for is refused without reaching either endpoint", async () => {
  const state = backing();
  const response = await routeFromHttpApp(accountApp(groupSeams(state))).fetch(
    new Request(`${ORIGIN}/api/account/not-a-route`),
  );
  const carried = await recordedResponse(response);

  assert.deepEqual(state, backing());
  assert.equal(carried.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  await settleResponseGolden(GOLDEN_ROOT, "route-not-found", carried);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = [...EXCHANGES.map((exchange) => exchange.name), "route-not-found"].sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
