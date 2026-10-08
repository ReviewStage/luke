import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { ASK_ORIGIN } from "@sidecar/hosted";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@sidecar/wire";
import { eq } from "drizzle-orm";
import { Deferred, Duration, Effect, Fiber, PartitionedSemaphore, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import { afterAll, test } from "vitest";
import { db } from "../server/db/query";
import { conversations, turns } from "../server/db/storage-schema";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import {
  ASK_DISPATCH_DEADLINE,
  ASK_REFUSAL,
  type AskInput,
  acceptAsk,
  askStanding,
  STOP_REFUSAL,
  stopAsk,
} from "../server/hosted/brain-ask";
import { BRAIN_HOST_ENVIRONMENT, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { deploymentEveOrigin } from "../server/hosted/brain-host/eve-origin";
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
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { STORE_WRITE_EFFECT, storeWriter } from "../server/hosted/store";
import {
  ASK_DISPATCH_REFUSAL,
  type AskRecord,
  type AskRow,
  newestSession,
} from "../server/hosted/store/asks";
import { STORE_WRITE_REFUSAL } from "../server/hosted/store/writer";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/**
 * The ask door over the real store on PGlite. The ownership refusals here
 * are the door's own: another account's conversation and a cleared
 * conversation are each refused before eve is reached, and eve being
 * reached is the failure each test names. The ask record is the in-memory
 * shape of the table the door stands on; the door reads nothing of it the
 * table does not hold.
 */

const NOW = 1_800_000_000_000;
const database = await openHostedStoreTestDatabase({ at: NOW });
afterAll(() => database.close());

/** The store writer over the test database, for the one write a Stop makes on a turn's row. */
const writer = await database.run(
  storeWriter({
    tools: HOSTED_TOOL_SET,
  }),
);

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
  const locks = PartitionedSemaphore.makeUnsafe<string>({ permits: 1 });
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
      locks.withPermit(target.conversationId)(
        Effect.gen(function* () {
          if (!(yield* conversationOwnedBy(target.userId, target.conversationId))) {
            return ASK_DISPATCH_REFUSAL.NO_CONVERSATION;
          }
          const row = rows.get(id);
          assert.ok(row);
          if (row.sessionId !== undefined) return row;
          const session = newestSession(
            yield* recordedRuntimeSession(target),
            latestSession(target.userId, target.conversationId),
          );
          const answered = yield* dispatch(session);
          return answered === undefined ? row : put({ ...row, ...answered });
        }),
      ),
    cancelRequested: (id, at) =>
      Effect.sync(() => {
        const row = rows.get(id);
        assert.ok(row);
        put({ ...row, cancelRequestedAt: at });
      }),
    // These asks are typed, so no voice session's asks are ever read back or told.
    spokenIn: () => Effect.succeed([]),
    told: () => Effect.void,
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
  /** Sessions eve has retired, so a follow-up to one reads as such. */
  readonly retired: Set<string>;
  failNext: number | undefined;
  /** eve's turn under way, by eve's own id; a cancel naming it, or naming none, ends it. */
  activeTurn: string | undefined;
  /** The turns eve's cancels actually ended, in order. */
  readonly cancelledTurns: string[];
  /** What the world does while a cancel is on the wire, between the Stop's read and eve's answer. */
  beforeCancel: () => Promise<void>;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    calls: [],
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

interface Harness {
  readonly asks: ReturnType<typeof memoryAsks>;
  readonly eve: FakeEve;
  /** Accepts one ask over the harness's record and eve. */
  ask(input: AskInput): Promise<Effect.Success<ReturnType<typeof acceptAsk>>>;
}

function harness(): Harness {
  const asks = memoryAsks();
  const eve = fakeEve();
  return { asks, eve, ask: (input) => database.run(acceptAsk({ asks, eve }, input)) };
}

/** What a caller that has already resolved the account hands the door: an ask in the given conversation. */
function askIn(
  userId: string,
  conversationId: string,
  overrides: Partial<AskInput> = {},
): AskInput {
  return {
    userId,
    conversationId,
    question: "what changed?",
    origin: ASK_ORIGIN.TYPED,
    clientId: CLIENT_ID,
    ...overrides,
  };
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
          queuedAt: new Date(NOW),
          startedAt: new Date(NOW),
          settledAt: overrides.settledAt ?? null,
          cancelRequestedAt: overrides.cancelRequestedAt ?? null,
          eveTurnId: overrides.eveTurnId ?? null,
        })
        .returning({ id: turns.id });
      return yield* Schema.decodeUnknownEffect(IdRowSchema)(rows[0]);
    }),
  );
  return row.id;
}

function settleTurn(turnId: string, settledAt: Date) {
  return database.run(
    Effect.asVoid(
      db.update(turns).set({ status: TURN_STATUS.SETTLED, settledAt }).where(eq(turns.id, turnId)),
    ),
  );
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
  withDeployment({ EVE_ORIGIN: "https://eve.luke.test" }, () =>
    assert.equal(deploymentEveOrigin(), "https://eve.luke.test"),
  );
});

test("a blank origin in the environment counts as none named", () => {
  withDeployment(
    { EVE_ORIGIN: "  ", ENVIRONMENT: "preview", URL: "luke-abc123-luke.vercel.app" },
    () => assert.equal(deploymentEveOrigin(), "https://luke-abc123-luke.vercel.app"),
  );
  withDeployment({ EVE_ORIGIN: "  " }, () => assert.equal(deploymentEveOrigin(), undefined));
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

test("an ask naming another account's conversation is refused as not found before eve is reached, and nothing is recorded", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const owned = await conversation(owner);
  const h = harness();
  assert.deepEqual(
    await h.ask(askIn(other, owned)),
    Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND }),
  );
  assert.deepEqual(h.eve.calls, []);
  assert.equal(h.asks.rows.size, 0);
});

test("an ask naming a cleared conversation is refused as not found before eve is reached, and nothing is recorded", async () => {
  const userId = await database.createUser();
  const cleared = await conversation(userId, { deletedAt: new Date(NOW) });
  const h = harness();
  assert.deepEqual(
    await h.ask(askIn(userId, cleared)),
    Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND }),
  );
  assert.deepEqual(h.eve.calls, []);
  assert.equal(h.asks.rows.size, 0);
});

test("the first ask opens the conversation's session and its turn is the session's first; a second ask follows up on the recorded session and stands on its delivery", async () => {
  const userId = await database.createUser();
  const conversationId = await conversation(userId);
  const h = harness();
  const first = await h.ask(askIn(userId, conversationId));
  assert.ok(Result.isSuccess(first));
  const accepted = first.success;
  assert.equal(accepted.conversationId, conversationId);
  assert.equal(accepted.queuedAt, NOW);
  const [open] = h.eve.calls;
  assert.ok(open && open.kind === "open");
  assert.deepEqual(open.message, {
    conversationId,
    turn: BRAIN_HOST_TURN.TYPED,
    message: "what changed?",
  });
  const recorded = h.asks.rows.get(accepted.id);
  assert.ok(recorded?.sessionId);
  assert.equal(recorded.turnId, hostTurnId(recorded.sessionId, EVE_FIRST_TURN_ID));
  assert.equal(recorded.deliveryId, undefined);

  await setConversationRuntimeSessionId(conversationId, recorded.sessionId);
  const second = await h.ask(
    askIn(userId, conversationId, { clientId: randomUUID(), origin: ASK_ORIGIN.SPOKEN }),
  );
  assert.ok(Result.isSuccess(second));
  const followUp = second.success;
  assert.equal(followUp.conversationId, conversationId);
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
  const conversationId = await conversation(userId);
  const h = harness();
  await h.ask(askIn(userId, conversationId));
  await h.ask(askIn(userId, conversationId, { clientId: randomUUID() }));
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
  const first = await h.ask(askIn(userId, conversationId));
  assert.ok(Result.isSuccess(first));
  const record = h.asks.rows.get(first.success.id);
  assert.ok(record);
  h.asks.rows.set(first.success.id, { ...record, sessionId: newer });

  await h.ask(askIn(userId, conversationId, { clientId: randomUUID() }));
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
  assert.ok(Result.isSuccess(await h.ask(askIn(userId, conversationId))));
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
  const conversationId = await conversation(userId);
  const h = harness();
  h.eve.failNext = 503;
  assert.deepEqual(
    await h.ask(askIn(userId, conversationId)),
    Result.fail({ refusal: ASK_REFUSAL.UPSTREAM, status: 503 }),
  );
  assert.equal(h.asks.rows.size, 1);

  const retried = await h.ask(askIn(userId, conversationId));
  assert.ok(Result.isSuccess(retried));
  assert.deepEqual(await h.ask(askIn(userId, conversationId)), retried);
  assert.equal(h.eve.calls.length, 2);
  assert.equal(h.asks.rows.size, 1);
});

test("the standing read answers a turn row under its own id, an ask without a turn on its record alone, an ask whose turn started with that turn, and another account's id or a cleared conversation's as not found", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const reads = { store: database.store, asks: h.asks };
  const standing = (userId: string, id: string) => database.run(askStanding(reads, userId, id));
  const conversationId = await conversation(owner);
  const turnId = await turnRow(owner, conversationId, {
    status: TURN_STATUS.SETTLED,
    settledAt: new Date(NOW + 5_000),
  });
  const turn = await standing(owner, turnId);
  assert.equal(turn?.ask, undefined);
  assert.deepEqual(
    turn?.turn && {
      id: turn.turn.id,
      conversationId: turn.turn.conversationId,
      origin: turn.turn.origin,
      status: turn.turn.status,
      queuedAt: turn.turn.queuedAt.getTime(),
      startedAt: turn.turn.startedAt?.getTime(),
      settledAt: turn.turn.settledAt?.getTime(),
    },
    {
      id: turnId,
      conversationId,
      origin: TURN_ORIGIN.TYPED,
      status: TURN_STATUS.SETTLED,
      queuedAt: NOW,
      startedAt: NOW,
      settledAt: NOW + 5_000,
    },
  );

  const asked = await h.ask(askIn(owner, conversationId));
  assert.ok(Result.isSuccess(asked));
  const record = h.asks.rows.get(asked.success.id);
  assert.ok(record);
  h.asks.rows.set(asked.success.id, beforeItsTurn(record));
  assert.deepEqual(await standing(owner, asked.success.id), {
    ask: beforeItsTurn(record),
    turn: undefined,
  });

  h.asks.rows.set(asked.success.id, { ...record, turnId });
  assert.deepEqual(await standing(owner, asked.success.id), {
    ask: { ...record, turnId },
    turn: turn?.turn,
  });

  for (const id of [asked.success.id, turnId]) {
    assert.equal(await standing(other, id), undefined);
  }
  assert.equal(await standing(owner, randomUUID()), undefined);

  await stampConversationDeletedAt(conversationId, new Date(NOW));
  for (const id of [asked.success.id, turnId]) {
    assert.equal(await standing(owner, id), undefined);
  }
});

test("a Stop on a running turn is eve's cancel of that turn in the conversation's recorded session and a stamp on the row; on an ask still waiting it is a stamp on the record and reaches eve not at all", async () => {
  const userId = await database.createUser();
  const h = harness();
  const sessionId = mintSession();
  const conversationId = await conversation(userId, {
    runtimeSessionId: sessionId,
  });
  const seams = { store: database.store, asks: h.asks, writer, eve: h.eve };
  const turnId = await turnRow(userId, conversationId, { eveTurnId: "turn_1" });
  h.eve.activeTurn = "turn_1";
  assert.deepEqual(
    await database.run(stopAsk(seams, userId, turnId)),
    Result.succeed({ status: TURN_STATUS.RUNNING, cancelRequestedAt: NOW }),
  );
  assert.deepEqual(h.eve.calls, [{ kind: "cancel", sessionId, eveTurnId: "turn_1" }]);
  assert.deepEqual(h.eve.cancelledTurns, ["turn_1"]);
  const [row] = await database.run(database.store.turns.named(userId, [turnId]));
  assert.equal(row?.cancelRequestedAt?.getTime(), NOW);

  const asked = await h.ask(askIn(userId, conversationId));
  assert.ok(Result.isSuccess(asked));
  const record = h.asks.rows.get(asked.success.id);
  assert.ok(record);
  h.asks.rows.set(asked.success.id, beforeItsTurn(record));
  const callsBefore = h.eve.calls.length;
  assert.deepEqual(
    await database.run(stopAsk(seams, userId, asked.success.id)),
    Result.succeed({ status: TURN_STATUS.QUEUED, cancelRequestedAt: NOW }),
  );
  assert.equal(h.asks.rows.get(asked.success.id)?.cancelRequestedAt?.getTime(), NOW);
  assert.equal(h.eve.calls.length, callsBefore);
});

test("a Stop on another account's id is refused as not found, and one on a turn whose conversation records no session as not running, leaving the row unstamped", async () => {
  const owner = await database.createUser();
  const other = await database.createUser();
  const h = harness();
  const seams = { store: database.store, asks: h.asks, writer, eve: h.eve };
  const recorded = await conversation(owner, { runtimeSessionId: mintSession() });
  const running = await turnRow(owner, recorded, { eveTurnId: "turn_1" });
  const asked = await h.ask(askIn(owner, recorded));
  assert.ok(Result.isSuccess(asked));
  for (const id of [running, asked.success.id]) {
    assert.deepEqual(
      await database.run(stopAsk(seams, other, id)),
      Result.fail({ refusal: STOP_REFUSAL.NOT_FOUND }),
    );
  }
  const unrecordedOwner = await database.createUser();
  const unrecorded = await conversation(unrecordedOwner);
  const orphan = await turnRow(unrecordedOwner, unrecorded);
  assert.deepEqual(
    await database.run(stopAsk(seams, unrecordedOwner, orphan)),
    Result.fail({ refusal: STOP_REFUSAL.NOT_RUNNING }),
  );
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
  const seams = { store: database.store, asks: h.asks, writer, eve: h.eve };
  const outcome = await database.run(stopAsk(seams, userId, intended));
  assert.ok(Result.isSuccess(outcome));
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
  const conversationId = await conversation(userId, {
    runtimeSessionId: mintSession(),
  });
  const unnamed = await turnRow(userId, conversationId);
  h.eve.activeTurn = "turn_5";
  const seams = { store: database.store, asks: h.asks, writer, eve: h.eve };
  const outcome = await database.run(stopAsk(seams, userId, unnamed));
  assert.deepEqual(Result.isSuccess(outcome) && outcome.success.cancelRequestedAt, NOW);
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
    Result.succeed(STORE_WRITE_EFFECT.WRITTEN),
  );
  assert.deepEqual(
    await database.run(writer.requestTurnCancel(target, { turnId, at: new Date(NOW + 9) })),
    Result.succeed(STORE_WRITE_EFFECT.REPEATED),
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
    Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_TURN }),
  );
  assert.deepEqual(
    await database.run(
      writer.requestTurnCancel(
        { userId, conversationId: randomUUID() },
        { turnId, at: new Date(NOW) },
      ),
    ),
    Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION }),
  );
});

it.effect(
  "a dispatch eve never answers is released at the deadline: the ask is refused as eve unreachable and its row stands undispatched for a retry",
  () =>
    Effect.gen(function* () {
      const userId = yield* Effect.promise(() => database.createUser());
      const conversationId = yield* Effect.promise(() => conversation(userId));
      const h = harness();
      // eve takes the message and never answers, as a call hung on the wire would.
      const reached = yield* Deferred.make<void>();
      const hung: EveSessions = {
        ...h.eve,
        open: (message) =>
          Effect.andThen(
            Effect.sync(() => h.eve.calls.push({ kind: "open", message })),
            Effect.andThen(Deferred.succeed(reached, undefined), Effect.never),
          ),
      };
      const accepting = yield* Effect.forkChild(
        Effect.provide(
          acceptAsk({ asks: h.asks, eve: hung }, askIn(userId, conversationId)),
          database.sql,
        ),
        { startImmediately: true },
      );
      yield* Deferred.await(reached);
      yield* TestClock.adjust(Duration.subtract(ASK_DISPATCH_DEADLINE, Duration.seconds(1)));
      assert.equal(accepting.pollUnsafe(), undefined);
      yield* TestClock.adjust(Duration.seconds(1));
      assert.deepEqual(
        yield* Fiber.join(accepting),
        Result.fail({ refusal: ASK_REFUSAL.UPSTREAM, status: 502 }),
      );
      const [row] = h.asks.rows.values();
      assert.ok(row);
      assert.deepEqual([row.clientId, row.sessionId], [CLIENT_ID, undefined]);
    }),
);
