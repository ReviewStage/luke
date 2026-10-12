import assert from "node:assert/strict";
import path from "node:path";
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import { test } from "vitest";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http.js";
import {
  LINEAR_CONNECT_FAILURE,
  LinearConnect,
  LinearConnectFailure,
  type LinearConnectService,
} from "../server/hosted/linear-connect.js";
import {
  LINEAR_ROW_STATUS,
  type LinearConnectionRow,
  type LinearRowStatus,
} from "../server/hosted/linear-store.js";
import { LINEAR_SIGN_IN_WINDOW_MS, type LinearAppSeams, linearApp } from "../server/linear-app.js";
import { noDatabase } from "./support/no-database.js";
import {
  type RecordedResponse,
  recordedGoldenNames,
  recordedResponse,
  settleResponseGolden,
} from "./support/response-golden.js";

/**
 * The Linear group's four paths, over the shape in `server/linear-app.ts`.
 * Each case runs the group once against a fresh backing store and a fresh
 * Vercel Connect double, and asserts the bytes the answer carries, what the
 * store then holds, and which grants Connect then holds; the goldens beside
 * the bytes are the answers themselves. No answer may carry a token: the
 * Connect double issues one per grant, and the bytes of every answer are
 * searched for it.
 */

const GOLDEN_ROOT = path.join(import.meta.dirname, "../fixtures/linear-route");

const ORIGIN = "https://luke.test";
const NOW = 1_800_000_000_000;
const VALID_AUTHORIZATION = "Bearer token-1";
const USER_ID = "user-1";
/** The state the group mints in every case, url-safe and the length a minted one is. */
const STATE = "s".repeat(43);
/** A token the double would issue, which no answer may ever carry. */
const ISSUED_TOKEN = "lin_oauth_fixture_never_in_an_answer";

interface StoredRow {
  readonly status: LinearRowStatus;
  readonly state: string | undefined;
  readonly stateIssuedAt: number | undefined;
}

interface Backing {
  rows: Map<string, StoredRow>;
  /** The store refuses every statement, the way an unreachable database does. */
  storeUnavailable: boolean;
}

interface ConnectState {
  configured: boolean;
  /** The accounts Connect holds a grant for. */
  grants: Set<string>;
  /** Every authorization begun, as the account and the callback it named. */
  authorized: { userId: string; callbackUrl: string }[];
  /** Connect cannot be asked at all. */
  unavailable: boolean;
}

function backing(overrides: Partial<Backing> = {}): Backing {
  return { rows: new Map(), storeUnavailable: false, ...overrides };
}

function connectState(overrides: Partial<ConnectState> = {}): ConnectState {
  return { configured: true, grants: new Set(), authorized: [], unavailable: false, ...overrides };
}

function row(status: LinearRowStatus, issuedAgo?: number): StoredRow {
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

function rowOf(userId: string, stored: StoredRow): LinearConnectionRow {
  return {
    userId,
    status: stored.status,
    stateIssuedAt: stored.stateIssuedAt === undefined ? undefined : new Date(stored.stateIssuedAt),
  };
}

function groupSeams(state: Backing): LinearAppSeams {
  return {
    resolveUserId: (request) =>
      Effect.succeed(
        request.headers.get("authorization") === VALID_AUTHORIZATION
          ? Option.some(USER_ID)
          : Option.none(),
      ),
    readConnection: (userId) =>
      overStore(state, () => {
        const stored = state.rows.get(userId);
        return stored === undefined ? undefined : rowOf(userId, stored);
      }),
    readSignIn: (signIn) =>
      overStore(state, () => {
        for (const [userId, stored] of state.rows) {
          if (stored.state === signIn) return rowOf(userId, stored);
        }
        return undefined;
      }),
    beginSignIn: (userId, signIn) =>
      overStore(state, () => {
        const standing = state.rows.get(userId);
        state.rows.set(userId, {
          status: standing?.status ?? LINEAR_ROW_STATUS.PENDING,
          state: signIn,
          stateIssuedAt: NOW,
        });
      }),
    completeSignIn: (userId) =>
      overStore(state, () => {
        if (!state.rows.has(userId)) return false;
        state.rows.set(userId, {
          status: LINEAR_ROW_STATUS.CONNECTED,
          state: undefined,
          stateIssuedAt: undefined,
        });
        return true;
      }),
    deleteConnection: (userId) =>
      overStore(state, () => {
        state.rows.delete(userId);
      }),
    mintState: () => STATE,
    now: () => NOW,
  };
}

const UNAVAILABLE = new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.UNAVAILABLE });

/** Vercel Connect as the group asks it, over the case's own state. */
function connectDouble(state: ConnectState): LinearConnectService {
  const configured = new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.NOT_CONFIGURED });
  return {
    configured: state.configured,
    authorize: (userId, callbackUrl) => {
      if (!state.configured) return Effect.fail(configured);
      if (state.unavailable) return Effect.fail(UNAVAILABLE);
      state.authorized.push({ userId, callbackUrl });
      return Effect.succeed("https://vercel.com/connect/authorize/fixture-request");
    },
    token: (userId) => {
      if (state.unavailable) return Effect.fail(UNAVAILABLE);
      return state.grants.has(userId)
        ? Effect.succeed({
            token: Redacted.make(ISSUED_TOKEN),
            expiresAt: NOW + 3_600_000,
          })
        : Effect.fail(new LinearConnectFailure({ reason: LINEAR_CONNECT_FAILURE.NOT_AUTHORIZED }));
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
    linearApp(groupSeams(state)).pipe(
      HttpRouter.provideRequest(Layer.succeed(LinearConnect, connectDouble(connect))),
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

const STATUS = signedIn("GET", "/api/account/linear");
const CONNECT = signedIn("POST", "/api/account/linear/connect");
const DISCONNECT = signedIn("POST", "/api/account/linear/disconnect");

/** The browser's return from Connect, carrying no bearer. */
function callback(state: string | undefined): () => Request {
  const query = state === undefined ? "" : `?state=${state}`;
  return () => new Request(`${ORIGIN}/api/account/linear/connected${query}`, { method: "GET" });
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
  finalRows: () => Map<string, StoredRow>;
  /** Which accounts Connect holds a grant for once the group has answered. */
  finalGrants?: readonly string[];
  /** The authorizations Connect was asked to begin. */
  finalAuthorized?: ConnectState["authorized"];
}

const NO_ROWS = () => new Map<string, StoredRow>();
const ROWS = (stored: StoredRow) => () => new Map([[USER_ID, stored]]);
const INSIDE_WINDOW = LINEAR_SIGN_IN_WINDOW_MS - 1;
const OUTSIDE_WINDOW = LINEAR_SIGN_IN_WINDOW_MS + 1;
const CONNECTED = row(LINEAR_ROW_STATUS.CONNECTED);
const PENDING = row(LINEAR_ROW_STATUS.PENDING, INSIDE_WINDOW);
const STALE = row(LINEAR_ROW_STATUS.PENDING, OUTSIDE_WINDOW);
const EXPIRED = row(LINEAR_ROW_STATUS.EXPIRED);

const EXCHANGES: readonly Exchange[] = [
  {
    name: "status-unavailable",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ configured: false }),
    request: STATUS,
    finalRows: ROWS(CONNECTED),
  },
  {
    name: "status-disconnected",
    state: () => backing(),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: STATUS,
    finalRows: NO_ROWS,
    finalGrants: [USER_ID],
  },
  {
    name: "status-connected",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState(),
    request: STATUS,
    finalRows: ROWS(CONNECTED),
  },
  {
    name: "status-pending",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState(),
    request: STATUS,
    finalRows: ROWS(PENDING),
  },
  {
    name: "status-pending-settles",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: STATUS,
    finalRows: ROWS(CONNECTED),
    finalGrants: [USER_ID],
  },
  {
    name: "status-pending-stale",
    state: () => backing({ rows: ROWS(STALE)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: STATUS,
    finalRows: ROWS(STALE),
    finalGrants: [USER_ID],
  },
  {
    name: "status-expired",
    state: () => backing({ rows: ROWS(EXPIRED)() }),
    connect: () => connectState(),
    request: STATUS,
    finalRows: ROWS(EXPIRED),
  },
  {
    name: "status-invalid-token",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState(),
    request: () => new Request(`${ORIGIN}/api/account/linear`, { method: "GET" }),
    finalRows: ROWS(CONNECTED),
  },
  {
    name: "status-store-unavailable",
    state: () => backing({ storeUnavailable: true }),
    connect: () => connectState(),
    request: STATUS,
    finalRows: NO_ROWS,
  },
  {
    name: "connect-success",
    state: () => backing(),
    connect: () => connectState(),
    request: CONNECT,
    finalRows: ROWS({ status: LINEAR_ROW_STATUS.PENDING, state: STATE, stateIssuedAt: NOW }),
    finalAuthorized: [
      { userId: USER_ID, callbackUrl: `${ORIGIN}/api/account/linear/connected?state=${STATE}` },
    ],
  },
  {
    name: "connect-keeps-connected",
    state: () => backing({ rows: ROWS(CONNECTED)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: CONNECT,
    finalRows: ROWS({ status: LINEAR_ROW_STATUS.CONNECTED, state: STATE, stateIssuedAt: NOW }),
    finalGrants: [USER_ID],
    finalAuthorized: [
      { userId: USER_ID, callbackUrl: `${ORIGIN}/api/account/linear/connected?state=${STATE}` },
    ],
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
    request: signedIn("GET", "/api/account/linear/connect"),
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
    name: "callback-connected",
    state: () => backing({ rows: ROWS(PENDING)() }),
    connect: () => connectState({ grants: new Set([USER_ID]) }),
    request: callback(STATE),
    finalRows: ROWS(CONNECTED),
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
  const carried = await answered(await groupAnswer(state, connect, exchange.request()));

  assert.ok(!carried.body.includes(ISSUED_TOKEN));
  assert.deepEqual(state.rows, exchange.finalRows());
  assert.deepEqual([...connect.grants].sort(), [...(exchange.finalGrants ?? [])].sort());
  assert.deepEqual(connect.authorized, exchange.finalAuthorized ?? []);
  await settleResponseGolden(GOLDEN_ROOT, exchange.name, carried);
});

test("a path the group declares no route for is refused", async () => {
  const response = await groupAnswer(
    backing(),
    connectState(),
    new Request(`${ORIGIN}/api/account/linear/not-a-route`),
  );
  const carried = await answered(response);
  assert.equal(carried.status, HOSTED_HTTP_STATUS.NOT_FOUND);
  await settleResponseGolden(GOLDEN_ROOT, "route-not-found", carried);
});

test("the recorded set is exactly the exchanges declared", async () => {
  const named = [...EXCHANGES.map((exchange) => exchange.name), "route-not-found"].sort();
  assert.deepEqual(await recordedGoldenNames(GOLDEN_ROOT), named);
});
