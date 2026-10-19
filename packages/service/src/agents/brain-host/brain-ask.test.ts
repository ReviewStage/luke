import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Database } from "@luke/database/core/query";
import {
  ASK_DISPATCH_REFUSAL,
  type AskRecord,
  type AskRow,
  newestSession,
} from "@luke/database/models/asks";
import { hostTurnId } from "@luke/database/models/ids";
import {
  conversationReachableBy,
  recordedRuntimeSession,
} from "@luke/database/models/recorded-session";
import { openTaskConversation } from "@luke/database/models/task-store";
import { storeWriter } from "@luke/database/models/writer";
import { conversations, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { joinWorkspace, openHostedStoreTestDatabase, startTask } from "@luke/database/testing";
import { ASK_ORIGIN } from "@luke/features";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Option, PartitionedSemaphore, Result, Schema, Stream } from "effect";
import { afterAll, test } from "vitest";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { BRAIN_HOST_TURN } from "./bounds.js";
import {
  ASK_REFUSAL,
  type AskInput,
  acceptAsk,
  STOP_REFUSAL,
  stopAsk,
  stopConversation,
} from "./brain-ask.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_FIRST_TURN_ID,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "./eve-sessions.js";

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
          if (!(yield* conversationReachableBy(target.userId, target.conversationId))) {
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
    unendedSpoken: () => Effect.succeed([]),
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
    reset: () => Effect.die(new Error("this suite retires no session")),
    stream: () => Stream.empty,
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
    accountId: userId,
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
      const db = yield* Database;
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
      const db = yield* Database;
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

function setConversationRuntimeSessionId(conversationId: string, sessionId: string) {
  return database.run(
    Effect.asVoid(
      Database.use((db) =>
        db
          .update(conversations)
          .set({ runtimeSessionId: sessionId })
          .where(eq(conversations.id, conversationId)),
      ),
    ),
  );
}

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

test("stopping a conversation cancels its running turn through eve under its owner; a stranger stops nothing", async () => {
  const owner = await database.createUser();
  const stranger = await database.createUser();
  const h = harness();
  const seams = { store: database.store, asks: h.asks, writer, eve: h.eve };
  const recorded = await conversation(owner, { runtimeSessionId: mintSession() });
  await turnRow(owner, recorded, { eveTurnId: "turn_1" });
  h.eve.activeTurn = "turn_1";

  assert.equal(await database.run(stopConversation(seams, stranger, recorded)), undefined);
  await database.run(stopConversation(seams, owner, recorded));
  assert.deepEqual(h.eve.cancelledTurns, ["turn_1"]);
});

test("a member's ask in the plan conversation a teammate opened is recorded under the teammate and reaches eve; a stranger's in the same conversation is refused as not found", async () => {
  const opener = await database.createUser();
  const member = await database.createUser();
  const stranger = await database.createUser();
  const task = await database.run(startTask(opener, { name: "Teammate invitations" }));
  await database.run(joinWorkspace(task.workspaceId, member));
  const { conversationId } = Option.getOrThrow(
    await database.run(openTaskConversation(opener, task.id)),
  );
  const h = harness();

  assert.deepEqual(
    await h.ask(askIn(opener, conversationId, { accountId: stranger })),
    Result.fail({ refusal: ASK_REFUSAL.NOT_FOUND }),
  );
  assert.equal(h.eve.calls.length, 0);

  const asked = await h.ask(askIn(opener, conversationId, { accountId: member }));
  assert.ok(Result.isSuccess(asked));
  assert.equal(h.asks.rows.get(asked.success.id)?.userId, opener);
  const [open] = h.eve.calls;
  assert.ok(open && open.kind === "open");
  assert.equal(open.message.conversationId, conversationId);
});
