import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { TaskShownCode } from "@luke/features/tasks-view";
import {
  LIVE_CLIENT_EVENT,
  LIVE_DELEGATION_TARGET,
  LIVE_SERVER_EVENT,
  type LiveClientEvent,
  type LiveServerEventType,
  parseLiveServerEvent,
  TRANSCRIPT_SPEAKER,
} from "@luke/live";
import type { WireRecord } from "@luke/wire";
import { Deferred, Duration, Effect, Fiber, Layer, type Scope, type Stream } from "effect";
import { TestClock } from "effect/testing";
import { liveBrainLayer } from "../effect/live-brain.js";
import { liveRecordLayer } from "../effect/live-record.js";
import { holdSocket, type SocketHold } from "../held-socket.js";
import { type LiveSideband, type SidebandArrival, sidebandOverSocket } from "../live-socket.js";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_RUN_END,
  LIVE_BRAIN_RUN_EVENT,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
  type LiveBrainAsk,
  type LiveBrainCancel,
  type LiveBrainJoin,
  type LiveBrainRecoveredRun,
  type LiveBrainRecovery,
  type LiveBrainRunEvent,
  type LiveBrainSubmission,
} from "./live-brain.js";
import type { LiveRecord, SpokenAskAttach, SpokenRowUpsert } from "./live-record.js";
import {
  LiveSessionService,
  type LiveSessionStatus,
  type LiveSessionTrace,
  ROW_WRITE_DEBOUNCE_MS,
} from "./live-session-service.js";

/** The acknowledgment each append type earns, as the API names them. */
const ACKNOWLEDGMENT_OF: ReadonlyMap<LiveClientEvent["type"], LiveServerEventType> = new Map([
  [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND, LIVE_SERVER_EVENT.INSTRUCTIONS_APPENDED],
  [LIVE_CLIENT_EVENT.THINKING_APPEND, LIVE_SERVER_EVENT.THINKING_APPENDED],
  [LIVE_CLIENT_EVENT.COMMENTARY_APPEND, LIVE_SERVER_EVENT.COMMENTARY_APPENDED],
]);

class FakeSideband implements LiveSideband {
  readonly sent: LiveClientEvent[] = [];
  closed = false;
  /** Whether a thinking append is acknowledged the instant it is sent, as the session does for an append that speaks nothing; a test that watches one wait turns this off. */
  acknowledgeThinkingAtOnce = true;
  /** While set, each send waits here before it reaches the wire, as a slow socket's would. */
  sendWhen: Deferred.Deferred<void> | undefined;
  /** The hold a real socket has beneath its sideband, so what a test says before the session reads is held exactly as it would be. */
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
    const wait = this.sendWhen === undefined ? Effect.void : Deferred.await(this.sendWhen);
    return Effect.andThen(
      wait,
      Effect.sync(() => {
        this.sent.push(event);
        if (this.acknowledgeThinkingAtOnce && event.type === LIVE_CLIENT_EVENT.THINKING_APPEND) {
          this.acknowledge(this.sent.length - 1, 0, 0);
        }
      }),
    );
  }

  get close(): Effect.Effect<void> {
    return this.#sideband.close;
  }

  /** Delivers one server event as the socket would, through the same parser the real sideband uses. */
  receive(payload: WireRecord): void {
    const frame = JSON.stringify(payload);
    assert.ok(parseLiveServerEvent(frame), `a test event must parse: ${frame}`);
    this.#hold.hear({ frame });
  }

  dropConnection(): void {
    this.#hold.hear({ close: { code: 1006 } });
  }

  /** Acknowledges the append sent at the given index, on the session timeline given. */
  acknowledge(index: number, startMs: number, endMs: number): void {
    const sent = this.sent[index];
    assert.ok(sent, `append ${index} was sent`);
    const acknowledgedType = ACKNOWLEDGMENT_OF.get(sent.type);
    assert.ok(acknowledgedType, `append ${index} is an append`);
    this.receive({
      type: acknowledgedType,
      event_id: `ack-${index}`,
      client_event_id: sent.event_id,
      start_ms: startMs,
      end_ms: endMs,
    });
  }

  started(sessionId: string): void {
    this.receive({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: sessionId },
    });
  }

  delegation(id: string, offsetMs: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.DELEGATION_CREATED,
      event_id: `delegation-${id}`,
      offset_ms: offsetMs,
      delegation: { id, target: LIVE_DELEGATION_TARGET.CLIENT },
    });
  }

  input(delta: string, startMs: number, endMs: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
      event_id: `in-${startMs}`,
      delta,
      start_ms: startMs,
      end_ms: endMs,
    });
  }

  output(delta: string, startMs: number, endMs: number): void {
    this.receive({
      type: LIVE_SERVER_EVENT.OUTPUT_TRANSCRIPT_DELTA,
      event_id: `out-${startMs}`,
      delta,
      start_ms: startMs,
      end_ms: endMs,
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
}

/** A recovery as the fake answers it: the session's newest revision, the runs taken up, and what their follow tells at once. */
interface ScriptedRecovery {
  readonly revision: number;
  readonly runs: readonly LiveBrainRecoveredRun[];
  readonly told: readonly LiveBrainRunEvent[];
}

/** A join as the fake answers it: what the call finds, and the events its follow tells the moment it runs. */
interface ScriptedJoin {
  readonly join: Omit<LiveBrainJoin, "follow">;
  readonly told: readonly LiveBrainRunEvent[];
}

class FakeBrain implements LiveBrain {
  readonly asks: LiveBrainAsk[] = [];
  refuse: string | undefined;
  /** While set, each ask is taken at once and answered only when this settles, as a brain across the network answers. */
  answerWhen: Deferred.Deferred<void> | undefined;
  /** Every run the service asked to cancel, in order. */
  readonly cancels: string[] = [];
  /** What the backend says of a cancel, answered only once `cancelWhen` settles where it is set. */
  cancel: LiveBrainCancel = LIVE_BRAIN_CANCEL.CANCELLED;
  cancelWhen: Deferred.Deferred<void> | undefined;
  /** What a re-attached session takes up, and the events its follow tells the moment it runs; none by default. */
  recovery: ScriptedRecovery = {
    revision: 0,
    runs: [],
    told: [],
  };
  /** What each fresh session finds as it joins the plan, and what its follow tells; nothing by default, as a first call whose exploring the backend refused. */
  joining: ScriptedJoin = {
    join: { joined: false, runs: [], missed: undefined, questions: [] },
    told: [],
  };
  readonly #listeners = new Set<(event: LiveBrainRunEvent) => void>();
  #runs = 0;

  submitAsk(ask: LiveBrainAsk): Effect.Effect<LiveBrainSubmission> {
    return Effect.gen({ self: this }, function* () {
      this.asks.push(ask);
      if (this.answerWhen !== undefined) yield* Deferred.await(this.answerWhen);
      if (this.refuse !== undefined) {
        return { outcome: LIVE_BRAIN_SUBMISSION.REFUSED, refusal: this.refuse };
      }
      this.#runs += 1;
      return { outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: `run-${this.#runs}` };
    });
  }

  /** While set, a join answers only once this settles, as a brain reading its store does. */
  joinWhen: Deferred.Deferred<void> | undefined;
  /** How many joins had their follow run, which is when what they handed over counts heard. */
  followed = 0;

  join(): Effect.Effect<LiveBrainJoin> {
    return Effect.gen({ self: this }, function* () {
      if (this.joinWhen !== undefined) yield* Deferred.await(this.joinWhen);
      return {
        ...this.joining.join,
        follow: Effect.sync(() => {
          this.followed += 1;
          for (const event of this.joining.told) this.fire(event);
        }),
      };
    });
  }

  cancelRun(runId: string): Effect.Effect<LiveBrainCancel> {
    return Effect.gen({ self: this }, function* () {
      this.cancels.push(runId);
      if (this.cancelWhen !== undefined) yield* Deferred.await(this.cancelWhen);
      return this.cancel;
    });
  }

  recoverRuns(): Effect.Effect<LiveBrainRecovery> {
    return Effect.sync(() => {
      const { revision, runs, told } = this.recovery;
      return {
        revision,
        runs,
        follow: Effect.sync(() => {
          for (const event of told) this.fire(event);
        }),
      };
    });
  }

  onRunEvent(listener: (event: LiveBrainRunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  fire(event: LiveBrainRunEvent): void {
    for (const listener of [...this.#listeners]) listener(event);
  }
}

class FakeRecord implements LiveRecord {
  /** Every row write in the order the record was handed them: a row grows as repeats of its id, each over the span it then had. */
  readonly rows: SpokenRowUpsert[] = [];
  /** Every attach in the order the record was handed them: the rows a delegation is about, by the delegation. */
  readonly attached: SpokenAskAttach[] = [];
  /** While set, the writes of the kinds named wait here for the test to answer them, oldest first. */
  #held: { rows: boolean; answers: ((written: boolean) => void)[] } | undefined;

  /** The next delegated writes, and the row writes too where asked, are held until `release` answers them. */
  hold(kinds: { rows?: boolean } = {}): void {
    this.#held = { rows: kinds.rows ?? false, answers: [] };
  }

  /** Answers the oldest held write; a write answered true is on the record. */
  release(written: boolean): void {
    const held = this.#held?.answers.shift();
    assert.ok(held, "a write is held");
    held(written);
  }

  upsertSpokenRow(row: SpokenRowUpsert): Effect.Effect<boolean> {
    return this.#write(this.#held?.rows === true, () => this.rows.push(row));
  }

  /** The hosted record writes each row handed over before it attaches; the fake keeps the same account of the rows. */
  attachSpokenAsk(attach: SpokenAskAttach): Effect.Effect<boolean> {
    return this.#write(this.#held !== undefined, () => {
      this.rows.push(...attach.rows);
      this.attached.push(attach);
    });
  }

  #write(held: boolean, land: () => void): Effect.Effect<boolean> {
    return Effect.suspend(() => {
      if (!held) {
        land();
        return Effect.succeed(true);
      }
      return Effect.map(
        Effect.promise(
          () =>
            new Promise<boolean>((resolve) => {
              this.#held?.answers.push(resolve);
            }),
        ),
        (written) => {
          if (written) land();
          return written;
        },
      );
    });
  }
}

/** The rows as the tests read them: whose, and over what span; the words are the record's to cut. */
function spans(rows: readonly SpokenRowUpsert[]) {
  return rows.map((row) => [row.speaker, row.startMs, row.endMs]);
}

/** Each attach as a delegation and the ids of the rows it named, oldest first. */
function attaches(record: FakeRecord) {
  return record.attached.map((attach) => ({
    delegationId: attach.delegationId,
    voiceSessionId: attach.voiceSessionId,
    rowIds: attach.rows.map((row) => row.rowId),
  }));
}

/**
 * Moves the ambient `TestClock` forward by `deltaMs`, firing whatever it finds
 * due, and settles what that firing started. The turns before the move are
 * what let a delay the service armed on its own fiber reach its sleep, since
 * a sleep begun after the move would not be due yet.
 */
function advanceClock(deltaMs: number) {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.millis(deltaMs));
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

/** Lets queued microtasks and forked fibers run their course. */
function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

interface Fixture {
  brain: FakeBrain;
  record: FakeRecord;
  /** Every sideband adopted so far, in order; the session adopted over the nth is `sess-n`. */
  sidebands: FakeSideband[];
  /** Every line the service reported, in order. */
  reports: string[];
  /** Every status `onStatus` was told, in order. */
  statuses: LiveSessionStatus[];
  /** Every code `onCode` put on screen, in order. */
  codes: TaskShownCode[];
  /** How many times the peer was told the call is ending. */
  endings: { count: number };
  /** Every hand-off the service traced, in order. */
  traces: LiveSessionTrace[];
  service: LiveSessionService;
  /** Adopts a fresh session over a new sideband, as the route hands one in, and starts it. */
  open: () => Effect.Effect<FakeSideband>;
}

function fixture(brain: FakeBrain = new FakeBrain()): Effect.Effect<Fixture, never, Scope.Scope> {
  return Effect.gen(function* () {
    const record = new FakeRecord();
    const sidebands: FakeSideband[] = [];
    const reports: string[] = [];
    const statuses: LiveSessionStatus[] = [];
    const codes: TaskShownCode[] = [];
    const endings = { count: 0 };
    const traces: LiveSessionTrace[] = [];
    let ids = 0;
    const service = yield* Effect.provide(
      LiveSessionService.make({
        createId: () => `id-${++ids}`,
        report: (message) => reports.push(message),
        onStatus: (status) => statuses.push(status),
        onCode: (shown) => codes.push(shown),
        onCallEnding: () => {
          endings.count += 1;
        },
        onTrace: (entry) => traces.push(entry),
      }),
      Layer.mergeAll(liveBrainLayer(brain), liveRecordLayer(record)),
    );
    return {
      brain,
      record,
      sidebands,
      reports,
      statuses,
      codes,
      endings,
      traces,
      service,
      open: () =>
        Effect.gen(function* () {
          const sideband = new FakeSideband();
          sidebands.push(sideband);
          const sessionId = `sess-${sidebands.length}`;
          const adopted = yield* service.adoptSession({
            sessionId,
            attach: () => Effect.succeed(sideband),
            started: false,
          });
          assert.ok(adopted);
          sideband.started(sessionId);
          return sideband;
        }),
    };
  });
}

function appends(sideband: FakeSideband, type: string) {
  return sideband.sent.filter((event) => event.type === type);
}

it.effect(
  "a delegation is claimed once, composed from the transcript since the previous one, and attaches the developer's row, written as it stands",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.output("Hi there.", 0, 900);
      sideband.input("What needs me", 1000, 1800);
      sideband.input(" right now?", 1800, 2400);
      sideband.delegation("item_1", 2500);
      sideband.delegation("item_1", 2500);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      assert.deepEqual(f.brain.asks[0]?.submissionId, "item_1");
      // The delegation flushed both rows as they stood before the ask was composed on them, and the
      // ask's row was written once more as it stood at the attach, ahead of the attach itself.
      assert.deepEqual(spans(f.record.rows), [
        [TRANSCRIPT_SPEAKER.ASSISTANT, 0, 900],
        [TRANSCRIPT_SPEAKER.USER, 1000, 2400],
        [TRANSCRIPT_SPEAKER.USER, 1000, 2400],
      ]);
      assert.equal(f.record.rows[1]?.rowId, f.record.rows[2]?.rowId);
      assert.deepEqual(attaches(f.record), [
        { delegationId: "item_1", voiceSessionId: "sess-1", rowIds: [f.record.rows[1]?.rowId] },
      ]);
      // Nothing was put off: the debounce after it writes nothing more.
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.attached.length, 1);
      assert.equal(f.record.rows.length, 3);
    }),
);

it.effect(
  "a row reaches the record within the debounce of its first fragment, grows with each later one under the same id, and is written by nothing while the speaker is silent",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.output("Two ", 0, 400);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS - 1);
      assert.equal(f.record.rows.length, 0);
      yield* advanceClock(1);
      assert.deepEqual(spans(f.record.rows), [[TRANSCRIPT_SPEAKER.ASSISTANT, 0, 400]]);
      const [first] = f.record.rows;
      assert.ok(first);
      // Two fragments inside one debounce are one write, over the span they grew the row to.
      sideband.output("sessions", 400, 900);
      sideband.output(" finished.", 900, 1400);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.deepEqual(
        f.record.rows.map((row) => [row.rowId, row.startMs, row.endMs]),
        [
          [first.rowId, 0, 400],
          [first.rowId, 0, 1400],
        ],
      );
      // Silence arms nothing: no event is read into the gap, and the row owes the record nothing.
      yield* advanceClock(10 * ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.rows.length, 2);
      // The next utterance opens under an id of its own.
      sideband.output("Anything else?", 9000, 9800);
      yield* advanceClock(ROW_WRITE_DEBOUNCE_MS);
      assert.equal(f.record.rows.length, 3);
      assert.notEqual(f.record.rows[2]?.rowId, first.rowId);
    }),
);

it.effect(
  "a run's reply is appended once per sentence, in order, and nothing of the run is appended after its end",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What changed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      const sentences = ["One.", "Two.", "Three."];
      for (const sentence of sentences) {
        f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId: "run-1", sentence });
      }
      for (let index = 0; index < sentences.length; index += 1) {
        yield* settle();
        sideband.acknowledge(index, 1000 + index * 100, 1050 + index * 100);
      }
      yield* settle();
      assert.deepEqual(
        appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).map((event) =>
          "content" in event ? event.content : undefined,
        ),
        sentences,
      );
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.ENDED,
        runId: "run-1",
        end: LIVE_BRAIN_RUN_END.COMPLETED,
      });
      yield* advanceClock(1000);
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE,
        runId: "run-1",
        sentence: "Late.",
      });
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId: "run-1" });
      yield* settle();
      assert.equal(appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).length, sentences.length);
    }),
);

/** What each commentary append asked the voice to say, in wire order. */
function said(sideband: FakeSideband) {
  return appends(sideband, LIVE_CLIENT_EVENT.COMMENTARY_APPEND).map((event) =>
    "content" in event ? event.content : undefined,
  );
}

/** A session with one asked run standing as `run-1`. */
function askedRun() {
  return Effect.gen(function* () {
    const f = yield* fixture();
    const sideband = yield* f.open();
    yield* settle();
    sideband.input("What changed?", 0, 800);
    sideband.delegation("item_1", 900);
    yield* settle();
    return { f, sideband };
  });
}

function sentence(runId: string, words: string): LiveBrainRunEvent {
  return { kind: LIVE_BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence: words };
}

it.effect(
  "consecutive sentences all reach the wire before any is acknowledged, and an acknowledgment out of order settles only the append it names",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      f.brain.fire(sentence("run-1", "One."));
      f.brain.fire(sentence("run-1", "Two."));
      f.brain.fire(sentence("run-1", "Three."));
      yield* settle();
      assert.deepEqual(said(sideband), ["One.", "Two.", "Three."]);
      // The third is taken first and the second refused: only the second is sent again, under a fresh id.
      sideband.acknowledge(2, 300, 400);
      const refused = sideband.sent[1];
      assert.ok(refused);
      sideband.receive({
        type: LIVE_SERVER_EVENT.ERROR,
        event_id: "err-1",
        error: { type: "invalid_request_error", code: "busy", client_event_id: refused.event_id },
      });
      yield* settle();
      assert.deepEqual(said(sideband), ["One.", "Two.", "Three.", "Two."]);
      assert.notEqual(sideband.sent[3]?.event_id, refused.event_id);
      sideband.acknowledge(0, 0, 100);
      sideband.acknowledge(3, 400, 500);
      yield* advanceClock(20_000);
      assert.deepEqual(f.reports, []);
    }),
);

it.effect(
  "a chunk refused twice is given up, and one left unanswered is reported and never sent again",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      f.brain.fire(sentence("run-1", "Refused."));
      f.brain.fire(sentence("run-1", "Unanswered."));
      yield* settle();
      const refuse = (index: number) =>
        sideband.receive({
          type: LIVE_SERVER_EVENT.ERROR,
          event_id: `err-${index}`,
          error: {
            type: "invalid_request_error",
            client_event_id: sideband.sent[index]?.event_id ?? "",
          },
        });
      refuse(0);
      yield* settle();
      refuse(2);
      yield* advanceClock(20_000);
      assert.deepEqual(said(sideband), ["Refused.", "Unanswered.", "Refused."]);
      assert.deepEqual(
        f.reports.filter((report) => report.includes("commentary")),
        [
          "A reply's commentary was refused twice and is not said",
          "A reply's commentary went unanswered and is not sent again",
        ],
      );
    }),
);

it.effect(
  "while the socket's sends are slow, appends still reach the wire in the order they were queued",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      const slow = yield* Deferred.make<void>();
      sideband.sendWhen = slow;
      f.brain.fire(sentence("run-1", "First."));
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.SLOW_STEP,
        runId: "run-1",
        step: "repository_read",
      });
      f.brain.fire(sentence("run-1", "Second."));
      yield* settle();
      assert.equal(sideband.sent.length, 0);
      yield* Deferred.succeed(slow, undefined);
      yield* settle();
      assert.deepEqual(
        sideband.sent.map((event) => ("content" in event ? event.content : event.type)),
        ["First.", "Luke is reading the repository; this takes a moment.", "Second."],
      );
    }),
);

it.effect(
  "a stop withdraws the reply chunks still waiting for the wire, so nothing of the stopped run is said",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      const slow = yield* Deferred.make<void>();
      sideband.sendWhen = slow;
      f.brain.fire(sentence("run-1", "Stale one."));
      f.brain.fire(sentence("run-1", "Stale two."));
      yield* settle();
      assert.ok(f.service.stopSpeaking());
      yield* Deferred.succeed(slow, undefined);
      yield* settle();
      // The first chunk had its turn on the wire before the stop; every one after is withdrawn.
      assert.deepEqual(said(sideband), ["Stale one."]);
      assert.deepEqual(
        appends(sideband, LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND).map((event) => event.type),
        [LIVE_CLIENT_EVENT.INSTRUCTIONS_APPEND],
      );
    }),
);

it.effect(
  "an accepted ask's reply and its next question are said while the ask's record write is still out",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      f.record.hold();
      sideband.input("What changed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire({
        kind: LIVE_BRAIN_RUN_EVENT.QUESTION_QUEUED,
        runId: "run-1",
        question: "Which repo?",
        recommendation: "The web app.",
      });
      f.brain.fire(sentence("run-1", "Invites expire after seven days."));
      yield* settle();
      assert.equal(f.record.attached.length, 0);
      assert.deepEqual(said(sideband), [
        "Ask the developer this next, once they have answered anything you have already asked: Which repo? Recommended answer: The web app.",
        "Invites expire after seven days.",
      ]);
      f.record.release(true);
      yield* settle();
      assert.equal(f.record.attached.length, 1);
    }),
);

it.effect(
  "a sentence is said as the brain tells it, with no settled mark of the service's own to wait for",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      f.brain.fire(sentence("run-1", "Right away."));
      yield* settle();
      assert.deepEqual(said(sideband), ["Right away."]);
    }),
);

it.effect(
  "a finished worker's finding is said while an asked run is still under way, and the next ask silences it",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      f.brain.fire({ kind: LIVE_BRAIN_RUN_EVENT.WOKEN, runId: "woken-1" });
      f.brain.fire(sentence("woken-1", "The repository has an invites module."));
      yield* settle();
      assert.deepEqual(said(sideband), ["The repository has an invites module."]);
      sideband.input("And emails?", 1000, 1600);
      sideband.delegation("item_2", 1700);
      yield* settle();
      f.brain.fire(sentence("woken-1", "Stale finding."));
      f.brain.fire(sentence("run-1", "Superseded reply."));
      f.brain.fire(sentence("run-2", "Current reply."));
      yield* settle();
      assert.deepEqual(said(sideband), ["The repository has an invites module.", "Current reply."]);
    }),
);

it.effect(
  "a call that ends while Luke is still working cancels none of his runs, so the work goes on with no call up",
  () =>
    Effect.gen(function* () {
      const { f, sideband } = yield* askedRun();
      f.brain.fire(sentence("run-1", "Halfway there."));
      yield* settle();
      sideband.closedBy("remote_hangup", 12);
      yield* settle();
      assert.equal(f.service.sessionStands(), false);
      assert.deepEqual(f.brain.cancels, []);
    }),
);

/** What each thinking append told the voice, in wire order. */
function thought(sideband: FakeSideband) {
  return appends(sideband, LIVE_CLIENT_EVENT.THINKING_APPEND).map((event) =>
    "content" in event ? event.content : undefined,
  );
}

it.effect(
  "a call back hears what Luke said while nobody was on the call as a short catch-up, then the run still under way from its follow, and the old run never ends the new call",
  () =>
    Effect.gen(function* () {
      const brain = new FakeBrain();
      brain.joining = {
        join: {
          joined: true,
          runs: ["earlier-run"],
          missed: "Invites expire after seven days.",
          questions: [],
        },
        // The run finishes as the call joins it, and its end of the call was the last call's goodbye.
        told: [
          sentence("earlier-run", "The resend button is wired too."),
          { kind: LIVE_BRAIN_RUN_EVENT.CALL_ENDING, runId: "earlier-run" },
          {
            kind: LIVE_BRAIN_RUN_EVENT.ENDED,
            runId: "earlier-run",
            end: LIVE_BRAIN_RUN_END.COMPLETED,
          },
        ],
      };
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      assert.deepEqual(said(sideband), [
        "While the developer was away, Luke kept working. Catch them up in a sentence or two, in your own words rather than reading this out: Invites expire after seven days. He is still working, and will say more when he has it.",
        "The resend button is wired too.",
      ]);
      assert.equal(f.endings.count, 0);
      // Joining asks the brain nothing: no delegation is composed and nothing is cancelled.
      assert.deepEqual(f.brain.asks, []);
      assert.deepEqual(f.brain.cancels, []);
    }),
);

it.effect(
  "a call back whose earlier work is still under way with nothing new yet is told so quietly, and the developer's ask then supersedes it",
  () =>
    Effect.gen(function* () {
      const brain = new FakeBrain();
      brain.joining = {
        join: { joined: true, runs: ["earlier-run"], missed: undefined, questions: [] },
        told: [],
      };
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      assert.deepEqual(said(sideband), []);
      assert.deepEqual(thought(sideband), [
        "Luke is still working on what the developer asked on an earlier call; his findings will follow when he has them.",
      ]);
      sideband.input("How's it going?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      f.brain.fire(sentence("earlier-run", "Old finding."));
      f.brain.fire(sentence("run-1", "Current reply."));
      yield* settle();
      assert.deepEqual(said(sideband), ["Current reply."]);
    }),
);

it.effect(
  "a plan's first call says no catch-up: its exploring is heard as a run of the brain's own",
  () =>
    Effect.gen(function* () {
      const brain = new FakeBrain();
      brain.joining = {
        join: { joined: false, runs: ["explore-1"], missed: undefined, questions: [] },
        told: [sentence("explore-1", "This is the web app.")],
      };
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      assert.deepEqual(said(sideband), ["This is the web app."]);
      assert.deepEqual(thought(sideband), []);
    }),
);

it.effect(
  "a call back asks the questions Luke queued while no call was up, after its catch-up, one at a time",
  () =>
    Effect.gen(function* () {
      const brain = new FakeBrain();
      brain.joining = {
        join: {
          joined: true,
          runs: [],
          missed: "Invites expire after seven days.",
          questions: [
            { question: "Which email provider?", recommendation: "Postmark." },
            { question: "Resend after a day?", recommendation: "Yes." },
          ],
        },
        told: [],
      };
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      assert.deepEqual(said(sideband), [
        "While the developer was away, Luke kept working. Catch them up in a sentence or two, in your own words rather than reading this out: Invites expire after seven days.",
        "Ask the developer this next, once they have answered anything you have already asked: Which email provider? Recommended answer: Postmark.",
      ]);
      assert.equal(brain.followed, 1);
    }),
);

it.effect(
  "a call that ends while it is still joining hands nothing over and counts nothing heard, so the next call is caught up instead",
  () =>
    Effect.gen(function* () {
      const brain = new FakeBrain();
      brain.joining = {
        join: { joined: true, runs: ["earlier-run"], missed: "Unheard.", questions: [] },
        told: [],
      };
      brain.joinWhen = yield* Deferred.make<void>();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.closedBy("remote_hangup", 3);
      yield* settle();
      yield* Deferred.succeed(brain.joinWhen, undefined);
      yield* settle();
      assert.deepEqual(said(sideband), []);
      assert.equal(brain.followed, 0);
    }),
);

it.effect(
  "an ask the developer makes while the call is still joining supersedes the earlier work: nothing of it is said, stood, or counted heard",
  () =>
    Effect.gen(function* () {
      const brain = new FakeBrain();
      brain.joining = {
        join: { joined: true, runs: ["earlier-run"], missed: "Stale finding.", questions: [] },
        told: [],
      };
      brain.joinWhen = yield* Deferred.make<void>();
      const f = yield* fixture(brain);
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Check the email path instead.", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      yield* Deferred.succeed(brain.joinWhen, undefined);
      yield* settle();
      f.brain.fire(sentence("earlier-run", "Old reply."));
      f.brain.fire(sentence("run-1", "Current reply."));
      yield* settle();
      assert.deepEqual(said(sideband), ["Current reply."]);
      assert.equal(brain.followed, 0);
    }),
);

it.effect(
  "a correction the developer made just before hanging up, which no ask carried, reaches the brain as the call ends and is attached to its lines",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("What changed?", 0, 800);
      sideband.delegation("item_1", 900);
      yield* settle();
      sideband.output("Invites expire after seven days.", 1_000, 5_900);
      sideband.input("Actually, invites should expire after three days.", 9_000, 10_200);
      const ending = yield* Effect.forkChild(f.service.endSession(), { startImmediately: true });
      yield* settle();
      sideband.closedBy("close_requested", 4);
      yield* Fiber.join(ending);

      assert.equal(f.brain.asks.length, 2);
      const last = f.brain.asks[1];
      assert.ok(last?.question.endsWith("Actually, invites should expire after three days."));
      assert.equal(last?.sessionId, "sess-1");
      assert.equal(f.record.attached.at(-1)?.delegationId, last?.submissionId);
      // Nothing of the earlier ask's span is asked again.
      assert.ok(!last?.question.includes("Their line: What changed?"));
    }),
);

it.effect("a call whose every word an ask carried asks nothing more as it ends", () =>
  Effect.gen(function* () {
    const { f, sideband } = yield* askedRun();
    const ending = yield* Effect.forkChild(f.service.endSession(), { startImmediately: true });
    yield* settle();
    sideband.closedBy("close_requested", 4);
    yield* Fiber.join(ending);
    assert.equal(f.brain.asks.length, 1);
  }),
);

it.effect(
  "the session closing of its own hands on the developer's undelegated words too, and a session let go of for its peer to attach to again hands on nothing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const sideband = yield* f.open();
      yield* settle();
      sideband.input("Make it three days.", 0, 900);
      sideband.closedBy("expired", 4);
      yield* settle();
      assert.equal(f.brain.asks.length, 1);
      assert.ok(f.brain.asks[0]?.question.endsWith("Make it three days."));

      const detached = yield* fixture();
      const held = yield* detached.open();
      yield* settle();
      held.input("Make it five days.", 0, 900);
      yield* detached.service.release();
      yield* settle();
      assert.deepEqual(detached.brain.asks, []);
    }),
);
