import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { askRecord } from "@sidecar/database/models/asks";
import { childConversationId } from "@sidecar/database/models/ids";
import { openPlanConversation } from "@sidecar/database/models/plan-store";
import { claimRuntimeSession } from "@sidecar/database/models/recorded-session";
import { type ConversationTarget, storeWriter } from "@sidecar/database/models/writer";
import type { PlanWorkTurn } from "@sidecar/hosted/planning-view";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainAsk,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { arrival } from "@sidecar/voice/testing";
import { isRecord } from "@sidecar/wire";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Deferred, Duration, Effect, Exit, Layer, Option, Redacted, Scope } from "effect";
import { TestClock } from "effect/testing";
import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { ASK_ORIGIN, TURN_SLOW_STEP } from "../server/core";
import { askStanding } from "../server/hosted/brain-ask";
import { DEPLOYMENT_PRESENCE, deploymentActor } from "../server/hosted/brain-host/auth";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN, RELAY_TURN } from "../server/hosted/brain-host/bounds";
import { DEPLOYMENT_TURNS } from "../server/hosted/brain-host/channel";
import { openChildConversation } from "../server/hosted/brain-host/conversation";
import { ownedAuth } from "../server/hosted/brain-host/door";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  eveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import {
  memoryRelayState,
  type RelayStanding,
  StreamRelay,
} from "../server/hosted/brain-host/relay";
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import {
  SEARCH_WEB_REFUSAL,
  SEARCH_WEB_STATUS,
  SEARCH_WEB_TOOL,
} from "../server/hosted/public-research";
import {
  type HostedLiveBrain,
  type HostedLiveBrainOptions,
  hostedLiveBrain,
} from "../server/voice/live-brain";
import { stampedEveEvent } from "./support/eve-events";
import { FIRST_EVE_TURN, parkedTurn, spokenTurn } from "./support/eve-turns";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation } from "./support/store-rows";
import { joinWorkspace, startPlan } from "./support/workspaces";

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
  asks: { binding: askEffects, stopTurn: () => Effect.void },
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
    reset() {
      return Effect.die(new Error("this suite retires no session"));
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
        accountId: target.userId,
        conversation: { userId: target.userId, conversationId },
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
    [
      deploymentActor({
        secret: Redacted.make(CRON_SECRET),
        admits: DEPLOYMENT_TURNS,
        presents: DEPLOYMENT_PRESENCE.DEPLOYMENT,
      }),
    ],
    {
      reachesSession: async (userId, id) => userId === target.userId && id === sessionId,
      reachesConversation: async (userId, conversationId) =>
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
            const plan = yield* startPlan(target.userId, PLAN);
            return Option.getOrThrow(yield* openPlanConversation(target.userId, plan.id))
              .conversationId;
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
const standOnTestClock = Effect.fnUntraced(function* (
  target: ConversationTarget,
  accountId: string = target.userId,
) {
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
      ...database.store.messages,
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
  // The client lives as long as the socket's scope: built around the brain alone, a
  // Postgres pool would close as the brain stood, and every follow's read refused.
  const sql = yield* Scope.provide(Layer.build(database.sql), scope);
  const brain = yield* Scope.provide(
    hostedLiveBrain({
      accountId,
      conversation: target,
      asks: { asks: askEffects, eve },
      store,
      writer,
      report: (message) => reports.push(message),
      bounds: { POLL },
    }),
    scope,
  ).pipe(Effect.provide(sql));
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

async function workerRan(target: ConversationTarget, callId: string): Promise<void> {
  const child = {
    userId: target.userId,
    conversationId: childConversationId(target.conversationId, callId),
  };
  await database.run(openChildConversation(target, child.conversationId, "worker"));
  await play(
    [
      stampedEveEvent({ type: "turn.started", data: { turnId: FIRST_EVE_TURN, sequence: 0 } }, NOW),
      stampedEveEvent(
        {
          type: "message.received",
          data: { turnId: FIRST_EVE_TURN, sequence: 0, message: "Compare the queues." },
        },
        NOW,
      ),
      stampedEveEvent(
        {
          type: "step.started",
          data: { turnId: FIRST_EVE_TURN, sequence: 0, stepIndex: 0, modelId: "m" },
        },
        NOW,
      ),
      stampedEveEvent(
        {
          type: "message.completed",
          data: {
            turnId: FIRST_EVE_TURN,
            sequence: 0,
            stepIndex: 0,
            finishReason: "stop",
            message: "Queue A lets an admin revoke.",
          },
        },
        NOW,
      ),
    ],
    {
      sessionId: `wrun_${randomUUID()}`,
      target: child,
      turn: RELAY_TURN.CHILD,
      model: "scripted-model",
      state: memoryRelayState(),
    },
  );
}

/** The follow's word on a look past the plain bound, as the events and reports show it. */

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

const POLL = Duration.minutes(1);

it.effect(
  "a member following a turn in the plan conversation a teammate opened is shown the worker's session and the model it ran on, read under the teammate who opened it",
  () =>
    Effect.gen(function* () {
      const opener = yield* Effect.promise(() => database.createUser());
      const member = yield* Effect.promise(() => database.createUser());
      const target = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const plan = yield* startPlan(opener, PLAN);
            yield* joinWorkspace(plan.workspaceId, member);
            const opened = Option.getOrThrow(yield* openPlanConversation(opener, plan.id));
            return { userId: opener, conversationId: opened.conversationId };
          }),
        ),
      );
      const f = yield* standOnTestClock(target, member);
      const shown: PlanWorkTurn[] = [];
      f.brain.onWork((work) => shown.push(work));
      yield* parkedOnTask(target, f);
      const worker = shown.at(-1)?.workers[0];
      assert.ok(worker !== undefined);
      yield* Effect.promise(() => workerRan(target, worker.callId));
      yield* f.polls(2);

      const drawn = shown.at(-1)?.workers[0];
      assert.ok(drawn !== undefined);
      const said = drawn.journal.at(-1);
      assert.equal(isRecord(said) ? said.text : undefined, "Queue A lets an admin revoke.");
      assert.equal(drawn.model, "openai/scripted-model", "the model its turn ran on");
      yield* Effect.promise(() => f.stop());
    }),
);
