import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  LIVE_SESSION_PHASE,
  LIVE_TRANSPORT_STATE,
  type VoiceLiveSessionChanged,
} from "@sidecar/gateway";
import {
  type InitialItem,
  LIVE_CLIENT_EVENT,
  LIVE_CLOSE_REASON,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  parseLiveServerEvent,
  type RosterSeedSession,
  rosterSeed,
  SEED_ROLE,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry, SESSION_STATUS } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import { Duration, Effect, Exit, Scope, type Stream, TestClock } from "effect";
import { holdSocket, type SocketHold } from "../held-socket.js";
import {
  type LiveSessionOpened,
  type LiveSessionSource,
  SidebandAttachFailed,
} from "../live-session-source.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import { SIDEBAND_CLOSE_TIMEOUT_MS } from "./graceful-close.js";
import { LiveSessionHolder } from "./live-session-holder.js";
import { STOP_SPEAKING_INSTRUCTION } from "./live-session-service.js";

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
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow();
  });
}

interface Fixture {
  holder: LiveSessionHolder;
  sidebands: FakeSideband[];
  seeds: (readonly InitialItem[])[];
  changes: VoiceLiveSessionChanged[];
  /** Every idle report the source's door was handed, in order. */
  reports: boolean[];
  created: number;
  entries: ConversationEntry[];
  roster: RosterSeedSession[];
  sourceAvailable: boolean;
  /** Whether the source opens a door for the idle report, as the hosted source does and the keyed one does not. */
  reportsActivity: boolean;
  attachFails: boolean;
  open(): Effect.Effect<FakeSideband>;
}

function fixture(): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const sidebands: FakeSideband[] = [];
    const seeds: (readonly InitialItem[])[] = [];
    const changes: VoiceLiveSessionChanged[] = [];
    const reports: boolean[] = [];
    const entries: ConversationEntry[] = [];
    const roster: RosterSeedSession[] = [];
    let ids = 0;
    const state = { sourceAvailable: true, reportsActivity: true, attachFails: false, created: 0 };
    const source: LiveSessionSource = {
      create: (input) =>
        Effect.sync(() => {
          seeds.push([...input.input]);
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const opened: LiveSessionOpened = {
            sessionId: `sess-${sidebands.length}`,
            sdpAnswer: `answer-for-${input.sdpOffer}`,
            attach: () =>
              state.attachFails
                ? Effect.fail(new SidebandAttachFailed({ detail: "status 503" }))
                : Effect.succeed(sideband),
            ...(state.reportsActivity
              ? {
                  reportActivity: (idle: boolean) => {
                    reports.push(idle);
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
      report: () => undefined,
      onSessionCreated: () => {
        state.created += 1;
      },
    });
    return {
      holder,
      sidebands,
      seeds,
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
      get reportsActivity() {
        return state.reportsActivity;
      },
      set reportsActivity(value: boolean) {
        state.reportsActivity = value;
      },
      get attachFails() {
        return state.attachFails;
      },
      set attachFails(value: boolean) {
        state.attachFails = value;
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

it.scoped(
  "a created session is seeded from the desk and the record, attached before the answer, and its phases are announced",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.entries.push(
        { kind: CONVERSATION_ENTRY_KIND.ASK, words: "What needs me?", eventId: "e1" },
        { kind: CONVERSATION_ENTRY_KIND.REPLY, words: "Nothing yet.", eventId: "e2" },
      );
      const now = yield* TestClock.currentTimeMillis;
      f.roster.push({
        identity: { providerId: "conductor", providerSessionId: "chat-1" },
        title: "api on main",
        provider: { displayName: "Conductor" },
        status: SESSION_STATUS.WORKING,
        lastActivityAt: now - 60_000,
      });
      const created = yield* f.holder.createSession("offer");
      assert.deepEqual(created, { sessionId: "sess-1", sdpAnswer: "answer-for-offer" });
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

it.scoped("no source means no session and nothing announced", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.sourceAvailable = false;
    assert.equal(yield* f.holder.createSession("offer"), undefined);
    assert.deepEqual(f.changes, []);
    assert.equal(f.holder.sessionStands(), false);
  }),
);

it.scoped(
  "a sideband that cannot attach answers no session and announces it closed as sideband-failed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.attachFails = true;
      assert.equal(yield* f.holder.createSession("offer"), undefined);
      assert.deepEqual(f.changes, [
        { sessionId: "sess-1", phase: LIVE_SESSION_PHASE.CREATED },
        { sessionId: "sess-1", phase: LIVE_SESSION_PHASE.CLOSED, reason: "sideband-failed" },
      ]);
      assert.equal(f.created, 0);
      assert.equal(f.holder.sessionStands(), false);
    }),
);

it.scoped(
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

it.scoped(
  "the stop key sends one instruction append under no delegation once the session has started, and answers false before or after",
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
      sideband.started(created.sessionId);
      yield* settle();
      assert.equal(f.holder.stopSpeaking(), true);
      yield* settle();
      assert.deepEqual(sideband.sent, [
        {
          type: LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND,
          event_id: "id-1",
          delegation_id: null,
          content: STOP_SPEAKING_INSTRUCTION,
        },
      ]);
      // Its acknowledgment is nothing the holder waits on or reads.
      sideband.receive({
        type: LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED,
        event_id: "ack",
        client_event_id: "id-1",
        start_ms: 0,
        end_ms: 0,
      });
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 12);
      yield* settle();
      assert.equal(f.holder.stopSpeaking(), false);
      assert.equal(sideband.sent.length, 1);
    }),
);

it.scoped(
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

it.scoped(
  "the peer's hang-up closes gracefully: session.close goes up, and session.closed ends the session with its reason and releases its scope",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      const fiber = yield* Effect.fork(f.holder.endSession());
      yield* settle();
      assert.deepEqual(sideband.sent, [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "id-1" }]);
      assert.deepEqual(phases(f.changes).at(-1), LIVE_SESSION_PHASE.CLOSING);
      sideband.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 42);
      yield* fiber;
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

it.scoped("a graceful close nobody answers is released at the timeout as a lost connection", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    const fiber = yield* Effect.fork(f.holder.endSession());
    yield* settle();
    yield* TestClock.adjust(Duration.millis(SIDEBAND_CLOSE_TIMEOUT_MS));
    yield* fiber;
    assert.equal(sideband.closed, true);
    assert.deepEqual(f.changes.at(-1), {
      sessionId: "sess-1",
      phase: LIVE_SESSION_PHASE.CLOSED,
      reason: "close timed out",
    });
  }),
);

it.scoped(
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

it.scoped("a sideband that drops is the session lost, and the drain closes what stands", () =>
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
    const fiber = yield* Effect.fork(f.holder.stop());
    yield* settle();
    assert.deepEqual(
      second.sent.map((event) => event.type),
      [LIVE_CLIENT_EVENT.CLOSE],
    );
    second.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 1);
    yield* fiber;
    assert.equal(f.holder.sessionStands(), false);
    // The wanted phase is nobody's here: nothing on this side asks for a session.
    assert.equal(phases(f.changes).includes(LIVE_SESSION_PHASE.WANTED), false);
  }),
);

it.scoped("creating a session while one stands closes the standing one first", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const first = yield* f.open();
    const fiber = yield* Effect.fork(f.holder.createSession("second"));
    yield* settle();
    assert.deepEqual(
      first.sent.map((event) => event.type),
      [LIVE_CLIENT_EVENT.CLOSE],
    );
    first.closedBy(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 5);
    const created = yield* fiber;
    assert.deepEqual(created, { sessionId: "sess-2", sdpAnswer: "answer-for-second" });
    assert.equal(f.created, 2);
    assert.equal(first.closed, true);
  }),
);

it.scoped("the holder's scope closing releases a session still standing", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const f = yield* Scope.extend(fixture(), scope);
    const sideband = yield* f.open();
    yield* Scope.close(scope, Exit.void);
    yield* settle();
    assert.equal(sideband.closed, true);
  }),
);
