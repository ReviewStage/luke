import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@luke/database/core/live-statement";
import { askRecord } from "@luke/database/models/asks";
import { childConversationId } from "@luke/database/models/ids";
import { claimRuntimeSession } from "@luke/database/models/recorded-session";
import { openTaskConversation } from "@luke/database/models/task-store";
import { type ConversationTarget, storeWriter } from "@luke/database/models/writer";
import {
  insertConversation,
  joinWorkspace,
  openHostedStoreTestDatabase,
  startTask,
} from "@luke/database/testing";
import type { TaskWorkTurn } from "@luke/features/tasks-view";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainAsk,
  type LiveBrainRunEvent,
} from "@luke/voice/live-session";
import { arrival } from "@luke/voice/testing";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Queue,
  Redacted,
  Scope,
  Stream,
} from "effect";
import { SqlError, UnknownError } from "effect/sql/SqlError";
import { type AuthFn, ForbiddenError } from "eve/channels/auth";
import type { MessageStreamEvent } from "eve/client";
import { afterAll } from "vitest";
import { DEPLOYMENT_PRESENCE, deploymentActor } from "../agents/brain-host/auth.js";
import { BRAIN_HOST_HEADER, BRAIN_HOST_TURN, RELAY_TURN } from "../agents/brain-host/bounds.js";
import { BRAIN_DELEGATE_TOOL, BRAIN_EXPLORE_ASK } from "../agents/brain-host/brain.js";
import { askStanding } from "../agents/brain-host/brain-ask.js";
import { DEPLOYMENT_TURNS } from "../agents/brain-host/channel.js";
import { openChildConversation } from "../agents/brain-host/conversation.js";
import { ownedAuth } from "../agents/brain-host/door.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
  eveSessions,
} from "../agents/brain-host/eve-sessions.js";
import { memoryRelayState, type RelayStanding, StreamRelay } from "../agents/brain-host/relay.js";
import {
  SEARCH_WEB_REFUSAL,
  SEARCH_WEB_STATUS,
  SEARCH_WEB_TOOL,
} from "../agents/public-research.js";
import { ASK_ORIGIN, TURN_SLOW_STEP } from "../core.js";
import { LiveWake } from "../live/live-wake.js";
import { HOSTED_TOOL_SET } from "../tasks/brain-tool-set.js";
import { QUEUE_QUESTION_TOOL, WITHDRAW_QUESTION_TOOL } from "../tasks/queue-question.js";
import { stampedEveEvent } from "../testing/eve-events.js";
import { FIRST_EVE_TURN, spokenTurn } from "../testing/eve-turns.js";
import { tickingLiveWake } from "../testing/live-wake.js";
import { type RecordingSentry, recordingSentry, sentOfType } from "../testing/sentry-transport.js";
import {
  type HostedLiveBrain,
  type HostedLiveBrainOptions,
  hostedLiveBrain,
} from "./live-brain.js";

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

/** A task the account starts, as the Tasks tab's new-task form saves one. */
const TASK = {
  name: "Teammate invitations",
} as const;
/**
 * How often the follow's watch hears a change: Realtime is scripted to hear
 * one every few milliseconds, as it would each write the turn makes, with
 * the bound left wide: a turn's events land through the store, and the
 * store on CI is one Postgres shared with every other job, so a bound
 * measured in milliseconds against it would expire under load before the
 * turn's first event arrives.
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
const QUICK = { FOLLOW: Duration.minutes(1) };

/** The conversation's mark as the exchange hands the brain it, by its shape alone: what a follow's watch is asked for. */
const MARK: LiveStatement = { sql: "select mark", params: [] };

// The relay's writer holds rows to the hosted set, as production's does, so a brain turn's research call is written.
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
    stream: () => Stream.empty,
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
  /** Sentry's reporter where the stand records Sentry, for a submission's own fiber, as the voice service's runtime provides it; empty otherwise. */
  readonly reporting: Context.Context<never>;
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
  accountId: string = target.userId,
  wake: Layer.Layer<never> = tickingLiveWake(Duration.millis(POLL_MS)),
  sentry?: RecordingSentry,
): Promise<Stand> {
  const eve = fakeEve();
  const reports: string[] = [];
  const scope = await database.run(Scope.make());
  // Note that Sentry is built into the socket's scope ahead of the brain, so it is closed, and what it holds sent, after every fiber of the brain has ended.
  const reporting = await database.run(
    sentry === undefined
      ? Effect.succeed(Context.empty())
      : Layer.buildWithScope(sentry.layer, scope),
  );
  const brain = await database.run(
    Scope.provide(
      hostedLiveBrain({
        accountId,
        conversation: { userId: target.userId, conversationId },
        asks: { asks: record, eve: over ?? eve },
        store,
        writer,
        report: (message) => reports.push(message),
        live: [MARK],
        bounds,
      }).pipe(Effect.provide(wake)),
      scope,
    ).pipe(Effect.provideContext(reporting)),
  );
  return {
    ...listening(brain),
    eve,
    brain,
    reports,
    reporting,
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
  "a turn's events reach the service while the write of how far it was told is stalled, and the ask's row catches up in order once the store answers",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const stalled = yield* Deferred.make<void>();
      const record: HostedLiveBrainOptions["asks"]["asks"] = {
        ...askEffects,
        told: (id, told) => Effect.andThen(Deferred.await(stalled), askEffects.told(id, told)),
      };
      const f = yield* Effect.promise(() =>
        stand(target, QUICK, database.store, target.conversationId, record),
      );
      const ask = spokenAsk("q");
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(ask)));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() => play(spokenTurn(FIRST_EVE_TURN, NOW), standing));
      // Every event, the end included, reached the service with no telling written yet.
      yield* f.arrived(5);
      const toldOf = () =>
        database.run(askEffects.spokenIn(target.userId, ask.sessionId)).then((rows) => rows[0]);
      const before = yield* Effect.promise(toldOf);
      assert.deepEqual([before?.toldSeq, before?.endToldAt], [0, undefined]);
      yield* Deferred.succeed(stalled, undefined);
      let after = before;
      for (let look = 0; look < 200 && after?.endToldAt === undefined; look += 1) {
        yield* Effect.sleep(POLL_MS);
        after = yield* Effect.promise(toldOf);
      }
      assert.ok(after?.endToldAt);
      assert.ok((after?.toldSeq ?? 0) > 0);
      assert.deepEqual(f.reports, []);
      yield* Effect.promise(() => f.stop());
    }),
);

it.live(
  "a follow watches the conversation's mark, and a turn's sentences and end reach the service once Realtime says it moved",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const moved = yield* Queue.unbounded<void>();
      const watched: (readonly LiveStatement[])[] = [];
      const marked = Layer.succeed(LiveWake, {
        watch: (statements) =>
          Effect.sync(() => {
            watched.push(statements);
            return { changed: Queue.take(moved) };
          }),
      });
      const f = yield* Effect.promise(() =>
        stand(
          target,
          QUICK,
          database.store,
          target.conversationId,
          askEffects,
          undefined,
          target.userId,
          marked,
        ),
      );
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
      // The follow watches the mark and makes its first read of a turn not yet begun.
      for (let look = 0; look < 200 && watched.length === 0; look += 1)
        yield* Effect.sleep(POLL_MS);
      assert.deepEqual(watched, [[MARK]]);
      const standing: RelayStanding = {
        sessionId,
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() => play(spokenTurn(FIRST_EVE_TURN, NOW), standing));
      // Note that nothing is asserted of the time before the mark moves, since the wait's safety beat may look on a slow store.
      yield* Queue.offer(moved, undefined);
      yield* f.arrived(5);
      assert.equal(f.events.at(-1)?.kind, LIVE_BRAIN_RUN_EVENT.ENDED);
      yield* Effect.promise(() => f.stop());
    }),
);

/** A spoken ask submitted on a fiber that carries the stand's Sentry reporter, as the voice service's own fibers carry the runtime's. */
function reported(f: Stand, ask: LiveBrainAsk) {
  return Effect.provideContext(f.brain.submitAsk(ask), f.reporting);
}

/** The type of each error event Sentry would have received, as the error it was captured from; Sentry lists that error's causes ahead of it. */
function exceptionTypes(sentry: RecordingSentry): string[] {
  return sentOfType(sentry.sent, "event").map(
    (item) => item.payload.exception?.values.at(-1)?.type ?? "",
  );
}

it.live(
  "a follow whose read of the turn fails is told failed as before and reported to Sentry once",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const sentry = recordingSentry();
      const unreadable: HostedLiveBrainOptions["store"] = {
        ...database.store,
        turns: {
          named: () =>
            Effect.fail(
              new SqlError({
                reason: new UnknownError({
                  cause: new Error("the turn row could not be read"),
                  message: "The store refused the read",
                }),
              }),
            ),
        },
      };
      const f = yield* Effect.promise(() =>
        stand(
          target,
          QUICK,
          unreadable,
          target.conversationId,
          askEffects,
          undefined,
          target.userId,
          undefined,
          sentry,
        ),
      );
      const accepted = yield* Effect.promise(() => database.run(reported(f, spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* f.arrived(1);
      yield* Effect.promise(() => f.stop());

      const end = f.events.at(-1);
      assert.equal(end?.kind === LIVE_BRAIN_RUN_EVENT.ENDED && end.end, LIVE_BRAIN_RUN_END.FAILED);
      assert.equal(f.reports.length, 1);
      assert.match(f.reports[0] ?? "", /^Following a spoken ask failed/);
      assert.deepEqual(exceptionTypes(sentry), ["effect/sql/SqlError"]);
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

/** The one call a brain turn makes, as eve names its input and its result. */
interface BrainCall {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
}

const SEARCH_WEB_CALL: BrainCall = {
  toolName: SEARCH_WEB_TOOL.name,
  input: { query: "invite link expiry best practice" },
  output: {
    status: SEARCH_WEB_STATUS.NO_RESULTS,
    reason: SEARCH_WEB_REFUSAL.NO_RESULTS,
    query: "invite link expiry best practice",
  },
};

/** A brain turn as eve streams it: the spoken ask, one call and its result, and the reply. */
function brainTurn(
  turnId: string,
  now: number,
  call: BrainCall = SEARCH_WEB_CALL,
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
      const taskConversation = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const task = yield* startTask(target.userId, TASK);
            return Option.getOrThrow(yield* openTaskConversation(target.userId, task.id))
              .conversationId;
          }),
        ),
      );
      const f = yield* Effect.promise(() => stand(target, QUICK, database.store, taskConversation));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(
        f.eve.opened.map((message) => message.conversationId),
        [taskConversation],
      );
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: taskConversation },
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() => play(brainTurn(FIRST_EVE_TURN, NOW), standing));
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
  "a member following a turn in the plan conversation a teammate opened is shown the model its worker ran on, read under the teammate who opened it",
  () =>
    Effect.gen(function* () {
      const opener = yield* Effect.promise(() => database.createUser());
      const member = yield* Effect.promise(() => database.createUser());
      const target = yield* Effect.promise(() =>
        database.run(
          Effect.gen(function* () {
            const task = yield* startTask(opener, TASK);
            yield* joinWorkspace(task.workspaceId, member);
            const opened = Option.getOrThrow(yield* openTaskConversation(opener, task.id));
            return { userId: opener, conversationId: opened.conversationId };
          }),
        ),
      );
      // The worker's own session, started by the turn's call, ran a turn on the scripted model.
      const child = {
        userId: opener,
        conversationId: childConversationId(target.conversationId, "call-1"),
      };
      yield* Effect.promise(() =>
        database.run(openChildConversation(target, child.conversationId, "worker")),
      );
      const f = yield* Effect.promise(() =>
        stand(target, QUICK, database.store, target.conversationId, askEffects, undefined, member),
      );
      const shown: TaskWorkTurn[] = [];
      f.brain.onWork((work) => shown.push(work));
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(spokenAsk("q"))));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
      yield* Effect.promise(() =>
        play(spokenTurn(FIRST_EVE_TURN, NOW), {
          sessionId: `${sessionId}-worker`,
          target: child,
          turn: RELAY_TURN.CHILD,
          model: "scripted-model",
          state: memoryRelayState(),
        }),
      );
      const events = brainTurn(FIRST_EVE_TURN, NOW, {
        toolName: BRAIN_DELEGATE_TOOL.name,
        input: { task: "Compare the two queue libraries." },
        output: "Started task delegate-7k2m9q. Its result will arrive in a <task_result> message.",
      });
      const standing: RelayStanding = {
        sessionId,
        target,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      // A look finds the worker's call while the turn runs, so the next look reads its session.
      const answered = events.findIndex((event) => event.type === "action.result") + 1;
      yield* Effect.promise(() => play(events.slice(0, answered), standing));
      yield* arrival(
        (notify) => f.brain.onWork(notify),
        () => shown.some((work) => work.workers.length > 0),
        "the worker's call shown",
      );
      yield* Effect.promise(() => play(events.slice(answered), standing));
      yield* f.arrived(4);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);

      const [worker] = shown.at(-1)?.workers ?? [];
      assert.equal(worker?.callId, "call-1");
      assert.equal(worker?.model, "openai/scripted-model", "the model the worker's turn ran on");
      yield* Effect.promise(() => f.stop());
    }),
);

/** The relay's standing for an accepted ask's turn, as eve would stream it. */
async function turnStanding(target: ConversationTarget, askId: string): Promise<RelayStanding> {
  return {
    sessionId: await sessionOf(target, askId),
    target,
    turn: BRAIN_HOST_TURN.SPOKEN,
    model: "scripted-model",
    state: memoryRelayState(),
  };
}

it.live(
  "a plan's first call sets the backend exploring once, and a call back explores nothing again",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const first = yield* Effect.promise(() => stand(target));
      const joined = yield* Effect.promise(() =>
        database.run(first.brain.join(`voice_${randomUUID()}`)),
      );
      assert.equal(joined.joined, false);
      assert.equal(joined.runs.length, 1);
      assert.deepEqual(
        first.eve.opened.map((message) => message.message),
        [BRAIN_EXPLORE_ASK],
      );
      yield* Effect.promise(() => first.stop());

      const back = yield* Effect.promise(() => stand(target));
      const rejoined = yield* Effect.promise(() =>
        database.run(back.brain.join(`voice_${randomUUID()}`)),
      );
      assert.equal(rejoined.joined, true);
      assert.deepEqual(back.eve.opened, []);
      assert.deepEqual(back.eve.delivered, []);
      yield* Effect.promise(() => back.stop());
    }),
);

it.live(
  "hung up mid-turn, Luke's turn goes on: a call back is handed what he said with no call up, follows the turn from there without saying it again, and the call after finds nothing left",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const first = yield* Effect.promise(() => stand(target));
      const accepted = yield* Effect.promise(() =>
        database.run(first.brain.submitAsk(spokenAsk("q"))),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing = yield* Effect.promise(() => turnStanding(target, accepted.runId));
      const events = spokenTurn(FIRST_EVE_TURN, NOW);
      const requested = events.findIndex((event) => event.type === "actions.requested") + 1;
      const answered = events.findIndex((event) => event.type === "message.completed") + 1;
      yield* Effect.promise(() => play(events.slice(0, requested), standing));
      yield* first.arrived(1);
      // The developer hangs up: the socket's scope closes and nothing follows the turn.
      yield* Effect.promise(() => first.stop());
      // With no call up, the turn answers.
      yield* Effect.promise(() => play(events.slice(requested, answered), standing));

      const back = yield* Effect.promise(() => stand(target));
      const joined = yield* Effect.promise(() =>
        database.run(back.brain.join(`voice_${randomUUID()}`)),
      );
      assert.equal(joined.joined, true);
      assert.deepEqual(joined.runs, [accepted.runId]);
      assert.equal(joined.missed, "One agent finished. Another is waiting on you.");
      assert.deepEqual(back.eve.opened, []);
      yield* Effect.promise(() => database.run(joined.follow));
      yield* Effect.promise(() => play(events.slice(answered), standing));
      yield* arrival(
        (notify) => back.brain.onRunEvent(notify),
        () => back.events.some((event) => event.kind === LIVE_BRAIN_RUN_EVENT.ENDED),
        "the joined turn's end",
      );
      // What the catch-up carried is not told again as the turn's own sentences.
      assert.deepEqual(
        back.events.filter((event) => event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE),
        [],
      );
      assert.deepEqual(new Set(back.events.map((event) => event.runId)), new Set([accepted.runId]));
      yield* Effect.promise(() => back.stop());

      const after = yield* Effect.promise(() => stand(target));
      const nothing = yield* Effect.promise(() =>
        database.run(after.brain.join(`voice_${randomUUID()}`)),
      );
      assert.deepEqual([nothing.runs, nothing.missed], [[], undefined]);
      yield* Effect.promise(() => after.stop());
    }),
);

it.live(
  "a turn that finished while no call was up is caught up on once and never followed, and an ask the developer stopped is left alone",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const first = yield* Effect.promise(() => stand(target));
      const finished = yield* Effect.promise(() =>
        database.run(first.brain.submitAsk(spokenAsk("q"))),
      );
      assert.equal(finished.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (finished.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const stopped = yield* Effect.promise(() =>
        database.run(first.brain.submitAsk(spokenAsk("q2"))),
      );
      assert.equal(stopped.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (stopped.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* Effect.promise(() => database.run(first.brain.cancelRun(stopped.runId)));
      yield* Effect.promise(() => first.stop());
      const standing = yield* Effect.promise(() => turnStanding(target, finished.runId));
      yield* Effect.promise(() => play(spokenTurn(FIRST_EVE_TURN, NOW), standing));

      const back = yield* Effect.promise(() => stand(target));
      const joined = yield* Effect.promise(() =>
        database.run(back.brain.join(`voice_${randomUUID()}`)),
      );
      assert.deepEqual(joined.runs, []);
      assert.equal(joined.missed, "One agent finished. Another is waiting on you.");
      yield* Effect.promise(() => database.run(joined.follow));
      yield* Effect.promise(() => back.stop());

      const after = yield* Effect.promise(() => stand(target));
      const nothing = yield* Effect.promise(() =>
        database.run(after.brain.join(`voice_${randomUUID()}`)),
      );
      assert.deepEqual([nothing.runs, nothing.missed], [[], undefined]);
      yield* Effect.promise(() => after.stop());
    }),
);

it.live(
  "a call back for another account over the plan's conversation takes up none of its work and sets nothing off",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const first = yield* Effect.promise(() => stand(target));
      const accepted = yield* Effect.promise(() =>
        database.run(first.brain.submitAsk(spokenAsk("q"))),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      yield* Effect.promise(() => first.stop());

      const stranger = yield* Effect.promise(() => account());
      const intruder = yield* Effect.promise(() =>
        stand(stranger, QUICK, database.store, target.conversationId),
      );
      const joined = yield* Effect.promise(() =>
        database.run(intruder.brain.join(`voice_${randomUUID()}`)),
      );
      assert.deepEqual([joined.runs, joined.missed], [[], undefined]);
      assert.deepEqual(intruder.eve.opened, []);
      yield* Effect.promise(() => intruder.stop());
    }),
);

it.live(
  "a call back that goes before it hands its catch-up over counts nothing heard, so the next call is handed the same",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const first = yield* Effect.promise(() => stand(target));
      const accepted = yield* Effect.promise(() =>
        database.run(first.brain.submitAsk(spokenAsk("q"))),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* Effect.promise(() => first.stop());
      const standing = yield* Effect.promise(() => turnStanding(target, accepted.runId));
      yield* Effect.promise(() => play(spokenTurn(FIRST_EVE_TURN, NOW), standing));

      // The call joins, then goes before its follow runs.
      const gone = yield* Effect.promise(() => stand(target));
      const unheard = yield* Effect.promise(() =>
        database.run(gone.brain.join(`voice_${randomUUID()}`)),
      );
      assert.equal(unheard.missed, "One agent finished. Another is waiting on you.");
      yield* Effect.promise(() => gone.stop());

      const back = yield* Effect.promise(() => stand(target));
      const joined = yield* Effect.promise(() =>
        database.run(back.brain.join(`voice_${randomUUID()}`)),
      );
      assert.equal(joined.missed, "One agent finished. Another is waiting on you.");
      yield* Effect.promise(() => database.run(joined.follow));
      yield* Effect.promise(() => back.stop());

      const after = yield* Effect.promise(() => stand(target));
      const nothing = yield* Effect.promise(() =>
        database.run(after.brain.join(`voice_${randomUUID()}`)),
      );
      assert.equal(nothing.missed, undefined);
      yield* Effect.promise(() => after.stop());
    }),
);

it.live(
  "a call back is handed the questions Luke queued while no call was up, less any he took back",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const first = yield* Effect.promise(() => stand(target));
      const accepted = yield* Effect.promise(() =>
        database.run(first.brain.submitAsk(spokenAsk("q"))),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      yield* Effect.promise(() => first.stop());
      const standing = yield* Effect.promise(() => turnStanding(target, accepted.runId));
      const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
        stampedEveEvent(event, NOW);
      const turnId = FIRST_EVE_TURN;
      const sequence = 0;
      const call = (callId: string, toolName: string, input: Record<string, string>) =>
        stamped({
          type: "actions.requested",
          data: {
            turnId,
            sequence,
            stepIndex: 0,
            actions: [{ kind: "tool-call", callId, toolName, input }],
          },
        });
      yield* Effect.promise(() =>
        play(
          [
            stampedEveEvent({ type: "turn.started", data: { turnId, sequence } }, NOW),
            stamped({ type: "message.received", data: { turnId, sequence, message: "q" } }),
            stamped({
              type: "step.started",
              data: { turnId, sequence, stepIndex: 0, modelId: "m" },
            }),
            call("call-1", QUEUE_QUESTION_TOOL.name, {
              question: "Which email provider?",
              recommendation: "Postmark.",
            }),
            call("call-2", QUEUE_QUESTION_TOOL.name, {
              question: "Resend after a day?",
              recommendation: "Yes.",
            }),
            call("call-3", WITHDRAW_QUESTION_TOOL.name, { question: "Resend after a day?" }),
          ],
          standing,
        ),
      );

      const back = yield* Effect.promise(() => stand(target));
      const joined = yield* Effect.promise(() =>
        database.run(back.brain.join(`voice_${randomUUID()}`)),
      );
      assert.deepEqual(joined.questions, [
        { question: "Which email provider?", recommendation: "Postmark." },
      ]);
      assert.deepEqual(joined.runs, [accepted.runId]);
      yield* Effect.promise(() => back.stop());
    }),
);
