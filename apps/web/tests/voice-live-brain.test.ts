import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { SCHEMA_REFUSAL } from "@sidecar/wire";
import { Duration, Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { SqlClient } from "effect/unstable/sql";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { ASK_ORIGIN, TURN_END, TURN_EVENT_KIND, TURN_SLOW_STEP } from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { ASK_REFUSAL } from "../server/hosted/brain-ask";
import { BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import {
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import type { MessageListRead } from "../server/hosted/store/message-reads";
import {
  HOSTED_ASK_REFUSAL_NOTE,
  type HostedLiveBrain,
  type HostedLiveBrainOptions,
  hostedLiveBrain,
} from "../server/voice/live-brain";
import { FIRST_EVE_TURN, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { deleteConversation, insertConversation } from "./support/store-rows";

/**
 * The hosted live brain over the real ask door and the real store on PGlite:
 * a spoken ask admitted and recorded through `acceptAsk` under a fake eve, its
 * turn driven through the real relay as eve's stream would drive it, and the
 * run seams the live session service consumes read back under the ask's id.
 * Every row belongs to an account the test created, since on CI this file
 * shares one database with every other store file. Synthetic throughout: no
 * real question, title, or spoken word.
 */

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

const NOW = 1_800_000_000_000;
/** The follow's bounds narrowed so a poll is a few milliseconds of the test's own clock. */
const POLL_MS = 5;
const POLL = Duration.millis(POLL_MS);
/** How many polls a test waits out to say that nothing more arrives. */
const QUIET_POLLS = { AFTER_END: 6, AFTER_REFUSAL: 4, AFTER_STOP: 8 } as const;
/** The most polls a wait walks before it gives up, well past what any fixture here needs. */
const FOLLOW_STEPS = 400;
const QUICK = { POLL, FOLLOW: Duration.minutes(1) };
/** The same cadence with the bound close enough to reach inside a test. */
const BOUNDED = { POLL, FOLLOW: Duration.millis(150) };

const writer = await database.run(
  storeWriter({
    tools: CATALOG_TOOL_SET,
  }),
);
const askEffects = askRecord();
/** The one client the suite's runtime holds, provided to the brain's fibers so every statement takes the same permit. */
const sqlClient = await database.run(Effect.service(SqlClient.SqlClient));
const relay = new StreamRelay({
  writer,
  asks: askEffects,
  stopTurn: () => Effect.void,
  offer: () => Effect.succeed(false),
  deliverCompletion: () => Effect.void,
  now: () => NOW,
  report: () => undefined,
});

/** An eve session id of this test's own: the relay names a turn by session and eve turn, so a counted id would collide across the files that share one database on CI. */
function mintSession(): string {
  return `wrun_${randomUUID()}`;
}

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
  failNext: number | undefined;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    failNext: undefined,
    open(message) {
      eve.opened.push(message);
      if (eve.failNext !== undefined) {
        const status = eve.failNext;
        eve.failNext = undefined;
        return Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status });
      }
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: mintSession() });
    },
    send(sessionId) {
      return Effect.succeed({
        outcome: EVE_SEND_OUTCOME.ACCEPTED,
        sessionId,
        deliveryId: "delivery-1",
      });
    },
    cancel() {
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED });
    },
  };
  return eve;
}

/**
 * One turn of the follow: the poll spacing on the test's own clock, then a
 * real statement, which on PGlite is the same permit the look's own read
 * holds, so the read the poll woke has landed before the step answers.
 */
const stepFollow = Effect.gen(function* () {
  yield* TestClock.adjust(POLL);
  yield* Effect.orDie(Effect.asVoid(sqlClient`select 1`));
});

/** Waits by letting the follow look again, since a run event reaches the service only on its poll. */
function followUntil(ready: () => boolean, waitedFor: string) {
  return Effect.gen(function* () {
    for (let step = 0; step < FOLLOW_STEPS; step += 1) {
      if (ready()) return;
      yield* stepFollow;
    }
    if (!ready()) assert.fail(`timed out waiting for ${waitedFor}`);
  });
}

/** The polls a test walks to say that nothing more arrives, each one a look the follow was free to take. */
function quiet(polls: number) {
  return Effect.gen(function* () {
    for (let step = 0; step < polls; step += 1) yield* stepFollow;
  });
}

/** A fresh account with its standing main, the conversation a spoken ask lands in. */
async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

interface Stand {
  readonly eve: FakeEve;
  readonly brain: HostedLiveBrain;
  readonly events: LiveBrainRunEvent[];
  /** Settles once at least `count` run events have reached the listener, letting the follow look until they do. */
  readonly arrived: (count: number) => Effect.Effect<void>;
  readonly reports: string[];
  /** The socket's own scope as the attachment opens one; closing it interrupts every follow under way. */
  readonly stop: () => Effect.Effect<void>;
}

/**
 * The brain built in the test's own fiber, so every follow it forks keeps
 * time on the ambient `TestClock` the steps above advance.
 */
const stand = Effect.fnUntraced(function* (
  target: ConversationTarget,
  bounds: NonNullable<HostedLiveBrainOptions["bounds"]> = QUICK,
  store: HostedLiveBrainOptions["store"] = database.store,
) {
  const eve = fakeEve();
  const events: LiveBrainRunEvent[] = [];
  const reports: string[] = [];
  const scope = yield* Scope.make();
  const brain = yield* Scope.provide(
    hostedLiveBrain({
      userId: target.userId,
      asks: { asks: askEffects, eve },
      store,
      report: (message) => reports.push(message),
      bounds,
    }),
    scope,
  );
  brain.onRunEvent((event) => events.push(event));
  const stood: Stand = {
    eve,
    brain,
    events,
    reports,
    arrived: (count) => followUntil(() => events.length >= count, `${count} run events`),
    stop: () => Scope.close(scope, Exit.void),
  };
  return stood;
});

/** The eve session an accepted ask was handed to, from the record; a follow-up would read it the same way. */
const sessionOf = Effect.fnUntraced(function* (target: ConversationTarget, askId: string) {
  const ask = yield* askEffects.named(target.userId, askId);
  assert.ok(ask?.sessionId);
  return ask.sessionId;
});

const play = Effect.fnUntraced(function* (
  events: readonly MessageStreamEvent[],
  standing: RelayStanding,
) {
  for (const event of events) yield* relay.handle(event, standing);
});

it.effect(
  "a spoken ask goes through the ask door under the spoken origin with the submission id as its client id, answers the ask's id as the run, and a retry of the submission finds the same run with eve reached once",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target);
      const submissionId = randomUUID();
      const ask = { submissionId, question: "Developer: what needs me?" };

      const accepted = yield* f.brain.submitAsk(ask);
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(
        f.eve.opened.map((message) => [message.conversationId, message.turn, message.message]),
        [[target.conversationId, BRAIN_HOST_TURN.SPOKEN, ask.question]],
      );
      const recorded = yield* askEffects.named(target.userId, accepted.runId);
      assert.deepEqual(
        [recorded?.origin, recorded?.clientId, recorded?.conversationId],
        [ASK_ORIGIN.SPOKEN, submissionId, target.conversationId],
      );

      const again = yield* f.brain.submitAsk(ask);
      assert.deepEqual(again, accepted);
      assert.equal(f.eve.opened.length, 1);
      yield* f.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "an accepted ask's turn is followed from the record: the slow step, the settled mark, the sentences, and the end reach the service under the ask's id, exactly once, however many times the submission was retried",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target);
      const ask = { submissionId: randomUUID(), question: "q" };
      const accepted = yield* f.brain.submitAsk(ask);
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(yield* f.brain.submitAsk(ask), accepted);
      const standing: RelayStanding = {
        sessionId: yield* sessionOf(target, accepted.runId),
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* play(events.slice(0, requested), standing);
      yield* f.arrived(1);
      yield* play(events.slice(requested), standing);
      yield* f.arrived(5);
      yield* quiet(QUIET_POLLS.AFTER_END);

      assert.deepEqual(
        f.events.map((event) => event.kind),
        [
          LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
          LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
          LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          LIVE_BRAIN_RUN_EVENT.ENDED,
        ],
      );
      assert.deepEqual(new Set(f.events.map((event) => event.runId)), new Set([accepted.runId]));
      const [slow, , first, second, end] = f.events;
      assert.equal(
        slow?.kind === LIVE_BRAIN_RUN_EVENT.SLOW_STEP && slow.step,
        TURN_SLOW_STEP.TRANSCRIPT_READ,
      );
      assert.equal(
        first?.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE && first.sentence,
        "One agent finished.",
      );
      assert.equal(
        second?.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE && second.sentence,
        "Another is waiting on you.",
      );
      assert.equal(
        end?.kind === LIVE_BRAIN_RUN_EVENT.ENDED && end.end,
        LIVE_BRAIN_RUN_END.COMPLETED,
      );
      assert.deepEqual(f.reports, []);
      yield* f.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a refusal at the door is spoken as the build's own note for it, and every refusal has one",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target);
      f.eve.failNext = 502;
      const refused = yield* f.brain.submitAsk({
        submissionId: randomUUID(),
        question: "q",
      });
      assert.deepEqual(refused, {
        outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
        refusal: HOSTED_ASK_REFUSAL_NOTE[ASK_REFUSAL.UPSTREAM],
      });
      assert.deepEqual(
        Object.keys(HOSTED_ASK_REFUSAL_NOTE).sort(),
        Object.values(ASK_REFUSAL).sort(),
      );
      yield* quiet(QUIET_POLLS.AFTER_REFUSAL);
      assert.deepEqual(f.events, []);
      yield* f.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "an ask whose turn never starts is told as failed at the follow bound, once, and the bound is reported",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target, BOUNDED);
      const accepted = yield* f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* f.arrived(1);
      yield* quiet(QUIET_POLLS.AFTER_END);
      assert.deepEqual(f.events, [
        { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
      ]);
      assert.equal(f.reports.length, 1);
      yield* f.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "a journal the store cannot read ends the ask as failed, once, and is reported, never told as a completed end with no sentences",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const unreadable: MessageListRead = {
        ok: false,
        refusal: SCHEMA_REFUSAL.MALFORMED,
        conversationId: target.conversationId,
        seq: 0,
        path: [],
      };
      const f = yield* stand(target, QUICK, {
        turns: database.store.turns,
        messages: { ...database.store.messages, byClientId: () => Effect.succeed(unreadable) },
      });
      const accepted = yield* f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const sessionId = yield* sessionOf(target, accepted.runId);
      yield* play(spokenTurn(FIRST_EVE_TURN, NOW), {
        sessionId,
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      });
      yield* f.arrived(1);
      yield* quiet(QUIET_POLLS.AFTER_END);
      assert.deepEqual(f.events, [
        { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
      ]);
      assert.equal(f.reports.length, 1);
      yield* f.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect(
  "an ask the record no longer holds ends as failed rather than being followed forever",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* stand(target);
      const accepted = yield* f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* Effect.promise(() => deleteConversation(database.run, target.conversationId));
      yield* f.arrived(1);
      assert.deepEqual(f.events, [
        { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
      ]);
      yield* f.stop();
    }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect("stop ends every follow: a turn that completes after it reaches no listener", () =>
  Effect.gen(function* () {
    const target = yield* Effect.promise(() => account());
    const f = yield* stand(target);
    const accepted = yield* f.brain.submitAsk({ submissionId: randomUUID(), question: "q" });
    assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
    if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
    yield* f.stop();
    const sessionId = yield* sessionOf(target, accepted.runId);
    yield* play(spokenTurn(FIRST_EVE_TURN, NOW), {
      sessionId,
      target,
      kind: CONVERSATION_KIND.MAIN,
      turn: BRAIN_HOST_TURN.SPOKEN,
      model: "scripted-model",
      state: memoryRelayState(),
    });
    yield* quiet(QUIET_POLLS.AFTER_STOP);
    assert.deepEqual(f.events, []);
  }).pipe(Effect.provideService(SqlClient.SqlClient, sqlClient)),
);

it.effect("the stream's vocabulary and the service's are one set of words on each side", () =>
  Effect.sync(() => {
    assert.deepEqual(
      Object.values(TURN_EVENT_KIND).sort(),
      Object.values(LIVE_BRAIN_RUN_EVENT).sort(),
    );
    assert.deepEqual(Object.values(TURN_END).sort(), Object.values(LIVE_BRAIN_RUN_END).sort());
  }),
);
