import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { ASK_ORIGIN } from "@luke/features";
import { sentLineId } from "@luke/wire/host-ids";
import { eq } from "drizzle-orm";
import { Clock, Deferred, Duration, Effect, Fiber, Option, Ref, Result } from "effect";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { Database, type DatabaseServices } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { asks, conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND, MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import { ASK_DISPATCH_REFUSAL, askRecord } from "../asks.js";
import { REWIND_REFUSAL, readRewoundRevision, rewindConversation } from "../conversation-rewind.js";
import { DISPATCH_CLAIM } from "../dispatch-claim.js";
import { readMessageByClientId, sentLineStands } from "../message-reads.js";
import {
  type ConversationTarget,
  STORE_WRITE_EFFECT,
  STORE_WRITE_REFUSAL,
  storeWriter,
} from "../writer.js";

/**
 * The conversation's dispatch claim over a real dialect: a hand-over to the
 * runtime runs with no transaction open, a send meeting another's claim
 * waits for it and is refused as busy past the wait, and a claim whose
 * holder died is taken over past its expiry without what it handed over
 * being handed over again. Time is the test clock's, so a wait or an
 * expiry passes only as the test moves it. Synthetic accounts and
 * conversations throughout.
 */

const SENDER = { kind: MESSAGE_SENDER.LUKE } as const;

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

/** The claim a holder took at the test clock's instant and never cleared, as one that died between its claim and its record leaves it. */
const claimLeftBy = (target: ConversationTarget, claim: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const at = new Date(yield* Clock.currentTimeMillis);
    yield* db
      .update(conversations)
      .set({ dispatchClaim: claim, dispatchClaimedAt: at })
      .where(eq(conversations.id, target.conversationId));
  });

/** A hand-over that counts itself and answers as given. */
const countedDispatch = Effect.gen(function* () {
  const handed = yield* Ref.make(0);
  const dispatch = (taken: boolean) =>
    Effect.as(
      Ref.update(handed, (n) => n + 1),
      taken,
    );
  return { handed, dispatch };
});

/** How many rows stand under the send's key. */
const rowsUnder = (target: ConversationTarget, clientKey: string) =>
  Effect.map(
    readMessageByClientId(target.userId, target.conversationId, {}, sentLineId(clientKey)),
    (read) => (read.ok ? read.value.length : -1),
  );

/**
 * Whether two statements run one after the other are transactions of their
 * own, which they are where no transaction stands open around them: each is
 * then given an id of its own, where inside one they share its id.
 */
const inNoTransaction = Effect.flatMap(SqlClient.SqlClient, (sql) =>
  Effect.gen(function* () {
    const xid = sql<{ readonly xid: string }>`select txid_current()::text as xid`;
    const [first] = yield* xid;
    const [second] = yield* xid;
    return first !== undefined && second !== undefined && first.xid !== second.xid;
  }),
);

/**
 * The fiber's end, with the test clock moved on a step at a time, a round
 * trip to the database apart, until it ends: a wait it sleeps on the clock
 * passes however long its statements take on a real Postgres, without the
 * clock running so far ahead of them that a claim expires meanwhile.
 */
const joinedAsTimePasses = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* sql`select 1`;
    }
    return yield* Fiber.join(fiber);
  });

/** The test clock moved on by the time given, a step at a time, a round trip to the database apart, so what waits on it keeps pace. */
const timePasses = (millis: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (let passed = 0; passed < millis; passed += 50) {
      yield* TestClock.adjust(Duration.millis(50));
      yield* sql`select 1`;
    }
  });

/**
 * The conversation's next clearing of its dispatch claim fails, once, as a
 * passing store failure would: a trigger counts on a sequence, which a
 * rolled-back transaction does not take back.
 */
const releaseFailsOnce = (target: ConversationTarget) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const name = `release_fails_${target.conversationId.replaceAll("-", "_")}`;
    yield* sql.unsafe(`create sequence ${name}`);
    yield* sql.unsafe(
      `create function ${name}() returns trigger language plpgsql as $$ begin if nextval('${name}') = 1 then raise exception 'the release failed'; end if; return new; end $$`,
    );
    yield* sql.unsafe(
      `create trigger ${name} before update on conversations for each row when (old.id = '${target.conversationId}' and old.dispatch_claim is not null and new.dispatch_claim is null) execute function ${name}()`,
    );
  });

/** Every waiter queued for the conversation's claim, as though the database last heard from them the given seconds ago. */
const waitersLastSeen = (target: ConversationTarget, secondsAgo: number) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.asVoid(
      sql`update dispatch_waiters set seen_at = now() - (${secondsAgo} * interval '1 second') where conversation_id = ${target.conversationId}`,
    ),
  );

/** A waiter queued for the conversation's claim, as one the database last heard from the given seconds ago. */
const waiterSeen = (target: ConversationTarget, secondsAgo: number) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    Effect.asVoid(
      sql`insert into dispatch_waiters (conversation_id, seen_at) values (${target.conversationId}, now() - (${secondsAgo} * interval '1 second'))`,
    ),
  );

it.layer(getTestDB())("the conversation's dispatch claim", (it) => {
  it.effect(
    "a send meeting another hand-over's claim waits for it, is refused as busy once the wait runs out with the runtime told nothing and nothing written, and lands once the claim is cleared",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const db = yield* Database;
        const { handed, dispatch } = yield* countedDispatch;
        const line = { text: "Use seven days.", clientKey: "send-1", sender: SENDER };
        yield* claimLeftBy(target, randomUUID());

        const waiting = yield* Effect.forkChild(
          writer.writeAwaitingLine(target, line, dispatch(true)),
        );
        const busy = yield* joinedAsTimePasses(waiting);
        const rowsWhileBusy = yield* rowsUnder(target, "send-1");
        yield* db
          .update(conversations)
          .set({ dispatchClaim: null, dispatchClaimedAt: null })
          .where(eq(conversations.id, target.conversationId));
        const freed = yield* writer.writeAwaitingLine(target, line, dispatch(true));

        assert.deepEqual(busy, Result.fail({ refusal: STORE_WRITE_REFUSAL.BUSY }));
        assert.equal(rowsWhileBusy, 0);
        assert.ok(Result.isSuccess(freed) && Option.isSome(freed.success));
        assert.equal(freed.success.value.effect, STORE_WRITE_EFFECT.WRITTEN);
        assert.equal(yield* Ref.get(handed), 1);
        assert.equal(yield* rowsUnder(target, "send-1"), 1);
      }),
  );

  it.effect(
    "a line's claim whose holder died is taken over past its expiry: its line stands, a retry under its key is answered as repeated without the runtime hearing it again, and the next send is handed over once",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const { handed, dispatch } = yield* countedDispatch;
        const lost = { text: "Fix the tile.", clientKey: "lost", sender: SENDER };
        const next = { text: "Then the header.", clientKey: "next", sender: SENDER };
        // The holder wrote its line and handed it over, then died before clearing its claim.
        yield* writer.writeAwaitingLine(target, lost, Effect.succeed(true));
        yield* claimLeftBy(target, randomUUID());

        const early = yield* Effect.forkChild(
          writer.writeAwaitingLine(target, next, dispatch(true)),
        );
        const busy = yield* joinedAsTimePasses(early);
        yield* TestClock.adjust(DISPATCH_CLAIM.EXPIRY);
        const retried = yield* writer.writeAwaitingLine(target, lost, dispatch(true));
        const sent = yield* writer.writeAwaitingLine(target, next, dispatch(true));

        assert.deepEqual(busy, Result.fail({ refusal: STORE_WRITE_REFUSAL.BUSY }));
        assert.ok(Result.isSuccess(retried) && Option.isSome(retried.success));
        assert.equal(retried.success.value.effect, STORE_WRITE_EFFECT.REPEATED);
        assert.ok(Result.isSuccess(sent) && Option.isSome(sent.success));
        assert.equal(sent.success.value.effect, STORE_WRITE_EFFECT.WRITTEN);
        assert.equal(yield* Ref.get(handed), 1);
        assert.deepEqual(
          [yield* rowsUnder(target, "lost"), yield* rowsUnder(target, "next")],
          [1, 1],
        );
      }),
  );

  it.effect(
    "an ask whose hand-over's holder died is not handed over again once its claim expired, and the conversation's next ask is",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const record = askRecord();
        const db = yield* Database;
        const handed = yield* Ref.make(0);
        const dispatch = () =>
          Effect.as(
            Ref.update(handed, (n) => n + 1),
            { sessionId: "session-1", deliveryId: "dl_1" },
          );
        const ask = (clientId: string) =>
          record.record({ ...target, clientId, origin: ASK_ORIGIN.TYPED, createdAt: new Date(0) });
        const lost = yield* ask("lost");
        const claim = randomUUID();
        yield* claimLeftBy(target, claim);
        yield* db.update(asks).set({ dispatchClaim: claim }).where(eq(asks.id, lost.id));

        yield* TestClock.adjust(Duration.sum(DISPATCH_CLAIM.EXPIRY, Duration.seconds(1)));
        const retried = yield* record.dispatchOnce(target, lost.id, dispatch);
        const next = yield* ask("next");
        const dispatched = yield* record.dispatchOnce(target, next.id, dispatch);

        assert.ok(typeof retried !== "string");
        assert.equal(retried.sessionId, undefined);
        assert.ok(typeof dispatched !== "string");
        assert.equal(dispatched.sessionId, "session-1");
        assert.equal(yield* Ref.get(handed), 1);
      }),
  );

  it.effect(
    "an ask meeting another hand-over's claim waits no longer than a send does, leaving its own deadline to the hand-over, and is answered busy, the runtime told nothing",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const record = askRecord();
        const handed = yield* Ref.make(0);
        const ask = yield* record.record({
          ...target,
          clientId: "busy",
          origin: ASK_ORIGIN.TYPED,
          createdAt: new Date(0),
        });
        yield* claimLeftBy(target, randomUUID());
        const askedAt = yield* Clock.currentTimeMillis;

        const waiting = yield* Effect.forkChild(
          record.dispatchOnce(target, ask.id, () =>
            Effect.as(
              Ref.update(handed, (n) => n + 1),
              { sessionId: "session-1" },
            ),
          ),
        );
        const answered = yield* joinedAsTimePasses(waiting);
        const waitedMs = (yield* Clock.currentTimeMillis) - askedAt;

        assert.equal(answered, ASK_DISPATCH_REFUSAL.BUSY);
        assert.ok(
          waitedMs < Duration.toMillis(Duration.sum(DISPATCH_CLAIM.WAIT, Duration.seconds(2))),
          `the ask waited ${waitedMs} ms`,
        );
        assert.equal(yield* Ref.get(handed), 0);
      }),
  );

  it.effect(
    "sends waiting on a hand-over reach the runtime in the order they arrived, whichever of them asks again first once it ends",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const heard = yield* Ref.make<readonly string[]>([]);
        const began = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const send = (clientKey: string, dispatch: Effect.Effect<boolean>) =>
          writer.writeAwaitingLine(
            target,
            { text: clientKey, clientKey, sender: SENDER },
            Effect.tap(dispatch, () => Ref.update(heard, (keys) => [...keys, clientKey])),
          );

        const first = yield* Effect.forkChild(
          send(
            "first",
            Effect.andThen(
              Deferred.succeed(began, undefined),
              Effect.as(Deferred.await(release), true),
            ),
          ),
        );
        yield* Deferred.await(began);
        const second = yield* Effect.forkChild(send("second", Effect.succeed(true)));
        yield* timePasses(300);
        const third = yield* Effect.forkChild(send("third", Effect.succeed(true)));
        // The first hand-over ends just before the third's next try and well before the second's.
        yield* timePasses(700);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        yield* joinedAsTimePasses(second);
        yield* joinedAsTimePasses(third);
        const seqs = yield* Effect.forEach(["first", "second", "third"], (key) =>
          Effect.map(
            readMessageByClientId(target.userId, target.conversationId, {}, sentLineId(key)),
            (read) => (read.ok ? (read.value[0]?.seq ?? -1) : -1),
          ),
        );

        assert.deepEqual(yield* Ref.get(heard), ["first", "second", "third"]);
        assert.deepEqual(
          seqs,
          seqs.toSorted((one, other) => one - other),
        );
      }),
  );

  it.effect(
    "a send that waits out a hand-over longer than a waiter's quiet keeps its place, since each ask keeps it live though the claim it finds taken rolls the ask back",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const db = yield* Database;
        const heard = yield* Ref.make<readonly string[]>([]);
        const send = (clientKey: string) =>
          writer.writeAwaitingLine(
            target,
            { text: clientKey, clientKey, sender: SENDER },
            Effect.as(
              Ref.update(heard, (keys) => [...keys, clientKey]),
              true,
            ),
          );
        // A hand-over's claim, which stands while the sends below wait on it.
        yield* claimLeftBy(target, randomUUID());

        const earlier = yield* Effect.forkChild(send("earlier"));
        yield* timePasses(1500);
        // As though the hand-over had run on past a waiter's quiet: the database last heard from the waiter long ago.
        yield* waitersLastSeen(target, 3);
        yield* timePasses(500);
        const later = yield* Effect.forkChild(send("later"));
        yield* timePasses(60);
        yield* db
          .update(conversations)
          .set({ dispatchClaim: null, dispatchClaimedAt: null })
          .where(eq(conversations.id, target.conversationId));
        yield* joinedAsTimePasses(earlier);
        yield* joinedAsTimePasses(later);

        assert.deepEqual(yield* Ref.get(heard), ["earlier", "later"]);
      }),
  );

  it.effect(
    "a send or a rewind for a conversation that stands no longer, as after its purge, is answered absent rather than failing",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const gone = { ...target, conversationId: randomUUID() };

        const sent = yield* writer.writeAwaitingLine(
          gone,
          { text: "Fix the tile.", clientKey: "fix", sender: SENDER },
          Effect.succeed(true),
        );
        const rewound = yield* rewindConversation(gone, randomUUID());

        assert.deepEqual(sent, Result.fail({ refusal: STORE_WRITE_REFUSAL.NO_CONVERSATION }));
        assert.deepEqual(rewound, Result.fail(REWIND_REFUSAL.NOT_FOUND));
      }),
  );

  it.effect(
    "a waiter that stopped asking holds no one up once the database last heard from it a couple of seconds ago, where one still asking does",
    () =>
      Effect.gen(function* () {
        const stale = yield* openAgentConversation;
        const live = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const line = { text: "Use seven days.", clientKey: "send", sender: SENDER };
        yield* waiterSeen(stale, 3);
        yield* waiterSeen(live, 0);

        const pastStale = yield* writer.writeAwaitingLine(stale, line, Effect.succeed(true));
        const behindLive = yield* Effect.forkChild(
          writer.writeAwaitingLine(live, line, Effect.succeed(true)),
        );

        assert.ok(Result.isSuccess(pastStale) && Option.isSome(pastStale.success));
        assert.deepEqual(
          yield* joinedAsTimePasses(behindLive),
          Result.fail({ refusal: STORE_WRITE_REFUSAL.BUSY }),
        );
      }),
  );

  it.effect(
    "a refused send whose record fails once is recorded on a second try, so its line is withdrawn and a retry under its key is handed over",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const { handed, dispatch } = yield* countedDispatch;
        const line = { text: "Fix the tile.", clientKey: "fix", sender: SENDER };
        yield* releaseFailsOnce(target);

        const refusing = yield* Effect.forkChild(
          writer.writeAwaitingLine(target, line, dispatch(false)),
        );
        const refused = yield* joinedAsTimePasses(refusing);
        const sentAfter = yield* sentLineStands(
          target.userId,
          target.conversationId,
          sentLineId("fix"),
        );
        const retried = yield* writer.writeAwaitingLine(target, line, dispatch(true));

        assert.deepEqual(refused, Result.succeed(Option.none()));
        assert.equal(sentAfter, false);
        assert.ok(Result.isSuccess(retried) && Option.isSome(retried.success));
        assert.equal(retried.success.value.effect, STORE_WRITE_EFFECT.WRITTEN);
        assert.equal(yield* Ref.get(handed), 2);
      }),
  );

  it.effect(
    "a refused ask whose record fails once is recorded on a second try, so a retry hands it over again",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const record = askRecord();
        const answers = yield* Ref.make<readonly ("refused" | "taken")[]>(["refused", "taken"]);
        const handed = yield* Ref.make(0);
        const dispatch = () =>
          Effect.gen(function* () {
            yield* Ref.update(handed, (n) => n + 1);
            const [answer, ...rest] = yield* Ref.get(answers);
            yield* Ref.set(answers, rest);
            return answer === "taken" ? { sessionId: "session-1", deliveryId: "dl_1" } : undefined;
          });
        const ask = yield* record.record({
          ...target,
          clientId: "ask",
          origin: ASK_ORIGIN.TYPED,
          createdAt: new Date(0),
        });
        yield* releaseFailsOnce(target);

        yield* joinedAsTimePasses(
          yield* Effect.forkChild(record.dispatchOnce(target, ask.id, dispatch)),
        );
        const retried = yield* record.dispatchOnce(target, ask.id, dispatch);

        assert.ok(typeof retried !== "string");
        assert.equal(retried.sessionId, "session-1");
        assert.equal(yield* Ref.get(handed), 2);
      }),
  );

  it.effect("no transaction stands open while a line or an ask is handed over", () =>
    Effect.gen(function* () {
      const target = yield* openAgentConversation;
      const writer = yield* storeWriter({ tools: {} });
      const record = askRecord();
      const services = yield* Effect.context<DatabaseServices>();
      const seen = yield* Ref.make<readonly boolean[]>([]);
      const looked = Effect.tap(Effect.orDie(Effect.provide(inNoTransaction, services)), (alone) =>
        Ref.update(seen, (all) => [...all, alone]),
      );
      const ask = yield* record.record({
        ...target,
        clientId: "ask",
        origin: ASK_ORIGIN.TYPED,
        createdAt: new Date(0),
      });

      yield* writer.writeAwaitingLine(
        target,
        { text: "Fix the tile.", clientKey: "fix", sender: SENDER },
        Effect.as(looked, true),
      );
      yield* record.dispatchOnce(target, ask.id, () =>
        Effect.as(looked, { sessionId: "session-1", deliveryId: "dl_1" }),
      );

      assert.deepEqual(yield* Ref.get(seen), [true, true]);
    }),
  );

  it.effect(
    "a line whose hand-over is under way is not read as sent, so a send repeated meanwhile goes on to wait for it, and is read as sent once the runtime took it",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const began = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const line = { text: "Fix the tile.", clientKey: "fix", sender: SENDER };
        const sent = sentLineStands(target.userId, target.conversationId, sentLineId("fix"));

        const sending = yield* Effect.forkChild(
          writer.writeAwaitingLine(
            target,
            line,
            Effect.andThen(
              Deferred.succeed(began, undefined),
              Effect.as(Deferred.await(release), true),
            ),
          ),
        );
        yield* Deferred.await(began);
        const sentMeanwhile = yield* sent;
        const rowsMeanwhile = yield* rowsUnder(target, "fix");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(sending);

        assert.equal(sentMeanwhile, false);
        assert.equal(rowsMeanwhile, 1);
        assert.equal(yield* sent, true);
      }),
  );

  it.effect(
    "a line the runtime did not take is withdrawn, and a reader holding an older cursor is told to read the transcript afresh",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const writer = yield* storeWriter({ tools: {} });
        const before = yield* readRewoundRevision(target);

        const refused = yield* writer.writeAwaitingLine(
          target,
          { text: "Fix the tile.", clientKey: "fix", sender: SENDER },
          Effect.succeed(false),
        );

        assert.deepEqual(refused, Result.succeed(Option.none()));
        assert.equal(yield* rowsUnder(target, "fix"), 0);
        assert.equal(before, undefined);
        assert.notEqual(yield* readRewoundRevision(target), undefined);
      }),
  );

  it.effect(
    "a native runner's take binds an ask by its own id while its hand-over is still out, and the record that follows keeps the turn",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const record = askRecord();
        const services = yield* Effect.context<DatabaseServices>();
        const turnId = randomUUID();
        const ask = yield* record.record({
          ...target,
          clientId: "call",
          origin: ASK_ORIGIN.SPOKEN,
          createdAt: new Date(0),
        });

        yield* record.dispatchOnce(target, ask.id, () =>
          Effect.provide(
            Effect.as(record.bindDeliveries(target, [ask.id], turnId), {
              sessionId: "claude-code-session",
              deliveryId: ask.id,
            }),
            services,
          ).pipe(Effect.orDie),
        );

        assert.equal((yield* record.named(target.userId, ask.id))?.turnId, turnId);
      }),
  );

  it.effect(
    "the binding of a delivery waits out an ask's hand-over under way, and goes on once what eve answered is written",
    () =>
      Effect.gen(function* () {
        const target = yield* openAgentConversation;
        const record = askRecord();
        const began = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const ask = yield* record.record({
          ...target,
          clientId: "steer",
          origin: ASK_ORIGIN.SPOKEN,
          createdAt: new Date(0),
        });

        const dispatching = yield* Effect.forkChild(
          record.dispatchOnce(target, ask.id, () =>
            Effect.andThen(
              Deferred.succeed(began, undefined),
              Effect.as(Deferred.await(release), { sessionId: "session-1", deliveryId: "dl_1" }),
            ),
          ),
        );
        yield* Deferred.await(began);
        const settling = yield* Effect.forkChild(record.handOversSettled(target));
        yield* TestClock.adjust(Duration.seconds(2));
        const settledEarly = settling.pollUnsafe() !== undefined;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(dispatching);
        yield* joinedAsTimePasses(settling);
        const bound = yield* record.bindDeliveries(target, ["dl_1"], randomUUID());

        assert.equal(settledEarly, false);
        assert.deepEqual(
          bound.map((row) => row.id),
          [ask.id],
        );
      }),
  );
});
