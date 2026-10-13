import assert from "node:assert/strict";
import path from "node:path";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Option, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import { test } from "vitest";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import {
  type ConnectorService,
  INTEGRATION_CONNECT_FAILURE,
  IntegrationConnectFailure,
} from "../server/hosted/integration-connect.js";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationConnectionRow,
  type IntegrationRowStatus,
} from "../server/hosted/integration-store.js";
import {
  INTEGRATION_SIGN_IN_WINDOW_MS,
  INTEGRATION_TOOLS_TTL_MS,
  type IntegrationsAppSeams,
  integrationsApp,
} from "../server/integrations-app.js";
import { integrationConnectOf } from "./support/integration-connect.js";
import { type McpServerFake, mcpServerFake } from "./support/mcp-server-fake.js";
import { noDatabase } from "./support/no-database.js";
import {
  type RecordedResponse,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The integrations group's four paths, over the shape in
 * `server/integrations-app.ts`, as the rewrites hand them to it: a provider's
 * path segment arrives as the `provider` query. Each case runs the group once
 * against a fresh backing store and a fresh Vercel Connect double, and
 * asserts the bytes the answer carries, what the store then holds, and which
 * grants Connect then holds; the goldens beside the bytes are the answers
 * themselves. No answer may carry a token: the Connect double issues one per
 * grant, and the bytes of every answer are searched for it.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/integrations-route");

const ORIGIN = "https://luke.test";
const NOW = 1_800_000_000_000;
const VALID_AUTHORIZATION = "Bearer token-1";
const USER_ID = "user-1";
const LINEAR = INTEGRATION_PROVIDER.LINEAR;
/** The state the group mints in every case, url-safe and the length a minted one is. */
const STATE = "s".repeat(43);
/** A token the double would issue, which no answer may ever carry. */
const ISSUED_TOKEN = "lin_oauth_fixture_never_in_an_answer";

interface StoredRow {
  readonly status: IntegrationRowStatus;
  readonly state: string | undefined;
  readonly stateIssuedAt: number | undefined;
  /** When the sign-in the row stands for completed, where the case names one. */
  readonly connectedAt?: number;
}

/** Every row the store holds, by account and then by provider. */
type Rows = Map<string, Map<IntegrationProvider, StoredRow>>;

interface Backing {
  rows: Rows;
  /** The store refuses every statement, the way an unreachable database does. */
  storeUnavailable: boolean;
}

interface ConnectState {
  configured: boolean;
  /** The accounts Connect holds a grant for. */
  grants: Set<string>;
  /** Every authorization begun, as the provider, the account, and the callback it named. */
  authorized: { provider: IntegrationProvider; userId: string; callbackUrl: string }[];
  /** Connect cannot be asked at all. */
  unavailable: boolean;
  /** The provider's MCP server, which accepts the token the double issues. */
  server: McpServerFake;
  /** Runs while Connect answers a token, the way a press elsewhere lands meanwhile. */
  meanwhile?: () => void;
}

function backing(overrides: Partial<Backing> = {}): Backing {
  return { rows: new Map(), storeUnavailable: false, ...overrides };
}

function connectState(overrides: Partial<ConnectState> = {}): ConnectState {
  return {
    configured: true,
    grants: new Set(),
    authorized: [],
    unavailable: false,
    server: mcpServerFake({ token: ISSUED_TOKEN, pages: [LINEAR_TOOLS] }),
    ...overrides,
  };
}

function row(status: IntegrationRowStatus, issuedAgo?: number): StoredRow {
  return {
    status,
    state: issuedAgo === undefined ? undefined : STATE,
    stateIssuedAt: issuedAgo === undefined ? undefined : NOW - issuedAgo,
  };
}

const STORE_UNAVAILABLE = new SqlError({
  reason: new UnknownError({
    cause: new Error("the fixture's database is unreachable"),
    message: "connection refused",
  }),
});

function overStore<A>(state: Backing, statement: () => A): Effect.Effect<A, SqlError> {
  return state.storeUnavailable ? Effect.fail(STORE_UNAVAILABLE) : Effect.sync(statement);
}

function rowOf(
  userId: string,
  provider: IntegrationProvider,
  stored: StoredRow,
): IntegrationConnectionRow {
  return {
    userId,
    provider,
    status: stored.status,
    state: stored.state,
    stateIssuedAt: stored.stateIssuedAt === undefined ? undefined : new Date(stored.stateIssuedAt),
    connectedAt: stored.connectedAt === undefined ? undefined : new Date(stored.connectedAt),
  };
}

/** The account's rows, made where it had none. */
function accountRows(state: Backing, userId: string): Map<IntegrationProvider, StoredRow> {
  const held = state.rows.get(userId) ?? new Map<IntegrationProvider, StoredRow>();
  state.rows.set(userId, held);
  return held;
}

function groupSeams(state: Backing): IntegrationsAppSeams {
  return {
    resolveUserId: (request) =>
      Effect.succeed(
        request.headers.get("authorization") === VALID_AUTHORIZATION
          ? Option.some(USER_ID)
          : Option.none(),
      ),
    readConnections: (userId) =>
      overStore(state, () =>
        [...(state.rows.get(userId) ?? new Map<IntegrationProvider, StoredRow>())].map(
          ([provider, stored]) => rowOf(userId, provider, stored),
        ),
      ),
    readSignIn: (signIn) =>
      overStore(state, () => {
        for (const [userId, held] of state.rows) {
          for (const [provider, stored] of held) {
            if (stored.state === signIn) return rowOf(userId, provider, stored);
          }
        }
        return undefined;
      }),
    beginSignIn: (userId, provider, signIn) =>
      overStore(state, () => {
        const held = accountRows(state, userId);
        held.set(provider, {
          status: held.get(provider)?.status ?? INTEGRATION_ROW_STATUS.PENDING,
          state: signIn,
          stateIssuedAt: NOW,
        });
      }),
    completeSignIn: (userId, provider, signIn) =>
      overStore(state, () => {
        const held = state.rows.get(userId);
        if (held === undefined || held.get(provider)?.state !== signIn) return false;
        held.set(provider, {
          status: INTEGRATION_ROW_STATUS.CONNECTED,
          state: undefined,
          stateIssuedAt: undefined,
        });
        return true;
      }),
    deleteConnection: (userId, provider) =>
      overStore(state, () => {
        const held = state.rows.get(userId);
        held?.delete(provider);
        if (held?.size === 0) state.rows.delete(userId);
      }),
    mintState: () => STATE,
    now: () => NOW,
  };
}

const UNAVAILABLE = new IntegrationConnectFailure({
  reason: INTEGRATION_CONNECT_FAILURE.UNAVAILABLE,
});

/** One provider's connector as the group asks it, over the case's own state. */
function connectorDouble(state: ConnectState, provider: IntegrationProvider): ConnectorService {
  const configured = new IntegrationConnectFailure({
    reason: INTEGRATION_CONNECT_FAILURE.NOT_CONFIGURED,
  });
  return {
    configured: state.configured,
    authorize: (userId, callbackUrl) => {
      if (!state.configured) return Effect.fail(configured);
      if (state.unavailable) return Effect.fail(UNAVAILABLE);
      state.authorized.push({ provider, userId, callbackUrl });
      return Effect.succeed("https://vercel.com/connect/authorize/fixture-request");
    },
    token: (userId) => {
      state.meanwhile?.();
      if (state.unavailable) return Effect.fail(UNAVAILABLE);
      return state.grants.has(userId)
        ? Effect.succeed({
            token: Redacted.make(ISSUED_TOKEN),
            expiresAt: NOW + 3_600_000,
          })
        : Effect.fail(
            new IntegrationConnectFailure({ reason: INTEGRATION_CONNECT_FAILURE.NOT_AUTHORIZED }),
          );
    },
    revoke: (userId) => {
      if (state.unavailable) return Effect.fail(UNAVAILABLE);
      state.grants.delete(userId);
      return Effect.void;
    },
  };
}

function groupAnswer(state: Backing, connect: ConnectState, request: Request): Promise<Response> {
  const { handler } = HttpRouter.toWebHandler(
    integrationsApp(groupSeams(state)).pipe(
      HttpRouter.provideRequest(
        integrationConnectOf((provider) => connectorDouble(connect, provider)),
      ),
      HttpRouter.provideRequest(fakeHttpClientLayer(connect.server.respond)),
      HttpRouter.provideRequest(noDatabase),
    ),
    { disableLogger: true },
  );
  return handler(request);
}

function signedIn(method: string, route: string): () => Request {
  return () =>
    new Request(`${ORIGIN}${route}`, { method, headers: { authorization: VALID_AUTHORIZATION } });
}

const STATUSES = signedIn("GET", "/api/account/integrations");
/** Linear's Connect and Disconnect, as the rewrite of `/api/account/integrations/linear/…` hands them on. */
const CONNECT = signedIn("POST", "/api/account/integrations/connect?provider=linear");
const DISCONNECT = signedIn("POST", "/api/account/integrations/disconnect?provider=linear");
const TOOLS = signedIn("GET", "/api/account/integrations/tools?provider=linear");

/** The tools Linear's scripted server lists. */
const LINEAR_TOOLS = [
  { name: "list_issues", description: "List issues in the workspace." },
  { name: "create_issue", description: "Create a new issue.\nTitle and team are required." },
];

/** The browser's return from Connect, carrying no bearer. */
function callback(state: string | undefined): () => Request {
  const query = state === undefined ? "" : `?state=${state}`;
  return () =>
    new Request(`${ORIGIN}/api/account/integrations/connected${query}`, { method: "GET" });
}

const TRANSPORT_HEADER = { CONTENT_LENGTH: "content-length" } as const;

async function answered(response: Response): Promise<RecordedResponse> {
  const recorded = await recordedResponse(response);
  return {
    ...recorded,
    headers: recorded.headers.filter(([name]) => name !== TRANSPORT_HEADER.CONTENT_LENGTH),
  };
}

interface Exchange {
  name: string;
  state: () => Backing;
  connect: () => ConnectState;
  request: () => Request;
  /** What the store holds once the group has answered. */
  finalRows: () => Rows;
  /** Which accounts Connect holds a grant for once the group has answered. */
  finalGrants?: readonly string[];
  /** The authorizations Connect was asked to begin. */
  finalAuthorized?: ConnectState["authorized"];
  /** What lands in the store while Connect answers a token. */
  meanwhile?: (state: Backing) => void;
}

const NO_ROWS = (): Rows => new Map();
const ROWS = (stored: StoredRow) => (): Rows => new Map([[USER_ID, new Map([[LINEAR, stored]])]]);
const INSIDE_WINDOW = INTEGRATION_SIGN_IN_WINDOW_MS - 1;
const OUTSIDE_WINDOW = INTEGRATION_SIGN_IN_WINDOW_MS + 1;
const CONNECTED = row(INTEGRATION_ROW_STATUS.CONNECTED);
const PENDING = row(INTEGRATION_ROW_STATUS.PENDING, INSIDE_WINDOW);
const STALE = row(INTEGRATION_ROW_STATUS.PENDING, OUTSIDE_WINDOW);
const EXPIRED = row(INTEGRATION_ROW_STATUS.EXPIRED);
/** A sign-in begun again since the one the callback carries. */
const SUPERSEDED = {
  status: INTEGRATION_ROW_STATUS.PENDING,
  state: "n".repeat(43),
  stateIssuedAt: NOW,
} as const;
const CALLBACK_URL = `${ORIGIN}/api/account/integrations/connected?state=${STATE}`;

const EXCHANGES: readonly Exchange[] = [
  {
    name: "status-unavailable",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ configured: false }),
    request: STATUSES,
    finalRows: ROWS(CONNECTED),
  },
  // No connector at all: the answer needs no store, so an outage there is no refusal.
  {
    name: "status-unavailable-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    connect: () => connectState({ configured: false }),
    request: STATUSES,
    finalRows: NO_ROWS,
  },
  {
    name: "status-disconnected",
    state: () => backing(),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: STATUSES,
    finalRows: NO_ROWS,
    finalGrants: [USER_ID],
  },
  {
    name: "status-connected",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState(),
    request: STATUSES,
    finalRows: ROWS(CONNECTED),
  },
  {
    name: "status-pending",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState(),
    request: STATUSES,
    finalRows: ROWS(PENDING),
  },
  {
    name: "status-pending-settles",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: STATUSES,
    finalRows: ROWS(CONNECTED),
    finalGrants: [USER_ID],
  },
  {
    name: "status-pending-stale",
    state: () => backing({ rows: ROWS(STALE)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: STATUSES,
    finalRows: ROWS(STALE),
    finalGrants: [USER_ID],
  },
  {
    name: "status-expired",
    state: () => backing({ rows: ROWS(EXPIRED)() }),
    connect: () => connectState(),
    request: STATUSES,
    finalRows: ROWS(EXPIRED),
  },
  {
    name: "status-invalid-token",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState(),
    request: () => new Request(`${ORIGIN}/api/account/integrations`, { method: "GET" }),
    finalRows: ROWS(CONNECTED),
  },
  {
    name: "status-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    connect: () => connectState(),
    request: STATUSES,
    finalRows: NO_ROWS,
  },
  {
    name: "connect-success",
    state: () => backing(),
    connect: () => connectState(),
    request: CONNECT,
    finalRows: ROWS({ status: INTEGRATION_ROW_STATUS.PENDING, state: STATE, stateIssuedAt: NOW }),
    finalAuthorized: [{ provider: LINEAR, userId: USER_ID, callbackUrl: CALLBACK_URL }],
  },
  {
    name: "connect-keeps-connected",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: CONNECT,
    finalRows: ROWS({ status: INTEGRATION_ROW_STATUS.CONNECTED, state: STATE, stateIssuedAt: NOW }),
    finalGrants: [USER_ID],
    finalAuthorized: [{ provider: LINEAR, userId: USER_ID, callbackUrl: CALLBACK_URL }],
  },
  {
    name: "connect-unconfigured",
    state: () => backing(),
    connect: () => connectState({ configured: false }),
    request: CONNECT,
    finalRows: NO_ROWS,
  },
  {
    name: "connect-refused",
    state: () => backing({ rows: ROWS(EXPIRED)() }),
    connect: () => connectState({ unavailable: true }),
    request: CONNECT,
    finalRows: ROWS(EXPIRED),
  },
  {
    name: "connect-wrong-method",
    state: () => backing(),
    connect: () => connectState(),
    request: signedIn("GET", "/api/account/integrations/connect?provider=linear"),
    finalRows: NO_ROWS,
  },
  // A provider this build does not know has no route, whatever the bearer.
  {
    name: "connect-unknown-provider",
    state: () => backing(),
    connect: () => connectState(),
    request: signedIn("POST", "/api/account/integrations/connect?provider=myspace"),
    finalRows: NO_ROWS,
  },
  {
    name: "disconnect-success",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ grants: new Set([USER_ID, "user-2"]) }),
    request: DISCONNECT,
    finalRows: NO_ROWS,
    finalGrants: ["user-2"],
  },
  {
    name: "disconnect-revoke-fails",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ grants: new Set([USER_ID]), unavailable: true }),
    request: DISCONNECT,
    finalRows: NO_ROWS,
    finalGrants: [USER_ID],
  },
  {
    name: "disconnect-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: DISCONNECT,
    finalRows: NO_ROWS,
    finalGrants: [USER_ID],
  },
  {
    name: "disconnect-no-provider",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: signedIn("POST", "/api/account/integrations/disconnect"),
    finalRows: ROWS(CONNECTED),
    finalGrants: [USER_ID],
  },
  {
    name: "tools-connected",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: TOOLS,
    finalRows: ROWS(CONNECTED),
    finalGrants: [USER_ID],
  },
  // A provider the account has not connected is refused before any token is read.
  {
    name: "tools-not-connected",
    state: () => backing(),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: TOOLS,
    finalRows: NO_ROWS,
    finalGrants: [USER_ID],
  },
  {
    name: "tools-unconfigured",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ configured: false }),
    request: TOOLS,
    finalRows: ROWS(CONNECTED),
  },
  // The server refuses the bearer: the same unavailable, and nothing of the server's words.
  {
    name: "tools-server-refuses",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () =>
      connectState({
        grants: new Set([USER_ID]),
        server: mcpServerFake({ token: "someone-else", pages: [] }),
      }),
    request: TOOLS,
    finalRows: ROWS(CONNECTED),
    finalGrants: [USER_ID],
  },
  {
    name: "callback-connected",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback(STATE),
    finalRows: ROWS(CONNECTED),
    finalGrants: [USER_ID],
  },
  // Disconnect and Connect again while Connect answered the old callback: the old sign-in completes nothing.
  {
    name: "callback-superseded",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback(STATE),
    meanwhile: (state) => {
      state.rows.set(USER_ID, new Map([[LINEAR, SUPERSEDED]]));
    },
    finalRows: ROWS(SUPERSEDED),
    finalGrants: [USER_ID],
  },
  {
    name: "callback-declined",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState(),
    request: callback(STATE),
    finalRows: ROWS(PENDING),
  },
  {
    name: "callback-unknown-state",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback("u".repeat(43)),
    finalRows: ROWS(PENDING),
    finalGrants: [USER_ID],
  },
  {
    name: "callback-stale",
    state: () => backing({ rows: ROWS(STALE)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback(STATE),
    finalRows: ROWS(STALE),
    finalGrants: [USER_ID],
  },
  {
    name: "callback-no-state",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback(undefined),
    finalRows: ROWS(PENDING),
    finalGrants: [USER_ID],
  },
  {
    name: "callback-unavailable",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]), unavailable: true }),
    request: callback(STATE),
    finalRows: ROWS(PENDING),
    finalGrants: [USER_ID],
  },
  {
    name: "callback-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback(STATE),
    finalRows: NO_ROWS,
    finalGrants: [USER_ID],
  },
];

test.for(EXCHANGES)("$name", async (exchange) => {
  const state = exchange.state();
  const connect = exchange.connect();
  if (exchange.meanwhile !== undefined) connect.meanwhile = () => exchange.meanwhile?.(state);
  const carried = await answered(await groupAnswer(state, connect, exchange.request()));

  assert.ok(!carried.body.includes(ISSUED_TOKEN));
  assert.deepEqual(state.rows, exchange.finalRows());
  assert.deepEqual([...connect.grants].sort(), [...(exchange.finalGrants ?? [])].sort());
  assert.deepEqual(connect.authorized, exchange.finalAuthorized ?? []);
  await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
});

test("a provider's tools are read from its server once, and served from what was read until it is a few minutes old", async () => {
  const state = backing({ rows: ROWS(CONNECTED)() });
  const connect = connectState({ grants: new Set([USER_ID]) });
  let now = NOW;
  const { handler } = HttpRouter.toWebHandler(
    integrationsApp({ ...groupSeams(state), now: () => now }).pipe(
      HttpRouter.provideRequest(
        integrationConnectOf((provider) => connectorDouble(connect, provider)),
      ),
      HttpRouter.provideRequest(fakeHttpClientLayer(connect.server.respond)),
      HttpRouter.provideRequest(noDatabase),
    ),
    { disableLogger: true },
  );
  const sessions = () => connect.server.methods.filter((method) => method === "initialize").length;

  assert.equal((await handler(TOOLS())).status, HOSTED_HTTP_STATUS.OK);
  now += INTEGRATION_TOOLS_TTL_MS - 1;
  const again = await handler(TOOLS());
  assert.deepEqual(await again.json(), {
    tools: [
      { name: "list_issues", description: "List issues in the workspace." },
      { name: "create_issue", description: "Create a new issue." },
    ],
  });
  assert.equal(sessions(), 1);
  now += 2;
  await handler(TOOLS());
  assert.equal(sessions(), 2);

  // A sign-in completed since names another grant, whose tools are read afresh however soon.
  state.rows.set(USER_ID, new Map([[LINEAR, { ...CONNECTED, connectedAt: now }]]));
  await handler(TOOLS());
  assert.equal(sessions(), 3);
});

test("a provider read-only by its allow-list answers only the tools it allows, whatever its server lists", async () => {
  const slack = INTEGRATION_PROVIDER.SLACK;
  const state = backing({ rows: new Map([[USER_ID, new Map([[slack, CONNECTED]])]]) });
  const connect = connectState({
    grants: new Set([USER_ID]),
    server: mcpServerFake({
      token: ISSUED_TOKEN,
      pages: [
        [
          { name: "slack_search_public", description: "Search public channels." },
          { name: "slack_send_message", description: "Send a message." },
          { name: "slack_read_thread", description: "Read a thread." },
        ],
      ],
    }),
  });
  const answer = await groupAnswer(
    state,
    connect,
    signedIn("GET", "/api/account/integrations/tools?provider=slack")(),
  );
  assert.deepEqual(await answer.json(), {
    tools: [
      { name: "slack_search_public", description: "Search public channels." },
      { name: "slack_read_thread", description: "Read a thread." },
    ],
  });
});

test("a path the group declares no route for is refused", async () => {
  const response = await groupAnswer(
    backing(),
    connectState(),
    new Request(`${ORIGIN}/api/account/integrations/not-a-route`),
  );
  const carried = await answered(response);
  assert.equal(carried.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  await settleResponseGolden(GOLDEN_ROOT, "route-not-found", carried);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = [...EXCHANGES.map((exchange) => exchange.name), "route-not-found"].sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
