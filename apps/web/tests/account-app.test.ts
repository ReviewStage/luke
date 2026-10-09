import assert from "node:assert/strict";
import path from "node:path";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import { LIVE_VOICE } from "@sidecar/live";
import type { AccountPreferences } from "@sidecar/settings";
import type { WireBoundaryInput } from "@sidecar/wire";
import { type FakeResponder, fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import { test } from "vitest";
import { type AccountAppSeams, accountApp } from "../server/account-app.js";
import type {
  AccountPreferencesRow,
  AccountPreferencesWrite,
} from "../server/hosted/account-store.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment.js";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import {
  CODING_AGENT_DEFAULT_CHOICE,
  ModelCatalog,
  ModelCatalogUnavailable,
  modelCatalogOf,
} from "../server/hosted/model-catalog.js";
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
 * rather than read — against a fresh backing store, and asserts both the bytes the
 * answer carries and what the backing store ends up holding; the goldens
 * beside the bytes are the answer itself, so a later change to the group
 * cannot move them silently. The model catalog is a fixed list handed in,
 * so a coding-agent choice is checked against models no network answered.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/account-route");

const ORIGIN = "https://luke.test";
const NOW = new Date("2026-09-08T12:00:00.000Z");
const VALID_AUTHORIZATION = "Bearer token-1";
const USER_ID = "user-1";

const ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: Redacted.make("posthog-personal-key"),
  posthogProjectId: "posthog-project-1",
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
};

/** The catalog every exchange checks a choice against: two models, each with its own efforts. */
const CATALOG: readonly CatalogModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
];

const SOL_AT_HIGH = { model: "openai/gpt-6.1-sol", effort: "high" } as const satisfies ModelChoice;

interface Backing {
  deleted: string[];
  forgotten: string[];
  stored: Map<string, AccountPreferencesRow>;
  forgetAnalyticsFails: boolean;
  /** The store refuses every statement, the way an unreachable database does. */
  storeUnavailable: boolean;
  /** The catalog cannot be read, the way an outage at AI Gateway reads. */
  catalogUnavailable: boolean;
}

function backing(overrides: Partial<Backing> = {}): Backing {
  return {
    deleted: [],
    forgotten: [],
    stored: new Map(),
    forgetAnalyticsFails: false,
    storeUnavailable: false,
    catalogUnavailable: false,
    ...overrides,
  };
}

/** A stored row: the preferences, and the coding-agent default where one was chosen. */
function row(
  preferences: AccountPreferences,
  codingAgent: ModelChoice = CODING_AGENT_DEFAULT_CHOICE,
): AccountPreferencesRow {
  return { preferences, codingAgent, updatedAt: NOW };
}

/** A row a coding-agent choice alone opened: no preferences were ever written, so no instant stands. */
function unsyncedRow(codingAgent: ModelChoice): AccountPreferencesRow {
  return { preferences: {}, codingAgent, updatedAt: undefined };
}

const STORE_UNAVAILABLE = new SqlError({
  reason: new UnknownError({
    cause: new Error("the fixture's database is unreachable"),
    message: "connection refused",
  }),
});

/** A seam over the backing store: the statement itself, or the store's refusal where it is unreachable. */
function overStore<A>(state: Backing, statement: () => Promise<A>): Effect.Effect<A, SqlError> {
  return state.storeUnavailable ? Effect.fail(STORE_UNAVAILABLE) : Effect.promise(statement);
}

function resolveUserId(request: Request): Effect.Effect<Option.Option<string>> {
  return Effect.succeed(
    request.headers.get("authorization") === VALID_AUTHORIZATION
      ? Option.some(USER_ID)
      : Option.none(),
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

/** Each part the write carries replaces its own; the row stands otherwise as it was, and the instant moves with the preferences. */
function writePreferences(state: Backing) {
  return async (userId: string, write: AccountPreferencesWrite): Promise<AccountPreferencesRow> => {
    const standing = state.stored.get(userId) ?? unsyncedRow(CODING_AGENT_DEFAULT_CHOICE);
    const written: AccountPreferencesRow = {
      preferences: write.preferences ?? standing.preferences,
      codingAgent: write.codingAgent ?? standing.codingAgent,
      updatedAt: write.preferences === undefined ? standing.updatedAt : NOW,
    };
    state.stored.set(userId, written);
    return written;
  };
}

/** The catalog as the group reads it: the fixed list, or the outage. */
function catalogLayer(state: Backing) {
  return state.catalogUnavailable
    ? Layer.succeed(ModelCatalog, {
        read: Effect.fail(new ModelCatalogUnavailable({ cause: new Error("gateway unreachable") })),
      })
    : modelCatalogOf(CATALOG);
}

function groupSeams(state: Backing): AccountAppSeams {
  return {
    resolveUserId,
    deleteUser: (userId) => overStore(state, () => deleteUser(state)(userId)),
    readPreferences: (userId) => overStore(state, () => readPreferences(state)(userId)),
    writePreferences: (userId, write) =>
      overStore(state, () => writePreferences(state)(userId, write)),
  };
}

/** The group's answer, with the deployment's environment handed in directly rather than read from `process.env`. */
function groupAnswer(state: Backing, request: Request): Promise<Response> {
  const { handler } = HttpRouter.toWebHandler(
    accountApp(groupSeams(state)).pipe(
      HttpRouter.provideRequest(Layer.succeed(HostedEnvironment, ENVIRONMENT)),
      HttpRouter.provideRequest(fakeHttpClientLayer(forgetAnalyticsResponder(state))),
      HttpRouter.provideRequest(catalogLayer(state)),
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

const STORED_PREFERENCES: AccountPreferences = { voice: LIVE_VOICE.CORAL };

const WRITTEN_PREFERENCES = { voice: LIVE_VOICE.MARIN } satisfies AccountPreferences;

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
    state: () => backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES)]]) }),
    request: preferencesReadRequest,
    finalState: () => backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES)]]) }),
  },
  {
    name: "preferences-read-chosen-model",
    state: () => backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES, SOL_AT_HIGH)]]) }),
    request: preferencesReadRequest,
    finalState: () =>
      backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES, SOL_AT_HIGH)]]) }),
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
    finalState: () => backing({ stored: new Map([[USER_ID, row(WRITTEN_PREFERENCES)]]) }),
  },
  // The preferences alone are written: the chosen default stands as it was.
  {
    name: "preferences-write-keeps-chosen-model",
    state: () => backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES, SOL_AT_HIGH)]]) }),
    request: () => preferencesWriteRequest(WRITE_BODY),
    finalState: () =>
      backing({ stored: new Map([[USER_ID, row(WRITTEN_PREFERENCES, SOL_AT_HIGH)]]) }),
  },
  {
    name: "preferences-write-coding-agent",
    state: () => backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES)]]) }),
    request: () => preferencesWriteRequest({ codingAgent: SOL_AT_HIGH }),
    finalState: () =>
      backing({ stored: new Map([[USER_ID, row(STORED_PREFERENCES, SOL_AT_HIGH)]]) }),
  },
  // A choice on an account that never synced its settings answers no instant, so a Mac still uploads its own.
  {
    name: "preferences-write-coding-agent-first",
    state: () => backing(),
    request: () => preferencesWriteRequest({ codingAgent: SOL_AT_HIGH }),
    finalState: () => backing({ stored: new Map([[USER_ID, unsyncedRow(SOL_AT_HIGH)]]) }),
  },
  {
    name: "preferences-write-both",
    state: () => backing(),
    request: () => preferencesWriteRequest({ ...WRITE_BODY, codingAgent: SOL_AT_HIGH }),
    finalState: () =>
      backing({ stored: new Map([[USER_ID, row(WRITTEN_PREFERENCES, SOL_AT_HIGH)]]) }),
  },
  {
    name: "preferences-write-unknown-model",
    state: () => backing(),
    request: () =>
      preferencesWriteRequest({
        codingAgent: { model: "anthropic/claude-opus-3", effort: "high" },
      }),
    finalState: () => backing(),
  },
  {
    name: "preferences-write-unknown-effort",
    state: () => backing(),
    request: () =>
      preferencesWriteRequest({ codingAgent: { model: SOL_AT_HIGH.model, effort: "max" } }),
    finalState: () => backing(),
  },
  {
    name: "preferences-write-malformed-choice",
    state: () => backing(),
    request: () => preferencesWriteRequest({ codingAgent: { model: SOL_AT_HIGH.model } }),
    finalState: () => backing(),
  },
  {
    name: "preferences-write-catalog-unavailable",
    state: () => backing({ catalogUnavailable: true }),
    request: () => preferencesWriteRequest({ codingAgent: SOL_AT_HIGH }),
    finalState: () => backing({ catalogUnavailable: true }),
  },
  {
    name: "preferences-write-invalid-body",
    state: () => backing(),
    request: () => preferencesWriteRequest(undefined),
    finalState: () => backing(),
  },
  // A body carrying neither part asks for nothing.
  {
    name: "preferences-write-empty-body",
    state: () => backing(),
    request: () => preferencesWriteRequest({}),
    finalState: () => backing(),
  },
  {
    name: "preferences-write-wrong-method",
    state: () => backing(),
    request: () => new Request(`${ORIGIN}/api/account/preferences`, { method: "DELETE" }),
    finalState: () => backing(),
  },
  // The store is unreachable: the erasure is refused as unavailable, so the
  // caller knows to ask again, and the analytics forget that ran first is
  // the only thing that landed.
  {
    name: "delete-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    request: deleteRequest,
    finalState: () => backing({ storeUnavailable: true, forgotten: [USER_ID] }),
  },
  {
    name: "preferences-read-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    request: () => preferencesReadRequest(),
    finalState: () => backing({ storeUnavailable: true }),
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
