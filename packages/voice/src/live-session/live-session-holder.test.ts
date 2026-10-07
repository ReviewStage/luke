import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LIVE_PEER_END_REASON,
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import { type PlanActivityFrame, VOICE_SERVICE_FRAME } from "@sidecar/hosted";
import {
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  parseLiveServerEvent,
} from "@sidecar/live";
import type { WireRecord } from "@sidecar/wire";
import { Deferred, Duration, Effect, Exit, Fiber, Logger, Scope, type Stream } from "effect";
import { TestClock } from "effect/testing";
import { holdSocket, type SocketHold } from "../held-socket.js";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { SIDEBAND_CLOSE_TIMEOUT_MS } from "./graceful-close.js";
import { LIVE_SESSION_END_CAUSE, LiveSessionHolder } from "./live-session-holder.js";

/**
 * The peer's holder of one hosted planning call, over a scripted source and
 * sideband. What these hold to is the whole of what the desktop still sends
 * once the exchange is the service's: the plan at creation, the stop, the
 * hang-up, and the idle report through the source's own door, and nothing on
 * a delegation, a transcript, or an acknowledgment, which are the service's
 * to read.
 */

const INVITES_PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING_PLAN = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

class FakeSideband implements LiveSideband {
  readonly sent: LiveClientEvent[] = [];
  /** How many times the source's hang-up door asked the service to close this session. */
  hangUps = 0;
  closed = false;
  readonly #hold: SocketHold = holdSocket({
    send: () => undefined,
    ping: () => undefined,
    close: () => {
      this.closed = true;
    },
  });
  readonly #sideband: LiveSideband = sidebandOverSocket(this.#hold.socket);

  get arrivals(): Stream.Stream<SidebandArrival> {
    return this.#sideband.arrivals;
  }

  send(event: LiveClientEvent): Effect.Effect<void> {
    return Effect.sync(() => {
      this.sent.push(event);
    });
  }

  get close(): Effect.Effect<void> {
    return this.#sideband.close;
  }

  receive(payload: WireRecord): void {
    const frame = JSON.stringify(payload);
    assert.ok(parseLiveServerEvent(frame), `a test event must parse: ${frame}`);
    this.#hold.hear({ frame });
  }

  started(sessionId: string): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: sessionId },
    });
  }

  closedBy(reason: string, seconds: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_CLOSED,
      event_id: "closed",
      reason,
      usage: { seconds },
    });
  }

  dropConnection(): void {
    this.#hold.hear({ close: { code: 1006 } });
  }
}

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

interface Fixture {
  holder: LiveSessionHolder;
  sidebands: FakeSideband[];
  /** The plan each session was created about, in order. */
  plans: string[];
  changes: VoiceLiveSessionChanged[];
  /** Every idle report the source's door was handed, in order. */
  reports: boolean[];
  /** How many times the source's stop door was asked. */
  stops: number;
  /** Every activity frame the holder told its caller, in order. */
  activity: PlanActivityFrame[];
  /** The service's activity frame, as the source's door would deliver it. */
  tellActivity(activity: PlanActivityFrame): void;
  created: number;
  sourceAvailable: boolean;
  /** Whether the source opens the doors for the idle report and the stop, as the hosted source does and the keyed one does not. */
  reportsActivity: boolean;
  /** Where a creation waits before the source answers, so a test can hold one in flight. */
  createGate: Effect.Effect<void>;
  open(planId?: string): Effect.Effect<FakeSideband>;
}

function fixture(): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sidebands: FakeSideband[] = [];
    const plans: string[] = [];
    const changes: VoiceLiveSessionChanged[] = [];
    const reports: boolean[] = [];
    const activity: PlanActivityFrame[] = [];
    let activityListener: ((activity: PlanActivityFrame) => void) | undefined;
    const state = {
      sourceAvailable: true,
      reportsActivity: true,
      created: 0,
      stops: 0,
      createGate: Effect.void satisfies Effect.Effect<void>,
    };
    const source: LiveSessionSource = {
      create: (input) =>
        Effect.map(state.createGate, () => {
          plans.push(input.planId);
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const opened: LiveSessionOpened = {
            sessionId: `sess-${sidebands.length}`,
            sdpAnswer: `answer-for-${input.sdpOffer}`,
            attach: () => Effect.succeed(sideband),
            hangUp: () => {
              sideband.hangUps += 1;
            },
            ...(state.reportsActivity
              ? {
                  reportActivity: (idle: boolean) => {
                    reports.push(idle);
                  },
                  stopSpeaking: () => {
                    state.stops += 1;
                  },
                  onPlanActivity: (listener: (activity: PlanActivityFrame) => void) => {
                    activityListener = listener;
                  },
                }
              : undefined),
          };
          return opened;
        }),
      setVoice: () => undefined,
      diagnostics: () => {
        throw new Error("not read here");
      },
    };
    const holder = yield* LiveSessionHolder.make({
      source: () => (state.sourceAvailable ? source : undefined),
      emit: (change) => changes.push(change),
      onPlanActivity: (word) => {
        activity.push(word);
      },
      onSessionCreated: () => {
        state.created += 1;
      },
    });
    return {
      holder,
      sidebands,
      plans,
      changes,
      reports,
      get created() {
        return state.created;
      },
      get sourceAvailable() {
        return state.sourceAvailable;
      },
      set sourceAvailable(value: boolean) {
        state.sourceAvailable = value;
      },
      get stops() {
        return state.stops;
      },
      activity,
      tellActivity: (word) => {
        activityListener?.(word);
      },
      get reportsActivity() {
        return state.reportsActivity;
      },
      set reportsActivity(value: boolean) {
        state.reportsActivity = value;
      },
      get createGate() {
        return state.createGate;
      },
      set createGate(value: Effect.Effect<void>) {
        state.createGate = value;
      },
      open: (planId = INVITES_PLAN) =>
        Effect.gen(function* () {
          const created = yield* holder.createSession("offer", planId);
          assert.ok(created);
          const sideband = sidebands[sidebands.length - 1];
          assert.ok(sideband);
          sideband.started(created.sessionId);
          yield* settle();
          return sideband;
        }),
    };
  });
}

function phases(changes: readonly VoiceLiveSessionChanged[]) {
  return changes.map((change) => change.phase);
}

it.effect(
  "a created session is about its plan, attached before the answer, and its phases are announced",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.deepEqual(created, {
        sessionId: "sess-1",
        sdpAnswer: "answer-for-offer",
      });
      assert.equal(f.created, 1);
      assert.equal(f.holder.sessionStands(), true);
      assert.deepEqual(f.plans, [INVITES_PLAN]);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED]);
      f.sidebands[0]?.started("sess-1");
      yield* settle();
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
      // Nothing is sent at creation or start: the exchange is the service's, and it seeds nothing twice.
      assert.deepEqual(f.sidebands[0]?.sent, []);
    }),
);

it.effect("no source means no session and nothing announced", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.sourceAvailable = false;
    assert.equal(yield* f.holder.createSession("offer", INVITES_PLAN), undefined);
    assert.deepEqual(f.changes, []);
    assert.equal(f.holder.sessionStands(), false);
  }),
);

it.effect(
  "the session's delegations, transcript, and acknowledgments are read by nobody here: the holder sends nothing on them",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      sideband.receive({
        type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
        event_id: "in-1",
        delta: "What needs me?",
        start_ms: 1000,
        end_ms: 2400,
      });
      sideband.receive({
        type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
        event_id: "dl",
        offset_ms: 2500,
        delegation: { id: "dl_1", target: LIVE_DELEGATION_TARGET.CLIENT },
      });
      sideband.receive({
        type: LIVE_SERVER_EVENT.COMMENTARY_APPENDED,
        event_id: "ack",
        client_event_id: "someone-elses",
        start_ms: 3000,
        end_ms: 4000,
      });
      sideband.receive({
        type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
        event_id: "out-1",
        delta: "One agent finished.",
        start_ms: 3000,
        end_ms: 4000,
      });
      yield* settle();
      assert.deepEqual(sideband.sent, []);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.CREATED, LIVE_SESSION_PHASE.STARTED]);
    }),
);

it.effect(
  "the stop key asks the source's door once the session has started, appends nothing on the sideband itself, and answers false before, after, or with no door",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      assert.equal(f.holder.stopSpeaking(), false);
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      // Created and not yet started: the instruction would be standing text a session has not begun on.
      assert.equal(f.holder.stopSpeaking(), false);
      assert.equal(f.stops, 0);
      sideband.started(created.sessionId);
      yield* settle();
      assert.equal(f.holder.stopSpeaking(), true);
      yield* settle();
      assert.equal(f.stops, 1);
      // The instruction is the service's to append: nothing named it here, and nothing left the sideband.
      assert.deepEqual(sideband.sent, []);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 12);
      yield* settle();
      assert.equal(f.holder.stopSpeaking(), false);
      assert.equal(f.stops, 1);

      // A source with no door, the keyed one straight to OpenAI, has no one to ask.
      f.reportsActivity = false;
      const again = yield* f.holder.createSession("offer-2", INVITES_PLAN);
      assert.ok(again);
      const second = f.sidebands[1];
      assert.ok(second);
      second.started(again.sessionId);
      yield* settle();
      assert.equal(f.holder.stopSpeaking(), false);
      assert.equal(f.stops, 1);
      assert.deepEqual(second.sent, []);
    }),
);

it.effect(
  "the idle report is carried through the source's door as the peer reported it, and goes nowhere on a source with no door or no session",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.holder.reportActivity(true);
      assert.deepEqual(f.reports, []);
      const sideband = yield* f.open();
      f.holder.reportActivity(true);
      f.holder.reportActivity(false);
      assert.deepEqual(f.reports, [true, false]);
      // The report is the service's vocabulary, never a Live event on the sideband.
      assert.deepEqual(sideband.sent, []);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 30);
      yield* settle();
      f.holder.reportActivity(true);
      assert.deepEqual(f.reports, [true, false]);

      f.reportsActivity = false;
      yield* f.open();
      f.holder.reportActivity(true);
      assert.deepEqual(f.reports, [true, false]);
    }),
);

it.effect(
  "the peer's hang-up asks the service for the close and sends none, and session.closed ends the session with its reason and releases its scope",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      const fiber = yield* Effect.forkChild(f.holder.endSession(LIVE_SESSION_END_CAUSE.HANG_UP));
      yield* settle();
      assert.deepEqual(sideband.sent, []);
      assert.equal(sideband.hangUps, 1);
      assert.deepEqual(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSING);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 42);
      yield* Fiber.join(fiber);
      assert.equal(sideband.closed, true);
      assert.deepEqual(f.changes.at(-1), {
        sessionId: "sess-1",
        phase: LIVE_SESSION_PHASE.CLOSED,
        reason: LIVE_CLOSE_REASON.CLOSE_REQUESTED,
      });
      assert.equal(f.holder.sessionStands(), false);
      // A second ask to end finds nothing standing and asks nothing more.
      yield* f.holder.endSession(LIVE_SESSION_END_CAUSE.HANG_UP);
      assert.equal(sideband.hangUps, 1);
    }),
);

it.effect("a graceful close nobody answers is released at the timeout as a lost connection", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    const fiber = yield* Effect.forkChild(f.holder.endSession(LIVE_SESSION_END_CAUSE.HANG_UP));
    yield* settle();
    yield* TestClock.adjust(Duration.millis(SIDEBAND_CLOSE_TIMEOUT_MS));
    yield* Fiber.join(fiber);
    assert.equal(sideband.closed, true);
    assert.deepEqual(f.changes.at(-1), {
      sessionId: "sess-1",
      phase: LIVE_SESSION_PHASE.CLOSED,
      reason: "close timed out",
    });
  }),
);

it.effect(
  "the peer's transport is acted on here: a failed transport is the session lost, a closed one is the graceful end, and the rest are nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const first = yield* f.open();
      f.holder.reportTransport(LIVE_TRANSPORT_STATE.CONNECTING);
      f.holder.reportTransport(LIVE_TRANSPORT_STATE.CONNECTED);
      f.holder.reportTransport(LIVE_TRANSPORT_STATE.DISCONNECTED);
      yield* settle();
      assert.equal(f.holder.sessionStands(), true);
      f.holder.reportTransport(LIVE_TRANSPORT_STATE.FAILED);
      yield* settle();
      assert.equal(first.closed, true);
      assert.deepEqual(first.sent, []);
      assert.deepEqual(f.changes.at(-1), {
        sessionId: "sess-1",
        phase: LIVE_SESSION_PHASE.CLOSED,
        reason: "peer transport failed",
      });
      // Nothing of the failure was reported to the service: the relay reads the socket's end.
      assert.deepEqual(f.reports, []);

      const second = yield* f.open();
      f.holder.reportTransport(LIVE_TRANSPORT_STATE.CLOSED);
      yield* settle();
      assert.deepEqual(second.sent, []);
      assert.equal(second.hangUps, 1);
      second.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 3);
      yield* settle();
      assert.equal(f.holder.sessionStands(), false);
      assert.equal(second.closed, true);
    }),
);

it.effect("a sideband that drops is the session lost, and the drain closes what stands", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const first = yield* f.open();
    first.dropConnection();
    yield* settle();
    assert.deepEqual(f.changes.at(-1), {
      sessionId: "sess-1",
      phase: LIVE_SESSION_PHASE.CLOSED,
      reason: LIVE_CLOSE_REASON.CONNECTION_LOST,
    });
    assert.equal(f.holder.sessionStands(), false);
    const second = yield* f.open();
    const fiber = yield* Effect.forkChild(f.holder.stop());
    yield* settle();
    assert.deepEqual(second.sent, []);
    assert.equal(second.hangUps, 1);
    second.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 1);
    yield* Fiber.join(fiber);
    assert.equal(f.holder.sessionStands(), false);
  }),
);

it.effect("creating a session while one stands closes the standing one first", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const first = yield* f.open();
    const fiber = yield* Effect.forkChild(f.holder.createSession("second", INVITES_PLAN));
    yield* settle();
    assert.deepEqual(first.sent, []);
    assert.equal(first.hangUps, 1);
    first.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 5);
    const created = yield* Fiber.join(fiber);
    assert.deepEqual(created, {
      sessionId: "sess-2",
      sdpAnswer: "answer-for-second",
    });
    assert.equal(f.created, 2);
    assert.equal(first.closed, true);
  }),
);

it.effect("the holder's scope closing releases a session still standing", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const f = yield* Scope.provide(fixture(), scope);
    const sideband = yield* f.open();
    yield* Scope.close(scope, Exit.void);
    yield* settle();
    assert.equal(sideband.closed, true);
  }),
);

it.effect(
  "ending the plan call ends a call about another plan gracefully, leaves the same plan's call standing, and leaving the plan ends any call",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      yield* settle();

      yield* f.holder.endPlanCall(INVITES_PLAN);
      assert.equal(f.holder.sessionStands(), true);
      assert.deepEqual(sideband.sent, []);

      const ending = yield* Effect.forkChild(f.holder.endPlanCall(BILLING_PLAN));
      yield* settle();
      assert.deepEqual(sideband.sent, []);
      assert.equal(sideband.hangUps, 1);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 5);
      yield* Fiber.join(ending);
      assert.equal(f.holder.sessionStands(), false);

      const billing = yield* f.open(BILLING_PLAN);
      yield* f.holder.endPlanCall(BILLING_PLAN);
      assert.equal(f.holder.sessionStands(), true);
      assert.deepEqual(billing.sent, []);
      const leaving = yield* Effect.forkChild(f.holder.endPlanCall(undefined));
      yield* settle();
      assert.deepEqual(billing.sent, []);
      assert.equal(billing.hangUps, 1);
      billing.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 2);
      yield* Fiber.join(leaving);
      assert.equal(f.holder.sessionStands(), false);
    }),
);

it.effect(
  "a switch while a planning call is still being created ends that call the moment it stands, and the peer is answered nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const gate = yield* Deferred.make<void>();
      f.createGate = Deferred.await(gate);
      const creating = yield* Effect.forkChild(f.holder.createSession("offer", INVITES_PLAN));
      yield* settle();

      yield* f.holder.endPlanCall(BILLING_PLAN);
      yield* Deferred.succeed(gate, undefined);
      yield* settle();
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      assert.deepEqual(sideband.sent, []);
      assert.equal(sideband.hangUps, 1);
      assert.equal(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSING);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 1);
      assert.equal(yield* Fiber.join(creating), undefined);
      assert.equal(f.holder.sessionStands(), false);
    }),
);

it.effect("a switch to the plan being created leaves its call to stand", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const gate = yield* Deferred.make<void>();
    f.createGate = Deferred.await(gate);
    const creating = yield* Effect.forkChild(f.holder.createSession("offer", INVITES_PLAN));
    yield* settle();

    yield* f.holder.endPlanCall(INVITES_PLAN);
    yield* Deferred.succeed(gate, undefined);
    const created = yield* Fiber.join(creating);
    assert.ok(created);
    assert.equal(f.holder.sessionStands(), true);
    assert.deepEqual(f.sidebands[0]?.sent, []);
  }),
);

it.effect(
  "a switch while the prior session is still closing ahead of a planning call's creation creates nothing about the plan left behind",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const prior = yield* f.open(BILLING_PLAN);
      const creating = yield* Effect.forkChild(f.holder.createSession("offer", INVITES_PLAN));
      yield* settle();
      assert.deepEqual(prior.sent, []);
      assert.equal(prior.hangUps, 1);

      yield* f.holder.endPlanCall(BILLING_PLAN);
      prior.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 1);
      assert.equal(yield* Fiber.join(creating), undefined);
      assert.deepEqual(f.plans, [BILLING_PLAN]);
      assert.equal(f.holder.sessionStands(), false);
    }),
);

it.effect(
  "a planning call passes on the service's activity about its own plan, drops one about another, and its end is told as nothing doing about its own plan",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      yield* settle();

      const working = {
        type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY,
        planId: INVITES_PLAN,
        planner: {},
        notes: true,
      };
      f.tellActivity(working);
      f.tellActivity({ ...working, planId: BILLING_PLAN });
      assert.deepEqual(f.activity, [working]);

      sideband.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 4);
      yield* settle();
      assert.deepEqual(f.activity, [
        working,
        { type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY, planId: INVITES_PLAN, notes: false },
      ]);
      // A word arriving after the call ended reaches nobody.
      f.tellActivity(working);
      assert.equal(f.activity.length, 2);

      const billing = yield* f.open(BILLING_PLAN);
      billing.closedBy(LIVE_CLOSE_REASON.REMOTE_HANGUP, 1);
      yield* settle();
      assert.deepEqual(f.activity.slice(2), [
        { type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY, planId: BILLING_PLAN, notes: false },
      ]);
    }),
);

/** Every line the holder logged while `body` ran, read off a logger standing in for the host's reporter. */
function loggedLines<A>(
  body: (lines: readonly string[]) => Effect.Effect<A, never, Scope.Scope>,
): Effect.Effect<A, never, Scope.Scope> {
  const lines: string[] = [];
  return Effect.provide(
    body(lines),
    Logger.layer([
      Logger.make((options) => {
        lines.push(String(options.message));
      }),
    ]),
  );
}

function endLines(lines: readonly string[]): readonly string[] {
  return lines.filter((line) => line.startsWith("voice call ended:"));
}

it.effect(
  "an error naming no command, or naming one with no code, is logged by its type and code alone",
  () =>
    loggedLines((lines) =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const created = yield* f.holder.createSession("offer", INVITES_PLAN);
        assert.ok(created);
        const planning = f.sidebands[0];
        assert.ok(planning);
        planning.started(created.sessionId);
        planning.receive({
          type: LIVE_SERVER_EVENT.ERROR,
          event_id: "err-1",
          error: { type: "server_error", code: null, message: "the words" },
        });
        planning.receive({
          type: LIVE_SERVER_EVENT.ERROR,
          event_id: "err-2",
          client_event_id: "append-1",
          error: { type: "invalid_request_error", code: "invalid_value", message: "the words" },
        });
        yield* settle();
        assert.deepEqual(
          lines.filter((line) => line.startsWith("voice error:")),
          ["voice error: type=server_error code=none session=sess-1"],
        );
      }),
    ),
);

it.effect("an ended call is logged with the hand that ended it and how long it stood", () =>
  loggedLines((lines) =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.ok(created);
      const planning = f.sidebands[0];
      assert.ok(planning);
      planning.started(created.sessionId);
      yield* settle();
      yield* TestClock.adjust(Duration.seconds(204));
      const switching = yield* Effect.forkChild(f.holder.endPlanCall(BILLING_PLAN));
      yield* settle();
      planning.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 204);
      yield* Fiber.join(switching);

      const peer = yield* f.open(BILLING_PLAN);
      yield* TestClock.adjust(Duration.seconds(3));
      f.holder.reportTransport(LIVE_TRANSPORT_STATE.CLOSED, LIVE_PEER_END_REASON.CHANNEL_CLOSED);
      yield* settle();
      peer.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 3);
      yield* settle();

      const lost = yield* f.open();
      lost.dropConnection();
      yield* settle();

      assert.deepEqual(endLines(lines), [
        "voice call ended: cause=plan_switched close_reason=close_requested session=sess-1 seconds=204",
        "voice call ended: cause=peer_closed peer_reason=channel_closed close_reason=close_requested session=sess-2 seconds=3",
        "voice call ended: cause=sideband_lost close_reason=connection_lost session=sess-3 seconds=0",
      ]);
      assert.ok(
        lines.includes("voice transport: state=closed peer_reason=channel_closed session=sess-2"),
      );
    }),
  ),
);
