import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
} from "@luke/features/brain";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  settleEndedSession,
  settleEndedSessionTurn,
  sweepAbandonedTurns,
  TURN_ABANDON,
} from "../abandoned-turns.js";
import { latestTurnsOfReached } from "../coding-agent-store.js";
import { type ConversationTarget, type StoreWriter, storeWriter } from "../writer.js";

/**
 * How a coding agent's turn whose end is never coming is settled, over a
 * real dialect: by the sweep once it ran past its bound, by the sweep as
 * cancelled once a Stop eve never confirmed is past its own, and at once when
 * eve said its session ended for good.
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
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const conversationId = randomUUID();
    yield* db
      .insert(conversations)
      .values({ id: conversationId, userId, kind, runtimeSessionId: runtimeSessionId ?? null });
    return { userId, conversationId } satisfies ConversationTarget;
  });

/** A coding agent's conversation of a new account. */
const openAgentConversation = openConversation(CONVERSATION_KIND.CODING_AGENT);

/** A turn of the conversation's: queued, begun by eve, or begun and ended as it succeeded; answers its id. */
const turnIn = (
  writer: StoreWriter,
  target: ConversationTarget,
  stands: typeof TURN_STATUS.QUEUED | typeof TURN_STATUS.RUNNING | typeof TURN_STATUS.SETTLED,
) =>
  Effect.gen(function* () {
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(target.conversationId), turnId };
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    if (stands === TURN_STATUS.QUEUED) return turnId;
    yield* writer.consume(target, {
      ...turn,
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      sequence: 1,
      origin: BRAIN_TURN_ORIGIN.TYPED,
      trigger: BRAIN_TURN_TRIGGER.ASK,
      at: STARTED_AT,
    });
    if (stands === TURN_STATUS.RUNNING) return turnId;
    yield* writer.consume(target, {
      ...turn,
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      sequence: 2,
      status: BRAIN_REQUEST_STATUS.SUCCEEDED,
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
    "a running or queued turn is settled failed for its session's end once, and a turn that already ended keeps its own end",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const settle = (target: ConversationTarget, id: string) =>
          settleEndedSessionTurn(writer, { id, ...target }, STARTED_AT + 10);
        const ended = [TURN_STATUS.FAILED, BRAIN_REQUEST_FAILURE.SESSION_ENDED];

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
        const ended = [TURN_STATUS.FAILED, BRAIN_REQUEST_FAILURE.SESSION_ENDED];
        const endOf = (session: string) =>
          settleEndedSession(writer, session, { now: STARTED_AT + 10 });

        const session = `wrun_${randomUUID()}`;
        const agent = yield* openConversation(CONVERSATION_KIND.CODING_AGENT, session);
        yield* turnIn(writer, agent, TURN_STATUS.RUNNING);
        yield* turnIn(writer, agent, TURN_STATUS.QUEUED);
        assert.equal(yield* endOf(`wrun_${randomUUID()}`), 0, "an unknown session settles nothing");
        assert.equal(yield* endOf(session), 2);
        assert.deepEqual(yield* newestTurnOf(agent), ended);
        assert.equal(yield* endOf(session), 0, "a repeated end settles nothing again");
        assert.deepEqual(yield* newestTurnOf(agent), ended);

        const idleSession = `wrun_${randomUUID()}`;
        const idle = yield* openConversation(CONVERSATION_KIND.CODING_AGENT, idleSession);
        yield* turnIn(writer, idle, TURN_STATUS.SETTLED);
        assert.equal(yield* endOf(idleSession), 0);
        assert.deepEqual(yield* newestTurnOf(idle), [TURN_STATUS.SETTLED, null]);

        const rotatedFrom = `wrun_${randomUUID()}`;
        const rotated = yield* openConversation(CONVERSATION_KIND.CODING_AGENT, rotatedFrom);
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
    "the end of a session settles a turn a Stop was asked of as cancelled, and reads on past one batch until every open turn is settled",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });

        const stoppedSession = `wrun_${randomUUID()}`;
        const stopped = yield* openConversation(CONVERSATION_KIND.CODING_AGENT, stoppedSession);
        const turnId = yield* turnIn(writer, stopped, TURN_STATUS.RUNNING);
        yield* writer.requestTurnCancel(stopped, { turnId, at: new Date(STARTED_AT + 5) });
        assert.equal(
          yield* settleEndedSession(writer, stoppedSession, { now: STARTED_AT + 10 }),
          1,
        );
        assert.deepEqual(yield* newestTurnOf(stopped), [TURN_STATUS.CANCELLED, null]);

        const busySession = `wrun_${randomUUID()}`;
        const busy = yield* openConversation(CONVERSATION_KIND.CODING_AGENT, busySession);
        yield* turnIn(writer, busy, TURN_STATUS.RUNNING);
        yield* turnIn(writer, busy, TURN_STATUS.QUEUED);
        yield* turnIn(writer, busy, TURN_STATUS.QUEUED);
        assert.equal(
          yield* settleEndedSession(writer, busySession, { now: STARTED_AT + 10, limit: 2 }),
          3,
        );
        assert.deepEqual(yield* newestTurnOf(busy), [
          TURN_STATUS.FAILED,
          BRAIN_REQUEST_FAILURE.SESSION_ENDED,
        ]);
      }),
  );

  it.effect(
    "the sweep settles a coding agent's turn as abandoned only once it ran past its day's bound",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const target = yield* openAgentConversation;
        yield* turnIn(writer, target, TURN_STATUS.RUNNING);

        yield* sweepAbandonedTurns({ writer }, { now: STARTED_AT + TURN_ABANDON.AFTER_MS + 1 });
        assert.deepEqual(yield* newestTurnOf(target), [TURN_STATUS.RUNNING, null]);
        yield* sweepAbandonedTurns(
          { writer },
          { now: STARTED_AT + TURN_ABANDON.CODING_AGENT_AFTER_MS + 1 },
        );
        assert.deepEqual(yield* newestTurnOf(target), [
          TURN_STATUS.FAILED,
          BRAIN_REQUEST_FAILURE.ABANDONED,
        ]);
      }),
  );

  it.effect(
    "the sweep settles a turn whose Stop eve never confirmed as cancelled once past the Stop's bound, and not before",
    () =>
      Effect.gen(function* () {
        const writer = yield* storeWriter({ tools: {} });
        const target = yield* openAgentConversation;
        const turnId = yield* turnIn(writer, target, TURN_STATUS.RUNNING);
        const stoppedAt = STARTED_AT + 60_000;
        yield* writer.requestTurnCancel(target, { turnId, at: new Date(stoppedAt) });

        yield* sweepAbandonedTurns({ writer }, { now: stoppedAt + TURN_ABANDON.CANCEL_AFTER_MS });
        assert.deepEqual(
          yield* newestTurnOf(target),
          [TURN_STATUS.RUNNING, null],
          "eve may still confirm it",
        );
        yield* sweepAbandonedTurns(
          { writer },
          { now: stoppedAt + TURN_ABANDON.CANCEL_AFTER_MS + 1 },
        );
        assert.deepEqual(yield* newestTurnOf(target), [TURN_STATUS.CANCELLED, null]);
      }),
  );
});
