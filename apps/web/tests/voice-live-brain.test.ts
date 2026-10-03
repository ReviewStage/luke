import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { EMPTY_PLAN_UPDATE } from "@sidecar/hosted/plan-template";
import {
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrainRunEvent,
} from "@sidecar/voice/live-session";
import { arrival } from "@sidecar/voice/testing";
import { SCHEMA_REFUSAL } from "@sidecar/wire";
import { Duration, Effect, Exit, Option, Scope } from "effect";
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
import { HOSTED_TOOL_SET } from "../server/hosted/brain-tool-set";
import { createPlan, openPlanConversation } from "../server/hosted/plan-store";
import { QUEUE_QUESTION_TOOL } from "../server/hosted/queue-question";
import { REPOSITORY_SHELL_STATUS, RUN_IN_REPOSITORY_TOOL } from "../server/hosted/repository-shell";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { askRecord } from "../server/hosted/store/asks";
import type { MessageListRead } from "../server/hosted/store/message-reads";
import { UPDATE_PLAN_TOOL } from "../server/hosted/update-plan-tool";
import {
  HOSTED_ASK_REFUSAL_NOTE,
  type HostedLiveBrain,
  type HostedLiveBrainOptions,
  hostedLiveBrain,
} from "../server/voice/live-brain";
import { stampedEveEvent } from "./support/eve-events";
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

/** A plan the account starts, as the Plans tab's new-plan form saves one. */
const PLAN = {
  name: "Teammate invitations",
  repository: {
    owner: "acme",
    name: "relay",
    branch: "main",
    commit: "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345",
  },
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
 * suite's one plain sleep, asserting that nothing more arrives.
 */
const QUIET_POLLS = { AFTER_END: 6, AFTER_REFUSAL: 4, AFTER_STOP: 8 } as const;
const QUICK = { POLL: Duration.millis(POLL_MS), FOLLOW: Duration.minutes(1) };
/** The same cadence with the bound close enough to reach inside a test. */
const BOUNDED = { POLL: Duration.millis(POLL_MS), FOLLOW: Duration.millis(150) };

// The relay's writer holds rows to the hosted set, as production's does, so a planning turn's update_plan is written.
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
  /** The delivery id each send into a standing session was answered with, in order. */
  readonly delivered: string[];
  failNext: number | undefined;
}

function fakeEve(): FakeEve {
  const eve: FakeEve = {
    opened: [],
    delivered: [],
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
      const deliveryId = `delivery-${randomUUID()}`;
      eve.delivered.push(deliveryId);
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId, deliveryId });
    },
    cancel() {
      return Effect.succeed({ outcome: EVE_SEND_OUTCOME.ACCEPTED });
    },
  };
  return eve;
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
  /** The stream's seams the listener heard, in order. */
  readonly events: LiveBrainRunEvent[];
  /** What the listener heard of the run's activity, apart from the seams. */
  readonly activities: LiveBrainRunEvent[];
  /** Settles once at least `count` seams have reached the listener, on the events themselves. */
  readonly arrived: (count: number) => Effect.Effect<void>;
  /** Settles once at least `count` activities have reached the listener. */
  readonly active: (count: number) => Effect.Effect<void>;
  readonly reports: string[];
  /** The socket's own scope as the attachment opens one; closing it interrupts every follow under way. */
  readonly stop: () => Promise<void>;
}

async function stand(
  target: ConversationTarget,
  bounds: NonNullable<HostedLiveBrainOptions["bounds"]> = QUICK,
  store: HostedLiveBrainOptions["store"] = database.store,
  pinned?: string,
): Promise<Stand> {
  const eve = fakeEve();
  const events: LiveBrainRunEvent[] = [];
  const activities: LiveBrainRunEvent[] = [];
  const reports: string[] = [];
  const scope = await database.run(Scope.make());
  const brain = await database.run(
    Scope.provide(
      hostedLiveBrain({
        userId: target.userId,
        ...(pinned === undefined ? undefined : { conversationId: pinned }),
        asks: { asks: askEffects, eve },
        store,
        report: (message) => reports.push(message),
        bounds,
      }),
      scope,
    ),
  );
  brain.onRunEvent((event) =>
    (event.kind === LIVE_BRAIN_RUN_EVENT.ACTIVITY ? activities : events).push(event),
  );
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
  return {
    eve,
    brain,
    events,
    activities,
    reports,
    arrived,
    active,
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
      const ask = { submissionId, question: "Developer: what needs me?" };

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
      const ask = { submissionId: randomUUID(), question: "q" };
      const accepted = yield* Effect.promise(() => database.run(f.brain.submitAsk(ask)));
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(yield* Effect.promise(() => database.run(f.brain.submitAsk(ask))), accepted);
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target,
        kind: CONVERSATION_KIND.MAIN,
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
      const refused = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
      );
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
      const accepted = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
      );
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
      const accepted = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
      yield* Effect.promise(() =>
        play(spokenTurn(FIRST_EVE_TURN, NOW), {
          sessionId,
          target,
          kind: CONVERSATION_KIND.MAIN,
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
    const accepted = yield* Effect.promise(() =>
      database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
    );
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
    const accepted = yield* Effect.promise(() =>
      database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
    );
    assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
    if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
    yield* Effect.promise(() => f.stop());
    const sessionId = yield* Effect.promise(() => sessionOf(target, accepted.runId));
    yield* Effect.promise(() =>
      play(spokenTurn(FIRST_EVE_TURN, NOW), {
        sessionId,
        target,
        kind: CONVERSATION_KIND.MAIN,
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
  "the stream's vocabulary and the service's are one set of words on each side, but for the live brain's own activity",
  () =>
    Effect.sync(() => {
      const { ACTIVITY: _ownActivity, ...streamed } = LIVE_BRAIN_RUN_EVENT;
      assert.deepEqual(Object.values(TURN_EVENT_KIND).sort(), Object.values(streamed).sort());
      assert.deepEqual(Object.values(TURN_END).sort(), Object.values(LIVE_BRAIN_RUN_END).sort());
    }),
);

it.live(
  "two asks eve folded into one turn hear its reply once between them, and each hears the turn's end",
  () =>
    Effect.gen(function* () {
      const target = yield* Effect.promise(() => account());
      const f = yield* Effect.promise(() => stand(target));
      const first = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q1" })),
      );
      const second = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q2" })),
      );
      assert.equal(first.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      assert.equal(second.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (first.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      if (second.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, first.runId)),
        target,
        kind: CONVERSATION_KIND.MAIN,
        turn: BRAIN_HOST_TURN.SPOKEN,
        model: "scripted-model",
        state: memoryRelayState(),
      };
      yield* Effect.promise(() => play(spokenTurn(FIRST_EVE_TURN, NOW, f.eve.delivered), standing));
      yield* f.arrived(6);
      yield* Effect.sleep(POLL_MS * QUIET_POLLS.AFTER_END);

      const sentences = f.events.flatMap((event) =>
        event.kind === LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE ? [event.sentence] : [],
      );
      assert.deepEqual(sentences, ["One agent finished.", "Another is waiting on you."]);
      const ended = f.events.flatMap((event) =>
        event.kind === LIVE_BRAIN_RUN_EVENT.ENDED ? [event.runId] : [],
      );
      assert.deepEqual(new Set(ended), new Set([first.runId, second.runId]));
      assert.equal(ended.length, 2);
      assert.deepEqual(f.reports, []);
      yield* Effect.promise(() => f.stop());
    }),
);

/** The one call a planning turn makes, as eve names its input and its result. */
interface PlanningCall {
  readonly toolName: string;
  readonly input: unknown;
  readonly output: unknown;
}

const UPDATE_PLAN_CALL: PlanningCall = {
  toolName: UPDATE_PLAN_TOOL.name,
  input: EMPTY_PLAN_UPDATE,
  output: { status: "saved", document: { body: "# Teammate invitations", assumptions: [] } },
};

/** A planning turn as eve streams it: the spoken ask, one call and its result, and the reply. */
function planningTurn(
  turnId: string,
  now: number,
  call: PlanningCall = UPDATE_PLAN_CALL,
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
        message: "Saved. Who can withdraw an invite?",
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
  "a planning call's ask lands in its plan's conversation, and a turn that saved the plan is followed to its reply rather than told as failed",
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
      const accepted = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      assert.deepEqual(
        f.eve.opened.map((message) => message.conversationId),
        [planConversation],
      );
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        kind: CONVERSATION_KIND.PLAN,
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
      const accepted = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        kind: CONVERSATION_KIND.PLAN,
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
      const accepted = yield* Effect.promise(() =>
        database.run(f.brain.submitAsk({ submissionId: randomUUID(), question: "q" })),
      );
      assert.equal(accepted.outcome, LIVE_BRAIN_SUBMISSION.ACCEPTED);
      if (accepted.outcome !== LIVE_BRAIN_SUBMISSION.ACCEPTED) return;
      const standing: RelayStanding = {
        sessionId: yield* Effect.promise(() => sessionOf(target, accepted.runId)),
        target: { userId: target.userId, conversationId: planConversation },
        kind: CONVERSATION_KIND.PLAN,
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
