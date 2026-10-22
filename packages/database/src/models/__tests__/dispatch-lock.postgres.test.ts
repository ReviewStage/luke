import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { ASK_ORIGIN } from "@luke/features";
import { BRAIN_RUN_EVENT, BRAIN_TURN_ORIGIN, BRAIN_TURN_TRIGGER } from "@luke/features/brain";
import { PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { sessionKey } from "@luke/runtime/vocabulary";
import { TURN_ORIGIN } from "@luke/wire";
import { sentLineId } from "@luke/wire/host-ids";
import { eq } from "drizzle-orm";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Result } from "effect";
import { SqlClient } from "effect/sql";
import { Database, type DatabaseServices } from "../../core/query.js";
import { sqlClientOverUrl } from "../../core/sql-client.js";
import { user } from "../../schemas/auth.js";
import { codingAgent } from "../../schemas/coding-agent.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, openWorkspace, STORE_TEST_DATABASE_ENVIRONMENT } from "../../testing/index.js";
import { askRecord } from "../asks.js";
import { deleteCodingAgent, recordCodingAgentPublished } from "../coding-agent-store.js";
import { readMessageByClientId } from "../message-reads.js";
import { createTask, finishTaskWork } from "../task-store.js";
import { type ConversationTarget, STORE_WRITE_EFFECT, storeWriter } from "../writer.js";

/**
 * The conversation's dispatch lock against a real Postgres, with a second
 * connection beside the test's own: the one thing PGlite, a single connection
 * that runs one transaction at a time, cannot show. A hand-over to eve held
 * open on a `Deferred` leaves the run stream's journal writing, keeps a second
 * send behind it, and keeps the take of its line into a turn waiting until
 * the line's row stands. This file runs in CI's Postgres job, where
 * `LUKE_STORE_TEST_DATABASE_URL` names the database (`vitest.config.ts`).
 */

const SENDER = { kind: MESSAGE_SENDER.LUKE } as const;

/**
 * Answers how to run an effect on a connection of its own to the test's
 * database, beside the test's one: the store's test client holds a single
 * connection. Note that the layer is built fresh, because the test's own
 * client was built from the same `Database` layer, and a memoized one would
 * run the statements on the test's connection.
 */
const anotherConnection = Effect.gen(function* () {
  const client = yield* SqlClient.SqlClient;
  const [row] = yield* client<{ readonly name: string }>`select current_database() as name`;
  const url = new URL(process.env[STORE_TEST_DATABASE_ENVIRONMENT.URL] ?? "");
  url.pathname = `/${row?.name ?? ""}`;
  const layer = Layer.fresh(sqlClientOverUrl(url.toString()));
  return <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Effect.provide(effect, layer);
});

const openAgentConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const conversationId = randomUUID();
  yield* db
    .insert(conversations)
    .values({ id: conversationId, userId, kind: CONVERSATION_KIND.CODING_AGENT });
  return { userId, conversationId } satisfies ConversationTarget;
});

/** A turn queued and started in the conversation, answering its id and the run-stream address its events carry. */
const startedTurn = (target: ConversationTarget) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: {} });
    const turnId = randomUUID();
    const turn = { conversationId: sessionKey(target.conversationId), turnId };
    yield* writer.enqueueTurn(target, { turnId, origin: TURN_ORIGIN.TYPED, eveTurnId: "turn_0" });
    yield* writer.consumeAll(target, [
      {
        ...turn,
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        sequence: 1,
        origin: BRAIN_TURN_ORIGIN.TYPED,
        trigger: BRAIN_TURN_TRIGGER.ASK,
        at: 0,
      },
    ]);
    return { turnId, turn };
  });

/** A hand-over to eve that says it began, then answers only once released. */
const heldDispatch = <A>(answer: A) =>
  Effect.gen(function* () {
    const began = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const dispatch = Effect.andThen(
      Deferred.succeed(began, undefined),
      Effect.as(Deferred.await(release), answer),
    );
    return { began, release, dispatch };
  });

/** Waits for the held hand-over to begin, failing where the write that would run it ended first. */
const untilBegan = (began: Deferred.Deferred<void>, fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.race(
    Deferred.await(began),
    Effect.andThen(Fiber.await(fiber), (exit) =>
      Effect.die(new Error(`the write ended before its hand-over began: ${String(exit)}`)),
    ),
  );

/**
 * Waits until the fiber is waiting on a lock or has already ended, read off
 * Postgres's own lock table, so the test moves on as soon as the write it
 * forked is either parked behind the hand-over or, where nothing parks it,
 * done; and so a write that should not wait fails rather than hangs.
 */
const parkedOrDone = (fiber: Fiber.Fiber<unknown, unknown>) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    for (;;) {
      if (fiber.pollUnsafe() !== undefined) return;
      const rows = yield* client<{
        readonly waiting: number;
      }>`select count(*)::int as waiting from pg_locks where not granted`;
      if ((rows[0]?.waiting ?? 0) > 0) return;
      yield* Effect.yieldNow;
    }
  });

it.layer(getTestDB())("the conversation's dispatch lock", (it) => {
  it.effect(
    "the journal of a turn under way lands while a line's hand-over to eve is pending",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const onAnother = yield* anotherConnection;
        const writer = yield* storeWriter({ tools: {} });
        const { turn } = yield* startedTurn(target);
        const held = yield* heldDispatch(true);

        const sending = yield* Effect.forkChild(
          onAnother(
            writer.writeAwaitingLine(
              target,
              { text: "Fix the tile.", clientKey: "fix", sender: SENDER },
              held.dispatch,
            ),
          ),
        );
        yield* untilBegan(held.began, sending);
        const journaling = yield* Effect.forkChild(
          onAnother(
            writer.consumeAll(target, [
              { ...turn, kind: BRAIN_RUN_EVENT.STEP_STARTED, sequence: 2, step: 1 },
            ]),
          ),
        );
        yield* parkedOrDone(journaling);
        const journalWaited = journaling.pollUnsafe() === undefined;
        const sendStillPending = sending.pollUnsafe() === undefined;
        yield* Deferred.succeed(held.release, undefined);
        const sent = yield* Fiber.join(sending);
        const journal = yield* Fiber.join(journaling);

        assert.equal(journalWaited, false);
        assert.ok(journal.every(Result.isSuccess));
        assert.ok(sendStillPending);
        assert.ok(Result.isSuccess(sent) && Option.isSome(sent.success));
        assert.equal(sent.success.value.effect, STORE_WRITE_EFFECT.WRITTEN);
      }),
  );

  it.effect("the journal lands while an ask's hand-over to eve is pending", () =>
    Effect.gen(function* () {
      const target = yield* openAgentConversation;
      const onAnother = yield* anotherConnection;
      const writer = yield* storeWriter({ tools: {} });
      const asks = askRecord();
      const { turn } = yield* startedTurn(target);
      const ask = yield* asks.record({
        ...target,
        clientId: randomUUID(),
        origin: ASK_ORIGIN.TYPED,
        createdAt: new Date(0),
      });
      const held = yield* heldDispatch({ sessionId: "session-1", deliveryId: "delivery-1" });

      const dispatching = yield* Effect.forkChild(
        onAnother(asks.dispatchOnce(target, ask.id, () => held.dispatch)),
      );
      yield* untilBegan(held.began, dispatching);
      const journaling = yield* Effect.forkChild(
        onAnother(
          writer.consumeAll(target, [
            { ...turn, kind: BRAIN_RUN_EVENT.STEP_STARTED, sequence: 2, step: 1 },
          ]),
        ),
      );
      yield* parkedOrDone(journaling);
      const journalWaited = journaling.pollUnsafe() === undefined;
      const askStillPending = dispatching.pollUnsafe() === undefined;
      yield* Deferred.succeed(held.release, undefined);
      const dispatched = yield* Fiber.join(dispatching);
      const journal = yield* Fiber.join(journaling);

      assert.equal(journalWaited, false);
      assert.ok(journal.every(Result.isSuccess));
      assert.ok(askStillPending);
      assert.equal(typeof dispatched === "string" ? undefined : dispatched.sessionId, "session-1");
    }),
  );

  it.effect(
    "the take of a line into the turn eve opened on it waits out the hand-over, so it takes the row rather than finding none",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const onAnother = yield* anotherConnection;
        const writer = yield* storeWriter({ tools: {} });
        const { turnId } = yield* startedTurn(target);
        const held = yield* heldDispatch(true);

        const sending = yield* Effect.forkChild(
          onAnother(
            writer.writeAwaitingLine(
              target,
              { text: "Fix the tile.", clientKey: "fix", sender: SENDER },
              held.dispatch,
            ),
          ),
        );
        yield* untilBegan(held.began, sending);
        const taking = yield* Effect.forkChild(
          onAnother(writer.takeAwaitingLine(target, { text: "Fix the tile.", turnId })),
        );
        yield* parkedOrDone(taking);
        yield* Deferred.succeed(held.release, undefined);
        yield* Fiber.join(sending);
        const taken = yield* Fiber.join(taking);
        const row = yield* readMessageByClientId(
          target.userId,
          target.conversationId,
          {},
          sentLineId("fix"),
        );

        assert.deepEqual(
          Result.map(taken, (ids) => ids.length),
          Result.succeed(1),
        );
        assert.ok(row.ok);
        assert.equal(row.value.length, 1);
      }),
  );

  it.effect("two sends to one conversation reach eve in the order their rows are numbered", () =>
    Effect.gen(function* () {
      const target = yield* openAgentConversation;
      const onAnother = yield* anotherConnection;
      const writer = yield* storeWriter({ tools: {} });
      const heard = yield* Ref.make<readonly string[]>([]);
      const first = yield* heldDispatch(true);
      const send = (clientKey: string, dispatch: Effect.Effect<boolean>) =>
        onAnother(
          writer.writeAwaitingLine(
            target,
            { text: clientKey, clientKey, sender: SENDER },
            Effect.tap(dispatch, () => Ref.update(heard, (keys) => [...keys, clientKey])),
          ),
        );

      const sendingFirst = yield* Effect.forkChild(send("first", first.dispatch));
      yield* untilBegan(first.began, sendingFirst);
      const sendingSecond = yield* Effect.forkChild(send("second", Effect.succeed(true)));
      yield* parkedOrDone(sendingSecond);
      yield* Deferred.succeed(first.release, undefined);
      yield* Fiber.join(sendingFirst);
      yield* Fiber.join(sendingSecond);
      const seqs = yield* Effect.forEach(["first", "second"], (key) =>
        Effect.map(
          readMessageByClientId(target.userId, target.conversationId, {}, sentLineId(key)),
          (read) => (read.ok ? read.value[0]?.seq : undefined),
        ),
      );

      assert.deepEqual(yield* Ref.get(heard), ["first", "second"]);
      assert.ok(seqs[0] !== undefined && seqs[1] !== undefined && seqs[0] < seqs[1]);
    }),
  );

  it.effect(
    "a task's finish waits out a hand-over to one of its agents, so the line eve took holds the task open",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const onAnother = yield* anotherConnection;
        const writer = yield* storeWriter({ tools: {} });
        const db = yield* Database;
        const workspace = yield* openWorkspace(target.userId);
        const { id: taskId } = yield* createTask(target.userId, {
          name: "Teammate invitations",
          organizationId: workspace,
        });
        const agentId = randomUUID();
        yield* db.insert(codingAgent).values({
          id: agentId,
          organizationId: workspace,
          userId: target.userId,
          taskId,
          conversationId: target.conversationId,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
          repositories: ["acme/api"],
          idempotencyKey: randomUUID(),
        });
        yield* recordCodingAgentPublished(target.userId, agentId, {
          number: 42,
          title: "Teammate invitations",
          url: "https://github.com/acme/api/pull/42",
          state: PULL_REQUEST_STATE.MERGED,
          checks: "passing",
          additions: 10,
          deletions: 2,
          changedFiles: 1,
        });
        // Idle where no line of the conversation awaits a turn, as `standsStopped` reads it.
        const idleUnlessAwaiting = () =>
          Effect.map(
            readMessageByClientId(target.userId, target.conversationId, {}, sentLineId("tests")),
            (read) => read.ok && read.value.length === 0,
          );
        const held = yield* heldDispatch(true);

        const sending = yield* Effect.forkChild(
          onAnother(
            writer.writeAwaitingLine(
              target,
              { text: "Check the tests.", clientKey: "tests", sender: SENDER },
              held.dispatch,
            ),
          ),
        );
        yield* untilBegan(held.began, sending);
        const finishing = yield* Effect.forkChild(
          onAnother(finishTaskWork(target.userId, taskId, idleUnlessAwaiting)),
        );
        yield* parkedOrDone(finishing);
        yield* Deferred.succeed(held.release, undefined);
        yield* Fiber.join(sending);

        assert.equal(yield* Fiber.join(finishing), false);
      }),
  );

  it.effect(
    "an agent's delete waits out a hand-over to it, so the line eve took refuses the delete",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const onAnother = yield* anotherConnection;
        const writer = yield* storeWriter({ tools: {} });
        const db = yield* Database;
        const workspace = yield* openWorkspace(target.userId);
        const agentId = randomUUID();
        yield* db.insert(codingAgent).values({
          id: agentId,
          organizationId: workspace,
          userId: target.userId,
          taskId: null,
          conversationId: target.conversationId,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: "acme/api",
          repositories: ["acme/api"],
          idempotencyKey: randomUUID(),
        });
        // Stopped where no line of the conversation awaits a turn, as `standsStopped` reads it.
        const stoppedUnlessAwaiting = () =>
          Effect.map(
            readMessageByClientId(target.userId, target.conversationId, {}, sentLineId("tests")),
            (read) => read.ok && read.value.length === 0,
          );
        const held = yield* heldDispatch(true);

        const sending = yield* Effect.forkChild(
          onAnother(
            writer.writeAwaitingLine(
              target,
              { text: "Check the tests.", clientKey: "tests", sender: SENDER },
              held.dispatch,
            ),
          ),
        );
        yield* untilBegan(held.began, sending);
        const deleting = yield* Effect.forkChild(
          onAnother(
            deleteCodingAgent(target.userId, agentId, {
              standsStopped: stoppedUnlessAwaiting,
              beforeDelete: () => Effect.void,
            }),
          ),
        );
        yield* parkedOrDone(deleting);
        yield* Deferred.succeed(held.release, undefined);
        yield* Fiber.join(sending);
        const deleted = yield* Fiber.await(deleting);

        assert.ok(Exit.isFailure(deleted));
        assert.equal(
          (yield* db
            .select({ id: codingAgent.id })
            .from(codingAgent)
            .where(eq(codingAgent.id, agentId))).length,
          1,
        );
      }),
  );
});
