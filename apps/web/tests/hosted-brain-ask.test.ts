import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  ASK_ORIGIN,
  HOSTED_API_ERROR,
  hostedBrainAskAnswerSchema,
  hostedBrainTurnAnswerSchema,
  TURN_WAIT_QUERY,
} from "@sidecar/hosted";
import {
  EXCESS_KEYS,
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnStatus,
  type UnparsedWireValue,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Option, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import { afterAll, test } from "vitest";
import { db } from "../server/db/query";
import { conversations, turns } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  ASK_REFUSAL,
  acceptAsk,
  askStanding,
  handleBrainAsk,
  handleBrainTurn,
  handleBrainTurnCancel,
  STOP_REFUSAL,
  stopAsk,
  TURN_WAIT_POLL_MS,
} from "../server/hosted/brain-ask";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  deploymentEveOrigin,
  eveOrigin,
  tickEveOrigin,
} from "../server/hosted/brain-host/eve-origin";
import {
  EVE_CANCEL_OUTCOME,
  EVE_FIRST_TURN_ID,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { hostTurnId } from "../server/hosted/brain-host/ids";
import {
  conversationOwnedBy,
  recordedRuntimeSession,
} from "../server/hosted/brain-host/recorded-session";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { STORE_WRITE_EFFECT, storeWriter } from "../server/hosted/store";
import {
  ASK_DISPATCH_REFUSAL,
  type AskRecord,
  type AskRow,
  newestSession,
} from "../server/hosted/store/asks";
import { STORE_WRITE_REFUSAL } from "../server/hosted/store/writer";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { noDatabase } from "./support/no-database";

/**
 * The ask routes over the real store on PGlite. The ownership refusals here
 * are C2c's route-level half, ridden here because a door merges with its
 * refusals asserted: another account's conversation, a cleared conversation,
 * and a turn whose conversation records no session are each refused at the
 * HTTP layer before eve is reached, and eve being reached is the failure each
 * test names. The ask record is the in-memory shape of the table the routes
 * will stand on; the routes read nothing of it the table will not hold.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

/** The store writer over the test database, for the one write a Stop makes on a turn's row. */
const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
    now: () => new Date(NOW),
  }),
);

const NOW = 1_800_000_000_000;
const ORIGIN = "https://luke.test";
const CLIENT_ID = "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50";

let sessionsMinted = 0;
function mintSession(): string {
  sessionsMinted += 1;
  return `wrun_01M${String(sessionsMinted).padStart(22, "0")}`;
}

/** The row as it stands before eve names a turn for it: the record with no turn, however it came to have one. */
function beforeItsTurn(row: AskRow): AskRow {
  const { turnId: _turnId, ...waiting } = row;
  return waiting;
}

/** The ask record as a table would hold it, in memory. */
function memoryAsks(): AskRecord & { rows: Map<string, AskRow> } {
  const rows = new Map<string, AskRow>();
  const inFlight = new Map<string, Promise<void>>();
  const put = (row: AskRow) => {
    rows.set(row.id, row);
    return row;
  };
  return {
    rows,
    record: (ask) =>
      Effect.sync(() => {
        for (const row of rows.values()) {
          if (row.conversationId === ask.conversationId && row.clientId === ask.clientId)
            return row;
        }
        return put({
          id: randomUUID(),
          userId: ask.userId,
          conversationId: ask.conversationId,
          clientId: ask.clientId,
          origin: ask.origin,
          createdAt: ask.createdAt,
        });
      }),
    named: (userId, id) =>
      Effect.sync(() => {
        const row = rows.get(id);
        return row?.userId === userId ? row : undefined;
      }),
    latestSession: (userId, conversationId) =>
      Effect.sync(() => latestSession(userId, conversationId)),
    dispatchOnce: (target, id, dispatch) =>
      // One dispatch at a time per conversation, as the conversation lock serialises them on the real record.
      Effect.flatMap(Effect.context<SqlClient.SqlClient>(), (context) => {
        const run = Effect.runPromiseWith(context);
        const turn = (inFlight.get(target.conversationId) ?? Promise.resolve()).then(async () => {
          if (!(await run(conversationOwnedBy(target.userId, target.conversationId)))) {
            return ASK_DISPATCH_REFUSAL.NO_CONVERSATION;
          }
          const row = rows.get(id);
          assert.ok(row);
          if (row.sessionId !== undefined) return row;
          const session = newestSession(
            await run(recordedRuntimeSession(target)),
            latestSession(target.userId, target.conversationId),
          );
          const answered = await run(dispatch(session));
          return answered === undefined ? row : put({ ...row, ...answered });
        });
        inFlight.set(
          target.conversationId,
          turn.then(
            () => undefined,
            () => undefined,
          ),
        );
        return Effect.promise(() => turn);
      }),
    cancelRequested: (id, at) =>
      Effect.sync(() => {
        const row = rows.get(id);
        assert.ok(row);
        put({ ...row, cancelRequestedAt: at });
      }),
  };
  function latestSession(userId: string, conversationId: string): string | undefined {
    let latest: AskRow | undefined;
    for (const row of rows.values()) {
      if (row.userId !== userId || row.conversationId !== conversationId) continue;
      if (row.sessionId === undefined) continue;
      if (latest?.sessionId === undefined || row.sessionId > latest.sessionId) latest = row;
    }
    return latest?.sessionId;
  }
}

type EveCall =
  | { readonly kind: "open"; readonly message: EveMessage }
  | {
      readonly kind: "send";
      readonly sessionId: string;
      readonly message: EveMessage;
    }
  | {
      readonly kind: "cancel";
      readonly sessionId: string;
      readonly eveTurnId: string | undefined;
    };

interface FakeEve extends EveSessions {
  readonly calls: EveCall[];
  /** The bearers eve was reached under. */
  readonly bearers: string[];
  /** Sessions eve has retired, so a follow-up to one reads as such. */
  readonly retired: Set<string>;
  failNext: number | undefined;
  /** eve's turn under way, by eve's own id; a cancel naming it, or naming none, ends it. */
  activeTurn: string | undefined;
  /** The turns eve's cancels actually ended, in order. */
  readonly cancelledTurns: string[];
  /** What the world does while a cancel is on the wire, between the route's read and eve's answer. */
  beforeCancel: () => Promise<void>;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    calls: [],
    bearers: [],
    retired: new Set(),
    failNext: undefined,
    activeTurn: undefined,
    cancelledTurns: [],
    beforeCancel: async () => {},
    open: (message) =>
      Effect.sync(() => {
        eve.calls.push({ kind: "open", message });
        if (eve.failNext !== undefined) {
          const status = eve.failNext;
          eve.failNext = undefined;
          return { outcome: EVE_SEND_OUTCOME.FAILED, status };
        }
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintSession() };
      }),
    send: (sessionId, message) =>
      Effect.sync(() => {
        eve.calls.push({ kind: "send", sessionId, message });
        if (eve.retired.has(sessionId)) return { outcome: EVE_SEND_OUTCOME.RETIRED };
        return {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: `delivery-${eve.calls.length}`,
        };
      }),
    // eve's own cancel, as its route documents it: a cancel naming a turn ends that turn only
    // where it is the one under way, and a cancel naming none ends whatever turn is under way.
    cancel: (sessionId, eveTurnId?: string) =>
      Effect.promise(async () => {
        eve.calls.push({ kind: "cancel", sessionId, eveTurnId });
        await eve.beforeCancel();
        if (
          eve.activeTurn === undefined ||
          (eveTurnId !== undefined && eveTurnId !== eve.activeTurn)
        ) {
          return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN };
        }
        eve.cancelledTurns.push(eve.activeTurn);
        eve.activeTurn = undefined;
        return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED };
      }),
  };
  return eve;
}

/** The widest of the three route bundles, named from the route that takes it: the module keeps the shape private. */
type CancelOptions = Parameters<typeof handleBrainTurnCancel>[0];

interface Harness {
  readonly asks: ReturnType<typeof memoryAsks>;
  readonly eve: FakeEve;
  clock: number;
  options(request: Request, userId: string | undefined): CancelOptions;
}

function harness(): Harness {
  const asks = memoryAsks();
  const eve = fakeEve();
  const built: Harness = {
    asks,
    eve,
    clock: NOW,
    options: (request, userId) => ({
      request,
      resolveUserId: () => Effect.succeed(Option.fromUndefinedOr(userId)),
      store: database.store,
      writer,
      asks,
      eve: (authorization) => {
        eve.bearers.push(authorization);
        return eve;
      },
      now: () => built.clock,
    }),
  };
  return built;
}

function bearer(userId: string): string {
  return `Bearer token-${userId}`;
}

function askRequest(userId: string, body: WireBoundaryInput): Request {
  return new Request(`${ORIGIN}/api/brain/ask`, {
    method: "POST",
    headers: {
      authorization: bearer(userId),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/** The ask route reached with the wrong method. */
function askRead(userId: string): Request {
  return new Request(`${ORIGIN}/api/brain/ask`, {
    method: "GET",
    headers: { authorization: bearer(userId) },
  });
}

function turnRequest(
  userId: string,
  id: string | undefined,
  query: Readonly<Record<string, string>> = {},
  method = "GET",
): Request {
  const url = new URL(`${ORIGIN}/api/brain/turns/turn.ts`);
  if (id !== undefined) url.searchParams.set("id", id);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  return new Request(url, {
    method,
    headers: { authorization: bearer(userId) },
  });
}

async function body(response: Response): Promise<UnparsedWireValue> {
  // SAFETY: the route's own JSON answer; the schema read is the validation.
  return (await response.json()) as UnparsedWireValue;
}

function parse<Value, Encoded>(
  schema: Schema.Codec<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  // Every answer read here belongs to a family declared tolerant, so the read
  // drops a key a newer service may have added.
  return Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(value));
}

async function errorOf(response: Response): Promise<[number, string]> {
  // SAFETY: the handler's own JSON refusal, read for its status and slug.
  const read = (await response.json()) as { error: string };
  return [response.status, read.error];
}

const IdRowSchema = Schema.Struct({ id: Schema.String });

interface ConversationOverrides {
  readonly runtimeSessionId?: string;
  readonly deletedAt?: Date;
}

async function conversation(
  userId: string,
  overrides: ConversationOverrides = {},
): Promise<string> {
  const row = await database.run(
    Effect.gen(function* () {
      const rows = yield* db
        .insert(conversations)
        .values({
          userId,
          kind: CONVERSATION_KIND.MAIN,
          runtimeSessionId: overrides.runtimeSessionId ?? null,
          deletedAt: overrides.deletedAt ?? null,
        })
        .returning({ id: conversations.id });
      return yield* Schema.decodeUnknownEffect(IdRowSchema)(rows[0]);
    }),
  );
  return row.id;
}

interface TurnOverrides {
  readonly status?: TurnStatus;
  readonly settledAt?: Date;
  readonly cancelRequestedAt?: Date;
  /** eve's own id for the turn, as the relay writes it at eve's start; absent, the row is the opener's inbox or one from before the column. */
  readonly eveTurnId?: string;
}

async function turnRow(
  userId: string,
  conversationId: string,
  overrides: TurnOverrides = {},
): Promise<string> {
  const row = await database.run(
    Effect.gen(function* () {
      const rows = yield* db
        .insert(turns)
        .values({
          userId,
          conversationId,
          origin: TURN_ORIGIN.TYPED,
          status: overrides.status ?? TURN_STATUS.RUNNING,
          eveTurnId: overrides.eveTurnId ?? null,
          queuedAt: new Date(NOW),
          startedAt: new Date(NOW),
          settledAt: overrides.settledAt ?? null,
          cancelRequestedAt: overrides.cancelRequestedAt ?? null,
        })
        .returning({ id: turns.id });
      return yield* Schema.decodeUnknownEffect(IdRowSchema)(rows[0]);
    }),
  );
  return row.id;
}

function setConversationRuntimeSessionId(conversationId: string, sessionId: string) {
  return database.run(
    Effect.asVoid(
      db
        .update(conversations)
        .set({ runtimeSessionId: sessionId })
        .where(eq(conversations.id, conversationId)),
    ),
  );
}

function stampConversationDeletedAt(conversationId: string, deletedAt: Date) {
  return database.run(
    Effect.asVoid(
      db.update(conversations).set({ deletedAt }).where(eq(conversations.id, conversationId)),
    ),
  );
}

function settleTurn(turnId: string, settledAt: Date) {
  return database.run(
    Effect.asVoid(
      db.update(turns).set({ status: TURN_STATUS.SETTLED, settledAt }).where(eq(turns.id, turnId)),
    ),
  );
}

const ASK = {
  question: "what changed?",
  origin: ASK_ORIGIN.TYPED,
  clientId: CLIENT_ID,
};

test("eve's origin is the environment's where it names one and the caller's own otherwise, a blank name counting as none", async () => {
  const before = process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN];
  try {
    delete process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN];
    assert.equal(eveOrigin("https://luke.test"), "https://luke.test");
    process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN] = "  ";
    assert.equal(eveOrigin("https://luke.test"), "https://luke.test");
    process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN] = "https://eve.luke.test";
    assert.equal(eveOrigin("https://luke.test"), "https://eve.luke.test");
  } finally {
    if (before === undefined) delete process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN];
    else process.env[BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN] = before;
  }
});

/** The variables a deployment with no request in hand reads its own origin from. */
const DEPLOYMENT_VARIABLES = {
  EVE_ORIGIN: BRAIN_HOST_ENVIRONMENT.EVE_ORIGIN,
  ENVIRONMENT: "VERCEL_ENV",
  URL: "VERCEL_URL",
  PRODUCTION_URL: "VERCEL_PROJECT_PRODUCTION_URL",
} as const;

/** Stands the deployment's variables up as the case names them, whatever this machine holds. */
function withDeployment(
  named: Partial<Record<keyof typeof DEPLOYMENT_VARIABLES, string>>,
  read: () => void,
): void {
  const before = new Map(
    Object.values(DEPLOYMENT_VARIABLES).map((variable) => [variable, process.env[variable]]),
  );
  try {
    for (const [name, variable] of Object.entries(DEPLOYMENT_VARIABLES)) {
      // SAFETY: the names iterated are this same object's own keys.
      const value = named[name as keyof typeof DEPLOYMENT_VARIABLES];
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
    read();
  } finally {
    for (const [variable, value] of before) {
      if (value === undefined) delete process.env[variable];
      else process.env[variable] = value;
    }
  }
}

test("a deployment with no request in hand dials the origin the environment names first", () => {
  withDeployment(
    {
      EVE_ORIGIN: "https://eve.luke.test",
      ENVIRONMENT: "production",
      URL: "luke-abc123-luke.vercel.app",
      PRODUCTION_URL: "tryluke.dev",
    },
    () => assert.equal(deploymentEveOrigin(), "https://eve.luke.test"),
  );
});

test("production dials the project's production domain, not the host its authentication protects", () => {
  withDeployment(
    {
      ENVIRONMENT: "production",
      URL: "luke-abc123-luke.vercel.app",
      PRODUCTION_URL: "tryluke.dev",
    },
    () => assert.equal(deploymentEveOrigin(), "https://tryluke.dev"),
  );
});

test("a preview dials itself, and so does a production deployment naming no domain of its own", () => {
  withDeployment(
    {
      ENVIRONMENT: "preview",
      URL: "luke-abc123-luke.vercel.app",
      PRODUCTION_URL: "tryluke.dev",
    },
    () => assert.equal(deploymentEveOrigin(), "https://luke-abc123-luke.vercel.app"),
  );
  withDeployment({ ENVIRONMENT: "production", URL: "luke-abc123-luke.vercel.app" }, () =>
    assert.equal(deploymentEveOrigin(), "https://luke-abc123-luke.vercel.app"),
  );
});

test("a machine that is neither configured nor deployed dials nothing", () => {
  withDeployment({}, () => assert.equal(deploymentEveOrigin(), undefined));
});

/** The tick as Vercel's cron invokes it: on the generated host the project's authentication protects. */
const CRON_REQUEST = new Request("https://luke-abc123-luke.vercel.app/api/observation/tick");

test("the tick dials the production domain, never the protected host its request arrived on", () => {
  withDeployment(
    {
      ENVIRONMENT: "production",
      URL: "luke-abc123-luke.vercel.app",
      PRODUCTION_URL: "tryluke.dev",
    },
    () => assert.equal(tickEveOrigin(CRON_REQUEST), "https://tryluke.dev"),
  );
  withDeployment(
    {
      EVE_ORIGIN: "https://eve.luke.test",
      ENVIRONMENT: "production",
      URL: "luke-abc123-luke.vercel.app",
      PRODUCTION_URL: "tryluke.dev",
    },
    () => assert.equal(tickEveOrigin(CRON_REQUEST), "https://eve.luke.test"),
  );
});

test("a tick on a machine that is neither configured nor deployed dials the origin it was called on", () => {
  withDeployment({}, () =>
    assert.equal(
      tickEveOrigin(new Request("http://localhost:3000/api/observation/tick")),
      "http://localhost:3000",
    ),
  );
});

test("the gates each refuse on their own: method, bearer, body, the path's id, and the wait bound", async () => {
  const userId = await database.createUser();
  const h = harness();
  assert.deepEqual(
    await errorOf(await database.run(handleBrainAsk(h.options(askRead(userId), userId)))),
    [405, HOSTED_API_ERROR.METHOD_NOT_ALLOWED],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), undefined))),
    ),
    [401, HOSTED_API_ERROR.INVALID_TOKEN],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(
        handleBrainAsk(h.options(askRequest(userId, { ...ASK, extra: 1 }), userId)),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(
        handleBrainAsk(
          h.options(askRequest(userId, { ...ASK, origin: TURN_ORIGIN.TRANSCRIPT_CHANGE }), userId),
        ),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainTurn(h.options(turnRequest(userId, undefined), userId))),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainTurn(h.options(turnRequest(userId, "not-a-uuid"), userId))),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(
        handleBrainTurn(
          h.options(turnRequest(userId, randomUUID(), { [TURN_WAIT_QUERY]: "90000" }), userId),
        ),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(
        handleBrainTurnCancel(h.options(turnRequest(userId, randomUUID()), userId)),
      ),
    ),
    [405, HOSTED_API_ERROR.METHOD_NOT_ALLOWED],
  );
  assert.deepEqual(h.eve.calls, []);
});

test("an ask naming another account's conversation is refused as not found before eve is reached, and nothing is recorded", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const owned = await conversation(owner);
  const h = harness();
  const response = await database.run(
    handleBrainAsk(h.options(askRequest(other, { ...ASK, conversationId: owned }), other)),
  );
  assert.deepEqual(await errorOf(response), [404, HOSTED_API_ERROR.NOT_FOUND]);
  assert.deepEqual(h.eve.calls, []);
  assert.equal(h.asks.rows.size, 0);
});

test("an ask naming a cleared conversation is refused as not found before eve is reached; the account's next ask without one opens a fresh main", async () => {
  const userId = await database.createUser();
  const cleared = await conversation(userId, { deletedAt: new Date(NOW) });
  const h = harness();
  const refused = await database.run(
    handleBrainAsk(h.options(askRequest(userId, { ...ASK, conversationId: cleared }), userId)),
  );
  assert.deepEqual(await errorOf(refused), [404, HOSTED_API_ERROR.NOT_FOUND]);
  assert.deepEqual(h.eve.calls, []);

  const opened = await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), userId)));
  assert.equal(opened.status, 202);
  const answer = parse(hostedBrainAskAnswerSchema, await body(opened));
  assert.ok(answer);
  assert.notEqual(answer.conversationId, cleared);
  assert.equal(h.eve.calls.length, 1);
});

test("the first ask opens the conversation's session under the caller's own bearer and its turn is the session's first; a second ask follows up on the recorded session and stands on its delivery", async () => {
  const userId = await database.createUser();
  const h = harness();
  const first = await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), userId)));
  assert.equal(first.status, 202);
  const accepted = parse(hostedBrainAskAnswerSchema, await body(first));
  assert.ok(accepted);
  assert.equal(accepted.queuedAt, NOW);
  assert.deepEqual(h.eve.bearers, [bearer(userId)]);
  const [open] = h.eve.calls;
  assert.ok(open && open.kind === "open");
  assert.deepEqual(open.message, {
    conversationId: accepted.conversationId,
    turn: BRAIN_HOST_TURN.TYPED,
    message: ASK.question,
  });
  const recorded = h.asks.rows.get(accepted.id);
  assert.ok(recorded?.sessionId);
  assert.equal(recorded.turnId, hostTurnId(recorded.sessionId, EVE_FIRST_TURN_ID));
  assert.equal(recorded.deliveryId, undefined);

  await setConversationRuntimeSessionId(accepted.conversationId, recorded.sessionId);
  const second = await database.run(
    handleBrainAsk(
      h.options(
        askRequest(userId, {
          ...ASK,
          clientId: randomUUID(),
          origin: ASK_ORIGIN.SPOKEN,
        }),
        userId,
      ),
    ),
  );
  assert.equal(second.status, 202);
  const followUp = parse(hostedBrainAskAnswerSchema, await body(second));
  assert.ok(followUp);
  assert.equal(followUp.conversationId, accepted.conversationId);
  const [, send] = h.eve.calls;
  assert.ok(send && send.kind === "send");
  assert.equal(send.sessionId, recorded.sessionId);
  assert.equal(send.message.turn, BRAIN_HOST_TURN.SPOKEN);
  const followed = h.asks.rows.get(followUp.id);
  assert.equal(followed?.sessionId, recorded.sessionId);
  assert.equal(followed?.deliveryId, "delivery-2");
  assert.equal(followed?.turnId, undefined);
});

test("a follow-up before the conversation row records the session still goes to the session the last ask opened, so two sessions never race for one conversation", async () => {
  const userId = await database.createUser();
  const h = harness();
  await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), userId)));
  await database.run(
    handleBrainAsk(h.options(askRequest(userId, { ...ASK, clientId: randomUUID() }), userId)),
  );
  assert.deepEqual(
    h.eve.calls.map((call) => call.kind),
    ["open", "send"],
  );
  const [open, send] = h.eve.calls;
  assert.ok(open?.kind === "open" && send?.kind === "send");
  const [first] = [...h.asks.rows.values()];
  assert.equal(send.sessionId, first?.sessionId);
});

test("a follow-up goes to the newest session the record knows of, by eve's own sortable ids: the last ask's session over a row still recording the one it moved on from", async () => {
  const userId = await database.createUser();
  const h = harness();
  const older = mintSession();
  const newer = mintSession();
  const conversationId = await conversation(userId, {
    runtimeSessionId: older,
  });
  const first = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await database.run(
        handleBrainAsk(h.options(askRequest(userId, { ...ASK, conversationId }), userId)),
      ),
    ),
  );
  assert.ok(first);
  const record = h.asks.rows.get(first.id);
  assert.ok(record);
  h.asks.rows.set(first.id, { ...record, sessionId: newer });

  await database.run(
    handleBrainAsk(
      h.options(askRequest(userId, { ...ASK, conversationId, clientId: randomUUID() }), userId),
    ),
  );
  const [, send] = h.eve.calls;
  assert.ok(send && send.kind === "send");
  assert.equal(send.sessionId, newer);
});

test("a session eve has retired is opened again for the ask that found it so", async () => {
  const userId = await database.createUser();
  const h = harness();
  const stale = mintSession();
  const conversationId = await conversation(userId, {
    runtimeSessionId: stale,
  });
  h.eve.retired.add(stale);
  const response = await database.run(
    handleBrainAsk(h.options(askRequest(userId, { ...ASK, conversationId }), userId)),
  );
  assert.equal(response.status, 202);
  assert.deepEqual(
    h.eve.calls.map((call) => call.kind),
    ["send", "open"],
  );
  const [row] = [...h.asks.rows.values()];
  assert.ok(row?.sessionId);
  assert.notEqual(row.sessionId, stale);
});

test("the same client id is the same ask: answered again with the same id and dispatched once; a dispatch eve refused is dispatched again on the retry", async () => {
  const userId = await database.createUser();
  const h = harness();
  h.eve.failNext = 503;
  const refused = await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), userId)));
  assert.deepEqual(await errorOf(refused), [502, HOSTED_API_ERROR.UPSTREAM_ERROR]);
  assert.equal(h.asks.rows.size, 1);

  const retried = await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), userId)));
  assert.equal(retried.status, 202);
  const accepted = parse(hostedBrainAskAnswerSchema, await body(retried));
  assert.ok(accepted);
  const again = await database.run(handleBrainAsk(h.options(askRequest(userId, ASK), userId)));
  assert.equal(again.status, 202);
  const same = parse(hostedBrainAskAnswerSchema, await body(again));
  assert.deepEqual(same, accepted);
  assert.equal(h.eve.calls.length, 2);
  assert.equal(h.asks.rows.size, 1);
});

test("a turn read answers a turn row's stamps under the id asked by, an ask without a turn as queued, and another account's turn or an ask over a cleared conversation as not found", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const conversationId = await conversation(owner);
  const turnId = await turnRow(owner, conversationId, {
    status: TURN_STATUS.SETTLED,
    settledAt: new Date(NOW + 5_000),
  });
  const read = await database.run(handleBrainTurn(h.options(turnRequest(owner, turnId), owner)));
  assert.equal(read.status, 200);
  const answer = parse(hostedBrainTurnAnswerSchema, await body(read));
  assert.deepEqual(answer, {
    id: turnId,
    turnId,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    queuedAt: NOW,
    startedAt: NOW,
    settledAt: NOW + 5_000,
  });
  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainTurn(h.options(turnRequest(other, turnId), other))),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );

  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await database.run(
        handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId }), owner)),
      ),
    ),
  );
  assert.ok(asked);
  const row = h.asks.rows.get(asked.id);
  assert.ok(row);
  h.asks.rows.set(asked.id, beforeItsTurn(row));
  const queued = parse(
    hostedBrainTurnAnswerSchema,
    await body(await database.run(handleBrainTurn(h.options(turnRequest(owner, asked.id), owner)))),
  );
  assert.deepEqual(queued, {
    id: asked.id,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.QUEUED,
    queuedAt: NOW,
  });

  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainTurn(h.options(turnRequest(other, asked.id), other))),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );

  await stampConversationDeletedAt(conversationId, new Date(NOW));
  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainTurn(h.options(turnRequest(owner, asked.id), owner))),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
  assert.deepEqual(
    await errorOf(
      await database.run(handleBrainTurn(h.options(turnRequest(owner, turnId), owner))),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
});

test("the in-process standing read answers what the turn route answers: for a queued ask, for a turn row, for another account's id, and for a conversation cleared under both", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const conversationId = await conversation(owner);
  const turnId = await turnRow(owner, conversationId, {
    cancelRequestedAt: new Date(NOW + 1),
  });
  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await database.run(
        handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId }), owner)),
      ),
    ),
  );
  assert.ok(asked);
  const record = h.asks.rows.get(asked.id);
  assert.ok(record);
  h.asks.rows.set(asked.id, beforeItsTurn(record));
  const reads = { store: database.store, run: database.run, asks: h.asks };
  const routed = async (userId: string, id: string) =>
    parse(
      hostedBrainTurnAnswerSchema,
      await body(await database.run(handleBrainTurn(h.options(turnRequest(userId, id), userId)))),
    );

  for (const id of [asked.id, turnId]) {
    const viaRoute = await routed(owner, id);
    assert.ok(viaRoute);
    assert.deepEqual((await database.run(askStanding(reads, owner, id)))?.answer, viaRoute);
    assert.equal(await routed(other, id), undefined);
    assert.equal(await database.run(askStanding(reads, other, id)), undefined);
  }

  await stampConversationDeletedAt(conversationId, new Date(NOW));
  for (const id of [asked.id, turnId]) {
    assert.deepEqual(
      await errorOf(await database.run(handleBrainTurn(h.options(turnRequest(owner, id), owner)))),
      [404, HOSTED_API_ERROR.NOT_FOUND],
    );
    assert.equal(await database.run(askStanding(reads, owner, id)), undefined);
  }
});

test("the in-process ask answers what the ask route answers: the same record again for the same client id, and the same refusal for another account's conversation", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const conversationId = await conversation(owner);
  const seams = {
    run: database.run,
    asks: h.asks,
    eve: h.eve,
    now: () => h.clock,
  };
  const routed = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await database.run(
        handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId }), owner)),
      ),
    ),
  );
  assert.ok(routed);
  assert.deepEqual(
    await database.run(acceptAsk(seams, { ...ASK, conversationId, userId: owner })),
    {
      ok: true,
      answer: routed,
    },
  );
  assert.equal(h.eve.calls.length, 1);

  assert.deepEqual(
    await errorOf(
      await database.run(
        handleBrainAsk(h.options(askRequest(other, { ...ASK, conversationId }), other)),
      ),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
  assert.deepEqual(
    await database.run(acceptAsk(seams, { ...ASK, conversationId, userId: other })),
    {
      ok: false,
      refusal: ASK_REFUSAL.NOT_FOUND,
    },
  );
  assert.equal(h.eve.calls.length, 1);
});

function cancelRequest(userId: string, id: string | undefined): Request {
  return turnRequest(userId, id, {}, "POST");
}

test("a Stop on a running turn is eve's cancel of that turn in the conversation's recorded session and a stamp on the row; on an ask still waiting it is a stamp on the record and reaches eve not at all", async () => {
  const userId = await database.createUser();
  const h = harness();
  const sessionId = mintSession();
  const conversationId = await conversation(userId, {
    runtimeSessionId: sessionId,
  });
  const turnId = await turnRow(userId, conversationId, { eveTurnId: "turn_1" });
  h.eve.activeTurn = "turn_1";
  const cancelled = await database.run(
    handleBrainTurnCancel(h.options(cancelRequest(userId, turnId), userId)),
  );
  assert.equal(cancelled.status, 200);
  const answer = parse(hostedBrainTurnAnswerSchema, await body(cancelled));
  assert.equal(answer?.cancelRequestedAt, NOW);
  assert.deepEqual(h.eve.calls, [{ kind: "cancel", sessionId, eveTurnId: "turn_1" }]);
  assert.deepEqual(h.eve.cancelledTurns, ["turn_1"]);
  const [row] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.equal(row?.cancelRequestedAt?.getTime(), NOW);

  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await database.run(
        handleBrainAsk(h.options(askRequest(userId, { ...ASK, conversationId }), userId)),
      ),
    ),
  );
  assert.ok(asked);
  const record = h.asks.rows.get(asked.id);
  assert.ok(record);
  h.asks.rows.set(asked.id, beforeItsTurn(record));
  const callsBefore = h.eve.calls.length;
  const stamped = await database.run(
    handleBrainTurnCancel(h.options(cancelRequest(userId, asked.id), userId)),
  );
  assert.equal(stamped.status, 200);
  const stampedAnswer = parse(hostedBrainTurnAnswerSchema, await body(stamped));
  assert.equal(stampedAnswer?.status, TURN_STATUS.QUEUED);
  assert.equal(stampedAnswer?.cancelRequestedAt, NOW);
  assert.equal(h.asks.rows.get(asked.id)?.cancelRequestedAt?.getTime(), NOW);
  assert.equal(h.eve.calls.length, callsBefore);
});

test("the in-process Stop answers what the cancel route answers: for a running turn, for a waiting ask, for a turn whose conversation records no session, and for another account's id", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const recorded = await conversation(owner, {
    runtimeSessionId: mintSession(),
  });
  const running = await turnRow(owner, recorded, { eveTurnId: "turn_1" });
  const unrecordedOwner = await database.createUser();
  const unrecorded = await conversation(unrecordedOwner);
  const orphan = await turnRow(unrecordedOwner, unrecorded);
  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await database.run(
        handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId: recorded }), owner)),
      ),
    ),
  );
  assert.ok(asked);
  const record = h.asks.rows.get(asked.id);
  assert.ok(record);
  h.asks.rows.set(asked.id, beforeItsTurn(record));
  const seams = {
    store: database.store,
    run: database.run,
    asks: h.asks,
    writer,
    eve: h.eve,
    now: () => h.clock,
  };

  for (const id of [running, asked.id]) {
    const viaRoute = parse(
      hostedBrainTurnAnswerSchema,
      await body(
        await database.run(handleBrainTurnCancel(h.options(cancelRequest(owner, id), owner))),
      ),
    );
    assert.ok(viaRoute);
    assert.deepEqual(await database.run(stopAsk(seams, owner, id)), {
      ok: true,
      answer: viaRoute,
    });
    assert.deepEqual(
      await errorOf(
        await database.run(handleBrainTurnCancel(h.options(cancelRequest(other, id), other))),
      ),
      [404, HOSTED_API_ERROR.NOT_FOUND],
    );
    assert.deepEqual(await database.run(stopAsk(seams, other, id)), {
      ok: false,
      refusal: STOP_REFUSAL.NOT_FOUND,
    });
  }
  assert.deepEqual(
    await errorOf(
      await database.run(
        handleBrainTurnCancel(h.options(cancelRequest(unrecordedOwner, orphan), unrecordedOwner)),
      ),
    ),
    [409, HOSTED_API_ERROR.NOT_RUNNING],
  );
  assert.deepEqual(await database.run(stopAsk(seams, unrecordedOwner, orphan)), {
    ok: false,
    refusal: STOP_REFUSAL.NOT_RUNNING,
  });
  const [row] = await database.run(database.store.turns.named(unrecordedOwner, [orphan]));
  assert.equal(row?.cancelRequestedAt, null);
});

test("a Stop cancels only the turn it was aimed at: the intended turn ending while the cancel is on the wire leaves the next turn running, and the stamp lands on the intended row alone", async () => {
  const userId = await database.createUser();
  const h = harness();
  const sessionId = mintSession();
  const conversationId = await conversation(userId, {
    runtimeSessionId: sessionId,
  });
  const intended = await turnRow(userId, conversationId, {
    eveTurnId: "turn_1",
  });
  h.eve.activeTurn = "turn_1";
  let next: string | undefined;
  h.eve.beforeCancel = async () => {
    await settleTurn(intended, new Date(NOW));
    next = await turnRow(userId, conversationId, { eveTurnId: "turn_2" });
    h.eve.activeTurn = "turn_2";
  };
  const seams = {
    store: database.store,
    asks: h.asks,
    writer,
    eve: h.eve,
    now: () => h.clock,
  };
  const outcome = await database.run(stopAsk(seams, userId, intended));
  assert.equal(outcome.ok, true);
  assert.deepEqual(h.eve.cancelledTurns, []);
  assert.equal(h.eve.activeTurn, "turn_2");
  assert.deepEqual(h.eve.calls, [{ kind: "cancel", sessionId, eveTurnId: "turn_1" }]);
  assert.ok(next);
  const rows = await database.run(database.store.turns.named(userId, [intended, next]));
  assert.deepEqual(
    new Map(rows.map((row) => [row.eveTurnId, row.cancelRequestedAt?.getTime() ?? null])),
    new Map([
      ["turn_1", NOW],
      ["turn_2", null],
    ]),
  );
});

test("a running row that names no eve turn takes the stamp alone: eve is asked nothing, since nothing of eve's stands under it to name", async () => {
  const userId = await database.createUser();
  const h = harness();
  const sessionId = mintSession();
  const conversationId = await conversation(userId, {
    runtimeSessionId: sessionId,
  });
  const unnamed = await turnRow(userId, conversationId);
  h.eve.activeTurn = "turn_5";
  const seams = {
    store: database.store,
    asks: h.asks,
    writer,
    eve: h.eve,
    now: () => h.clock,
  };
  const outcome = await database.run(stopAsk(seams, userId, unnamed));
  assert.deepEqual(outcome.ok && outcome.answer.cancelRequestedAt, NOW);
  assert.deepEqual(h.eve.calls, []);
  assert.equal(h.eve.activeTurn, "turn_5");
  const [row] = await database.run(database.store.turns.named(userId, [unnamed]));
  assert.equal(row?.cancelRequestedAt?.getTime(), NOW);
});

test("the writer stamps a Stop on a turn the conversation holds once, and refuses a turn it does not hold and a conversation that does not stand", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const turnId = await turnRow(userId, conversationId);
  const target = { userId, conversationId };
  assert.deepEqual(
    await database.run(writer.requestTurnCancel(target, { turnId, at: new Date(NOW) })),
    {
      ok: true,
      effect: STORE_WRITE_EFFECT.WRITTEN,
    },
  );
  assert.deepEqual(
    await database.run(writer.requestTurnCancel(target, { turnId, at: new Date(NOW + 9) })),
    {
      ok: true,
      effect: STORE_WRITE_EFFECT.REPEATED,
    },
  );
  const [row] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.equal(row?.cancelRequestedAt?.getTime(), NOW);
  assert.deepEqual(
    await database.run(
      writer.requestTurnCancel(target, {
        turnId: randomUUID(),
        at: new Date(NOW),
      }),
    ),
    {
      ok: false,
      refusal: STORE_WRITE_REFUSAL.NO_TURN,
    },
  );
  assert.deepEqual(
    await database.run(
      writer.requestTurnCancel(
        { userId, conversationId: randomUUID() },
        { turnId, at: new Date(NOW) },
      ),
    ),
    { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION },
  );
});

it.effect(
  "a held read answers the moment the turn settles, and at the bound with the turn as it then stands",
  () =>
    Effect.gen(function* () {
      const userId = yield* Effect.promise(() => database.createUser());
      const conversationId = yield* Effect.promise(() => conversation(userId));
      const turnId = yield* Effect.promise(() => turnRow(userId, conversationId));
      const [row] = yield* Effect.promise(() =>
        database.run(database.store.turns.named(userId, [turnId])),
      );
      assert.ok(row);
      // The turn as memory holds it, so each poll is a synchronous read the test clock steps
      // through: an adjust runs the read that fell due and arms the next wait before it returns.
      // The client refuses every statement, which is what shows the held read touches no row.
      let turn = row;
      let reads = 0;
      const h = harness();
      const held = (wait: string) =>
        Effect.forkChild(
          Effect.provide(
            handleBrainTurn({
              ...h.options(turnRequest(userId, turnId, { [TURN_WAIT_QUERY]: wait }), userId),
              store: {
                turns: {
                  ...database.store.turns,
                  named: () =>
                    Effect.sync(() => {
                      reads += 1;
                      return [turn];
                    }),
                },
              },
            }),
            noDatabase,
          ),
          { startImmediately: true },
        );

      const settling = yield* held("5000");
      yield* TestClock.adjust(`${TURN_WAIT_POLL_MS} millis`);
      assert.equal(reads, 2);
      turn = { ...turn, status: TURN_STATUS.SETTLED, settledAt: new Date(NOW + 1_000) };
      yield* TestClock.adjust(`${TURN_WAIT_POLL_MS} millis`);
      const answered = yield* Fiber.join(settling);
      assert.equal(answered.status, 200);
      const settled = parse(
        hostedBrainTurnAnswerSchema,
        yield* Effect.promise(() => body(answered)),
      );
      assert.equal(settled?.status, TURN_STATUS.SETTLED);
      assert.equal(settled?.settledAt, NOW + 1_000);
      assert.equal(reads, 3);

      // Held to a bound off the poll's grid: three polls, then the bound's own read, which sees
      // the stamp that landed after the last poll.
      turn = { ...row };
      reads = 0;
      const running = yield* held("1800");
      yield* TestClock.adjust(`${TURN_WAIT_POLL_MS * 3} millis`);
      assert.equal(reads, 4);
      turn = { ...turn, cancelRequestedAt: new Date(NOW + 1_700) };
      yield* TestClock.adjust("300 millis");
      const response = yield* Fiber.join(running);
      const stamped = parse(
        hostedBrainTurnAnswerSchema,
        yield* Effect.promise(() => body(response)),
      );
      assert.equal(response.status, 200);
      assert.equal(stamped?.status, TURN_STATUS.RUNNING);
      assert.equal(stamped?.cancelRequestedAt, NOW + 1_700);
      assert.equal(reads, 5);
    }),
);
