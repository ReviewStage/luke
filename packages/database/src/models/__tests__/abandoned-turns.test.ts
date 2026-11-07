import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  RUN_EVENT,
  RUN_STATUS,
  RUN_TURN_ORIGIN,
  TURN_FAILURE,
  TURN_TRIGGER,
} from "@repo/features/turn-run";
import { sessionKey } from "@repo/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations, turns } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  LOST_TURNS,
  lapsedTurnIds,
  runningTurnIds,
  settleEndedSession,
  settleEndedSessionTurn,
  settleRunnerLostTurns,
} from "../abandoned-turns.js";
import { latestTurnsOfReached } from "../agent-store.js";
import { renewTurnLease, TURN_LEASE } from "../turn-lease.js";
import { type ConversationTarget, type StoreWriter, storeWriter } from "../writer.js";

/**
 * How a coding agent's turn whose end is never coming is read and settled,
 * over a real dialect: read as lapsed once its lease ran out, settled as its
 * runner lost, and settled at once when its session ended for good.
 *
 * Synthetic accounts, conversations, and turns throughout.
 */

const STARTED_AT = 1_800_000_000_000;

/** A conversation of a new account, of the kind given, recording the eve session given where one is. */
const openConversation = (
  kind: (typeof CONVERSATION_KIND)[keyof typeof CONVERSATION_KIND],
  runtimeSessionId?: string,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind, runtimeSessionId: runtimeSessionId ?? null });
    return { userId, conversationId } satisfies ConversationTarget;
  });

/** A coding agent's conversation of a new account. */
const openAgentConversation = openConversation(CONVERSATION_KIND.AGENT);

/** A turn of the conversation's: queued, begun by eve, or begun and ended as it succeeded; answers its id. */
const turnIn = (
  writer: StoreWriter,
  target: ConversationTarget,
  stands: typeof TURN_STATUS.QUEUED | typeof TURN_STATUS.RUNNING | typeof TURN_STATUS.SETTLED,
) =>
  Effect.gen(function* () {
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(target.conversationId), turnId };
    yield* writer.enqueueTurn(target, {
      turnId,
      origin: TURN_ORIGIN.TYPED,
      runtimeTurnId: "turn_0",
    });
    if (stands === TURN_STATUS.QUEUED) return turnId;
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: STARTED_AT,
    });
    if (stands === TURN_STATUS.RUNNING) return turnId;
    yield* writer.consume(target, {
      ...turn,
      kind: RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: RUN_STATUS.SUCCEEDED,
      responseIds: [],
      at: STARTED_AT + 1,
    });
    return turnId;
  });

/** The conversation's newest turn as the agents' reads see it: its status and failure word. */
const newestTurnOf = (target: ConversationTarget) =>
  Effect.map(latestTurnsOfReached([target.conversationId]), (turns) => {
    const turn = turns.get(target.conversationId);
    return [turn?.status, turn?.failure];
  });

it.layer(getTestDB())("a turn whose end is not coming", (it) => {
  it.effect(
    "a native agent whose runner went away has its open turns settled failed once and the projection's held turn dropped, and a settled turn, another projection turn, and a conversation no coding agent's are left",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const writer = yield* storeWriter({ tools: {} });
        const lose = (target: ConversationTarget) =>
          settleRunnerLostTurns(writer, target.conversationId, STARTED_AT + 10);
        const projectionOf = (target: ConversationTarget) =>
          Effect.map(
            db
              .select({ projection: conversations.nativeProjection })
              .from(conversations)
              .where(eq(conversations.id, target.conversationId)),
            ([row]) => row?.projection,
          );
        const holding = (target: ConversationTarget, turnId: string) =>
          db
            .update(conversations)
            .set({ nativeProjection: { session: "cli", turn: { id: turnId } } })
            .where(eq(conversations.id, target.conversationId));

        const agent = yield* openAgentConversation;
        const running = yield* turnIn(writer, agent, TURN_STATUS.RUNNING);
        yield* holding(agent, running);
        assert.deepEqual(yield* lose(agent), [running]);
        assert.deepEqual(yield* newestTurnOf(agent), [TURN_STATUS.FAILED, TURN_FAILURE.MODEL]);
        assert.deepEqual(yield* projectionOf(agent), { session: "cli" });
        assert.deepEqual(yield* lose(agent), [], "a second settle writes nothing");

        // A projection holding a turn other than the one settled keeps it.
        const other = yield* openAgentConversation;
        yield* turnIn(writer, other, TURN_STATUS.QUEUED);
        yield* holding(other, "a-newer-launch-turn");
        assert.equal((yield* lose(other)).length, 1);
        assert.deepEqual(yield* projectionOf(other), {
          session: "cli",
          turn: { id: "a-newer-launch-turn" },
        });

        const idle = yield* openAgentConversation;
        yield* turnIn(writer, idle, TURN_STATUS.SETTLED);
        assert.deepEqual(yield* lose(idle), []);
        assert.deepEqual(yield* newestTurnOf(idle), [TURN_STATUS.SETTLED, null]);

        // A turn a Stop was asked of ends canceled, as the Stop asked, and is no failure the settle answers.
        const stopped = yield* openAgentConversation;
        const stoppedTurn = yield* turnIn(writer, stopped, TURN_STATUS.RUNNING);
        yield* writer.requestTurnCancel(stopped, {
          turnId: stoppedTurn,
          at: new Date(STARTED_AT + 5),
        });
        assert.deepEqual(yield* lose(stopped), []);
        assert.deepEqual(yield* newestTurnOf(stopped), [TURN_STATUS.CANCELED, null]);

        const brain = yield* openConversation(CONVERSATION_KIND.MAIN);
        yield* turnIn(writer, brain, TURN_STATUS.RUNNING);
        assert.deepEqual(yield* lose(brain), []);
        assert.deepEqual(yield* newestTurnOf(brain), [TURN_STATUS.RUNNING, null]);
      }),
  );

  it.effect(
    "a running or queued turn is settled failed for its session's end once, and a turn that already ended keeps its own end",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const settle = (target: ConversationTarget, id: string) =>
          settleEndedSessionTurn(writer, { id, ...target }, STARTED_AT + 10);
        const ended = [TURN_STATUS.FAILED, TURN_FAILURE.SESSION_ENDED];

        const running = yield* openAgentConversation;
        const runningTurn = yield* turnIn(writer, running, TURN_STATUS.RUNNING);
        assert.equal(yield* settle(running, runningTurn), true);
        assert.deepEqual(yield* newestTurnOf(running), ended);
        assert.equal(yield* settle(running, runningTurn), false, "a second settle writes nothing");
        assert.deepEqual(yield* newestTurnOf(running), ended);

        const queued = yield* openAgentConversation;
        assert.equal(
          yield* settle(queued, yield* turnIn(writer, queued, TURN_STATUS.QUEUED)),
          true,
        );
        assert.deepEqual(yield* newestTurnOf(queued), ended);

        const settled = yield* openAgentConversation;
        const settledTurn = yield* turnIn(writer, settled, TURN_STATUS.SETTLED);
        assert.equal(yield* settle(settled, settledTurn), false);
        assert.deepEqual(yield* newestTurnOf(settled), [TURN_STATUS.SETTLED, null]);
      }),
  );

  it.effect(
    "the end of a session settles the queued and running turns of the coding agent's conversation recording it once, and leaves an unknown session, a settled turn, a conversation that recorded a newer session, and one no coding agent's alone",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const writer = yield* storeWriter({ tools: {} });
        const ended = [TURN_STATUS.FAILED, TURN_FAILURE.SESSION_ENDED];
        const endOf = (session: string) =>
          settleEndedSession(writer, session, { now: STARTED_AT + 10 });

        const session = `wrun_${randomUUID()}`;
        const agent = yield* openConversation(CONVERSATION_KIND.AGENT, session);
        yield* turnIn(writer, agent, TURN_STATUS.RUNNING);
        yield* turnIn(writer, agent, TURN_STATUS.QUEUED);
        assert.equal(yield* endOf(`wrun_${randomUUID()}`), 0, "an unknown session settles nothing");
        assert.equal(yield* endOf(session), 2);
        assert.deepEqual(yield* newestTurnOf(agent), ended);
        assert.equal(yield* endOf(session), 0, "a repeated end settles nothing again");
        assert.deepEqual(yield* newestTurnOf(agent), ended);

        const idleSession = `wrun_${randomUUID()}`;
        const idle = yield* openConversation(CONVERSATION_KIND.AGENT, idleSession);
        yield* turnIn(writer, idle, TURN_STATUS.SETTLED);
        assert.equal(yield* endOf(idleSession), 0);
        assert.deepEqual(yield* newestTurnOf(idle), [TURN_STATUS.SETTLED, null]);

        const rotatedFrom = `wrun_${randomUUID()}`;
        const rotated = yield* openConversation(CONVERSATION_KIND.AGENT, rotatedFrom);
        yield* db
          .update(conversations)
          .set({ runtimeSessionId: `wrun_${randomUUID()}` })
          .where(eq(conversations.id, rotated.conversationId));
        yield* turnIn(writer, rotated, TURN_STATUS.RUNNING);
        assert.equal(
          yield* endOf(rotatedFrom),
          0,
          "the newer session's turn is not the ended one's",
        );
        assert.deepEqual(yield* newestTurnOf(rotated), [TURN_STATUS.RUNNING, null]);

        const brainSession = `wrun_${randomUUID()}`;
        const brain = yield* openConversation(CONVERSATION_KIND.MAIN, brainSession);
        yield* turnIn(writer, brain, TURN_STATUS.RUNNING);
        assert.equal(yield* endOf(brainSession), 0);
        assert.deepEqual(yield* newestTurnOf(brain), [TURN_STATUS.RUNNING, null]);
      }),
  );

  it.effect(
    "the end of a session settles a turn a Stop was asked of as canceled, and reads on past one batch until every open turn is settled",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });

        const stoppedSession = `wrun_${randomUUID()}`;
        const stopped = yield* openConversation(CONVERSATION_KIND.AGENT, stoppedSession);
        const turnId = yield* turnIn(writer, stopped, TURN_STATUS.RUNNING);
        yield* writer.requestTurnCancel(stopped, { turnId, at: new Date(STARTED_AT + 5) });
        assert.equal(
          yield* settleEndedSession(writer, stoppedSession, { now: STARTED_AT + 10 }),
          1,
        );
        assert.deepEqual(yield* newestTurnOf(stopped), [TURN_STATUS.CANCELED, null]);

        const busySession = `wrun_${randomUUID()}`;
        const busy = yield* openConversation(CONVERSATION_KIND.AGENT, busySession);
        yield* turnIn(writer, busy, TURN_STATUS.RUNNING);
        yield* turnIn(writer, busy, TURN_STATUS.QUEUED);
        yield* turnIn(writer, busy, TURN_STATUS.QUEUED);
        assert.equal(
          yield* settleEndedSession(writer, busySession, { now: STARTED_AT + 10, limit: 2 }),
          3,
        );
        assert.deepEqual(yield* newestTurnOf(busy), [
          TURN_STATUS.FAILED,
          TURN_FAILURE.SESSION_ENDED,
        ]);
      }),
  );

  it.effect(
    "a turn's lease runs from its queueing, a runner's post pushes it on, a turn queued behind the running one's with it, and only a turn still open past it reads as lapsed, as does one with no lease queued a lease ago and one whose Stop went unconfirmed",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const target = yield* openAgentConversation;
        // Note that the turns are queued at the test clock's start, the epoch.
        const ahead = yield* turnIn(writer, target, TURN_STATUS.RUNNING);
        // Queued behind the turn under way, which its runner's posts renew with it.
        const renewed = yield* turnIn(writer, target, TURN_STATUS.QUEUED);
        // Note that the running turn's lease is taken from the clock's start too, as the queued one's is,
        // rather than from the fixture's own start instant.
        yield* (yield* Database)
          .update(turns)
          .set({ leaseUntil: new Date(TURN_LEASE.MS) })
          .where(eq(turns.id, ahead));
        const other = yield* openAgentConversation;
        const lapsed = yield* turnIn(writer, other, TURN_STATUS.QUEUED);
        yield* turnIn(writer, other, TURN_STATUS.SETTLED);
        // A turn an older writer queued with no lease, as one may while a deploy rolls out.
        const unleased = yield* openAgentConversation;
        const leaseless = yield* turnIn(writer, unleased, TURN_STATUS.RUNNING);
        yield* (yield* Database)
          .update(turns)
          .set({ leaseUntil: null })
          .where(eq(turns.id, leaseless));

        // A turn whose runner beats on but never ended it on its Stop, its lease far ahead.
        const stopping = yield* openAgentConversation;
        const unconfirmed = yield* turnIn(writer, stopping, TURN_STATUS.RUNNING);
        yield* writer.requestTurnCancel(stopping, { turnId: unconfirmed, at: new Date(0) });
        const fresh = yield* renewTurnLease(target.conversationId, 60_000);
        const pushed = yield* renewTurnLease(target.conversationId, 10 * 60_000);
        const past = TURN_LEASE.MS + 1;

        assert.equal(fresh, 0, "a lease with most of its run left is not written");
        assert.equal(pushed, 2, "a turn queued behind the running one is renewed with it");
        assert.deepEqual(yield* lapsedTurnIds(target.conversationId, TURN_LEASE.MS), []);
        assert.deepEqual(yield* lapsedTurnIds(target.conversationId, past), []);
        assert.deepEqual(yield* lapsedTurnIds(other.conversationId, TURN_LEASE.MS), []);
        assert.deepEqual(yield* lapsedTurnIds(other.conversationId, past), [lapsed]);
        assert.deepEqual(
          [...(yield* lapsedTurnIds(target.conversationId, 10 * 60_000 + past))].sort(),
          [ahead, renewed].sort(),
          "the queued turn lapses only with the turn ahead of it",
        );
        assert.deepEqual(yield* lapsedTurnIds(unleased.conversationId, TURN_LEASE.MS), []);
        assert.deepEqual(yield* lapsedTurnIds(unleased.conversationId, past), [leaseless]);
        assert.deepEqual(
          yield* lapsedTurnIds(stopping.conversationId, LOST_TURNS.STOP_CONFIRM_MS),
          [],
        );
        assert.deepEqual(
          yield* lapsedTurnIds(stopping.conversationId, LOST_TURNS.STOP_CONFIRM_MS + 1),
          [unconfirmed],
          "a Stop unconfirmed past its bound lapses whatever the lease",
        );
      }),
  );

  it.effect(
    "a lost-runner settle given the turns read earlier settles just those, and leaves a turn begun since",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const agent = yield* openAgentConversation;
        yield* turnIn(writer, agent, TURN_STATUS.RUNNING);
        const readBefore = yield* runningTurnIds(agent.conversationId);
        const begunSince = yield* turnIn(writer, agent, TURN_STATUS.QUEUED);

        const settled = yield* settleRunnerLostTurns(
          writer,
          agent.conversationId,
          STARTED_AT + 10,
          undefined,
          new Set(readBefore),
        );

        assert.deepEqual(settled, readBefore);
        assert.deepEqual(yield* runningTurnIds(agent.conversationId), [begunSince]);
      }),
  );
});
