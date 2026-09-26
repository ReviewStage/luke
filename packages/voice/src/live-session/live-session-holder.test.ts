import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import { type SessionBeatFrame, VOICE_SERVICE_FRAME } from "@sidecar/hosted";
import {
  type InitialItem,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  PROACTIVE_SPEECH_KIND,
  type ProactiveSpeechKind,
  parseLiveServerEvent,
  type RosterSeedSession,
  rosterSeed,
  SEED_ROLE,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry, SESSION_STATUS } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Clock, Deferred, Duration, Effect, Exit, Fiber, Scope, type Stream } from "effect";
import { TestClock } from "effect/testing";
import { holdSocket, type SocketHold } from "../held-socket.js";
import type { LiveSessionOpened, LiveSessionSource } from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { SIDEBAND_CLOSE_TIMEOUT_MS } from "./graceful-close.js";
import { LiveSessionHolder, WANTED_WORD } from "./live-session-holder.js";

/**
 * The peer's holder of one hosted session, over a scripted source and
 * sideband. What these hold to is the whole of what the desktop still sends
 * once the exchange is the service's: the seed at creation, the stop, the
 * hang-up, and the idle report through the source's own door, and nothing on
 * a delegation, a transcript, or an acknowledgment, which are the service's
 * to read.
 */

class FakeSideband implements LiveSideband {
  readonly sent: LiveClientEvent[] = [];
  closed = false;
  readonly #hold: SocketHold = holdSocket({
    send: () => undefined,
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
  seeds: (readonly InitialItem[])[];
  /** The plan each session was created about, in order; none for a desk session. */
  plans: (string | undefined)[];
  changes: VoiceLiveSessionChanged[];
  /** Every idle report the source's door was handed, in order. */
  reports: boolean[];
  /** How many times the source's stop door was asked. */
  stops: number;
  /** Every beat the source's door was handed, in order. */
  beats: SessionBeatFrame[];
  /** Every kind the holder told its caller was spoken, in order. */
  spoken: ProactiveSpeechKind[];
  /** The service's word that a turn was spoken, as the source's door would deliver it. */
  tellSpoken(kind: ProactiveSpeechKind): void;
  created: number;
  entries: ConversationEntry[];
  roster: RosterSeedSession[];
  sourceAvailable: boolean;
  /** Whether the source opens the doors for the idle report and the stop, as the hosted source does and the keyed one does not. */
  reportsActivity: boolean;
  /** Where a creation waits before the source answers, so a test can hold one in flight. */
  createGate: Effect.Effect<void>;
  open(): Effect.Effect<FakeSideband>;
}

function fixture(): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sidebands: FakeSideband[] = [];
    const seeds: (readonly InitialItem[])[] = [];
    const plans: (string | undefined)[] = [];
    const changes: VoiceLiveSessionChanged[] = [];
    const reports: boolean[] = [];
    const beats: SessionBeatFrame[] = [];
    const spoken: ProactiveSpeechKind[] = [];
    let spokenListener: ((kind: ProactiveSpeechKind) => void) | undefined;
    const entries: ConversationEntry[] = [];
    const roster: RosterSeedSession[] = [];
    let ids = 0;
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
          seeds.push([...input.input]);
          plans.push(input.planId);
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const opened: LiveSessionOpened = {
            sessionId: `sess-${sidebands.length}`,
            sdpAnswer: `answer-for-${input.sdpOffer}`,
            attach: () => Effect.succeed(sideband),
            ...(state.reportsActivity
              ? {
                  reportActivity: (idle: boolean) => {
                    reports.push(idle);
                  },
                  stopSpeaking: () => {
                    state.stops += 1;
                  },
                  speakBeat: (beat: SessionBeatFrame) => {
                    beats.push(beat);
                  },
                  onSpoken: (listener: (kind: ProactiveSpeechKind) => void) => {
                    spokenListener = listener;
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
      conversationEntries: () => entries,
      roster: () => roster,
      emit: (change) => changes.push(change),
      createId: () => `id-${++ids}`,
      onSpoken: (kind) => {
        spoken.push(kind);
      },
      onSessionCreated: () => {
        state.created += 1;
      },
    });
    return {
      holder,
      sidebands,
      seeds,
      plans,
      changes,
      reports,
      entries,
      roster,
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
      beats,
      spoken,
      tellSpoken: (kind) => {
        spokenListener?.(kind);
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
      open: () =>
        Effect.gen(function* () {
          const created = yield* holder.createSession("offer");
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
  "a created session is seeded from the desk and the record, attached before the answer, and its phases are announced",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.entries.push(
        {
          kind: CONVERSATION_ENTRY_KIND.ASK,
          words: "What needs me?",
          eventId: "e1",
        },
        {
          kind: CONVERSATION_ENTRY_KIND.REPLY,
          words: "Nothing yet.",
          eventId: "e2",
        },
      );
      const now = yield* Clock.currentTimeMillis;
      f.roster.push({
        identity: { providerId: "conductor", providerSessionId: "chat-1" },
        title: "api on main",
        provider: { displayName: "Conductor" },
        status: SESSION_STATUS.WORKING,
        lastActivityAt: now - 60_000,
      });
      const created = yield* f.holder.createSession("offer");
      assert.deepEqual(created, {
        sessionId: "sess-1",
        sdpAnswer: "answer-for-offer",
      });
      assert.equal(f.created, 1);
      assert.equal(f.holder.sessionStands(), true);
      const [seed] = f.seeds;
      assert.ok(seed);
      const summary = rosterSeed(f.roster, now);
      assert.ok(summary);
      assert.deepEqual(
        seed.map((item) => [item.role, item.content[0].text]),
        [
          [SEED_ROLE.DEVELOPER, summary.text],
          [SEED_ROLE.USER, "What needs me?"],
          [SEED_ROLE.ASSISTANT, "Nothing yet."],
        ],
      );
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
    assert.equal(yield* f.holder.createSession("offer"), undefined);
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
      const created = yield* f.holder.createSession("offer");
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
      const again = yield* f.holder.createSession("offer-2");
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
  "the peer's hang-up closes gracefully: session.close goes up, and session.closed ends the session with its reason and releases its scope",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      const fiber = yield* Effect.forkChild(f.holder.endSession());
      yield* settle();
      assert.deepEqual(sideband.sent, [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "id-1" }]);
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
      // A second ask to end finds nothing standing and sends nothing more.
      yield* f.holder.endSession();
      assert.equal(sideband.sent.length, 1);
    }),
);

it.effect("a graceful close nobody answers is released at the timeout as a lost connection", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    const fiber = yield* Effect.forkChild(f.holder.endSession());
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
      assert.deepEqual(second.sent, [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "id-1" }]);
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
    assert.deepEqual(
      second.sent.map((event) => event.type),
      [LIVE_CLIENT_EVENT.CLOSE],
    );
    second.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 1);
    yield* Fiber.join(fiber);
    assert.equal(f.holder.sessionStands(), false);
    // The wanted phase is nobody's here: nothing on this side asks for a session.
    assert.equal(phases(f.changes).includes(LIVE_SESSION_PHASE.WANTED), false);
  }),
);

it.effect("creating a session while one stands closes the standing one first", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const first = yield* f.open();
    const fiber = yield* Effect.forkChild(f.holder.createSession("second"));
    yield* settle();
    assert.deepEqual(
      first.sent.map((event) => event.type),
      [LIVE_CLIENT_EVENT.CLOSE],
    );
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

const ARRIVAL: SessionBeatFrame = {
  type: VOICE_SERVICE_FRAME.SESSION_BEAT,
  kind: PROACTIVE_SPEECH_KIND.ARRIVAL,
  sessionTitle: "Fix the flaky test",
};
const CALENDAR: SessionBeatFrame = {
  type: VOICE_SERVICE_FRAME.SESSION_BEAT,
  kind: PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING,
};
const LAUNCH: SessionBeatFrame = {
  type: VOICE_SERVICE_FRAME.SESSION_BEAT,
  kind: PROACTIVE_SPEECH_KIND.LAUNCH,
  firstName: "Ada",
};

it.effect(
  "a beat asked for with no session announces wanted, goes through the source's door once the session starts, is settled by the service's word, and may then be asked again",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      assert.equal(f.holder.speakBeat(ARRIVAL), true);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
      // One ask per kind stands at a time, and a second kind asked meanwhile repeats no `wanted`.
      assert.equal(f.holder.speakBeat(ARRIVAL), false);
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
      f.holder.withdrawBeat(PROACTIVE_SPEECH_KIND.LAUNCH);
      assert.deepEqual(f.beats, []);
      const created = yield* f.holder.createSession("offer");
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      // Created and not yet started: the beat waits for the start, and nothing left the sideband.
      assert.deepEqual(f.beats, []);
      sideband.started(created.sessionId);
      yield* settle();
      assert.deepEqual(f.beats, [ARRIVAL]);
      assert.deepEqual(sideband.sent, []);
      assert.equal(f.holder.speakBeat(ARRIVAL), false);
      // A briefing the service reports spoken is the caller's to count and settles no beat.
      f.tellSpoken(PROACTIVE_SPEECH_KIND.BRIEFING);
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.BRIEFING]);
      assert.equal(f.holder.speakBeat(ARRIVAL), false);
      f.tellSpoken(PROACTIVE_SPEECH_KIND.ARRIVAL);
      assert.deepEqual(f.spoken, [PROACTIVE_SPEECH_KIND.BRIEFING, PROACTIVE_SPEECH_KIND.ARRIVAL]);
      // Settled: the kind may be asked for again, and a started session takes it at once.
      assert.equal(f.holder.speakBeat(ARRIVAL), true);
      assert.deepEqual(f.beats, [ARRIVAL, ARRIVAL]);
      assert.deepEqual(phases(f.changes), [
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.CREATED,
        LIVE_SESSION_PHASE.STARTED,
      ]);
    }),
);

it.effect(
  "a waiting beat is withdrawn; one the service already has is the service's to speak; every beat goes with the session that ended",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      assert.equal(f.holder.speakBeat(CALENDAR), true);
      assert.equal(f.holder.withdrawBeat(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING), true);
      assert.equal(f.holder.withdrawBeat(PROACTIVE_SPEECH_KIND.CALENDAR_ONBOARDING), false);
      const created = yield* f.holder.createSession("offer");
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      yield* settle();
      assert.deepEqual(f.beats, []);
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.deepEqual(f.beats, [LAUNCH]);
      assert.equal(f.holder.withdrawBeat(PROACTIVE_SPEECH_KIND.LAUNCH), false);
      assert.equal(f.holder.speakBeat(LAUNCH), false);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 3);
      yield* settle();
      // The session ended with the greeting unspoken: nothing is carried to the next, and the ask stands again.
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.deepEqual(phases(f.changes), [
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.CREATED,
        LIVE_SESSION_PHASE.STARTED,
        LIVE_SESSION_PHASE.CLOSED,
        LIVE_SESSION_PHASE.WANTED,
      ]);
      // A word about a session already over settles nothing and tells nobody.
      f.tellSpoken(PROACTIVE_SPEECH_KIND.LAUNCH);
      assert.deepEqual(f.spoken, []);
    }),
);

it.effect(
  "a session that could not be stood leaves no beat waiting for it, so the kind may be asked again and wanted announced again",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.sourceAvailable = false;
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.equal(yield* f.holder.createSession("offer"), undefined);
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.equal(yield* f.holder.createSession("offer"), undefined);
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.deepEqual(phases(f.changes), [
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.WANTED,
      ]);
      assert.deepEqual(f.beats, []);
    }),
);

it.effect(
  "wanting a session for a briefing announces wanted while none stands, and is refused while one does",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      assert.equal(f.holder.wantSession(), true);
      assert.equal(f.holder.sessionWanted(), true);
      // One word for however many reasons: a second want, or a beat asked meanwhile, repeats nothing.
      assert.equal(f.holder.wantSession(), false);
      assert.equal(f.holder.speakBeat(CALENDAR), true);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED]);
      // A word unanswered for its standing is spent: the next reason asks afresh.
      yield* TestClock.adjust(WANTED_WORD.STANDS_MS - 1);
      assert.equal(f.holder.sessionWanted(), true);
      yield* TestClock.adjust(1);
      assert.equal(f.holder.sessionWanted(), false);
      assert.equal(f.holder.wantSession(), true);
      assert.deepEqual(phases(f.changes), [LIVE_SESSION_PHASE.WANTED, LIVE_SESSION_PHASE.WANTED]);
      // Dropped by the caller (a hold began, a sign-out): spent at once.
      f.holder.dropWant();
      assert.equal(f.holder.sessionWanted(), false);
      assert.equal(f.holder.wantSession(), true);
      const created = yield* f.holder.createSession("offer");
      assert.ok(created);
      assert.equal(f.holder.sessionWanted(), false);
      // Created and not yet started: a session stands, and its exchange's look is what claims the offer.
      assert.equal(f.holder.wantSession(), false);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      yield* settle();
      assert.equal(f.holder.wantSession(), false);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 4);
      yield* settle();
      assert.equal(f.holder.wantSession(), true);
      assert.deepEqual(phases(f.changes), [
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.WANTED,
        LIVE_SESSION_PHASE.CREATED,
        LIVE_SESSION_PHASE.STARTED,
        LIVE_SESSION_PHASE.CLOSED,
        LIVE_SESSION_PHASE.WANTED,
      ]);
      assert.deepEqual(f.beats, [CALENDAR]);
      assert.deepEqual(sideband.sent, []);
    }),
);

it.effect(
  "a beat is dropped on a source with no door, since a session with no service between will never speak it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.reportsActivity = false;
      assert.equal(f.holder.speakBeat(ARRIVAL), true);
      const created = yield* f.holder.createSession("offer");
      assert.ok(created);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      yield* settle();
      assert.deepEqual(f.beats, []);
      assert.deepEqual(sideband.sent, []);
      // Dropped rather than held: the kind may be asked for again.
      assert.equal(f.holder.speakBeat(ARRIVAL), true);
    }),
);

const INVITES_PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING_PLAN = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

it.effect(
  "a planning call is created about its plan with nothing of the desk seeded, and a beat waits through it rather than being spoken into it",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.entries.push({ kind: CONVERSATION_ENTRY_KIND.ASK, words: "What needs me?", eventId: "e1" });
      const created = yield* f.holder.createSession("offer", INVITES_PLAN);
      assert.ok(created);
      assert.deepEqual(f.plans, [INVITES_PLAN]);
      assert.deepEqual(f.seeds, [[]]);
      const sideband = f.sidebands[0];
      assert.ok(sideband);
      sideband.started(created.sessionId);
      yield* settle();

      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.deepEqual(f.beats, []);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 3);
      yield* settle();

      // The next desk session is seeded from the desk again and hears the beat asked for then.
      const desk = yield* f.open();
      assert.deepEqual(f.plans, [INVITES_PLAN, undefined]);
      assert.equal(f.seeds[1]?.length, 1);
      assert.equal(f.holder.speakBeat(LAUNCH), true);
      assert.deepEqual(f.beats, [LAUNCH]);
      assert.deepEqual(desk.sent, []);
    }),
);

it.effect(
  "ending the plan call ends a call about another plan gracefully, and leaves the same plan's call and a desk session standing",
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
      assert.deepEqual(sideband.sent, [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "id-1" }]);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 5);
      yield* Fiber.join(ending);
      assert.equal(f.holder.sessionStands(), false);

      const desk = yield* f.open();
      yield* f.holder.endPlanCall(undefined);
      yield* f.holder.endPlanCall(BILLING_PLAN);
      assert.equal(f.holder.sessionStands(), true);
      assert.deepEqual(desk.sent, []);
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
      assert.deepEqual(sideband.sent, [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "id-1" }]);
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
      const desk = yield* f.open();
      const creating = yield* Effect.forkChild(f.holder.createSession("offer", INVITES_PLAN));
      yield* settle();
      assert.deepEqual(desk.sent, [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "id-1" }]);

      yield* f.holder.endPlanCall(BILLING_PLAN);
      desk.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 1);
      assert.equal(yield* Fiber.join(creating), undefined);
      assert.deepEqual(f.plans, [undefined]);
      assert.equal(f.holder.sessionStands(), false);
    }),
);
