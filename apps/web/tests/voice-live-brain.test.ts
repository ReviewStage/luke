import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
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

/** A plan the account starts, as the planning window's setup sheet saves one. */
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
  /** Settles once at least `count` run events have reached the listener, on the events themselves. */
  readonly arrived: (count: number) => Effect.Effect<void>;
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
  brain.onRunEvent((event) => events.push(event));
  const arrived = (count: number) =>
    arrival(
      (notify) => brain.onRunEvent(notify),
      () => events.length >= count,
      `${count} run events`,
    );
  return {
    eve,
    brain,
    events,
    reports,
    arrived,
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

it.live("the stream's vocabulary and the service's are one set of words on each side", () =>
  Effect.sync(() => {
    assert.deepEqual(
      Object.values(TURN_EVENT_KIND).sort(),
      Object.values(LIVE_BRAIN_RUN_EVENT).sort(),
    );
    assert.deepEqual(Object.values(TURN_END).sort(), Object.values(LIVE_BRAIN_RUN_END).sort());
  }),
);

/** A planning turn as eve streams it: the spoken ask, one update_plan call and its saved result, and the reply. */
function planningTurn(turnId: string, now: number): readonly MessageStreamEvent[] {
  const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
    stampedEveEvent(event, now);
  const sequence = 0;
  const document = { body: "# Teammate invitations", assumptions: [] };
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
          { kind: "tool-call", callId: "call-1", toolName: UPDATE_PLAN_TOOL.name, input: document },
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
          toolName: UPDATE_PLAN_TOOL.name,
          output: { status: "saved", document },
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
