import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainAsk,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { arrival } from "@sidecar/voice/testing";
import { SCHEMA_REFUSAL } from "@sidecar/wire";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Deferred, Duration, Effect, Exit, Option, Redacted, Scope } from "effect";
import { TestClock } from "effect/testing";
import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { ASK_ORIGIN, TURN_END, TURN_EVENT_KIND, TURN_SLOW_STEP } from "../server/core";
import { ASK_REFUSAL, askStanding } from "../server/hosted/brain-ask";
import { deploymentActor } from "../server/hosted/brain-host/auth";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import { DEPLOYMENT_TURNS } from "../server/hosted/brain-host/channel";
import { ownedAuth } from "../server/hosted/brain-host/door";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  eveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { claimRuntimeSession } from "../server/hosted/brain-host/recorded-session";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { createPlan, openPlanConversation } from "../server/hosted/plan-store";
import {
  SEARCH_WEB_REFUSAL,
  SEARCH_WEB_STATUS,
  SEARCH_WEB_TOOL,
} from "../server/hosted/public-research";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import type { MessageListRead } from "../server/hosted/store/message-reads";
import {
  HOSTED_ASK_REFUSAL_NOTE,
  type HostedLiveBrain,
  type HostedLiveBrainOptions,
  hostedLiveBrain,
  LIVE_BRAIN_FOLLOW_BOUNDS,
} from "../server/voice/live-brain";
import { stampedEveEvent } from "./support/eve-events";
import { FIRST_EVE_TURN, parkedTurn, resumedTurn, spokenTurn } from "./support/eve-turns";
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

/** A plan the account starts, as the Plans tab's new-plan form saves one. */
const PLAN = {
  name: "Teammate invitations",
} as const;
/**
 * The follow's bounds narrowed so a poll is milliseconds, with the bound left
 * wide: a turn's events land through the store, and the store on CI is one
 * Postgres shared with every other job, so a bound measured in milliseconds
 * against it would expire under load before the turn's first event arrives.
 */
const POLL_MS = 5;
/**
 * The follow keeps time on the store runtime's clock, which is the real one,
 * so this suite runs under `it.live`: a wait for an event is on the event
 * itself (`arrived`), and a wait of several polls after the last one is the
 * suite's one plain sleep, asserting that nothing more arrives. The bound
 * tests at the end are the exception: a bound of minutes is reached only on
 * the `TestClock`, so those build the brain on the test's own fiber
 * (`standOnTestClock`) and run under `it.effect`.
 */
const QUIET_POLLS = { AFTER_END: 6, AFTER_REFUSAL: 4, AFTER_STOP: 8 } as const;
const QUICK = { POLL: Duration.millis(POLL_MS), FOLLOW: Duration.minutes(1) };
/** The same cadence with the bound close enough to reach inside a test. */
const BOUNDED = { POLL: Duration.millis(POLL_MS), FOLLOW: Duration.millis(150) };

// The relay's writer holds rows to the hosted set, as production's does, so a planning turn's research call is written.
const writer = await database.run(
  storeWriter({
    tools: HOSTED_TOOL_SET,
  }),
);
const askEffects = askRecord();
const asks = {
  named: (userId: string, id: string) => database.run(askEffects.named(userId, id)),
};
const relay = new StreamRelay({
  writer,
  asks: askEffects,
  stopTurn: () => Effect.void,
  now: () => NOW,
  report: () => undefined,
});

/** The revisions the file's asks are numbered by, so a later ask is the newer one as the service numbers it. */
let revisions = 0;

/** A spoken ask as the service submits one: in a voice session, at the next revision of the file's order. */
function spokenAsk(
  question: string,
  submissionId: string = randomUUID(),
  sessionId: string = `voice_${randomUUID()}`,
): LiveBrainAsk {
  revisions += 1;
  return { submissionId, question, sessionId, revision: revisions };
}

/** An eve session id of this test's own: the relay names a turn by session and eve turn, so a counted id would collide across the files that share one database on CI. */
function mintSession(): string {
  return `wrun_${randomUUID()}`;
}

interface FakeEve extends EveSessions {
  readonly opened: EveMessage[];
  /** The delivery id each send into a standing session was answered with, in order. */
  readonly delivered: string[];
  /** Every cancel eve was asked for, as the session and eve's turn it was scoped to. */
  readonly cancelled: (readonly [string, string])[];
  failNext: number | undefined;
  /** The status eve refuses the next cancel with, where set. */
  refuseCancel: number | undefined;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    delivered: [],
    cancelled: [],
    failNext: undefined,
    refuseCancel: undefined,
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
      const deliveryId = `delivery-${randomUUID()}`;
      eve.delivered.push(deliveryId);
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId });
    },
    cancel(sessionId, eveTurnId) {
      eve.cancelled.push([sessionId, eveTurnId]);
      if (eve.refuseCancel !== undefined) {
        return Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.FAILED, status: eve.refuseCancel });
      }
      return Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED });
    },
  };
  return eve;
}

/** A fresh account with a conversation, the one a spoken ask lands in unless a test names another. */
async function account(): Promise<ConversationTarget> {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, { userId });
  return { userId, conversationId };
}

interface Listening {
  /** The stream's seams the listener heard, in order. */
  readonly events: LiveBrainRunEvent[];
  /** What the listener heard of the run's activity, apart from the seams. */
  readonly activities: LiveBrainRunEvent[];
  /** What the listener heard of the run's settled steps, apart from the seams. */
  readonly steps: LiveBrainRunEvent[];
  /** Settles once at least `count` seams have reached the listener, on the events themselves. */
  readonly arrived: (count: number) => Effect.Effect<void>;
  /** Settles once at least `count` activities have reached the listener. */
  readonly active: (count: number) => Effect.Effect<void>;
  /** Settles once at least `count` settled-step events have reached the listener. */
  readonly stepped: (count: number) => Effect.Effect<void>;
}

interface Stand extends Listening {
  readonly eve: FakeEve;
  readonly brain: HostedLiveBrain;
  readonly reports: string[];
  /** The socket's own scope as the attachment opens one; closing it interrupts every follow under way. */
  readonly stop: () => Promise<void>;
}

/** The brain's listener as the service stands one: the seams, the activity, and the settled steps kept apart, each with a wait on its count. */
function listening(brain: HostedLiveBrain): Listening {
  const events: LiveBrainRunEvent[] = [];
  const activities: LiveBrainRunEvent[] = [];
  const steps: LiveBrainRunEvent[] = [];
  brain.onRunEvent((event) => {
    if (event.kind === LIVE_BRAIN_RUN_EVENT.ACTIVITY) activities.push(event);
    else if (event.kind === LIVE_BRAIN_RUN_EVENT.STEP_SETTLED) steps.push(event);
    else events.push(event);
  });
  const arrived = (count: number) =>
    arrival(
      (notify) => brain.onRunEvent(notify),
      () => events.length >= count,
      `${count} run events`,
    );
  const active = (count: number) =>
    arrival(
      (notify) => brain.onRunEvent(notify),
      () => activities.length >= count,
      `${count} activities`,
    );
  const stepped = (count: number) =>
    arrival(
      (notify) => brain.onRunEvent(notify),
      () => steps.length >= count,
      `${count} settled steps`,
    );
  return { events, activities, steps, arrived, active, stepped };
}

async function stand(
  target: ConversationTarget,
  bounds: NonNullable<HostedLiveBrainOptions["bounds"]> = QUICK,
  store: HostedLiveBrainOptions["store"] = database.store,
  conversationId: string = target.conversationId,
  record: HostedLiveBrainOptions["asks"]["asks"] = askEffects,
  over?: EveSessions,
): Promise<Stand> {
  const eve = fakeEve();
  const reports: string[] = [];
  const scope = await database.run(Scope.make());
  const brain = await database.run(
    Scope.provide(
      hostedLiveBrain({
        userId: target.userId,
        conversationId,
        asks: { asks: record, eve: over ?? eve },
        store,
        writer,
        report: (message) => reports.push(message),
        bounds,
      }),
      scope,
    ),
  );
  return {
    ...listening(brain),
    eve,
    brain,
    reports,
    stop: () => database.run(Scope.close(scope, Exit.void)),
  };
}

/** The eve session an accepted ask was handed to, from the record; a follow-up would read it the same way. */
async function sessionOf(target: ConversationTarget, askId: string): Promise<string> {
  const ask = await asks.named(target.userId, askId);
  assert.ok(ask?.sessionId);
  return ask.sessionId;
}

async function play(events: readonly MessageStreamEvent[], standing: RelayStanding) {
  for (const event of events) await database.run(relay.handle(event, standing));
}

it.live(
  "a spoken ask goes through the ask door under the spoken origin with the submission id as its client id, answers the ask's id as the run, and a retry of the submission finds the same run with eve reached once",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      const submissionId = randomUUID();
      const ask = spokenAsk("Developer: what needs me?", submissionId);

      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(ask)));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(
        f.eve.opened.map((message) => [message.conversationId, message.turn, message.message]),
        [[target.conversationId, BRAIN_HOST_TURN.SPOKEN, ask.question]],
      );
      const recorded = yield* Effect.promise(() => asks.named(target.userId, accepted.runId));
      assert.deepEqual(
        [recorded?.origin, recorded?.clientId, recorded?.conversationId],
        [ASK_ORIGIN.SPOKEN, submissionId, target.conversationId],
      );

      const again = yield* Effect.promise(() => database.run(f.brain.submitAsk(ask)));
      assert.deepEqual(again, accepted);
      assert.equal(f.eve.opened.length, 1);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "an accepted ask's turn is followed from the record: the slow step, the settled mark, the sentences, and the end reach the service under the ask's id, exactly once, however many times the submission was retried",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      const ask = spokenAsk("q");
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(ask)));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(yield* Effect.promise(() => database.run(f.brain.submitAsk(ask))), accepted);
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* f.arrived(1);
      yield* Effect.promise(() => play(events.slice(requested), standing));
      yield* f.arrived(5);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);

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
        TURN_SLOW_STEP.REPOSITORY_READ,
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
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "the first sentence of an answer that follows only settled calls reaches the service while the turn still runs, and the rest follow with the end",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const answer = events.findIndex((event) => event.type === "message.completed");
      const forming = stampedEveEvent(
        {
          type: "message.appended",
          data: {
            turnId: FIRST_EVE_TURN,
            sequence: 0,
            stepIndex: 1,
            messageDelta: "One agent finished. Another is",
          },
        },
        NOW,
      );
      yield* Effect.promise(() => play([...events.slice(0, answer), forming], standing));
      yield* f.arrived(3);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(
        f.events.map((event) =>
          event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE ? event.sentence : event.kind,
        ),
        [
          LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
          LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
          "One agent finished.",
        ],
      );

      yield* Effect.promise(() => play(events.slice(answer), standing));
      yield* f.arrived(5);
      assert.deepEqual(
        f.events
          .slice(3)
          .map((event) =>
            event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE ? event.sentence : event.kind,
          ),
        ["Another is waiting on you.", LIVE_BRAIN_RUN_EVENT.ENDED],
      );
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a refusal at the door is spoken as the build's own note for it, and every refusal has one",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      f.eve.failNext = 502;
      const refused = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.deepEqual(refused, {
        outcome: LIVE_BRAIN_SUBMISSION.REFUSED,
        refusal: HOSTED_ASK_REFUSAL_NOTE[ASK_REFUSAL.UPSTREAM],
      });
      assert.deepEqual(
        Object.keys(HOSTED_ASK_REFUSAL_NOTE).sort(),
        Object.values(ASK_REFUSAL).sort(),
      );
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_REFUSAL);
      assert.deepEqual(f.events, []);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "an ask whose turn never starts is told as failed at the follow bound, once, and the bound is reported",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target, BOUNDED));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* f.arrived(1);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(f.events, [
        { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
      ]);
      assert.equal(f.reports.length, 1);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
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
      const f = yield* Effect.promise(() =>
        stand(target, QUICK, {
          turns: database.store.turns,
          messages: { ...database.store.messages, byClientId: () => Effect.succeed(unreadable) },
        }),
      );
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
      yield* Effect.promise(() =>
        play(spokenTurn(FIRST_EVE_TURN, NOW), {
          sessionId,
          target,
          turn: BRAIN_HOST_TURN.SPOKEN,
          model: "scripted-model",
          state: memoryRelayState(),
        }),
      );
      yield* f.arrived(1);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(f.events, [
        { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
      ]);
      assert.equal(f.reports.length, 1);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live("an ask the record no longer holds ends as failed rather than being followed forever", () =>
  Effect.gen(function* () {
    const target = yield* Effect.promise(() => account());
    const f = yield* Effect.promise(() => stand(target));
    const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
    assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
    if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
    yield* Effect.promise(() => deleteConversation(database.run, target.conversationId));
    yield* f.arrived(1);
    assert.deepEqual(f.events, [
      { kind: LIVE_BRAIN_RUN_EVENT.ENDED, runId: accepted.runId, end: LIVE_BRAIN_RUN_END.FAILED },
    ]);
    yield* Effect.promise(() => f.stop());
  }),
);

it.live("stop ends every follow: a turn that completes after it reaches no listener", () =>
  Effect.gen(function* () {
    const target = yield* Effect.promise(() => account());
    const f = yield* Effect.promise(() => stand(target));
    const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
    assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
    if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
    yield* Effect.promise(() => f.stop());
    const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
    yield* Effect.promise(() =>
      play(spokenTurn(FIRST_EVE_TURN, NOW), {
        sessionId,
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      }),
    );
    yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_STOP);
    assert.deepEqual(f.events, []);
  }),
);

it.live(
  "the stream's vocabulary and the service's are one set of words on each side, but for the live brain's own activity, settled steps, and woken runs",
  () =>
    Effect.sync(() => {
      const {
        ACTIVITY: _ownActivity,
        STEP_SETTLED: _ownSteps,
        WOKEN: _ownWoken,
        ...streamed
      } = LIVE_BRAIN_RUN_EVENT;
      assert.deepEqual(Object.values(TURN_EVENT_KIND).sort(), Object.values(streamed).sort());
      assert.deepEqual(Object.values(TURN_END).sort(), Object.values(LIVE_BRAIN_RUN_END).sort());
    }),
);

it.live(
  "two asks eve folded into one turn hear its reply once, under the newer ask, even where the older ask's follow reaches the turn first, and each hears the turn's end",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      // The newer ask's record is read only once the gate opens, so the older ask's follow is the
      // first to reach the folded turn whatever the poll's phase.
      const gate = yield* Deferred.make<void>();
      let gated: string | undefined;
      const record: HostedLiveBrainOptions["asks"]["asks"] = {
        ...askEffects,
        named: (userId, id) =>
          id === gated
            ? Effect.andThen(Deferred.await(gate), askEffects.named(userId, id))
            : askEffects.named(userId, id),
      };
      const f = yield* Effect.promise(() =>
        stand(target, QUICK, database.store, target.conversationId, record),
      );
      const first = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q1"))));
      const second = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q2"))));
      assert.equal(first.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      assert.equal(second.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (first.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      if (second.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      gated = second.runId;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, first.runId)),
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() => play(spokenTurn(FIRST_EVE_TURN, NOW, f.eve.delivered), standing));
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      yield* Deferred.succeed(gate, undefined);
      yield* f.arrived(6);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);

      const sentences = f.events.flatMap((event) =>
        event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE ? [[event.runId, event.sentence]] : [],
      );
      assert.deepEqual(sentences, [
        [second.runId, "One agent finished."],
        [second.runId, "Another is waiting on you."],
      ]);
      const ended = f.events.flatMap((event) =>
        event.kind === LIVE_BRAIN_RUN_EVENT.ENDED ? [event.runId] : [],
      );
      assert.deepEqual(new Set(ended), new Set([first.runId, second.runId]));
      assert.equal(ended.length, 2);
      assert.deepEqual(f.reports, []);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a newer folded ask whose binding was not yet visible when the older one reached the turn takes the telling over from the next event, so the reply is still the newer ask's",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      // While hidden, the newer ask reads as bound to no turn, as it would between eve's queueing
      // of the turn's row and the binding of the asks folded into it.
      let hidden: string | undefined;
      const record: HostedLiveBrainOptions["asks"]["asks"] = {
        ...askEffects,
        named: (userId, id) =>
          Effect.map(askEffects.named(userId, id), (ask) => {
            if (ask === undefined || id !== hidden) return ask;
            const { turnId: _hidden, ...unbound } = ask;
            return unbound;
          }),
      };
      const f = yield* Effect.promise(() =>
        stand(target, QUICK, database.store, target.conversationId, record),
      );
      const first = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q1"))));
      const second = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q2"))));
      assert.equal(first.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      assert.equal(second.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (first.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      if (second.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      hidden = second.runId;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, first.runId)),
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = spokenTurn(FIRST_EVE_TURN, NOW, f.eve.delivered);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* f.arrived(1);
      hidden = undefined;
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      yield* Effect.promise(() => play(events.slice(requested), standing));
      yield* f.arrived(6);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);

      const told = f.events.flatMap((event) =>
        event.kind === LIVE_BRAIN_RUN_EVENT.ENDED ? [] : [[event.kind, event.runId]],
      );
      assert.deepEqual(told, [
        [LIVE_BRAIN_RUN_EVENT.SLOW_STEP, first.runId],
        [LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, second.runId],
        [LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, second.runId],
        [LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, second.runId],
      ]);
      assert.deepEqual(f.reports, []);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a run is cancelled through `stopAsk`: eve's cancel scoped to the turn and the row stamped, a refused cancel answered as failed, and an ended turn as nothing to cancel",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
      const standing: RelayStanding = {
        sessionId,
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* f.arrived(1);
      // eve's store hook records the session on the conversation as it starts, which is what a Stop reads.
      yield* Effect.promise(() =>
        database.run(claimRuntimeSession(target, sessionId, new Date(NOW))),
      );

      f.eve.refuseCancel = 503;
      assert.equal(
        yield* Effect.promise(() => database.run(f.brain.cancelRun(accepted.runId))),
        LIVE_BRAIN_CANCEL.FAILED,
      );
      f.eve.refuseCancel = undefined;
      assert.equal(
        yield* Effect.promise(() => database.run(f.brain.cancelRun(accepted.runId))),
        LIVE_BRAIN_CANCEL.CANCELLED,
      );
      assert.deepEqual(f.eve.cancelled, [
        [sessionId, FIRST_EVE_TURN],
        [sessionId, FIRST_EVE_TURN],
      ]);
      const stamped = yield* Effect.promise(() =>
        database.run(
          askStanding({ store: database.store, asks: askEffects }, target.userId, accepted.runId),
        ),
      );
      assert.notEqual(stamped?.turn?.cancelRequestedAt ?? null, null);

      yield* Effect.promise(() => play(events.slice(requested), standing));
      yield* f.arrived(5);
      const ended = yield* Effect.promise(() => database.run(f.brain.cancelRun(accepted.runId)));
      // The script runs the turn on to a settled end, which had nothing left to cancel.
      assert.equal(ended, LIVE_BRAIN_CANCEL.NOT_RUNNING);
      assert.equal(f.eve.cancelled.length, 2);
      yield* Effect.promise(() => f.stop());
    }),
);

const CRON_SECRET = "cron-secret-1";

/** What eve's door saw of one request the host's client made: its route, its bearer, the account it named, and its body. */
interface DoorSeen {
  readonly pathname: string;
  readonly authorization: string | null;
  readonly account: string | null;
  readonly body: unknown;
}

/**
 * eve as the deployment reaches it, with the real door in front: the host's
 * own client over an `HttpClient` whose every request walks `ownedAuth` with
 * the deployment actor the production channel composes, over an ownership
 * that attributes the one session and the one conversation to the account
 * the brain stands for. Note that the ownership is answered from the ids
 * rather than read from the rows, because a read would wait on the one
 * PGlite connection the Stop around it is holding; the rows' own reads are
 * held by the access suite. Past the door, the fake answers as eve's routes
 * document: an opening names the session minted for it, a cancel is taken.
 */
async function eveBehindDoor(target: ConversationTarget, sessionId: string) {
  const seen: DoorSeen[] = [];
  const auth: AuthFn<Request> = ownedAuth(
    [deploymentActor({ secret: Redacted.make(CRON_SECRET), admits: DEPLOYMENT_TURNS })],
    {
      sessionOwner: async (id) => (id === sessionId ? target.userId : undefined),
      ownsConversation: async (userId, conversationId) =>
        userId === target.userId && conversationId === target.conversationId,
    },
  );
  const door = fakeHttpClientLayer(async (url, init) => {
    const request = new Request(url, init);
    seen.push({
      pathname: new URL(url).pathname,
      authorization: request.headers.get("authorization"),
      account: request.headers.get(BRAIN_HOST_HEADER.ACCOUNT),
      body: JSON.parse(await request.text()),
    });
    try {
      await auth(request);
    } catch (error) {
      assert.ok(error instanceof ForbiddenError);
      return error.response;
    }
    return Response.json({ ok: true, sessionId, status: "accepted" }, { status: 202 });
  });
  const eve = await database.run(
    Effect.provide(
      eveSessions({
        origin: "https://luke.test",
        caller: { secret: Redacted.make(CRON_SECRET), account: target.userId },
      }),
      door,
    ),
  );
  return { eve, seen };
}

it.live(
  "the Stop reaches eve through its door: a run's cancel is the host's own request under the deployment's secret, admitted for the account's recorded session, so the run is told cancelled",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const sessionId = mintSession();
      const behind = yield* Effect.promise(() => eveBehindDoor(target, sessionId));
      const f = yield* Effect.promise(() =>
        stand(target, QUICK, database.store, target.conversationId, askEffects, behind.eve),
      );
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.equal(yield* Effect.promise(() => sessionOf(target, accepted.runId)), sessionId);
      const standing: RelayStanding = {
        sessionId,
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* f.arrived(1);
      yield* Effect.promise(() =>
        database.run(claimRuntimeSession(target, sessionId, new Date(NOW))),
      );

      assert.equal(
        yield* Effect.promise(() => database.run(f.brain.cancelRun(accepted.runId))),
        LIVE_BRAIN_CANCEL.CANCELLED,
      );
      const cancel = behind.seen.at(-1);
      assert.deepEqual(cancel, {
        pathname: `/eve/v1/session/${sessionId}/cancel`,
        authorization: `Bearer ${CRON_SECRET}`,
        account: target.userId,
        body: { turnId: FIRST_EVE_TURN },
      });
      const stamped = yield* Effect.promise(() =>
        database.run(
          askStanding({ store: database.store, asks: askEffects }, target.userId, accepted.runId),
        ),
      );
      assert.notEqual(stamped?.turn?.cancelRequestedAt ?? null, null);
      yield* Effect.promise(() => f.stop());
    }),
);

/** The one call a planning turn makes, as eve names its input and its result. */
interface PlanningCall {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
}

const SEARCH_WEB_CALL: PlanningCall = {
  toolName: SEARCH_WEB_TOOL.name,
  input: { query: "invite link expiry best practice" },
  output: {
    status: SEARCH_WEB_STATUS.NO_RESULTS,
    reason: SEARCH_WEB_REFUSAL.NO_RESULTS,
    query: "invite link expiry best practice",
  },
};

/** A planning turn as eve streams it: the spoken ask, one call and its result, and the reply. */
function planningTurn(
  turnId: string,
  now: number,
  call: PlanningCall = SEARCH_WEB_CALL,
): readonly MessageStreamEvent[] {
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now);
  const sequence = 0;
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: "q" } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          { kind: "tool-call", callId: "call-1", toolName: call.toolName, input: call.input },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: call.toolName,
          output: call.output,
        },
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "Nothing public settles it. Who can withdraw an invite?",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    stamped({ type: "turn.completed", data: { turnId, sequence } }),
  ];
}

it.live(
  "a planning call's ask lands in its plan's conversation, and a turn that ran a planning tool is followed to its reply rather than told as failed",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const planConversation = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const plan = yield* createPlan(target.userId, PLAN);
            return Option.getOrThrow(yield* openPlanConversation(target.userId, plan.id));
          }),
        ),
      );
      const f = yield* Effect.promise(() => stand(target, QUICK, database.store, planConversation));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(
        f.eve.opened.map((message) => message.conversationId),
        [planConversation],
      );
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() => play(planningTurn(FIRST_EVE_TURN, NOW), standing));
      yield* f.arrived(4);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);

      assert.deepEqual(
        f.events.map((event) => event.kind),
        [
          LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
          LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          LIVE_BRAIN_RUN_EVENT.ENDED,
        ],
      );
      const end = f.events.at(-1);
      assert.equal(
        end?.kind === LIVE_BRAIN_RUN_EVENT.ENDED && end.end,
        LIVE_BRAIN_RUN_END.COMPLETED,
      );
      assert.deepEqual(f.reports, []);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a planning turn's pending repository command is told as its activity once, and its answer as no activity",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const planConversation = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const plan = yield* createPlan(target.userId, PLAN);
            return Option.getOrThrow(yield* openPlanConversation(target.userId, plan.id));
          }),
        ),
      );
      const f = yield* Effect.promise(() => stand(target, QUICK, database.store, planConversation));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = planningTurn(FIRST_EVE_TURN, NOW, {
        toolName: RUN_IN_REPOSITORY_TOOL.name,
        input: { command: "grep -rn invite src" },
        output: { status: REPOSITORY_SHELL_STATUS.NOT_RUN, reason: "No sandbox." },
      });
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* f.active(1);
      // The journal standing still is read again and again, and tells nothing new.
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(f.activities, [
        {
          kind: LIVE_BRAIN_RUN_EVENT.ACTIVITY,
          runId: accepted.runId,
          action: "grep -rn invite src",
        },
      ]);

      yield* Effect.promise(() => play(events.slice(requested), standing));
      yield* f.active(2);
      assert.deepEqual(f.activities.at(-1), {
        kind: LIVE_BRAIN_RUN_EVENT.ACTIVITY,
        runId: accepted.runId,
        action: undefined,
      });
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a planning turn's repository command, once answered, is told as one settled repository read that carries neither the command nor its output",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const planConversation = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const plan = yield* createPlan(target.userId, PLAN);
            return Option.getOrThrow(yield* openPlanConversation(target.userId, plan.id));
          }),
        ),
      );
      const f = yield* Effect.promise(() => stand(target, QUICK, database.store, planConversation));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const events = planningTurn(FIRST_EVE_TURN, NOW, {
        toolName: RUN_IN_REPOSITORY_TOOL.name,
        input: { command: "cat .env" },
        output: { status: REPOSITORY_SHELL_STATUS.NOT_RUN, reason: "No sandbox." },
      });
      const answered = events.findIndex((event) => event.type === "action.result") + 1;
      yield* Effect.promise(() => play(events.slice(0, answered), standing));
      yield* f.stepped(1);
      // The journal standing still is read again and again, and tells no step twice.
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(f.steps, [
        {
          kind: LIVE_BRAIN_RUN_EVENT.STEP_SETTLED,
          runId: accepted.runId,
          step: TURN_SLOW_STEP.REPOSITORY_READ,
          settled: 1,
        },
      ]);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a question the planning model queued reaches the service while its turn still runs, ahead of the reply",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const planConversation = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const plan = yield* createPlan(target.userId, PLAN);
            return Option.getOrThrow(yield* openPlanConversation(target.userId, plan.id));
          }),
        ),
      );
      const f = yield* Effect.promise(() => stand(target, QUICK, database.store, planConversation));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      const queued = { question: "Who can withdraw an invite?", recommendation: "Admins only." };
      const events = planningTurn(FIRST_EVE_TURN, NOW, {
        toolName: QUEUE_QUESTION_TOOL.name,
        input: queued,
        output: { status: "accepted" },
      });
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* f.arrived(1);
      assert.deepEqual(f.events, [
        { kind: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED, runId: accepted.runId, ...queued },
      ]);
      yield* Effect.promise(() => play(events.slice(requested), standing));
      yield* f.arrived(5);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(
        f.events.map((event) => event.kind),
        [
          LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
          LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
          LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
          LIVE_BRAIN_RUN_EVENT.ENDED,
        ],
      );
      yield* Effect.promise(() => f.stop());
    }),
);

/** An instant long enough before the real clock that a turn settled then is no longer news to a re-attach. */
const LONG_AGO = 1_700_000_000_000;

/** A relay whose turns settle long ago, as one a connection lost minutes back would have left. */
const pastRelay = new StreamRelay({
  writer,
  asks: askEffects,
  stopTurn: () => Effect.void,
  now: () => LONG_AGO,
  report: () => undefined,
});

/** The standing a spoken ask's first turn is played under, in the eve session its ask was handed to. */
async function spokenStanding(target: ConversationTarget, askId: string): Promise<RelayStanding> {
  return {
    sessionId: await sessionOf(target, askId),
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
}

it.live(
  "a re-attach takes up a run the lost connection accepted and tells it from the event after the last one told: nothing said before the loss is said again, and a run told to its end is not taken up twice",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const voiceSession = `voice_${randomUUID()}`;
      const lost = yield* Effect.promise(() => stand(target));
      const ask = spokenAsk("q", randomUUID(), voiceSession);
      const accepted = yield* Effect.promise(() => database.run(lost.brain.submitAsk(ask)));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing = yield* Effect.promise(() => spokenStanding(target, accepted.runId));
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* lost.arrived(1);
      yield* Effect.promise(() => lost.stop());
      // The turn finishes while no connection holds the session.
      yield* Effect.promise(() => play(events.slice(requested), standing));

      const back = yield* Effect.promise(() => stand(target));
      const recovery = yield* Effect.promise(() =>
        database.run(back.brain.recoverRuns(voiceSession)),
      );
      assert.equal(recovery.revision, ask.revision);
      assert.deepEqual(recovery.runs, [
        {
          runId: accepted.runId,
          delegationId: ask.submissionId,
          revision: ask.revision,
          stopped: false,
          stale: false,
        },
      ]);
      yield* Effect.promise(() => database.run(recovery.follow));
      yield* back.arrived(4);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);
      assert.deepEqual(
        back.events.map((event) => [event.kind, event.runId]),
        [
          [LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, accepted.runId],
          [LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, accepted.runId],
          [LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, accepted.runId],
          [LIVE_BRAIN_RUN_EVENT.ENDED, accepted.runId],
        ],
      );
      yield* Effect.promise(() => back.stop());

      const again = yield* Effect.promise(() => stand(target));
      const settled = yield* Effect.promise(() =>
        database.run(again.brain.recoverRuns(voiceSession)),
      );
      assert.deepEqual([settled.revision, settled.runs], [ask.revision, []]);
      assert.deepEqual(back.reports, []);
      yield* Effect.promise(() => again.stop());
    }),
);

it.live(
  "a re-attach reads back the session's newest revision and each run's own, a run the developer stopped as stopped, and a reply that settled long ago as stale",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const voiceSession = `voice_${randomUUID()}`;
      const lost = yield* Effect.promise(() => stand(target));
      const old = spokenAsk("q1", randomUUID(), voiceSession);
      const stopped = spokenAsk("q2", randomUUID(), voiceSession);
      const elsewhere = spokenAsk("q3");
      const first = yield* Effect.promise(() => database.run(lost.brain.submitAsk(old)));
      assert.equal(first.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (first.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      // The first ask's turn settles long ago, untold, since its follow is gone with the connection.
      const standing = yield* Effect.promise(() => spokenStanding(target, first.runId));
      yield* Effect.promise(() => lost.stop());
      for (const event of spokenTurn(FIRST_EVE_TURN, LONG_AGO)) {
        yield* Effect.promise(() => database.run(pastRelay.handle(event, standing)));
      }
      const holding = yield* Effect.promise(() => stand(target));
      const second = yield* Effect.promise(() => database.run(holding.brain.submitAsk(stopped)));
      const third = yield* Effect.promise(() => database.run(holding.brain.submitAsk(elsewhere)));
      assert.equal(second.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      assert.equal(third.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (second.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.equal(
        yield* Effect.promise(() => database.run(holding.brain.cancelRun(second.runId))),
        LIVE_BRAIN_CANCEL.CANCELLED,
      );
      yield* Effect.promise(() => holding.stop());

      const back = yield* Effect.promise(() => stand(target));
      const recovery = yield* Effect.promise(() =>
        database.run(back.brain.recoverRuns(voiceSession)),
      );
      assert.equal(recovery.revision, stopped.revision);
      assert.deepEqual(recovery.runs, [
        {
          runId: first.runId,
          delegationId: old.submissionId,
          revision: old.revision,
          stopped: false,
          stale: true,
        },
        {
          runId: second.runId,
          delegationId: stopped.submissionId,
          revision: stopped.revision,
          stopped: true,
          stale: false,
        },
      ]);
      yield* Effect.promise(() => back.stop());
    }),
);

/**
 * The follow's cadence on the `TestClock`: a poll a minute, so a bound of
 * minutes is crossed in tens of looks at the store rather than thousands,
 * under the production bounds themselves. The number of polls to a bound is
 * the bound in polls.
 */
const POLL = Duration.minutes(1);
const POLLS_TO_FOLLOW_BOUND =
  Duration.toMillis(LIVE_BRAIN_FOLLOW_BOUNDS.FOLLOW) / Duration.toMillis(POLL);
const POLLS_TO_PARKED_BOUND =
  Duration.toMillis(LIVE_BRAIN_FOLLOW_BOUNDS.PARKED_FOLLOW) / Duration.toMillis(POLL);

interface ClockStand extends Stand {
  /** Moves the clock one poll at a time, `count` times, waiting out the one look each poll fires. */
  readonly polls: (count: number) => Effect.Effect<void>;
  /** How many looks have begun: counted as the look's first read is asked for, before the store answers it. */
  readonly looks: () => number;
  /** Lets the first look through: held until the test has played the turn, so every look finds it and reads its journal. */
  readonly release: Effect.Effect<void>;
}

/**
 * The brain on the test's own clock, under the production bounds: built on
 * the test fiber rather than the store runtime, so every follow it forks
 * keeps time on the `TestClock` and a bound of minutes is reached by
 * adjusting it. The record is still the real store on PGlite, whose reads
 * are promises, so looks are sequenced against the clock rather than
 * waited out. The clock moves one poll at a time (`polls`): an adjust runs
 * the one follow it wakes up to its first read before it answers, so
 * `looks` says whether a look began, and the poll is waited out on the
 * look's read of the journal, its last, after which what the look tells is
 * told before the test resumes. The first look, which runs as the ask is
 * accepted, is held at `release` so it finds the turn the test has played
 * by then and every look reads the journal.
 */
const standOnTestClock = Effect.fnUntraced(function* (target: ConversationTarget) {
  const eve = fakeEve();
  const reports: string[] = [];
  const gate = yield* Deferred.make<void>();
  let looks = 0;
  let journals = 0;
  const journalListeners = new Set<() => void>();
  const store: HostedLiveBrainOptions["store"] = {
    turns: {
      named: (userId, turnIds) =>
        Effect.suspend(() => {
          looks += 1;
          return Effect.andThen(Deferred.await(gate), database.store.turns.named(userId, turnIds));
        }),
    },
    messages: {
      byClientId: (userId, conversationId, tools, clientId) =>
        database.store.messages.byClientId(userId, conversationId, tools, clientId).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              journals += 1;
              for (const listener of [...journalListeners]) listener();
            }),
          ),
        ),
    },
  };
  const scope = yield* Scope.make();
  const brain = yield* Scope.provide(
    hostedLiveBrain({
      userId: target.userId,
      conversationId: target.conversationId,
      asks: { asks: askEffects, eve },
      store,
      writer,
      report: (message) => reports.push(message),
      bounds: { POLL },
    }),
    scope,
  ).pipe(Effect.provide(database.sql));
  const journaled = (count: number) =>
    arrival(
      (notify) => {
        journalListeners.add(notify);
        return () => journalListeners.delete(notify);
      },
      () => journals >= count,
      `${count} journal reads`,
    );
  const polls = (count: number) =>
    Effect.gen(function* () {
      for (let poll = 0; poll < count; poll += 1) {
        const [began, read] = [looks, journals];
        yield* TestClock.adjust(POLL);
        assert.ok(looks > began, `no look began on poll ${poll + 1}: the follow has ended`);
        yield* journaled(read + 1);
      }
    });
  const stand: ClockStand = {
    ...listening(brain),
    eve,
    brain,
    reports,
    polls,
    looks: () => looks,
    release: Deferred.succeed(gate, undefined),
    stop: () => database.run(Scope.close(scope, Exit.void)),
  };
  return stand;
});

/** A turn parked on the worker's task, played up to the park and found by the follow: the words before the wait are told. */
const parkedOnTask = Effect.fnUntraced(function* (target: ConversationTarget, f: ClockStand) {
  const accepted = yield* f.brain.submitAsk(spokenAsk("q"));
  assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
  if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return assert.fail("not accepted");
  const standing: RelayStanding = {
    sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
  yield* Effect.promise(() => play(parkedTurn(FIRST_EVE_TURN, 0, NOW), standing));
  yield* f.release;
  yield* f.arrived(2);
  assert.deepEqual(
    f.events.map((event) =>
      event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE ? event.sentence : event.kind,
    ),
    [LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, "The worker is on it."],
  );
  return { runId: accepted.runId, standing };
});

/** The follow's word on a look past the plain bound, as the events and reports show it. */
function toldSoFar(f: ClockStand): readonly string[] {
  return f.events.map((event) =>
    event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE
      ? event.sentence
      : event.kind === LIVE_BRAIN_RUN_EVENT.ENDED
        ? `${event.kind}:${event.end}`
        : event.kind,
  );
}

it.effect(
  "a turn parked on the worker's task is followed past the plain bound, and the findings that land after it are spoken",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* standOnTestClock(target);
      const { standing } = yield* parkedOnTask(target, f);

      // The worker runs past the plain bound with the turn still parked.
      yield* f.polls(POLLS_TO_FOLLOW_BOUND + 1);
      assert.deepEqual(toldSoFar(f), [
        LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        "The worker is on it.",
      ]);
      assert.deepEqual(f.reports, []);

      yield* Effect.promise(() => play(resumedTurn(FIRST_EVE_TURN, 0, 2, NOW), standing));
      yield* f.polls(1);
      yield* f.arrived(4);
      assert.deepEqual(toldSoFar(f), [
        LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED,
        "The worker is on it.",
        "Found it.",
        `${LIVE_BRAIN_RUN_EVENT.ENDED}:${LIVE_BRAIN_RUN_END.COMPLETED}`,
      ]);
      assert.deepEqual(f.reports, []);

      // The end ends the follow: a later poll finds no look.
      const looked = f.looks();
      yield* TestClock.adjust(Duration.times(POLL, 3));
      assert.equal(f.looks(), looked);
      yield* Effect.promise(() => f.stop());
    }),
);

it.effect(
  "the parked bound is a ceiling: a turn still parked past it is told as failed, once, and the bound is reported",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* standOnTestClock(target);
      yield* parkedOnTask(target, f);

      // One poll short of the parked bound the turn is still followed; the poll at it gives up.
      yield* f.polls(POLLS_TO_PARKED_BOUND - 1);
      assert.equal(f.events.length, 2);
      assert.deepEqual(f.reports, []);
      yield* f.polls(1);
      assert.deepEqual(toldSoFar(f).slice(2), [
        `${LIVE_BRAIN_RUN_EVENT.ENDED}:${LIVE_BRAIN_RUN_END.FAILED}`,
      ]);
      assert.equal(f.reports.length, 1);

      const looked = f.looks();
      yield* TestClock.adjust(Duration.times(POLL, 3));
      assert.equal(f.looks(), looked);
      assert.equal(f.events.length, 3);
      yield* Effect.promise(() => f.stop());
    }),
);

it.effect(
  "a Stop on a parked turn ends the follow as eve cancels it: the cancelled end is told and no look follows",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* standOnTestClock(target);
      const { runId, standing } = yield* parkedOnTask(target, f);
      yield* f.polls(1);

      // eve's store hook records the session on the conversation as it starts, which is what a Stop reads.
      yield* Effect.promise(() =>
        database.run(claimRuntimeSession(target, standing.sessionId, new Date(NOW))),
      );
      assert.equal(yield* f.brain.cancelRun(runId), LIVE_BRAIN_CANCEL.CANCELLED);
      assert.deepEqual(f.eve.cancelled, [[standing.sessionId, FIRST_EVE_TURN]]);
      yield* Effect.promise(() =>
        play(
          [
            stampedEveEvent(
              { type: "turn.cancelled", data: { turnId: FIRST_EVE_TURN, sequence: 0 } },
              NOW,
            ),
          ],
          standing,
        ),
      );
      yield* f.polls(1);
      yield* f.arrived(3);
      assert.deepEqual(toldSoFar(f).slice(2), [
        `${LIVE_BRAIN_RUN_EVENT.ENDED}:${LIVE_BRAIN_RUN_END.CANCELLED}`,
      ]);

      const looked = f.looks();
      yield* TestClock.adjust(Duration.times(POLL, 3));
      assert.equal(f.looks(), looked);
      assert.equal(f.events.length, 3);
      yield* Effect.promise(() => f.stop());
    }),
);

it.effect(
  "the call ending ends the follow of a parked turn: findings that land after the socket's scope closed reach no listener",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* standOnTestClock(target);
      const { standing } = yield* parkedOnTask(target, f);
      yield* f.polls(1);

      yield* Effect.promise(() => f.stop());
      yield* Effect.promise(() => play(resumedTurn(FIRST_EVE_TURN, 0, 2, NOW), standing));
      const looked = f.looks();
      yield* TestClock.adjust(Duration.times(POLL, 3));
      assert.equal(f.looks(), looked);
      assert.equal(f.events.length, 2);
      assert.deepEqual(f.reports, []);
    }),
);
