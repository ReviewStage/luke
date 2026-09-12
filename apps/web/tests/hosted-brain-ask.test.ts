import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import {
  ASK_ORIGIN,
  HOSTED_API_ERROR,
  hostedBrainAskAnswerSchema,
  hostedBrainTurnAnswerSchema,
  TURN_WAIT_QUERY,
} from "@sidecar/hosted";
import {
  TURN_ORIGIN,
  TURN_STATUS,
  type TurnStatus,
  type UnparsedWireValue,
  type WireBoundaryInput,
} from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Either, Schema } from "effect";
import { afterAll, test } from "vitest";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  ASK_REFUSAL,
  type AskRecord,
  type AskRow,
  acceptAsk,
  askStanding,
  type BrainTurnCancelOptions,
  handleBrainAsk,
  handleBrainTurn,
  handleBrainTurnCancel,
  STOP_REFUSAL,
  stopAsk,
} from "../server/hosted/brain-ask";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { eveOrigin } from "../server/hosted/brain-host/eve-origin";
import {
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
import { STORE_WRITE_EFFECT, STORE_WRITE_REFUSAL, storeWriter } from "../server/hosted/store";
import { ASK_DISPATCH_REFUSAL, newestSession } from "../server/hosted/store/asks";
import type { HostedStoreRun } from "../server/hosted/store/database";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

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
const writer = await storeWriter({
  run: database.run,
  tools: CATALOG_TOOL_SET,
  now: () => new Date(NOW),
});

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
function memoryAsks(run: HostedStoreRun): AskRecord & { rows: Map<string, AskRow> } {
  const rows = new Map<string, AskRow>();
  const inFlight = new Map<string, Promise<void>>();
  const put = (row: AskRow) => {
    rows.set(row.id, row);
    return row;
  };
  return {
    rows,
    async record(ask) {
      for (const row of rows.values()) {
        if (row.conversationId === ask.conversationId && row.clientId === ask.clientId) return row;
      }
      return put({
        id: randomUUID(),
        userId: ask.userId,
        conversationId: ask.conversationId,
        clientId: ask.clientId,
        origin: ask.origin,
        createdAt: ask.createdAt,
      });
    },
    async named(userId, id) {
      const row = rows.get(id);
      return row?.userId === userId ? row : undefined;
    },
    async latestSession(userId, conversationId) {
      return latestSession(userId, conversationId);
    },
    async dispatchOnce(target, id, dispatch) {
      // One dispatch at a time per conversation, as the conversation lock serialises them on the real record.
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
        const answered = await dispatch(session);
        return answered === undefined ? row : put({ ...row, ...answered });
      });
      inFlight.set(
        target.conversationId,
        turn.then(
          () => undefined,
          () => undefined,
        ),
      );
      return turn;
    },
    async cancelRequested(id, at) {
      const row = rows.get(id);
      assert.ok(row);
      put({ ...row, cancelRequestedAt: at });
    },
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
  | { readonly kind: "send"; readonly sessionId: string; readonly message: EveMessage }
  | { readonly kind: "cancel"; readonly sessionId: string };

interface FakeEve extends EveSessions {
  readonly calls: EveCall[];
  /** The bearers eve was reached under. */
  readonly bearers: string[];
  /** Sessions eve has retired, so a follow-up to one reads as such. */
  readonly retired: Set<string>;
  failNext: number | undefined;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    calls: [],
    bearers: [],
    retired: new Set(),
    failNext: undefined,
    async open(message) {
      eve.calls.push({ kind: "open", message });
      if (eve.failNext !== undefined) {
        const status = eve.failNext;
        eve.failNext = undefined;
        return { outcome: EVE_SEND_OUTCOME.FAILED, status };
      }
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintSession() };
    },
    async send(sessionId, message) {
      eve.calls.push({ kind: "send", sessionId, message });
      if (eve.retired.has(sessionId)) return { outcome: EVE_SEND_OUTCOME.RETIRED };
      return {
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId,
        deliveryId: `delivery-${eve.calls.length}`,
      };
    },
    async cancel(sessionId) {
      eve.calls.push({ kind: "cancel", sessionId });
      return { outcome: EVE_SEND_OUTCOME.ACCEPTED };
    },
  };
  return eve;
}

interface Harness {
  readonly asks: ReturnType<typeof memoryAsks>;
  readonly eve: FakeEve;
  clock: number;
  /** What the world does while a held read sleeps; the clock moves by the sleep either way. */
  whileSleeping: () => Promise<void>;
  options(request: Request, userId: string | undefined): BrainTurnCancelOptions;
}

function harness(): Harness {
  const asks = memoryAsks(database.run);
  const eve = fakeEve();
  const built: Harness = {
    asks,
    eve,
    clock: NOW,
    whileSleeping: async () => {},
    options: (request, userId) => ({
      request,
      resolveUserId: async () => userId,
      run: database.run,
      store: database.store,
      writer,
      asks,
      eve: (authorization) => {
        eve.bearers.push(authorization);
        return eve;
      },
      now: () => built.clock,
      sleep: async (ms) => {
        built.clock += ms;
        await built.whileSleeping();
      },
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
    headers: { authorization: bearer(userId), "content-type": "application/json" },
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
  return new Request(url, { method, headers: { authorization: bearer(userId) } });
}

async function body(response: Response): Promise<UnparsedWireValue> {
  // SAFETY: the route's own JSON answer; the schema read is the validation.
  return (await response.json()) as UnparsedWireValue;
}

function parse<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
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
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        insert into conversations (user_id, kind, runtime_session_id, deleted_at)
        values (
          ${userId}, ${CONVERSATION_KIND.MAIN},
          ${overrides.runtimeSessionId ?? null}, ${overrides.deletedAt ?? null}
        )
        returning id
      `;
      return yield* Schema.decodeUnknown(IdRowSchema)(rows[0]);
    }),
  );
  return row.id;
}

interface TurnOverrides {
  readonly status?: TurnStatus;
  readonly settledAt?: Date;
  readonly cancelRequestedAt?: Date;
}

async function turnRow(
  userId: string,
  conversationId: string,
  overrides: TurnOverrides = {},
): Promise<string> {
  const row = await database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`
        insert into turns (
          user_id, conversation_id, origin, status,
          queued_at, started_at, settled_at, cancel_requested_at
        )
        values (
          ${userId}, ${conversationId}, ${TURN_ORIGIN.TYPED}, ${overrides.status ?? TURN_STATUS.RUNNING},
          ${new Date(NOW)}, ${new Date(NOW)}, ${overrides.settledAt ?? null}, ${overrides.cancelRequestedAt ?? null}
        )
        returning id
      `;
      return yield* Schema.decodeUnknown(IdRowSchema)(rows[0]);
    }),
  );
  return row.id;
}

function setConversationRuntimeSessionId(conversationId: string, sessionId: string) {
  return database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update conversations set runtime_session_id = ${sessionId} where id = ${conversationId}
      `;
    }),
  );
}

function stampConversationDeletedAt(conversationId: string, deletedAt: Date) {
  return database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update conversations set deleted_at = ${deletedAt} where id = ${conversationId}
      `;
    }),
  );
}

function settleTurn(turnId: string, settledAt: Date) {
  return database.run(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        update turns set status = ${TURN_STATUS.SETTLED}, settled_at = ${settledAt}
        where id = ${turnId}
      `;
    }),
  );
}

const ASK = { question: "what changed?", origin: ASK_ORIGIN.TYPED, clientId: CLIENT_ID };

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

test("the gates each refuse on their own: method, bearer, body, the path's id, and the wait bound", async () => {
  const userId = await database.createUser();
  const h = harness();
  assert.deepEqual(await errorOf(await handleBrainAsk(h.options(askRead(userId), userId))), [
    405,
    HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
  ]);
  assert.deepEqual(
    await errorOf(await handleBrainAsk(h.options(askRequest(userId, ASK), undefined))),
    [401, HOSTED_API_ERROR.INVALID_TOKEN],
  );
  assert.deepEqual(
    await errorOf(
      await handleBrainAsk(h.options(askRequest(userId, { ...ASK, extra: 1 }), userId)),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await handleBrainAsk(
        h.options(askRequest(userId, { ...ASK, origin: TURN_ORIGIN.ROSTER_DIFF }), userId),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(await handleBrainTurn(h.options(turnRequest(userId, undefined), userId))),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(await handleBrainTurn(h.options(turnRequest(userId, "not-a-uuid"), userId))),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
  assert.deepEqual(
    await errorOf(
      await handleBrainTurn(
        h.options(turnRequest(userId, randomUUID(), { [TURN_WAIT_QUERY]: "90000" }), userId),
      ),
    ),
    [400, HOSTED_API_ERROR.INVALID_REQUEST],
  );
  assert.deepEqual(
    await errorOf(
      await handleBrainTurnCancel(h.options(turnRequest(userId, randomUUID()), userId)),
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
  const response = await handleBrainAsk(
    h.options(askRequest(other, { ...ASK, conversationId: owned }), other),
  );
  assert.deepEqual(await errorOf(response), [404, HOSTED_API_ERROR.NOT_FOUND]);
  assert.deepEqual(h.eve.calls, []);
  assert.equal(h.asks.rows.size, 0);
});

test("an ask naming a cleared conversation is refused as not found before eve is reached; the account's next ask without one opens a fresh main", async () => {
  const userId = await database.createUser();
  const cleared = await conversation(userId, { deletedAt: new Date(NOW) });
  const h = harness();
  const refused = await handleBrainAsk(
    h.options(askRequest(userId, { ...ASK, conversationId: cleared }), userId),
  );
  assert.deepEqual(await errorOf(refused), [404, HOSTED_API_ERROR.NOT_FOUND]);
  assert.deepEqual(h.eve.calls, []);

  const opened = await handleBrainAsk(h.options(askRequest(userId, ASK), userId));
  assert.equal(opened.status, 202);
  const answer = parse(hostedBrainAskAnswerSchema, await body(opened));
  assert.ok(answer);
  assert.notEqual(answer.conversationId, cleared);
  assert.equal(h.eve.calls.length, 1);
});

test("the first ask opens the conversation's session under the caller's own bearer and its turn is the session's first; a second ask follows up on the recorded session and stands on its delivery", async () => {
  const userId = await database.createUser();
  const h = harness();
  const first = await handleBrainAsk(h.options(askRequest(userId, ASK), userId));
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
  const second = await handleBrainAsk(
    h.options(
      askRequest(userId, { ...ASK, clientId: randomUUID(), origin: ASK_ORIGIN.SPOKEN }),
      userId,
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
  await handleBrainAsk(h.options(askRequest(userId, ASK), userId));
  await handleBrainAsk(h.options(askRequest(userId, { ...ASK, clientId: randomUUID() }), userId));
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
  const conversationId = await conversation(userId, { runtimeSessionId: older });
  const first = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await handleBrainAsk(h.options(askRequest(userId, { ...ASK, conversationId }), userId)),
    ),
  );
  assert.ok(first);
  const record = h.asks.rows.get(first.id);
  assert.ok(record);
  h.asks.rows.set(first.id, { ...record, sessionId: newer });

  await handleBrainAsk(
    h.options(askRequest(userId, { ...ASK, conversationId, clientId: randomUUID() }), userId),
  );
  const [, send] = h.eve.calls;
  assert.ok(send && send.kind === "send");
  assert.equal(send.sessionId, newer);
});

test("a session eve has retired is opened again for the ask that found it so", async () => {
  const userId = await database.createUser();
  const h = harness();
  const stale = mintSession();
  const conversationId = await conversation(userId, { runtimeSessionId: stale });
  h.eve.retired.add(stale);
  const response = await handleBrainAsk(
    h.options(askRequest(userId, { ...ASK, conversationId }), userId),
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
  const refused = await handleBrainAsk(h.options(askRequest(userId, ASK), userId));
  assert.deepEqual(await errorOf(refused), [502, HOSTED_API_ERROR.UPSTREAM_ERROR]);
  assert.equal(h.asks.rows.size, 1);

  const retried = await handleBrainAsk(h.options(askRequest(userId, ASK), userId));
  assert.equal(retried.status, 202);
  const accepted = parse(hostedBrainAskAnswerSchema, await body(retried));
  assert.ok(accepted);
  const again = await handleBrainAsk(h.options(askRequest(userId, ASK), userId));
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
  const read = await handleBrainTurn(h.options(turnRequest(owner, turnId), owner));
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
    await errorOf(await handleBrainTurn(h.options(turnRequest(other, turnId), other))),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );

  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId }), owner)),
    ),
  );
  assert.ok(asked);
  const row = h.asks.rows.get(asked.id);
  assert.ok(row);
  h.asks.rows.set(asked.id, beforeItsTurn(row));
  const queued = parse(
    hostedBrainTurnAnswerSchema,
    await body(await handleBrainTurn(h.options(turnRequest(owner, asked.id), owner))),
  );
  assert.deepEqual(queued, {
    id: asked.id,
    conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.QUEUED,
    queuedAt: NOW,
  });

  assert.deepEqual(
    await errorOf(await handleBrainTurn(h.options(turnRequest(other, asked.id), other))),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );

  await stampConversationDeletedAt(conversationId, new Date(NOW));
  assert.deepEqual(
    await errorOf(await handleBrainTurn(h.options(turnRequest(owner, asked.id), owner))),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
  assert.deepEqual(
    await errorOf(await handleBrainTurn(h.options(turnRequest(owner, turnId), owner))),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
});

test("the in-process standing read answers what the turn route answers: for a queued ask, for a turn row, for another account's id, and for a conversation cleared under both", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const conversationId = await conversation(owner);
  const turnId = await turnRow(owner, conversationId, { cancelRequestedAt: new Date(NOW + 1) });
  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId }), owner)),
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
      await body(await handleBrainTurn(h.options(turnRequest(userId, id), userId))),
    );

  for (const id of [asked.id, turnId]) {
    const viaRoute = await routed(owner, id);
    assert.ok(viaRoute);
    assert.deepEqual((await askStanding(reads, owner, id))?.answer, viaRoute);
    assert.equal(await routed(other, id), undefined);
    assert.equal(await askStanding(reads, other, id), undefined);
  }

  await stampConversationDeletedAt(conversationId, new Date(NOW));
  for (const id of [asked.id, turnId]) {
    assert.deepEqual(
      await errorOf(await handleBrainTurn(h.options(turnRequest(owner, id), owner))),
      [404, HOSTED_API_ERROR.NOT_FOUND],
    );
    assert.equal(await askStanding(reads, owner, id), undefined);
  }
});

test("the in-process ask answers what the ask route answers: the same record again for the same client id, and the same refusal for another account's conversation", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const conversationId = await conversation(owner);
  const seams = { run: database.run, asks: h.asks, eve: h.eve, now: () => h.clock };
  const routed = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await handleBrainAsk(h.options(askRequest(owner, { ...ASK, conversationId }), owner)),
    ),
  );
  assert.ok(routed);
  assert.deepEqual(await acceptAsk(seams, { ...ASK, conversationId, userId: owner }), {
    ok: true,
    answer: routed,
  });
  assert.equal(h.eve.calls.length, 1);

  assert.deepEqual(
    await errorOf(
      await handleBrainAsk(h.options(askRequest(other, { ...ASK, conversationId }), other)),
    ),
    [404, HOSTED_API_ERROR.NOT_FOUND],
  );
  assert.deepEqual(await acceptAsk(seams, { ...ASK, conversationId, userId: other }), {
    ok: false,
    refusal: ASK_REFUSAL.NOT_FOUND,
  });
  assert.equal(h.eve.calls.length, 1);
});

function cancelRequest(userId: string, id: string | undefined): Request {
  return turnRequest(userId, id, {}, "POST");
}

test("a Stop on a running turn is eve's cancel of the conversation's recorded session and a stamp on the row; on an ask still waiting it is a stamp on the record and reaches eve not at all", async () => {
  const userId = await database.createUser();
  const h = harness();
  const sessionId = mintSession();
  const conversationId = await conversation(userId, { runtimeSessionId: sessionId });
  const turnId = await turnRow(userId, conversationId);
  const cancelled = await handleBrainTurnCancel(h.options(cancelRequest(userId, turnId), userId));
  assert.equal(cancelled.status, 200);
  const answer = parse(hostedBrainTurnAnswerSchema, await body(cancelled));
  assert.equal(answer?.cancelRequestedAt, NOW);
  assert.deepEqual(h.eve.calls, [{ kind: "cancel", sessionId }]);
  const [row] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.equal(row?.cancelRequestedAt?.getTime(), NOW);

  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await handleBrainAsk(h.options(askRequest(userId, { ...ASK, conversationId }), userId)),
    ),
  );
  assert.ok(asked);
  const record = h.asks.rows.get(asked.id);
  assert.ok(record);
  h.asks.rows.set(asked.id, beforeItsTurn(record));
  const callsBefore = h.eve.calls.length;
  const stamped = await handleBrainTurnCancel(h.options(cancelRequest(userId, asked.id), userId));
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
  const recorded = await conversation(owner, { runtimeSessionId: mintSession() });
  const running = await turnRow(owner, recorded);
  const unrecordedOwner = await database.createUser();
  const unrecorded = await conversation(unrecordedOwner);
  const orphan = await turnRow(unrecordedOwner, unrecorded);
  const asked = parse(
    hostedBrainAskAnswerSchema,
    await body(
      await handleBrainAsk(
        h.options(askRequest(owner, { ...ASK, conversationId: recorded }), owner),
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
      await body(await handleBrainTurnCancel(h.options(cancelRequest(owner, id), owner))),
    );
    assert.ok(viaRoute);
    assert.deepEqual(await stopAsk(seams, owner, id), { ok: true, answer: viaRoute });
    assert.deepEqual(
      await errorOf(await handleBrainTurnCancel(h.options(cancelRequest(other, id), other))),
      [404, HOSTED_API_ERROR.NOT_FOUND],
    );
    assert.deepEqual(await stopAsk(seams, other, id), {
      ok: false,
      refusal: STOP_REFUSAL.NOT_FOUND,
    });
  }
  assert.deepEqual(
    await errorOf(
      await handleBrainTurnCancel(
        h.options(cancelRequest(unrecordedOwner, orphan), unrecordedOwner),
      ),
    ),
    [409, HOSTED_API_ERROR.NOT_RUNNING],
  );
  assert.deepEqual(await stopAsk(seams, unrecordedOwner, orphan), {
    ok: false,
    refusal: STOP_REFUSAL.NOT_RUNNING,
  });
  const [row] = await database.run(database.store.turns.named(unrecordedOwner, [orphan]));
  assert.equal(row?.cancelRequestedAt, null);
});

test("the writer stamps a Stop on a turn the conversation holds once, and refuses a turn it does not hold and a conversation that does not stand", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const turnId = await turnRow(userId, conversationId);
  const target = { userId, conversationId };
  assert.deepEqual(await writer.requestTurnCancel(target, { turnId, at: new Date(NOW) }), {
    ok: true,
    effect: STORE_WRITE_EFFECT.WRITTEN,
  });
  assert.deepEqual(await writer.requestTurnCancel(target, { turnId, at: new Date(NOW + 9) }), {
    ok: true,
    effect: STORE_WRITE_EFFECT.REPEATED,
  });
  const [row] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.equal(row?.cancelRequestedAt?.getTime(), NOW);
  assert.deepEqual(
    await writer.requestTurnCancel(target, { turnId: randomUUID(), at: new Date(NOW) }),
    {
      ok: false,
      refusal: STORE_WRITE_REFUSAL.NO_TURN,
    },
  );
  assert.deepEqual(
    await writer.requestTurnCancel(
      { userId, conversationId: randomUUID() },
      { turnId, at: new Date(NOW) },
    ),
    { ok: false, refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION },
  );
});

test("a held read answers the moment the turn settles, and at the bound with the turn as it then stands", async () => {
  const userId = await database.createUser();
  const h = harness();
  const conversationId = await conversation(userId);
  const turnId = await turnRow(userId, conversationId);
  let sleeps = 0;
  h.whileSleeping = async () => {
    sleeps += 1;
    if (sleeps !== 2) return;
    await settleTurn(turnId, new Date(NOW + 1_000));
  };
  const settling = await handleBrainTurn(
    h.options(turnRequest(userId, turnId, { [TURN_WAIT_QUERY]: "5000" }), userId),
  );
  assert.equal(settling.status, 200);
  const settled = parse(hostedBrainTurnAnswerSchema, await body(settling));
  assert.equal(settled?.status, TURN_STATUS.SETTLED);
  assert.equal(sleeps, 2);
  assert.equal(h.clock, NOW + 1_000);
  h.whileSleeping = async () => {};

  const running = await turnRow(userId, conversationId);
  const before = h.clock;
  const held = parse(
    hostedBrainTurnAnswerSchema,
    await body(
      await handleBrainTurn(
        h.options(turnRequest(userId, running, { [TURN_WAIT_QUERY]: "2000" }), userId),
      ),
    ),
  );
  assert.equal(held?.status, TURN_STATUS.RUNNING);
  assert.equal(h.clock, before + 2_000);
});
