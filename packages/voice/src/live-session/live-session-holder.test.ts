import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type {
  PlanActivityFrame,
  PlanCallEndingFrame,
  PlanCodeFrame,
  PlanWorkFrame,
} from "@luke/features";
import { LIVE_SESSION_PHASE, type VoiceLiveSessionChanged } from "@luke/gateway";
import { LIVE_SERVER_EVENT, type LiveClientEvent, parseLiveServerEvent } from "@luke/live";
import type { WireRecord } from "@luke/wire";
import { Effect, type Scope, type Stream } from "effect";
import { holdSocket, type SocketHold } from "../held-socket.js";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { LiveSessionHolder } from "./live-session-holder.js";

/**
 * The peer's holder of one hosted planning call, over a scripted source and
 * sideband. What these hold to is the whole of what the desktop still sends
 * once the exchange is the service's: the plan at creation, the stop, the
 * hang-up, and the idle report through the source's own door, and nothing on
 * a delegation, a transcript, or an acknowledgment, which are the service's
 * to read.
 */

const INVITES_PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

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
  /** Every code frame the holder told its caller, in order. */
  code: PlanCodeFrame[];
  /** The service's code frame, as the source's door would deliver it. */
  tellCode(code: PlanCodeFrame): void;
  /** Every work frame the holder told its caller, in order. */
  work: PlanWorkFrame[];
  /** The service's work frame, as the source's door would deliver it. */
  tellWork(work: PlanWorkFrame): void;
  /** The service's word that Luke is ending the call, as the source's door would deliver it. */
  tellEnding(ending: PlanCallEndingFrame): void;
  /** Every plan whose call the holder told its caller ended, in order. */
  callsEnded: string[];
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
    const code: PlanCodeFrame[] = [];
    let codeListener: ((code: PlanCodeFrame) => void) | undefined;
    const work: PlanWorkFrame[] = [];
    let workListener: ((work: PlanWorkFrame) => void) | undefined;
    let endingListener: ((ending: PlanCallEndingFrame) => void) | undefined;
    const callsEnded: string[] = [];
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
                  onPlanCode: (listener: (code: PlanCodeFrame) => void) => {
                    codeListener = listener;
                  },
                  onPlanWork: (listener: (work: PlanWorkFrame) => void) => {
                    workListener = listener;
                  },
                  onPlanCallEnding: (listener: (ending: PlanCallEndingFrame) => void) => {
                    endingListener = listener;
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
      createId: () => "request",
      emit: (change) => changes.push(change),
      onPlanActivity: (word) => {
        activity.push(word);
      },
      onPlanCode: (frame) => {
        code.push(frame);
      },
      onPlanWork: (frame) => {
        work.push(frame);
      },
      onPlanCallEnded: (planId) => {
        callsEnded.push(planId);
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
      code,
      tellCode: (frame) => {
        codeListener?.(frame);
      },
      work,
      tellWork: (frame) => {
        workListener?.(frame);
      },
      tellEnding: (frame) => {
        endingListener?.(frame);
      },
      callsEnded,
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
